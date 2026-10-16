import { VehicleDocumentTypeWithExpiry } from './vehicle.type';

/** A vehicle document flips to `expiring_soon` this many days before its expiry date. */
export const DOCUMENT_EXPIRING_SOON_DAYS = 30;

export const REGISTRATION_NUMBER_REGEX = /^[A-Z0-9-]{4,20}$/;

/** Display copy for {{compliance_type}} in notification text — keyed by the 5 dated paper types
 *  (VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY); rc_front/rc_back never carry an expiry so never alert. */
export const DOCUMENT_TYPE_LABELS: Record<VehicleDocumentTypeWithExpiry, string> = {
  rc: 'RC',
  insurance: 'Insurance',
  permit: 'Permit',
  puc: 'PUC',
  fitness: 'Fitness Certificate',
  road_tax: 'Road Tax',
};
