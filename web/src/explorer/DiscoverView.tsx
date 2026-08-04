import type { ComponentType } from "react";
import {
  ArrowRight,
  AudioWaveform,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Chrome,
  Code2,
  Eye,
  Layers3,
  MessageCircle,
  MousePointer2,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  Workflow,
} from "lucide-react";
import type { ExplorerRuntimeCapability } from "../api.js";
import { BorderGlow } from "../components/ava/BorderGlow.js";
import { readinessColor, readinessLabel, runtimeForCapability } from "./runtime.js";
import type { ExplorerCapability, ExplorerDomain } from "./types.js";

type Pillar = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  accent: string;
  capabilityIds: readonly string[];
  examples: ReadonlyArray<{ prompt: string; capabilityId: string }>;
};

export const DISCOVER_PILLARS: readonly Pillar[] = [
  {
    id: "talk",
    eyebrow: "Conversation",
    title: "Talk naturally",
    description: "Type or speak normally. AVA keeps the conversation connected and can turn a request into real work without changing assistants.",
    Icon: AudioWaveform,
    accent: "#8bf7ff",
    capabilityIds: ["conversation.text-turn", "voice.realtime", "interpretation.request-mode"],
    examples: [
      { prompt: "Help me plan today and recommend the best order.", capabilityId: "conversation.text-turn" },
      { prompt: "Explain what AVA can do for me in plain English.", capabilityId: "conversation.text-turn" },
    ],
  },
  {
    id: "computer",
    eyebrow: "Computer",
    title: "Control my computer",
    description: "Open AVA Chrome, work with files, run commands, control Windows apps and inspect what is actually visible on screen.",
    Icon: MousePointer2,
    accent: "#91b9ff",
    capabilityIds: ["browser.persistent-control", "desktop.native-control", "shell-files.filesystem", "vision.screen-inspection"],
    examples: [
      { prompt: "Open AVA Chrome and show me which tabs are open.", capabilityId: "browser.persistent-control" },
      { prompt: "Look at my screen and tell me what is open.", capabilityId: "vision.screen-inspection" },
    ],
  },
  {
    id: "accounts",
    eyebrow: "Connected world",
    title: "Use my web and accounts",
    description: "Work through AVA's persistent logged-in browser and dedicated, identity-aware workflows for communication and useful services.",
    Icon: Chrome,
    accent: "#c5a7ff",
    capabilityIds: ["instagram.messaging", "whatsapp.messaging", "people.identity-resolution", "services.google-places", "services.shopify-products"],
    examples: [
      { prompt: "Check whether my Instagram and WhatsApp are connected.", capabilityId: "instagram.messaging" },
      { prompt: "Find highly rated restaurants near me that have a website.", capabilityId: "services.google-places" },
    ],
  },
  {
    id: "knowledge",
    eyebrow: "Knowledge",
    title: "Remember and organise",
    description: "Carry useful preferences and project context across sessions, learn reusable procedures, and keep scheduled watches running after the chat ends.",
    Icon: BrainCircuit,
    accent: "#7cf0c8",
    capabilityIds: ["memory.durable", "playbooks.procedural-memory", "automation.watches", "notifications.push-approvals"],
    examples: [
      { prompt: "What do you remember about how I like to work?", capabilityId: "memory.durable" },
      { prompt: "List my active reminders and watches.", capabilityId: "automation.watches" },
    ],
  },
  {
    id: "build",
    eyebrow: "Creation",
    title: "Build and automate",
    description: "Inspect projects, debug software, implement tested changes and automate recurring work while keeping outcomes and failures visible.",
    Icon: Code2,
    accent: "#ffd479",
    capabilityIds: ["coding.project-work", "orchestration.agent-loop", "self-improvement.pipeline", "verification.outcome-evidence"],
    examples: [
      { prompt: "Review this project, find the highest-impact reliability issue and explain it.", capabilityId: "coding.project-work" },
      { prompt: "Show me what AVA is doing now and what failed recently.", capabilityId: "verification.outcome-evidence" },
    ],
  },
] as const;

const FEATURED_ACTIONS = [
  {
    capabilityId: "browser.persistent-control",
    title: "Open my working browser",
    prompt: "Open AVA Chrome and show me which tabs are open.",
    Icon: Chrome,
  },
  {
    capabilityId: "vision.screen-inspection",
    title: "Understand my screen",
    prompt: "Look at my screen and tell me what is open.",
    Icon: Eye,
  },
  {
    capabilityId: "memory.durable",
    title: "Show what you remember",
    prompt: "What do you remember about me and how I like to work?",
    Icon: BrainCircuit,
  },
  {
    capabilityId: "automation.watches",
    title: "Check my automations",
    prompt: "List my active reminders and watches and explain each one.",
    Icon: Radio,
  },
] as const;

