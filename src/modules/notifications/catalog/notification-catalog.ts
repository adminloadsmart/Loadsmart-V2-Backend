import {
  ORG_ADMIN_ROLE,
  DISPATCH_ROLE,
  DOCUMENTS_OPS_ROLE,
  FINANCE_ACCOUNTS_ROLE,
} from '../../../shared/constants/roles';
import { env } from '../../../config/env';
import { NotificationTemplates, NotificationTypeDefinition } from './notification-catalog.types';

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

export interface OrganizationApprovedContext {
  orgName: string;
}

export interface OrganizationSignupReceivedContext {
  orgName: string;
}

type NoContext = Record<string, never>;

/** First word of the recipient's name for "Hi {{first_name}}" copy — the org-signup user's
 *  fullName is optional (saved in the onboarding user-details step), hence the fallback. */
function firstNameOf(fullName: string | null): string {
  return fullName?.trim().split(/\s+/)[0] || 'there';
}

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
    severity: 'p2_action',
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
    severity: 'p1_critical',
    buildContent: ({ complianceType, vehicleNo, expiryDate }: VehicleComplianceContext) => ({
      title: 'Vehicle compliance expired',
      body: `${complianceType} for vehicle ${vehicleNo} expired on ${expiryDate}. The vehicle may be blocked from dispatch until valid documents are updated.`,
      // Key order here IS the WhatsApp template's {{1}}/{{2}}/{{3}} placeholder order — see
      // channels/whatsapp.channel.ts. The MSG91-dashboard template must be authored to match:
      // {{1}} = compliance type, {{2}} = vehicle no, {{3}} = expiry date.
      metadata: { compliance_type: complianceType, vehicle_no: vehicleNo, expiry_date: expiryDate },
    }),
  },

  // LS_N_0001 — fired once by admin.service.ts's approveOrganization. The WhatsApp/SMS/email
  // copy itself lives in MSG91 templates (DLT/Meta-approved); this app only sends the variables.
  // SMS always goes out; WhatsApp only when whatsappOptIn is true — not captured (null) or
  // declined means SMS only (see notify-by-type.ts).
  'organization.account_approved': {
    label: 'Account approved',
    description: 'Your organisation has been approved on Loadsmart.',
    recipientRoles: [ORG_ADMIN_ROLE],
    channels: ['whatsapp', 'sms', 'email'],
    defaultChannels: ['whatsapp', 'sms', 'email'],
    severity: 'p2_action',
    frequency: 'once_per_tenant',
    requiresWhatsappOptIn: true,
    templates: {
      whatsapp: {
        templateName: env.msg91WhatsappTemplateOrgApproved,
        variables: ['first_name', 'org_name'],
      },
      sms: { templateId: env.msg91SmsTemplateOrgApproved, variables: { var1: 'org_name' } },
      email: {
        templateId: env.msg91EmailTemplateOrgApproved,
        variables: { first_name: 'first_name', org_name: 'org_name' },
      },
    },
    buildContent: ({ orgName }: OrganizationApprovedContext, recipient) => {
      const firstName = firstNameOf(recipient.fullName);
      return {
        title: `${orgName} is live on Loadsmart`,
        body: `Welcome ${firstName}. Your account is approved. Add your vehicles and drivers, then create your first trip.`,
        metadata: {
          first_name: firstName,
          org_name: orgName,
          cta_label: 'Set up my fleet',
          cta_path: '/',
        },
      };
    },
  },

  // LS_N_0002 — fired by auth.service.ts's submitOrganization on the org's first submission for
  // review (not correction resubmits). SMS + email only: no WhatsApp opt-in exists yet at this
  // point. SMS/email copy lives in MSG91 templates; this app only sends the variables.
  'organization.signup_received': {
    label: 'Signup received',
    description: 'Your application has been received and is under review.',
    recipientRoles: [ORG_ADMIN_ROLE],
    channels: ['sms', 'email'],
    defaultChannels: ['sms', 'email'],
    severity: 'p3_info',
    frequency: 'once_per_tenant',
    // Spec: in-app "Not applicable, no app access yet" — stored for tracking, hidden in the app.
    inApp: false,
    templates: {
      sms: { templateId: env.msg91SmsTemplateSignupReceived, variables: { var1: 'org_name' } },
      email: {
        templateId: env.msg91EmailTemplateSignupReceived,
        variables: { first_name: 'first_name', org_name: 'org_name' },
      },
    },
    buildContent: ({ orgName }: OrganizationSignupReceivedContext, recipient) => {
      const firstName = firstNameOf(recipient.fullName);
      return {
        title: `We have your application for ${orgName}`,
        body: `${firstName}, we are verifying the GST and PAN details for ${orgName}. Most accounts are approved within one working day and we will message you as soon as it is done.`,
        metadata: { first_name: firstName, org_name: orgName },
      };
    },
  },

  // --- Placeholders below: settings-screen metadata only, no trigger built yet. ---

  'load.stage_handoff': {
    label: 'Stage handoff',
    description: 'Dispatched, reached loading point, in-transit, and delivered updates.',
    recipientRoles: [DISPATCH_ROLE, DOCUMENTS_OPS_ROLE],
    channels: [...ALL_CHANNELS],
    defaultChannels: ['push'],
    severity: 'p3_info',
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
    severity: 'p1_critical',
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
    severity: 'p2_action',
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
    severity: 'p2_action',
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
    severity: 'p2_action',
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
    severity: 'p1_critical',
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
    severity: 'p2_action',
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
    severity: 'p2_action',
    buildContent: stub(
      'Maintenance & Compliance due',
      'Odometer threshold reached, scheduled servicing alert, oil changes.',
    ),
  },
} satisfies Record<string, NotificationTypeDefinition<any>>;

/** Per-type MSG91 template config for the channels (see channels/*.channel.ts) — undefined for a
 *  type with none, which keeps each channel on its env-level default template. */
export function getNotificationTemplates(type: string): NotificationTemplates | undefined {
  return (NOTIFICATION_CATALOG as Record<string, { templates?: NotificationTemplates }>)[type]
    ?.templates;
}

/** Types stored but never shown in the app (`inApp: false`) — excluded by the in-app read
 *  endpoints (see notifications.service.ts). */
export const IN_APP_HIDDEN_TYPES: string[] = Object.entries(
  NOTIFICATION_CATALOG as Record<string, { inApp?: boolean }>,
)
  .filter(([, definition]) => definition.inApp === false)
  .map(([key]) => key);

/** Builds a template's `{ templateVar: value }` payload from the notification's metadata. */
export function mapTemplateVariables(
  mapping: Record<string, string>,
  metadata: Record<string, unknown> | null,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mapping).map(([templateVar, key]) => [
      templateVar,
      String(metadata?.[key] ?? ''),
    ]),
  );
}
