import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

/** An e-LR number series ("loadsmart" → LSLR-000123). `nextNumber` is the number the next issue
 *  takes; it only ever goes up, so a cancelled number is never handed out again. */
@Entity({ schema: 'loads', name: 'elr_series' })
@Check('CHK_elr_series_next_number', '"next_number" > 0')
export class ElrSeriesEntity {
  @PrimaryColumn({
    type: 'varchar',
    length: 30,
    primaryKeyConstraintName: 'PK_elr_series',
  })
  series!: string;

  @Column({ type: 'varchar', length: 10 })
  prefix!: string;

  @Column({ name: 'next_number', type: 'integer', default: 1 })
  nextNumber!: number;
}
