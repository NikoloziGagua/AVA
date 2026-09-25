import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import type { FaceMode } from "./face/animator.js";
import {
  Activity, BellRing, BookOpen, Brain, CalendarDays, CheckCircle2, Folder, FolderPlus, Inbox, Lightbulb, MessageSquareText,
  NotebookPen, Plus, Presentation, Radar, Send, Settings2, Sparkles, Sun, AlarmClock, Home,
} from "lucide-react";
import {
  ApprovalSheet, Badge, BottomBar, Button, Card, CardMeta, CardTitle, Chip, EmptyState, ErrorState, Field, FloatingStack, NumberTicker,
  ProgressRing, Prose, Receipt, Row, Segmented, Select, Sheet, Skeleton, StatusIsland, SuggestionChips, Surface, Switch, Tag,
  TextArea, TextInput, Tile, TileGrid, ToastProvider, useToast, type Destination, type IslandMode,
} from "./index.js";

const DESTINATIONS: Destination[] = [
  { id: "home", label: "Home", icon: <Home size={18} />, group: "primary" },
  { id: "today", label: "Today", icon: <Sun size={18} />, group: "primary", meta: "2 due" },
  { id: "talk", label: "Talk", icon: <MessageSquareText size={18} />, group: "primary" },
  { id: "notes", label: "Notes", icon: <NotebookPen size={18} />, group: "primary" },
  { id: "calendar", label: "Calendar", icon: <CalendarDays size={18} />, group: "primary" },
  { id: "ideas", label: "Ideas", icon: <Lightbulb size={18} />, group: "primary" },
  { id: "memory", label: "Memory", icon: <Brain size={18} />, group: "system" },
  { id: "reminders", label: "Reminders & watches", icon: <AlarmClock size={18} />, group: "system" },
  { id: "explore", label: "Explore AVA", icon: <Radar size={18} />, group: "system" },
  { id: "visuals", label: "Visual explanations", icon: <Presentation size={18} />, group: "system" },
  { id: "activity", label: "Activity", icon: <Activity size={18} />, group: "system" },
  { id: "self", label: "Self development", icon: <Sparkles size={18} />, group: "system" },
  { id: "settings", label: "Settings", icon: <Settings2 size={18} />, group: "system" },
];

const RECENTS = [
  { id: "c1", title: "Plan for the Agile reflection", meta: "Today" },
  { id: "c2", title: "Lecture 4 questions", meta: "Yesterday" },
  { id: "c3", title: "Move Monday's reminder", meta: "Tue" },
];

function LiveBar() {
  const toast = useToast();
  const [current, setCurrent] = useState("home");
  const [draft, setDraft] = useState("");
  return (
    <BottomBar
      destinations={DESTINATIONS}
      current={current}
      onNavigate={(id) => { setCurrent(id); toast({ message: `Would open ${DESTINATIONS.find((d) => d.id === id)?.label}.` }); }}
      recents={RECENTS}
      onOpenRecent={(id) => toast({ message: `Would open "${RECENTS.find((r) => r.id === id)?.title}".` })}
      onOpenAllConversations={() => toast({ message: "Would open all conversations." })}
      draft={draft}
      onDraftChange={setDraft}
      onSend={(text) => { toast({ message: `Sent: ${text}`, tone: "success" }); setDraft(""); }}
      onTalk={() => toast({ message: "Would start talking to AVA." })}
    />
  );
}

const FaceStage = lazy(async () => ({ default: (await import("./face/FaceStage.js")).FaceStage }));
const TalkGallery = lazy(async () => ({ default: (await import("../chat/TalkGallery.js")).TalkGallery }));
const VoicePreview = lazy(async () => ({ default: (await import("../voice/VoicePreview.js")).VoicePreview }));

function FaceDemo() {
  const [mode, setMode] = useState<FaceMode>("idle");
  return (
    <div className="grid gap-4">
      <Segmented
        label="Face state"
        value={mode}
        onChange={setMode}
        options={[{ value: "idle", label: "Idle" }, { value: "listening", label: "Listening" }, { value: "thinking", label: "Thinking" }, { value: "speaking", label: "Speaking" }]}
        className="max-w-md"
      />
      <div className="ds-backlight relative h-[380px] max-w-md rounded-card bg-surface">
        <Suspense fallback={null}><FaceStage mode={mode} label="AVA" /></Suspense>
      </div>
    </div>
  );
}

