import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { BillingInstruction } from '../billing-rules';
import { POD_TYPES, PodType } from '../loadsmart.types';

export interface PreapprovedCharge {
  head: string;
  /** Null: any amount. */
  maxAmount: number | null;
}

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

  /** "Preapproved loading and unloading charges": a charge Loadsmart raises under one of these
   *  heads (up to the amount, when one is set) is approved as it is raised. */
  @Column({ name: 'preapproved_charges', type: 'jsonb', default: () => "'[]'" })
  preapprovedCharges!: PreapprovedCharge[];

  /** "Balance due (credit days from invoice receipt)" — null: the settings' default. */
  @Column({ name: 'credit_days', type: 'integer', nullable: true })
  creditDays!: number | null;

  /** Bill on the POD image, or wait for the physical original. */
  @Column({ name: 'pod_type', type: 'enum', enum: [...POD_TYPES], default: 'image' })
  podType!: PodType;

  /** Applied by the invoice builder, e.g. loading under ₹2,000 not billed. */
  @Column({ name: 'billing_instructions', type: 'jsonb', default: () => "'[]'" })
  billingInstructions!: BillingInstruction[];

  /** Anything else Receivables should know when billing this shipper. */
  @Column({ name: 'billing_note', type: 'text', nullable: true })
  billingNote!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
