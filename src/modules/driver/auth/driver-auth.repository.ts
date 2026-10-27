import { DataSource, EntityManager, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { DriverSessionEntity } from '../entities/driver-session.entity';
import { DriverDevicePlatform, RevokedDriverSessionToken } from './driver-auth.types';

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
    tenantId: string | null;
    driverTenantRelationId: string | null;
    tokenHash: string;
    expiresAt: Date;
    fcmToken?: string | null;
    deviceType?: DriverDevicePlatform | null;
    deviceInfo?: string | null;
    ipAddress?: string | null;
    accessJti?: string | null;
    accessExpiresAt?: Date | null;
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

  /** Revokes every live session of the driver and returns each one's access token, so the caller
   *  can blocklist them (see DriverAuthService.issueLoginSession). */
  async revokeAllForDriver(driverId: string): Promise<RevokedDriverSessionToken[]> {
    const result = await this.sessions
      .createQueryBuilder()
      .update(DriverSessionEntity)
      .set({ revokedAt: () => 'now()' })
      .where('driver_id = :driverId', { driverId })
      .andWhere('revoked_at IS NULL')
      .returning(['access_jti', 'access_expires_at'])
      .execute();

    return (
      (result.raw ?? []) as { access_jti: string | null; access_expires_at: Date | null }[]
    ).map((row) => ({ accessJti: row.access_jti, accessExpiresAt: row.access_expires_at }));
  }

  // Account deletion: revokes every live session and drops the push tokens on all of the driver's
  // sessions, so nothing keeps pushing to a device after the account is gone.
  async revokeAndClearDevicesForDriver(driverId: string, manager?: EntityManager): Promise<void> {
    const sessions = manager ? manager.getRepository(DriverSessionEntity) : this.sessions;
    await sessions.update({ driverId, revokedAt: IsNull() }, { revokedAt: new Date() });
    await sessions.update({ driverId, fcmToken: Not(IsNull()) }, { fcmToken: null });
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

  // My Drivers' "app installed" icon: any session row at all — revoked or expired included — means
  // the driver has logged into the app at least once. Maps each such driver to their latest app
  // activity; drivers who never logged in are absent from the map. One query for the whole page.
  async findLastAppActivityByDriverIds(driverIds: string[]): Promise<Map<string, Date>> {
    if (!driverIds.length) return new Map();
    const rows = await this.sessions
      .createQueryBuilder('driver_session')
      .select('driver_session.driver_id', 'driverId')
      .addSelect('MAX(COALESCE(driver_session.last_seen, driver_session.created_at))', 'lastSeenAt')
      .where('driver_session.driver_id IN (:...driverIds)', { driverIds })
      .groupBy('driver_session.driver_id')
      .getRawMany<{ driverId: string; lastSeenAt: Date }>();
    return new Map(rows.map((row) => [row.driverId, new Date(row.lastSeenAt)]));
  }

  // When the driver first logged into the app — the invitation drawer's "App Installed" time. Null
  // when they never have. Revoked/expired sessions count.
  async findFirstAppLoginAt(driverId: string): Promise<Date | null> {
    const firstSession = await this.sessions.findOne({
      select: { id: true, createdAt: true },
      where: { driverId },
      order: { createdAt: 'ASC' },
    });
    return firstSession?.createdAt ?? null;
  }

  // The driver's most recently used session (revoked/expired included) — the device the driver
  // detail screen's "Driver app" line shows. Null when the driver never logged in.
  findLatestSession(driverId: string): Promise<DriverSessionEntity | null> {
    return this.sessions
      .createQueryBuilder('driver_session')
      .where('driver_session.driver_id = :driverId', { driverId })
      .orderBy('COALESCE(driver_session.last_seen, driver_session.created_at)', 'DESC')
      .getOne();
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
