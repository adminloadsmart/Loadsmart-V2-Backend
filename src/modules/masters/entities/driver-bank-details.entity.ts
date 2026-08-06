import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { DriverEntity } from "./driver.entity";
import { DRIVER_BANK_VERIFICATION_STATUSES, DriverBankVerificationStatus } from '../utils/drivers.types';

@Entity({ schema: "masters", name: "driver_bank_details" })
@Index("driver_bank_details_tenant_id_idx", ["tenantId"])
@Index("driver_bank_details_driver_id_idx", ["driverId"])
export class DriverBankDetailsEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "driver_id", type: "uuid" })
  driverId!: string;

  @ManyToOne(() => DriverEntity, (driver) => driver.bankDetails, {
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "driver_id" })
  driver!: DriverEntity;

  @Column({ name: "account_number", type: "varchar", length: 30 })
  accountNumber!: string;

  @Column({ type: "varchar", length: 11 })
  ifsc!: string;

  @Column({
    name: "account_holder_name",
    type: "varchar",
    length: 150,
    nullable: true,
  })
  accountHolderName!: string | null;

  @Column({
    name: "verification_status",
    type: "enum",
    enum: [...DRIVER_BANK_VERIFICATION_STATUSES],
    default: "pending",
  })
  verificationStatus!: DriverBankVerificationStatus;

  @Column({ name: "verified_at", type: "timestamptz", nullable: true })
  verifiedAt!: Date | null;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy!: string | null;

  @Column({ name: "updated_by", type: "uuid", nullable: true })
  updatedBy!: string | null;

  @Column({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
