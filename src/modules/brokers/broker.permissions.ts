import { LS_APPROVAL, LS_MASTERS_MANAGE, LS_PLACEMENT } from '../../shared/constants/permissions';

/** Who may see the broker list and a broker's page: Masters (Admin team), Approval and Placement. */
export const BROKER_VIEW_PERMISSIONS = [LS_MASTERS_MANAGE, LS_APPROVAL, LS_PLACEMENT];

/** Who may edit a broker's contact and "Added by Loadsmart" (Approval & Sales fill these). An
 *  advance below the default also needs loadsmart.money.approve (Super Admin). */
export const BROKER_EDIT_PERMISSIONS = [LS_MASTERS_MANAGE, LS_APPROVAL];
