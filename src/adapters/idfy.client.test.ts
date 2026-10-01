import { describe, expect, it, vi } from 'vitest';
import { IdfyClient } from './idfy.client';

function build(getTask: unknown[], configured = true) {
  const client = new IdfyClient();
  vi.spyOn(client, 'isConfigured').mockReturnValue(configured);
  const submit = vi.spyOn(client, 'submit').mockResolvedValue('req-1');
  const getTaskMock = vi.spyOn(client, 'getTask');
  for (const value of getTask) getTaskMock.mockResolvedValueOnce(value as never);
  return { client, idfy: { submit } };
}

describe('IdfyClient.verifyBankAccount', () => {
  it('returns verified with the bank-side name and submits penny-less first', async () => {
    const { client, idfy } = build([
      {
        status: 'completed',
        result: { source_output: { account_exists: 'YES', name_at_bank: 'A B' } },
      },
    ]);
    const result = await client.verifyBankAccount('1234123412341234', 'HDFC0001234');
    expect(idfy.submit).toHaveBeenCalledWith('validate_bank_account', {
      bank_account_no: '1234123412341234',
      bank_ifsc_code: 'HDFC0001234',
      nf_verification: true,
    });
    expect(result).toMatchObject({
      verificationStatus: 'verified',
      nameAtBank: 'A B',
      sourceReference: 'req-1',
    });
  });

  it('returns rejected when the account does not exist', async () => {
    const { client } = build([
      { status: 'completed', result: { source_output: { account_exists: 'NO' } } },
    ]);
    expect((await client.verifyBankAccount('1', 'X')).verificationStatus).toBe('rejected');
  });

  it('returns pending (no verdict) for a failed task, unconfigured IDfy and errors', async () => {
    const failed = build([{ status: 'failed' }]);
    expect((await failed.client.verifyBankAccount('1', 'X')).verificationStatus).toBe('pending');

    const off = build([], false);
    expect((await off.client.verifyBankAccount('1', 'X')).verificationStatus).toBe('pending');
    expect(off.idfy.submit).not.toHaveBeenCalled();

    const broken = build([]);
    broken.idfy.submit.mockRejectedValue(new Error('boom'));
    expect((await broken.client.verifyBankAccount('1', 'X')).verificationStatus).toBe('pending');
  });
});
