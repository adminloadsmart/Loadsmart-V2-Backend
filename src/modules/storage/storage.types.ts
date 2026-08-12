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

// The subset of the caller's identity storage.service.get() needs to decide which repository
// lookup to run — see storage.service.ts's platform_admin bypass.
export interface FileAccessActor {
  tenantId: string | null;
  role: string;
}
