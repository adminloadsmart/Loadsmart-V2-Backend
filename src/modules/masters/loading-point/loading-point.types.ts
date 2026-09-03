export const LOADING_POINT_STATUSES = ['pending', 'active', 'inactive', 'rejected'] as const;
export type LoadingPointStatus = (typeof LOADING_POINT_STATUSES)[number];
