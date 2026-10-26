import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { RATING_SUBJECTS, RatingSubject } from '../loadsmart.types';

/** The POD team's rating of the shipper and the partner after a Loadsmart load. */
@Entity({ schema: 'loads', name: 'load_ratings' })
@Index('load_ratings_load_subject_idx', ['loadId', 'subject'], { unique: true })
export class LoadRatingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @Column({ type: 'enum', enum: [...RATING_SUBJECTS] })
  subject!: RatingSubject;

  /** The partner rated; null when rating the shipper. */
  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  partnerId!: string | null;

  @Column({ type: 'smallint' })
  score!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ name: 'rated_by', type: 'uuid', nullable: true })
  ratedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
