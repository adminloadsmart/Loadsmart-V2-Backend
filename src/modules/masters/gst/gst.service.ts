import { IdfyClient } from '../../../adapters/idfy.client';
import { rethrow } from '../../../shared/errors';
import { gstStateName, panFromGstin } from '../../../shared/constants/gst-state-codes';
import { extractRegistryDetails } from '../../organization/organization-document-registry-details';
import { AuditService } from '../../audit/audit.service';
import { GstVerificationEntity } from './entities/gst-verification.entity';
import { GstVerificationRepository } from './gst.repository';
import { GST_VERIFICATION_TTL_MS, GstVerificationResult, VerifyGstInput } from './gst.types';

const GST_TASK_TYPE = 'ind_gst_certificate';
// Same in-request polling budget as IdfyClient.verifyBankAccount (~15s) — the Add Customer drawer
// waits on the Verify button, so there is no background worker here.
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 10;
const IN_PROGRESS_STATUSES = new Set(['in_progress', 'pending', 'queued']);

// Legal-form suffixes ignored when comparing an entered name with the registry's.
const NAME_NOISE =
  /\b(m\/s|messrs|the|pvt|private|ltd|limited|llp|co|company|corp|corporation|and)\b/g;

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9/ ]/g, ' ')
    .replace(NAME_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the entered name equals the registry's legal or trade name, ignoring case,
 *  punctuation and legal-form suffixes ("Pvt Ltd" vs "Private Limited"). */
export function gstNameMatches(
  entered: string | null | undefined,
  registry: { legalName: string | null; tradeName: string | null },
): boolean | null {
  if (!entered || (!registry.legalName && !registry.tradeName)) return null;
  const target = normalizeName(entered);
  return [registry.legalName, registry.tradeName]
    .filter((name): name is string => Boolean(name))
    .some((name) => normalizeName(name) === target);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export interface GstVerificationResponse {
  verificationId: string;
  status: GstVerificationResult;
  gstin: string;
  legalName: string | null;
  tradeName: string | null;
  constitutionOfBusiness: string | null;
  taxpayerType: string | null;
  pan: string | null;
  gstinStatus: string | null;
  registeredSince: string | null;
  stateCode: string;
  placeOfSupply: string | null;
  registeredAddress: string | null;
  addressParts: GstVerificationEntity['addressParts'];
  nameMatched: boolean | null;
}

/**
 * Settings → Masters "Verify" (Add Customer / Add Transporter). Submits IDfy's GST task with the
 * existing IdfyClient.submit, polls it inside the request, normalises the answer through the same
 * extractRegistryDetails the organization onboarding uses, and records every lookup. Never throws
 * for a vendor problem — that is a 200 with status 'unavailable', so the UI falls back to the
 * manual-override form.
 */
export class GstVerificationService {
  constructor(
    private readonly repository: GstVerificationRepository,
    private readonly idfyClient: IdfyClient,
    private readonly audit: AuditService,
  ) {}

  async verify(
    tenantId: string,
    actorId: string,
    input: VerifyGstInput,
  ): Promise<GstVerificationResponse> {
    try {
      const { gstin } = input;
      const lookup = await this.lookup(gstin);
      const row = await this.repository.create({
        tenantId,
        gstin,
        stateCode: gstin.slice(0, 2),
        createdBy: actorId,
        ...lookup,
      });
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'GSTIN_VERIFICATION_REQUESTED',
        resourceType: 'gst_verification',
        newData: { id: row.id, gstin, status: row.status },
      });
      return this.toResponse(row, input.legalName);
    } catch (error) {
      rethrow(error, 'Failed to verify GSTIN');
    }
  }

  /**
   * The verified lookup a customer/transporter save may attach: same tenant, same GSTIN,
   * status 'verified', younger than GST_VERIFICATION_TTL_MS. Anything else → null, and the record
   * is saved as an unverified manual entry.
   */
  async resolveVerified(
    tenantId: string,
    gstin: string | null | undefined,
    verificationId: string | null | undefined,
  ): Promise<GstVerificationEntity | null> {
    if (!gstin || !verificationId) return null;
    const row = await this.repository.findById(tenantId, verificationId);
    if (!row || row.gstin !== gstin.toUpperCase() || row.status !== 'verified') return null;
    if (Date.now() - row.createdAt.getTime() > GST_VERIFICATION_TTL_MS) return null;
    return row;
  }

  private async lookup(
    gstin: string,
  ): Promise<
    Pick<
      GstVerificationEntity,
      | 'requestId'
      | 'status'
      | 'legalName'
      | 'tradeName'
      | 'constitution'
      | 'taxpayerType'
      | 'gstinStatus'
      | 'registeredSince'
      | 'registeredAddress'
      | 'addressParts'
      | 'rawResponse'
    >
  > {
    const empty = {
      legalName: null,
      tradeName: null,
      constitution: null,
      taxpayerType: null,
      gstinStatus: null,
      registeredSince: null,
      registeredAddress: null,
      addressParts: null,
      rawResponse: null,
    };
    if (!this.idfyClient.isConfigured()) {
      return { ...empty, requestId: null, status: 'unavailable' };
    }

    let requestId: string | null = null;
    try {
      requestId = await this.idfyClient.submit(GST_TASK_TYPE, { gstin });
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        const task = await this.idfyClient.getTask(requestId);
        if (task && !IN_PROGRESS_STATUSES.has(task.status)) {
          const output = task.result?.source_output;
          if (task.status !== 'completed' || !output) {
            return { ...empty, requestId, status: 'unavailable' };
          }
          const details = extractRegistryDetails('gst_certificate', output);
          if (!details) return { ...empty, requestId, status: 'not_found', rawResponse: output };
          return {
            requestId,
            status: details.active ? 'verified' : 'inactive',
            legalName: details.legalName,
            tradeName: text(output.trade_name),
            constitution: text(output.constitution_of_business),
            taxpayerType: text(output.taxpayer_type),
            gstinStatus: details.status,
            registeredSince: details.registeredSince,
            registeredAddress: details.address,
            addressParts: details.addressParts,
            rawResponse: output,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      return { ...empty, requestId, status: 'unavailable' };
    } catch (error) {
      console.warn(`IDfy GSTIN lookup failed for ${gstin}`, error);
      return { ...empty, requestId, status: 'unavailable' };
    }
  }

  private toResponse(row: GstVerificationEntity, enteredName?: string): GstVerificationResponse {
    return {
      verificationId: row.id,
      status: row.status,
      gstin: row.gstin,
      legalName: row.legalName,
      tradeName: row.tradeName,
      constitutionOfBusiness: row.constitution,
      taxpayerType: row.taxpayerType,
      pan: panFromGstin(row.gstin),
      gstinStatus: row.gstinStatus,
      registeredSince: row.registeredSince,
      stateCode: row.stateCode,
      placeOfSupply: row.addressParts?.state || gstStateName(row.gstin),
      registeredAddress: row.registeredAddress,
      addressParts: row.addressParts,
      nameMatched: gstNameMatches(enteredName, row),
    };
  }
}
