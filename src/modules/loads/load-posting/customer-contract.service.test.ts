import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../audit/audit.service';
import type { LoadPostingRepository } from './load-posting.repository';
import { CustomerContractService } from './customer-contract.service';

const contract = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  transporterId: 't1',
  transporter: { name: 'Anantra', code: 'TRP-1003', status: 'active' },
  sourceCity: 'Zirakpur',
  sourceState: 'Punjab',
  destinationCity: 'Sahibzada Ajit Singh Nagar',
  destinationState: 'Punjab',
  agreedRate: '15000.00',
  billingUnit: 'per_truck',
  priority: 1,
  sharePercentage: null,
  validFrom: '2026-11-01',
  validTo: '2027-03-31',
  ...overrides,
});

const query = {
  pickupCity: 'Zirakpur',
  pickupState: 'Punjab',
  dropCity: 'Sahibzada Ajit Singh Nagar',
  dropState: 'Punjab',
};

function build(rows: unknown[]) {
  const findMasterContractsOnLane = vi.fn().mockResolvedValue(rows);
  const repository = { findMasterContractsOnLane } as unknown as LoadPostingRepository;
  const service = new CustomerContractService(repository, {} as AuditService);
  return { service, findMasterContractsOnLane };
}

describe('CustomerContractService.list (Indent picker)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 20 Nov 2026 02:00 IST — still 19 Nov in UTC.
    vi.setSystemTime(new Date('2026-11-19T20:30:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('queries Masters → Contracts by the full lane corridor (city + state both ends)', async () => {
    const { service, findMasterContractsOnLane } = build([]);
    await service.list('tenant', query);
    expect(findMasterContractsOnLane).toHaveBeenCalledWith('tenant', {
      sourceCity: 'Zirakpur',
      sourceState: 'Punjab',
      destinationCity: 'Sahibzada Ajit Singh Nagar',
      destinationState: 'Punjab',
    });
  });

  it('marks a contract valid today with an active transporter selectable', async () => {
    const { service } = build([contract()]);
    const [row] = await service.list('tenant', query);
    expect(row).toMatchObject({
      transporterId: 't1',
      transporterName: 'Anantra',
      pickupCity: 'Zirakpur',
      dropState: 'Punjab',
      rate: '15000.00',
      billingUnit: 'per_truck',
      selectable: true,
      reason: null,
    });
  });

  it('returns expired and not-started contracts disabled', async () => {
    const { service } = build([
      contract({ validTo: '2026-11-19' }),
      contract({ validFrom: '2026-12-01' }),
    ]);
    const rows = await service.list('tenant', query);
    expect(rows.map((r) => [r.selectable, r.reason])).toEqual([
      [false, 'expired_or_not_started'],
      [false, 'expired_or_not_started'],
    ]);
  });

  it('uses the IST date: a contract starting today (IST) is selectable before 05:30', async () => {
    const { service } = build([contract({ validFrom: '2026-11-20' })]);
    const [row] = await service.list('tenant', query);
    expect(row.selectable).toBe(true);
  });

  it('flags an inactive transporter with a reason', async () => {
    const { service } = build([
      contract({ transporter: { name: 'X', code: 'T', status: 'inactive' } }),
    ]);
    const [row] = await service.list('tenant', query);
    expect(row).toMatchObject({ selectable: false, reason: 'transporter_inactive' });
  });
});
