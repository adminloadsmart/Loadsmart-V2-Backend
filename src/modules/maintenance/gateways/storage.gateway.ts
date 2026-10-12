/** What maintenance needs from storage — checking an attached invoice was really uploaded. */
export interface StorageGateway {
  /** Throws a ValidationError unless `key` is a confirmed `maintenance/invoice` upload of this tenant. */
  assertInvoiceUpload(tenantId: string, actorRole: string, key: string): Promise<void>;
  /** A fresh, short-lived download URL for an attached invoice, or null when the file can't be
   *  resolved (missing, or not a confirmed upload) — a history read never fails over one file. */
  getInvoiceDownloadUrl(tenantId: string, actorRole: string, key: string): Promise<string | null>;
}
