import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

export type PermissionScope = 'platform' | 'organization';

// Fixed catalog: developer-defined, grows only via migrations as features define new keys.
// Never created/edited through the app.
@Entity({ schema: 'auth', name: 'permissions' })
export class PermissionEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    // e.g. 'kyc.online.verify', 'masters.write'
    @Column({ unique: true })
    key!: string;

    // groups permissions in an admin UI — roughly matches module names
    @Column()
    module!: string;

    @Column({ type: 'enum', enum: ['platform', 'organization'] })
    scope!: PermissionScope;

    @Column({ type: 'varchar', nullable: true })
    description!: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date;
}
