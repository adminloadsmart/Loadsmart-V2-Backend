import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToMany,
    JoinTable,
} from 'typeorm';
import { PermissionEntity } from './permission.entity';

export type RoleScope = 'platform' | 'organization';

// Fixed catalog: six rows, seeded once via migration, never created/edited/deleted through the
// app. Flexibility comes from user_permissions (see user-permission.entity.ts), not from more
// roles — see the RBAC plan for why.
@Entity({ schema: 'auth', name: 'roles' })
export class RoleEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    // 'platform_admin', 'sales', 'online_kyc_desk', 'offline_kyc_desk', 'load_console', 'org_admin'
    @Column({ unique: true })
    name!: string;

    @Column({ type: 'enum', enum: ['platform', 'organization'] })
    scope!: RoleScope;

    @ManyToMany(() => PermissionEntity)
    @JoinTable({
        name: 'role_permissions',
        schema: 'auth',
        joinColumn: { name: 'role_id' },
        inverseJoinColumn: { name: 'permission_id' },
    })
    permissions!: PermissionEntity[];

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt!: Date;
}
