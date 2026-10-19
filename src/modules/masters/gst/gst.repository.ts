import { DataSource, Repository } from 'typeorm';
import { GstVerificationEntity } from './entities/gst-verification.entity';

export class GstVerificationRepository {
  private readonly verifications: Repository<GstVerificationEntity>;
  constructor(dataSource: DataSource) {
    this.verifications = dataSource.getRepository(GstVerificationEntity);
  }

  create(data: Omit<GstVerificationEntity, 'id' | 'createdAt'>): Promise<GstVerificationEntity> {
    return this.verifications.save(this.verifications.create(data));
  }

  findById(tenantId: string, id: string): Promise<GstVerificationEntity | null> {
    return this.verifications.findOneBy({ id, tenantId });
  }
}
