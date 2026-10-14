/** Start of the last page, including a partially filled page. */
export function lastPageOffset(count: number, pageSize: number): number {
  return count > 0 ? Math.floor((count - 1) / pageSize) * pageSize : 0;
}
