import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'notifications', name: 'notification_templates' })
export class NotificationTemplateEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'template_id' })
    templateId!: string;

    @Column()
    body!: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt!: Date;
}
