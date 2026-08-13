/**
 * Closed set of `action`/`resourceType` values passed to AuditService.log() — declared once as a
 * `const` tuple, same pattern as DRIVER_STATUSES etc. in masters/utils/drivers.types.ts, so a call
 * site can't pass an arbitrary string (typo or otherwise) that silently ends up in the audit log.
 * Add new entries here first, then use them at the call site.
 */
export const AUDIT_ACTIONS = [
  'ORGANIZATION_STATUS_UPDATED',
  'ORGANIZATION_DOCUMENT_VERIFIED',
  'ONLINE_KYC_VERIFIER_ASSIGNED',
  'PHYSICAL_KYC_AGENT_ASSIGNED',
  'ORGANIZATION_ONLINE_KYC_COMPLETED',
  'ORGANIZATION_PHYSICAL_KYC_APPROVED',
  'ORGANIZATION_APPROVED',
  'ORGANIZATION_REJECTED',
  'ORGANIZATION_DENIED',
  'REFERRAL_CODE_CREATED',
  'REFERRAL_CODE_UPDATED',
  'REFERRAL_CODE_REVOKED',
  'REFERRAL_CODE_DELETED',
  'STAFF_CREATED',
  'STAFF_UPDATED',
  'STAFF_DELETED',
  'ORG_USER_INVITED',
  'ROLE_ASSIGNED',
  'PERMISSION_GRANTED',
  'PERMISSION_REVOKED',
  'CUSTOMER_CREATED',
  'CUSTOMER_BULK_IMPORTED',
  'CUSTOMER_UPDATED',
  'CUSTOMER_APPROVED',
  'CUSTOMER_REJECTED',
  'VEHICLE_APPROVED',
  'VEHICLE_REJECTED',
  'DRIVER_APPROVED',
  'DRIVER_REJECTED',
  'LOADING_POINT_APPROVED',
  'LOADING_POINT_REJECTED',
  'CUSTOMER_DELETED',
  'TRANSPORTER_CREATED',
  'TRANSPORTER_UPDATED',
  'TRANSPORTER_DELETED',
  'TRANSPORTER_BULK_IMPORTED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_RESOURCE_TYPES = [
  'organization',
  'organization_document',
  'referral_code',
  'user',
  'customer',
  'vehicle',
  'driver',
  'loading_point',
  'transporter',
] as const;
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];
