import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BrokerEntity } from './broker.entity';

/** A note the team logs against a broker ("Log note" on the broker page) — its Activity feed. */
@Entity({ schema: 'brokers', name: 'broker_notes' })
@Index('broker_notes_broker_idx', ['brokerId', 'createdAt'])
export class BrokerNoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'broker_id', type: 'uuid' })
  brokerId!: string;

  @ManyToOne(() => BrokerEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'broker_id', foreignKeyConstraintName: 'FK_broker_notes_broker' })
  broker?: BrokerEntity;

  @Column({ type: 'text' })
  body!: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
