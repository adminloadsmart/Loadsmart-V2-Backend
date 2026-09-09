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
import { LoadEntity } from './load.entity';
import { ProductEntity } from '../../masters/product/entities/product.entity';

/**
 * What one load actually carries — the "cargo mix" (Plan Dispatch v2.0 R-08: "A truck can carry a
 * mix of several products"). Identical across every load spawned from the same truck line
 * (dispatch-planning.service.ts writes the same rows for each). At least one row per load,
 * enforced in dispatch-planning.service.ts, not at the DB level.
 */
@Entity({ schema: 'loads', name: 'load_cargo_items' })
@Index('load_cargo_items_tenant_id_idx', ['tenantId'])
@Index('load_cargo_items_load_idx', ['loadId'])
export class LoadCargoItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @ManyToOne(() => LoadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'load_id' })
  load!: LoadEntity;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @ManyToOne(() => ProductEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product!: ProductEntity;

  @Column({ name: 'tonnes_per_truck', type: 'numeric', precision: 10, scale: 2 })
  tonnesPerTruck!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
