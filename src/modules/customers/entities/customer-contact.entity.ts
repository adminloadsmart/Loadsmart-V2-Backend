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

/** Settings → Customers "Contact details" — one row per point of contact (Contact-1, Contact-2…).
 *  The first (lowest sort_order) is mirrored onto the legacy customers.contact_person_* columns. */
@Entity({ schema: 'customers', name: 'customer_contacts' })
@Index('customer_contacts_tenant_customer_idx', ['tenantId', 'customerId'])
export class CustomerContactEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'customer_id', type: 'uuid' }) customerId!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'full_name', type: 'varchar', length: 150, nullable: true })
  fullName!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) designation!: string | null;
  @Column({ type: 'varchar', length: 15, nullable: true }) phone!: string | null;
  @Column({ name: 'is_whatsapp', type: 'boolean', default: false }) isWhatsapp!: boolean;
  @Column({ type: 'varchar', length: 255, nullable: true }) email!: string | null;
  @Column({ name: 'sort_order', type: 'smallint', default: 0 }) sortOrder!: number;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @ManyToOne(() => CustomerEntity, (customer) => customer.contacts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: CustomerEntity;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
