import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, Circle, HelpCircle, NotebookPen, Pencil, Plus, Send, X } from "lucide-react";
import { ApiError, api } from "../api.js";
import { Button, Chip, Receipt, Row, Surface, Tag, TextArea, TextInput } from "../design/index.js";
import { Atmosphere } from "../design/metal/Atmosphere.js";
import { MetalObject } from "../design/metal/MetalObject.js";
import { useChatStream } from "../chat/useChatStream.js";
import { useMedia } from "../memory/MemoryExtras.js";
import {
  addItem, createProject, deleteItem, fetchProject, fetchProjects, openConversation, removeProject, restoreProject, updateItem, updateProject,
  type Project, type ProjectDetail, type ProjectItem, type ProjectKind, type ProjectMessage, type ProjectPatch, type ProjectStatus,
} from "./api.js";

type Tab = "overview" | "materials" | "log" | "discuss";
const KINDS: Array<{ id: ProjectKind; group: string; label: string }> = [
  { id: "business", group: "BUSINESS", label: "Business" }, { id: "build", group: "BUILDS", label: "Build" }, { id: "uni", group: "UNI", label: "Uni" },
];
const KIND_COLOUR: Record<ProjectKind, string> = { business: "var(--ds-kind-event)", build: "var(--ds-kind-block)", uni: "var(--ds-kind-lecture)" };
const KIND_TONE = { business: "success", build: "warning", uni: "info" } as const;
const STATUSES: ProjectStatus[] = ["active", "paused", "done"];
const cap = (value: string) => value[0]!.toUpperCase() + value.slice(1);
const day = (at: number) => new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short" }).format(at);
function ago(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days} days ago` : day(at);
}
const errorText = (error: unknown) => error instanceof ApiError ? error.message : "That didn’t work. Try again.";

/** Sir's projects: one workspace each, with its own conversation with AVA beside it. */
export function ProjectsScreen({ onOpenNote }: { onOpenNote?: (noteId: string) => void }) {
  const narrow = useMedia("(max-width: 1180px)"), compact = useMedia("(max-width: 860px)");
  const [projects, setProjects] = useState<Project[] | null>(null), [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null), [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [tab, setTab] = useState<Tab>("overview"), [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean; undo?: string } | null>(null);
  const generation = useRef(0);

  const loadList = useCallback(async () => {
    try { const body = await fetchProjects(); setProjects(body.projects); setLoadError(null); }
    catch (error) { setLoadError(errorText(error)); }
  }, []);
  const current = projects?.find((project) => project.id === selectedId) ?? projects?.[0] ?? null;
  const loadDetail = useCallback(async (id: string) => {
    const mine = ++generation.current;
    try { const next = await fetchProject(id); if (mine === generation.current) setDetail(next); }
    catch { if (mine === generation.current) setDetail(null); }
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (current) void loadDetail(current.id); else setDetail(null); }, [current?.id, current?.version, current?.updatedAt, loadDetail]);
  useEffect(() => {
    const focus = () => { if (!document.hidden) void loadList(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [loadList]);

  const refresh = async () => { await loadList(); if (current) await loadDetail(current.id); };
  const act = async (work: () => Promise<string | void>, undo?: string) => {
    try { const text = await work(); if (text) setNotice({ text, undo }); await refresh(); }
    catch (error) { setNotice({ text: errorText(error), error: true }); await refresh(); }
  };
  const patch = (project: Project, change: ProjectPatch) => act(async () => { await updateProject(project, change); });
  const remove = (project: Project) => act(async () => {
    await removeProject(project.id); setSelectedId(null); return `Removed “${project.name}”. Its notes are still in Notes.`;
  }, project.id);
  const undo = (id: string) => act(async () => { const back = await restoreProject(id); setSelectedId(back.id); return `“${back.name}” is back.`; });

  const tabs: Tab[] = compact ? ["overview", "materials", "log", "discuss"] : ["overview", "materials", "log"];
  const shownTab = !compact && tab === "discuss" ? "overview" : tab;

  return <section aria-label="Projects" className="ds-root ds-calendar ds-projects h-full overflow-y-auto bg-canvas text-ink">
    <Atmosphere kind="nocturne" />
    <div className="ds-calendar-content">
      <header className="ds-calendar-header">
        <div><p className="ds-calendar-eyebrow">PROJECTS{projects ? ` · ${projects.filter((project) => project.status === "active").length} ACTIVE` : ""}</p><h1>Build what matters.</h1></div>
        <div className="ds-calendar-actions"><button className="ds-focus ds-calendar-primary" onClick={() => setCreating(true)}><Plus size={17} aria-hidden />New project</button></div>
      </header>
      {creating && <NewProject onCancel={() => setCreating(false)} onCreate={(name, kind) => act(async () => {
        const project = await createProject(name, kind); setCreating(false); setSelectedId(project.id); setTab("overview");
        return `Added “${project.name}”.`;
      })} />}
      <p role={notice?.error ? "alert" : "status"} className="ds-projects-notice" data-error={notice?.error ?? false}>
        {notice?.text}{notice?.undo && <Button size="sm" variant="quiet" onClick={() => { const id = notice.undo!; setNotice(null); void undo(id); }}>Undo</Button>}
      </p>
      {loadError && <div role="alert" className="flex flex-wrap items-center gap-3 py-3"><span>{loadError}</span><Button size="sm" onClick={() => void loadList()}>Try again</Button></div>}
      {narrow && projects && projects.length > 0 && <nav className="ds-projects-chips" aria-label="Projects">
        {projects.map((project) => <Chip key={project.id} selected={project.id === current?.id} onClick={() => { setSelectedId(project.id); setTab("overview"); }}>{project.name}</Chip>)}
      </nav>}
      {projects && projects.length === 0 && <Surface tone="sunken" elevation={0} className="grid justify-items-start gap-3 p-8">
        <p className="text-body-lg text-ink">No projects yet.</p>
        <p className="text-body text-ink-2">Tell AVA about something you’re starting, or add one here.</p>
        <Button variant="solid" leading={<Plus size={16} />} onClick={() => setCreating(true)}>New project</Button>
      </Surface>}
      {current && <div className="ds-calendar-panel ds-projects-panel" aria-busy={!detail}>
        {!narrow && <nav className="ds-calendar-rail" aria-label="Projects">
          {KINDS.map((kind) => {
            const group = projects!.filter((project) => project.kind === kind.id);
            return group.length ? <div key={kind.id} className="grid gap-1">
              <p className="ds-calendar-rail-label">{kind.group}</p>
              {group.map((project) => <Row key={project.id} onClick={() => { setSelectedId(project.id); setTab("overview"); }}
                className={project.id === current.id ? "bg-glass-strong" : ""} title={project.name}
                meta={`${project.status === "active" ? project.stage || "Active" : cap(project.status)} · ${ago(project.updatedAt)}`}
                leading={<span className="block h-2 w-2 rounded-sm" style={{ background: KIND_COLOUR[project.kind] }} />} />)}
            </div> : null;
          })}
          <p className="ds-calendar-rail-note">Tell AVA about anything you’re starting and it becomes a project. “Remove it” works too.</p>
        </nav>}

        <div className="ds-calendar-main">
          <ProjectHeader project={current} onPatch={(change) => void patch(current, change)} onRemove={() => void remove(current)} />
          <div className="ds-projects-tabs"><div className="ds-calendar-modes" role="group" aria-label="Project view">
            {tabs.map((value) => <button key={value} className="ds-focus" aria-pressed={shownTab === value} onClick={() => setTab(value)}>{cap(value)}</button>)}
          </div></div>
          <div className="ds-projects-body">
            {!detail ? <p role="status" className="text-body text-ink-2">Opening the project…</p>
              : shownTab === "overview" ? <Overview detail={detail} onPatch={(change) => void patch(current, change)} act={act} />
              : shownTab === "materials" ? <Materials detail={detail} onOpenNote={onOpenNote} />
              : shownTab === "log" ? <Log detail={detail} />
              : <Discuss key={current.id} project={current} onChanged={() => void refresh()} />}
          </div>
        </div>

        {!compact && <aside className="ds-calendar-agenda ds-projects-discuss" aria-label="Discuss with AVA">
          <Discuss key={current.id} project={current} onChanged={() => void refresh()} />
        </aside>}
      </div>}
    </div>
  </section>;
}

function NewProject({ onCancel, onCreate }: { onCancel: () => void; onCreate: (name: string, kind: ProjectKind) => void }) {
  const [name, setName] = useState(""), [kind, setKind] = useState<ProjectKind>("business");
  const submit = (event: FormEvent) => { event.preventDefault(); if (name.trim()) onCreate(name.trim(), kind); };
  return <Surface tone="raised" className="ds-projects-new"><form className="grid gap-4 p-5" onSubmit={submit}>
    <TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="What are you starting?" aria-label="Project name" maxLength={120} />
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Kind">
      {KINDS.map((entry) => <Chip key={entry.id} selected={kind === entry.id} onClick={() => setKind(entry.id)}>{entry.label}</Chip>)}
      <span className="flex-1" />
      <Button variant="quiet" onClick={onCancel}>Cancel</Button>
      <Button type="submit" variant="solid" disabled={!name.trim()}>Add project</Button>
    </div>
  </form></Surface>;
}

function ProjectHeader({ project, onPatch, onRemove }: { project: Project; onPatch: (change: ProjectPatch) => void; onRemove: () => void }) {
  const [renaming, setRenaming] = useState(false), [name, setName] = useState(project.name);
  useEffect(() => { setName(project.name); setRenaming(false); }, [project.id, project.name]);
  return <div className="ds-calendar-toolbar ds-projects-head">
    <div className="grid min-w-0 gap-2">
      {renaming ? <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (name.trim() && name.trim() !== project.name) onPatch({ name: name.trim() }); setRenaming(false); }}>
        <TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label="Project name" maxLength={120} />
        <Button type="submit" variant="solid" size="sm">Save</Button><Button size="sm" variant="quiet" onClick={() => setRenaming(false)}>Cancel</Button>
      </form> : <h2 className="flex items-center gap-2">{project.name}<Button size="sm" variant="quiet" aria-label="Rename project" onClick={() => setRenaming(true)}><Pencil size={14} /></Button></h2>}
      <div className="flex flex-wrap gap-2">
        <Tag tone={KIND_TONE[project.kind]}>{KINDS.find((kind) => kind.id === project.kind)!.label}</Tag>
        {project.stage && <Tag tone="info">{project.stage}</Tag>}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <div className="ds-calendar-modes" role="group" aria-label="Status">
        {STATUSES.map((status) => <button key={status} className="ds-focus" aria-pressed={project.status === status} onClick={() => onPatch({ status })}>{cap(status)}</button>)}
      </div>
      <Button size="sm" variant="danger" onClick={onRemove}>Remove</Button>
    </div>
  </div>;
}

function Editable({ label, value, empty, multiline, hideValue, onSave }: { label: string; value: string; empty: string; multiline?: boolean; hideValue?: boolean; onSave: (value: string) => void }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  if (editing) return <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); onSave(draft.trim()); setEditing(false); }}>
    {multiline ? <TextArea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={label} rows={4} />
      : <TextInput autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={label} />}
    <div className="flex gap-2"><Button type="submit" size="sm" variant="solid">Save</Button><Button size="sm" variant="quiet" onClick={() => setEditing(false)}>Cancel</Button></div>
  </form>;
  if (hideValue) return <div><Button size="sm" variant="quiet" leading={<Pencil size={14} />} onClick={() => setEditing(true)}>Change {label.toLowerCase()}</Button></div>;
  return <div className="flex items-start gap-2">
    <p className={value ? "flex-1 text-body-lg text-ink-2 ds-projects-prose" : "flex-1 text-body text-ink-3"}>{value || empty}</p>
    <Button size="sm" variant="quiet" aria-label={`Edit ${label.toLowerCase()}`} onClick={() => setEditing(true)}><Pencil size={14} /></Button>
  </div>;
}

function AddLine({ label, onAdd }: { label: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return <form className="flex gap-2 pt-1" onSubmit={(event) => { event.preventDefault(); if (text.trim()) { onAdd(text.trim()); setText(""); } }}>
    <TextInput value={text} onChange={(event) => setText(event.target.value)} placeholder={label} aria-label={label} maxLength={600} />
    <Button type="submit" size="sm" disabled={!text.trim()} aria-label={label}><Plus size={16} /></Button>
  </form>;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return <section className="grid gap-2"><p className="ds-calendar-eyebrow">{label}</p>{children}</section>;
}

function Overview({ detail, onPatch, act }: { detail: ProjectDetail; onPatch: (change: ProjectPatch) => void; act: (work: () => Promise<string | void>) => Promise<void> }) {
  const { project } = detail;
  const open = detail.steps.filter((step) => !step.doneAt), done = detail.steps.filter((step) => step.doneAt);
  const toggle = (item: ProjectItem) => void act(async () => { await updateItem(item, { done: !item.doneAt }); });
  const drop = (item: ProjectItem) => void act(async () => { await deleteItem(item); });
  return <>
    {project.nextStep ? <div className="grid gap-2">
      <MetalObject variant="cut" eyebrow="NEXT STEP" title={project.nextStep} detail={project.goal ? <span>Goal: {project.goal}</span> : undefined} />
      <Editable label="Next step" value={project.nextStep} hideValue empty="" onSave={(nextStep) => onPatch({ nextStep })} />
    </div> : <Section label="NEXT STEP">
      <Editable label="Next step" value="" empty="No next step yet. Ask AVA, or write one." onSave={(nextStep) => onPatch({ nextStep })} />
    </Section>}
    <Section label="WHERE IT STANDS">
      <Editable label="Where it stands" multiline value={project.summary} empty="AVA fills this in as you talk about the project." onSave={(summary) => onPatch({ summary })} />
    </Section>
    <Section label="STEPS">
      {[...open, ...done].map((step) => <div key={step.id} className="flex min-w-0 items-center gap-1">
        <Row className="min-w-0 flex-1" onClick={() => toggle(step)}
          title={<span className={step.doneAt ? "text-ink-3 line-through" : ""}>{step.text}</span>}
          leading={step.doneAt ? <CheckCircle2 size={18} aria-label="Done:" /> : <Circle size={18} aria-label="To do:" />} />
        <Button size="sm" variant="quiet" aria-label={`Delete step: ${step.text}`} onClick={() => drop(step)}><X size={14} /></Button>
      </div>)}
      <AddLine label="Add a step" onAdd={(text) => void act(async () => { await addItem(project.id, "step", text); })} />
    </Section>
    <Section label="OPEN QUESTIONS">
      {detail.questions.map((question) => <Row key={question.id} title={question.text} leading={<HelpCircle size={18} />}
        trailing={<Button size="sm" variant="quiet" onClick={() => void act(async () => { await updateItem(question, { done: true }); })}>Answered</Button>} />)}
      <AddLine label="Add a question" onAdd={(text) => void act(async () => { await addItem(project.id, "question", text); })} />
    </Section>
  </>;
}

function Materials({ detail, onOpenNote }: { detail: ProjectDetail; onOpenNote?: (noteId: string) => void }) {
  return <>
    <Section label={`NOTES · ${detail.notes.length}`}>
      {detail.notes.length ? detail.notes.map((note) => <Row key={note.id} leading={<NotebookPen size={18} />} title={note.title || "Untitled"}
        meta={`Updated ${ago(note.updatedAt)}`} onClick={onOpenNote ? () => onOpenNote(note.id) : undefined} />)
        : <p className="text-body text-ink-3">No notes yet. Anything AVA saves for this project lands here.</p>}
    </Section>
    <Surface tone="sunken" elevation={0} className="grid justify-items-center gap-2 p-8 text-center">
      <span className="text-body text-ink-2">Photos, files and links</span>
      <span className="text-meta text-ink-3">Dropping them here, with AVA pulling out what matters, comes in the next update.</span>
    </Surface>
  </>;
}

const SOURCE: Record<ProjectItem["source"], string> = { app: "In the app", chat: "From a chat", voice: "From voice", ava: "AVA" };
function Log({ detail }: { detail: ProjectDetail }) {
  return <section className="grid gap-3" aria-label="Progress log">
    {detail.log.map((line) => <Receipt key={line.id} title={line.text} proof={`${day(line.createdAt)} · ${SOURCE[line.source]}`} />)}
  </section>;
}

/** The project's own conversation. Anything AVA changes in the project shows on the left when she finishes. */
function Discuss({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const [sessionId, setSessionId] = useState<string | null>(null), [messages, setMessages] = useState<ProjectMessage[]>([]);
  const [text, setText] = useState(""), [run, setRun] = useState<{ epoch: number; taskId: string | null } | null>(null), [error, setError] = useState<string | null>(null);
  const epoch = useRef(0), bottom = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try { const body = await openConversation(project.id); setSessionId(body.sessionId); setMessages(body.messages); setError(null); }
    catch (failure) { setError(errorText(failure)); }
  }, [project.id]);
  useEffect(() => { void load(); }, [load]);
  const { events } = useChatStream(run ? sessionId : null, run?.epoch ?? 0, run?.taskId ?? null);
  useEffect(() => {
    if (!run || !events.some((event) => event.kind === "done" || event.kind === "killed" || event.kind === "error")) return;
    setRun(null); void load(); onChanged();
  }, [events, run, load, onChanged]);
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: "end" }); }, [messages.length, run]);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || !sessionId || run) return;
    setText(""); setMessages((list) => [...list, { id: -Date.now(), role: "user", content: message, createdAt: Date.now() }]);
    try { const accepted = await api.sendMessage(sessionId, message); setRun({ epoch: ++epoch.current, taskId: accepted.taskId ?? null }); }
    catch (failure) { setError(errorText(failure)); void load(); }
  };
  return <div className="ds-projects-talk">
    <p className="ds-calendar-eyebrow">DISCUSS WITH AVA</p>
    <div className="ds-projects-messages">
      {!messages.length && !run && <p className="text-body text-ink-2">Talk this project through. AVA knows where it stands, asks what matters, and keeps the project up to date as you go.</p>}
      {messages.map((message) => message.role === "user"
        ? <p key={message.id} className="ds-projects-mine text-body text-ink">{message.content}</p>
        : <p key={message.id} className="whitespace-pre-wrap text-body text-ink">{message.content}</p>)}
      {run && <p role="status" className="text-meta text-ink-3">AVA is thinking…</p>}
      {error && <p role="alert" className="text-meta text-danger">{error}</p>}
      <div ref={bottom} />
    </div>
    <form className="ds-glass flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5 shadow-e2" onSubmit={(event) => void send(event)}>
      <input className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3" value={text} onChange={(event) => setText(event.target.value)}
        placeholder="Talk about this project…" aria-label={`Talk about ${project.name}`} disabled={!sessionId} />
      <Button type="submit" size="icon" variant="solid" aria-label="Send" disabled={!text.trim() || !sessionId || !!run}><Send size={18} /></Button>
    </form>
  </div>;
}
