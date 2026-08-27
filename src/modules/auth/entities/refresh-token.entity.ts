import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

// token_hash backs every /auth/refresh and /auth/logout lookup (findActiveRefreshTokenByHash,
// claimRefreshToken); user_id backs revokeAllRefreshTokensForUser — neither had an index before
// this, so both ran a full table scan as the table grew.
@Entity({ schema: 'auth', name: 'refresh_tokens' })
@Index('refresh_tokens_token_hash_idx', ['tokenHash'])
@Index('refresh_tokens_user_id_idx', ['userId'])
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'token_hash' })
  tokenHash!: string;

  @Column({ type: 'varchar', nullable: true })
  portal!: 'organization' | 'platform' | null;

  @Column({ name: 'expires_at' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
