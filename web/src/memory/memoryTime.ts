// Memory dates read in Dublin time, the way Niko would say them: "11 Aug", "30 Sep, 12:39".
const ZONE = "Europe/Dublin";
const yearOf = (at: number) => new Intl.DateTimeFormat("en-IE", { timeZone: ZONE, year: "numeric" }).format(at);

export function day(at: number): string {
  const otherYear = yearOf(at) !== yearOf(Date.now());
  return new Intl.DateTimeFormat("en-IE", { timeZone: ZONE, day: "numeric", month: "short", ...(otherYear ? { year: "numeric" } : {}) }).format(at);
}

export const moment = (at: number) =>
  new Intl.DateTimeFormat("en-IE", { timeZone: ZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);

/** A yyyy-mm-dd calendar date (how learned how-tos record their use) as "15 Aug". */
export function calendarDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return day(Date.parse(`${value}T12:00:00Z`));
}
