import { useCallback, useEffect, useState, type ComponentType } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpenCheck,
  Compass,
  GitCompareArrows,
  HeartPulse,
  History,
  ListTree,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import {
  fetchExplorerLearnedWorkflows,
  fetchExplorerRuntimeCapabilities,
  fetchExplorerTasks,
  type ExplorerLearnedWorkflowsResponse,
  type ExplorerRuntimeCapability,
  type ExplorerTaskCoverage,
  type ExplorerTaskSummary,
} from "../api.js";
import { PanelShell } from "../components/ava/PanelShell.js";
import {
  EXPLORER_CAPABILITIES,
  EXPLORER_DOMAINS,
  getCapability,
} from "./index.js";
import { CapabilityAtlas, type ExplorerDepth } from "./CapabilityAtlas.js";
import { HealthView } from "./HealthView.js";
import { LearnedWorkflowsView } from "./LearnedWorkflowsView.js";
import { LiveTasksView } from "./LiveTasksView.js";
import { TaskInspector } from "./TaskInspector.js";
import { DiscoverView } from "./DiscoverView.js";
import {
  describeExplorerRequestError,
  explorerTaskStatusLabel,
} from "./task-utils.js";

type ExplorerView =
  | "discover"
  | "atlas"
  | "activity"
  | "learned"
  | "tasks"
  | "live"
  | "health"
  | "reviews"
  | "evolution";

const TABS: Array<{
  id: ExplorerView;
  label: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: "discover", label: "Discover", Icon: Compass },
  { id: "atlas", label: "Map", Icon: ListTree },
  { id: "activity", label: "Activity", Icon: Activity },
  { id: "health", label: "Health", Icon: HeartPulse },
];

const ACTIVITY_VIEWS = new Set<ExplorerView>(["activity", "learned", "tasks", "live", "reviews", "evolution"]);

const BROAD_CAPABILITY_TARGET: Readonly<Record<string, string>> = {
  conversation: "conversation.text-turn",
  voice: "voice.realtime",
  files: "shell-files.filesystem",
  computer: "desktop.native-control",
  browser: "browser.persistent-control",
  screen: "vision.screen-inspection",
  instagram: "instagram.messaging",
  whatsapp: "whatsapp.messaging",
  google: "browser.persistent-control",
  places: "services.google-places",
  shopify: "services.shopify-products",
  memory: "memory.durable",
  watches: "automation.watches",
  self: "self-improvement.pipeline",
  code: "coding.project-work",
};

function resolveAtlasCapability(id: string): string | null {
  if (getCapability(id)) return id;
  const mapped = BROAD_CAPABILITY_TARGET[id];
  if (mapped && getCapability(mapped)) return mapped;
  const domainChild = EXPLORER_CAPABILITIES.find((capability) => capability.domainId === id);
  return domainChild?.id ?? null;
}

