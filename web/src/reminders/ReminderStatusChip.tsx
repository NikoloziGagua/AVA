import type { ReminderPresentation, ReminderTone } from "./presenter.js";

const TONE_CHIP: Record<ReminderTone, string> = {
  pending: "",
  muted: "text-white/55",
  active: "chip-ac",
  good: "chip-live",
  warn: "chip-exec",
  bad: "chip-stop",
};

/** Existing dark hosts keep their readable deck variant, even under Paper. */
export function ReminderStatusChip({ presentation, appearance = "legacy" }: { presentation: ReminderPresentation; appearance?: "legacy" | "atelier" }) {
  return (
    <span
      className={appearance === "atelier" ? "ds-reminder-status" : `chip max-w-full shrink-0 whitespace-normal text-left text-xs ${TONE_CHIP[presentation.tone]}`}
      data-reminder-appearance={appearance}
      data-reminder-tone={presentation.tone}
    >
      {presentation.label}
    </span>
  );
}
