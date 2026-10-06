import { describe, expect, it, vi } from 'vitest';
import { OrganizationDocumentVerificationService } from './organization-document-verification.service';

function build(task: unknown, doc: Record<string, unknown> = {}) {
  const document = {
    id: 'd1',
    organizationId: 'o1',
    documentType: 'gst_certificate',
    documentNumber: '29ABCDE1234F1Z5',
    verificationStatus: 'pending',
    sourceReference: null,
    ...doc,
  };
  const documentService = {
    findActiveById: vi.fn().mockResolvedValue(document),
    recordVerificationRequest: vi.fn(),
    applyAutoVerification: vi.fn(),
    recordAutoVerificationFailure: vi.fn(),
    listByOrganization: vi.fn().mockResolvedValue([{ verificationStatus: 'verified' }]),
  };
  const organizationService = {
    getOrganizationStatus: vi.fn().mockResolvedValue({ onlineKycCompletedAt: null }),
    updateOrganization: vi.fn(),
  };
  const journey = { recordTransition: vi.fn().mockResolvedValue({}) };
  const audit = { log: vi.fn() };
  const idfy = {
    isConfigured: () => true,
    submit: vi.fn().mockResolvedValue('req-1'),
    getTask: vi.fn().mockResolvedValue(task),
  };
  const service = new OrganizationDocumentVerificationService(
    documentService as never,
    organizationService as never,
    journey as never,
    audit as never,
    idfy as never,
    { enqueue: vi.fn(), cancel: vi.fn() },
  );
  return { service, documentService, organizationService, idfy };
}

describe('OrganizationDocumentVerificationService.processDocument', () => {
  it('verifies the document and completes online KYC when IDfy finds it', async () => {
    const { service, documentService, organizationService, idfy } = build({
      status: 'completed',
      result: { source_output: { status: 'id_found', legal_name: 'ACME LTD' } },
    });
    await service.processDocument('d1');
    expect(idfy.submit).toHaveBeenCalledWith('ind_gst_certificate', { gstin: '29ABCDE1234F1Z5' });
    expect(documentService.applyAutoVerification).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ registeredName: 'ACME LTD' }),
    );
    expect(organizationService.updateOrganization).toHaveBeenCalled();
  });

  it('leaves the document pending when IDfy does not find it', async () => {
    const { service, documentService } = build({
      status: 'completed',
      result: { source_output: { status: 'id_not_found' } },
    });
    await service.processDocument('d1');
    expect(documentService.applyAutoVerification).not.toHaveBeenCalled();
    expect(documentService.recordAutoVerificationFailure).toHaveBeenCalled();
  });

  it('throws to retry while the task is in progress, without resubmitting', async () => {
    const { service, idfy } = build({ status: 'in_progress' }, { sourceReference: 'req-1' });
    await expect(service.processDocument('d1')).rejects.toThrow('still in progress');
    expect(idfy.submit).not.toHaveBeenCalled();
  });
});
