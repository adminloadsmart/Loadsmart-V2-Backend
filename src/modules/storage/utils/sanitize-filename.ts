// Strips anything that isn't safe to embed in an S3 key or a Content-Disposition filename, and
// caps the length. Truncates from the front so the extension (the part a viewer/downloader
// actually needs) always survives.
const MAX_LENGTH = 100;

export function sanitizeFileName(fileName: string): string {
  const safe = fileName
    .replace(/[/\\]/g, '_') // strip path separators — this becomes part of the S3 key
    .replace(/[^a-zA-Z0-9._-]/g, '_') // drop anything else non-portable (spaces, unicode, control chars)
    .replace(/_+/g, '_');
  return safe.slice(-MAX_LENGTH);
}
