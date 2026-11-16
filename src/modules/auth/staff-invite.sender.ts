import { env } from '../../config/env';
import { Msg91Client } from '../../adapters/msg91.client';
import { appUrl } from '../notifications/utils/app-url';
import { FRONTEND_PATHS } from '../notifications/notifications.constants';

export interface StaffInvite {
  phoneNumber: string;
  email: string | null;
  fullName: string | null;
  inviterName: string;
  // Plain-language list of what the team can do (RoleService.describePermissions), never the role.
  capabilitySummary: string;
}

// The org name the shared team-invite templates print — staff join Loadsmart itself.
const LOADSMART_ORG_NAME = 'Loadsmart';

/**
 * Tells a new team member they've been added and should sign in with their mobile number (OTP —
 * staff have no password). Sent straight through MSG91 rather than the notifications module: that
 * pipeline is tenant-scoped (recipients, preferences and quiet hours are all keyed by tenant) and
 * staff have no tenant.
 *
 * Reuses the org teammate-invite templates (MSG91_SMS_TEMPLATE_TEAM_INVITE /
 * MSG91_EMAIL_TEMPLATE_TEAM_INVITE) with org_name "Loadsmart" — Indian SMS needs a DLT-approved
 * template, so a new one would block release. Best-effort: each channel is skipped when its
 * template isn't configured and a failure is logged, never thrown — the hire must stand either way.
 */
export class StaffInviteSender {
  constructor(private readonly msg91Client: Msg91Client) {}

  async send(invite: StaffInvite): Promise<void> {
    const sends: Promise<void>[] = [];
    if (env.msg91SmsTemplateTeamInvite) {
      sends.push(
        this.msg91Client.sendTransactional(
          invite.phoneNumber,
          { var1: LOADSMART_ORG_NAME },
          env.msg91SmsTemplateTeamInvite,
        ),
      );
    }
    if (invite.email && env.msg91EmailTemplateTeamInvite) {
      sends.push(
        this.msg91Client.sendEmail(
          { email: invite.email, name: invite.fullName },
          {
            first_name: (invite.fullName ?? '').trim().split(/\s+/)[0] || 'there',
            inviter_name: invite.inviterName,
            org_name: LOADSMART_ORG_NAME,
            capability_summary: invite.capabilitySummary,
            cta_url: appUrl(FRONTEND_PATHS.login),
          },
          env.msg91EmailTemplateTeamInvite,
        ),
      );
    }
    const results = await Promise.allSettled(sends);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('Failed to send a team-member invite', result.reason);
      }
    }
  }
}
