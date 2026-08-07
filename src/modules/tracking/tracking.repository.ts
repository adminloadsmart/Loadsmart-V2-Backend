import { DataSource, Repository } from 'typeorm';
import { TrackingEventEntity } from './tracking.entity';

export class TrackingRepository {
  private readonly repo: Repository<TrackingEventEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(TrackingEventEntity);
  }

  async create(data: Partial<TrackingEventEntity>): Promise<TrackingEventEntity> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  findById(id: string): Promise<TrackingEventEntity | null> {
    return this.repo.findOneBy({ id });
  }
}
