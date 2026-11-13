import { describe, expect, it } from 'vitest';
import { driverPayForViewer, withoutDriverPay } from './driver.service';
import { ROLES } from '../../db/role-catalog';

const row = {
  id: 'drv-1',
  fullName: 'Ravi Kumar',
  salaryType: 'fixed',
  salaryAmount: '22000.00',
  bhattaPerDay: '400.00',
  advanceOutstanding: '5000.00',
  contact: {
    primaryMobile: '9999999999',
    advanceOutstanding: '5000.00',
    compensation: { salaryType: 'fixed', salaryAmount: '22000.00' },
  },
};

const viewer = (name: string) => {
  const role = ROLES.find((r) => r.name === name)!;
  return { role: role.name, permissions: role.permissionKeys };
};

const PAY_KEYS = ['salaryType', 'salaryAmount', 'bhattaPerDay', 'advanceOutstanding'];

describe('withoutDriverPay', () => {
  it('drops the profile pay columns and the contact pay section, keeping the rest', () => {
    const stripped = withoutDriverPay(row) as Record<string, unknown>;
    for (const key of PAY_KEYS) expect(stripped).not.toHaveProperty(key);
    expect(stripped.fullName).toBe('Ravi Kumar');
    expect(stripped.contact).toEqual({ primaryMobile: '9999999999' });
  });

  it('does not mutate the original row', () => {
    withoutDriverPay(row);
    expect(row.salaryAmount).toBe('22000.00');
    expect(row.contact.compensation).toBeDefined();
  });
});

describe('driverPayForViewer', () => {
  it.each(['org_admin', 'finance_accounts', 'dispatch'])('%s sees pay', (name) => {
    expect(driverPayForViewer(row, viewer(name))).toBe(row);
  });

  it.each(['sales_cs', 'documents_ops'])('%s does not see pay', (name) => {
    const view = driverPayForViewer(row, viewer(name)) as Record<string, unknown>;
    for (const key of PAY_KEYS) expect(view).not.toHaveProperty(key);
  });
});
