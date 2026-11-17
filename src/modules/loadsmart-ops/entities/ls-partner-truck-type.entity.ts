import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LsPartnerEntity } from './ls-partner.entity';

/** A truck type a partner claims — a body type, and a capacity when it only runs one size.
 *  Matched against the load's truck type. */
@Entity({ schema: 'loads', name: 'ls_partner_truck_types' })
@Index('ls_partner_truck_types_partner_idx', ['partnerId'])
export class LsPartnerTruckTypeEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'partner_id', type: 'uuid' }) partnerId!: string;
  @ManyToOne(() => LsPartnerEntity, (partner) => partner.truckTypes, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'partner_id',
    foreignKeyConstraintName: 'FK_ls_partner_truck_types_partner',
  })
  partner?: LsPartnerEntity;
  @Column({ name: 'body_type', type: 'varchar', length: 40 }) bodyType!: string;
  /** Null: any capacity of this body type. */
  @Column({ name: 'capacity_tons', type: 'numeric', precision: 6, scale: 2, nullable: true })
  capacityTons!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
