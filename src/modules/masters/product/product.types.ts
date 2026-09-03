export const PRODUCT_APPROVAL_STATUSES = ['pending_approval', 'approved', 'rejected'] as const;
export type ProductApprovalStatus = (typeof PRODUCT_APPROVAL_STATUSES)[number];

export const PRODUCT_STATUSES = ['active', 'inactive'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
