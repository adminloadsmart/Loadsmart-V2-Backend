import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DEMO_REQUEST_PRODUCTS, DemoRequestProduct } from './demo-requests.types';

/** A "Book a Demo" request from the public landing page. Write-only for now: there is no screen
 *  that lists these yet, the sales team reads them straight from the table. */
@Entity({ schema: 'marketing', name: 'demo_requests' })
@Index('demo_requests_created_at_idx', ['createdAt'])
@Index('demo_requests_email_idx', ['email'])
export class DemoRequestEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 120 }) name!: string;
  @Column({ name: 'company_name', type: 'varchar', length: 160 }) companyName!: string;
  /** Stored lower-cased. */
  @Column({ type: 'varchar', length: 254 }) email!: string;
  /** 10 digits, no country code — the same convention as every other stored number. */
  @Column({ name: 'phone_number', type: 'varchar', length: 10 }) phoneNumber!: string;
  @Column({
    type: 'enum',
    enum: DEMO_REQUEST_PRODUCTS,
    enumName: 'demo_requests_product_enum',
  })
  product!: DemoRequestProduct;
  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress!: string | null;
  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  userAgent!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
