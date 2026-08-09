import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { OrganizationEntity } from './organization.entity';

// A company can prove its identity through any one (or more) of these — see auth.validators.ts's
// createOrganization and organization.constants.ts's DOCUMENT_NUMBER_REGEX for the per-type number format.
export const ORGANIZATION_DOCUMENT_TYPES = [
  'gst_certificate',
  'pan',
  'udyam',
  'aadhaar',
  'cin',
  'shop_establishment',
] as const;
export type OrganizationDocumentType = (typeof ORGANIZATION_DOCUMENT_TYPES)[number];

// Same value set as the old GstinVerificationStatus it replaces — nothing in this codebase sets
// it to 'verified'/'invalid' automatically yet (no gov-API integration wired up), only the admin
// PATCH /admin/organizations/:organizationId/documents/:documentId endpoint does.
export type DocumentVerificationStatus = 'pending' | 'verified' | 'invalid';

// Shape accepted by AuthService.createOrganization / OrganizationDocumentService / Repository —
// a single submitted document, verified either by number or by an uploaded file's storage key.
// registeredName/dob/address are self-declared as printed on that specific document (e.g. GST
// legal name & registered address, PAN/Aadhaar holder name & DOB) — later cross-checked against
// the gov-API response once that integration exists. Not every type uses every field (e.g. `dob`
// only makes sense for individual-linked documents like PAN/Aadhaar) — none are enforced required.
export interface OrganizationDocumentInput {
  documentType: OrganizationDocumentType;
  documentNumber?: string;
  documentUrl?: string;
}

@Entity({ schema: 'auth', name: 'organization_documents' })
@Index('organization_documents_organization_id_idx', ['organizationId'])
// Only one *active* row per (organization, documentType) — resubmitting a type soft-deletes the
// old row first (see OrganizationDocumentRepository), so this never blocks a legitimate resubmit,
// only concurrent duplicates. Mirrors DriverEntity's phone-number partial unique index.
@Index('organization_documents_org_type_active_unique', ['organizationId', 'documentType'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class OrganizationDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, (organization) => organization.documents, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'document_type', type: 'enum', enum: ORGANIZATION_DOCUMENT_TYPES })
  documentType!: OrganizationDocumentType;

  // Verify-by-number path — the document's official government-issued number.
  @Column({ name: 'document_number', type: 'varchar', nullable: true })
  documentNumber!: string | null;

  // Verify-by-upload path — a storage key handed back by a future, separate upload API. Never a
  // binary/file itself; this table only ever stores the reference string.
  @Column({ name: 'file_key', type: 'varchar', nullable: true })
  fileKey!: string | null;

  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: ['pending', 'verified', 'invalid'],
    default: 'pending',
  })
  verificationStatus!: DocumentVerificationStatus;

  @Column({ name: 'is_vaild', type: 'boolean', default: false })
  isVaild!: boolean;

  // Self-declared, as printed on this specific document — see OrganizationDocumentInput above.
  @Column({ name: 'registered_name', type: 'varchar', nullable: true })
  registeredName!: string | null;

  @Column({ type: 'date', nullable: true })
  dob!: string | null;

  @Column({ name: 'address_line_1', type: 'varchar', nullable: true })
  addressLine1!: string | null;

  @Column({ name: 'address_line_2', type: 'varchar', nullable: true })
  addressLine2!: string | null;

  @Column({ type: 'varchar', nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', nullable: true })
  district!: string | null;

  @Column({ type: 'varchar', nullable: true })
  state!: string | null;

  @Column({ name: 'pin_code', type: 'varchar', nullable: true })
  pinCode!: string | null;

  // Hooks for a future automated gov-API verification call (not built yet) — mirrors
  // driver-verification.entity.ts's sourceReference/rawResponse.
  @Column({ name: 'source_reference', type: 'varchar', length: 100, nullable: true })
  sourceReference!: string | null;

  @Column({ name: 'raw_response', type: 'jsonb', nullable: true })
  rawResponse!: Record<string, unknown> | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
