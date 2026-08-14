import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
}

export interface CreatePresignedPostParams {
  key: string;
  contentType: string;
  maxSizeBytes: number;
  expiresInSeconds: number;
}

// Thin wrapper around the AWS SDK — first tenant of the (until now empty) src/adapters/ boundary
// element declared in eslint.config.js. Deliberately takes a plain S3Client + bucket, no `env`
// import here, so it stays independently testable without pulling in process.env.
//
// Every method catches and rethrows with the operation + key that failed, via `wrapError` below
// — this doesn't change *what* fails (callers still see a rejected promise for every real error,
// and storage.service.ts's own try/catch + rethrow() still turns that into a 500 for the HTTP
// response), it just makes the failure legible: without this, a raw AWS SDK error surfaces with
// no indication of which key/operation it was for.
export class S3Adapter {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async createPresignedPost(params: CreatePresignedPostParams): Promise<PresignedPost> {
    try {
      const { url, fields } = await createPresignedPost(this.client, {
        Bucket: this.bucket,
        Key: params.key,
        Conditions: [
          ['content-length-range', 0, params.maxSizeBytes],
          ['eq', '$Content-Type', params.contentType],
        ],
        Fields: { 'Content-Type': params.contentType },
        Expires: params.expiresInSeconds,
      });
      return { url, fields };
    } catch (error) {
      this.wrapError(`Failed to create presigned upload POST for key "${params.key}"`, error);
    }
  }

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } catch (error) {
      this.wrapError(`Failed to upload S3 object at key "${key}"`, error);
    }
  }

  // Returns null when the object was never uploaded (or the upload failed partway) — callers use
  // this to distinguish "not there yet" from a real infra error, which is wrapped and rethrown.
  async headObject(key: string): Promise<{ contentLength: number } | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { contentLength: result.ContentLength ?? 0 };
    } catch (error) {
      if (error instanceof NotFound) return null;
      this.wrapError(`Failed to check S3 object at key "${key}"`, error);
    }
  }

  async getPresignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn: expiresInSeconds },
      );
    } catch (error) {
      this.wrapError(`Failed to create presigned download URL for key "${key}"`, error);
    }
  }

  // S3's DeleteObject is already idempotent (204 whether or not the key exists), so a caught
  // error here is a real infra failure (permissions, network), not a missing-key case — callers
  // that want a best-effort delete (purgeStalePending) catch this themselves rather than have it
  // silently swallowed at the adapter level.
  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      this.wrapError(`Failed to delete S3 object at key "${key}"`, error);
    }
  }

  // Preserves the original SDK error as `cause` — nothing here reads it today, but it keeps the
  // full error chain available for anyone debugging via `details`/stack trace later, instead of
  // discarding it in favor of just the new message.
  private wrapError(message: string, error: unknown): never {
    throw new Error(message, { cause: error });
  }
}
