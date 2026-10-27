import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Loadsmart's terms with one shipper — the margin it adds and the trucker advance it pays
 *  partners ("adds the margin and the trucker advance from the masters"). A shipper without a
 *  row gets the defaults in loadsmart.types.ts. */
@Entity({ schema: 'loads', name: 'ls_commercial_terms' })
export class LsCommercialTermsEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'margin_percent', type: 'numeric', precision: 5, scale: 2 })
  marginPercent!: string;

  @Column({ name: 'trucker_advance_percent', type: 'numeric', precision: 5, scale: 2 })
  truckerAdvancePercent!: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
