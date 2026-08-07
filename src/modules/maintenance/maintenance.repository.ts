import { DataSource, Repository } from 'typeorm';
import { MaintenanceRecordEntity } from './maintenance.entity';

export class MaintenanceRepository {
  private readonly repo: Repository<MaintenanceRecordEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(MaintenanceRecordEntity);
  }

  async create(data: Partial<MaintenanceRecordEntity>): Promise<MaintenanceRecordEntity> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  findById(id: string): Promise<MaintenanceRecordEntity | null> {
    return this.repo.findOneBy({ id });
  }
}
