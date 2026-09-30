import { useState } from "react";
import { ApprovalCard } from "../approvals/ApprovalCard.js";
import { Button } from "../design/Button.js";
import { StatusIsland } from "../design/StatusIsland.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { StepsSheet } from "./StepsSheet.js";
import { TaskReceiptCard } from "./TaskReceiptCard.js";
import { ThinkingIndicator } from "./ThinkingIndicator.js";
import type { StreamEvent } from "./useChatStream.js";

/**
 * Talk in the design gallery (?design-gallery), built from the real components
 * with sample content. Nothing here talks to the server: the approval card's
 * decision is a local stand-in.
 */

const HISTORY: ChatMessage[] = [
  { id: "g-u1", role: "user", text: "Can you plan my Agile revision this week?\nThe exam is on Friday." },
  {
    id: "g-a1",
    role: "assistant",
    text: [
      "## Agile revision, Monday to Thursday",
      "",
      "You have **four evenings**. I'd spend them like this:",
      "",
      "1. **Monday** — Scrum roles and events, from your *Scrum in 100 Words* note.",
      "2. **Tuesday** — user stories and estimation; do two past questions.",
      "3. **Wednesday** — Kanban versus Scrum, with one worked comparison.",
      "4. **Thursday** — a timed mock paper, then rest.",
      "",
      "| Day | Topic | Time |",
      "| --- | --- | --- |",
      "| Mon | Scrum | 90 min |",
      "| Tue | Stories | 60 min |",
      "",
      "I put a reminder on Thursday at `18:00` for the mock paper.",
    ].join("\n"),
    savedItems: { schemaVersion: 1, items: [{ kind: "reminder", id: "g-r1", title: "Agile mock paper" }] },
    memoryContext: {
      schemaVersion: 1,
      status: "used",
      reason: "Your Agile notes and the exam date were relevant to planning.",
      project: "University — Agile Development",
      mode: "hybrid",
      semanticAvailable: true,
      notice: null,
      selected: [{
        entryId: "g-m1", title: "Scrum in 100 Words — exam wording", kind: "note", project: "Agile Development",
        sourceStatus: "verified", matchMode: "hybrid", matchReason: "Matches 'Agile' and 'exam'.", sourceTruncated: false,
      }],
    },
  },
  { id: "g-u2", role: "user", text: "And check the lecture slides are in the Agile folder." },
];

const base = { runEpoch: 1 } as const;
const LIVE: StreamEvent[] = [
  { ...base, id: 1, kind: "tool_call", payload: { tool: "read_file", args: { path: "Agile/slides-week-9.pdf" } } },
  { ...base, id: 2, kind: "tool_result", payload: { tool: "read_file", ok: false, result: "ENOENT: no such file 'Agile/slides-week-9.pdf'" } },
] as StreamEvent[];

const STEPS = [
  { key: "s1", label: "Searching your notes for 'Agile'", status: "done" as const, ok: true },
  { key: "s2", label: "Reading Agile/slides-week-9.pdf", status: "done" as const, ok: false, reason: "No such file" },
  { key: "s3", label: "Listing the Agile folder", status: "running" as const },
];

export function TalkGallery() {
  const [stepsOpen, setStepsOpen] = useState(false);
  const [decision, setDecision] = useState<"approved" | "denied" | null>(null);
  const now = Date.now();
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusIsland mode="idle" />
        <StatusIsland mode="thinking" />
        <StatusIsland mode="thinking" text="Writing" />
        <StatusIsland mode="working" detail="Listing the Agile folder" />
        <StatusIsland mode="attention" detail="Approve or decline below" />
        <Button variant="glass" size="sm" onClick={() => setStepsOpen(true)}>Show what AVA did</Button>
      </div>
      <StepsSheet open={stepsOpen} onOpenChange={setStepsOpen} steps={STEPS} executing />

      <div className="flex h-[640px] flex-col overflow-hidden rounded-sheet bg-canvas shadow-e2">
        <MessageList history={HISTORY} liveEvents={LIVE} onRetry={() => {}} optimisticThinking executing runningTool="Listing the Agile folder" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ApprovalCard
          id="gallery-approval"
          tool="send_email"
          args={{ to: "tutor@example.edu", subject: "Extension request" }}
          summary="Send the extension request to your tutor"
          resolvedStatus={decision}
          riskTier="medium"
          timeoutBehavior="auto_approve"
          requestedAt={now}
          deadlineAt={now + 15_000}
          timeoutMs={15_000}
          decide={async (_id, action) => {
            await new Promise((resolve) => setTimeout(resolve, 700));
            setDecision(action === "approve" ? "approved" : "denied");
          }}
        />
        <div className="grid content-start gap-3">
          <ThinkingIndicator caption="Listing the Agile folder…" state="executing" reduced={false} />
          <TaskReceiptCard receipt={{
            schemaVersion: 2, taskId: "gallery-task", expected: "The revision plan saved and a reminder set",
            actual: "Plan written; reminder set for Thursday 18:00", lifecycle: "finished", outcome: "verified",
            verificationScope: "task_outcome", lastVerifiedStage: "Reminder read back from the schedule", observationPoint: null,
            rootCause: "not_applicable", recoveryAction: null,
            evidence: [{ kind: "verification", label: "Reminder exists", detail: "Read back Thursday 18:00", strength: "verified", method: "db_readback" }],
            toolCalls: 3, successfulToolResults: 2, uncertainToolResults: 0, failedToolResults: 1, startedAt: now, updatedAt: now, durationMs: 4200,
          }} />
        </div>
      </div>
    </div>
  );
}
