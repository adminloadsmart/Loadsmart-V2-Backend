/**
 * Declared once here as a `const` tuple; the union type, the entity's `@Column({ enum: [...] })`
 * and the request schema all derive from it, so the three can never drift apart.
 */
export const FLEET_DRIVER_LINK_STATUSES = ['active', 'ended'] as const;
export type FleetDriverLinkStatus = (typeof FLEET_DRIVER_LINK_STATUSES)[number];
