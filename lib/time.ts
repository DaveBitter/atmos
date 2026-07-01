// Rough local-solar-time day/night estimate for a given UTC instant and
// longitude — good enough for shading a marker, not for anything precise.
export function estimateIsDay(utcMs: number, lon: number): boolean {
  const utcHour = new Date(utcMs).getUTCHours() + new Date(utcMs).getUTCMinutes() / 60;
  const localHour = (((utcHour + lon / 15) % 24) + 24) % 24;
  return localHour >= 6 && localHour < 20;
}

// Index of the hourly entry closest to `targetMs`.
export function findNearestHourIndex(hourly: { time: string }[], targetMs: number): number {
  if (hourly.length === 0) return -1;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < hourly.length; i++) {
    const diff = Math.abs(new Date(hourly[i].time).getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

// --- Intl-backed formatters (shared instances — construction is not free) ---

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const monthYearFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  timeZone: "UTC", // monthly entries are YYYY-MM-01 with no real local time — keep them anchored to UTC
});
const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const absoluteDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// "5 minutes ago" / "in 3 hours" / "2 days ago" — locale-aware relative time,
// picking a sensible unit based on how far away the timestamp is.
export function formatRelativeTime(iso: string, referenceMs: number = Date.now()): string {
  const diffMs = new Date(iso).getTime() - referenceMs;
  const minutes = diffMs / 60_000;
  if (Math.abs(minutes) < 60) return relativeTimeFormatter.format(Math.round(minutes), "minute");
  const hours = diffMs / (60_000 * 60);
  if (Math.abs(hours) < 48) return relativeTimeFormatter.format(Math.round(hours), "hour");
  const days = diffMs / (60_000 * 60 * 24);
  if (Math.abs(days) < 60) return relativeTimeFormatter.format(Math.round(days), "day");
  const months = diffMs / (60_000 * 60 * 24 * 30.44);
  if (Math.abs(months) < 24) return relativeTimeFormatter.format(Math.round(months), "month");
  const years = diffMs / (60_000 * 60 * 24 * 365.25);
  return relativeTimeFormatter.format(Math.round(years), "year");
}

// "Jun 14, 2026, 3:45 PM" — absolute, locale-formatted date + time. Used
// instead of formatRelativeTime whenever "ago" would be nonsensical, e.g. a
// quake from decades back while scrubbed into deep history.
export function formatAbsoluteDateTime(iso: string): string {
  return absoluteDateTimeFormatter.format(new Date(iso));
}

// "June 14, 2026" — for a plain YYYY-MM-DD date string (treated as UTC).
export function formatFullDate(dateStr: string): string {
  return fullDateFormatter.format(new Date(`${dateStr}T00:00:00Z`));
}

// "Tue" — short weekday for a full ISO timestamp.
export function formatWeekday(iso: string): string {
  return weekdayFormatter.format(new Date(iso));
}

// "3:45 PM" — time only, e.g. for a "last updated" label.
export function formatTimeOnly(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

// "Jun 2026" — for a YYYY-MM-01 monthly-history entry.
export function formatMonthYear(dateStr: string): string {
  return monthYearFormatter.format(new Date(`${dateStr}T00:00:00Z`));
}

// "Today 14:00" / "Tomorrow 08:00" / "Tue 22:00" — relative-ish label for the
// scrubber. The Today/Tomorrow/Yesterday part comes from
// Intl.RelativeTimeFormat's "day" unit rather than hand-rolled strings.
export function formatScrubTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const dayDiff = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      dayMs
  );

  const time = timeFormatter.format(date);
  if (Math.abs(dayDiff) <= 1) return `${capitalize(relativeTimeFormatter.format(dayDiff, "day"))} ${time}`;
  return `${weekdayFormatter.format(date)} ${time}`;
}
