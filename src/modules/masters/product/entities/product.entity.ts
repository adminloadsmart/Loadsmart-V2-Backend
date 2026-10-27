import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductSubItemEntity } from './product-sub-item.entity';
import {
  PRODUCT_APPROVAL_STATUSES,
  PRODUCT_CLASSIFICATIONS,
  PRODUCT_CONVERSION_MODELS,
  PRODUCT_DIMENSION_UNITS,
  PRODUCT_STATUSES,
  ProductApprovalStatus,
  ProductClassification,
  ProductConversionModel,
  ProductDimensionUnit,
  ProductStatus,
} from '../product.types';

@Entity({ schema: 'masters', name: 'products' })
@Index('products_tenant_id_idx', ['tenantId'])
@Index('products_tenant_status_idx', ['tenantId', 'status'])
@Index('products_tenant_approval_status_idx', ['tenantId', 'approvalStatus'])
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'product_details', type: 'varchar', length: 255 }) productDetails!: string;
  @Column({ name: 'hsn_code', type: 'varchar', length: 20, nullable: true }) hsnCode!:
    string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) packaging!: string | null;
  @Column({ name: 'invoice_value', type: 'numeric', precision: 15, scale: 2, nullable: true })
  invoiceValue!: string | null;
  @Column({ name: 'standard_rate', type: 'numeric', precision: 15, scale: 2, nullable: true })
  standardRate!: string | null;
  @Column({ name: 'billing_unit', type: 'varchar', length: 30, nullable: true }) billingUnit!:
    string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) dimensions!: string | null;
  @Column({ type: 'numeric', precision: 12, scale: 3, nullable: true }) weight!: string | null;
  @Column({ name: 'weight_unit', type: 'varchar', length: 30, nullable: true }) weightUnit!:
    string | null;
  @Column({
    type: 'enum',
    enum: [...PRODUCT_CLASSIFICATIONS],
    default: 'non_hazardous',
  })
  classification!: ProductClassification;
  // "Dimensions & volumetric weight" — volume/weight are computed server-side on save.
  @Column({ type: 'numeric', precision: 10, scale: 3, nullable: true }) length!: string | null;
  @Column({ type: 'numeric', precision: 10, scale: 3, nullable: true }) width!: string | null;
  @Column({ type: 'numeric', precision: 10, scale: 3, nullable: true }) height!: string | null;
  @Column({
    name: 'dimension_unit',
    type: 'enum',
    enum: [...PRODUCT_DIMENSION_UNITS],
    nullable: true,
  })
  dimensionUnit!: ProductDimensionUnit | null;
  @Column({
    name: 'conversion_model',
    type: 'enum',
    enum: [...PRODUCT_CONVERSION_MODELS],
    nullable: true,
  })
  conversionModel!: ProductConversionModel | null;
  @Column({ name: 'volume_cbm', type: 'numeric', precision: 12, scale: 3, nullable: true })
  volumeCbm!: string | null;
  @Column({
    name: 'volumetric_weight_kg',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  volumetricWeightKg!: string | null;
  @Column({
    name: 'approval_status',
    type: 'enum',
    enum: [...PRODUCT_APPROVAL_STATUSES],
    default: 'pending_approval',
  })
  approvalStatus!: ProductApprovalStatus;
  @Column({ type: 'enum', enum: [...PRODUCT_STATUSES], default: 'inactive' })
  status!: ProductStatus;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy!: string;
  @Column({ name: 'approved_by', type: 'uuid', nullable: true }) approvedBy!: string | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true }) approvedAt!: Date | null;
  @Column({ name: 'rejected_by', type: 'uuid', nullable: true }) rejectedBy!: string | null;
  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true }) rejectedAt!: Date | null;
  @Column({ name: 'rejection_reason', type: 'text', nullable: true }) rejectionReason!:
    string | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @Column({ name: 'deleted_by', type: 'uuid', nullable: true }) deletedBy!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @OneToMany(() => ProductSubItemEntity, (subItem) => subItem.product)
  subItems!: ProductSubItemEntity[];
}