function IslandDemo() {
  const [mode, setMode] = useState<IslandMode>("listening");
  return (
    <div className="grid gap-4">
      <Segmented
        label="AVA's state"
        value={mode}
        onChange={setMode}
        options={[{ value: "idle", label: "Idle" }, { value: "listening", label: "Listening" }, { value: "thinking", label: "Thinking" }, { value: "speaking", label: "Speaking" }]}
        className="max-w-md"
      />
      <div className="flex flex-wrap items-center gap-4">
        <StatusIsland mode={mode} time="09:41" className="mx-0" />
        <StatusIsland mode="working" detail="Filing your Agile notes" className="mx-0" />
        <StatusIsland mode="attention" text="Reminder" detail="Agile lecture in 15 min" className="mx-0" />
      </div>
    </div>
  );
}
import { applyLook, mirrorLookPref, readLookPref, type LookPref } from "./look.js";

/**
 * Live design-system gallery (open with ?design-gallery). Shows every design
 * component in the current look so Niko and Codex can review the remodel as it
 * is built. Not linked from the app.
 */

const COLOURS = [
  ["canvas", "bg-canvas"], ["raised", "bg-raised"], ["surface", "bg-surface"], ["surface-strong", "bg-surface-strong"],
  ["glass", "bg-glass"], ["solid", "bg-solid"], ["success", "bg-success"], ["warning", "bg-warning"],
  ["danger", "bg-danger"], ["info", "bg-info"],
] as const;

const TYPE = [
  ["display", "text-display", "Good evening, Niko."],
  ["title", "text-title", "Today"],
  ["heading", "text-heading", "Coming up"],
  ["body-lg", "text-body-lg", "Agile Development · Lecture"],
  ["body", "text-body", "AVA keeps your notes, lectures and reminders in one calm place."],
  ["meta", "text-meta", "Tomorrow · 10:00 – 11:00 · Room TBC"],
  ["label", "text-label", "NEXT UP"],
] as const;

