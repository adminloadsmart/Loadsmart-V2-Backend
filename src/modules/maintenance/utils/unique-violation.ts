import { QueryFailedError } from 'typeorm';

/** Postgres unique_violation — a partial unique index (one open breakdown per truck, one tyre per
 *  position, one SoH reading per month) lost a race with a concurrent write. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === '23505'
  );
}
