import { z } from 'zod';
import { LOAD_ISSUE_CATEGORIES } from './utils/loads.types';

const uuid = z.string().uuid();
const params = z.object({ loadId: uuid });

// Exported so driver-portal.validators.ts's reportMyIssue schema reuses the exact same body
// shape instead of a hand-kept duplicate that could drift out of sync — same convention as
// load.validators.ts's updateStatusBody/uploadPodBody.
export const reportLoadIssueBody = z
  .object({
    category: z.enum(LOAD_ISSUE_CATEGORIES),
    details: z.string().trim().max(500).optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    locationLabel: z.string().trim().min(1).max(255),
    locationCapturedAt: z.iso.datetime(),
    // Confirmed storage keys, purpose 'loads/issue' — see load-issue.service.ts's
    // assertLoadDocumentUpload loop.
    photoFileKeys: z.array(z.string().trim().min(1)).max(5).optional(),
  })
  .strict();

export const loadIssueValidators = {
  report: z.object({ params, body: reportLoadIssueBody }),
  list: z.object({ params }),
};
