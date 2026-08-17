import { DataSource, EntityManager, Repository } from 'typeorm';
import { LoadActivityEntity } from './entities/load-activity.entity';
import { CreateLoadActivityData } from './utils/load-activity.interface';

export class LoadActivityRepository {
  private readonly activities: Repository<LoadActivityEntity>;

  constructor(dataSource: DataSource) {
    this.activities = dataSource.getRepository(LoadActivityEntity);
  }

  create(data: CreateLoadActivityData, manager?: EntityManager): Promise<LoadActivityEntity> {
    const repo = manager?.getRepository(LoadActivityEntity) ?? this.activities;
    const activity = repo.create({
      ...data,
      fromValue: data.fromValue ?? null,
      toValue: data.toValue ?? null,
      metadata: data.metadata ?? null,
    });
    return repo.save(activity);
  }

  listByLoad(tenantId: string, loadId: string): Promise<LoadActivityEntity[]> {
    return this.activities.find({
      where: { tenantId, loadId },
      order: { createdAt: 'ASC' },
    });
  }
}
