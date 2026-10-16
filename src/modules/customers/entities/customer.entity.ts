import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  CustomerInvoiceAgainst,
  CustomerStatus,
  CUSTOMER_INVOICE_AGAINST,
  CUSTOMER_STATUSES,
} from '../utils/customer.status';
import { GST_RECORD_STATUSES, GstRecordStatus } from '../../masters/gst/gst.types';
import { CustomerDeliveryPointEntity } from './customer-delivery-point.entity';
import { CustomerContactEntity } from './customer-contact.entity';

@Entity({ schema: 'customers', name: 'customers' })
@Index('customers_tenant_id_idx', ['tenantId'])
@Index('customers_tenant_status_idx', ['tenantId', 'status'])
@Index('customers_tenant_name_idx', ['tenantId', 'name'])
@Index('customers_tenant_code_unique', ['tenantId', 'code'], {
  unique: true,
  where: '"code" IS NOT NULL AND "deleted_at" IS NULL',
})
@Index('customers_tenant_mobile_active_unique', ['tenantId', 'mobile'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class CustomerEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  /** Display code `CUS-nnnn`, tenant-wide sequential (loads CodeSequenceRepository, kind
   *  'customer'). Searchable on Post a load. */
  @Column({ type: 'varchar', length: 20, nullable: true }) code!: string | null;
  @Column({ type: 'varchar', length: 150 }) name!: string;
  // Null only for customers added by name from Post a load; details are completed later.
  @Column({ type: 'varchar', length: 15, nullable: true }) mobile!: string | null;
  @Column({ type: 'varchar', nullable: true }) email!: string | null;
  @Column({ type: 'varchar', length: 15, nullable: true }) gstin!: string | null;
  @Column({ name: 'contact_person_name', type: 'varchar', length: 150, nullable: true })
  contactPersonName!: string | null;
  @Column({ name: 'contact_person_number', type: 'varchar', length: 20, nullable: true })
  contactPersonNumber!: string | null;
  @Column({ name: 'contact_person_email', type: 'varchar', length: 255, nullable: true })
  contactPersonEmail!: string | null;
  @Column({ name: 'contact_person_designation', type: 'varchar', length: 100, nullable: true })
  contactPersonDesignation!: string | null;
  @Column({
    name: 'contact_person_designation_other',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  contactPersonDesignationOther!: string | null;
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
  /** Settings redesign — the GST register's address (or the manual override) as one block. */
  @Column({ name: 'registered_address', type: 'text', nullable: true })
  registeredAddress!: string | null;
  @Column({ name: 'registered_city', type: 'varchar', length: 100, nullable: true })
  registeredCity!: string | null;
  /** State of the GSTIN — from the register when verified, else from the GSTIN's state code. */
  @Column({ name: 'place_of_supply', type: 'varchar', length: 100, nullable: true })
  placeOfSupply!: string | null;
  /** 'verified' only when saved with a verified masters.gst_verifications row (never client-set). */
  @Column({
    name: 'gst_verification_status',
    type: 'enum',
    enum: [...GST_RECORD_STATUSES],
    default: 'unverified',
  })
  gstVerificationStatus!: GstRecordStatus;
  @Column({ name: 'gst_verification_id', type: 'uuid', nullable: true })
  gstVerificationId!: string | null;
  @Column({ name: 'gst_verified_at', type: 'timestamptz', nullable: true })
  gstVerifiedAt!: Date | null;
  @Column({ name: 'gst_registry_name', type: 'varchar', length: 255, nullable: true })
  gstRegistryName!: string | null;
  @Column({ name: 'gst_name_matched', type: 'boolean', nullable: true })
  gstNameMatched!: boolean | null;
  @Column({
    name: 'invoice_against',
    type: 'enum',
    enum: [...CUSTOMER_INVOICE_AGAINST],
    nullable: true,
  })
  invoiceAgainst!: CustomerInvoiceAgainst | null;
  @Column({ name: 'free_hours_at_drop', type: 'integer', nullable: true })
  freeHoursAtDrop!: number | null;
  /** Edit Customer "Balance amount" — entered by hand until invoicing exists. */
  @Column({ name: 'balance_amount', type: 'numeric', precision: 14, scale: 2, nullable: true })
  balanceAmount!: string | null;
  @Column({ name: 'credit_limit', type: 'numeric', precision: 14, scale: 2, nullable: true })
  creditLimit!: string | null;
  @Column({ type: 'text', nullable: true }) notes!: string | null;
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
  @OneToMany(() => CustomerContactEntity, (contact) => contact.customer)
  contacts!: CustomerContactEntity[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