export function GallerySection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="font-ui-mono text-label uppercase text-ink-3">{title}</h2>
        {note && <p className="text-meta text-ink-2">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Components() {
  const toast = useToast();
  const [view, setView] = useState<"pages" | "board" | "list">("pages");
  const [attend, setAttend] = useState<"attend" | "skip">("attend");
  const [notify, setNotify] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [approval, setApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("Lecture 4: Scrum roles");
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <>
      <GallerySection title="Bottom bar and menu" note="The only navigation. It is live at the bottom of this page: tap the round button (or press Ctrl+K) and it grows into the menu. Type to see the send button.">
        <LiveBar />
      </GallerySection>

      <GallerySection title="Talk" note="The new conversation screen, with sample content. AVA answers on the page without a bubble; your words sit in soft bubbles. What she is doing shows in the island, and her steps open in a sheet. Only a step that failed shows in the conversation. On Talk the message box is the bar at the bottom.">
        <Suspense fallback={null}><TalkGallery /></Suspense>
      </GallerySection>

      <GallerySection title="Voice" note="The Voice screen, full size, with a stand-in voice: switch between listening, thinking, speaking, working, an approval and hold-to-talk. It never opens the microphone.">
        <a href="?design-gallery=voice" className="ds-focus inline-flex h-11 w-fit items-center rounded-full bg-solid px-5 text-body font-medium text-on-solid">Open the Voice preview</a>
      </GallerySection>

      <GallerySection title="AVA's face" note="The one animated face. It shows once the face data from Codex's pipeline is in place; until then you see the still fallback.">
        <FaceDemo />
      </GallerySection>

      <GallerySection title="Status island" note="At the top of Home, Talk and Voice. Says what AVA is doing.">
        <IslandDemo />
      </GallerySection>

      <GallerySection title="Buttons" note="Solid is the one main action on a screen (it can shimmer). Glass for choices. Quiet for low-key actions. Danger only for destructive ones.">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="solid" shimmer leading={<Send size={16} aria-hidden="true" />}>Ask AVA</Button>
          <Button variant="glass">Attend</Button>
          <Button variant="quiet">Not now</Button>
          <Button variant="danger">Delete file</Button>
          <Button variant="glass" loading>Saving</Button>
          <Button variant="glass" size="icon" aria-label="Add"><Plus size={18} aria-hidden="true" /></Button>
          <Button variant="solid" size="sm">Small</Button>
        </div>
      </GallerySection>

      <GallerySection title="Chips and suggestions" note="Under the greeting on Home, so an empty screen still offers a next step.">
        <SuggestionChips suggestions={["Plan my day", "Continue Agile notes", "What is due this week?"]} onPick={setPicked} className="justify-start" />
        {picked && <p className="text-meta text-ink-2">You picked: {picked}</p>}
        <div className="flex flex-wrap gap-2">
          <Chip selected leading={<CheckCircle2 size={14} aria-hidden="true" />}>Attend</Chip>
          <Chip selected={false}>Skip</Chip>
        </div>
      </GallerySection>

      <GallerySection title="Segmented switch" note="Arrow keys move it. Used for views and settings with 2 to 4 choices.">
        <Segmented label="Notes view" value={view} onChange={setView} options={[{ value: "pages", label: "Pages" }, { value: "board", label: "Board" }, { value: "list", label: "List" }]} className="max-w-sm" />
        <Segmented label="Attendance" value={attend} onChange={setAttend} options={[{ value: "attend", label: "Attend" }, { value: "skip", label: "Skip" }]} className="max-w-56" />
      </GallerySection>

      <GallerySection title="Cards" note="Floating surfaces separated by space and shadow. No borders, no lines.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <div className="flex items-start gap-3">
              <span className="font-ui-mono text-meta tabular-nums text-ink-2">10:00</span>
              <div className="grid gap-1">
                <CardTitle>Agile Development · Lecture</CardTitle>
                <CardMeta>Until 11:00 · Room TBC</CardMeta>
              </div>
            </div>
            <div className="flex gap-2 pl-12">
              <Chip selected={attend === "attend"} onClick={() => setAttend("attend")}>Attend</Chip>
              <Chip selected={attend === "skip"} onClick={() => setAttend("skip")}>Skip</Chip>
            </div>
          </Card>
          <Surface tone="glass" elevation={3} className="grid content-start gap-2 p-4">
            <CardTitle>Glass surface</CardTitle>
            <CardMeta>Used for the bottom bar and sheets. Blurred only while it is still.</CardMeta>
          </Surface>
        </div>
      </GallerySection>

      <GallerySection title="Floating stack" note="Coming up on Today. Tap to fan the cards out.">
        <FloatingStack label="reminders" className="max-w-md">
          <Card><CardTitle>Submit Agile reflection</CardTitle><CardMeta>Friday · 17:00</CardMeta></Card>
          <Card><CardTitle>Review lecture 3 weak areas</CardTitle><CardMeta>Saturday · 11:00</CardMeta></Card>
          <Card><CardTitle>Agile Development · Lecture</CardTitle><CardMeta>Monday · 10:00 · not decided yet</CardMeta></Card>
        </FloatingStack>
      </GallerySection>

      <GallerySection title="Tiles" note="Places to go, like Notes folders.">
        <TileGrid>
          <Tile icon={<Folder size={20} />} title="AVA" meta="12 files" />
          <Tile icon={<Folder size={20} />} title="Agile Development" meta="2 files" />
          <Tile icon={<Inbox size={20} />} title="General" meta="2 files" />
          <Tile icon={<FolderPlus size={20} />} title="New folder" meta="or ask AVA" />
        </TileGrid>
      </GallerySection>

      <GallerySection title="Rows" note="Lists separated by space instead of lines.">
        <Surface className="grid p-2">
          <Row leading={<MessageSquareText size={18} />} title="Plan for the Agile reflection" meta="Today · 14:12" trailing={<Badge count={2} label="unread" />} onClick={() => undefined} />
          <Row leading={<CalendarDays size={18} />} title="Move Monday's lecture reminder" meta="Yesterday" onClick={() => undefined} />
          <Row leading={<Lightbulb size={18} />} title="Idea: daily brief at 8:00" meta="2 days ago" onClick={() => undefined} />
        </Surface>
      </GallerySection>

      <GallerySection title="Form fields" note="Labels are always visible. Errors say what to fix.">
        <div className="grid max-w-md gap-4">
          <Field label="File name" hint="Shown as the page title.">
            {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} value={title} onChange={(event) => setTitle(event.target.value)} />}
          </Field>
          <Field label="Folder" error="That name is already used here.">
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} defaultValue="agile">
                <option value="agile">University / Agile Development</option>
                <option value="ava">AVA</option>
              </Select>
            )}
          </Field>
          <Field label="Note">
            {({ id }) => <TextArea id={id} placeholder="Write the page…" rows={3} />}
          </Field>
          <div className="flex items-center justify-between gap-4">
            <span className="text-body text-ink">Lecture reminders</span>
            <Switch label="Lecture reminders" checked={notify} onChange={setNotify} />
          </div>
        </div>
      </GallerySection>

      <GallerySection title="Tags, counts and progress" note="A tag always says its state in words; colour is never the only signal.">
        <div className="flex flex-wrap items-center gap-3">
          <Tag>Draft</Tag>
          <Tag tone="success">Saved</Tag>
          <Tag tone="warning">Due soon</Tag>
          <Tag tone="danger">Failed</Tag>
          <Tag tone="info">Example</Tag>
          <Badge count={3} label="new" />
          <ProgressRing value={0.66} label="Study page filled" />
          <span className="text-title"><NumberTicker value={22} /></span>
          <span className="text-meta text-ink-2">notes kept</span>
        </div>
      </GallerySection>

      <GallerySection title="Receipts" note="Proof AVA did something, with the state in words.">
        <div className="grid max-w-xl gap-2">
          <Receipt icon={<BookOpen size={18} />} title="Saved to Agile Development" status="Saved" statusTone="success" detail="Lecture 4: Scrum roles · 3 new key concepts" proof="file 7Kg · v4" action={<Button size="sm" variant="quiet">Open</Button>} />
          <Receipt icon={<BellRing size={18} />} title="Reminder set" status="Scheduled" statusTone="info" detail="Friday 17:00 · Submit Agile reflection" />
          <Receipt icon={<Sparkles size={18} />} title="Posted to the dev room" status="Accepted" detail="Accepted by the room. Not yet read by an agent." proof="room message 512" />
        </div>
      </GallerySection>

      <GallerySection title="Long text" note="AVA's answers and note pages.">
        <Surface className="max-w-2xl p-5">
          <Prose>
            <h2>Scrum roles</h2>
            <p>Scrum has three roles. Each one owns a different question, so work never stalls waiting for someone to decide.</p>
            <ul>
              <li><strong>Product Owner</strong> decides what is built and in which order.</li>
              <li><strong>Scrum Master</strong> removes blockers and protects the process.</li>
              <li><strong>Developers</strong> decide how to build it.</li>
            </ul>
            <blockquote>Weak area: the difference between the Product Owner and a project manager.</blockquote>
            <pre><code>Sprint = plan → daily → review → retro</code></pre>
          </Prose>
        </Surface>
      </GallerySection>

      <GallerySection title="Sheets and toasts" note="Sheets come up from the bottom on a phone. Toasts confirm briefly above the bar.">
        <div className="flex flex-wrap gap-3">
          <Button variant="glass" onClick={() => setSheet(true)}>Open a sheet</Button>
          <Button variant="glass" onClick={() => setApproval(true)}>Ask for approval</Button>
          <Button variant="glass" onClick={() => toast({ message: "Moved to Agile Development.", action: { label: "Undo", onAction: () => toast({ message: "Moved back." }) } })}>Show a toast</Button>
          <Button variant="glass" onClick={() => toast({ message: "Couldn't save. You're offline.", tone: "danger" })}>Show an error toast</Button>
        </div>
        <Sheet
          open={sheet}
          onOpenChange={setSheet}
          title="Move file"
          description="Choose where Lecture 4: Scrum roles should live."
          footer={<><Button variant="quiet" onClick={() => setSheet(false)}>Cancel</Button><Button variant="solid" onClick={() => { setSheet(false); toast({ message: "Moved to Agile Development.", tone: "success" }); }}>Move</Button></>}
        >
          <Surface className="grid p-2">
            <Row leading={<Folder size={18} />} title="University / Agile Development" onClick={() => undefined} />
            <Row leading={<Folder size={18} />} title="AVA" onClick={() => undefined} />
          </Surface>
        </Sheet>
        <ApprovalSheet
          open={approval}
          onOpenChange={setApproval}
          title="Send this email?"
          summary="AVA wants to email your lecturer on your behalf."
          risk="This sends a real email from your account. It can't be unsent."
          busy={busy}
          onDecline={() => setApproval(false)}
          onApprove={() => { setBusy(true); window.setTimeout(() => { setBusy(false); setApproval(false); toast({ message: "Email sent.", tone: "success" }); }, 900); }}
          details={<Prose><p><strong>To:</strong> lecturer@university.example<br /><strong>Subject:</strong> Question about Lecture 4</p></Prose>}
        />
      </GallerySection>

      <GallerySection title="Loading, empty and error" note="Every screen designs these, so nothing is ever blank or broken-looking.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Surface className="grid gap-3 p-4"><Skeleton className="h-6 w-1/2" /><Skeleton lines={3} /></Surface>
          <Surface><EmptyState icon={<Inbox size={26} />} title="No files here yet" body="Write one, or ask AVA to save your lecture notes here." action={<Button variant="solid" size="sm">New file</Button>} /></Surface>
          <ErrorState title="Notes couldn't load" body="AVA's server didn't answer. Your saved copy is still on this device." onRetry={() => undefined} />
        </div>
      </GallerySection>
    </>
  );
}

