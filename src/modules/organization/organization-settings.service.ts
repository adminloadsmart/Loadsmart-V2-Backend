import { rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_LATE_DELIVERY_THRESHOLD_MINUTES } from './organization.constants';
import { OrganizationService } from './organization.service';
import { LateDeliverySetting } from './organization.types';

/**
 * Company-level settings the org admin owns (Settings). Today: LS_N_0030's "late by more than"
 * limit — stored on the organization, read by the tracking service when it judges a delay.
 */
export class OrganizationSettingsService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly auditService: AuditService,
  ) {}

  async getLateDelivery(tenantId: string): Promise<LateDeliverySetting> {
    try {
      const organization = await this.organizationService.getOrganizationStatus(tenantId);
      return viewOf(organization.lateDeliveryThresholdMinutes);
    } catch (error) {
      rethrow(error, 'Failed to read the late-delivery setting');
    }
  }

  /** `thresholdMinutes: null` resets to the default. */
  async updateLateDelivery(
    tenantId: string,
    actorId: string,
    thresholdMinutes: number | null,
  ): Promise<LateDeliverySetting> {
    try {
      const before = await this.organizationService.getOrganizationStatus(tenantId);
      const organization = await this.organizationService.updateOrganization(tenantId, {
        lateDeliveryThresholdMinutes: thresholdMinutes,
      });
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'ORGANIZATION_LATE_DELIVERY_THRESHOLD_UPDATED',
        resourceType: 'organization',
        oldData: { lateDeliveryThresholdMinutes: before.lateDeliveryThresholdMinutes },
        newData: { lateDeliveryThresholdMinutes: organization.lateDeliveryThresholdMinutes },
      });
      return viewOf(organization.lateDeliveryThresholdMinutes);
    } catch (error) {
      rethrow(error, 'Failed to update the late-delivery setting');
    }
  }
}

function viewOf(stored: number | null): LateDeliverySetting {
  return {
    thresholdMinutes: stored ?? DEFAULT_LATE_DELIVERY_THRESHOLD_MINUTES,
    isDefault: stored === null,
    defaultThresholdMinutes: DEFAULT_LATE_DELIVERY_THRESHOLD_MINUTES,
  };
}
