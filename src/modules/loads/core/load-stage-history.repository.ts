import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { LoadStageHistoryEntity } from '../entities/load-stage-history.entity';

export type StageHistoryRow = Omit<LoadStageHistoryEntity, 'id' | 'exitedAt'>;

export class LoadStageHistoryRepository {
  private readonly rows: Repository<LoadStageHistoryEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.rows = dataSource.getRepository(LoadStageHistoryEntity);
  }

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  /** Closes the load's open stage at `row.enteredAt` and opens `row`. */
  async recordMove(manager: EntityManager, row: StageHistoryRow): Promise<void> {
    const repo = manager.getRepository(LoadStageHistoryEntity);
    await repo.update(
      { tenantId: row.tenantId, loadId: row.loadId, exitedAt: IsNull() },
      { exitedAt: row.enteredAt },
    );
    await repo.save(repo.create(row));
  }

  listForLoad(tenantId: string, loadId: string): Promise<LoadStageHistoryEntity[]> {
    return this.rows.find({ where: { tenantId, loadId }, order: { enteredAt: 'ASC' } });
  }
}
