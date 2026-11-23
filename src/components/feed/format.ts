/** Compact Arabic number formatting for counts (likes, views). Pure, safe for server and client. */
export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")} مليون`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")} ألف`;
  return new Intl.NumberFormat("ar").format(value);
}
