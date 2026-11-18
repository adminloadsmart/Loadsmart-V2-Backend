import {
  LS_APPROVAL,
  LS_MASTERS_MANAGE,
  LS_PLACEMENT,
} from '../../../shared/constants/permissions';

/** Who may see the broker list: Masters (Admin team), Approval and Placement. */
export const BROKER_VIEW_PERMISSIONS = [LS_MASTERS_MANAGE, LS_APPROVAL, LS_PLACEMENT];
