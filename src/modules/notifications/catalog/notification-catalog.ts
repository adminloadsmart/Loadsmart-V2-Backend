import {
  COMPLIANCE_MANAGE,
  CUSTOMERS_APPROVE,
  DISPATCH_PLANNING_MANAGE,
  MAINTENANCE_MANAGE,
  MASTERS_APPROVE,
} from '../../../shared/constants/permissions';
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
 * Entries with a real trigger say so in a comment above them (LS_N_xxxx). The rest are
 * placeholders for notification types already shown on the settings screen mockup but with no
 * producer/trigger built yet — `buildContent` takes no context and returns generic copy from the
 * label/description below; recipientRoles are provisional best guesses pending each one's real
 * implementation, not confirmed product decisions.
 */

const ALL_CHANNELS = ['email', 'sms', 'push', 'whatsapp'] as const;

export interface VehicleDocumentExpiringContext {
  vehicleId: string;
  vehicleNo: string;
  /** e.g. "Insurance", "Fitness Certificate". */
  docType: string;
  expiryDate: string;
  daysLeft: number;
  /** Trips already planned on this vehicle with pickup after the expiry date. */
  plannedTripCount: number;
  /** Other vehicle documents in the organisation expiring within the next 30 days. */
  otherCount: number;
  /** The check date (YYYY-MM-DD, India time) — one message per vehicle per day. */
  runDate: string;
}

export interface VehicleDocumentExpiredContext {
  vehicleId: string;
  vehicleNo: string;
  docType: string;
  expiryDate: string;
  /** Trips planned on this vehicle from today on, which now need another vehicle. */
  affectedTripCount: number;
  runDate: string;
}

export interface DriverLicenceExpiringContext {
  driverId: string;
  driverName: string;
  dlNo: string | null;
  expiryDate: string;
  daysLeft: number;
  /** Upcoming (not yet started) trips the driver is rostered on. */
  tripCount: number;
  runDate: string;
}

export interface DriverLicenceExpiredContext {
  driverId: string;
  driverName: string;
  dlNo: string | null;
  expiryDate: string;
  tripCount: number;
  runDate: string;
  /** 'initial' (9:00, reminded at 11:00) or 'escalation' (13:00, org admins only). */
  stage: 'initial' | 'escalation';
  /** Bring org admins in at 9:00 — driver has a pickup today, or nobody holds compliance.manage. */
  includeOrgAdmins: boolean;
}

/** "Licence DL0420… " or "Licence " when no number is on file. */
const licenceRef = (dlNo: string | null) => (dlNo ? `Licence ${dlNo}` : 'The licence');

export interface BreakdownReportedContext {
  issueId: string;
  loadId: string;
  // Filled in by the context resolver (breakdown-alerts.ts) from the issue report and its trip:
  vehicleNo?: string;
  driverName?: string;
  driverPhone?: string;
  breakdownType?: string;
  location?: string;
  reportTime?: string;
  destination?: string;
  loadCode?: string;
  consignee?: string;
}

/** LS_N_0054 tokens with no data source yet — delivery points carry no coordinates (no distance
 *  to destination) and there is no workshop master with locations. Static until those exist. */
export const BREAKDOWN_STATIC_TOKENS = {
  distanceToDestinationKm: 'N/A',
  workshopName: 'not available yet',
  workshopDistanceKm: 'N/A',
};

export interface VehicleBackInServiceContext {
  jobId: string;
  // Filled in by the context resolver (back-in-service.ts) from the closed workshop visit:
  vehicleId?: string;
  vehicleNo?: string;
  downtimeHours?: string;
  /** Formatted (e.g. "₹12,500"), or null when no cost was entered on the visit. */
  repairCost?: string | null;
  availableFrom?: string;
  /** Requisitions still waiting to be dispatched ("loads waiting on your lanes" — no lanes yet). */
  loadCount?: number;
  /** Recipients allowed to see the repair cost (maintenance.costs.view holders). */
  costViewerIds?: string[];
}

export interface ServiceDueSoonContext {
  vehicleId: string;
  vehicleNo: string;
  kmRemaining: number;
  serviceType: string;
  serviceDueKm: number;
  dailyAvgKm: number;
  daysRemaining: number;
  plannedTripCount: number;
  /** 'threshold' (10% of the interval left) or 'half' (5% left). */
  stage: string;
  runDate: string;
}

export interface ServiceOverdueContext {
  vehicleId: string;
  vehicleNo: string;
  kmOverdue: number;
  serviceType: string;
  serviceDueKm: number;
  currentOdometer: number;
  /** Org-wide 12-month averages; null when there is no costed job of that kind. */
  serviceCost: string | null;
  breakdownCost: string | null;
  /** 2+ weeks overdue (or nobody holds maintenance.manage) — org admins are added. */
  escalated: boolean;
  runDate: string;
}

const km = (value: number) => value.toLocaleString('en-IN');

export interface VehicleDocumentsRollupContext {
  /** Vehicle documents in the organisation expiring within the next 30 days. */
  docCount: number;
  /** "Insurance on MH12AB1234 — 2026-10-05; …" for the email template. */
  docList: string;
  runDate: string;
}

