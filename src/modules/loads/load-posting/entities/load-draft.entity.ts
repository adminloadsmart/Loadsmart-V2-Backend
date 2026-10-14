import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** "Save draft" — the whole form as the client holds it, including the picked past load. The
 *  payload is stored untouched (a draft may be incomplete) and re-validated when posted. */
@Entity({ schema: 'loads', name: 'load_drafts' })
@Index('load_drafts_tenant_user_idx', ['tenantId', 'userId'])
export class LoadDraftEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
