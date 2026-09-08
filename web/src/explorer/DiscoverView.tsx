import { useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  AudioWaveform,
  BrainCircuit,
  Check,
  CheckCircle2,
  Chrome,
  Code2,
  Eye,
  Layers3,
  MessageCircle,
  MousePointer2,
  Play,
  Radio,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  Workflow,
} from "lucide-react";
import type { ExplorerRuntimeCapability } from "../api.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { readinessColor, readinessLabel, runtimeForCapability } from "./runtime.js";
import type { ExplorerCapability, ExplorerDomain } from "./types.js";

type WorkflowBeat = {
  label: string;
  detail: string;
};

type Pillar = {
  id: string;
  eyebrow: string;
  navLabel: string;
  title: string;
  description: string;
  promise: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  accent: string;
  capabilityIds: readonly string[];
  workflow: readonly WorkflowBeat[];
  examples: ReadonlyArray<{ prompt: string; capabilityId: string }>;
};

export const DISCOVER_PILLARS: readonly Pillar[] = [
  {
    id: "talk",
    eyebrow: "Conversation",
    navLabel: "Talk",
    title: "Talk naturally",
    promise: "One relationship, whether you type or speak.",
    description: "AVA keeps text and voice in the same conversation, understands whether you want an answer or an action, and preserves the result for later.",
    Icon: AudioWaveform,
    accent: "#8bf7ff",
    capabilityIds: ["conversation.text-turn", "voice.realtime", "interpretation.request-mode"],
    workflow: [
      { label: "Speak or type", detail: "Use normal language, exact typed text, or voice." },
      { label: "Understand the request", detail: "AVA separates conversation, planning and real action." },
      { label: "Keep one thread", detail: "The same session carries context across voice and chat." },
      { label: "Return the result", detail: "Answers, activity and receipts remain attached to the conversation." },
    ],
    examples: [
      { prompt: "Help me plan today and recommend the best order.", capabilityId: "conversation.text-turn" },
      { prompt: "Explain what AVA can do for me in plain English.", capabilityId: "conversation.text-turn" },
    ],
  },
  {
    id: "computer",
    eyebrow: "Computer",
    navLabel: "Use my PC",
    title: "See and use your computer",
    promise: "AVA can move from advice to observable work.",
    description: "AVA can operate her persistent browser, inspect the screen, work with files, run commands and control supported Windows applications.",
    Icon: MousePointer2,
    accent: "#91b9ff",
    capabilityIds: ["browser.persistent-control", "desktop.native-control", "shell-files.filesystem", "vision.screen-inspection"],
    workflow: [
      { label: "Inspect the current state", detail: "Read the page, screen, file or application before acting." },
      { label: "Choose the right path", detail: "Use browser, Windows, file or shell tooling deliberately." },
      { label: "Perform the action", detail: "Keep the target and side effects bounded to your request." },
      { label: "Check what changed", detail: "Verify observable state or report the exact uncertainty boundary." },
    ],
    examples: [
      { prompt: "Open AVA Chrome and show me which tabs are open.", capabilityId: "browser.persistent-control" },
      { prompt: "Look at my screen and tell me what is open.", capabilityId: "vision.screen-inspection" },
    ],
  },
  {
    id: "accounts",
    eyebrow: "Connected world",
    navLabel: "Use accounts",
    title: "Work through your accounts",
    promise: "Persistent sessions, identity-aware routes, visible boundaries.",
    description: "AVA can use logged-in web sessions and dedicated workflows for people, communication, places and useful online services.",
    Icon: Chrome,
    accent: "#c5a7ff",
    capabilityIds: ["instagram.messaging", "whatsapp.messaging", "people.identity-resolution", "services.google-places", "services.shopify-products"],
    workflow: [
      { label: "Resolve the destination", detail: "Use the saved identity or exact account requested." },
      { label: "Open the verified place", detail: "Confirm the profile, thread, page or service before acting." },
      { label: "Perform the approved step", detail: "Actions remain subject to the relevant approval boundary." },
      { label: "Confirm or stop", detail: "Report visible evidence, partial progress or a precise failure point." },
    ],
    examples: [
      { prompt: "Check whether my Instagram and WhatsApp are connected.", capabilityId: "instagram.messaging" },
      { prompt: "Find highly rated restaurants near me that have a website.", capabilityId: "services.google-places" },
    ],
  },
  {
    id: "knowledge",
    eyebrow: "Knowledge",
    navLabel: "Remember",
    title: "Remember and organise",
    promise: "Useful context comes back with its source attached.",
    description: "AVA can capture notes, index source-linked memory, recall project context, learn reusable procedures and keep scheduled watches running after a chat ends.",
    Icon: BrainCircuit,
    accent: "#7cf0c8",
    capabilityIds: ["memory.durable", "memory.structured-notes", "playbooks.procedural-memory", "automation.watches", "notifications.push-approvals"],
    workflow: [
      { label: "Capture the source", detail: "Keep the conversation, note, artifact or decision that matters." },
      { label: "Build a compact index", detail: "Create a fast summary without replacing the authoritative source." },
      { label: "Retrieve by meaning", detail: "Find relevant memory within the correct personal or project scope." },
      { label: "Verify before use", detail: "Reject missing, changed or superseded evidence instead of guessing." },
    ],
    examples: [
      { prompt: "Put this idea in Notes under my AVA project.", capabilityId: "memory.structured-notes" },
      { prompt: "What do you remember about how I like to work?", capabilityId: "memory.durable" },
      { prompt: "List my active reminders and watches.", capabilityId: "automation.watches" },
    ],
  },
  {
    id: "build",
    eyebrow: "Creation",
    navLabel: "Build",
    title: "Build, automate and improve",
    promise: "AVA can inspect a system, change it, test it and preserve the evidence.",
    description: "AVA can work across codebases, automate repeatable procedures and run approval-gated self-development while keeping implementation and verification separate.",
    Icon: Code2,
    accent: "#ffd479",
    capabilityIds: ["coding.project-work", "orchestration.agent-loop", "self-improvement.pipeline", "verification.outcome-evidence"],
    workflow: [
      { label: "Inspect the real system", detail: "Read the architecture, current state and existing evidence first." },
      { label: "Plan and implement", detail: "Choose one bounded route and keep the intended outcome explicit." },
      { label: "Test the result", detail: "Exercise success, failure and important regression boundaries." },
      { label: "Record what changed", detail: "Preserve commits, evidence and limitations for future work." },
    ],
    examples: [
      { prompt: "Review this project, find the highest-impact reliability issue and explain it.", capabilityId: "coding.project-work" },
      { prompt: "Show me what AVA is doing now and what failed recently.", capabilityId: "verification.outcome-evidence" },
    ],
  },
] as const;

