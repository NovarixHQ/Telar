const DAY = 86_400_000;

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function rowTime(at: number, now = Date.now()): { label: string; full: string } {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const full = date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days === 0) return { label: time, full };
  if (days === 1) return { label: `Yesterday ${time}`, full };
  if (days > 1 && days < 7) return { label: `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`, full };
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  return { label: `${day}, ${time}`, full };
}
