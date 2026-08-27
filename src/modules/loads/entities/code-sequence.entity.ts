import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn, Unique } from 'typeorm';

/**
 * A tiny per-scope counter backing every human-readable code this module hands out —
 * `REQ-nnnn` requisition codes (`entity: 'requisition'`, `scopeId`: tenantId) and `REQ-nnnn-Lx`
 * load codes (`entity: 'load'`, `scopeId`: requisitionId — restarts at 1 per requisition, same
 * as Plan Dispatch v2.0's worked examples). Incremented under a row lock inside the same
 * transaction as the record it numbers — see code-sequence.repository.ts's `next` — so two
 * concurrent creates against the same scope can never be handed the same value.
 */
@Entity({ schema: 'loads', name: 'code_sequences' })
@Unique('code_sequences_entity_scope_unique', ['entity', 'scopeId'])
export class CodeSequenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30 })
  entity!: string;

  @Column({ name: 'scope_id', type: 'uuid' })
  scopeId!: string;

  @Column({ type: 'integer', default: 0 })
  value!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
