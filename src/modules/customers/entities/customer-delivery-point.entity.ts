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
import { CustomerEntity } from './customer.entity';

@Entity({ schema: 'customers', name: 'customer_delivery_points' })
@Index('customer_delivery_points_tenant_customer_idx', ['tenantId', 'customerId'])
export class CustomerDeliveryPointEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'customer_id', type: 'uuid' }) customerId!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ type: 'varchar', length: 255 }) location!: string;
  @Column({ name: 'address_line_1', type: 'varchar', length: 255, nullable: true })
  addressLine1!: string | null;
  @Column({ name: 'address_line_2', type: 'varchar', length: 255, nullable: true })
  addressLine2!: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) landmark!: string | null;
  @Column({ name: 'area_locality', type: 'varchar', length: 255, nullable: true })
  areaLocality!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) city!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) state!: string | null;
  @Column({ name: 'pin_code', type: 'varchar', length: 10, nullable: true })
  pinCode!: string | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @ManyToOne(() => CustomerEntity, (customer) => customer.deliveryPoints, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: CustomerEntity;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
