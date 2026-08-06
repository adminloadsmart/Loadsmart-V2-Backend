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
import { DriverVerificationStatus, DriverVerificationType } from "../utils/drivers.types";
@Entity({ schema: "masters", name: "driver_verifications" })
@Index("driver_verifications_tenant_id_idx", ["tenantId"])
@Index("driver_verifications_driver_id_idx", ["driverId"])
export class DriverVerificationEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "driver_id", type: "uuid" })
  driverId!: string;

  @ManyToOne(() => DriverEntity, (driver) => driver.verifications, {
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "driver_id" })
  driver!: DriverEntity;

  @Column({ name: "verification_type", type: "enum", enum: ["sarathi_dl"] })
  verificationType!: DriverVerificationType;

  @Column({
    name: "verification_status",
    type: "enum",
    enum: ["pending", "verified", "not_found", "manual_review"],
    default: "pending",
  })
  verificationStatus!: DriverVerificationStatus;

  @Column({
    name: "source_reference",
    type: "varchar",
    length: 100,
    nullable: true,
  })
  sourceReference!: string | null;

  @Column({ name: "holder_name", type: "varchar", length: 150, nullable: true })
  holderName!: string | null;

  @Column({
    name: "license_number",
    type: "varchar",
    length: 30,
    nullable: true,
  })
  licenseNumber!: string | null;

  @Column({ name: "valid_until", type: "date", nullable: true })
  validUntil!: string | null;

  @Column({
    name: "address_line_1",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  addressLine1!: string | null;

  @Column({
    name: "address_line_2",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  addressLine2!: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  city!: string | null;

  @Column({ name: "pin_code", type: "varchar", length: 10, nullable: true })
  pinCode!: string | null;

  @Column({ name: "raw_response", type: "jsonb", nullable: true })
  rawResponse!: Record<string, unknown> | null;

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