export interface OrganizationApprovedContext {
  orgName: string;
}

export interface OrganizationSignupReceivedContext {
  orgName: string;
}

export interface OrganizationNotApprovedContext {
  orgName: string;
  /** The reviewer's deny reason, sent verbatim (organization.decisionReason). */
  reason: string;
}

export interface TeamMemberInvitedContext {
  /** The invited user — the recipient. */
  userId: string;
  inviterName: string;
  orgName: string;
  /** What they can do, e.g. "manage load requisitions and create customers". */
  capabilitySummary: string;
  /** Set by the trigger worker on the 24-hour reminder. */
  isReminder?: boolean;
}

export interface AccessChangedContext {
  /** The user whose access changed — the recipient. */
  userId: string;
  adminUserId: string;
  /** Effective permission keys before the first change of the burst (see access-change.ts). */
  baselinePermissions: string[];
  // Filled in by the context resolver right before sending (access-change.ts):
  adminName?: string;
  orgName?: string;
  addedCapabilities?: string;
  removedCapabilities?: string;
  removedCount?: number;
}

/** LS_N_0006's two optional sentences — also sent whole to the email template as access_summary,
 *  since a template can't drop a sentence when its list is empty. */
function accessChangeSentences({
  addedCapabilities,
  removedCapabilities,
  removedCount,
}: AccessChangedContext): string {
  const sentences: string[] = [];
  if (addedCapabilities) sentences.push(`You can now ${addedCapabilities}.`);
  if (removedCapabilities) {
    const removed = removedCapabilities.charAt(0).toUpperCase() + removedCapabilities.slice(1);
    sentences.push(
      `${removed} ${(removedCount ?? 0) > 1 ? 'are' : 'is'} no longer available to you.`,
    );
  }
  return sentences.join(' ');
}

/** Master record types with a pending → approve flow (LS_N_0009/0010). Transporters have none. */
export type MasterKind = 'vehicle' | 'driver' | 'loading_point' | 'product' | 'customer';

export const MASTER_KIND_LABELS: Record<MasterKind, string> = {
  vehicle: 'Vehicle',
  driver: 'Driver',
  loading_point: 'Loading point',
  product: 'Product',
  customer: 'Customer',
};

/** Suggested frontend routes — the frontend owns routing, so every notification also carries
 *  record_kind + record_id for it to build its own link. */
const MASTER_RECORD_PATHS: Record<MasterKind, string> = {
  vehicle: '/masters/vehicles',
  driver: '/masters/drivers',
  loading_point: '/masters/loading-points',
  product: '/masters/products',
  customer: '/customers',
};
const APPROVALS_PATH = '/settings/approvals';

/** Who can approve a kind — mirrors the code that gates approval: masters.approve for the four
 *  masters; customers.approve AND org_admin for customers (CustomerService.approve also asserts
 *  the org_admin role). */
export function masterApprovers(kind: MasterKind): { permission: string; role?: string } {
  return kind === 'customer'
    ? { permission: CUSTOMERS_APPROVE, role: ORG_ADMIN_ROLE }
    : { permission: MASTERS_APPROVE };
}

export interface MasterApprovalRequestedContext {
  kind: MasterKind;
  recordId: string;
  /** The record as people know it — registration number, driver name, title, etc. */
  masterValue: string;
  createdByUserId: string;
  /** Filled in by the context resolver (master-approvals.ts). */
  userName?: string;
}

export interface MasterApprovalsWaitingContext {
  /** The approver — the recipient. */
  userId: string;
  /** Filled in by the context resolver: records still pending that they can approve. */
  waitingCount?: number;
}

export interface MasterApprovedContext {
  kind: MasterKind;
  recordId: string;
  masterValue: string;
  /** The creator — the recipient. */
  createdByUserId: string;
  approvedByUserId: string;
  /** Filled in by the context resolver (master-approvals.ts). */
  adminName?: string;
}

export interface MasterRejectedContext {
  kind: MasterKind;
  recordId: string;
  masterValue: string;
  /** The creator — the recipient. */
  createdByUserId: string;
  rejectedByUserId: string;
  /** The reviewer's rejection reason, as typed. */
  reason: string;
  /** Filled in by the context resolver (master-approvals.ts). */
  adminName?: string;
}

export interface VahanUnverifiedContext {
  vehicleId: string;
  vehicleNo: string;
  /** Who added the vehicle — notified alongside compliance.manage holders. */
  createdByUserId: string | null;
}

export interface OrganizationDocumentPendingContext {
  orgName: string;
  /** Human-readable name of the exact document, e.g. "GST certificate". */
  docType: string;
  documentId: string;
  /** Set by the trigger worker on the 48-hour reminder. */
  isReminder?: boolean;
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

