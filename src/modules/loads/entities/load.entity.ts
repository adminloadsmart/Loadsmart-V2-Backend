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
import { RequisitionEntity } from './requisition.entity';
import { LoadCargoItemEntity } from './load-cargo-item.entity';
import { TruckTypeEntity } from '../../masters/entities/truck-type.entity';
import { VehicleEntity } from '../../masters/entities/vehicle.entity';
import { DriverEntity } from '../../masters/entities/driver.entity';
import { TransporterEntity } from '../../masters/entities/transporter.entity';
import {
  FREIGHT_MODES,
  FREIGHT_TYPES,
  FreightMode,
  FreightType,
  LOAD_SOURCE_TYPES,
  LOAD_STATUSES,
  LoadSourceType,
  LoadStatus,
  SEAL_STATUSES,
  SealStatus,
} from '../utils/loads.types';

/**
 * One truck's worth of movement, split off a Requisition at Dispatch Planning
 * (1 truck = 1 load). This is the "trip" object — there is no separate
 * trip-status model, "trip" and "load" refer to the same row.
 *
 * `status` tracks movement only (created → ... → delivered → closed). Advance/balance payment
 * are tracked separately via `advancePaidAt`/`balancePaidAt` rather than folded into `status`,
 * since they run in parallel with movement and don't block it — a single linear enum can't
 * represent both at once. `closed` requires `deliveredAt`
 * set and, for market loads, both payment timestamps set — see load.service.ts's closeLoad.
 */
