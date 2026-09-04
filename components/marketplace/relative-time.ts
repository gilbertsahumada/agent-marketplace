export function relativeAge(value: string | number, now = Date.now()): string {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 5) return "now";
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  if (elapsedSeconds < 3_600) return `${Math.floor(elapsedSeconds / 60)}m ago`;
  if (elapsedSeconds < 86_400) return `${Math.floor(elapsedSeconds / 3_600)}h ago`;
  return `${Math.floor(elapsedSeconds / 86_400)}d ago`;
}
