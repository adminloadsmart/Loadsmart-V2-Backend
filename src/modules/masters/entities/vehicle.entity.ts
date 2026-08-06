import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from "typeorm";
import { VehicleDocumentEntity } from "./vehicle-document.entity";
import { FleetDriverLinkEntity } from "./fleet-driver-link.entity";
import { VehicleOwnershipType, VehicleStatus } from "../utils/vehicle.type";

@Entity({ schema: "masters", name: "vehicles" })
@Index("vehicles_tenant_id_idx", ["tenantId"])
@Index(
  "vehicles_tenant_registration_active_unique",
  ["tenantId", "registrationNumber"],
  { unique: true, where: '"deleted_at" IS NULL' },
)
export class VehicleEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "registration_number", type: "varchar", length: 20 })
  registrationNumber!: string;

  @Column({ name: "vehicle_type", type: "varchar", length: 50, nullable: true })
  vehicleType!: string | null;

  @Column({ name: "make", type: "varchar", length: 50, nullable: true })
  make!: string | null;

  @Column({ name: "model", type: "varchar", length: 50, nullable: true })
  model!: string | null;

  @Column({
    name: "capacity_tons",
    type: "numeric",
    precision: 6,
    scale: 2,
    nullable: true,
  })
  capacityTons!: string | null;

  @Column({
    name: "ownership_type",
    type: "enum",
    enum: ["owned", "leased"],
    default: "owned",
  })
  ownershipType!: VehicleOwnershipType;

  @Column({
    type: "enum",
    enum: ["active", "inactive", "under_maintenance"],
    default: "active",
  })
  status!: VehicleStatus;

  @OneToMany(() => VehicleDocumentEntity, (document) => document.vehicle)
  documents!: VehicleDocumentEntity[];

  @OneToMany(() => FleetDriverLinkEntity, (link) => link.vehicle)
  driverLinks!: FleetDriverLinkEntity[];

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
