/**
 * One authoritative "now" for prompts (voice-live-engine v3). Computed per
 * request at execution time, so queued work, midnight and DST stay correct.
 */
export const DEFAULT_CLOCK_ZONE = "Europe/Dublin";

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export type ClockNow = { timeZone: string; localDate: string; localTime: string; weekday: string; utcOffset: string };

export function clockNow(at: number = Date.now(), timeZone: string = DEFAULT_CLOCK_ZONE): ClockNow {
  const parts = formatter(timeZone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const offset = get("timeZoneName").replace("GMT", "") || "+00:00";
  return {
    timeZone,
    localDate: `${get("year")}-${get("month")}-${get("day")}`,
    localTime: `${get("hour")}:${get("minute")}`,
    weekday: get("weekday"),
    utcOffset: offset.startsWith("+") || offset.startsWith("-") ? offset : `+${offset}`,
  };
}

/** A single prompt line; no tool call is needed to know the date. */
export function clockLine(at: number = Date.now(), timeZone: string = DEFAULT_CLOCK_ZONE): string {
  const c = clockNow(at, timeZone);
  return `[NOW] ${c.weekday} ${c.localDate} ${c.localTime} ${c.timeZone} (UTC${c.utcOffset}). Use this; do not look up the date or time with a tool.`;
}