function FoundationNotice({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="lg-slab overflow-hidden px-6 py-6 sm:px-8">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[rgba(255,212,121,.22)] bg-[rgba(255,212,121,.07)] text-[var(--ac-exec)]">
          <AlertTriangle size={17} />
        </div>
        <div className="min-w-0">
          <div className="hud text-[9px] text-[var(--ac-exec)]">Foundation visible</div>
          <h2 className="mt-1 text-lg font-semibold text-white/86">{title}</h2>
          <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-white/43">{body}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ReviewsView({
  tasks,
  taskTotal,
  onOpenTask,
}: {
  tasks: readonly ExplorerTaskSummary[];
  taskTotal: number;
  onOpenTask: (taskId?: string) => void;
}) {
  /**
   * Friction, not everything.
   *
   * This used to also match `verification.status === "not_recorded"`, which the
   * server hard-codes on every single row — so the filter selected 100% of
   * tasks and the counter beneath it could never vary. A tab promising to "find
   * friction" that returns the whole list is the one place this product
   * overclaimed about itself. Until verification events actually exist, friction
   * means what was genuinely observed to go wrong: a failed run, or recorded
   * tool errors.
   */
  const candidates = tasks.filter(
    (task) => task.status === "failed" || task.errorCount > 0,
  );
  return (
    <div className="space-y-5">
      <div>
        <div className="hud text-[10px] text-[var(--ac)]">Review studio</div>
        <h2 className="mt-2 text-xl font-semibold text-white/90">Find friction before turning it into a lesson.</h2>
        <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-white/60">
          These are runs that were observed to go wrong — a failed run, or one with recorded tool
          errors. Evidence gaps are not friction and are not listed here: no run in this build
          records independent verification, so counting that would flag everything. Immutable
          annotations and approved lesson records are the next persistence slice.
        </p>
      </div>
      <FoundationNotice
        title="Reviews are not silently changing AVA"
        body="This release does not yet persist review observations or lessons. The candidates below come only from recorded task outcomes and verification fields; nothing is inferred or applied automatically."
      >
        <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/[0.07] pt-4">
          <div className="text-[10px] text-white/38">
            {candidates.length
              ? `${candidates.length} candidate(s) in the latest ${tasks.length} of ${taskTotal} recorded tasks.`
              : `No candidates in the latest ${tasks.length} of ${taskTotal} recorded tasks.`}
          </div>
          <button type="button" onClick={() => onOpenTask()} className="btn-deck btn-ghost">
            Open Task Inspector
          </button>
        </div>
      </FoundationNotice>
      {candidates.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {candidates.slice(0, 8).map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onOpenTask(task.id)}
              className="lg-slab px-5 py-4 text-left transition-colors hover:border-[rgba(92,242,255,.22)]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[12px] font-semibold text-white/72">
                  {task.sessionTitle ?? `Task ${task.id.slice(0, 8)}`}
                </span>
                <span
                  className="hud text-[8px]"
                  style={{
                    color: task.status === "failed" ? "var(--ac-stop)" : "var(--ac-exec)",
                  }}
                >
                  {explorerTaskStatusLabel(task.status)}
                </span>
              </div>
              <div className="mt-2 text-[9px] text-white/32">
                {task.errorCount} errors · verification {task.verification.status.replaceAll("_", " ")}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EvolutionView() {
  const sourceCount = EXPLORER_CAPABILITIES.reduce(
    (sum, capability) => sum + capability.definition.sourceReferences.length,
    0,
  );
  const workflows = EXPLORER_CAPABILITIES.filter((capability) => !!capability.workflow).length;
  return (
    <div className="space-y-5">
      <div>
        <div className="hud text-[10px] text-[var(--ac)]">Evolution</div>
        <h2 className="mt-2 text-xl font-semibold text-white/90">AVA’s map now has a versionable foundation.</h2>
        <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-white/42">
          Capability definitions live in data rather than JSX, so future commits can be compared without redesigning the interface.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Domains declared", String(EXPLORER_DOMAINS.length)],
          ["Capabilities declared", String(EXPLORER_CAPABILITIES.length)],
          ["Workflows mapped", String(workflows)],
          ["Source references", String(sourceCount)],
        ].map(([label, value]) => (
          <div key={label} className="lg-slab px-5 py-5">
            <div className="hud text-[8px] text-white/30">{label}</div>
            <div className="mt-3 text-2xl font-semibold text-[var(--ac)]">{value}</div>
          </div>
        ))}
      </div>
      <FoundationNotice
        title="Release history has not been backfilled"
        body="Explorer does not yet have immutable release-change records linking commits to changed capabilities and subsequent real-task evidence. Showing Git history as if it were a semantic capability history would be misleading, so this remains explicitly unmeasured."
      >
        <div className="mt-5 grid gap-3 border-t border-white/[0.07] pt-4 sm:grid-cols-3">
          {[
            ["Next record", "Release → capability changes"],
            ["Then verify", "Tests → evidence"],
            ["Then measure", "Real tasks → reliability"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/[0.07] bg-black/22 px-4 py-3">
              <div className="hud text-[8px] text-white/28">{label}</div>
              <div className="mt-2 text-[10px] text-white/52">{value}</div>
            </div>
          ))}
        </div>
      </FoundationNotice>
    </div>
  );
}

function ActivityHub({
  tasks,
  taskTotal,
  learnedCount,
  onOpen,
}: {
  tasks: readonly ExplorerTaskSummary[];
  taskTotal: number;
  learnedCount: number;
  onOpen: (view: ExplorerView) => void;
}) {
  const running = tasks.filter((task) => task.status === "running").length;
  const problems = tasks.filter((task) => task.status === "failed" || task.errorCount > 0).length;
  const cards: Array<{
    view: ExplorerView;
    title: string;
    description: string;
    value: string;
    Icon: ComponentType<{ size?: number; className?: string }>;
  }> = [
    {
      view: "tasks",
      title: "Task history",
      description: "Inspect the steps, tools, errors and evidence behind recorded AVA work.",
      value: `${taskTotal} recorded`,
      Icon: History,
    },
    {
      view: "live",
      title: "Live work",
      description: "Follow active tasks and open the exact execution record as it changes.",
      value: running ? `${running} running` : "Nothing running",
      Icon: Radio,
    },
    {
      view: "learned",
      title: "Learned workflows",
      description: "See reusable procedures AVA has retained from completed work.",
      value: `${learnedCount} learned`,
      Icon: BookOpenCheck,
    },
  ];
  return (
    <div className="space-y-5">
      <section data-panel-section className="lg-slab overflow-hidden px-6 py-7 sm:px-8">
        <div className="hud text-[9px] text-[var(--ac)]">Activity and evidence</div>
        <h2 className="mt-2 text-2xl font-semibold text-white/90">See what AVA is doing—and what actually happened.</h2>
        <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-white/42">
          Activity connects real tasks to their capabilities, tool results and failure boundaries. A response is not treated as proof of an external outcome.
        </p>
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        {cards.map(({ view, title, description, value, Icon }) => (
          <button key={view} type="button" onClick={() => onOpen(view)} className="bg-card group min-h-[210px] px-6 py-6 text-left">
            <span className="bg-card__ray" aria-hidden />
            <span className="bg-card__bracket bg-card__bracket--tl" aria-hidden />
            <span className="bg-card__bracket bg-card__bracket--br" aria-hidden />
            <span className="relative z-[2] flex h-full flex-col">
              <Icon size={19} className="text-[var(--ac)]" />
              <span className="hud mt-5 text-[8px] text-[var(--ac)]">{value}</span>
              <span className="mt-1.5 text-lg font-semibold text-white/84">{title}</span>
              <span className="mt-2 text-[10px] leading-relaxed text-white/42">{description}</span>
              <span className="hud mt-auto pt-5 text-[8px] text-[var(--ac)] transition-transform group-hover:translate-x-1">Open →</span>
            </span>
          </button>
        ))}
      </div>
      <section data-panel-section className="flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-black/22 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="hud text-[8px] text-white/34">Advanced evidence</div>
          <div className="mt-1 text-[9px] text-white/38">
            {problems ? `${problems} recent run(s) contain observed friction.` : "No observed failures in the loaded task window."}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onOpen("reviews")} className="btn-deck btn-ghost h-8 px-3 text-[8px]">
            <Sparkles size={12} /> Review failures
          </button>
          <button type="button" onClick={() => onOpen("evolution")} className="btn-deck btn-ghost h-8 px-3 text-[8px]">
            <GitCompareArrows size={12} /> Evolution evidence
          </button>
        </div>
      </section>
    </div>
  );
}

