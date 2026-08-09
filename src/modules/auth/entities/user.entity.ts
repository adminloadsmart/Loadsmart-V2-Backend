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
import { OrganizationEntity } from '../../organization/entities/organization.entity';
import { RoleEntity } from '../../roles/entities/role.entity';

@Entity({ schema: 'auth', name: 'users' })
@Index('users_email_active_unique', ['email'], { unique: true, where: '"deleted_at" IS NULL' })
// Matches the email index above: unique only among non-deleted users, so a deleted user's phone
// number can be reused. Closes a TOCTOU gap — signup/createStaffUser only pre-checked via a
// SELECT before INSERT, so two concurrent requests for the same phone could both pass that check
// and both insert; this constraint makes the DB itself the final word instead of relying solely
// on app-level timing.
@Index('users_phone_active_unique', ['phoneNumber'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @ManyToOne(() => OrganizationEntity, { nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  organization!: OrganizationEntity | null;

  @Column()
  phoneNumber!: string;

  // Nullable: org-signup users don't carry one today. Required at the API boundary for staff
  // created via POST /admin/staff (see auth.service.ts's createStaffUser).
  @Column({ name: 'full_name', type: 'varchar', nullable: true })
  fullName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  passwordHash!: string | null;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @ManyToOne(() => RoleEntity, { nullable: false })
  @JoinColumn({ name: 'role_id' })
  role!: RoleEntity;

  // Which city/region a platform-scope operational staff member (sales, KYC desk, load
  // console) covers. Null for org-signup users — this is a staff-only concept.
  @Column({ type: 'varchar', nullable: true })
  coverage!: string | null;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
