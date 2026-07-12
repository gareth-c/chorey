function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

interface ZonedYMD {
  year: number;
  month: number; // 1-12
  day: number;
}

function zonedYMD(date: Date, timeZone: string): ZonedYMD {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Minutes `timeZone` is ahead of UTC at the given instant (accounts for DST). */
function offsetMinutesAt(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  let hour = get("hour");
  if (hour === 24) hour = 0; // some locales render midnight as "24"
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return (asUTC - date.getTime()) / 60000;
}

/** UTC instant of local midnight (00:00:00) for the given calendar date in `timeZone`. */
function localMidnightUTC(ymd: ZonedYMD, timeZone: string): Date {
  const naiveUTC = Date.UTC(ymd.year, ymd.month - 1, ymd.day);
  const offsetMin = offsetMinutesAt(new Date(naiveUTC), timeZone);
  return new Date(naiveUTC - offsetMin * 60000);
}

/** `days` calendar days before/after `ymd` — pure calendar arithmetic, no timezone involved. */
function shiftYMD(ymd: ZonedYMD, days: number): ZonedYMD {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0=Sun..6=Sat for a calendar date — independent of timezone once Y-M-D is known. */
function weekdayOf(ymd: ZonedYMD): number {
  return new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day)).getUTCDay();
}

/** The 'YYYY-MM-DD' calendar date `date` falls on in `timeZone`. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const { year, month, day } = zonedYMD(date, timeZone);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** The 'YYYY-MM' calendar month `date` falls in, in `timeZone`. */
export function zonedMonthKey(date: Date, timeZone: string): string {
  const { year, month } = zonedYMD(date, timeZone);
  return `${year}-${pad2(month)}`;
}

/** UTC instant of local midnight for the calendar day `date` falls on in `timeZone`. */
export function zonedDayStart(date: Date, timeZone: string): Date {
  return localMidnightUTC(zonedYMD(date, timeZone), timeZone);
}

/**
 * UTC instant of local midnight, Monday, of the week `date` falls in, in
 * `timeZone`. Re-derives local midnight for the resolved Monday rather than
 * subtracting milliseconds, so a DST transition inside the week doesn't
 * skew the result by an hour.
 */
export function zonedWeekStart(date: Date, timeZone: string): Date {
  const ymd = zonedYMD(date, timeZone);
  const diffToMonday = (weekdayOf(ymd) + 6) % 7;
  return localMidnightUTC(shiftYMD(ymd, -diffToMonday), timeZone);
}

/**
 * Local midnight of the calendar day `days` after (or before, if negative)
 * the day `date` falls on in `timeZone`. Pure calendar arithmetic on the
 * local Y-M-D — never "instant ± N×24h", which lands an hour off whenever a
 * DST transition sits between the two instants.
 */
export function zonedAddDays(date: Date, days: number, timeZone: string): Date {
  return localMidnightUTC(shiftYMD(zonedYMD(date, timeZone), days), timeZone);
}

/** Format a UTC Date as a SQLite-comparable 'YYYY-MM-DD HH:MM:SS' string (matches datetime('now')'s format). */
export function toSqliteDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

let cachedTimezones: string[] | null = null;

export function listTimezones(): string[] {
  if (!cachedTimezones) {
    // "UTC" is a valid Intl timeZone identifier (used as this app's default)
    // but Intl.supportedValuesOf("timeZone") doesn't enumerate it — only
    // "Etc/UTC" is. Prepend it explicitly so it's selectable and passes
    // isValidTimezone(), instead of silently falling back to whatever
    // option happens to sort first.
    try {
      cachedTimezones = ["UTC", ...Intl.supportedValuesOf("timeZone")];
    } catch {
      cachedTimezones = ["UTC"];
    }
  }
  return cachedTimezones;
}

export function isValidTimezone(tz: string): boolean {
  return listTimezones().includes(tz);
}
