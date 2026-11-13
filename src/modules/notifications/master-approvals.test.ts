import { describe, expect, it, vi } from 'vitest';
import { countPendingApprovals } from './master-approvals';
import type { ScheduledAlertRepository } from './scheduled-alert.repository';
import { CUSTOMERS_APPROVE, MASTERS_APPROVE } from '../../shared/constants/permissions';

function repoWithOnePendingOfEachKind() {
  const countPendingMasters = vi.fn(async () => 1);
  return {
    repo: { countPendingMasters } as unknown as ScheduledAlertRepository,
    countPendingMasters,
  };
}

describe('countPendingApprovals', () => {
  it('counts customers for anyone holding customers.approve — no org_admin role required', async () => {
    const { repo, countPendingMasters } = repoWithOnePendingOfEachKind();

    const count = await countPendingApprovals(repo, 'tenant-1', [CUSTOMERS_APPROVE]);

    expect(count).toBe(1);
    expect(countPendingMasters).toHaveBeenCalledWith('tenant-1', 'customer');
  });

  it('counts only the master kinds for masters.approve', async () => {
    const { repo, countPendingMasters } = repoWithOnePendingOfEachKind();

    await countPendingApprovals(repo, 'tenant-1', [MASTERS_APPROVE]);

    const kinds = countPendingMasters.mock.calls.map((call) => (call as unknown[])[1]);
    expect(kinds).not.toContain('customer');
    expect(kinds.length).toBeGreaterThan(0);
  });

  it('counts nothing without an approve permission', async () => {
    const { repo, countPendingMasters } = repoWithOnePendingOfEachKind();

    expect(await countPendingApprovals(repo, 'tenant-1', [])).toBe(0);
    expect(countPendingMasters).not.toHaveBeenCalled();
  });
});
