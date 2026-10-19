import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { GST_VERIFICATION_RESULTS, GstAddressParts, GstVerificationResult } from '../gst.types';

/**
 * One GSTIN lookup against IDfy (POST /masters/gst/verify). Customers and transporters reference
 * a row by id on save — the server, not the client, decides a record is "GST API verified".
 */
@Entity({ schema: 'masters', name: 'gst_verifications' })
@Index('gst_verifications_tenant_gstin_idx', ['tenantId', 'gstin'])
export class GstVerificationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ type: 'varchar', length: 15 }) gstin!: string;
  /** IDfy request_id; null when IDfy was never reached. */
  @Column({ name: 'request_id', type: 'varchar', length: 100, nullable: true })
  requestId!: string | null;
  @Column({ type: 'enum', enum: [...GST_VERIFICATION_RESULTS] }) status!: GstVerificationResult;
  @Column({ name: 'legal_name', type: 'varchar', length: 255, nullable: true })
  legalName!: string | null;
  @Column({ name: 'trade_name', type: 'varchar', length: 255, nullable: true })
  tradeName!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) constitution!: string | null;
  @Column({ name: 'taxpayer_type', type: 'varchar', length: 100, nullable: true })
  taxpayerType!: string | null;
  @Column({ name: 'gstin_status', type: 'varchar', length: 50, nullable: true })
  gstinStatus!: string | null;
  @Column({ name: 'registered_since', type: 'varchar', length: 30, nullable: true })
  registeredSince!: string | null;
  @Column({ name: 'registered_address', type: 'text', nullable: true })
  registeredAddress!: string | null;
  @Column({ name: 'address_parts', type: 'jsonb', nullable: true })
  addressParts!: GstAddressParts | null;
  @Column({ name: 'state_code', type: 'varchar', length: 2 }) stateCode!: string;
  @Column({ name: 'raw_response', type: 'jsonb', nullable: true })
  rawResponse!: Record<string, unknown> | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
