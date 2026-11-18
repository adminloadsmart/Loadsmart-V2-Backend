import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** A broker Placement added to a load's matched list by hand ("Add broker"), beside the ones
 *  matched by truck type and lane. */
@Entity({ schema: 'loads', name: 'ls_sourcing_brokers' })
@Unique('ls_sourcing_brokers_sourcing_partner_uq', ['sourcingId', 'partnerId'])
export class LsSourcingBrokerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'sourcing_id', type: 'uuid' })
  sourcingId!: string;

  @Column({ name: 'partner_id', type: 'uuid' })
  partnerId!: string;

  @Column({ name: 'added_by', type: 'uuid' })
  addedBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
