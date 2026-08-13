export const FILE_STATUSES = ['pending', 'confirmed', 'failed'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];
