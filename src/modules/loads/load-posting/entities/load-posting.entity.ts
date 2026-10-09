import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  BALANCE_PAID_BY,
  BalancePaidBy,
  POST_MODES,
  PostAddress,
  PostMode,
  TruckPick,
  PRICE_BASES,
  PRICE_MODES,
  PriceBasis,
  PriceMode,
} from '../utils/load-posting.types';

/**
 * One "Post a load" action. A posting owns the shipper's form answers (customer, route, cargo,
 * price, note) and the rendered transporter message; the Load rows it spawns (one per truck,
 * same as Dispatch Planning — see LoadEntity.postingId) carry the movement state. Recipients live
 * in load_recipients.
 */
@Entity({ schema: 'loads', name: 'load_postings' })
@Index('load_postings_tenant_id_idx', ['tenantId'])
@Index('load_postings_tenant_customer_idx', ['tenantId', 'customerId'])
@Index('load_postings_tenant_idempotency_unique', ['tenantId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotency_key" IS NOT NULL',
})
export class LoadPostingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'enum', enum: [...POST_MODES] })
  mode!: PostMode;

  /** Optional — a shipper can post without a customer. */
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({ name: 'pickup_loading_point_id', type: 'uuid', nullable: true })
  pickupLoadingPointId!: string | null;

  @Column({ name: 'pickup_address', type: 'jsonb' })
  pickupAddress!: PostAddress;

  /** Set when the drop is one of the customer's saved unloading points. */
  @Column({ name: 'drop_customer_delivery_point_id', type: 'uuid', nullable: true })
  dropCustomerDeliveryPointId!: string | null;

  /** Set when there is no customer and the drop is one of the shipper's own saved locations. */
  @Column({ name: 'drop_loading_point_id', type: 'uuid', nullable: true })
  dropLoadingPointId!: string | null;

  @Column({ name: 'drop_address', type: 'jsonb' })
  dropAddress!: PostAddress;

  @Column({ name: 'pickup_at', type: 'timestamptz' })
  pickupAt!: Date;

  @Column({ name: 'deliver_by_at', type: 'timestamptz', nullable: true })
  deliverByAt!: Date | null;

  @Column({ name: 'commodity_id', type: 'uuid', nullable: true })
  commodityId!: string | null;

  @Column({ name: 'commodity_name', type: 'varchar', length: 255 })
  commodityName!: string;

  @Column({ type: 'varchar', length: 50 })
  packaging!: string;

  @Column({ name: 'weight_tonnes', type: 'numeric', precision: 10, scale: 2, nullable: true })
  weightTonnes!: string | null;

  @Column({ name: 'truck_count', type: 'integer', default: 1 })
  truckCount!: number;

  /** Main truck — body, tyres/axle and tonnes are all carried by the truck master row. */
  @Column({ name: 'truck_type_id', type: 'uuid', nullable: true })
  truckTypeId!: string | null;

  @Column({ name: 'truck_length_ft', type: 'varchar', length: 20, nullable: true })
  truckLengthFt!: string | null;

  /** The picker choices behind truckTypeId/acceptedTruckTypeIds, kept so a past load can refill
   *  the stepper exactly (axle-typed containers can't be rebuilt from the Truck master row). */
  @Column({ name: 'truck_pick', type: 'jsonb', nullable: true })
  truckPick!: TruckPick | null;

  @Column({ name: 'accepted_truck_picks', type: 'jsonb', default: () => "'[]'" })
  acceptedTruckPicks!: TruckPick[];

  /** "Also accept" sizes — same body type as the main truck. */
  @Column({ name: 'accepted_truck_type_ids', type: 'uuid', array: true, default: () => "'{}'" })
  acceptedTruckTypeIds!: string[];

  /** Own fleet: the picked vehicle. */
  @Column({ name: 'vehicle_id', type: 'uuid', nullable: true })
  vehicleId!: string | null;

  /** Market fleet only. */
  @Column({ name: 'price_mode', type: 'enum', enum: [...PRICE_MODES], nullable: true })
  priceMode!: PriceMode | null;

  @Column({ name: 'price_basis', type: 'enum', enum: [...PRICE_BASES], nullable: true })
  priceBasis!: PriceBasis | null;

  /** Rate per trip or per tonne (market) or the contract rate (indent). Never sent to
   *  transporters in the message. */
  @Column({ name: 'rate', type: 'numeric', precision: 12, scale: 2, nullable: true })
  rate!: string | null;

  @Column({ name: 'freight_total', type: 'numeric', precision: 14, scale: 2, nullable: true })
  freightTotal!: string | null;

  @Column({ name: 'contract_id', type: 'uuid', nullable: true })
  contractId!: string | null;

  /** Null for own fleet — no payment section. */
  @Column({ name: 'advance_percentage', type: 'numeric', precision: 5, scale: 2, nullable: true })
  advancePercentage!: string | null;

  @Column({ name: 'balance_paid_by', type: 'enum', enum: [...BALANCE_PAID_BY], nullable: true })
  balancePaidBy!: BalancePaidBy | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note!: string | null;

  /** Exact text that goes out on WhatsApp — never contains the target price. */
  @Column({ name: 'message_text', type: 'text', nullable: true })
  messageText!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100, nullable: true })
  idempotencyKey!: string | null;

  @Column({ name: 'posted_by', type: 'uuid', nullable: true })
  postedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
