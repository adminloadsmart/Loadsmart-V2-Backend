/**
 * Opaque keyset cursor for GET /loads/live — the last row's (createdAt, id), base64url-encoded.
 * Keyset rather than page/offset because live loads change status while the user scrolls: a load
 * that gets closed mid-scroll would shift every later offset and skip or repeat rows.
 */
export interface LiveLoadsCursor {
  createdAt: Date;
  id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeLiveLoadsCursor({ createdAt, id }: LiveLoadsCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString(
    'base64url',
  );
}

/** Null when the cursor isn't one this endpoint issued. */
export function decodeLiveLoadsCursor(cursor: string): LiveLoadsCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const { createdAt, id } = parsed as Record<string, unknown>;
    if (typeof createdAt !== 'string' || typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      return null;
    }
    const date = new Date(createdAt);
    return Number.isNaN(date.getTime()) ? null : { createdAt: date, id };
  } catch {
    return null;
  }
}
