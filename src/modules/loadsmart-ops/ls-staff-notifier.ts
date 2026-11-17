import { In, IsNull } from 'typeorm';
import { NotFoundError } from '../../shared/errors';
import { LsStaffNotificationEntity } from './entities/ls-staff-notification.entity';
import { LoadsmartRepository } from './loadsmart.repository';

export interface StaffNotice {
  type: string;
  title: string;
  body: string;
  loadId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * The ops console's in-app inbox. Recipients are picked by permission (never by role name), so the
 * Admin team — whose bundle holds every team's keys — is included automatically, and so is the
 * owner account. Sending is best-effort: a notification that fails must never undo the money step
 * that caused it.
 */
export class LsStaffNotifier {
  constructor(private readonly repository: LoadsmartRepository) {}

  /** Tells everyone holding any of `permissionKeys`, except `excludeUserId` (the actor). */
  async notifyPermission(
    permissionKeys: string[],
    notice: StaffNotice,
    excludeUserId?: string,
  ): Promise<number> {
    try {
      const staff = await this.repository.listStaffWithPermission(permissionKeys);
      return await this.notifyUsers(
        staff.map((user) => user.id).filter((id) => id !== excludeUserId),
        notice,
      );
    } catch (error) {
      console.warn(`Staff notification "${notice.type}" failed`, error);
      return 0;
    }
  }

  /** Tells specific people — e.g. the member who raised the advance. */
  async notifyUsers(userIds: (string | null | undefined)[], notice: StaffNotice): Promise<number> {
    try {
      const recipients = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
      if (!recipients.length) return 0;
      await this.repository.staffNotifications.save(
        recipients.map((recipientUserId) =>
          this.repository.staffNotifications.create({
            recipientUserId,
            type: notice.type,
            title: notice.title,
            body: notice.body,
            loadId: notice.loadId ?? null,
            metadata: notice.metadata ?? {},
          }),
        ),
      );
      return recipients.length;
    } catch (error) {
      console.warn(`Staff notification "${notice.type}" failed`, error);
      return 0;
    }
  }

  async list(
    userId: string,
    options: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<{ unread: number; items: LsStaffNotificationEntity[] }> {
    const [items, unread] = await Promise.all([
      this.repository.staffNotifications.find({
        where: { recipientUserId: userId, ...(options.unreadOnly ? { readAt: IsNull() } : {}) },
        order: { createdAt: 'DESC' },
        take: Math.min(options.limit ?? 50, 200),
      }),
      this.repository.staffNotifications.countBy({ recipientUserId: userId, readAt: IsNull() }),
    ]);
    return { unread, items };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const result = await this.repository.staffNotifications.update(
      { id, recipientUserId: userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    if (!result.affected) {
      const exists = await this.repository.staffNotifications.existsBy({
        id,
        recipientUserId: userId,
      });
      if (!exists) throw new NotFoundError('Notification not found');
    }
  }

  async markAllRead(userId: string, ids?: string[]): Promise<number> {
    const result = await this.repository.staffNotifications.update(
      { recipientUserId: userId, readAt: IsNull(), ...(ids?.length ? { id: In(ids) } : {}) },
      { readAt: new Date() },
    );
    return result.affected ?? 0;
  }
}
