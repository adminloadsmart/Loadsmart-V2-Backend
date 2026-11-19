import { describe, expect, it } from 'vitest';
import { shipperActionFor, ShipperActionInput } from './shipper-action';

const load = (over: Partial<ShipperActionInput> = {}): ShipperActionInput => ({
  status: 'reached_unloading',
  route: 'loadsmart',
  awardedParty: 'loadsmart',
  awardedBidId: 'bid-1',
  memoAcceptedAt: new Date(),
  invoiceNumber: 'INV-1',
  invoiceFileKey: 'k-inv',
  ewayBillNumber: 'EWB-1',
  ewayBillFileKey: 'k-eway',
  elrFileKey: 'k-lr',
  podFileKey: 'k-pod',
  podBackFileKey: 'k-pod-back',
  podStatus: 'pending',
  transporterInvoiceFileKey: null,
  advancePercentage: '80',
  advancePaidAt: null,
  balancePaidAt: null,
  deliveryIssueSettledAt: null,
  pendingCharges: { count: 0, total: 0 },
  invoiceOpen: null,
  paymentPendingMatch: false,
  memoWaiting: false,
  ...over,
});

describe('shipperActionFor — after the POD', () => {
  it('tells the shipper on a Loadsmart load that Loadsmart is checking the POD', () => {
    const action = shipperActionFor(load());
    expect(action.kind).toBe('none');
    expect(action.reason).toMatch(/checking the POD/);
  });

  it('asks the shipper to review a driver’s POD on their own routes', () => {
    expect(shipperActionFor(load({ route: 'own_fleet' })).kind).toBe('review_pod');
  });

  it('asks for the POD again once it was rejected', () => {
    expect(shipperActionFor(load({ route: 'own_fleet', podStatus: 'rejected' })).kind).toBe(
      'upload_pod',
    );
  });

  it('says Loadsmart is preparing its invoice once the load is delivered', () => {
    const action = shipperActionFor(load({ status: 'delivered_ok', podStatus: 'accepted' }));
    expect(action.kind).toBe('none');
    expect(action.reason).toMatch(/invoice/);
  });
});
