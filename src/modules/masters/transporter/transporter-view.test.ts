import { describe, expect, it } from 'vitest';
import { toTransporterView, withoutTransporterBank } from './transporter.service';
import type { TransporterEntity } from './entities/transporter.entity';
import { MASTERS_WRITE, PAYMENTS_MANAGE } from '../../../shared/constants/permissions';

const transporter = {
  id: 'tr-1',
  name: 'Acme Logistics',
  gstVerificationStatus: 'verified',
  bankAccountNumber: '123456789012',
  bankIfsc: 'HDFC0001234',
  bankAccountHolderName: 'Acme Logistics',
  bankNameBranch: 'HDFC, Andheri',
  bankNameAtBank: 'ACME LOGISTICS',
  bankVerificationStatus: 'verified',
  bankVerifiedAt: new Date('2026-11-01T00:00:00Z'),
  bankVerificationReference: 'idfy-ref-1',
  bankRawResponse: { status: 'id_found' },
} as unknown as TransporterEntity;

const finance = { role: 'finance_accounts', permissions: [PAYMENTS_MANAGE] };
const dispatch = { role: 'dispatch', permissions: [MASTERS_WRITE] };

describe('toTransporterView', () => {
  it('never returns the raw IDfy response or its reference', () => {
    for (const viewer of [finance, dispatch]) {
      const view = toTransporterView(transporter, undefined, viewer) as Record<string, unknown>;
      expect(view).not.toHaveProperty('bankRawResponse');
      expect(view).not.toHaveProperty('bankVerificationReference');
    }
  });

  it('shows the bank account to whoever pays transporters', () => {
    const view = toTransporterView(transporter, undefined, finance);
    expect(view.bankAccountNumber).toBe('123456789012');
    expect(view.bankIfsc).toBe('HDFC0001234');
  });

  it('shows freight owed only to whoever pays transporters', () => {
    const stats = { tripsDone: 4, freightOwed: '125000.00' };
    expect(toTransporterView(transporter, stats, finance).freightOwed).toBe('125000.00');
    const hidden = toTransporterView(transporter, stats, dispatch) as Record<string, unknown>;
    expect(hidden).not.toHaveProperty('freightOwed');
    expect(hidden.tripsDone).toBe(4);
  });

  it('strips bank data from a transporter embedded elsewhere, whoever is looking', () => {
    const embedded = withoutTransporterBank(transporter) as Record<string, unknown>;
    expect(embedded).not.toHaveProperty('bankAccountNumber');
    expect(embedded).not.toHaveProperty('bankRawResponse');
    expect(embedded.name).toBe('Acme Logistics');
  });

  it('hides the bank account from everyone else but keeps the verified badge', () => {
    const view = toTransporterView(transporter, undefined, dispatch) as Record<string, unknown>;
    for (const field of [
      'bankAccountNumber',
      'bankIfsc',
      'bankAccountHolderName',
      'bankNameBranch',
      'bankNameAtBank',
    ]) {
      expect(view).not.toHaveProperty(field);
    }
    expect(view.bankVerificationStatus).toBe('verified');
    expect(view.name).toBe('Acme Logistics');
  });
});
