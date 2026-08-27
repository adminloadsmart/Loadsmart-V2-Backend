import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { CustomerEntity } from '../../customers/entities/customer.entity';
import { CustomerDeliveryPointEntity } from '../../customers/entities/customer-delivery-point.entity';
import { LoadingPointEntity } from '../../masters/entities/loading-point.entity';
import { RequisitionItemEntity } from './requisition-item.entity';
import { REQUISITION_STATUSES, RequisitionStatus } from '../utils/loads.types';

/**
 * A Requisition captures the complete customer order — Sales creates it; Dispatch
 * Planning splits it into one or more Loads (one truck = one load, see load.entity.ts).
 * Deletable only while it has zero loads against it (RequisitionService.delete — undoes a
 * mistaken create; the loads→requisitions FK is ON DELETE RESTRICT, enforcing this at the DB
 * layer too). Once any load exists, the only removal-adjacent action is manually closing it.
 *
 * A requisition can hold multiple products (Plan Dispatch v2.0 R-02) — each is its own
 * RequisitionItemEntity row, not a column here. `quantityTonnes`/`dispatchedTonnes` stay as
 * stored aggregates (the sum across items) since Dispatch Planning still matches capacity
 * against one total figure per requisition.
 */
@Entity({ schema: 'loads', name: 'requisitions' })
@Index('requisitions_tenant_id_idx', ['tenantId'])
@Index('requisitions_tenant_status_idx', ['tenantId', 'status'])
@Index('requisitions_tenant_customer_idx', ['tenantId', 'customerId'])
@Index('requisitions_tenant_code_unique', ['tenantId', 'code'], { unique: true })
export class RequisitionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** Display code `REQ-nnnn` — generated once at create from CodeSequenceRepository, scoped per
   *  tenant. The UUID `id` above stays the FK/lookup key everywhere; `code` is what's shown,
   *  searched and referenced by a dispatcher (Plan Dispatch v2.0's worked examples). */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => CustomerEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer!: CustomerEntity;

  @OneToMany(() => RequisitionItemEntity, (item) => item.requisition)
  items!: RequisitionItemEntity[];

  /** Full order quantity — sum across `items`. May be split across multiple loads/trucks. */
  @Column({ name: 'quantity_tonnes', type: 'numeric', precision: 10, scale: 2 })
  quantityTonnes!: string;

  /** Sum of planned capacity across every load created off this requisition so far — see
   *  dispatch-planning.service.ts's planDispatch, which increments this atomically in SQL. */
  @Column({ name: 'dispatched_tonnes', type: 'numeric', precision: 10, scale: 2, default: 0 })
  dispatchedTonnes!: string;

  @Column({ name: 'loading_point_id', type: 'uuid' })
  loadingPointId!: string;

  @ManyToOne(() => LoadingPointEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'loading_point_id' })
  loadingPoint!: LoadingPointEntity;

  /** From the selected customer's own unloading points. */
  @Column({ name: 'customer_delivery_point_id', type: 'uuid' })
  customerDeliveryPointId!: string;

  @ManyToOne(() => CustomerDeliveryPointEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_delivery_point_id' })
  customerDeliveryPoint!: CustomerDeliveryPointEntity;

  /** When the truck is expected to pick the goods up from `loadingPoint` — distinct from, and
   *  must not be after, `expectedDeliveryDate` below. */
  @Column({ name: 'pickup_date', type: 'date' })
  pickupDate!: string;

  @Column({ name: 'expected_delivery_date', type: 'date' })
  expectedDeliveryDate!: string;

  /** The customer's own PO/SO reference. Tax invoice numbers are captured per load, not here. */
  @Column({ name: 'customer_po_number', type: 'varchar', length: 100 })
  customerPoNumber!: string;

  @Column({ type: 'enum', enum: [...REQUISITION_STATUSES], default: 'open' })
  status!: RequisitionStatus;

  @Column({ name: 'closed_reason', type: 'varchar', nullable: true })
  closedReason!: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'closed_by', type: 'uuid', nullable: true })
  closedBy!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
