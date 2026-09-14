import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

// The driver-identity counterpart to auth.refresh_tokens (see refresh-token.entity.ts) — but a
// separate table, not a row in that one: a driver is not an auth.users row. See
// docs/driver-auth.md for why. Same session/device/FCM shape, minus `portal` (drivers only ever
// have one). token_hash backs an opaque refresh secret the same way auth.refresh_tokens' does,
// not a JWT — see driver-auth.service.ts's issueDriverTokenPair.
@Entity({ schema: 'masters', name: 'driver_sessions' })
@Index('driver_sessions_driver_id_idx', ['driverId'])
@Index('driver_sessions_token_hash_idx', ['tokenHash'])
export class DriverSessionEntity {
  // Embedded directly in the driver access token as the `sid` claim (see
  // driver-auth.service.ts's issueDriverTokenPair) — same "rotates on every /refresh, sid tracks
  // the current row" convention as RefreshTokenEntity.
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'driver_id' })
  driverId!: string;

  @Column({ name: 'token_hash' })
  tokenHash!: string;

  @Column({ name: 'fcm_token', type: 'varchar', length: 512, nullable: true })
  fcmToken!: string | null;

  @Column({ name: 'device_type', type: 'varchar', nullable: true })
  deviceType!: 'ios' | 'android' | 'web' | null;

  @Column({ name: 'device_info', type: 'varchar', nullable: true })
  deviceInfo!: string | null;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'last_seen', type: 'timestamptz', nullable: true })
  lastSeen!: Date | null;

  @Column({ name: 'expires_at' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
