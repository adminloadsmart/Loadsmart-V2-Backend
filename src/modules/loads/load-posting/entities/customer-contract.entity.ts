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
import { TransporterEntity } from '../../../masters/transporter/entities/transporter.entity';

/**
 * A customer's rate contract with a transporter on one lane (pickup city to drop city), used by
 * Indent: only a transporter with a contract valid today on the posted lane can be picked, and the
 * indent price is the contract `rate` (per trip). Lane matching is case-insensitive on city.
 */
@Entity({ schema: 'loads', name: 'customer_contracts' })
@Index('customer_contracts_tenant_customer_idx', ['tenantId', 'customerId'])
@Index('customer_contracts_tenant_number_unique', ['tenantId', 'contractNumber'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class CustomerContractEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => CustomerEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: CustomerEntity;

  @Column({ name: 'transporter_id', type: 'uuid' })
  transporterId!: string;

  @ManyToOne(() => TransporterEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transporter_id' })
  transporter!: TransporterEntity;

  @Column({ name: 'contract_number', type: 'varchar', length: 50 })
  contractNumber!: string;

  @Column({ name: 'pickup_city', type: 'varchar', length: 100 })
  pickupCity!: string;

  @Column({ name: 'drop_city', type: 'varchar', length: 100 })
  dropCity!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  rate!: string;

  @Column({ name: 'valid_from', type: 'date' })
  validFrom!: string;

  @Column({ name: 'valid_to', type: 'date' })
  validTo!: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
