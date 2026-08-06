export interface PaginationInput {
  page: number;
  limit: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(items: T[], total: number, { page, limit }: PaginationInput): Paginated<T> {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

/** Postgres `date` columns round-trip as 'YYYY-MM-DD' strings, so dates stay strings end to end. */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
