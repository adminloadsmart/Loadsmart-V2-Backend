import { JobsOptions } from 'bullmq';
import { IdfyClient } from '../../adapters/idfy.client';
import { JobQueue } from '../../jobs/queue-registry';
import { AuditService } from '../audit/audit.service';
import { OrganizationDocumentService } from './organization-document.service';
import { OrganizationJourneyStageService } from './organization-journey-stage.service';
import { OrganizationService } from './organization.service';
import {
  OrganizationDocumentEntity,
  OrganizationDocumentType,
} from './entities/organization-document.entity';

export const DOCUMENT_VERIFICATION_QUEUE = 'org-document-verification';
const JOB_NAME = 'verify';

// Polling window: the worker re-checks the IDfy task every 3s, ~10 attempts (~30s) — each
// "still in progress" attempt throws so BullMQ retries, same retry mechanism as notifications.
const JOB_OPTIONS: JobsOptions = { attempts: 10, backoff: { type: 'fixed', delay: 3000 } };

interface IdfyDocumentConfig {
  taskType: string;
  buildInput: (documentNumber: string) => Record<string, unknown>;
  // Legal/registered name in the task's source_output, when IDfy returns one.
  nameFields: string[];
}

// One entry per document type that can be verified by number. Task types / input keys follow
// IDfy's Eve v3 API (https://eve-api-docs.idfy.com) — keep all vendor-specific names here.
const IDFY_DOCUMENT_CONFIG: Partial<Record<OrganizationDocumentType, IdfyDocumentConfig>> = {
  gst_certificate: {
    taskType: 'ind_gst_certificate',
    buildInput: (gstin) => ({ gstin }),
    nameFields: ['legal_name', 'trade_name'],
  },
  udyam: {
    taskType: 'udyam_aadhaar',
    buildInput: (uamNumber) => ({ uam_number: uamNumber }),
    nameFields: ['enterprise_name', 'name_of_enterprise', 'legal_name'],
  },
  cin: {
    taskType: 'ind_cin',
    buildInput: (cin) => ({ cin }),
    nameFields: ['company_name', 'legal_name'],
  },
};

export function isAutoVerifiable(document: {
  documentType: OrganizationDocumentType;
  documentNumber?: string | null;
}): boolean {
  return Boolean(document.documentNumber && IDFY_DOCUMENT_CONFIG[document.documentType]);
}

const IN_PROGRESS_STATUSES = new Set(['in_progress', 'pending', 'queued']);

/**
 * Automatically verifies GST / Udyam / CIN organization documents against IDfy. Enqueued after a
 * document with a number is saved; the BullMQ worker (workers/) calls processDocument, which
 * submits the async IDfy task once, polls it across retries, and — only when IDfy returns the
 * document's details — marks the document 'verified'. Anything else (not found, failed task,
 * IDfy unconfigured/out of credits) leaves it 'pending' for the existing admin review.
 */
export class OrganizationDocumentVerificationService {
  constructor(
    private readonly documentService: OrganizationDocumentService,
    private readonly organizationService: OrganizationService,
    private readonly journeyStageService: OrganizationJourneyStageService,
    private readonly auditService: AuditService,
    private readonly idfyClient: IdfyClient,
    private readonly jobQueue: JobQueue,
  ) {}

  /** Fire-and-forget: a queue outage must never fail the onboarding request itself. */
  async enqueueVerification(documents: OrganizationDocumentEntity[]): Promise<void> {
    for (const document of documents.filter(isAutoVerifiable)) {
      try {
        await this.jobQueue.enqueue(JOB_NAME, { documentId: document.id }, JOB_OPTIONS);
      } catch (error) {
        console.error(`Failed to enqueue IDfy verification for document ${document.id}`, error);
      }
    }
  }

  /** Throws only to request a retry (task still in progress / transient IDfy error). */
  async processDocument(documentId: string): Promise<void> {
    const document = await this.documentService.findActiveById(documentId);
    if (!document || document.verificationStatus !== 'pending' || !document.documentNumber) {
      return;
    }
    const config = IDFY_DOCUMENT_CONFIG[document.documentType];
    if (!config || !this.idfyClient.isConfigured()) {
      return;
    }

    let requestId = document.sourceReference;
    if (!requestId) {
      requestId = await this.idfyClient.submit(
        config.taskType,
        config.buildInput(document.documentNumber),
      );
      await this.documentService.recordVerificationRequest(document.id, requestId);
    }

    const task = await this.idfyClient.getTask(requestId);
    if (!task || IN_PROGRESS_STATUSES.has(task.status)) {
      throw new Error(`IDfy task ${requestId} still in progress`);
    }

    const output = task.result?.source_output;
    if (task.status !== 'completed' || !output || output.status !== 'id_found') {
      await this.documentService.recordAutoVerificationFailure(document.id, {
        idfyStatus: task.status,
        ...(output ?? {}),
      });
      await this.auditService.log({
        tenantId: document.organizationId,
        userId: null,
        action: 'ORGANIZATION_DOCUMENT_AUTO_VERIFICATION_FAILED',
        resourceType: 'organization_document',
        newData: {
          documentId: document.id,
          documentType: document.documentType,
          idfyStatus: task.status,
          idfyResult: output?.status ?? null,
        },
      });
      return;
    }

    const registeredName =
      config.nameFields
        .map((field) => output[field])
        .find((value): value is string => typeof value === 'string' && value.length > 0) ?? null;

    await this.documentService.applyAutoVerification(document.id, {
      registeredName,
      rawResponse: output,
    });
    await this.auditService.log({
      tenantId: document.organizationId,
      userId: null,
      action: 'ORGANIZATION_DOCUMENT_AUTO_VERIFIED',
      resourceType: 'organization_document',
      newData: {
        documentId: document.id,
        documentType: document.documentType,
        verificationStatus: 'verified',
      },
    });
    await this.completeOnlineKycIfAllVerified(document.organizationId, null);
  }

  /** Completes online KYC the moment every submitted document is 'verified' — shared by the
   *  admin's manual verify (AdminService) and this automated path. `actingUserId` is null for
   *  the automated path. No-op if already completed or any document is still unverified. */
  async completeOnlineKycIfAllVerified(
    organizationId: string,
    actingUserId: string | null,
  ): Promise<void> {
    const organization = await this.organizationService.getOrganizationStatus(organizationId);
    if (organization.onlineKycCompletedAt) {
      return;
    }
    const documents = await this.documentService.listByOrganization(organizationId);
    const allVerified =
      documents.length > 0 &&
      documents.every((document) => document.verificationStatus === 'verified');
    if (!allVerified) {
      return;
    }

    await this.organizationService.updateOrganization(organizationId, {
      onlineKycCompletedAt: new Date(),
    });
    const updatedOrg = await this.journeyStageService.recordTransition(
      organizationId,
      'online_kyc_completed',
      actingUserId,
    );
    await this.auditService.log({
      tenantId: organizationId,
      userId: actingUserId,
      action: 'ORGANIZATION_ONLINE_KYC_COMPLETED',
      resourceType: 'organization',
      newData: {
        onlineKycCompletedAt: updatedOrg.onlineKycCompletedAt,
        journeyStage: updatedOrg.journeyStage,
      },
    });
  }
}
