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

export function paginate<T>(
  items: T[],
  total: number,
  { page, limit }: PaginationInput,
): Paginated<T> {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}
