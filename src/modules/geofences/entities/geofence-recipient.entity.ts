import { Entity, Column, PrimaryGeneratedColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { GeofenceEntity } from './geofence.entity';
import { GeofenceAlertChannel } from '../utils/geofence.types';

/** "Send alerts to": a teammate and the channels their alerts for this geofence go out on. */
@Entity({ schema: 'tracking', name: 'geofence_recipients' })
@Index('geofence_recipients_geofence_user_unique', ['geofenceId', 'userId'], { unique: true })
export class GeofenceRecipientEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'geofence_id', type: 'uuid' })
  geofenceId!: string;

  @ManyToOne(() => GeofenceEntity, (g) => g.recipients, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'geofence_id' })
  geofence!: GeofenceEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'jsonb', default: () => `'["app"]'` })
  channels!: GeofenceAlertChannel[];
}
