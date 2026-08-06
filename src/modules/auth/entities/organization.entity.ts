import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { OrganizationDocumentEntity } from './organization-document.entity';

// Single source of truth for the status value set — reused by admin.validators.ts's zod schema
// so the two can't drift again the way they did before (DB had no 'suspended', validator had a
// phantom one and was missing 'rejected'/'partial_pending').
export const ORGANIZATION_STATUSES = ['active', 'rejected', 'pending', 'partial_pending', 'draft', 'suspended'] as const;
export type OrganizationStatus = typeof ORGANIZATION_STATUSES[number];

@Entity({ schema: 'auth', name: 'organizations' })
export class OrganizationEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'varchar', nullable: true })
    name!: string | null

    @Column({ type: 'enum', enum: ORGANIZATION_STATUSES })
    status!: OrganizationStatus

    @Column({ name: 'company_legal_name', type: 'varchar', nullable: true })
    companyLegalName!: string | null;

    @Column({ name: 'org_admin_name', type: 'varchar', nullable: true })
    orgAdminName!: string | null;

    @Column({ name: 'operational_city', type: 'varchar', nullable: true })
    operationalCity!: string | null;

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

    @Column({ type: 'varchar', nullable: true })
    pinCode!: string | null;

    @Column({ name: 'has_own_fleet', type: 'boolean', nullable: true })
    hasOwnFleet!: boolean | null;

    @Column({ name: 'fleet_size', type: 'int', nullable: true })
    fleetSize!: number | null;

    @OneToMany(() => OrganizationDocumentEntity, (document) => document.organization)
    documents!: OrganizationDocumentEntity[];

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt!: Date;
}
