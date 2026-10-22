import { JobsOptions } from 'bullmq';
import { UlipClient, UlipError, UlipVahanResult } from '../../../adapters/ulip.client';
import { JobQueue } from '../../../jobs/queue-registry';
import { AuditService } from '../../audit/audit.service';
import { VehicleEntity } from './entities/vehicle.entity';
import {
  RecordVehicleVerificationInput,
  UpdateVehicleData,
  VehicleVerificationPapersInput,
} from './vehicle.interface';
import { VehicleRepository } from './vehicle.repository';
import { VehicleService } from './vehicle.service';
import { FUEL_TYPES, VehicleFuelType } from './vehicle.type';

/** Background VAHAN (ULIP) checks of bulk-imported trucks — its own queue and limiter, since
 *  ULIP is a different vendor from the GST lookups on 'gst-verification'. */
export const VAHAN_VERIFICATION_QUEUE = 'vahan-verification';
const JOB_NAME = 'verify-vehicle';

// Retries are for ULIP hiccups only (timeout, network, upstream error) — a registry answer is
// final. Backoff starts at the 2-minute window since the limiter would hold the job anyway.
const JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 120_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { count: 5000 },
};

const TRANSIENT_ULIP_ERRORS = new Set<UlipError['code']>([
  'TIMEOUT',
  'NETWORK_ERROR',
  'UPSTREAM_ERROR',
]);

export interface VahanVerificationJobPayload {
  tenantId: string;
  recordId: string;
  actorId: string;
}

export type VahanVerificationJobResult =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'verified' | 'not_found' | 'manual_review'; error: string | null };

/** Thrown to make BullMQ retry the job with backoff (transient ULIP error, attempts left). */
export class RetryableVahanVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableVahanVerificationError';
  }
}

const cut = (value: string | undefined, max: number) => value?.slice(0, max);

/** A VAHAN result → the snapshot payload recordVerification takes — the same mapping the Add a
 *  truck drawer does client-side (onboardVehiclePayload.ts's verificationPayload). */
export function vahanResultToVerification(result: UlipVahanResult): RecordVehicleVerificationInput {
  if (result.status === 'not_found') {
    return { verificationType: 'vahan', verificationStatus: 'not_found' };
  }
  const papers: VehicleVerificationPapersInput = Object.fromEntries(
    Object.entries({
      ...result.papers,
      insuranceProvider: cut(result.papers.insuranceProvider, 150),
    }).filter(([, value]) => value !== undefined),
  );
  return {
    verificationType: 'vahan',
    verificationStatus: 'verified',
    registeredName: cut(result.registeredName, 150),
    registeredOn: result.registeredOn,
    vehicleClass: cut(result.vehicleClass, 100),
    registeringAuthority: cut(result.registeringAuthority, 100),
    financierName: cut(result.financierName, 150),
    addressLine1: cut(result.addressLine1, 255),
    papers,
    responsePayload:
      result.rawResponse && typeof result.rawResponse === 'object'
        ? (result.rawResponse as Record<string, unknown>)
        : undefined,
  };
}

/** "DIESEL" / "Petrol" / "CNG ONLY" → our fuel enum; anything else (e.g. "PETROL/CNG") → null. */
function fuelTypeFromVahan(raw: string | undefined): VehicleFuelType | null {
  const normalized = raw
    ?.trim()
    .toLowerCase()
    .replace(/\s*only$/, '');
  return (FUEL_TYPES as readonly string[]).includes(normalized ?? '')
    ? (normalized as VehicleFuelType)
    : null;
}

/** Vehicle fields VAHAN can supply, only where the sheet left them blank. */
export function blankFieldsFromVahan(
  vehicle: Pick<
    VehicleEntity,
    'makeModel' | 'fuelType' | 'unladenWeightKg' | 'financierName' | 'vahanBodyType'
  >,
  result: UlipVahanResult,
): UpdateVehicleData {
  const fill: UpdateVehicleData = {};
  if (!vehicle.makeModel && result.makerModel) fill.makeModel = result.makerModel.slice(0, 100);
  const fuel = fuelTypeFromVahan(result.fuelType);
  if (!vehicle.fuelType && fuel) fill.fuelType = fuel;
  if (!vehicle.unladenWeightKg && result.unladenWeightKg)
    fill.unladenWeightKg = Math.round(result.unladenWeightKg);
  if (!vehicle.financierName && result.financierName)
    fill.financierName = result.financierName.slice(0, 150);
  if (!vehicle.vahanBodyType && result.bodyType) fill.vahanBodyType = result.bodyType.slice(0, 50);
  return fill;
}