export function ExplorerScreen({
  onLaunch,
}: {
  onLaunch: (prompt: string) => void;
}) {
  const [view, setView] = useState<ExplorerView>("discover");
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState<ExplorerDepth>("overview");
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<string | null>(null);
  const [taskDeepLink, setTaskDeepLink] = useState<string | null>(null);
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<ExplorerRuntimeCapability[]>([]);
  const [runtimeSources, setRuntimeSources] = useState<string[]>([]);
  const [runtimeGeneratedAt, setRuntimeGeneratedAt] = useState<number | null>(null);
  const [tasks, setTasks] = useState<ExplorerTaskSummary[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [coverage, setCoverage] = useState<ExplorerTaskCoverage | null>(null);
  const [learnedWorkflows, setLearnedWorkflows] =
    useState<ExplorerLearnedWorkflowsResponse | null>(null);
  const [learnedWorkflowError, setLearnedWorkflowError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadEvidence = useCallback(async () => {
    setLoading(true);
    const [capabilityResult, taskResult, learnedWorkflowResult] = await Promise.allSettled([
      fetchExplorerRuntimeCapabilities(),
      fetchExplorerTasks({ limit: 100 }),
      fetchExplorerLearnedWorkflows(),
    ]);
    const errors: string[] = [];
    if (capabilityResult.status === "fulfilled") {
      setRuntimeCapabilities(capabilityResult.value.capabilities);
      setRuntimeSources(capabilityResult.value.sources);
      setRuntimeGeneratedAt(capabilityResult.value.generatedAt);
    } else {
      errors.push("runtime capability evidence");
    }
    if (taskResult.status === "fulfilled") {
      setTasks(taskResult.value.tasks);
      setTaskTotal(taskResult.value.total);
      setCoverage(taskResult.value.coverage);
    } else {
      errors.push("task evidence");
    }
    if (learnedWorkflowResult.status === "fulfilled") {
      setLearnedWorkflows(learnedWorkflowResult.value);
      setLearnedWorkflowError(null);
    } else {
      errors.push("learned workflows");
      setLearnedWorkflowError(
        describeExplorerRequestError(
          learnedWorkflowResult.reason,
          "learned workflows",
        ),
      );
    }
    setLoadError(errors.length ? `Could not load ${errors.join(" and ")}.` : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadEvidence();
    const timer = window.setInterval(() => void loadEvidence(), 20_000);
    const onFocus = () => void loadEvidence();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadEvidence]);

  const checkedCount = runtimeCapabilities.length;
  const workflowCount = EXPLORER_CAPABILITIES.filter((capability) => !!capability.workflow).length;

  const openAtlasCapability = useCallback((id: string) => {
    const resolved = resolveAtlasCapability(id);
    if (!resolved) return;
    const capability = getCapability(resolved);
    if (!capability) return;
    setSelectedDomainId(capability.domainId);
    setSelectedCapabilityId(capability.id);
    setView("atlas");
  }, []);

  const inspectLiveTask = useCallback((taskId: string) => {
    setTaskDeepLink(taskId);
    setView("tasks");
  }, []);

  const openExplorerView = useCallback((nextView: ExplorerView) => {
    if (nextView === "atlas") {
      setSelectedDomainId(null);
      setSelectedCapabilityId(null);
    }
    setView(nextView);
  }, []);

  return (
    <PanelShell title="Explore AVA">
      <div className="space-y-5">
        {view !== "discover" && <section data-panel-section className="lg-slab overflow-hidden px-5 py-5 sm:px-7">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
            <div>
              <div className="hud text-[9px] text-[var(--ac)]">AVA · living source of truth</div>
              <h2 className="mt-2 text-xl font-semibold text-white/92">
                From what AVA claims to what AVA actually did.
              </h2>
              <p className="mt-2 max-w-3xl text-[10.5px] leading-relaxed text-white/40">
                Navigate the system, inspect operational workflows, follow live work and audit newly recorded execution evidence.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                ["Domains", EXPLORER_DOMAINS.length],
                ["Capabilities", EXPLORER_CAPABILITIES.length],
                ["Mapped", workflowCount],
                ["Learned", learnedWorkflows?.summary.total ?? "—"],
                ["Recorded tasks", taskTotal],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/[0.07] bg-black/24 px-3 py-3 text-center">
                  <div className="text-base font-semibold text-white/76">{value}</div>
                  <div className="hud mt-1 text-[7px] text-white/26">{label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.07] pt-4">
            <div className="flex items-center gap-2 text-[9px] text-white/38">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ac-live)] shadow-[0_0_8px_var(--ac-live)]" />
              {checkedCount} runtime states checked
            </div>
            <div className="flex items-center gap-2 text-[9px] text-white/38">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ac-exec)]" />
              Older tool traces were not recorded
            </div>
            {coverage && <div className="text-[9px] text-white/28">{coverage.note}</div>}
            <button
              type="button"
              onClick={() => void loadEvidence()}
              disabled={loading}
              className="ml-auto flex items-center gap-2 text-[9px] text-white/36 hover:text-[var(--ac)]"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </section>}

        {loadError && (
          <div className="flex items-center gap-3 rounded-2xl border border-[rgba(255,212,121,.25)] bg-[rgba(255,212,121,.06)] px-4 py-3 text-[10px] text-[#ffe1a3]">
            <AlertTriangle size={14} />
            {loadError} Static capability definitions remain available; unavailable runtime data is shown as unknown.
          </div>
        )}

        <nav
          data-panel-section
          aria-label="Explorer sections"
          className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-white/[0.08] bg-black/28 p-1.5"
        >
          {TABS.map(({ id, label, Icon }) => {
            const active = view === id || (id === "activity" && ACTIVITY_VIEWS.has(view));
            return (
              <button
                key={id}
                type="button"
                onClick={() => openExplorerView(id)}
                aria-current={active ? "page" : undefined}
                className={
                  "flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 hud text-[8px] transition-colors " +
                  (active
                    ? "border border-[rgba(92,242,255,.2)] bg-[rgba(92,242,255,.1)] text-[var(--ac-text)]"
                    : "border border-transparent text-white/35 hover:text-white/65")
                }
              >
                <Icon size={13} />
                {label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => void loadEvidence()}
            disabled={loading}
            className="ml-auto flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 hud text-[8px] text-white/30 hover:text-[var(--ac)]"
            aria-label="Refresh Explorer evidence"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </nav>

        {view === "discover" && (
          <DiscoverView
            domains={EXPLORER_DOMAINS}
            capabilities={EXPLORER_CAPABILITIES}
            runtime={runtimeCapabilities}
            taskTotal={taskTotal}
            loading={loading}
            onLaunch={onLaunch}
            onInspectCapability={openAtlasCapability}
            onOpenMap={() => openExplorerView("atlas")}
            onOpenActivity={() => openExplorerView("activity")}
          />
        )}

        {view === "activity" && (
          <ActivityHub
            tasks={tasks}
            taskTotal={taskTotal}
            learnedCount={learnedWorkflows?.summary.total ?? 0}
            onOpen={setView}
          />
        )}

        {view === "atlas" && (
          <>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full max-w-lg">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/28"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search capabilities, workflows or tools…"
                  className="h-10 w-full rounded-full border border-white/[0.09] bg-white/[0.03] pl-9 pr-4 text-[10px] text-white/75 outline-none placeholder:text-white/25 focus:border-[rgba(92,242,255,.35)]"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="hud mr-1 text-[8px] text-white/28">Depth</span>
                {(["overview", "detailed", "technical"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setDepth(option)}
                    className={
                      "rounded-full border px-3 py-1.5 hud text-[8px] transition-colors " +
                      (depth === option
                        ? "border-[rgba(92,242,255,.24)] bg-[rgba(92,242,255,.09)] text-[var(--ac)]"
                        : "border-white/[0.07] text-white/30 hover:text-white/60")
                    }
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <CapabilityAtlas
              domains={EXPLORER_DOMAINS}
              capabilities={EXPLORER_CAPABILITIES}
              runtime={runtimeCapabilities}
              tasks={tasks}
              query={query}
              depth={depth}
              selectedDomainId={selectedDomainId}
              selectedCapabilityId={selectedCapabilityId}
              onSelectDomain={(id) => {
                setSelectedDomainId(id);
                setSelectedCapabilityId(null);
              }}
              onSelectCapability={setSelectedCapabilityId}
              onBackToMap={() => {
                setSelectedDomainId(null);
                setSelectedCapabilityId(null);
              }}
              onBackToDomain={() => setSelectedCapabilityId(null)}
              onOpenTask={(taskId) => {
                setTaskDeepLink(taskId);
                setView("tasks");
              }}
              onLaunch={onLaunch}
            />
          </>
        )}

        {view === "tasks" && (
          <TaskInspector
            key={taskDeepLink ?? "task-list"}
            initialTaskId={taskDeepLink}
            onOpenCapability={openAtlasCapability}
          />
        )}

        {view === "learned" && (
          <LearnedWorkflowsView
            response={learnedWorkflows}
            loading={loading}
            error={learnedWorkflowError}
            onRetry={() => void loadEvidence()}
          />
        )}

        {view === "live" && <LiveTasksView onInspectTask={inspectLiveTask} />}

        {view === "health" && (
          <HealthView
            capabilities={runtimeCapabilities}
            tasks={tasks}
            taskTotal={taskTotal}
            sources={runtimeSources}
            generatedAt={runtimeGeneratedAt}
            loading={loading}
            onRefresh={() => void loadEvidence()}
          />
        )}

        {view === "reviews" && (
          <ReviewsView
            tasks={tasks}
            taskTotal={taskTotal}
            onOpenTask={(taskId) => {
              setTaskDeepLink(taskId ?? null);
              setView("tasks");
            }}
          />
        )}

        {view === "evolution" && <EvolutionView />}

        <footer className="flex flex-col gap-2 border-t border-white/[0.06] px-1 pt-4 text-[8px] text-white/23 sm:flex-row sm:items-center sm:justify-between">
          <span className="hud">Known secret patterns are redacted before Explorer persistence</span>
          <span className="flex items-center gap-2">
            <History size={11} />
            Historical execution begins with this instrumentation release
          </span>
        </footer>
      </div>
    </PanelShell>
  );
}
