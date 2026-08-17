/**
 * PRD §5.7 "Truck Types (Truck Master)" — the fixed starter list every tenant is seeded with
 * (existing tenants via `npm run seed:truck-types`, new ones automatically on org creation — see
 * auth.service.ts's createOrganization). Org admins can still add their own beyond this list via
 * POST /truck-types; this only pre-populates the dropdown instead of it starting empty.
 */
export const DEFAULT_TRUCK_TYPES = [
  '17 Feet Open (6 Wheels)',
  '20 Feet Open (6 Wheels)',
  '22 Feet Open (10 Wheels)',
  '24 Feet Open (10 Wheels)',
  '10 Wheel Open',
  '12 Wheel Open',
  '14 Wheel Open',
  '16 Wheel Open',
  '18 Wheel Open',
  '20 Feet Flat Bed',
  '40 Feet Flat Bed',
  '40 Feet Semi Bed',
  '40 Feet Low Bed',
  '32 Feet Single Axle',
  '32 Feet Single Axle High Cube',
  '32 Feet Multi Axle',
  '32 Feet Multi Axle High Cube',
  '32 Feet Triple Axle',
  '20 Feet Closed',
  '22 Feet Closed',
  '24 Feet Closed',
] as const;
