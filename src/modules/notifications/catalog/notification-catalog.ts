import {
  ORG_ADMIN_ROLE,
  DISPATCH_ROLE,
  DOCUMENTS_OPS_ROLE,
  FINANCE_ACCOUNTS_ROLE,
} from '../../../shared/constants/roles';
import { NotificationTypeDefinition } from './notification-catalog.types';

/**
 * Every notification type in the app, in one place — deliberately not split per domain: with a
 * small, fixed roster like this, one file is easier to scan than a "which catalog is this type
 * in" hunt across files. src/db/seed-notification-types.ts seeds notification_types straight from
 * this object.
 *
 * Every type currently lists all four channels as available — nothing is grayed out on the
 * settings screen. `defaultChannels` is what an org starts with before its admin has ever saved a
 * preference (matches the settings-screen mockup's shown toggle states); admins can turn any
 * channel on or off from there via PUT /notifications/preferences.
 *
 * Two entries (`vehicle.compliance_expiring_soon`/`vehicle.compliance_expired`) are real, wired to
 * an actual trigger (masters/vehicle/workers/vehicle-compliance-alerts.worker.ts) — their
 * defaultChannels mirror the original product spec (15-days-out: in-app/push only; expired:
 * email+WhatsApp+push). The rest are placeholders for notification types already shown on the
 * settings screen mockup but with no producer/trigger built yet — `buildContent` takes no context
 * and returns generic copy from the label/description below; recipientRoles are provisional best
 * guesses pending each one's real implementation, not confirmed product decisions.
 */

const ALL_CHANNELS = ['email', 'sms', 'push', 'whatsapp'] as const;

export interface VehicleComplianceContext {
  complianceType: string;
  vehicleNo: string;
  expiryDate: string;
}

type NoContext = Record<string, never>;

function stub(
  label: string,
  description: string,
): NotificationTypeDefinition<NoContext>['buildContent'] {
  return () => ({ title: label, body: description });
}

export const NOTIFICATION_CATALOG = {
  'vehicle.compliance_expiring_soon': {
    label: 'Vehicle compliance expiring soon',
    description:
      'Vehicle RC, Fitness certificate, Permit, Insurance, and PUC renewals due in 15 days.',
    recipientRoles: [DOCUMENTS_OPS_ROLE, DISPATCH_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push'],
    buildContent: ({ complianceType, vehicleNo, expiryDate }: VehicleComplianceContext) => ({
      title: 'Vehicle compliance expiring soon',
      body: `${complianceType} for vehicle ${vehicleNo} expires in 15 days on ${expiryDate}. Please renew it before the expiry date.`,
    }),
  },
  'vehicle.compliance_expired': {
    label: 'Vehicle compliance expired',
    description: 'Vehicle RC, Fitness certificate, Permit, Insurance, or PUC has expired.',
    recipientRoles: [DOCUMENTS_OPS_ROLE, DISPATCH_ROLE, ORG_ADMIN_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['email', 'whatsapp', 'push'],
    buildContent: ({ complianceType, vehicleNo, expiryDate }: VehicleComplianceContext) => ({
      title: 'Vehicle compliance expired',
      body: `${complianceType} for vehicle ${vehicleNo} expired on ${expiryDate}. The vehicle may be blocked from dispatch until valid documents are updated.`,
      // Key order here IS the WhatsApp template's {{1}}/{{2}}/{{3}} placeholder order — see
      // channels/whatsapp.channel.ts. The MSG91-dashboard template must be authored to match:
      // {{1}} = compliance type, {{2}} = vehicle no, {{3}} = expiry date.
      metadata: { compliance_type: complianceType, vehicle_no: vehicleNo, expiry_date: expiryDate },
    }),
  },

  // --- Placeholders below: settings-screen metadata only, no trigger built yet. ---

  'load.stage_handoff': {
    label: 'Stage handoff',
    description: 'Dispatched, reached loading point, in-transit, and delivered updates.',
    recipientRoles: [DISPATCH_ROLE, DOCUMENTS_OPS_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push'],
    buildContent: stub(
      'Stage handoff',
      'Dispatched, reached loading point, in-transit, and delivered updates.',
    ),
  },
  'load.eway_bill_expiry': {
    label: 'E-way bill expiry',
    description: 'Expiring within 4 hours or breached validity warnings.',
    recipientRoles: [DOCUMENTS_OPS_ROLE, DISPATCH_ROLE, ORG_ADMIN_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push', 'sms', 'email'],
    buildContent: stub(
      'E-way bill expiry',
      'Expiring within 4 hours or breached validity warnings.',
    ),
  },
  'vehicle.document_expiry': {
    label: 'Document expiry',
    description: 'Vehicle RC, Fitness certificate, National Permit, and Policy renewals.',
    recipientRoles: [DOCUMENTS_OPS_ROLE, ORG_ADMIN_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push', 'email'],
    buildContent: stub(
      'Document expiry',
      'Vehicle RC, Fitness certificate, National Permit, and Policy renewals.',
    ),
  },
  'driver.licence_expiry': {
    label: 'Driver licence expiry',
    description: 'Renewal notices scheduled at 30, 15, and 7 days prior to expiry.',
    recipientRoles: [DOCUMENTS_OPS_ROLE, ORG_ADMIN_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['sms', 'email'],
    buildContent: stub(
      'Driver licence expiry',
      'Renewal notices scheduled at 30, 15, and 7 days prior to expiry.',
    ),
  },
  'load.trip_delay_exception': {
    label: 'Trip delay & Exception',
    description: 'Route delay exceeding 2 hours or unscheduled prolonged stoppage.',
    recipientRoles: [DISPATCH_ROLE, DOCUMENTS_OPS_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push', 'sms'],
    buildContent: stub(
      'Trip delay & Exception',
      'Route delay exceeding 2 hours or unscheduled prolonged stoppage.',
    ),
  },
  'tracking.geofence_breach': {
    label: 'Geofence breach',
    description: 'Vehicle deviates from corridor > 5km or unapproved geofence exit.',
    recipientRoles: [DISPATCH_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push'],
    buildContent: stub(
      'Geofence breach',
      'Vehicle deviates from corridor > 5km or unapproved geofence exit.',
    ),
  },
  'payments.due_settlement': {
    label: 'Payment due & Settlement',
    description: 'Pending transporter balance, detention approval, and overdue ledger alerts.',
    recipientRoles: [FINANCE_ACCOUNTS_ROLE, ORG_ADMIN_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push', 'sms', 'email'],
    buildContent: stub(
      'Payment due & Settlement',
      'Pending transporter balance, detention approval, and overdue ledger alerts.',
    ),
  },
  'maintenance.compliance_due': {
    label: 'Maintenance & Compliance due',
    description: 'Odometer threshold reached, scheduled servicing alert, oil changes.',
    recipientRoles: [DOCUMENTS_OPS_ROLE, ORG_ADMIN_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['email'],
    buildContent: stub(
      'Maintenance & Compliance due',
      'Odometer threshold reached, scheduled servicing alert, oil changes.',
    ),
  },
} satisfies Record<string, NotificationTypeDefinition<any>>;