/**
 * Background VAHAN verification for bulk-imported trucks. The import saves each truck with a
 * 'pending' snapshot and enqueues one job per truck (jobId = vehicle id). The 'vahan-verification'
 * worker runs one lookup per window; each result goes through VehicleService.recordVerification,
 * so papers, the national-permit flag, the fleet badge and the VAHAN notification behave exactly
 * as when the Add a truck drawer saves a verified truck.
 */
export class VehicleVahanVerificationService {
  constructor(
    private readonly vehicles: Pick<VehicleRepository, 'findById' | 'update'>,
    private readonly vehicleService: Pick<VehicleService, 'recordVerification'>,
    private readonly ulipClient: Pick<UlipClient, 'lookupVehicle'>,
    private readonly audit: AuditService,
    private readonly jobQueue: JobQueue,
  ) {}

  /** Fire-and-forget: a queue outage must never fail the import. The truck stays 'pending'. */
  async enqueue(payload: VahanVerificationJobPayload): Promise<boolean> {
    try {
      await this.jobQueue.enqueue(JOB_NAME, payload, { ...JOB_OPTIONS, jobId: payload.recordId });
      return true;
    } catch (error) {
      console.error(`Failed to enqueue VAHAN verification for vehicle ${payload.recordId}`, error);
      return false;
    }
  }

  /** One job run; `attempt` is 1-based. Throws RetryableVahanVerificationError only to retry. */
  async process(
    payload: VahanVerificationJobPayload,
    attempt: number,
    maxAttempts: number,
  ): Promise<VahanVerificationJobResult> {
    const { tenantId, recordId, actorId } = payload;
    const vehicle = await this.vehicles.findById(tenantId, recordId);
    if (!vehicle) return this.skip(recordId, 'vehicle deleted');
    // Verified from the drawer (or otherwise re-checked) while the job waited.
    if (vehicle.vahanVerificationStatus !== 'pending')
      return this.skip(recordId, `status is ${vehicle.vahanVerificationStatus}`);

    let result: UlipVahanResult;
    try {
      result = await this.ulipClient.lookupVehicle(vehicle.registrationNumber);
    } catch (error) {
      const code = error instanceof UlipError ? error.code : 'NETWORK_ERROR';
      const message = error instanceof Error ? error.message : 'VAHAN lookup failed';
      if (TRANSIENT_ULIP_ERRORS.has(code) && attempt < maxAttempts) {
        console.warn(
          `[vahan-verification] vehicle=${recordId} plate=${vehicle.registrationNumber} attempt=${attempt}/${maxAttempts} transient ${code}: ${message}`,
        );
        throw new RetryableVahanVerificationError(message);
      }
      const reason =
        code === 'NOT_CONFIGURED'
          ? 'VAHAN lookup is not configured'
          : `VAHAN lookup failed (${code}) — check manually`;
      return this.finish(vehicle, actorId, {
        input: { verificationType: 'vahan', verificationStatus: 'manual_review' },
        error: reason,
      });
    }

    const input = vahanResultToVerification(result);
    const outcome = await this.finish(vehicle, actorId, {
      input,
      error: result.status === 'not_found' ? 'Not found in VAHAN' : null,
    });
    if (result.status === 'verified') {
      const fill = blankFieldsFromVahan(vehicle, result);
      if (Object.keys(fill).length) await this.vehicles.update(tenantId, vehicle.id, fill);
    }
    return outcome;
  }

  private skip(recordId: string, reason: string): VahanVerificationJobResult {
    console.info(`[vahan-verification] vehicle=${recordId} skipped: ${reason}`);
    return { outcome: 'skipped', reason };
  }

  private async finish(
    vehicle: VehicleEntity,
    actorId: string,
    result: { input: RecordVehicleVerificationInput; error: string | null },
  ): Promise<VahanVerificationJobResult> {
    await this.vehicleService.recordVerification(
      vehicle.tenantId,
      actorId,
      vehicle.id,
      result.input,
      undefined,
      result.error,
    );
    const outcome = result.input.verificationStatus as 'verified' | 'not_found' | 'manual_review';
    console.info(
      `[vahan-verification] vehicle=${vehicle.id} plate=${vehicle.registrationNumber} outcome=${outcome}${result.error ? ` error="${result.error}"` : ''}`,
    );
    await this.audit.log({
      tenantId: vehicle.tenantId,
      userId: actorId,
      action: 'VEHICLE_VAHAN_VERIFICATION_COMPLETED',
      resourceType: 'vehicle',
      newData: {
        id: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        vahanVerificationStatus: outcome,
        error: result.error,
      },
    });
    return { outcome, error: result.error };
  }
}
