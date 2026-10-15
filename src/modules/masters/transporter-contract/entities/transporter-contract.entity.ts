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
import { CustomerEntity } from '../../../customers/entities/customer.entity';
import { TransporterEntity } from '../../transporter/entities/transporter.entity';
import { CONTRACT_UNITS, ContractUnit } from '../transporter-contract.types';

/**
 * A customer's rate contract with a transporter on one lane (pickup city+state to drop
 * city+state). Indent only offers transporters with a contract valid today on the posted lane;
 * `priority` (1 = P1) orders them and `sharePercent` is the transporter's share of business on
 * that lane. `laneKey` (see transporter-contract.lane.ts) is what lanes are grouped and matched by.
 */
@Entity({ schema: 'masters', name: 'transporter_contracts' })
@Index('transporter_contracts_tenant_customer_lane_idx', ['tenantId', 'customerId', 'laneKey'])
@Index('transporter_contracts_tenant_transporter_idx', ['tenantId', 'transporterId'])
@Index('transporter_contracts_tenant_number_unique', ['tenantId', 'contractNumber'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class TransporterContractEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;

  @Column({ name: 'customer_id', type: 'uuid' }) customerId!: string;
  @ManyToOne(() => CustomerEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: CustomerEntity;

  @Column({ name: 'transporter_id', type: 'uuid' }) transporterId!: string;
  @ManyToOne(() => TransporterEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transporter_id' })
  transporter!: TransporterEntity;

  @Column({ name: 'contract_number', type: 'varchar', length: 50 }) contractNumber!: string;

  @Column({ name: 'pickup_city', type: 'varchar', length: 100 }) pickupCity!: string;
  @Column({ name: 'pickup_state', type: 'varchar', length: 100 }) pickupState!: string;
  @Column({ name: 'drop_city', type: 'varchar', length: 100 }) dropCity!: string;
  @Column({ name: 'drop_state', type: 'varchar', length: 100 }) dropState!: string;
  /** Empty string for a legacy row whose state could not be resolved — never matches a lane. */
  @Column({ name: 'lane_key', type: 'varchar', length: 300 }) laneKey!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 }) rate!: string;
  @Column({ type: 'enum', enum: [...CONTRACT_UNITS], enumName: 'transporter_contracts_unit_enum' })
  unit!: ContractUnit;

  @Column({ name: 'valid_from', type: 'date' }) validFrom!: string;
  @Column({ name: 'valid_to', type: 'date' }) validTo!: string;

  @Column({ type: 'smallint' }) priority!: number;
  @Column({ name: 'share_percent', type: 'numeric', precision: 5, scale: 2 })
  sharePercent!: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy!: string | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
