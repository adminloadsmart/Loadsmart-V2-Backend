import { DataSource, Repository } from 'typeorm';
import { NotificationEntity } from './notifications.entity';

export class NotificationRepository {
  private readonly repo: Repository<NotificationEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(NotificationEntity);
  }

  async create(data: Partial<NotificationEntity>): Promise<NotificationEntity> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  findById(id: string): Promise<NotificationEntity | null> {
    return this.repo.findOneBy({ id });
  }
}