  // LS_N_0003 — fired by admin.service.ts's verifyOrganizationDocument when a reviewer marks a KYC
  // document invalid (unreadable/missing) while the org is under review. SMS + email only, not
  // in-app (no app access yet). One reminder after 48h, only if that exact document is still
  // invalid then (see AdminService.isDocumentReuploadPending), then stop.
  'organization.document_more_info_needed': {
    label: 'More information needed',
    description: 'A KYC document could not be verified and a clear copy is needed.',
    recipientRoles: [ORG_ADMIN_ROLE],
    channels: ['sms', 'email'],
    defaultChannels: ['sms', 'email'],
    severity: 'p2_action',
    inApp: false,
    dedupeKey: (context: OrganizationDocumentPendingContext) => context.documentId,
    reminderAfterMs: 48 * 60 * 60 * 1000,
    templates: {
      sms: { templateId: env.msg91SmsTemplateDocumentPending, variables: { var1: 'org_name' } },
      email: {
        templateId: env.msg91EmailTemplateDocumentPending,
        variables: { first_name: 'first_name', org_name: 'org_name', doc_type: 'doc_type' },
      },
    },
    buildContent: (
      { orgName, docType, documentId, isReminder }: OrganizationDocumentPendingContext,
      recipient,
    ) => {
      const firstName = firstNameOf(recipient.fullName);
      return {
        title: `One document pending for ${orgName}`,
        body: `${firstName}, we could not verify ${docType} for ${orgName}. Send a clear copy and we will approve the account the same day.`,
        metadata: {
          first_name: firstName,
          org_name: orgName,
          doc_type: docType,
          document_id: documentId,
          ...(isReminder ? { reminder: 'true' } : {}),
        },
      };
    },
  },

  // LS_N_0004 — fired by admin.service.ts's denyOrganization (POST .../deny only). Email only:
  // the spec rules out SMS for a rejection, and there's no app access (sessions are revoked on
  // deny). `reason` is the reviewer's text as typed. Once per organisation.
  'organization.account_not_approved': {
    label: 'Account not approved',
    description: 'Your organisation could not be approved.',
    recipientRoles: [ORG_ADMIN_ROLE],
    channels: ['email'],
    defaultChannels: ['email'],
    severity: 'p3_info',
    frequency: 'once_per_tenant',
    inApp: false,
    templates: {
      email: {
        templateId: env.msg91EmailTemplateOrgNotApproved,
        variables: { first_name: 'first_name', org_name: 'org_name', reason: 'reason' },
      },
    },
    buildContent: ({ orgName, reason }: OrganizationNotApprovedContext, recipient) => {
      const firstName = firstNameOf(recipient.fullName);
      return {
        title: `About your Loadsmart application for ${orgName}`,
        body: `${firstName}, we are not able to open a Loadsmart account for ${orgName} at this time. Reason: ${reason}. If this looks wrong, reply to this mail and we will look again.`,
        metadata: { first_name: firstName, org_name: orgName, reason },
      };
    },
  },

  // LS_N_0005 — fired by auth.service.ts's inviteOrganizationUser, to the invited person only.
  // SMS (+ email only if they have one on file). Not in-app ("until the password is set") and no
  // WhatsApp (no opt-in captured yet). One reminder after 24h only if they still haven't signed in
  // (relevance check in composition-root.ts), then stop.
  'organization.team_member_invited': {
    label: 'Team member invited',
    description: 'You have been added to an organisation on Loadsmart.',
    recipientRoles: [],
    recipientUserId: (context: TeamMemberInvitedContext) => context.userId,
    channels: ['sms', 'email'],
    defaultChannels: ['sms', 'email'],
    severity: 'p2_action',
    inApp: false,
    dedupeKey: (context: TeamMemberInvitedContext) => context.userId,
    reminderAfterMs: 24 * 60 * 60 * 1000,
    templates: {
      sms: { templateId: env.msg91SmsTemplateTeamInvite, variables: { var1: 'org_name' } },
      email: {
        templateId: env.msg91EmailTemplateTeamInvite,
        variables: {
          first_name: 'first_name',
          inviter_name: 'inviter_name',
          org_name: 'org_name',
          capability_summary: 'capability_summary',
        },
      },
    },
    buildContent: (
      { inviterName, orgName, capabilitySummary, isReminder }: TeamMemberInvitedContext,
      recipient,
    ) => {
      const firstName = firstNameOf(recipient.fullName);
      return {
        title: `${inviterName} has added you to ${orgName} on Loadsmart`,
        body: `${firstName}, ${inviterName} has added you to ${orgName} on Loadsmart. You can ${capabilitySummary}. Set your password to get started.`,
        metadata: {
          first_name: firstName,
          inviter_name: inviterName,
          org_name: orgName,
          capability_summary: capabilitySummary,
          cta_label: 'Set my password',
          ...(isReminder ? { reminder: 'true' } : {}),
        },
      };
    },
  },

