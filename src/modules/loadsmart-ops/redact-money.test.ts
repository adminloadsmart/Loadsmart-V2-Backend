import { describe, expect, it } from 'vitest';
import { redactMoney } from './redact-money';

const detail = {
  sourcing: {
    shipperPrice: '50000',
    partnerRate: '40000',
    partnerTargetRate: '39000',
    driverName: 'Ravi',
    partner: {
      name: 'ABC Logistics',
      bankAccountNumber: '123',
      bankIfsc: 'HDFC0001',
      upiId: 'a@b',
    },
  },
  partnerBids: [{ rate: '40000' }],
  partnerPayments: [{ utrReference: 'UTR1' }],
  invoice: { number: 'INV-1' },
  charges: [{ amount: '500' }],
};

describe('redactMoney', () => {
  it('Tracking sees carrier money only: no shipper price or invoice, so no margin', () => {
    const out = redactMoney(detail, { shipper: false, carrier: true }) as typeof detail;
    expect(out.sourcing).not.toHaveProperty('shipperPrice');
    expect(out).not.toHaveProperty('invoice');
    expect(out.sourcing.partnerRate).toBe('40000');
    expect(out.partnerPayments).toHaveLength(1);
    expect(out.sourcing.partner.bankIfsc).toBe('HDFC0001');
  });

  it('a team with no money (CS) loses both sides, bank details and payments included', () => {
    const out = redactMoney(detail, { shipper: false, carrier: false }) as typeof detail;
    expect(out).not.toHaveProperty('partnerPayments');
    expect(out).not.toHaveProperty('partnerBids');
    expect(out).not.toHaveProperty('invoice');
    expect(out.sourcing).not.toHaveProperty('partnerRate');
    expect(out.sourcing).not.toHaveProperty('shipperPrice');
    expect(out.sourcing.partner).toEqual({ name: 'ABC Logistics' });
    expect(out.sourcing.driverName).toBe('Ravi');
  });

  it('leaves everything for a team that sees both sides', () => {
    expect(redactMoney(detail, { shipper: true, carrier: true })).toBe(detail);
  });
});
