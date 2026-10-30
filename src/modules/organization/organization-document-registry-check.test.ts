import { describe, expect, it } from 'vitest';
import { govResultOf, registryCheckOf, verifiedByOf } from './organization-document-registry-check';

const gstFound = (gstinStatus: string, legalName = 'Sharma Logistics Private Limited') => ({
  status: 'id_found',
  gstin: '29ABCDE1234F1Z5',
  gstin_status: gstinStatus,
  legal_name: legalName,
});

function doc(overrides: Record<string, unknown> = {}) {
  return {
    documentType: 'gst_certificate' as const,
    documentNumber: '29ABCDE1234F1Z5',
    rawResponse: null,
    sourceReference: null,
    verificationStatus: 'pending' as const,
    updatedBy: 'user-1' as string | null,
    ...overrides,
  };
}

describe('registryCheckOf', () => {
  it('is null for documents the registry cannot check', () => {
    expect(registryCheckOf(doc({ documentType: 'shopboard_premises_photo' }), null)).toBeNull();
    expect(registryCheckOf(doc({ documentNumber: null }), null)).toBeNull();
  });

  it('separates never-submitted from waiting on IDfy', () => {
    expect(registryCheckOf(doc(), null)?.status).toBe('not_checked');
    expect(registryCheckOf(doc({ sourceReference: 'req-1' }), null)?.status).toBe('in_progress');
  });

  it('reads verified / inactive / not_found / failed from the stored response', () => {
    expect(registryCheckOf(doc({ rawResponse: gstFound('Active') }), null)?.status).toBe(
      'verified',
    );
    expect(registryCheckOf(doc({ rawResponse: gstFound('Cancelled') }), null)?.status).toBe(
      'inactive',
    );
    expect(registryCheckOf(doc({ rawResponse: { status: 'id_not_found' } }), null)?.status).toBe(
      'not_found',
    );
    expect(registryCheckOf(doc({ rawResponse: { idfyStatus: 'failed' } }), null)?.status).toBe(
      'failed',
    );
  });

  it('matches the legal name loosely', () => {
    const check = (orgName: string | null) =>
      registryCheckOf(doc({ rawResponse: gstFound('Active') }), orgName)?.nameMatches;
    expect(check('M/S SHARMA LOGISTICS PVT. LTD.')).toBe(true);
    expect(check('Verma Transport')).toBe(false);
    expect(check(null)).toBeNull();
  });
});

describe('verifiedByOf', () => {
  it('credits the registry only for a worker-verified document', () => {
    const auto = doc({
      verificationStatus: 'verified',
      updatedBy: null,
      rawResponse: gstFound('Active'),
    });
    expect(verifiedByOf(auto, registryCheckOf(auto, null))).toBe('registry');
    const manual = doc({ verificationStatus: 'verified', rawResponse: { status: 'id_not_found' } });
    expect(verifiedByOf(manual, registryCheckOf(manual, null))).toBe('reviewer');
    expect(verifiedByOf(doc(), registryCheckOf(doc(), null))).toBeNull();
  });
});

describe('govResultOf', () => {
  it('prefers GST over other checkable documents', () => {
    const result = govResultOf(
      [
        doc({ documentType: 'udyam', documentNumber: 'UDYAM-XX-00-0000000' }),
        doc({ rawResponse: gstFound('Active') }),
      ],
      null,
    );
    expect(result).toMatchObject({ documentType: 'gst_certificate', status: 'verified' });
  });

  it('is null when nothing can be checked', () => {
    expect(govResultOf([doc({ documentType: 'shopboard_premises_photo' })], null)).toBeNull();
  });
});
