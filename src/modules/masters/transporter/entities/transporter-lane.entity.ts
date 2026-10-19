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
import { TransporterEntity } from './transporter.entity';

/** Add/Edit Transporter "Operating routes & lanes" — an origin → destination corridor the
 *  transporter fulfils loads on. Distance is what the client showed ("~1,520 km"), if any. */
@Entity({ schema: 'masters', name: 'transporter_lanes' })
@Index('transporter_lanes_tenant_transporter_idx', ['tenantId', 'transporterId'])
export class TransporterLaneEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'transporter_id', type: 'uuid' }) transporterId!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'origin_city', type: 'varchar', length: 100 }) originCity!: string;
  @Column({ name: 'origin_state', type: 'varchar', length: 100, nullable: true })
  originState!: string | null;
  @Column({ name: 'destination_city', type: 'varchar', length: 100 }) destinationCity!: string;
  @Column({ name: 'destination_state', type: 'varchar', length: 100, nullable: true })
  destinationState!: string | null;
  @Column({ name: 'distance_km', type: 'integer', nullable: true }) distanceKm!: number | null;
  @Column({ name: 'sort_order', type: 'smallint', default: 0 }) sortOrder!: number;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @ManyToOne(() => TransporterEntity, (transporter) => transporter.lanes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transporter_id' })
  transporter!: TransporterEntity;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
