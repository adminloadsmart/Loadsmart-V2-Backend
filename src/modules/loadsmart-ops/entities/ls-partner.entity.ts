import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PARTNER_STATUSES, PARTNER_TYPES, PartnerStatus, PartnerType } from '../loadsmart.types';

/** One of Loadsmart's partners — a fleet owner or broker it sources trucks from. Platform-wide
 *  (no tenant): the same partner serves every shipper's Loadsmart loads. */
@Entity({ schema: 'loads', name: 'ls_partners' })
export class LsPartnerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 15 })
  phone!: string;

  @Column({ name: 'partner_type', type: 'enum', enum: [...PARTNER_TYPES] })
  partnerType!: PartnerType;

  @Column({ type: 'enum', enum: [...PARTNER_STATUSES], default: 'active' })
  status!: PartnerStatus;

  /** TDS deducted on the partner's payments (194C) — 0 when a no-TDS declaration is on file. */
  @Column({ name: 'tds_percent', type: 'numeric', precision: 5, scale: 2, default: 1 })
  tdsPercent!: string;

  @Column({ name: 'bank_account_number', type: 'varchar', length: 30, nullable: true })
  bankAccountNumber!: string | null;

  @Column({ name: 'bank_ifsc', type: 'varchar', length: 11, nullable: true })
  bankIfsc!: string | null;

  @Column({ name: 'upi_id', type: 'varchar', length: 100, nullable: true })
  upiId!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
