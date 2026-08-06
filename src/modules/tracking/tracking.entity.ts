import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'tracking', name: 'tracking_events' })
export class TrackingEventEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'tenant_id' })
    tenantId!: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt!: Date;
}
