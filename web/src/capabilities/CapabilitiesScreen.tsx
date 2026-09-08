import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import {
  ArrowUpRight,
  AudioWaveform,
  BellRing,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  Check,
  Chrome,
  Code2,
  Copy,
  Database,
  Eye,
  FileCode2,
  Instagram,
  Mail,
  MapPin,
  MessageCircle,
  Radar,
  RefreshCw,
  Search,
  Shuffle,
  Sparkles,
} from "lucide-react";
import {
  fetchCapabilities,
  type CapabilitySnapshot,
} from "../api.js";
import { PanelSection, PanelShell } from "../components/ava/PanelShell.js";
import { BorderGlow } from "../components/ava/BorderGlow.js";
import { Badge } from "../components/ui/badge.js";
import {
  CAPABILITIES,
  CAPABILITY_CATEGORIES,
  MISSIONS,
  availableMissions,
  capabilityState,
  filterCapabilities,
  missionForDay,
  type CapabilityDefinition,
  type CapabilityState,
} from "./catalog.js";

export interface CapabilitiesScreenProps {
  onLaunch: (prompt: string) => void;
}

const ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  conversation: BrainCircuit,
  voice: AudioWaveform,
  files: FileCode2,
  browser: Chrome,
  screen: Eye,
  instagram: Instagram,
  whatsapp: MessageCircle,
  google: Mail,
  places: MapPin,
  shopify: BriefcaseBusiness,
  memory: Database,
  watches: BellRing,
  self: Sparkles,
  code: Code2,
};

function StateBadge({ state, browserBound = false }: {
  state: CapabilityState;
  browserBound?: boolean;
}) {
  if (state === "ready") {
    return <Badge variant="success">{browserBound ? "BROWSER READY" : "READY"}</Badge>;
  }
  if (state === "setup") return <Badge variant="warning">OPTIONAL SETUP</Badge>;
  return <Badge variant="warning">{browserBound ? "START AVA CHROME" : "OFFLINE"}</Badge>;
}

function PulseCard({
  icon: Icon,
  label,
  value,
  ready,
  detail,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  ready: boolean;
  detail: string;
}) {
  return (
    <div className="lg-slab min-w-0 rounded-2xl px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <Icon size={17} className={ready ? "text-[var(--ac)]" : "text-[var(--ac-exec)]"} />
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: ready ? "var(--ac-live)" : "var(--ac-exec)",
            boxShadow: ready
              ? "0 0 10px rgba(57,255,176,.75)"
              : "0 0 10px rgba(255,212,121,.7)",
          }}
        />
      </div>
      <div className="hud text-[9px] text-white/40">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-white/90">{value}</div>
      <div className="mt-1 text-[10px] leading-relaxed text-white/40">{detail}</div>
    </div>
  );
}

function CapabilityCard({
  capability,
  snapshot,
}: {
  capability: CapabilityDefinition;
  snapshot: CapabilitySnapshot | null;
}) {
  const Icon = ICONS[capability.id] ?? Bot;
  const state = capabilityState(capability, snapshot);
  const browserBound = ["instagram", "whatsapp", "gmailCalendar"].includes(capability.status);
  return (
    <BorderGlow dataPanelSection className="flex h-full min-h-[220px] flex-col px-5 py-5">
      <div className="relative z-[2] flex h-full flex-col">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(92,242,255,.14)]"
            style={{ background: "rgba(92,242,255,.06)" }}
          >
            <Icon size={19} className="text-[var(--ac)]" />
          </div>
          <StateBadge state={state} browserBound={browserBound} />
        </div>
        <div className="hud text-[9px] text-white/35">{capability.category}</div>
        <h2 className="mt-1 text-base font-semibold text-white/90">{capability.title}</h2>
        <p className="mt-2 text-[11px] leading-relaxed text-white/50">{capability.summary}</p>
        <div className="mt-auto flex flex-wrap gap-1.5 pt-5">
          {capability.examples.slice(0, 3).map((example) => (
            <span
              key={example}
              className="rounded-full border border-white/[0.08] bg-white/[0.025] px-2.5 py-1 text-[9px] text-white/45"
            >
              {example}
            </span>
          ))}
        </div>
      </div>
    </BorderGlow>
  );
}

