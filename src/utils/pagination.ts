import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

/** Reusable query schema: ?page=1&limit=10 (coerced from strings). */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Converts page/limit into Prisma's skip/take. */
export const getPaginationArgs = ({ page, limit }: PaginationQuery) => ({
  skip: (page - 1) * limit,
  take: limit,
});

export const buildPaginationMeta = (
  { page, limit }: PaginationQuery,
  total: number,
): PaginationMeta => ({
  page,
  limit,
  total,
  totalPages: total === 0 ? 0 : Math.ceil(total / limit),
});
