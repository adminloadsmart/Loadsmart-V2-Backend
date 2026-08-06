import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index, OneToMany } from 'typeorm';
import { FleetDriverLinkEntity } from './fleet-driver-link.entity';
import { DriverDocumentEntity } from './driver-document.entity';
import { DriverVerificationEntity } from './driver-verification.entity';
import { DriverBankDetailsEntity } from './driver-bank-details.entity';
import { DriverStatus } from '../utils/drivers.types';

@Entity({ schema: 'masters', name: 'drivers' })
@Index('drivers_tenant_id_idx', ['tenantId'])
@Index('drivers_tenant_phone_number_active_unique', ['tenantId', 'phoneNumber'], { unique: true, where: '"deleted_at" IS NULL' })
export class DriverEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'tenant_id', type: 'uuid' })
    tenantId!: string;

    @Column({ name: 'full_name', type: 'varchar', length: 150 })
    fullName!: string;

    @Column({ name: 'phone_number', type: 'varchar', length: 15 })
    phoneNumber!: string;

    @Column({ name: 'license_number', type: 'varchar', length: 30, nullable: true })
    licenseNumber!: string | null;

    @Column({ name: 'license_verified', type: 'boolean', default: false })
    licenseVerified!: boolean;

    @Column({ name: 'license_expiry', type: 'date', nullable: true })
    licenseExpiry!: string | null;

    @Column({ name: 'date_of_joining', type: 'date', nullable: true })
    dateOfJoining!: string | null;

    @Column({ type: 'enum', enum: ['active', 'inactive', 'blacklisted'], default: 'active' })
    status!: DriverStatus;

    @OneToMany(() => FleetDriverLinkEntity, (link) => link.driver)
    vehicleLinks!: FleetDriverLinkEntity[];

    @OneToMany(() => DriverDocumentEntity, (document) => document.driver)
    documents!: DriverDocumentEntity[];

    @OneToMany(() => DriverVerificationEntity, (verification) => verification.driver)
    verifications!: DriverVerificationEntity[];

    @OneToMany(() => DriverBankDetailsEntity, (bankDetails) => bankDetails.driver)
    bankDetails!: DriverBankDetailsEntity[];

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