  // LS_N_0006 — fired (via RoleService's onCapabilitiesChanged hook, see access-change.ts) when an
  // org admin grants/revokes a capability or changes a teammate's role. In-app + email (if on
  // file). Debounced: a burst of changes becomes ONE message ~2 min after the last one, listing
  // the net additions/removals; nothing is sent when the net effect is nil.
  'user.access_changed': {
    label: 'Your access changed',
    description: 'What you can do in your organisation was updated.',
    recipientRoles: [],
    recipientUserId: (context: AccessChangedContext) => context.userId,
    channels: ['email'],
    defaultChannels: ['email'],
    severity: 'p3_info',
    dedupeKey: (context: AccessChangedContext) => context.userId,
    debounceMs: 2 * 60 * 1000,
    templates: {
      email: {
        templateId: env.msg91EmailTemplateAccessChanged,
        variables: {
          first_name: 'first_name',
          admin_name: 'admin_name',
          org_name: 'org_name',
          added_capabilities: 'added_capabilities',
          removed_capabilities: 'removed_capabilities',
          access_summary: 'access_summary',
        },
      },
    },
    buildContent: (context: AccessChangedContext, recipient) => {
      const firstName = firstNameOf(recipient.fullName);
      const adminName = context.adminName ?? 'Your admin';
      const orgName = context.orgName ?? 'your organisation';
      const summary = accessChangeSentences(context);
      return {
        title: 'Your access has been updated',
        body: `${firstName}, ${adminName} updated what you can do in ${orgName}. ${summary}`.trim(),
        metadata: {
          first_name: firstName,
          admin_name: adminName,
          org_name: orgName,
          added_capabilities: context.addedCapabilities ?? '',
          removed_capabilities: context.removedCapabilities ?? '',
          access_summary: summary,
          cta_label: 'See what I can do',
          cta_path: '/',
        },
      };
    },
  },

