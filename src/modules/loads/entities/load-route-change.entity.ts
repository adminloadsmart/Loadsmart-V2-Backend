import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LoadEntity } from './load.entity';
import { LOAD_POSTING_TYPES, LoadPostingType } from '../utils/loads.types';

/** A load's posting type changing after it was posted — today only a rejected indent going to
 *  the open market. Keeps who rejected it, why, and the contract's non-placement penalty. */
@Entity({ schema: 'loads', name: 'load_route_changes' })
@Index('load_route_changes_load_idx', ['loadId'])
export class LoadRouteChangeEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'load_id', type: 'uuid' }) loadId!: string;
  @ManyToOne(() => LoadEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'load_id', foreignKeyConstraintName: 'FK_load_route_changes_load' })
  load?: LoadEntity;
  @Column({
    name: 'from_posting_type',
    type: 'enum',
    enum: [...LOAD_POSTING_TYPES],
    enumName: 'loads_posting_type_enum',
  })
  fromPostingType!: LoadPostingType;
  @Column({
    name: 'to_posting_type',
    type: 'enum',
    enum: [...LOAD_POSTING_TYPES],
    enumName: 'loads_posting_type_enum',
  })
  toPostingType!: LoadPostingType;
  @Column({ type: 'text' }) reason!: string;
  /** The indent's contract and transporter. */
  @Column({ name: 'contract_id', type: 'uuid', nullable: true }) contractId!: string | null;
  @Column({ name: 'transporter_id', type: 'uuid', nullable: true })
  transporterId!: string | null;
  /** The contract's non-placement penalty, if it has one. */
  @Column({ name: 'penalty_amount', type: 'numeric', precision: 12, scale: 2, nullable: true })
  penaltyAmount!: string | null;
  @Column({ name: 'changed_by', type: 'uuid', nullable: true }) changedBy!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
