import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity({ schema: 'auth', name: 'referral_codes' })
@Index('referral_codes_code_unique', ['code'], { unique: true })
@Index('referral_codes_owner_user_id_idx', ['ownerUserId'])
export class ReferralCodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40 })
  code!: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string;

  @ManyToOne(() => UserEntity, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id' })
  owner!: UserEntity;

  @Column({ name: 'valid_from', type: 'date', nullable: true })
  validFrom!: string | null;

  @Column({ name: 'valid_until', type: 'date', nullable: true })
  validUntil!: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'total_signup', type: 'int', nullable: true })
  totalSignup!: number | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
