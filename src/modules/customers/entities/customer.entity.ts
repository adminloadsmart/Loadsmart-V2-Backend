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
export class CustomerEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ type: 'varchar', length: 150 }) name!: string;
  @Column({ type: 'varchar', length: 15 }) mobile!: string;
  @Column({ type: 'varchar', nullable: true }) email!: string | null;
  @Column({ type: 'varchar', length: 15, nullable: true }) gstin!: string | null;
  @Column({ name: 'advance_percentage', type: 'numeric', precision: 5, scale: 2, nullable: true })
  advancePercentage!: string | null;
  @Column({ name: 'credit_days', type: 'integer', nullable: true }) creditDays!: number | null;
  @Column({ name: 'rate_contract', type: 'varchar', nullable: true }) rateContract!: string | null;
  @Column({ type: 'enum', enum: [...CUSTOMER_STATUSES], default: 'pending' })
  status!: CustomerStatus;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy!: string;
  @Column({ name: 'approved_by', type: 'uuid', nullable: true }) approvedBy!: string | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true }) approvedAt!: Date | null;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy!: string | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @OneToMany(() => CustomerDeliveryPointEntity, (point) => point.customer)
  deliveryPoints!: CustomerDeliveryPointEntity[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
