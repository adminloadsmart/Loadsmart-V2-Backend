import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

// Backs countRecentFailedAttempts' exact WHERE clause (email, ip_address, success, created_at
// range) — the brute-force lockout check itself was a full table scan on an ever-growing,
// never-pruned table before this.
@Entity({ schema: 'auth', name: 'login_attempts' })
@Index('login_attempts_email_ip_success_created_idx', [
  'email',
  'ipAddress',
  'success',
  'createdAt',
])
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
