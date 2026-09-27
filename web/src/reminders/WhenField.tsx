import { useId } from "react";
import { formatOffset, formatWallTime, resolveWallTime, type ResolvedWallTime } from "./time.js";

/** v1: a one-off reminder must be in the future and at most 366 days away. */
export const MAX_REMINDER_AHEAD_MS = 366 * 24 * 60 * 60_000;

/** Which of two identical wall times (an autumn overlap) the person chose. */
export type Occurrence = 0 | 1 | null;

export type WhenResolution =
  | { ok: true; instant: number; offsetMinutes: number }
  | { ok: false; message: string };

function dateOnly(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/** Turn a datetime-local value into one exact instant, or say why not. */
export function resolveWhen(
  value: string,
  occurrence: Occurrence,
  zone: string,
  now: number = Date.now(),
  resolved: ResolvedWallTime = resolveWallTime(value, zone),
): WhenResolution {
  if (resolved.kind === "invalid") return { ok: false, message: "Enter a complete date and time." };
  if (resolved.kind === "gap") {
    return {
      ok: false,
      message: `${value.slice(11)} doesn't exist on ${dateOnly(value)} in ${zone}, because the clocks go forward. Choose another time.`,
    };
  }
  let candidate;
  if (resolved.kind === "ambiguous") {
    if (occurrence === null) {
      return { ok: false, message: `${value.slice(11)} happens twice on ${dateOnly(value)} in ${zone}. Choose which one.` };
    }
    candidate = resolved.candidates[occurrence];
  } else {
    candidate = resolved.candidate;
  }
  if (candidate.instant <= now) return { ok: false, message: "Choose a time in the future." };
  if (candidate.instant > now + MAX_REMINDER_AHEAD_MS) return { ok: false, message: "Choose a time within the next year." };
  return { ok: true, instant: candidate.instant, offsetMinutes: candidate.offsetMinutes };
}

/**
 * A datetime-local input that never guesses: it names the zone, shows the
 * exact offset, refuses times skipped by a clock change and asks which one is
 * meant when a time happens twice.
 */
export function WhenField({
  label,
  value,
  onChange,
  occurrence,
  onOccurrenceChange,
  zone,
  disabled = false,
  showErrors = false,
  now,
  appearance = "legacy",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  occurrence: Occurrence;
  onOccurrenceChange: (occurrence: Occurrence) => void;
  zone: string;
  disabled?: boolean;
  /** Show validation messages (after the first submit attempt). */
  showErrors?: boolean;
  now?: number;
  appearance?: "legacy" | "atelier";
}) {
  const id = useId();
  const resolved = resolveWallTime(value, zone);
  const check = resolveWhen(value, occurrence, zone, now, resolved);
  const invalid = !check.ok && (resolved.kind === "gap" || showErrors);
  const atelier = appearance === "atelier";

  return (
    <div className={atelier ? "ds-reminder-when" : "flex flex-col gap-2"} data-reminder-appearance={appearance}>
      <label htmlFor={id} className={atelier ? "text-meta text-ink-2" : "text-xs text-white/60"}>{label}</label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        disabled={disabled}
        onChange={(event) => { onChange(event.target.value); onOccurrenceChange(null); }}
        aria-describedby={`${id}-zone${invalid ? ` ${id}-error` : ""}`}
        aria-invalid={invalid || undefined}
        className={atelier ? "ds-schedule-input" : "ds-focus w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white disabled:opacity-60"}
      />
      <p id={`${id}-zone`} className={atelier ? "text-meta text-ink-2" : "text-xs leading-5 text-white/50"}>
        {resolved.kind === "exact"
          ? `${formatWallTime(resolved.candidate.instant, zone)} · ${zone} (${formatOffset(resolved.candidate.offsetMinutes)})`
          : `Times are in ${zone}.`}
      </p>

      {resolved.kind === "ambiguous" && (
        <fieldset className={atelier ? "ds-reminder-occurrence" : "rounded-lg border border-amber-200/20 bg-amber-300/[0.05] px-3 py-2.5 text-xs text-amber-50/80"}>
          <legend className="px-1 text-xs">
            {value.slice(11)} happens twice on {dateOnly(value)} because the clocks go back. Which one?
          </legend>
          {resolved.candidates.map((candidate, index) => (
            <label key={candidate.instant} className="mt-1.5 flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-occurrence`}
                checked={occurrence === index}
                disabled={disabled}
                onChange={() => onOccurrenceChange(index as 0 | 1)}
                className={atelier ? "ds-focus" : "ds-focus accent-cyan-300"}
              />
              <span>
                {index === 0 ? "The first one" : "The second one"} ({formatOffset(candidate.offsetMinutes)})
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {invalid && (
        <p id={`${id}-error`} role="alert" className={atelier ? "text-meta text-danger" : "text-xs text-red-200"}>{check.message}</p>
      )}
    </div>
  );
}