const FEATURED_ACTIONS = [
  { capabilityId: "browser.persistent-control", number: "01", title: "Open my working browser", detail: "Inspect the persistent AVA Chrome session.", prompt: "Open AVA Chrome and show me which tabs are open.", Icon: Chrome },
  { capabilityId: "vision.screen-inspection", number: "02", title: "Understand my screen", detail: "Use current visual evidence, not a guess.", prompt: "Look at my screen and tell me what is open.", Icon: Eye },
  { capabilityId: "memory.durable", number: "03", title: "Show what you remember", detail: "Retrieve source-linked personal context.", prompt: "What do you remember about me and how I like to work?", Icon: BrainCircuit },
  { capabilityId: "automation.watches", number: "04", title: "Check background work", detail: "Inspect the real watch list and current status.", prompt: "List my active reminders and watches and explain each one.", Icon: Radio },
] as const;

const FLOW = [
  { label: "You ask", detail: "A natural request, with the outcome you want.", Icon: MessageCircle },
  { label: "AVA routes", detail: "The right capability and boundaries are selected.", Icon: Workflow },
  { label: "AVA acts", detail: "A real tool or workflow performs the bounded work.", Icon: WandSparkles },
  { label: "AVA checks", detail: "Evidence, uncertainty or the failure boundary is returned.", Icon: CheckCircle2 },
] as const;

function byId(capabilities: readonly ExplorerCapability[]): Map<string, ExplorerCapability> {
  return new Map(capabilities.map((capability) => [capability.id, capability]));
}

function unavailable(readiness: ReturnType<typeof runtimeForCapability>["readiness"]): boolean {
  return readiness === "unavailable" || readiness === "setup_required";
}

