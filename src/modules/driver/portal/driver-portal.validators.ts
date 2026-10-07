import { z } from 'zod';
import { paginationQuery as pagination } from '../../../shared/validators/pagination';
import {
  confirmLoadingBody,
  dateOnly,
  updateStatusBody,
  uploadPodBody,
} from '../../loads/load.validators';
import { reportLoadIssueBody } from '../../loads/load-issue.validators';
import {
  LOAD_SOURCE_TYPES,
  LOAD_STATUS_GROUPS,
  POD_STATUSES,
  LOAD_STATUSES,
} from '../../loads/utils/loads.types';
import { DRIVER_OPERATIONAL_STATUSES } from '../drivers.types';
import { bankAccountCheckBody, driverBankDetailsBody } from '../driver.validators';

// The storage purposes reachable through driver-portal's own upload handshake — kept as an
// explicit allow-list (not the full UPLOAD_PURPOSES enum) so a driver can never request an
// upload URL for a purpose meant for staff-only flows (masters/driver, kyc, etc.). The
// loads/invoice, loads/eway-bill, trips/lr, loads/loading-photo, and loads/weighing-slip purposes
// back confirmMyLoading below — the driver can now submit Loading Confirmation documents
// themselves, not just staff.
const driverUploadPurpose = z.enum([
  'trips/pod',
  'loads/issue',
  'loads/invoice',
  'loads/eway-bill',
  'trips/lr',
  'loads/loading-photo',
  'loads/weighing-slip',
]);

const uuid = z.string().uuid();
const loadParams = z.object({ loadId: uuid });

// No :driverId param anywhere here, unlike driver.validators.ts's staff-facing schemas — every
// endpoint is implicitly scoped to req.driver!.id (see driver-portal.controller.ts). See
// docs/driver-auth.md.
export const driverPortalValidators = {
  updateMyStatus: z.object({
    body: z.object({
      operationalStatus: z.enum(DRIVER_OPERATIONAL_STATUSES),
      reason: z.string().trim().min(1).max(255).optional(),
    }),
  }),
  // Mirrors loads/load.validators.ts's `list` query filters — status/group/sourceType only
  // (no requisitionId/transporterId/vehicleId/driverId here, unlike the staff-facing schema:
  // this list is always implicitly scoped to req.driver!.id, never another scope).
  verifyMyBankAccount: z.object({ body: bankAccountCheckBody }),
  addMyBankDetails: z.object({ body: driverBankDetailsBody }),
  listMyLoads: z.object({
    query: pagination
      .extend({
        status: z.enum(LOAD_STATUSES).optional(),
        // The Trips Home-page tab filter (Active/Completed) — a status-group shorthand, not a
        // narrower version of `status` above, so the two aren't combined in one request.
        group: z.enum(LOAD_STATUS_GROUPS).optional(),
        sourceType: z.enum(LOAD_SOURCE_TYPES).optional(),
        podStatus: z.enum(POD_STATUSES).optional(),
        fromDate: dateOnly.optional(),
        toDate: dateOnly.optional(),
      })
      .refine(
        (data) => !(data.fromDate && data.toDate) || data.fromDate <= data.toDate,
        'fromDate must not be after toDate',
      )
      .refine(
        (data) => !(data.status && data.group),
        'Provide at most one of status or group — group is the Trips tab filter (active/completed), status is an exact-value filter',
      ),
  }),

  // Driver-app "Trips Done" screen — pagination only, always completed-only server-side (see
  // LoadService.getMyTripsDone), so no status/group filter is exposed here.
  getMyTripsDone: z.object({ query: pagination }),

  // Single-load detail — params only, same convention as loads/load.validators.ts's `get`.
  getMyLoad: z.object({ params: loadParams }),

  // Trip Done detail — params only, same convention as getMyLoad above.
  getMyTripDetail: z.object({ params: loadParams }),
  // "Show papers" screen — params only, same convention as getMyLoad/getMyTripDetail above.
  getMyDocuments: z.object({ params: loadParams }),

  // Same body shape as loads/load.validators.ts's staff-facing schemas — reused directly (not
  // duplicated) so the two can't drift apart. :loadId is present here (unlike the rest of this
  // file) because these act on a load, not the driver's own record; ownership (this load must
  // actually be assigned to req.driver!.id) is enforced in LoadService, not here.
  updateMyLoadStatus: z.object({ params: loadParams, body: updateStatusBody }),
  uploadMyPod: z.object({ params: loadParams, body: uploadPodBody }),

  // Loading Confirmation — reuses loads/load.validators.ts's exact body shape, same convention as
  // updateMyLoadStatus/uploadMyPod above. Any of the mandatory documents already on the load (set
  // earlier by staff) don't need to be resent — see LoadService.confirmLoading's isComplete check.
  confirmMyLoading: z.object({ params: loadParams, body: confirmLoadingBody }),

  // Plain document attach/replace, decoupled from confirmMyLoading's status-transition semantics
  // — see LoadService.updateDocuments. Same body shape, reused for the same reason.
  updateMyDocuments: z.object({ params: loadParams, body: confirmLoadingBody }),

  // Driver-app "Report An Issue" — reuses load-issue.validators.ts's body shape, same convention
  // as updateMyLoadStatus/uploadMyPod above.
  reportMyIssue: z.object({ params: loadParams, body: reportLoadIssueBody }),

  // Same shape as storage.validators.ts's generateUploadUrl, except `purpose` is restricted to
  // driverUploadPurpose above — a driver should never request an upload URL for any other
  // storage purpose (masters/driver, kyc, etc.) through this route. Serves both POD photos
  // (trips/pod) and issue-report photos (loads/issue) — one handshake pair for both.
  requestUploadUrl: z.object({
    body: z
      .object({
        purpose: driverUploadPurpose,
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().min(1).max(255),
        sizeBytes: z.coerce.number().int().positive(),
      })
      .strict(),
  }),
  confirmUpload: z.object({ params: z.object({ fileId: uuid }) }),

  // Notifications screen — `category` is a `type`-prefix shorthand (Jobs/Documents/Settlements/
  // Account filter tabs), not a stored column; the controller translates it to a `type ILIKE
  // 'driver.<category>.%'` filter. See notification.repository.ts's listByRecipientAcrossTenants.
  getMyNotifications: z.object({
    query: pagination.extend({
      unreadOnly: z.coerce.boolean().optional(),
      category: z.enum(['jobs', 'documents', 'settlements', 'account']).optional(),
    }),
  }),
  markMyNotificationRead: z.object({ params: z.object({ notificationId: uuid }) }),
};
