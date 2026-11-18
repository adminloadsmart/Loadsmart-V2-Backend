import {
  LS_APPROVAL,
  LS_CS,
  LS_PAYABLES,
  LS_PLACEMENT,
  LS_RECEIVABLES,
  LS_TRACKING,
} from './permissions';

/** Every Loadsmart team's permission — for routes any team may use (message logs, Log a call).
 *  Same teams as loadsmart-ops/loadsmart.routes.ts ANY_TEAM. */
export const LOADSMART_TEAM_PERMISSIONS = [
  LS_APPROVAL,
  LS_PLACEMENT,
  LS_TRACKING,
  LS_CS,
  LS_RECEIVABLES,
  LS_PAYABLES,
] as const;
