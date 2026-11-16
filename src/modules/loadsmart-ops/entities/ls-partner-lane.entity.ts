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

/** A lane a broker or fleet owner claims ("preferred lanes") — matched against a load's pickup
 *  and drop cities. */
@Entity({ schema: 'loads', name: 'ls_partner_lanes' })
@Index('ls_partner_lanes_partner_idx', ['partnerId'])
export class LsPartnerLaneEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'partner_id', type: 'uuid' }) partnerId!: string;
  @ManyToOne(() => LsPartnerEntity, (partner) => partner.lanes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'partner_id', foreignKeyConstraintName: 'FK_ls_partner_lanes_partner' })
  partner?: LsPartnerEntity;
  @Column({ name: 'from_city', type: 'varchar', length: 100 }) fromCity!: string;
  @Column({ name: 'to_city', type: 'varchar', length: 100 }) toCity!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
