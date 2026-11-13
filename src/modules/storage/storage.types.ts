import { UploadPurpose } from './storage.constants';
import { FileEntity } from './entities/file.entity';

export interface GenerateUploadUrlInput {
  purpose: UploadPurpose;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadUrlResult {
  file: FileEntity;
  uploadUrl: string;
  uploadFields: Record<string, string>;
}

// The merged shape `get` returns — metadata plus a ready-to-use download URL, so FE never needs a
// second call just to render a file. Only non-null once the file is confirmed.
export interface FileWithUrlResult {
  file: FileEntity;
  downloadUrl: string | null;
}

export interface FileParams {
  fileId: string;
}

export interface GetByKeyQuery {
  key: string;
}

// The subset of the caller's identity storage.service.get() needs to decide which repository
// lookup to run and, for a tenant-less platform-scope caller, which other tenants' files it may
// read (see STAFF_CROSS_TENANT_READS). userId/permissions only matter on that staff branch —
// a staff caller that omits them can read no other tenant's file (not even its own uploads).
export interface FileAccessActor {
  tenantId: string | null;
  role: string;
  userId?: string;
  permissions?: string[];
}
