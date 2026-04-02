import type { PaginationParams } from '@ofauria/shared';

export function parsePagination(query: Record<string, unknown>): Required<PaginationParams> {
  return {
    page: Math.max(1, parseInt(String(query.page || '1'), 10)),
    limit: Math.min(100, Math.max(1, parseInt(String(query.limit || '20'), 10))),
    sortBy: String(query.sortBy || 'created_at'),
    sortOrder: query.sortOrder === 'asc' ? 'asc' : 'desc',
    search: String(query.search || ''),
  };
}

export function paginationToSQL(params: Required<PaginationParams>, allowedSortColumns: string[]) {
  const sortBy = allowedSortColumns.includes(params.sortBy) ? params.sortBy : 'created_at';
  const offset = (params.page - 1) * params.limit;
  return {
    orderClause: `ORDER BY ${sortBy} ${params.sortOrder}`,
    limitClause: `LIMIT ${params.limit} OFFSET ${offset}`,
    offset,
  };
}