export function DesignGallery() {
  const [look, setLook] = useState<LookPref>(readLookPref());
  useEffect(() => { applyLook(); }, [look]);
  const choose = (next: LookPref) => { mirrorLookPref(next); setLook(next); };

  // ?design-gallery=voice: the Voice screen full size, with the face to itself.
  if (new URLSearchParams(window.location.search).get("design-gallery") === "voice") {
    return <Suspense fallback={null}><VoicePreview /></Suspense>;
  }

  return (
    <div className="ds-root min-h-screen bg-canvas font-ui text-ink">
      <div className="mx-auto grid max-w-5xl gap-14 px-5 pb-32 pt-10">
        <header className="grid gap-4">
          <span className="font-ui-mono text-label uppercase text-ink-3">AVA design system · live</span>
          <h1 className="text-display">Ink and Paper</h1>
          <p className="max-w-[60ch] text-body text-ink-2">
            Every building block of the new AVA, shown as it is built. This page updates by itself while Claude works.
          </p>
          <div role="radiogroup" aria-label="Look" className="flex w-fit gap-1 rounded-button bg-surface p-1 shadow-e1">
            {(["ink", "paper"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={look === value}
                onClick={() => choose(value)}
                className={`ds-focus rounded-control px-4 py-2 text-meta font-medium transition-colors ${look === value ? "bg-solid text-on-solid" : "text-ink-2 hover:text-ink"}`}
              >
                {value === "ink" ? "Black (Ink)" : "White (Paper)"}
              </button>
            ))}
          </div>
        </header>

        <ToastProvider>
          <Components />
        </ToastProvider>

        <GallerySection title="Colours">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {COLOURS.map(([name, cls]) => (
              <div key={name} className="grid gap-2">
                <div className={`h-16 rounded-card shadow-e2 ${cls}`} />
                <span className="text-meta text-ink-2">{name}</span>
              </div>
            ))}
          </div>
        </GallerySection>

        <GallerySection title="Type">
          <div className="grid gap-5">
            {TYPE.map(([name, cls, sample]) => (
              <div key={name} className="grid gap-1">
                <span className="font-ui-mono text-label uppercase text-ink-3">{name}</span>
                <span className={`${cls} ${name === "label" ? "font-ui-mono uppercase" : ""}`}>{sample}</span>
              </div>
            ))}
          </div>
        </GallerySection>
      </div>
    </div>
  );
}
