const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * ISO 8601 → Date. По контракту внешний API отдаёт время в UTC,
 * но иногда без указателя зоны ("2026-03-01T00:40:39") — такие строки тоже считаем UTC.
 */
export function parseUtc(raw: unknown): Date {
  if (typeof raw !== "string") throw new Error(`invalid date: ${JSON.stringify(raw)}`);
  const s = raw.trim();
  const d = new Date(HAS_ZONE.test(s) ? s : `${s}Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${JSON.stringify(raw)}`);
  return d;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Форматтер календарных полей в зоне `timeZone`; Intl.DateTimeFormat дорогой в создании — кэшируем. */
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClock(timeZone: string, at: Date) {
  const parts = formatter(timeZone).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Смещение таймзоны относительно UTC в минутах в момент `at` (Europe/Moscow → 180). */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const w = wallClock(timeZone, at);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Календарная дата (YYYY-MM-DD) момента `at` в зоне `timeZone`.
 * Учитывает смещение именно в этот момент — в зонах с летним временем оно меняется в течение года.
 */
export function localDate(timeZone: string, at: Date): string {
  const w = wallClock(timeZone, at);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** Календарная дата (YYYY-MM-DD) момента `at` при смещении `offsetMinutes`. */
export function dateAtOffset(at: Date, offsetMinutes: number): string {
  return new Date(at.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  return new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}

/** Все даты от from до to включительно. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
