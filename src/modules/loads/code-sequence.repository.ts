import { DataSource, EntityManager, Repository } from 'typeorm';
import { CodeSequenceEntity } from './entities/code-sequence.entity';

export type CodeSequenceEntityKind = 'requisition' | 'load';

export class CodeSequenceRepository {
  private readonly sequences: Repository<CodeSequenceEntity>;

  constructor(dataSource: DataSource) {
    this.sequences = dataSource.getRepository(CodeSequenceEntity);
  }

  /**
   * Atomically returns the next integer for (entityKind, scopeId), row-locked inside the
   * caller's transaction so two concurrent creates against the same scope can never see the
   * same value. `scopeId` is the tenant for requisition codes (REQ-nnnn) and the requisition
   * for load codes (REQ-nnnn-Lx, restarting at 1 per requisition).
   *
   * Must be called with the transactional `manager` from `dataSource.transaction(...)` — the
   * row lock only holds for the lifetime of that transaction. The very first call for a given
   * scope has no row to lock yet; two concurrent "first calls" racing to insert one is resolved
   * by Postgres itself (the second insert blocks on the unique constraint until the first
   * commits, then fails and falls back to the now-existing, lockable row) rather than by any
   * check-then-insert logic here.
   */
  async next(
    entityKind: CodeSequenceEntityKind,
    scopeId: string,
    manager: EntityManager,
  ): Promise<number> {
    const repo = manager.getRepository(CodeSequenceEntity);

    let row = await repo.findOne({
      where: { entity: entityKind, scopeId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!row) {
      try {
        row = await repo.save(repo.create({ entity: entityKind, scopeId, value: 0 }));
      } catch {
        row = await repo.findOneOrFail({
          where: { entity: entityKind, scopeId },
          lock: { mode: 'pessimistic_write' },
        });
      }
    }

    row.value += 1;
    await repo.save(row);
    return row.value;
  }
}
