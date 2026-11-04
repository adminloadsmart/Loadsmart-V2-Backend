import { describe, expect, it, vi } from 'vitest';
import { ReferralCodeService } from './referral-code.service';

function build(takenCodes: string[] = []) {
  const repo = {
    findByCode: vi.fn(async (code: string) => (takenCodes.includes(code) ? { code } : null)),
    create: vi.fn(async (data: Record<string, unknown>) => ({ id: 'rc-1', ...data })),
  };
  return { service: new ReferralCodeService(repo as never), repo };
}

describe('createForSalesperson', () => {
  it('builds FIRSTNAME-<territory initial><2 digits> for the new owner', async () => {
    const { service, repo } = build();
    const code = await service.createForSalesperson(
      { id: 'u1', fullName: "Ravi D'Souza", coverage: 'Maharashtra, Mumbai' },
      'admin-1',
    );
    expect(code.code).toMatch(/^RAVI-M\d{2}$/);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: 'u1', validUntil: null, createdBy: 'admin-1' }),
    );
  });

  it('falls back to REF / X when the name or territory has no letters', async () => {
    const { service } = build();
    const code = await service.createForSalesperson(
      { id: 'u1', fullName: '', coverage: null },
      null,
    );
    expect(code.code).toMatch(/^REF-X\d{2}$/);
  });

  it('gives up after a few taken suffixes', async () => {
    const taken = Array.from({ length: 90 }, (_, i) => `RAVI-M${10 + i}`);
    const { service } = build(taken);
    await expect(
      service.createForSalesperson({ id: 'u1', fullName: 'Ravi', coverage: 'Mumbai' }, null),
    ).rejects.toThrow(/free referral code/);
  });
});
