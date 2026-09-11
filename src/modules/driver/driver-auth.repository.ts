import { DataSource, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { DriverSessionEntity } from './entities/driver-session.entity';
import { DriverDevicePlatform } from './driver-auth.types';

// The driver-identity counterpart to modules/auth/auth.repository.ts's refresh-token methods —
// same shapes/race-closing patterns, operating on masters.driver_sessions instead of
// auth.refresh_tokens. See docs/driver-auth.md.
export class DriverSessionRepository {
  private readonly sessions: Repository<DriverSessionEntity>;

  constructor(dataSource: DataSource) {
    this.sessions = dataSource.getRepository(DriverSessionEntity);
  }

  async createSession(data: {
    driverId: string;
    tokenHash: string;
    expiresAt: Date;
    fcmToken?: string | null;
    deviceType?: DriverDevicePlatform | null;
    deviceInfo?: string | null;
    ipAddress?: string | null;
  }): Promise<DriverSessionEntity> {
    const session = this.sessions.create({ ...data, revokedAt: null, lastSeen: new Date() });
    return this.sessions.save(session);
  }

  // Atomically finds-and-revokes in one UPDATE, same race-closing shape as
  // AuthRepository.claimRefreshToken — only the request whose UPDATE actually matched a
  // still-active row (affected === 1) wins the claim.
  async claimRefreshToken(tokenHash: string): Promise<DriverSessionEntity | null> {
    const result = await this.sessions
      .createQueryBuilder()
      .update(DriverSessionEntity)
      .set({ revokedAt: () => 'now()' })
      .where('token_hash = :tokenHash', { tokenHash })
      .andWhere('revoked_at IS NULL')
      .andWhere('expires_at > :now', { now: new Date() })
      .execute();

    if (result.affected !== 1) return null;
    return this.sessions.findOneBy({ tokenHash });
  }

  async revokeSession(id: string): Promise<void> {
    await this.sessions.update({ id }, { revokedAt: new Date() });
  }

  async revokeAllForDriver(driverId: string): Promise<void> {
    await this.sessions.update({ driverId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  // A driver's active push targets — one row per currently-active session that has registered an
  // FCM token. See driver-auth.service.ts's getActiveDeviceTokensForDriver and
  // docs/driver-auth.md's push-notification example (dispatch-planning.service.ts).
  findActiveByDriverId(driverId: string): Promise<DriverSessionEntity[]> {
    return this.sessions.find({
      where: {
        driverId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
        fcmToken: Not(IsNull()),
      },
    });
  }

  // Keyed by the row's own id (the driver access token's `sid` claim). Returns whether a row was
  // actually matched, so the caller can 404 on a since-revoked/expired session rather than
  // silently no-op-ing — same contract as AuthRepository.updateSessionDeviceInfo.
  async updateSessionDeviceInfo(
    id: string,
    data: { fcmToken: string; deviceType: DriverDevicePlatform },
  ): Promise<boolean> {
    const result = await this.sessions.update(
      { id, revokedAt: IsNull() },
      { fcmToken: data.fcmToken, deviceType: data.deviceType, lastSeen: new Date() },
    );
    return (result.affected ?? 0) > 0;
  }
}
