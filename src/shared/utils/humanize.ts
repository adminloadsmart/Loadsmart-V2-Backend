/** Turns a snake_case status value into space-separated text for user-facing messages
 *  (e.g. "on_trip" -> "on trip"). No capitalization — these values are always embedded
 *  mid-sentence ("...is on trip and cannot..."), so title-casing would read wrong. */
export function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ');
}