  // LS_N_0009 — fired (via master-approvals.ts) when a non-admin creates a vehicle, driver,
  // loading point, product or customer, which then waits as 'pending'. To everyone who can
  // approve that kind (not the creator), in-app + push. Each approver gets at most 3 individual
  // ones per hour; beyond that they get one 'organization.master_approvals_waiting' summary.
  'organization.master_approval_requested': {
    label: 'Master addition needs approval',
    description:
      'A new vehicle, driver, loading point, product or customer is waiting for approval.',
    recipientRoles: [],
    recipientPermission: (context: MasterApprovalRequestedContext) => masterApprovers(context.kind),
    excludeUserId: (context: MasterApprovalRequestedContext) => context.createdByUserId,
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: MasterApprovalRequestedContext) => `${context.kind}-${context.recordId}`,
    recipientRateLimit: {
      max: 3,
      windowSeconds: 60 * 60,
      overflowType: 'organization.master_approvals_waiting',
    },
    buildContent: (context: MasterApprovalRequestedContext) => {
      const masterType = MASTER_KIND_LABELS[context.kind];
      const userName = context.userName || 'A teammate';
      return {
        title: `${masterType} waiting for your approval`,
        body: `${userName} added ${context.masterValue}. It cannot be used in a trip until you approve it.`,
        metadata: {
          master_type: masterType,
          master_value: context.masterValue,
          user_name: userName,
          record_kind: context.kind,
          record_id: context.recordId,
          cta_label: 'Review and approve',
          cta_path: APPROVALS_PATH,
        },
      };
    },
  },

  // LS_N_0009's collapsed form — one per approver, debounced, counting what's still pending.
  'organization.master_approvals_waiting': {
    label: 'Master approvals waiting',
    description: 'Several master records are waiting for your approval.',
    recipientRoles: [],
    recipientUserId: (context: MasterApprovalsWaitingContext) => context.userId,
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: MasterApprovalsWaitingContext) => context.userId,
    debounceMs: 5 * 60 * 1000,
    buildContent: ({ waitingCount = 0 }: MasterApprovalsWaitingContext) => {
      const what = waitingCount === 1 ? '1 master record is' : `${waitingCount} master records are`;
      return {
        title: `${what} waiting for your approval`,
        body: `${what} waiting for your approval. They cannot be used in a trip until you approve them.`,
        metadata: {
          waiting_count: String(waitingCount),
          cta_label: 'Review and approve',
          cta_path: APPROVALS_PATH,
        },
      };
    },
  },

  // LS_N_0010 — fired (via master-approvals.ts) when someone approves a record another user
  // created. In-app only, to the creator; one per record.
  'organization.master_approved': {
    label: 'Master approved',
    description: 'A vehicle, driver, loading point, product or customer you added was approved.',
    recipientRoles: [],
    recipientUserId: (context: MasterApprovedContext) => context.createdByUserId,
    channels: [],
    defaultChannels: [],
    severity: 'p3_info',
    dedupeKey: (context: MasterApprovedContext) => `${context.kind}-${context.recordId}`,
    buildContent: (context: MasterApprovedContext, recipient) => {
      const masterType = MASTER_KIND_LABELS[context.kind];
      const firstName = firstNameOf(recipient.fullName);
      const adminName = context.adminName || 'Your admin';
      return {
        title: `${masterType} approved`,
        body: `${firstName}, ${adminName} approved ${context.masterValue}. You can use it in a trip now.`,
        metadata: {
          first_name: firstName,
          admin_name: adminName,
          master_type: masterType,
          master_value: context.masterValue,
          record_kind: context.kind,
          record_id: context.recordId,
          cta_label: 'Use it in a trip',
          cta_path: `${MASTER_RECORD_PATHS[context.kind]}/${context.recordId}`,
        },
      };
    },
  },

  // LS_N_0011 — fired (via master-approvals.ts) when someone rejects a pending vehicle, driver,
  // loading point, product or customer another user created. In-app + push to the creator; one
  // per record. Note: the masters have no resubmit flow yet — a rejected record stays rejected
  // after editing — so "send it again" relies on that being built.
  'organization.master_rejected': {
    label: 'Master rejected',
    description:
      'A vehicle, driver, loading point, product or customer you added was not approved.',
    recipientRoles: [],
    recipientUserId: (context: MasterRejectedContext) => context.createdByUserId,
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: MasterRejectedContext) => `${context.kind}-${context.recordId}`,
    buildContent: (context: MasterRejectedContext, recipient) => {
      const masterType = MASTER_KIND_LABELS[context.kind];
      const firstName = firstNameOf(recipient.fullName);
      const adminName = context.adminName || 'Your admin';
      return {
        title: `${masterType} was not approved`,
        body: `${firstName}, ${adminName} did not approve ${context.masterValue}. Reason given: ${context.reason}. Edit the details and send it again.`,
        metadata: {
          first_name: firstName,
          admin_name: adminName,
          master_type: masterType,
          master_value: context.masterValue,
          reason: context.reason,
          record_kind: context.kind,
          record_id: context.recordId,
          cta_label: 'Edit and resubmit',
          cta_path: `${MASTER_RECORD_PATHS[context.kind]}/${context.recordId}`,
        },
      };
    },
  },

  // LS_N_0012 — the app records Vahan results (the backend does no lookup itself). When a vehicle
  // gets a not_found / manual_review result, this is scheduled 24h after the FIRST failure (the
  // window for the app/user to retry) and only sent if the vehicle still isn't verified then
  // (relevance check in composition-root.ts). To whoever added it + compliance.manage holders.
  'vehicle.vahan_unverified': {
    label: 'Vehicle could not be verified on Vahan',
    description: 'A newly added vehicle registration could not be verified on Vahan.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: COMPLIANCE_MANAGE }),
    alsoNotifyUserId: (context: VahanUnverifiedContext) => context.createdByUserId,
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: VahanUnverifiedContext) => context.vehicleId,
    delayMs: 24 * 60 * 60 * 1000,
    buildContent: ({ vehicleNo, vehicleId }: VahanUnverifiedContext) => ({
      title: `${vehicleNo} could not be verified`,
      body: `We could not find ${vehicleNo} on Vahan. Check the registration number. Until it is verified you cannot assign this vehicle to a trip.`,
      metadata: {
        vehicle_no: vehicleNo,
        record_kind: 'vehicle',
        record_id: vehicleId,
        cta_label: 'Check the number',
        cta_path: `${MASTER_RECORD_PATHS.vehicle}/${vehicleId}`,
      },
    }),
  },

  // LS_N_0047 — the daily 9:00 IST check (vehicle-document-alerts.ts) sends this at 30, 15, 7, 3
  // and 1 days before a vehicle document's expiry date: in-app + SMS to compliance.manage holders
  // and org admins, at most one per vehicle per day. The sheet's email is the weekly roll-up
  // ('vehicle.documents_expiring_rollup'). Reuses the old placeholder's key so saved
  // notification settings for "Document expiry" carry over.
  'vehicle.document_expiry': {
    label: 'Vehicle document expiring',
    description:
      'Vehicle RC, insurance, permit, PUC and fitness renewals due in 30, 15, 7, 3 and 1 days.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: COMPLIANCE_MANAGE }),
    channels: ['sms'],
    defaultChannels: ['sms'],
    severity: 'p2_action',
    dedupeKey: (context: VehicleDocumentExpiringContext) =>
      `${context.vehicleId}-${context.runDate}`,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateDocExpiring,
        variables: { var1: 'doc_type', var2: 'vehicle_no' },
      },
    },
    buildContent: (context: VehicleDocumentExpiringContext, recipient) => {
      const firstName = firstNameOf(recipient.fullName);
      const days = `${context.daysLeft} day${context.daysLeft === 1 ? '' : 's'}`;
      return {
        title: `${context.docType} on ${context.vehicleNo} expires in ${days}`,
        body: `${firstName}, ${context.docType} on ${context.vehicleNo} expires on ${context.expiryDate} and ${context.plannedTripCount} trips are already planned after that date. ${context.otherCount} more documents come up this month.`,
        metadata: {
          first_name: firstName,
          doc_type: context.docType,
          vehicle_no: context.vehicleNo,
          days_left: String(context.daysLeft),
          expiry_date: context.expiryDate,
          planned_trip_count: String(context.plannedTripCount),
          other_count: String(context.otherCount),
          vehicle_id: context.vehicleId,
          run_date: context.runDate,
          cta_label: 'Renew documents',
          cta_path: `/masters/vehicles/${context.vehicleId}`,
        },
      };
    },
  },

  // LS_N_0047's weekly organisation roll-up — email only, every Monday 9:00 IST, to
  // compliance.manage holders + org admins; skipped when nothing expires in the next 30 days.
  'vehicle.documents_expiring_rollup': {
    label: 'Vehicle documents expiring (weekly summary)',
    description: 'Weekly email listing vehicle documents that expire in the next 30 days.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: COMPLIANCE_MANAGE }),
    channels: ['email'],
    defaultChannels: ['email'],
    severity: 'p2_action',
    inApp: false,
    dedupeKey: (context: VehicleDocumentsRollupContext) => context.runDate,
    templates: {
      email: {
        templateId: env.msg91EmailTemplateDocRollup,
        variables: { first_name: 'first_name', doc_count: 'doc_count', doc_list: 'doc_list' },
      },
    },
    buildContent: (context: VehicleDocumentsRollupContext, recipient) => ({
      title: `${context.docCount} vehicle documents expiring in the next 30 days`,
      body: context.docList,
      metadata: {
        first_name: firstNameOf(recipient.fullName),
        doc_count: String(context.docCount),
        doc_list: context.docList,
        run_date: context.runDate,
      },
    }),
  },

  // LS_N_0048 — the daily check sends this on the expiry date, then every 7 days while the
  // document stays expired: in-app + push + email + SMS to compliance.manage and
  // dispatch.planning.manage holders and org admins, at most one per vehicle per day. Reuses the
  // retired masters alert's key so saved notification settings carry over. Wording is the
  // sheet's — note dispatch planning currently only WARNS on expired documents.
  'vehicle.compliance_expired': {
    label: 'Vehicle document expired',
    description: 'A vehicle RC, insurance, permit, PUC or fitness certificate has expired.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => [
      { permission: COMPLIANCE_MANAGE },
      { permission: DISPATCH_PLANNING_MANAGE },
    ],
    channels: ['push', 'email', 'sms'],
    defaultChannels: ['push', 'email', 'sms'],
    severity: 'p1_critical',
    dedupeKey: (context: VehicleDocumentExpiredContext) =>
      `${context.vehicleId}-${context.runDate}`,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateDocExpired,
        variables: { var1: 'vehicle_no', var2: 'doc_type' },
      },
      email: {
        templateId: env.msg91EmailTemplateDocExpired,
        variables: {
          vehicle_no: 'vehicle_no',
          doc_type: 'doc_type',
          expiry_date: 'expiry_date',
          affected_trip_count: 'affected_trip_count',
        },
      },
    },
    buildContent: (context: VehicleDocumentExpiredContext) => ({
      title: `${context.vehicleNo} is blocked from dispatch`,
      body: `${context.docType} expired on ${context.expiryDate}. ${context.vehicleNo} cannot be assigned to a trip until it is renewed. ${context.affectedTripCount} planned trips need another vehicle.`,
      metadata: {
        vehicle_no: context.vehicleNo,
        doc_type: context.docType,
        expiry_date: context.expiryDate,
        affected_trip_count: String(context.affectedTripCount),
        vehicle_id: context.vehicleId,
        run_date: context.runDate,
        cta_label: 'Reassign those trips',
        cta_path: `/loads?vehicleId=${context.vehicleId}`,
      },
    }),
  },

  // LS_N_0049 (expiring) — the daily 9:00 IST check sends this 30, 15 and 7 days before a
  // driver's licence expires: in-app + push to compliance.manage holders and org admins, at most
  // one per driver per day. Wording agreed separately (the sheet only gives the expired copy).
  // Reuses the old placeholder's key so saved settings for "Driver licence expiry" carry over.
  'driver.licence_expiry': {
    label: 'Driver licence expiring',
    description: 'Driver licence renewals due in 30, 15 and 7 days.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: COMPLIANCE_MANAGE }),
    channels: ['push'],
    defaultChannels: ['push'],
    severity: 'p2_action',
    dedupeKey: (context: DriverLicenceExpiringContext) => `${context.driverId}-${context.runDate}`,
    buildContent: (context: DriverLicenceExpiringContext) => ({
      title: `${context.driverName}'s licence expires in ${context.daysLeft} days`,
      body: `${licenceRef(context.dlNo)} expires on ${context.expiryDate} and ${context.driverName} is rostered on ${context.tripCount} upcoming trips. Get it renewed or plan another driver.`,
      metadata: {
        driver_name: context.driverName,
        dl_no: context.dlNo ?? '',
        expiry_date: context.expiryDate,
        days_left: String(context.daysLeft),
        trip_count: String(context.tripCount),
        driver_id: context.driverId,
        run_date: context.runDate,
        cta_label: 'Renew licence',
        cta_path: `/masters/drivers/${context.driverId}`,
      },
    }),
  },

  // LS_N_0049 (expired) — on the expiry date only (LS_N_0018 ladder): 9:00 to compliance.manage
  // holders (+ org admins at once if the driver has a pickup today or nobody holds
  // compliance.manage), a reminder to the same people at 11:00, and an escalation to org admins
  // at 13:00 — the reminder and escalation only if the licence still hasn't been renewed.
  'driver.licence_expired': {
    label: 'Driver licence expired',
    description: 'A driver licence has expired and the driver cannot be assigned.',
    recipientRoles: [],
    recipientPermission: (context: DriverLicenceExpiredContext) =>
      context.stage === 'escalation' ? [] : [{ permission: COMPLIANCE_MANAGE }],
    extraRecipientRoles: (context: DriverLicenceExpiredContext) =>
      context.stage === 'escalation' || context.includeOrgAdmins ? [ORG_ADMIN_ROLE] : [],
    channels: ['push', 'sms'],
    defaultChannels: ['push', 'sms'],
    severity: 'p1_critical',
    dedupeKey: (context: DriverLicenceExpiredContext) =>
      `${context.driverId}-${context.runDate}-${context.stage}`,
    reminderAfterMs: 2 * 60 * 60 * 1000,
    shouldRemind: (context: DriverLicenceExpiredContext) => context.stage === 'initial',
    templates: {
      sms: { templateId: env.msg91SmsTemplateDlExpired, variables: { var1: 'driver_name' } },
    },
    buildContent: (context: DriverLicenceExpiredContext & { isReminder?: boolean }) => ({
      title: `${context.driverName} cannot be assigned`,
      body: `${licenceRef(context.dlNo)} expired on ${context.expiryDate} and ${context.driverName} is rostered on ${context.tripCount} upcoming trips. Assign another driver or get the licence renewed.`,
      metadata: {
        driver_name: context.driverName,
        dl_no: context.dlNo ?? '',
        expiry_date: context.expiryDate,
        trip_count: String(context.tripCount),
        driver_id: context.driverId,
        run_date: context.runDate,
        ladder_step: context.isReminder ? 'reminder' : context.stage,
        cta_label: 'Reassign trips',
        cta_path: `/loads?driverId=${context.driverId}`,
      },
    }),
  },

  // LS_N_0054 — fired (via breakdown-alerts.ts) when a driver reports a 'breakdown' issue on a
  // trip from the driver app. Immediate (no quiet-hours feature exists to bypass). P1, in-app +
  // push + WhatsApp + SMS to maintenance.manage holders and org admins ("trip.track" skipped).
  'load.breakdown_reported': {
    label: 'Driver marked a breakdown',
    description: 'A driver reported that the vehicle has broken down on a trip.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: MAINTENANCE_MANAGE }),
    channels: ['push', 'whatsapp', 'sms'],
    defaultChannels: ['push', 'whatsapp', 'sms'],
    severity: 'p1_critical',
    dedupeKey: (context: BreakdownReportedContext) => context.issueId,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateBreakdown,
        variables: { var1: 'vehicle_no', var2: 'location' },
      },
      whatsapp: {
        templateName: env.msg91WhatsappTemplateBreakdown,
        variables: [
          'first_name',
          'vehicle_no',
          'location',
          'load_id',
          'driver_name',
          'driver_phone',
        ],
      },
    },
    buildContent: (context: BreakdownReportedContext, recipient) => {
      const t = BREAKDOWN_STATIC_TOKENS;
      const vehicleNo = context.vehicleNo ?? 'The vehicle';
      return {
        title: `${vehicleNo} has broken down`,
        body: `${context.driverName} reported ${context.breakdownType} near ${context.location} at ${context.reportTime}, ${t.distanceToDestinationKm} km short of ${context.destination}. Load ${context.loadCode} for ${context.consignee} is on board. Nearest workshop is ${t.workshopName}, ${t.workshopDistanceKm} km away.`,
        metadata: {
          first_name: firstNameOf(recipient.fullName),
          vehicle_no: vehicleNo,
          driver_name: context.driverName ?? '',
          driver_phone: context.driverPhone ?? '',
          breakdown_type: context.breakdownType ?? '',
          location: context.location ?? '',
          report_time: context.reportTime ?? '',
          distance_to_destination: t.distanceToDestinationKm,
          destination: context.destination ?? '',
          load_id: context.loadCode ?? '',
          consignee: context.consignee ?? '',
          workshop_name: t.workshopName,
          workshop_distance: t.workshopDistanceKm,
          load_uuid: context.loadId,
          issue_id: context.issueId,
          cta_label: 'Call driver',
          cta_path: `/loads/${context.loadId}`,
        },
      };
    },
  },

  // LS_N_0055 — fired (via the maintenance module's notifications gateway) whenever an open
  // breakdown or workshop/service visit is closed, which always returns the truck to dispatch.
  // In-app only, P3. The repair cost is shown only to recipients who can see maintenance costs.
  'vehicle.back_in_service': {
    label: 'Vehicle back in service',
    description: 'A vehicle is out of the workshop and available for dispatch again.',
    recipientRoles: [],
    recipientPermission: () => [
      { permission: DISPATCH_PLANNING_MANAGE },
      { permission: MAINTENANCE_MANAGE },
    ],
    channels: [],
    defaultChannels: [],
    severity: 'p3_info',
    dedupeKey: (context: VehicleBackInServiceContext) => context.jobId,
    buildContent: (context: VehicleBackInServiceContext, recipient) => {
      const canSeeCost = !!recipient.id && (context.costViewerIds ?? []).includes(recipient.id);
      const cost = canSeeCost ? `, repair cost ${context.repairCost ?? 'not recorded'}` : '';
      const loadCount = context.loadCount ?? 0;
      const waiting = loadCount === 1 ? '1 load is' : `${loadCount} loads are`;
      return {
        title: `${context.vehicleNo} is back on road`,
        body: `Down for ${context.downtimeHours} hours${cost}. Available for dispatch from ${context.availableFrom}. ${waiting} waiting on your lanes.`,
        metadata: {
          vehicle_id: context.vehicleId ?? '',
          vehicle_no: context.vehicleNo ?? '',
          downtime_hours: context.downtimeHours ?? '',
          available_from: context.availableFrom ?? '',
          load_count: String(loadCount),
          job_id: context.jobId,
          cta_label: 'Assign a load',
          cta_path: `/loads?vehicleId=${context.vehicleId}`,
        },
      };
    },
  },

  // LS_N_0056 — from the daily 9:00 IST check (service-alerts.ts): once with 10% of the
  // vehicle's service interval left, again at 5%. P3, in-app + SMS.
  'vehicle.service_due_soon': {
    label: 'Service due soon',
    description: 'A vehicle is close to its service distance, converted into days of running.',
    recipientRoles: [ORG_ADMIN_ROLE],
    recipientPermission: () => ({ permission: MAINTENANCE_MANAGE }),
    channels: ['sms'],
    defaultChannels: ['sms'],
    severity: 'p3_info',
    dedupeKey: (context: ServiceDueSoonContext) =>
      `${context.vehicleId}-${context.serviceDueKm}-${context.stage}`,
    templates: {
      sms: {
        templateId: env.msg91SmsTemplateServiceDue,
        variables: { var1: 'vehicle_no', var2: 'km_remaining' },
      },
    },
    buildContent: (context: ServiceDueSoonContext) => ({
      title: `${context.vehicleNo} is due for service`,
      body: `${km(context.kmRemaining)} km to the ${context.serviceType} service at ${km(context.serviceDueKm)} km. At its current run of ${km(context.dailyAvgKm)} km a day that is about ${context.daysRemaining} days, and ${context.plannedTripCount} trips are planned in that window.`,
      metadata: {
        vehicle_id: context.vehicleId,
        vehicle_no: context.vehicleNo,
        km_remaining: km(context.kmRemaining),
        service_type: context.serviceType,
        service_due_km: String(context.serviceDueKm),
        daily_avg_km: String(context.dailyAvgKm),
        days_remaining: String(context.daysRemaining),
        planned_trip_count: String(context.plannedTripCount),
        stage: context.stage,
        run_date: context.runDate,
        cta_label: 'Book service',
        cta_path: `/maintenance?vehicleId=${context.vehicleId}`,
      },
    }),
  },

  // LS_N_0057 — from the daily 9:00 IST check: weekly while past the service distance with no
  // service logged. maintenance.manage holders; org admins join after 2 weeks. P2, in-app + push
  // + SMS. The cost sentence is dropped when the org has no costed service/breakdown history.
  'vehicle.service_overdue': {
    label: 'Service overdue',
    description: 'A vehicle has run past its service distance without a service logged.',
    recipientRoles: [],
    recipientPermission: () => ({ permission: MAINTENANCE_MANAGE }),
    // Org admins hold maintenance.manage via their role — kept out until the 2-week escalation.
    excludeRolesFromPermission: () => [ORG_ADMIN_ROLE],
    extraRecipientRoles: (context: ServiceOverdueContext) =>
      context.escalated ? [ORG_ADMIN_ROLE] : [],
    channels: ['push', 'sms'],
    defaultChannels: ['push', 'sms'],
    severity: 'p2_action',
    dedupeKey: (context: ServiceOverdueContext) => `${context.vehicleId}-${context.runDate}`,
    templates: {
      sms: { templateId: env.msg91SmsTemplateServiceOverdue, variables: { var1: 'vehicle_no' } },
    },
    buildContent: (context: ServiceOverdueContext) => {
      const costs =
        context.serviceCost && context.breakdownCost
          ? ` Running past service is what turns a ${context.serviceCost} job into a ${context.breakdownCost} breakdown.`
          : '';
      return {
        title: `${context.vehicleNo} has run ${km(context.kmOverdue)} km past service`,
        body: `The ${context.serviceType} service was due at ${km(context.serviceDueKm)} km and the vehicle is now at ${km(context.currentOdometer)} km.${costs}`,
        metadata: {
          vehicle_id: context.vehicleId,
          vehicle_no: context.vehicleNo,
          km_overdue: String(context.kmOverdue),
          service_type: context.serviceType,
          service_due_km: String(context.serviceDueKm),
          current_odometer: String(context.currentOdometer),
          service_cost: context.serviceCost ?? '',
          breakdown_cost: context.breakdownCost ?? '',
          escalated: String(context.escalated),
          run_date: context.runDate,
          cta_label: 'Book service now',
          cta_path: `/maintenance?vehicleId=${context.vehicleId}`,
        },
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
