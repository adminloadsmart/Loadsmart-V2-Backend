import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

// token_hash backs every /auth/refresh lookup (claimRefreshToken); user_id backs
// revokeAllRefreshTokensForUser — neither had an index before this, so both ran a full table
// scan as the table grew.
@Entity({ schema: 'auth', name: 'refresh_tokens' })
@Index('refresh_tokens_token_hash_idx', ['tokenHash'])
@Index('refresh_tokens_user_id_idx', ['userId'])
export class RefreshTokenEntity {
  // Rotates on every /auth/refresh — a brand-new row is created and the old one revoked (see
  // auth.service.ts's issueTokenPair/refresh). Embedded directly in the access token as the `sid`
  // claim (see updateDeviceToken/logout, both keyed by it) — a client always uses its most
  // recent access token, so `sid` tracking the current row (rather than staying artificially
  // stable across rotation) matches how it's actually used in practice.
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'token_hash' })
  tokenHash!: string;

  @Column({ type: 'varchar', nullable: true })
  portal!: 'organization' | 'platform' | null;

  @Column({ name: 'fcm_token', type: 'varchar', length: 512, nullable: true })
  fcmToken!: string | null;

  // 'ios' | 'android' | 'web' — TypeScript-narrowed only, matching `portal` above's existing
  // "enum as string, validated at the zod layer" convention for this table, not a Postgres enum.
  @Column({ name: 'device_type', type: 'varchar', nullable: true })
  deviceType!: 'ios' | 'android' | 'web' | null;

  @Column({ name: 'device_info', type: 'varchar', nullable: true })
  deviceInfo!: string | null;

  // This session's own IP — distinct from login_attempts.ipAddress, which only covers the login
  // attempt itself, not the ongoing session.
  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress!: string | null;

  // Updated whenever this row is touched: created, carried forward on /auth/refresh, or updated
  // via the standalone device-token endpoint.
  @Column({ name: 'last_seen', type: 'timestamptz', nullable: true })
  lastSeen!: Date | null;

  @Column({ name: 'expires_at' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
