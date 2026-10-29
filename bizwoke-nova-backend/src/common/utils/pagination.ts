import { z } from 'zod';

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationQuery>;

/** Builds a validated sort spec from an allowlist; `-field` means descending. */
export function sortQuery<T extends string>(allowed: readonly [T, ...T[]], fallback: string) {
  const values = allowed.flatMap((f) => [f, `-${f}`]) as [string, ...string[]];
  return z.enum(values).default(fallback);
}

export function toMongoSort(sort: string): Record<string, 1 | -1> {
  return sort.startsWith('-') ? { [sort.slice(1)]: -1, _id: -1 } : { [sort]: 1, _id: 1 };
}

export function pageMeta(p: PaginationInput, total: number) {
  return { page: p.page, limit: p.limit, total, totalPages: Math.ceil(total / p.limit) };
}

export function skipFor(p: PaginationInput): number {
  return (p.page - 1) * p.limit;
}
