import { DOCUMENTS_OPS_ROLE, DISPATCH_ROLE, ORG_ADMIN_ROLE } from '../../../shared/constants/roles';
import { NotificationTypeDefinition } from './notification-catalog.types';

export interface VehicleComplianceContext {
  complianceType: string;
  vehicleNo: string;
  expiryDate: string;
}

export const VEHICLE_NOTIFICATION_CATALOG = {
  'vehicle.compliance_expiring_soon': {
    recipientRoles: [DOCUMENTS_OPS_ROLE, DISPATCH_ROLE],
    channels: ['push'],
    buildContent: ({ complianceType, vehicleNo, expiryDate }: VehicleComplianceContext) => ({
      title: 'Vehicle compliance expiring soon',
      body: `${complianceType} for vehicle ${vehicleNo} expires in 15 days on ${expiryDate}. Please renew it before the expiry date.`,
    }),
  },
  'vehicle.compliance_expired': {
    recipientRoles: [DOCUMENTS_OPS_ROLE, DISPATCH_ROLE, ORG_ADMIN_ROLE],
    channels: ['whatsapp', 'push'],
    buildContent: ({ complianceType, vehicleNo, expiryDate }: VehicleComplianceContext) => ({
      title: 'Vehicle compliance expired',
      body: `${complianceType} for vehicle ${vehicleNo} expired on ${expiryDate}. The vehicle may be blocked from dispatch until valid documents are updated.`,
      // Key order here IS the WhatsApp template's {{1}}/{{2}}/{{3}} placeholder order — see
      // channels/whatsapp.channel.ts. The MSG91-dashboard template must be authored to match:
      // {{1}} = compliance type, {{2}} = vehicle no, {{3}} = expiry date.
      metadata: { compliance_type: complianceType, vehicle_no: vehicleNo, expiry_date: expiryDate },
    }),
  },
} satisfies Record<string, NotificationTypeDefinition<VehicleComplianceContext>>;
