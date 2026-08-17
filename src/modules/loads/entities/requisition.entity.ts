import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CustomerEntity } from '../../customers/entities/customer.entity';
import { CustomerDeliveryPointEntity } from '../../customers/entities/customer-delivery-point.entity';
import { LoadingPointEntity } from '../../masters/entities/loading-point.entity';
import { ProductEntity } from '../../masters/entities/product.entity';
import { REQUISITION_STATUSES, RequisitionStatus } from '../utils/loads.types';

/**
 * A Requisition captures the complete customer order — Sales creates it; Dispatch
 * Planning splits it into one or more Loads (one truck = one load, see load.entity.ts).
 * No delete flow — a requisition is either open, fully dispatched, or manually closed.
 */
@Entity({ schema: 'loads', name: 'requisitions' })
@Index('requisitions_tenant_id_idx', ['tenantId'])
@Index('requisitions_tenant_status_idx', ['tenantId', 'status'])
@Index('requisitions_tenant_customer_idx', ['tenantId', 'customerId'])
export class RequisitionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => CustomerEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer!: CustomerEntity;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @ManyToOne(() => ProductEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product!: ProductEntity;

  /** Full order quantity — may be split across multiple loads/trucks. */
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
