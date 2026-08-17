import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { REFERRAL_CODE_REGEX } from './organization.constants';
import { ReferralCodeEntity } from './entities/referral-code.entity';
import { ReferralCodeRepository } from './referral-code.repository';

export type ReferralCodeStatus = 'active' | 'expired' | 'revoked';

// Subset of ReferralCodeStatus a caller can set directly via setStatus() — 'expired' stays
// derived-only (from validUntil), never something PATCH .../status accepts.
export const REFERRAL_CODE_SETTABLE_STATUSES = ['active', 'revoked'] as const;
export type ReferralCodeSettableStatus = (typeof REFERRAL_CODE_SETTABLE_STATUSES)[number];

/** Derives a code's current lifecycle state fresh on every read — unlike vehicle-document's
 *  `status` (recomputed only on write, so it can go stale between writes), a referral code can be
 *  redeemed on any calendar day, so this can't be a persisted, write-time-only column. */
export function resolveReferralCodeStatus(entity: {
  validUntil: string | null;
  revokedAt: Date | null;
}): ReferralCodeStatus {
  if (entity.revokedAt) return 'revoked';

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD — safe lexicographic compare against date-only columns
  if (entity.validUntil && today > entity.validUntil) return 'expired';
  return 'active';
}

export interface CreateReferralCodeData {
  code: string;
  ownerUserId: string | null;
  validUntil: string | null;
  createdBy: string | null;
}

export class ReferralCodeService {
  constructor(private readonly referralCodeRepository: ReferralCodeRepository) {}

  async createCode(input: CreateReferralCodeData): Promise<ReferralCodeEntity> {
    try {
      const code = this.normalizeCode(input.code);
      if (!REFERRAL_CODE_REGEX.test(code)) {
        throw new ValidationError(
          'Referral code must be 4-40 characters, using only A-Z, 0-9, - and _',
        );
      }
      const existing = await this.referralCodeRepository.findByCode(code);
      if (existing) {
        throw new ConflictError(`Referral code "${code}" already exists`);
      }

      return await this.referralCodeRepository.create({ ...input, code });
    } catch (error) {
      rethrow(error, 'Failed to create referral code');
    }
  }

  async getById(id: string): Promise<ReferralCodeEntity> {
    try {
      const referralCode = await this.referralCodeRepository.findById(id);
      if (!referralCode) throw new NotFoundError(`Referral code ${id} not found`);
      return referralCode;
    } catch (error) {
      rethrow(error, 'Failed to fetch referral code');
    }
  }

  async list(filters: { ownerUserId?: string; search?: string; page: number; limit: number }) {
    try {
      const { items, total } = await this.referralCodeRepository.list(filters);
      return { items: items.map((item) => this.withStatus(item)), total };
    } catch (error) {
      rethrow(error, 'Failed to list referral codes');
    }
  }

  // Batched for AuthService.listStaffUsers — one query for a whole page of staff, keyed by owner.
  async listByOwnerIds(
    ownerUserIds: string[],
  ): Promise<Map<string, Array<ReferralCodeEntity & { status: ReferralCodeStatus }>>> {
    try {
      const items = await this.referralCodeRepository.findByOwnerIds(ownerUserIds);
      const byOwner = new Map<string, Array<ReferralCodeEntity & { status: ReferralCodeStatus }>>();
      for (const item of items) {
        // findByOwnerIds only returns rows WHERE owner_user_id IN (:...ownerUserIds), so
        // item.ownerUserId can't actually be null here — guard exists to satisfy the nullable type.
        if (!item.ownerUserId) continue;
        const withStatus = this.withStatus(item);
        const forOwner = byOwner.get(item.ownerUserId) ?? [];
        forOwner.push(withStatus);
        byOwner.set(item.ownerUserId, forOwner);
      }
      return byOwner;
    } catch (error) {
      rethrow(error, 'Failed to list referral codes by owner');
    }
  }

  /** Sets the code active or revoked directly, idempotently — setting the state to what it's
   *  already in is not an error. Separate from update() below (owner/validity only) — see
   *  AdminService.setReferralCodeStatus, the dedicated PATCH .../status action this backs. */
  async setStatus(id: string, status: ReferralCodeSettableStatus): Promise<ReferralCodeEntity> {
    try {
      const updated = await this.referralCodeRepository.update(id, {
        revokedAt: status === 'revoked' ? new Date() : null,
      });
      if (!updated) throw new NotFoundError(`Referral code ${id} not found`);
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to update referral code status');
    }
  }

  /** Partial update — owner reassignment and/or validity window. `code` itself is deliberately
   *  not editable here (it's already been shared with prospects; changing it would silently break
   *  outstanding copies) — create a new code instead. Any field omitted from `data` keeps its
   *  current value. */
  async update(
    id: string,
    data: { ownerUserId?: string; validUntil?: string | null },
  ): Promise<ReferralCodeEntity> {
    try {
      const updated = await this.referralCodeRepository.update(id, data);
      if (!updated) throw new NotFoundError(`Referral code ${id} not found`);
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to update referral code');
    }
  }

  /** Hard delete. Callers (AdminService.deleteReferralCode) must confirm the code has never been
   *  redeemed before calling this — deleting one that has would silently orphan the organization's
   *  attribution (the FK is ON DELETE SET NULL). Revoke is the right tool once a code is in use. */
  async delete(id: string): Promise<void> {
    try {
      await this.getById(id);
      const deleted = await this.referralCodeRepository.deleteById(id);
      if (!deleted) throw new NotFoundError(`Referral code ${id} not found`);
    } catch (error) {
      rethrow(error, 'Failed to delete referral code');
    }
  }

  /** Redemption entry point — used by AuthService.createOrganization at signup. Resolves a
   *  raw, user-supplied code string to its entity, or throws if it doesn't exist or isn't
   *  currently usable (expired/revoked both reject, with a status-specific message). */
  async validateAndResolve(rawCode: string): Promise<ReferralCodeEntity> {
    try {
      const code = this.normalizeCode(rawCode);
      const referralCode = await this.referralCodeRepository.findByCode(code);
      if (!referralCode) {
        throw new ValidationError('Invalid referral code');
      }

      const status = resolveReferralCodeStatus(referralCode);
      if (status !== 'active') {
        throw new ValidationError(`Referral code is ${status}`);
      }

      return referralCode;
    } catch (error) {
      rethrow(error, 'Failed to validate referral code');
    }
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private withStatus(
    entity: ReferralCodeEntity,
  ): ReferralCodeEntity & { status: ReferralCodeStatus } {
    return { ...entity, status: resolveReferralCodeStatus(entity) };
  }
}
