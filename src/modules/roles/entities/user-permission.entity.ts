import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { PermissionEntity } from './permission.entity';

// A permission granted directly to one user, on top of whatever their role already grants —
// this is where per-user flexibility lives instead of one-off custom roles. Revoking is a hard
// delete from this table; the historical record lives in audit.audit_logs (see role.service.ts).
@Entity({ schema: 'auth', name: 'user_permissions' })
@Index('user_permissions_unique', ['userId', 'permissionId'], { unique: true })
export class UserPermissionEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @ManyToOne(() => UserEntity)
    @JoinColumn({ name: 'user_id' })
    user!: UserEntity;

    @Column({ name: 'permission_id', type: 'uuid' })
    permissionId!: string;

    @ManyToOne(() => PermissionEntity)
    @JoinColumn({ name: 'permission_id' })
    permission!: PermissionEntity;

    // Plain uuid, no relation — audit trail only (who granted this).
    @Column({ name: 'granted_by', type: 'uuid' })
    grantedBy!: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date;
}
