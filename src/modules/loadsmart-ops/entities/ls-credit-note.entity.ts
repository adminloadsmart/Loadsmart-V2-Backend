import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Loadsmart's credit note to a shipper — "shipper deductions for damage come as debit notes;
 *  Loadsmart issues credit notes". Issued when CS closes a claim with an agreed amount; it comes
 *  off what the shipper owes on the load's invoice. */
@Entity({ schema: 'loads', name: 'ls_credit_notes' })
@Index('ls_credit_notes_load_idx', ['loadId'])
export class LsCreditNoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @Column({ name: 'claim_id', type: 'uuid', nullable: true })
  claimId!: string | null;

  /** LSCN-nnnn — one series across Loadsmart. */
  @Column({ name: 'credit_note_number', type: 'varchar', length: 30, unique: true })
  creditNoteNumber!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  /** The shipper's debit note this answers, if any. */
  @Column({ name: 'shipper_debit_note_ref', type: 'varchar', length: 100, nullable: true })
  shipperDebitNoteRef!: string | null;

  @Column({ name: 'issued_by', type: 'uuid' })
  issuedBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
