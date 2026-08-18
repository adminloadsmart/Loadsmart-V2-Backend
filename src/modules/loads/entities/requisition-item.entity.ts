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
import { RequisitionEntity } from './requisition.entity';
import { ProductEntity } from '../../masters/entities/product.entity';

/**
 * One product line on a Requisition (Plan Dispatch v2.0 R-02: "A requisition can hold multiple
 * products, each with its own tonnage"). At least one row per requisition — enforced in
 * requisition.service.ts's create(), not at the DB level. `RequisitionEntity.quantityTonnes`/
 * `dispatchedTonnes` stay as stored aggregates (the sum across these rows) since Dispatch
 * Planning still matches capacity against one total figure per requisition, not per product line.
 */
@Entity({ schema: 'loads', name: 'requisition_items' })
@Index('requisition_items_tenant_id_idx', ['tenantId'])
@Index('requisition_items_requisition_idx', ['requisitionId'])
export class RequisitionItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'requisition_id', type: 'uuid' })
  requisitionId!: string;

  @ManyToOne(() => RequisitionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requisition_id' })
  requisition!: RequisitionEntity;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @ManyToOne(() => ProductEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product!: ProductEntity;

  @Column({ name: 'quantity_tonnes', type: 'numeric', precision: 10, scale: 2 })
  quantityTonnes!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
