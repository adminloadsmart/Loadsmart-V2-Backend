import { DataSource, In, Repository } from 'typeorm';
import { NotificationTypeEntity } from './entities/notification-type.entity';
import { NotificationPreferenceEntity } from './entities/notification-preference.entity';
import { NotificationQuietHoursEntity } from './entities/notification-quiet-hours.entity';
import { UserNotificationPreferenceEntity } from './entities/user-notification-preference.entity';
import { ChannelPreferenceFlags, QuietHoursSetting } from './notifications.interface';

export interface UpsertPreferenceInput {
  notificationTypeId: string;
  email: boolean;
  sms: boolean;
  push: boolean;
  whatsapp: boolean;
}

export class NotificationPreferencesRepository {
  private readonly types: Repository<NotificationTypeEntity>;
  private readonly preferences: Repository<NotificationPreferenceEntity>;
  private readonly quietHours: Repository<NotificationQuietHoursEntity>;
  private readonly userPreferences: Repository<UserNotificationPreferenceEntity>;

  constructor(dataSource: DataSource) {
    this.types = dataSource.getRepository(NotificationTypeEntity);
    this.preferences = dataSource.getRepository(NotificationPreferenceEntity);
    this.quietHours = dataSource.getRepository(NotificationQuietHoursEntity);
    this.userPreferences = dataSource.getRepository(UserNotificationPreferenceEntity);
  }

  listTypes(): Promise<NotificationTypeEntity[]> {
    return this.types.find({ order: { label: 'ASC' } });
  }

  findTypeByKey(key: string): Promise<NotificationTypeEntity | null> {
    return this.types.findOneBy({ key });
  }

  /** Backs the settings screen's GET — every notification type, alongside this tenant's saved
   *  preference row if one exists (null means every channel is off — see the entity's doc
   *  comment). Org-wide: same result for every user in the tenant. */
  async listWithPreferencesForTenant(
    tenantId: string,
  ): Promise<{ type: NotificationTypeEntity; preference: NotificationPreferenceEntity | null }[]> {
    const [types, tenantPreferences] = await Promise.all([
      this.listTypes(),
      this.preferences.find({ where: { tenantId } }),
    ]);
    const preferenceByTypeId = new Map(
      tenantPreferences.map((preference) => [preference.notificationTypeId, preference]),
    );
    return types.map((type) => ({ type, preference: preferenceByTypeId.get(type.id) ?? null }));
  }

  /** One row per (tenant, type) — every recipient of a dispatch for this tenant shares the same
   *  preference row; see notify-by-type.ts. Null means every channel is off. */
  findByTenantAndTypeId(
    tenantId: string,
    notificationTypeId: string,
  ): Promise<NotificationPreferenceEntity | null> {
    return this.preferences.findOneBy({ tenantId, notificationTypeId });
  }

  /** Insert-or-update on the unique (tenantId, notificationTypeId) index, one row per item. */
  async upsertPreferences(tenantId: string, items: UpsertPreferenceInput[]): Promise<void> {
    for (const item of items) {
      const existing = await this.preferences.findOneBy({
        tenantId,
        notificationTypeId: item.notificationTypeId,
      });
      if (existing) {
        existing.emailEnabled = item.email;
        existing.smsEnabled = item.sms;
        existing.pushEnabled = item.push;
        existing.whatsappEnabled = item.whatsapp;
        await this.preferences.save(existing);
      } else {
        await this.preferences.save(
          this.preferences.create({
            tenantId,
            notificationTypeId: item.notificationTypeId,
            emailEnabled: item.email,
            smsEnabled: item.sms,
            pushEnabled: item.push,
            whatsappEnabled: item.whatsapp,
          }),
        );
      }
    }
  }

  /** Deletes every saved preference row for this tenant — missing row means all channels off, so
   *  this is exactly "reset to default" with no separate default-state bookkeeping needed. */
  async resetToDefault(tenantId: string): Promise<void> {
    await this.preferences.delete({ tenantId });
  }

  /** Every organisation-level row for this tenant (the org_admin's settings) — the starting
   *  point for users who haven't customised a type. */
  listOrganizationPreferences(tenantId: string): Promise<NotificationPreferenceEntity[]> {
    return this.preferences.find({ where: { tenantId } });
  }

  /** One user's own saved rows, all types. */
  listUserPreferences(
    tenantId: string,
    userId: string,
  ): Promise<UserNotificationPreferenceEntity[]> {
    return this.userPreferences.find({ where: { tenantId, userId } });
  }

  /** The saved rows of several users for one type — one query per dispatch (notify-by-type.ts). */
  listUserPreferencesForType(
    tenantId: string,
    notificationTypeId: string,
    userIds: string[],
  ): Promise<UserNotificationPreferenceEntity[]> {
    if (!userIds.length) return Promise.resolve([]);
    return this.userPreferences.find({
      where: { tenantId, notificationTypeId, userId: In(userIds) },
    });
  }

  /** Insert-or-update on the unique (tenant, user, type) index. */
  async upsertUserPreferences(
    tenantId: string,
    userId: string,
    items: { notificationTypeId: string; channels: ChannelPreferenceFlags }[],
  ): Promise<void> {
    if (!items.length) return;
    await this.userPreferences.upsert(
      items.map(({ notificationTypeId, channels }) => ({
        tenantId,
        userId,
        notificationTypeId,
        inAppEnabled: channels.inApp,
        emailEnabled: channels.email,
        smsEnabled: channels.sms,
        pushEnabled: channels.push,
        whatsappEnabled: channels.whatsapp,
      })),
      ['tenantId', 'userId', 'notificationTypeId'],
    );
  }

  /** "Reset to Default" for one user — back to the organisation's setting / type defaults. */
  async deleteUserPreferences(tenantId: string, userId: string): Promise<void> {
    await this.userPreferences.delete({ tenantId, userId });
  }

  /** Null = this org never saved quiet hours (treated as off). */
  findQuietHours(tenantId: string): Promise<NotificationQuietHoursEntity | null> {
    return this.quietHours.findOneBy({ tenantId });
  }

  async upsertQuietHours(
    tenantId: string,
    setting: QuietHoursSetting,
    updatedBy: string,
  ): Promise<void> {
    await this.quietHours.upsert({ tenantId, ...setting, updatedBy }, ['tenantId']);
  }
}
