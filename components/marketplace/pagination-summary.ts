export function paginationSummary(shown: number, total?: number): string {
  const count = Math.max(0, shown).toLocaleString("en");
  return total === undefined ? `Showing ${count} · Total unavailable` : `Showing ${count} of ${Math.max(0, total).toLocaleString("en")}`;
}