const FLOW = [
  { label: "You ask", detail: "Use ordinary words", Icon: MessageCircle },
  { label: "AVA routes", detail: "Selects the real capability", Icon: Workflow },
  { label: "AVA acts", detail: "Uses the right tool or workflow", Icon: WandSparkles },
  { label: "AVA checks", detail: "Shows evidence or the failure boundary", Icon: CheckCircle2 },
] as const;

function byId(capabilities: readonly ExplorerCapability[]): Map<string, ExplorerCapability> {
  return new Map(capabilities.map((capability) => [capability.id, capability]));
}

function PillarCard({
  pillar,
  capabilityMap,
  runtime,
  onLaunch,
  onInspectCapability,
}: {
  pillar: Pillar;
  capabilityMap: Map<string, ExplorerCapability>;
  runtime: readonly ExplorerRuntimeCapability[];
  onLaunch: (prompt: string) => void;
  onInspectCapability: (id: string) => void;
}) {
  const capabilities = pillar.capabilityIds
    .map((id) => capabilityMap.get(id))
    .filter((item): item is ExplorerCapability => !!item);
  const states = capabilities.map((capability) => ({
    capability,
    presentation: runtimeForCapability(capability, runtime),
  }));
  const ready = states.filter(({ presentation }) => presentation.readiness === "ready").length;
  const partial = states.filter(({ presentation }) => presentation.readiness === "partially_ready").length;
  const status = ready > 0
    ? `${ready} ready now`
    : partial > 0
      ? `${partial} partially ready`
      : "Status not yet proven";

  return (
    <BorderGlow dataPanelSection className="flex h-full min-h-[390px] flex-col overflow-hidden px-5 py-5 sm:px-6 sm:py-6">
      <div className="relative z-[2] flex h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-2xl border"
            style={{ color: pillar.accent, borderColor: `${pillar.accent}40`, background: `${pillar.accent}12` }}
          >
            <pillar.Icon size={20} />
          </span>
          <span className="hud rounded-full border border-white/[0.08] bg-black/25 px-2.5 py-1 text-[8px] text-white/42">
            {status}
          </span>
        </div>
        <div className="hud mt-5 text-[8px]" style={{ color: pillar.accent }}>{pillar.eyebrow}</div>
        <h3 className="mt-1.5 text-xl font-semibold text-white/92">{pillar.title}</h3>
        <p className="mt-2 text-[11px] leading-relaxed text-white/48">{pillar.description}</p>

        <div className="mt-5 space-y-1.5 border-t border-white/[0.07] pt-4">
          {states.slice(0, 4).map(({ capability, presentation }) => (
            <button
              key={capability.id}
              type="button"
              onClick={() => onInspectCapability(capability.id)}
              className="group flex w-full items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-white/[0.035]"
            >
              <span className="truncate text-[10px] text-white/55 group-hover:text-white/80">{capability.shortName}</span>
              <span className="hud flex shrink-0 items-center gap-1.5 text-[7px]" style={{ color: readinessColor(presentation.readiness) }}>
                <span className="h-1 w-1 rounded-full bg-current" />
                {readinessLabel(presentation.readiness)}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-auto space-y-2 pt-5">
          {pillar.examples.map((example) => (
            <button
              key={example.prompt}
              type="button"
              onClick={() => onLaunch(example.prompt)}
              className="group flex w-full items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 text-left text-[9.5px] leading-snug text-white/52 transition-colors hover:border-[rgba(92,242,255,.28)] hover:bg-[rgba(92,242,255,.06)] hover:text-white/80"
            >
              <Play size={10} className="shrink-0 text-[var(--ac)]" fill="currentColor" />
              <span className="line-clamp-2">“{example.prompt}”</span>
            </button>
          ))}
        </div>
      </div>
    </BorderGlow>
  );
}

export function DiscoverView({
  domains,
  capabilities,
  runtime,
  taskTotal,
  loading,
  onLaunch,
  onInspectCapability,
  onOpenMap,
  onOpenActivity,
}: {
  domains: readonly ExplorerDomain[];
  capabilities: readonly ExplorerCapability[];
  runtime: readonly ExplorerRuntimeCapability[];
  taskTotal: number;
  loading: boolean;
  onLaunch: (prompt: string) => void;
  onInspectCapability: (id: string) => void;
  onOpenMap: () => void;
  onOpenActivity: () => void;
}) {
  const capabilityMap = byId(capabilities);
  const allStates = capabilities.map((capability) => runtimeForCapability(capability, runtime));
  const ready = allStates.filter((item) => item.readiness === "ready").length;
  const workflows = capabilities.filter((capability) => capability.workflow).length;

  return (
    <div className="space-y-6">
      <section
        data-panel-section
        className="relative overflow-hidden rounded-[30px] border border-[rgba(92,242,255,.15)] bg-[linear-gradient(145deg,rgba(15,24,34,.94),rgba(4,7,12,.98))] px-6 py-8 sm:px-9 sm:py-10 lg:px-12 lg:py-12"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 82% 18%,rgba(92,242,255,.18),transparent 27%)," +
              "radial-gradient(circle at 60% 110%,rgba(143,102,255,.12),transparent 34%)," +
              "linear-gradient(115deg,transparent 42%,rgba(255,255,255,.028) 50%,transparent 58%)",
          }}
        />
        <div className="relative z-[1] grid gap-10 lg:grid-cols-[1.35fr_.65fr] lg:items-end">
          <div>
            <div className="hud flex items-center gap-2 text-[9px] text-[var(--ac)]">
              <Sparkles size={13} /> AVA capability showcase
            </div>
            <h2 className="mt-5 max-w-4xl text-3xl font-semibold leading-[1.08] tracking-[-0.025em] text-white sm:text-4xl lg:text-[46px]">
              One conversation. Your computer, accounts, memory and projects.
            </h2>
            <p className="mt-5 max-w-2xl text-[12px] leading-relaxed text-white/52 sm:text-[13px]">
              AVA is a personal agent that can talk with you, take real action on your Windows PC,
              use connected services, remember useful context and show what actually happened.
            </p>
            <div className="mt-6 grid max-w-2xl gap-2 sm:grid-cols-2">
              {[
                [Chrome, "Browse and use logged-in accounts"],
                [MousePointer2, "Control Windows apps and files"],
                [BrainCircuit, "Remember your context and routines"],
                [Code2, "Build, debug and automate projects"],
              ].map(([Icon, label]) => {
                const AbilityIcon = Icon as ComponentType<{ size?: number; className?: string }>;
                return (
                  <div key={String(label)} className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-[9.5px] text-white/48">
                    <AbilityIcon size={13} className="shrink-0 text-[var(--ac)]" />
                    {String(label)}
                  </div>
                );
              })}
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <button type="button" onClick={onOpenMap} className="btn-deck btn-primary h-10 px-5">
                Explore every capability <ArrowRight size={14} />
              </button>
              <button type="button" onClick={onOpenActivity} className="btn-deck btn-ghost h-10 px-5">
                See AVA working <Radio size={13} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {[
              [loading ? "…" : String(ready), "runtime checks ready"],
              [String(capabilities.length), "real capabilities"],
              [String(workflows), "mapped workflows"],
              [String(taskTotal), "recorded tasks"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-2xl border border-white/[0.08] bg-black/25 px-4 py-4 backdrop-blur-sm">
                <div className="text-2xl font-semibold text-white/88">{value}</div>
                <div className="hud mt-1.5 text-[7px] leading-relaxed text-white/30">{label}</div>
              </div>
            ))}
            <div className="col-span-2 flex items-center gap-2 rounded-2xl border border-[rgba(124,240,200,.16)] bg-[rgba(124,240,200,.045)] px-4 py-3 text-[9px] text-white/43">
              <ShieldCheck size={14} className="shrink-0 text-[#7cf0c8]" />
              Status comes from live configuration and evidence—not marketing claims.
            </div>
          </div>
        </div>
      </section>

      <section data-panel-section className="lg-slab px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="hud text-[8px] text-[var(--ac)]">How AVA works</div>
            <h3 className="mt-1.5 text-lg font-semibold text-white/86">From a normal request to a checked result.</h3>
          </div>
          <div className="text-[9px] text-white/32">Risky actions still follow AVA's approval rules.</div>
        </div>
        <div className="mt-5 grid gap-2 md:grid-cols-4">
          {FLOW.map((step, index) => (
            <div key={step.label} className="relative rounded-2xl border border-white/[0.07] bg-black/22 px-4 py-4">
              {index < FLOW.length - 1 && (
                <ArrowRight size={13} className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-[var(--ac)]/45 md:block" />
              )}
              <step.Icon size={16} className="text-[var(--ac)]" />
              <div className="mt-3 text-[11px] font-semibold text-white/72">{step.label}</div>
              <div className="mt-1 text-[9px] leading-relaxed text-white/32">{step.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <section data-panel-section>
        <div className="mb-4 flex items-end justify-between gap-4 px-1">
          <div>
            <div className="hud text-[8px] text-[var(--ac)]">Try AVA</div>
            <h3 className="mt-1.5 text-xl font-semibold text-white/88">Start with something real.</h3>
          </div>
          <span className="hidden text-[9px] text-white/30 sm:block">Each card opens a new request with the example ready.</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {FEATURED_ACTIONS.map((action) => {
            const capability = capabilityMap.get(action.capabilityId);
            if (!capability) return null;
            const presentation = runtimeForCapability(capability, runtime);
            const unavailable = presentation.readiness === "unavailable" || presentation.readiness === "setup_required";
            return (
              <button
                key={action.capabilityId}
                type="button"
                onClick={() => unavailable ? onInspectCapability(capability.id) : onLaunch(action.prompt)}
                className="group rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-4 text-left transition-[transform,border-color,background] hover:-translate-y-0.5 hover:border-[rgba(92,242,255,.27)] hover:bg-[rgba(92,242,255,.045)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <action.Icon size={17} className="text-[var(--ac)]" />
                  <span className="hud flex items-center gap-1.5 text-[7px]" style={{ color: readinessColor(presentation.readiness) }}>
                    <span className="h-1 w-1 rounded-full bg-current" />
                    {readinessLabel(presentation.readiness)}
                  </span>
                </div>
                <div className="mt-4 text-[11px] font-semibold text-white/76">{action.title}</div>
                <div className="mt-2 line-clamp-2 text-[9px] leading-relaxed text-white/35">
                  {unavailable ? presentation.reason : `“${action.prompt}”`}
                </div>
                <div className="hud mt-4 flex items-center gap-1.5 text-[7px] text-[var(--ac)]">
                  {unavailable ? "See setup" : "Launch request"} <ArrowRight size={10} />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section data-panel-section>
        <div className="mb-4 px-1">
          <div className="hud text-[8px] text-[var(--ac)]">What AVA can do</div>
          <h3 className="mt-1.5 text-2xl font-semibold text-white/90">Five ways AVA becomes useful.</h3>
          <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-white/38">
            Start with the outcome you want. Open any capability for its workflow, dependencies, safety boundaries and real evidence.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {DISCOVER_PILLARS.map((pillar) => (
            <PillarCard
              key={pillar.id}
              pillar={pillar}
              capabilityMap={capabilityMap}
              runtime={runtime}
              onLaunch={onLaunch}
              onInspectCapability={onInspectCapability}
            />
          ))}
          <BorderGlow dataPanelSection className="flex min-h-[390px] flex-col justify-between overflow-hidden px-6 py-6">
            <div className="relative z-[2]">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(92,242,255,.2)] bg-[rgba(92,242,255,.07)] text-[var(--ac)]">
                <Layers3 size={20} />
              </span>
              <div className="hud mt-5 text-[8px] text-[var(--ac)]">Go deeper</div>
              <h3 className="mt-1.5 text-xl font-semibold text-white/92">See the complete system</h3>
              <p className="mt-2 text-[11px] leading-relaxed text-white/48">
                Explore {domains.length} domains, inspect tree-like workflows and follow the exact capability path used by recorded tasks.
              </p>
            </div>
            <button type="button" onClick={onOpenMap} className="relative z-[2] mt-8 flex items-center justify-between rounded-2xl border border-[rgba(92,242,255,.16)] bg-[rgba(92,242,255,.06)] px-4 py-4 text-left text-[10px] font-semibold text-[var(--ac-text)] hover:border-[rgba(92,242,255,.35)]">
              Open the full capability map <ArrowRight size={14} />
            </button>
          </BorderGlow>
        </div>
      </section>

      <section data-panel-section className="grid gap-3 sm:grid-cols-3">
        {[
          [ShieldCheck, "Protected actions", "AVA keeps approvals and safety boundaries visible."],
          [Bot, "Honest status", "Configured, ready, tested and successful are kept separate."],
          [Sparkles, "Built to improve", "Failures and evidence can feed better workflows without rewriting history."],
        ].map(([Icon, title, detail]) => {
          const ItemIcon = Icon as ComponentType<{ size?: number; className?: string }>;
          return (
            <div key={String(title)} className="rounded-2xl border border-white/[0.07] bg-black/22 px-5 py-4">
              <ItemIcon size={15} className="text-[var(--ac)]" />
              <div className="mt-3 text-[10px] font-semibold text-white/68">{String(title)}</div>
              <div className="mt-1.5 text-[9px] leading-relaxed text-white/32">{String(detail)}</div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
