import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'auth', name: 'login_attempts' })
export class LoginAttemptEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column()
    email!: string;

    @Column()
    success!: boolean;

    @Column({ name: 'ip_address', type: 'varchar', nullable: true })
    ipAddress!: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date;
}