function pillarReadiness(
  pillar: Pillar,
  capabilityMap: Map<string, ExplorerCapability>,
  runtime: readonly ExplorerRuntimeCapability[],
): { ready: number; partial: number; known: number; total: number } {
  const states = pillar.capabilityIds
    .map((id) => capabilityMap.get(id))
    .filter((capability): capability is ExplorerCapability => !!capability)
    .map((capability) => runtimeForCapability(capability, runtime).readiness);
  return {
    ready: states.filter((state) => state === "ready").length,
    partial: states.filter((state) => state === "partially_ready").length,
    known: states.filter((state) => state !== "unknown").length,
    total: states.length,
  };
}

function statusSummary(status: ReturnType<typeof pillarReadiness>): string {
  if (status.ready) return `${status.ready}/${status.total} ready now`;
  if (status.partial) return `${status.partial}/${status.total} partly ready`;
  if (status.known) return "Setup evidence available";
  return "Runtime status unknown";
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
  const reducedMotion = useReducedMotion();
  const capabilityMap = byId(capabilities);
  const [activePillarId, setActivePillarId] = useState(DISCOVER_PILLARS[1]!.id);
  const chapterRef = useRef<HTMLElement>(null);
  const activePillar = DISCOVER_PILLARS.find((pillar) => pillar.id === activePillarId) ?? DISCOVER_PILLARS[0]!;
  const allStates = capabilities.map((capability) => runtimeForCapability(capability, runtime));
  const ready = allStates.filter((item) => item.readiness === "ready").length;
  const workflows = capabilities.filter((capability) => capability.workflow).length;

  const selectChapter = (id: string, scroll = false) => {
    setActivePillarId(id);
    if (scroll) chapterRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  };

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % DISCOVER_PILLARS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + DISCOVER_PILLARS.length) % DISCOVER_PILLARS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = DISCOVER_PILLARS.length - 1;
    else return;
    event.preventDefault();
    const target = DISCOVER_PILLARS[next]!;
    setActivePillarId(target.id);
    document.getElementById(`ava-outcome-${target.id}`)?.focus();
  };

  return (
    <div className="explore-discover space-y-7">
      <section data-panel-section className="explore-editorial-hero" aria-labelledby="explore-hero-title">
        <div className="explore-hero-copy">
          <div className="explore-kicker"><Sparkles size={13} /> Meet AVA / personal intelligence</div>
          <h2 id="explore-hero-title" className="explore-display">
            <span>AVA CAN</span>
            <span className="explore-display-outline">ACT.</span>
            <span>REMEMBER.</span>
            <span className="explore-display-accent">PROVE.</span>
          </h2>
          <p className="explore-hero-deck">
            One conversation that can move from an idea to real work across your Windows PC,
            browser, accounts, memory and projects - with the outcome kept visible.
          </p>
          <div className="explore-hero-actions">
            <button type="button" className="btn-deck btn-primary h-11 px-5" onClick={() => selectChapter(activePillar.id, true)}>
              See what AVA can do <ArrowDown size={14} />
            </button>
            <button type="button" className="btn-deck btn-ghost h-11 px-5" onClick={onOpenMap}>
              Open the full system <ArrowRight size={14} />
            </button>
          </div>
          <ul className="explore-defining-list" aria-label="AVA defining abilities">
            <li><Check size={12} /> Speaks and types</li>
            <li><Check size={12} /> Uses Windows and the web</li>
            <li><Check size={12} /> Remembers source-linked context</li>
            <li><Check size={12} /> Records evidence and failures</li>
          </ul>
        </div>

        <div className="explore-system-portrait" aria-label="Interactive overview of AVA capability areas">
          <div className="explore-portrait-head">
            <span>LIVE SYSTEM PORTRAIT</span>
            <span className="explore-live-label"><i /> {loading ? "CHECKING" : "OBSERVED NOW"}</span>
          </div>
          <svg className="explore-portrait-lines" viewBox="0 0 560 510" aria-hidden="true" focusable="false">
            <path d="M280 255 L100 100 M280 255 L460 100 M280 255 L505 270 M280 255 L415 430 M280 255 L110 410" />
            <circle cx="280" cy="255" r="107" />
            <circle cx="280" cy="255" r="178" />
          </svg>
          <div className="explore-portrait-core" aria-hidden="true"><span>AVA</span><small>orchestrates</small></div>
          {DISCOVER_PILLARS.map((pillar, index) => {
            const status = pillarReadiness(pillar, capabilityMap, runtime);
            return (
              <button
                key={pillar.id}
                type="button"
                className="explore-orbit-node"
                data-position={index}
                data-active={pillar.id === activePillar.id || undefined}
                style={{ "--node-accent": pillar.accent } as React.CSSProperties}
                onClick={() => selectChapter(pillar.id, true)}
                aria-label={`Explore ${pillar.title}: ${statusSummary(status)}`}
              >
                <pillar.Icon size={16} />
                <span>{pillar.navLabel}</span>
                <small>{status.ready ? `${status.ready} ready` : status.known ? "check setup" : "unknown"}</small>
              </button>
            );
          })}
          <div className="explore-portrait-stats" aria-label="Explorer live counts">
            <span><strong>{loading ? "..." : ready}</strong> ready now</span>
            <span><strong>{capabilities.length}</strong> capabilities</span>
            <span><strong>{workflows}</strong> workflows</span>
            <span><strong>{taskTotal}</strong> task records</span>
          </div>
        </div>
      </section>

      <section data-panel-section aria-labelledby="try-ava-title" className="explore-try-section">
        <div className="explore-section-heading">
          <div><div className="explore-kicker">TRY SOMETHING REAL / 01-04</div><h3 id="try-ava-title">Start with an outcome, not a feature.</h3></div>
          <p>Every example uses AVA's normal chat path. A known unavailable capability opens its setup evidence instead.</p>
        </div>
        <div className="explore-action-grid">
          {FEATURED_ACTIONS.map((action) => {
            const capability = capabilityMap.get(action.capabilityId);
            if (!capability) return null;
            const presentation = runtimeForCapability(capability, runtime);
            const inspect = unavailable(presentation.readiness);
            return (
              <button key={action.capabilityId} type="button" onClick={() => inspect ? onInspectCapability(capability.id) : onLaunch(action.prompt)} className="explore-action">
                <span className="explore-action-number">{action.number}</span>
                <action.Icon size={19} className="explore-action-icon" />
                <span className="explore-action-title">{action.title}</span>
                <span className="explore-action-detail">{inspect ? presentation.reason : action.detail}</span>
                <span className="explore-action-foot"><i style={{ color: readinessColor(presentation.readiness) }} />{readinessLabel(presentation.readiness)}<ArrowRight size={12} /></span>
              </button>
            );
          })}
        </div>
      </section>

      <section ref={chapterRef} id="ava-capability-chapters" data-panel-section className="explore-chapters" aria-labelledby="capability-chapters-title">
        <div className="explore-chapters-intro">
          <div className="explore-kicker">CAPABILITY CHAPTERS / PROGRESSIVE DEPTH</div>
          <h3 id="capability-chapters-title">Five ways AVA becomes useful.</h3>
          <p>Choose the outcome you care about. Then inspect the workflow, readiness and exact capability underneath it.</p>
        </div>
        <div className="explore-chapter-layout">
          <div className="explore-chapter-tabs" role="tablist" aria-label="AVA capability outcomes" aria-orientation="vertical">
            {DISCOVER_PILLARS.map((pillar, index) => {
              const selected = pillar.id === activePillar.id;
              const status = pillarReadiness(pillar, capabilityMap, runtime);
              return (
                <button key={pillar.id} id={`ava-outcome-${pillar.id}`} type="button" role="tab" aria-selected={selected} aria-controls="ava-outcome-panel" tabIndex={selected ? 0 : -1} data-active={selected || undefined} onClick={() => selectChapter(pillar.id)} onKeyDown={(event) => moveTab(event, index)}>
                  <span className="explore-chapter-index">0{index + 1}</span>
                  <span className="explore-chapter-tab-copy"><strong>{pillar.navLabel}</strong><small>{statusSummary(status)}</small></span>
                  <ArrowRight size={14} />
                </button>
              );
            })}
          </div>

          <article id="ava-outcome-panel" role="tabpanel" aria-labelledby={`ava-outcome-${activePillar.id}`} className="explore-chapter-panel" style={{ "--chapter-accent": activePillar.accent } as React.CSSProperties}>
            <header className="explore-chapter-hero">
              <div><div className="explore-kicker" style={{ color: activePillar.accent }}>{activePillar.eyebrow}</div><h4>{activePillar.title}</h4><p>{activePillar.description}</p></div>
              <span className="explore-chapter-icon"><activePillar.Icon size={27} /></span>
            </header>
            <div className="explore-chapter-promise">{activePillar.promise}</div>
            <div className="explore-chapter-content">
              <section aria-labelledby="chapter-flow-title">
                <div className="explore-subhead" id="chapter-flow-title">What happens</div>
                <ol className="explore-mini-flow">
                  {activePillar.workflow.map((step, index) => <li key={step.label}><span>{index + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></li>)}
                </ol>
              </section>
              <section aria-labelledby="chapter-capabilities-title">
                <div className="explore-subhead" id="chapter-capabilities-title">Real capabilities underneath</div>
                <div className="explore-capability-list">
                  {activePillar.capabilityIds.map((id) => {
                    const capability = capabilityMap.get(id);
                    if (!capability) return null;
                    const presentation = runtimeForCapability(capability, runtime);
                    return (
                      <button key={id} type="button" onClick={() => onInspectCapability(id)}>
                        <span>{capability.shortName}</span>
                        <small style={{ color: readinessColor(presentation.readiness) }}><i /> {readinessLabel(presentation.readiness)}</small>
                        <ArrowRight size={12} />
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
            <footer className="explore-chapter-examples">
              <div className="explore-subhead">Ask AVA</div>
              <div>
                {activePillar.examples.map((example) => {
                  const capability = capabilityMap.get(example.capabilityId);
                  if (!capability) return null;
                  const presentation = runtimeForCapability(capability, runtime);
                  const inspect = unavailable(presentation.readiness);
                  return (
                    <button key={example.prompt} type="button" onClick={() => inspect ? onInspectCapability(capability.id) : onLaunch(example.prompt)}>
                      <Play size={10} fill="currentColor" /><span>{inspect ? `See setup for ${capability.shortName}` : `"${example.prompt}"`}</span>
                    </button>
                  );
                })}
              </div>
            </footer>
          </article>
        </div>
      </section>

      <section data-panel-section className="explore-operating-model" aria-labelledby="operating-model-title">
        <div className="explore-operating-copy"><div className="explore-kicker">ONE OPERATING MODEL</div><h3 id="operating-model-title">A normal request becomes a visible route.</h3><p>Explorer describes observable stages and evidence. It does not expose or manufacture hidden reasoning.</p></div>
        <ol className="explore-operating-flow">
          {FLOW.map((step, index) => (
            <li key={step.label}><span className="explore-operating-index">0{index + 1}</span><step.Icon size={17} /><strong>{step.label}</strong><small>{step.detail}</small>{index < FLOW.length - 1 && <ArrowRight size={14} className="explore-operating-arrow" aria-hidden />}</li>
          ))}
        </ol>
      </section>

      <section data-panel-section className="explore-truth" aria-labelledby="truth-title">
        <div className="explore-truth-copy">
          <div className="explore-kicker"><ShieldCheck size={12} /> PROOF, NOT PROMISES</div>
          <h3 id="truth-title">Existing is not the same as working.</h3>
          <p>Explorer keeps source declarations, mapped workflows, live readiness and recorded execution as separate levels of evidence.</p>
          <button type="button" onClick={onOpenActivity} className="btn-deck btn-ghost h-10 px-4">Inspect real activity <Radio size={13} /></button>
        </div>
        <ol className="explore-truth-ladder">
          {[
            ["01", "Declared", String(capabilities.length), "Defined in AVA's verified registry"],
            ["02", "Mapped", String(workflows), "Has an inspectable operational workflow"],
            ["03", "Checked now", loading ? "..." : String(runtime.length), "Reported by a runtime evidence adapter"],
            ["04", "Recorded work", String(taskTotal), "Has an execution record - not automatic proof"],
          ].map(([index, label, value, detail]) => <li key={label}><span>{index}</span><strong>{value}</strong><div><b>{label}</b><small>{detail}</small></div></li>)}
        </ol>
      </section>

      <section data-panel-section className="explore-deep-cta">
        <div><ScanSearch size={20} /><span className="explore-kicker">GO AS DEEP AS YOU NEED</span><h3>{domains.length} domains. {capabilities.length} capabilities. One connected system.</h3><p>Open the full Atlas for dependencies, safety boundaries, inputs, outputs, workflow trees and linked task evidence.</p></div>
        <button type="button" onClick={onOpenMap} className="btn-deck btn-primary h-11 px-5">Explore the complete map <Layers3 size={14} /></button>
      </section>
    </div>
  );
}
