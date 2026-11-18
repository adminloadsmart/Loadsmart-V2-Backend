import { DataSource, In, IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { LoadEntity } from '../entities/load.entity';
import { LoadCallEntity } from './load-call.entity';

export class LoadCallRepository {
  private readonly calls: Repository<LoadCallEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.calls = dataSource.getRepository(LoadCallEntity);
  }

  /** The load, scoped to a tenant when given (the shipper's routes). */
  findLoad(loadId: string, tenantId?: string): Promise<LoadEntity | null> {
    return this.dataSource.getRepository(LoadEntity).findOne({
      where: { id: loadId, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, tenantId: true, code: true },
    });
  }

  create(data: Partial<LoadCallEntity>): Promise<LoadCallEntity> {
    return this.calls.save(this.calls.create(data));
  }

  findById(callId: string): Promise<LoadCallEntity | null> {
    return this.calls.findOneBy({ id: callId });
  }

  listForLoad(loadId: string, teams?: string[]): Promise<LoadCallEntity[]> {
    return this.calls.find({
      where: { loadId, ...(teams ? { team: In(teams) } : {}) },
      order: { createdAt: 'DESC' },
    });
  }

  /** The user's open reminders (not done), soonest first; `dueBy` limits to those already due. */
  listOpenReminders(userId: string, dueBy?: Date): Promise<LoadCallEntity[]> {
    return this.calls.find({
      where: {
        calledByUserId: userId,
        reminderDoneAt: IsNull(),
        reminderAt: dueBy ? LessThanOrEqual(dueBy) : Not(IsNull()),
      },
      order: { reminderAt: 'ASC' },
    });
  }

  async markReminderDone(callId: string, at: Date): Promise<void> {
    await this.calls.update({ id: callId }, { reminderDoneAt: at });
  }

  /** Names for "called by" and the load codes for the reminder queue. */
  async userNames(userIds: string[]): Promise<Map<string, string | null>> {
    if (userIds.length === 0) return new Map();
    const users = await this.dataSource.getRepository(UserEntity).find({
      where: { id: In(userIds) },
      select: { id: true, fullName: true },
      withDeleted: true,
    });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }

  async loadCodes(loadIds: string[]): Promise<Map<string, string>> {
    if (loadIds.length === 0) return new Map();
    const loads = await this.dataSource
      .getRepository(LoadEntity)
      .find({ where: { id: In(loadIds) }, select: { id: true, code: true } });
    return new Map(loads.map((load) => [load.id, load.code]));
  }
}
