// Explicit pagination with exact count, so REST row caps cannot silently truncate.
export async function fetchAllRows<T>(query: (offset: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null; count: number | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error, count } = await query(rows.length);
    if (error) throw new Error(error.message);
    if (count === null) throw new Error('The server did not return a complete result count.');
    const page = data ?? [];
    rows.push(...page as T[]);
    if (rows.length >= count) return rows;
    if (!page.length) throw new Error('Results are incomplete. Please retry.');
  }
}
