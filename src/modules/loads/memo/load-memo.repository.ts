import { DataSource, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LoadMemoEntity } from './load-memo.entity';
import { CreateLoadMemoData } from '../utils/load-memo.interface';

export class LoadMemoRepository {
  private readonly memos: Repository<LoadMemoEntity>;

  constructor(dataSource: DataSource) {
    this.memos = dataSource.getRepository(LoadMemoEntity);
  }

  /** The newest memo on the load — the only one that can still be accepted. */
  findLatest(tenantId: string, loadId: string): Promise<LoadMemoEntity | null> {
    return this.memos.findOne({ where: { tenantId, loadId }, order: { version: 'DESC' } });
  }

  /** Every version, latest first. */
  listByLoad(tenantId: string, loadId: string): Promise<LoadMemoEntity[]> {
    return this.memos.find({ where: { tenantId, loadId }, order: { version: 'DESC' } });
  }

  async nextVersion(tenantId: string, loadId: string): Promise<number> {
    const row = await this.memos
      .createQueryBuilder('memo')
      .select('COALESCE(MAX(memo.version), 0)', 'max')
      .where('memo.tenant_id = :tenantId AND memo.load_id = :loadId', { tenantId, loadId })
      .getRawOne<{ max: string }>();
    return Number(row?.max ?? 0) + 1;
  }

  create(data: CreateLoadMemoData): Promise<LoadMemoEntity> {
    return this.memos.save(this.memos.create({ ...data, status: 'sent' }));
  }

  /** A memo still open on the load is superseded by the next version. */
  async supersedeOpen(tenantId: string, loadId: string): Promise<void> {
    await this.memos.update({ tenantId, loadId, status: 'sent' }, { status: 'superseded' });
  }

  async markWithdrawn(memo: LoadMemoEntity): Promise<boolean> {
    const result = await this.memos.update(
      { id: memo.id, tenantId: memo.tenantId, status: 'sent' },
      { status: 'withdrawn' },
    );
    return result.affected === 1;
  }

  async markExpired(memo: LoadMemoEntity): Promise<void> {
    await this.memos.update(
      { id: memo.id, tenantId: memo.tenantId, status: 'sent' },
      {
        status: 'expired',
      },
    );
  }

  /** Accepts the memo only while it is still `sent` — the race guard against a double accept. */
  async accept(
    memo: LoadMemoEntity,
    data: QueryDeepPartialEntity<LoadMemoEntity>,
  ): Promise<LoadMemoEntity | null> {
    const result = await this.memos.update(
      { id: memo.id, tenantId: memo.tenantId, status: 'sent' },
      { ...data, status: 'accepted' },
    );
    if (result.affected !== 1) return null;
    return this.memos.findOneBy({ id: memo.id, tenantId: memo.tenantId });
  }
}
