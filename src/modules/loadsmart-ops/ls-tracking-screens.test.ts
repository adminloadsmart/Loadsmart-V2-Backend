import { describe, expect, it, vi } from 'vitest';
import { LsCallLogService } from './ls-call-log.service';
import { LsSettlementService } from './ls-settlement.service';
import { LsTrackingService } from './ls-tracking.service';
import { etaPastExpiry } from './ls-console.service';

const LOAD_ID = '00000000-0000-4000-8000-000000000001';
const TENANT = '00000000-0000-4000-8000-0000000000aa';
const NOW = new Date('2026-11-17T10:00:00Z');
const actor = { id: 'tracking-1', role: 'ls_tracking' };

const sourcing = (status = 'reached_loading') => ({
  id: 's-1',
  tenantId: TENANT,
  loadId: LOAD_ID,
  status: 'won',
  trackingOwnerId: null,
  load: {
    id: LOAD_ID,
    code: 'LD-1',
    route: 'loadsmart',
    awardedParty: 'loadsmart',
    status,
    plannedCapacityTonnes: '20',
  },
});

describe('call log', () => {
  function setup(position: Record<string, unknown> | null) {
    const saved: Record<string, unknown>[] = [];
    const repository = {
      findSourcingByLoad: vi.fn().mockResolvedValue(sourcing()),
      callLogs: {
        create: (row: Record<string, unknown>) => row,
        save: vi.fn(async (row: Record<string, unknown>) => {
          saved.push(row);
          return row;
        }),
      },
    };
    const tracking = { getTrip: vi.fn().mockResolvedValue({ eta: null, position }) };
    const service = new LsCallLogService(
      repository as never,
      {} as never,
      {} as never,
      tracking as never,
      () => NOW,
    );
    return { service, saved };
  }

  it('takes the location Tracking typed, as given', async () => {
    const { service, saved } = setup(null);
    await service.logCall('t-1', LOAD_ID, {
      contact: 'driver',
      outcome: 'connected',
      locationLabel: 'Near Nashik toll',
      etaAt: new Date('2026-11-17T14:00:00Z'),
    });
    expect(saved[0]).toMatchObject({
      locationLabel: 'Near Nashik toll',
      locationSource: 'call',
      etaTarget: 'loading',
    });
  });

  it('fills the location from SIM/GPS tracking when the caller gives none and the fix is fresh', async () => {
    const { service, saved } = setup({
      lat: 19.99,
      lng: 73.78,
      placeName: 'Nashik',
      recordedAt: new Date(NOW.getTime() - 5 * 60_000),
    });
    await service.logCall('t-1', LOAD_ID, { contact: 'driver', outcome: 'connected' });
    expect(saved[0]).toMatchObject({ locationSource: 'tracking', locationLabel: 'Nashik' });
  });

  it('ignores a stale fix', async () => {
    const { service, saved } = setup({
      lat: 1,
      lng: 2,
      placeName: 'Old',
      recordedAt: new Date(NOW.getTime() - 3 * 3_600_000),
    });
    await service.logCall('t-1', LOAD_ID, { contact: 'driver', outcome: 'no_answer' });
    expect(saved[0]).toMatchObject({ locationSource: null, latitude: null });
  });
});

