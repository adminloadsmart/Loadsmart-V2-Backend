/** What maintenance needs from storage — checking an attached invoice was really uploaded. */
export interface StorageGateway {
  /** Throws a ValidationError unless `key` is a confirmed `maintenance/invoice` upload of this tenant. */
  assertInvoiceUpload(tenantId: string, actorRole: string, key: string): Promise<void>;
}
