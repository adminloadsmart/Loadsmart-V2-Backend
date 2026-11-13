import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { hasPermission, requirePermission } from './require-permission.middleware';
import { AuthorizationError } from '../errors';
import { MASTERS_APPROVE, MASTERS_WRITE } from '../constants/permissions';

const dispatch = { role: 'dispatch', permissions: [MASTERS_WRITE] };

describe('hasPermission', () => {
  it('reads the permission bundle, not the role name', () => {
    expect(hasPermission(dispatch, MASTERS_WRITE)).toBe(true);
    expect(hasPermission(dispatch, MASTERS_APPROVE)).toBe(false);
  });

  it('honours a direct grant on a non-admin role', () => {
    expect(
      hasPermission(
        { role: 'dispatch', permissions: [MASTERS_WRITE, MASTERS_APPROVE] },
        MASTERS_APPROVE,
      ),
    ).toBe(true);
  });

  it('does not treat org_admin specially — only what its seed bundle holds counts', () => {
    expect(hasPermission({ role: 'org_admin', permissions: [] }, MASTERS_APPROVE)).toBe(false);
  });

  it('lets platform_admin through every check', () => {
    expect(hasPermission({ role: 'platform_admin', permissions: [] }, MASTERS_APPROVE)).toBe(true);
  });

  it('is false with no user', () => {
    expect(hasPermission(undefined, MASTERS_WRITE)).toBe(false);
  });
});

describe('requirePermission', () => {
  const run = (user: Request['user'], ...keys: string[]) => {
    const next = vi.fn();
    requirePermission(...keys)({ user } as Request, {} as Response, next);
    return next;
  };

  it('passes when the caller holds any of the listed keys', () => {
    expect(run(dispatch as Request['user'], MASTERS_APPROVE, MASTERS_WRITE)).toHaveBeenCalled();
  });

  it('throws when the caller holds none of them', () => {
    expect(() => run(dispatch as Request['user'], MASTERS_APPROVE)).toThrow(AuthorizationError);
  });
});
