import { describe, expect, it, vi } from 'vitest';
import { LsTrackingService } from './ls-tracking.service';

const LOAD_ID = '00000000-0000-4000-8000-000000000001';
const TENANT = '00000000-0000-4000-8000-0000000000aa';

type Charge = Record<string, unknown>;

function setup(options: { preapproved?: boolean; charge?: Charge } = {}) {
  const sourcing = {
    id: 's-1',
    tenantId: TENANT,
    loadId: LOAD_ID,
    status: 'won',
    load: {
      id: LOAD_ID,
      code: 'LD-1',
      route: 'loadsmart',
      awardedParty: 'loadsmart',
      status: 'reached_loading',
    },
  };
  const saved: Charge[] = [];
  const repository = {
    findSourcingByLoad: vi.fn().mockResolvedValue(sourcing),
    terms: {
      findOneBy: vi.fn().mockResolvedValue({
        preapprovedCharges: options.preapproved ? [{ head: 'loading', maxAmount: null }] : [],
      }),
    },
    charges: {
      create: (row: Charge) => row,
      save: vi.fn(async (row: Charge) => {
        saved.push(row);
        return { id: 'c-1', loadId: LOAD_ID, ...row };
      }),
      findOneBy: vi.fn().mockResolvedValue(options.charge ?? null),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    },
  };
  const notifier = { notifyPermission: vi.fn(), notifyUsers: vi.fn() };
  const service = new LsTrackingService(
    repository as never,
    { record: vi.fn() } as never,
    { log: vi.fn() } as never,
    { attachStaffUpload: vi.fn() } as never,
    { save: vi.fn() } as never,
    {} as never,
    notifier as never,
    {} as never,
  );
  return { service, repository, notifier, saved };
}

const actor = { id: 'tracking-1', role: 'ls_tracking' };

describe('Loadsmart charges: shipper first, then Super Admin', () => {
  it('raises a charge with no proof file, waiting for the shipper', async () => {
    const { service, saved, notifier } = setup();
    await service.raiseCharge(actor, LOAD_ID, { head: 'loading', amount: 500 });
    expect(saved[0]).toMatchObject({ status: 'raised', proofFileKey: null, preapproved: false });
    expect(notifier.notifyPermission).not.toHaveBeenCalled();
  });

  it('a pre-approved head skips the shipper but still goes to Super Admin', async () => {
    const { service, saved, notifier } = setup({ preapproved: true });
    await service.raiseCharge(actor, LOAD_ID, { head: 'loading', amount: 500 });
    expect(saved[0]).toMatchObject({ status: 'pending_admin', preapproved: true });
    expect(notifier.notifyPermission).toHaveBeenCalledWith(
      ['loadsmart.money.approve'],
      expect.objectContaining({ type: 'charge.pending_admin' }),
      'tracking-1',
    );
  });

  it('Super Admin approves a charge the shipper cleared, and the raiser is told', async () => {
    const { service, repository, notifier } = setup({
      charge: {
        id: 'c-1',
        status: 'pending_admin',
        chargeType: 'loading',
        amount: '500',
        raisedBy: 'tracking-1',
      },
    });
    repository.charges.findOneBy.mockResolvedValueOnce({
      id: 'c-1',
      status: 'pending_admin',
      chargeType: 'loading',
      amount: '500',
      raisedBy: 'tracking-1',
    });
    await service.decideChargeAsAdmin('admin-1', LOAD_ID, 'c-1', { decision: 'approved' });
    expect(repository.charges.update).toHaveBeenCalledWith(
      { id: 'c-1', status: 'pending_admin' },
      expect.objectContaining({ status: 'approved', adminDecidedBy: 'admin-1' }),
    );
    expect(notifier.notifyUsers).toHaveBeenCalledWith(
      ['tracking-1'],
      expect.objectContaining({ type: 'charge.approved' }),
    );
  });

  it('refuses a charge the shipper has not approved, and a rejection with no reason', async () => {
    const raised = setup({
      charge: { id: 'c-1', status: 'raised', chargeType: 'loading', amount: '500' },
    });
    await expect(
      raised.service.decideChargeAsAdmin('admin-1', LOAD_ID, 'c-1', { decision: 'approved' }),
    ).rejects.toThrow(/shipper has not approved/);

    const pending = setup({
      charge: { id: 'c-1', status: 'pending_admin', chargeType: 'loading', amount: '500' },
    });
    await expect(
      pending.service.decideChargeAsAdmin('admin-1', LOAD_ID, 'c-1', { decision: 'rejected' }),
    ).rejects.toThrow(/reason/);
  });
});
