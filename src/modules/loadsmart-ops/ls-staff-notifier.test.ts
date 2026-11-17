import { describe, expect, it, vi } from 'vitest';
import { LsStaffNotifier } from './ls-staff-notifier';

function setup(staff: { id: string }[], saveFails = false) {
  const saved: Record<string, unknown>[] = [];
  const repository = {
    listStaffWithPermission: vi.fn().mockResolvedValue(staff),
    staffNotifications: {
      create: (row: Record<string, unknown>) => row,
      save: vi.fn(async (rows: Record<string, unknown>[]) => {
        if (saveFails) throw new Error('db down');
        saved.push(...rows);
        return rows;
      }),
    },
  };
  return { notifier: new LsStaffNotifier(repository as never), repository, saved };
}

const notice = { type: 'partner_advance.raised', title: 'Raised', body: 'Body', loadId: 'load-1' };

describe('LsStaffNotifier', () => {
  it('notifies every holder once and leaves out the member who acted', async () => {
    const { notifier, repository, saved } = setup([{ id: 'a' }, { id: 'b' }, { id: 'a' }]);
    const count = await notifier.notifyPermission(
      ['loadsmart.payables', 'loadsmart.money.approve'],
      notice,
      'b',
    );
    expect(repository.listStaffWithPermission).toHaveBeenCalledWith([
      'loadsmart.payables',
      'loadsmart.money.approve',
    ]);
    expect(count).toBe(1);
    expect(saved).toEqual([
      expect.objectContaining({
        recipientUserId: 'a',
        type: 'partner_advance.raised',
        loadId: 'load-1',
      }),
    ]);
  });

  it('skips empty and missing recipients', async () => {
    const { notifier, repository } = setup([]);
    expect(await notifier.notifyUsers([null, undefined], notice)).toBe(0);
    expect(repository.staffNotifications.save).not.toHaveBeenCalled();
  });

  it('never throws when saving fails, so a notice cannot undo a money step', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { notifier } = setup([{ id: 'a' }], true);
    await expect(notifier.notifyPermission(['loadsmart.payables'], notice)).resolves.toBe(0);
    warn.mockRestore();
  });
});
