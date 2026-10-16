import {
  DISPATCH_ROLE,
  DOCUMENTS_OPS_ROLE,
  FINANCE_ACCOUNTS_ROLE,
  ORG_ADMIN_ROLE,
  SALES_CS_ROLE,
} from './roles';

/** Seats an organization gets when no platform admin has set organizations.seat_limit. */
export const DEFAULT_ORG_SEAT_LIMIT = 14;

export type SeatScreenGroup = 'operate' | 'fleet' | 'money';

export interface SeatScreenDefinition {
  /** Display name on Settings → Users & Roles ("Org Admin", "Dispatch"…). */
  label: string;
  /** Screens this seat opens — product definition, so it lives here rather than being derived
   *  from permission rows (one screen can need several permissions and vice versa). */
  screens: readonly string[];
  groups: readonly SeatScreenGroup[];
  /** "Number of screens visible to the set seat" box, e.g. "Sourcing and placement · …". */
  summary: string;
}

const OPERATE = ['home', 'post_a_load', 'loads', 'tracking', 'find_trucks', 'analytics'] as const;
const FLEET = ['my_fleet', 'my_drivers', 'maintenance', 'fuel'] as const;

/** "What each seat opens" table — keyed by role name (auth.roles.name). */
export const SEAT_SCREEN_CATALOG: Record<string, SeatScreenDefinition> = {
  [ORG_ADMIN_ROLE]: {
    label: 'Org Admin',
    screens: [
      ...OPERATE,
      ...FLEET,
      'payments',
      'invoices',
      'masters',
      'users_and_roles',
      'organisation',
      'alerts',
    ],
    groups: ['operate', 'fleet', 'money'],
    summary: 'All screens and money · Masters, users',
  },
  [SALES_CS_ROLE]: {
    label: 'Sales',
    screens: ['home', 'post_a_load', 'loads', 'tracking', 'payments', 'invoices'],
    groups: ['operate', 'money'],
    summary: 'Orders and customers · Load status · Invoices, no freight payouts',
  },
  [DISPATCH_ROLE]: {
    label: 'Dispatch',
    screens: ['home', 'post_a_load', 'loads', 'tracking', 'find_trucks', 'analytics', ...FLEET],
    groups: ['operate', 'fleet'],
    summary: 'Sourcing and placement · Eligible trucks only · Freight rates, no collection',
  },
  [DOCUMENTS_OPS_ROLE]: {
    label: 'Documents & Ops',
    screens: ['home', 'loads', 'tracking', 'find_trucks', 'analytics', ...FLEET],
    groups: ['operate', 'fleet'],
    summary: 'Loading papers and E-POD · Trip documents · No money',
  },
  [FINANCE_ACCOUNTS_ROLE]: {
    label: 'Finance',
    screens: ['home', 'loads', 'analytics', 'my_fleet', 'fuel', 'payments', 'invoices', 'masters'],
    groups: ['operate', 'fleet', 'money'],
    summary: 'Advance and balance payouts · Invoices · Fleet costs',
  },
};

export function seatLabel(roleName: string): string {
  return SEAT_SCREEN_CATALOG[roleName]?.label ?? roleName;
}
