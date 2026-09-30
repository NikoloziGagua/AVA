import { useEffect, useMemo, useState } from "react";
import { fetchPeople, fetchPlaybooks, type PersonRow, type PlaybookRow } from "../api.js";
import { MemoryBrain, type BrainMemory, type BrainNode } from "../components/ava/MemoryBrain.js";
import type { MemoryItem, MemoryKind } from "./archive-api.js";
import { day } from "./memoryTime.js";

const GROUP: Record<Exclude<MemoryKind, "preference">, string> = {
  fact: "about you", event: "about you", person: "people", project: "projects", decision: "projects", commitment: "projects",
};

/** The brain's shape, built from what AVA currently knows (memory v2), grouped like the Memory tab. */
export function toBrainMemory(records: MemoryItem[]): BrainMemory {
  const current = records.filter((record) => record.status === "active");
  return {
    personality: "",
    observations: {
      lines: current.flatMap((record) => record.kind === "preference" ? [] : [{
        raw: record.id, text: record.text, category: GROUP[record.kind], confidence: record.confidence, date: day(record.saidAt), superseded: null,
      }]),
    },
    preferences: { lines: current.filter((record) => record.kind === "preference").map((record) => record.text) },
    projects: [],
  };
}

/** The 3D map of memory. Loads people and how-tos first, so the scene is built once. */
export function MemoryMap({ records }: { records: MemoryItem[] }) {
  const [extras, setExtras] = useState<{ people: PersonRow[]; playbooks: PlaybookRow[] } | null>(null);
  const [picked, setPicked] = useState<BrainNode | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([fetchPeople().catch(() => []), fetchPlaybooks().catch(() => [])]).then(([people, playbooks]) => {
      if (alive) setExtras({ people, playbooks: playbooks.filter((book) => book.offered !== false) });
    });
    return () => { alive = false; };
  }, []);
  // Rebuilding the scene is costly: only a real change to the memory draws it again.
  const signature = records.map((record) => `${record.id}:${record.version}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memory = useMemo(() => toBrainMemory(records), [signature]);
  return <section className="ds-memory-map" aria-label="Memory map">
    <div className="ds-memory-map-stage">
      {extras ? <MemoryBrain memory={memory} people={extras.people} playbooks={extras.playbooks} watches={[]} onSelect={setPicked} />
        : <p role="status" className="ds-memory-hint">Drawing the map…</p>}
      {picked && <div className="ds-memory-map-card">
        <p className="ds-memory-kicker">{picked.category ?? picked.kind}</p>
        <p>{picked.text || picked.label}</p>
        <button className="ds-focus ds-memory-link" onClick={() => setPicked(null)}>Close</button>
      </div>}
    </div>
    <p className="ds-memory-hint">Drag to turn it, scroll or pinch to zoom, and tap a dot to read it.</p>
  </section>;
}
