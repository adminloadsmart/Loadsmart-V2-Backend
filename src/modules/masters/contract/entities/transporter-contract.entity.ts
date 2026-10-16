import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TransporterEntity } from '../../transporter/entities/transporter.entity';
import { CONTRACT_BILLING_UNITS, ContractBillingUnit } from '../contract.types';

/**
 * Settings → Masters → Contracts: a transporter's agreed rate and allocation priority on one lane
 * (source city/state → destination city/state). Separate from loads.customer_contracts, which
 * stays the Post a load Indent source. Lane matching is case-insensitive on city + state.
 */
@Entity({ schema: 'masters', name: 'transporter_contracts' })
@Index('transporter_contracts_tenant_idx', ['tenantId'])
@Index('transporter_contracts_tenant_transporter_idx', ['tenantId', 'transporterId'])
export class TransporterContractEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'transporter_id', type: 'uuid' }) transporterId!: string;
  @ManyToOne(() => TransporterEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transporter_id' })
  transporter!: TransporterEntity;
  @Column({ name: 'source_city', type: 'varchar', length: 100 }) sourceCity!: string;
  @Column({ name: 'source_state', type: 'varchar', length: 100 }) sourceState!: string;
  @Column({ name: 'destination_city', type: 'varchar', length: 100 }) destinationCity!: string;
  @Column({ name: 'destination_state', type: 'varchar', length: 100 }) destinationState!: string;
  @Column({ name: 'agreed_rate', type: 'numeric', precision: 12, scale: 2 }) agreedRate!: string;
  @Column({ name: 'billing_unit', type: 'enum', enum: [...CONTRACT_BILLING_UNITS] })
  billingUnit!: ContractBillingUnit;
  @Column({ name: 'valid_from', type: 'date' }) validFrom!: string;
  @Column({ name: 'valid_to', type: 'date' }) validTo!: string;
  /** 1 = P1 Primary carrier, 2 = P2, … */
  @Column({ type: 'smallint' }) priority!: number;
  /** "Share of business %" on this lane; null = no fixed share ("—"). */
  @Column({ name: 'share_percentage', type: 'numeric', precision: 5, scale: 2, nullable: true })
  sharePercentage!: string | null;
  @Column({ type: 'text', nullable: true }) notes!: string | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy!: string | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