export function CapabilitiesScreen({ onLaunch }: CapabilitiesScreenProps) {
  const [snapshot, setSnapshot] = useState<CapabilitySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CAPABILITY_CATEGORIES)[number]>("All");
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [missionOffset, setMissionOffset] = useState(0);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setSnapshot(await fetchCapabilities());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't load capability status");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const filtered = useMemo(
    () => filterCapabilities(query, category),
    [query, category],
  );
  const readyCount = snapshot
    ? CAPABILITIES.filter((capability) => capabilityState(capability, snapshot) === "ready").length
    : 0;
  const missions = availableMissions(snapshot);
  const dayKey = new Date().toLocaleDateString("en-CA");
  const baseMission = missionForDay(snapshot, dayKey);
  const baseIndex = Math.max(0, missions.findIndex((mission) => mission.id === baseMission.id));
  const featuredMission = missions[(baseIndex + missionOffset) % missions.length]!;
  const browserReady = !!snapshot?.core.browser.ready;
  const memory = snapshot?.core.memory;

  const copyHelper = async () => {
    const helper = snapshot?.core.browser.helper ?? "scripts/start-ava-browser.cmd";
    try {
      await navigator.clipboard.writeText(helper);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <PanelShell title="Capabilities" grid>
      <PanelSection
        title="System pulse"
        span="lg:col-span-12"
        right={(
          <button
            type="button"
            onClick={() => void load()}
            className="btn-deck btn-ghost flex h-7 items-center gap-2 px-2.5"
            aria-label="refresh capability status"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">REFRESH</span>
          </button>
        )}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <PulseCard
            icon={BrainCircuit}
            label="Brain"
            value={snapshot?.core.brain.model ?? "checking…"}
            ready={!!snapshot?.core.brain.ready}
            detail={snapshot?.core.brain.provider ?? "provider unavailable"}
          />
          <PulseCard
            icon={AudioWaveform}
            label="Voice"
            value={snapshot ? `${snapshot.core.voice.model} · ${snapshot.core.voice.speaker}` : "checking…"}
            ready={!!snapshot?.core.voice.ready}
            detail="one continuous Realtime voice"
          />
          <PulseCard
            icon={Chrome}
            label="AVA Chrome"
            value={browserReady ? "Connected" : "Helper offline"}
            ready={browserReady}
            detail={browserReady ? "persistent logged-in profile attached" : "start once on the PC"}
          />
          <PulseCard
            icon={Database}
            label="Memory"
            value={memory ? `${memory.observations + memory.preferences} facts · ${memory.projects} projects` : "checking…"}
            ready={!!memory?.ready}
            detail={memory ? `${memory.people} people · ${memory.playbooks} learned workflows` : "loading memory map"}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
          <div className="flex items-center gap-2 text-[10px] text-white/45">
            <Radar size={14} className="text-[var(--ac)]" />
            <span>
              {snapshot ? `${readyCount} of ${CAPABILITIES.length} capabilities ready now` : "reading live capability state"}
            </span>
          </div>
          {error && <span className="text-[10px] text-[var(--ac-stop)]">{error}</span>}
        </div>
      </PanelSection>

      {!browserReady && snapshot && (
        <div className="lg:col-span-12" data-panel-section>
          <div
            className="flex flex-col gap-3 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            style={{
              borderColor: "rgba(255,212,121,.28)",
              background: "rgba(255,212,121,.07)",
            }}
          >
            <div>
              <div className="hud text-[9px] text-[var(--ac-exec)]">BROWSER ASLEEP</div>
              <div className="mt-1 text-sm font-semibold text-white/85">Ask AVA to open Chrome</div>
              <p className="mt-1 text-[11px] text-white/50">
                She will run <code className="text-[#ffe6ad]">scripts\start-ava-browser.cmd</code> herself.
                If Windows blocks that automatic launch, the same file is the manual fallback.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void copyHelper()}
              className="btn-deck btn-ghost flex shrink-0 items-center gap-2"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy fallback"}
            </button>
          </div>
        </div>
      )}

      <PanelSection
        title="Mission deck"
        span="lg:col-span-12"
        right={<span className="chip chip-ac">{missions.length} READY</span>}
      >
        <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
          <div
            className="relative overflow-hidden rounded-2xl border border-[rgba(92,242,255,.18)] px-6 py-6"
            style={{
              background:
                "radial-gradient(circle at 86% 18%, rgba(92,242,255,.13), transparent 35%)," +
                "linear-gradient(135deg, rgba(92,242,255,.06), rgba(255,255,255,.018))",
            }}
          >
            <div className="pointer-events-none absolute right-[-24px] top-[-32px] h-36 w-36 rounded-full border border-[rgba(92,242,255,.12)]" />
            <div className="pointer-events-none absolute right-[2px] top-[-8px] h-24 w-24 rounded-full border border-[rgba(92,242,255,.18)]" />
            <div className="hud text-[9px] text-[var(--ac)]">{featuredMission.eyebrow}</div>
            <h2 className="mt-2 max-w-[75%] text-2xl font-semibold text-white/95">
              {featuredMission.title}
            </h2>
            <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-white/50">
              {featuredMission.prompt}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onLaunch(featuredMission.prompt)}
                className="btn-deck btn-primary flex items-center gap-2"
              >
                Launch mission <ArrowUpRight size={14} />
              </button>
              <button
                type="button"
                onClick={() => setMissionOffset((value) => value + 1)}
                className="btn-deck btn-ghost flex items-center gap-2"
              >
                <Shuffle size={13} /> Surprise me
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {MISSIONS.filter((mission) => mission.id !== featuredMission.id)
              .slice(0, 4)
              .map((mission) => {
                const enabled = missions.some((available) => available.id === mission.id);
                return (
                  <button
                    key={mission.id}
                    type="button"
                    disabled={!enabled}
                    onClick={() => onLaunch(mission.prompt)}
                    className="lg-slab group rounded-xl px-4 py-4 text-left transition-colors enabled:hover:border-[rgba(92,242,255,.22)] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <div className="hud text-[8px] text-white/30">{mission.eyebrow}</div>
                    <div className="mt-2 text-xs font-semibold text-white/75 group-hover:text-white">
                      {mission.title}
                    </div>
                    <div className="mt-3 text-[9px] text-white/35">
                      {enabled ? "TAP TO LAUNCH" : "NEEDS SETUP"}
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      </PanelSection>

      <div className="lg:col-span-12" data-panel-section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search what AVA can do…"
              className="h-10 w-full rounded-full border border-white/10 bg-white/[0.035] pl-9 pr-4 text-xs text-white/80 outline-none placeholder:text-white/30 focus:border-[rgba(92,242,255,.35)]"
            />
          </div>
          <div className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full border border-white/[0.08] bg-white/[0.025] p-1">
            {CAPABILITY_CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                className={
                  "shrink-0 rounded-full px-3 py-1.5 text-[9px] font-semibold transition-colors " +
                  (category === item
                    ? "bg-[rgba(92,242,255,.12)] text-[var(--ac-text)]"
                    : "text-white/40 hover:text-white/70")
                }
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="lg:col-span-12" data-panel-section>
        <div className="mb-3 flex items-center justify-between">
          <div className="hud text-[10px] text-white/45">Capability map</div>
          <div className="text-[10px] text-white/30">{filtered.length} shown</div>
        </div>
        {filtered.length === 0 ? (
          <div className="lg-slab rounded-2xl px-6 py-12 text-center text-xs text-white/40">
            No capability matched that search.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((capability) => (
              <CapabilityCard key={capability.id} capability={capability} snapshot={snapshot} />
            ))}
          </div>
        )}
      </div>
    </PanelShell>
  );
}