@Entity({ schema: 'loads', name: 'loads' })
@Index('loads_tenant_id_idx', ['tenantId'])
@Index('loads_tenant_status_idx', ['tenantId', 'status'])
@Index('loads_tenant_requisition_idx', ['tenantId', 'requisitionId'])
@Index('loads_tenant_vehicle_idx', ['tenantId', 'vehicleId'])
@Index('loads_tenant_vehicle_number_idx', ['tenantId', 'vehicleNumber'])
@Index('loads_tenant_code_unique', ['tenantId', 'code'], { unique: true })
export class LoadEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** Display code `REQ-nnnn-Lx` — `x` restarts at 1 per requisition (Plan Dispatch v2.0's
   *  worked examples), generated at Dispatch Planning from CodeSequenceRepository scoped to
   *  this load's requisitionId. The UUID `id` stays the FK/lookup key everywhere else. */
  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ name: 'requisition_id', type: 'uuid' })
  requisitionId!: string;

  @ManyToOne(() => RequisitionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requisition_id' })
  requisition!: RequisitionEntity;

  @Column({ name: 'source_type', type: 'enum', enum: [...LOAD_SOURCE_TYPES] })
  sourceType!: LoadSourceType;

  @Column({ type: 'enum', enum: [...LOAD_STATUSES], default: 'created' })
  status!: LoadStatus;

  /** Planned capacity of this truck, captured at Dispatch Planning. */
  @Column({ name: 'planned_capacity_tonnes', type: 'numeric', precision: 10, scale: 2 })
  plannedCapacityTonnes!: string;

  /** What this load actually carries — the "cargo mix", identical across every load spawned from
   *  the same truck line (Plan Dispatch v2.0 R-08). */
  @OneToMany(() => LoadCargoItemEntity, (item) => item.load)
  cargoItems!: LoadCargoItemEntity[];

  /** Market lines only — own-fleet capacity/type comes from the linked VehicleEntity. */
  @Column({ name: 'truck_type_id', type: 'uuid', nullable: true })
  truckTypeId!: string | null;

  @ManyToOne(() => TruckTypeEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'truck_type_id' })
  truckType!: TruckTypeEntity | null;

  @Column({ name: 'feet_wheels', type: 'varchar', length: 50, nullable: true })
  feetWheels!: string | null;

  /** Own-fleet only — market vehicles are not necessarily in the Vehicle master (see vehicleNumber). */
  @Column({ name: 'vehicle_id', type: 'uuid', nullable: true })
  vehicleId!: string | null;

  @ManyToOne(() => VehicleEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: VehicleEntity | null;

  /** Own-fleet only — resolved from the vehicle's linked driver, editable. */
  @Column({ name: 'driver_id', type: 'uuid', nullable: true })
  driverId!: string | null;

  @ManyToOne(() => DriverEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driver_id' })
  driver!: DriverEntity | null;

  /** Display value shown/edited on the Assign Load screen — own-fleet autofill or market free text. */
  @Column({ name: 'vehicle_number', type: 'varchar', length: 20, nullable: true })
  vehicleNumber!: string | null;

  @Column({ name: 'driver_number', type: 'varchar', length: 20, nullable: true })
  driverNumber!: string | null;

  /** Market only — free-text name of an external driver not in the Driver master, entered at
   *  Assignment. Optional; independent of driverNumber (their phone number). Own-fleet loads
   *  never populate this. */
  @Column({ name: 'driver_name', type: 'varchar', length: 150, nullable: true })
  driverName!: string | null;

  /** Market only. */
  @Column({ name: 'transporter_id', type: 'uuid', nullable: true })
  transporterId!: string | null;

  @ManyToOne(() => TransporterEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transporter_id' })
  transporter!: TransporterEntity | null;

  @Column({ name: 'freight_type', type: 'enum', enum: [...FREIGHT_TYPES], nullable: true })
  freightType!: FreightType | null;

  /** Market only, set at Dispatch Planning (Plan Dispatch v2.0 R-16): "set expected price" carries
   *  `expectedRate`, "ask for quotes" leaves it null until Assignment negotiates a rate. */
  @Column({ name: 'freight_mode', type: 'enum', enum: [...FREIGHT_MODES], nullable: true })
  freightMode!: FreightMode | null;

  /** The target/starting rate captured at planning — distinct from `freightValue`, the *agreed*
   *  rate confirmed at Assignment. */
  @Column({ name: 'expected_rate', type: 'numeric', precision: 12, scale: 2, nullable: true })
  expectedRate!: string | null;

  /** The agreed rate — market only, confirmed at Assignment (defaults to `expectedRate` if the
   *  caller doesn't override it). */
  @Column({ name: 'freight_value', type: 'numeric', precision: 12, scale: 2, nullable: true })
  freightValue!: string | null;

  @Column({ name: 'advance_percentage', type: 'numeric', precision: 5, scale: 2, nullable: true })
  advancePercentage!: string | null;

  @Column({ name: 'balance_percentage', type: 'numeric', precision: 5, scale: 2, nullable: true })
  balancePercentage!: string | null;

  // --- Loading & Documents — file references are storage `key` text columns, same
  // convention as VehicleDocumentEntity.fileUrl, not a FK to storage.files.id.

  @Column({ name: 'invoice_number', type: 'varchar', length: 50, nullable: true })
  invoiceNumber!: string | null;

  @Column({ name: 'invoice_file_key', type: 'text', nullable: true })
  invoiceFileKey!: string | null;

  @Column({ name: 'eway_bill_number', type: 'varchar', length: 50, nullable: true })
  ewayBillNumber!: string | null;

  @Column({ name: 'eway_bill_file_key', type: 'text', nullable: true })
  ewayBillFileKey!: string | null;

  /** Drives the computed 2-hour expiry flag — see load.service.ts's getEwayBillExpiry. No
   *  scheduler exists in this repo yet, so expiry is computed on read, not pushed. */
  @Column({ name: 'eway_bill_generated_at', type: 'timestamptz', nullable: true })
  ewayBillGeneratedAt!: Date | null;

  @Column({ name: 'elr_number', type: 'varchar', length: 50, nullable: true })
  elrNumber!: string | null;

  @Column({ name: 'elr_file_key', type: 'text', nullable: true })
  elrFileKey!: string | null;

  @Column({ name: 'loading_confirmed_at', type: 'timestamptz', nullable: true })
  loadingConfirmedAt!: Date | null;

  @Column({ name: 'loading_confirmed_by', type: 'uuid', nullable: true })
  loadingConfirmedBy!: string | null;

  // --- Tracking (manual in this build — see MANUAL_TRACKING_STATUSES) ---

  @Column({ name: 'at_plant_at', type: 'timestamptz', nullable: true })
  atPlantAt!: Date | null;

  @Column({ name: 'in_transit_at', type: 'timestamptz', nullable: true })
  inTransitAt!: Date | null;

  @Column({ name: 'reached_delivery_point_at', type: 'timestamptz', nullable: true })
  reachedDeliveryPointAt!: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  // --- E-POD — podFileKey, podReceiverName, podReceiverMobile, podReceiverDesignation,
  // podQuantityReceived and sealStatus are all captured together at uploadPod; only podRemarks
  // is optional. ---

  @Column({ name: 'pod_file_key', type: 'text', nullable: true })
  podFileKey!: string | null;

  @Column({ name: 'pod_receiver_name', type: 'varchar', length: 150, nullable: true })
  podReceiverName!: string | null;

  /** 10-digit mobile number the delivery receipt is copied to. Storage only for now — there's no
   *  notification/SMS delivery infra in this build yet (notifications module is a stub) to
   *  actually send that copy. */
  @Column({ name: 'pod_receiver_mobile', type: 'varchar', length: 10, nullable: true })
  podReceiverMobile!: string | null;

  @Column({ name: 'pod_receiver_designation', type: 'varchar', length: 150, nullable: true })
  podReceiverDesignation!: string | null;

  @Column({
    name: 'pod_quantity_received',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  podQuantityReceived!: string | null;

  /** See SEAL_STATUSES' doc comment (loads.types.ts) — advisory, never blocks. */
  @Column({ name: 'seal_status', type: 'enum', enum: [...SEAL_STATUSES], nullable: true })
  sealStatus!: SealStatus | null;

  @Column({ name: 'pod_remarks', type: 'varchar', nullable: true })
  podRemarks!: string | null;

  // --- Payments — market only; run in parallel with movement, see class doc comment. ---

  @Column({ name: 'advance_paid_at', type: 'timestamptz', nullable: true })
  advancePaidAt!: Date | null;

  @Column({ name: 'balance_paid_at', type: 'timestamptz', nullable: true })
  balancePaidAt!: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
