import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Super Admin → Settings: the Placement round-robin roster — who is on duty and their turn
 *  order. New Loadsmart loads go to the members on duty one by one; the turn resets at midnight. */
@Entity({ schema: 'loads', name: 'ls_placement_roster' })
export class LsPlacementRosterEntity {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'on_duty', type: 'boolean', default: true }) onDuty!: boolean;
  @Column({ name: 'turn_order', type: 'integer' }) turnOrder!: number;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy!: string | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
