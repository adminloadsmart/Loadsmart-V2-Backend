import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CustomerStatus, CUSTOMER_STATUSES } from '../utils/customer.status';
import { CustomerDeliveryPointEntity } from './customer-delivery-point.entity';

@Entity({ schema: 'customers', name: 'customers' })
@Index('customers_tenant_id_idx', ['tenantId'])
@Index('customers_tenant_status_idx', ['tenantId', 'status'])
@Index('customers_tenant_name_idx', ['tenantId', 'name'])
@Index('customers_tenant_mobile_active_unique', ['tenantId', 'mobile'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class CustomerEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ type: 'varchar', length: 150 }) name!: string;
  @Column({ type: 'varchar', length: 15 }) mobile!: string;
  @Column({ type: 'varchar', nullable: true }) email!: string | null;
  @Column({ type: 'varchar', length: 15, nullable: true }) gstin!: string | null;
  @Column({ name: 'advance_percentage', type: 'numeric', precision: 5, scale: 2, nullable: true })
  advancePercentage!: string | null;
  @Column({ name: 'balance_percentage', type: 'numeric', precision: 5, scale: 2, nullable: true })
  balancePercentage!: string | null;
  @Column({ name: 'credit_days', type: 'integer', nullable: true }) creditDays!: number | null;
  @Column({ name: 'rate_contract', type: 'varchar', nullable: true }) rateContract!: string | null;
  @Column({ name: 'billing_address_line_1', type: 'varchar', length: 255, nullable: true })
  billingAddressLine1!: string | null;
  @Column({ name: 'billing_address_line_2', type: 'varchar', length: 255, nullable: true })
  billingAddressLine2!: string | null;
  @Column({ name: 'billing_landmark', type: 'varchar', length: 255, nullable: true })
  billingLandmark!: string | null;
  @Column({ name: 'billing_area_locality', type: 'varchar', length: 255, nullable: true })
  billingAreaLocality!: string | null;
  @Column({ name: 'billing_city', type: 'varchar', length: 100, nullable: true })
  billingCity!: string | null;
  @Column({ name: 'billing_state', type: 'varchar', length: 100, nullable: true })
  billingState!: string | null;
  @Column({ name: 'billing_pin_code', type: 'varchar', length: 10, nullable: true })
  billingPinCode!: string | null;
  @Column({ type: 'enum', enum: [...CUSTOMER_STATUSES], default: 'pending' })
  status!: CustomerStatus;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy!: string;
  @Column({ name: 'approved_by', type: 'uuid', nullable: true }) approvedBy!: string | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true }) approvedAt!: Date | null;
  // Set by reject, cleared by approve — mirrors OrganizationEntity's decisionReason.
  @Column({ name: 'rejection_reason', type: 'varchar', nullable: true })
  rejectionReason!: string | null;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy!: string | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @OneToMany(() => CustomerDeliveryPointEntity, (point) => point.customer)
  deliveryPoints!: CustomerDeliveryPointEntity[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
