import type { ReminderPresentation, ReminderTone } from "./presenter.js";

const TONE_CHIP: Record<ReminderTone, string> = {
  pending: "",
  muted: "text-white/55",
  active: "chip-ac",
  good: "chip-live",
  warn: "chip-exec",
  bad: "chip-stop",
};

/** The receipt label as a deck chip; the colour only repeats what the words say. */
export function ReminderStatusChip({ presentation }: { presentation: ReminderPresentation }) {
  return (
    <span
      className={`chip max-w-full shrink-0 whitespace-normal text-left text-[11px] ${TONE_CHIP[presentation.tone]}`}
      data-reminder-tone={presentation.tone}
    >
      {presentation.label}
    </span>
  );
}
