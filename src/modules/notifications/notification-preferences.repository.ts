import { DataSource, Repository } from 'typeorm';
import { NotificationTypeEntity } from './entities/notification-type.entity';
import { NotificationPreferenceEntity } from './entities/notification-preference.entity';

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

  constructor(dataSource: DataSource) {
    this.types = dataSource.getRepository(NotificationTypeEntity);
    this.preferences = dataSource.getRepository(NotificationPreferenceEntity);
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
}
