import { CalendarClock, MessageSquareText } from "lucide-react";
import { PanelShell, PanelSection } from "../components/ava/PanelShell.js";

/**
 * Schedule, before reminders exist (contract i3a-navigation). One honest page:
 * nothing here may look operational until AVA can actually deliver reminders.
 */
export function ScheduleScreen({ onOpenTalk }: { onOpenTalk: () => void }) {
  return (
    <PanelShell title="Schedule">
      <PanelSection title="Coming next">
        <div className="flex max-w-xl flex-col gap-4 text-sm leading-6 text-white/75">
          <div className="flex items-center gap-3 text-white/90">
            <CalendarClock size={18} className="shrink-0 text-[var(--ac)]" aria-hidden />
            <span className="font-medium">Reminders and deadlines are not active yet.</span>
          </div>
          <p>
            Your schedule of deadlines, classes, exams and reminders arrives with the next update.
            Until then AVA cannot reliably deliver reminders to your phone, so nothing here pretends to.
          </p>
          <p className="text-white/60">
            You can still tell AVA about a deadline in Talk. It is kept in the conversation.
          </p>
          <div>
            <button type="button" onClick={onOpenTalk} className="btn-deck btn-primary">
              <MessageSquareText size={14} aria-hidden />
              <span>Go to Talk</span>
            </button>
          </div>
        </div>
      </PanelSection>
    </PanelShell>
  );
}
