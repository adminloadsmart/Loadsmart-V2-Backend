import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A lane city's location, looked up once on Google and kept (lane-matching). A row with no
 *  point is a city Google couldn't find — not asked again. */
@Entity({ schema: 'loads', name: 'geo_places' })
@Index('geo_places_query_key_uq', ['queryKey'], { unique: true })
export class GeoPlaceEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  /** "bhiwandi|maharashtra" — the canonical city and state asked for. */
  @Column({ name: 'query_key', type: 'varchar', length: 220 }) queryKey!: string;

  @Column({ type: 'varchar', length: 100, nullable: true }) city!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) state!: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 6, nullable: true }) latitude!: string | null;
  @Column({ type: 'numeric', precision: 10, scale: 6, nullable: true }) longitude!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