describe('claiming a load', () => {
  function tracking(affected: number, ownerId: string | null = 'someone-else') {
    const repository = {
      findSourcingByLoad: vi.fn().mockResolvedValue({ ...sourcing(), trackingOwnerId: ownerId }),
      sourcings: { update: vi.fn().mockResolvedValue({ affected }) },
    };
    const service = new LsTrackingService(
      repository as never,
      { record: vi.fn() } as never,
      { log: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      { notifyUsers: vi.fn(), notifyPermission: vi.fn() } as never,
      {} as never,
    );
    return { service, repository };
  }

  it('takes an unowned load', async () => {
    const { service, repository } = tracking(1, null);
    repository.findSourcingByLoad.mockResolvedValue(sourcing());
    await service.claimLoad('tracking-1', LOAD_ID);
    expect(repository.sourcings.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-1' }),
      expect.objectContaining({ trackingOwnerId: 'tracking-1' }),
    );
  });

  it('refuses a load another member already runs', async () => {
    const { service } = tracking(0);
    await expect(service.claimLoad('tracking-1', LOAD_ID)).rejects.toThrow(/already runs/);
  });
});

describe('papers and POD from the console', () => {
  function settlement(current: Record<string, unknown>[], status = 'reached_loading') {
    const documents = {
      list: vi.fn().mockResolvedValue(current),
      review: vi.fn().mockResolvedValue({}),
    };
    const loadService = {
      saveConsoleDocuments: vi.fn().mockResolvedValue({}),
      uploadPod: vi.fn().mockResolvedValue({}),
      reviewPod: vi.fn().mockResolvedValue({ status: 'delivered_with_issues' }),
    };
    const storage = { attachStaffUpload: vi.fn() };
    const repository = { findSourcingByLoad: vi.fn().mockResolvedValue(sourcing(status)) };
    const service = new LsSettlementService(
      repository as never,
      { record: vi.fn() } as never,
      { log: vi.fn() } as never,
      { findById: vi.fn().mockResolvedValue(null) } as never,
      loadService as never,
      {} as never,
      documents as never,
      storage as never,
    );
    return { service, documents, loadService, storage };
  }

  it('never replaces a copy the shipper already uploaded — Tracking reviews it instead', async () => {
    const { service, loadService } = settlement([
      { id: 'd-1', docType: 'invoice', current: true, source: 'web', reviewStatus: 'pending' },
    ]);
    await expect(
      service.uploadPapers(actor, LOAD_ID, { invoiceNumber: 'I-1', invoiceFileKey: 'k1' }),
    ).rejects.toThrow(/review that copy instead/);
    expect(loadService.saveConsoleDocuments).not.toHaveBeenCalled();
  });

  it('attaches the paper and approves its own copy at once', async () => {
    const { service, documents, loadService, storage } = settlement([]);
    documents.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'd-9',
          docType: 'eway_bill',
          current: true,
          source: 'console',
          reviewStatus: 'pending',
        },
      ])
      .mockResolvedValue([]);
    await service.uploadPapers(actor, LOAD_ID, {
      ewayBillNumber: 'E-1',
      ewayBillFileKey: 'k2',
      ewayBillExpiresAt: new Date('2026-11-19T00:00:00Z'),
    });
    expect(storage.attachStaffUpload).toHaveBeenCalledWith(
      'tracking-1',
      'k2',
      'loads/eway-bill',
      TENANT,
    );
    expect(loadService.saveConsoleDocuments).toHaveBeenCalled();
    expect(documents.review).toHaveBeenCalledWith(
      TENANT,
      'tracking-1',
      'ls_tracking',
      LOAD_ID,
      'd-9',
      'approved',
      undefined,
      'ls_team',
    );
  });

  it('records a POD with issues, then accepts it itself — no approval step', async () => {
    const { service, loadService } = settlement([], 'reached_unloading');
    await service.uploadPod(actor, LOAD_ID, {
      podFileKey: 'front',
      podBackFileKey: 'back',
      outcome: 'delivered_with_issues',
      issueType: 'pilferage',
      remark: 'Seal broken, 3 bags missing',
    });
    expect(loadService.uploadPod).toHaveBeenCalledWith(
      TENANT,
      'tracking-1',
      'ls_tracking',
      LOAD_ID,
      expect.objectContaining({
        podFileKey: 'front',
        shortageOrDamage: 'pilferage',
        podQuantityReceived: 20,
      }),
      undefined,
      true,
    );
    expect(loadService.reviewPod).toHaveBeenCalledWith(
      TENANT,
      'tracking-1',
      LOAD_ID,
      {
        decision: 'accepted',
        shortageOrDamage: 'pilferage',
        issueDetails: 'Seal broken, 3 bags missing',
      },
      'ls_team',
    );
  });

  it('wants an issue type and remark with "delivered with issues"', async () => {
    const { service, loadService } = settlement([], 'reached_unloading');
    await expect(
      service.uploadPod(actor, LOAD_ID, { podFileKey: 'f', outcome: 'delivered_with_issues' }),
    ).rejects.toThrow(/issue type and a remark/);
    expect(loadService.uploadPod).not.toHaveBeenCalled();
  });
});

describe('e-way bill expiry', () => {
  it('is at risk only when the ETA is after the expiry', () => {
    const expiry = new Date('2026-11-18T00:00:00Z');
    expect(etaPastExpiry(expiry, new Date('2026-11-18T06:00:00Z'))).toBe(true);
    expect(etaPastExpiry(expiry, new Date('2026-11-17T20:00:00Z'))).toBe(false);
    expect(etaPastExpiry(null, new Date())).toBe(false);
    expect(etaPastExpiry(expiry, null)).toBe(false);
  });
});
