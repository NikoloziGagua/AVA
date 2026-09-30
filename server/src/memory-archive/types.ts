// Memory v2: typed, dated records of what Niko has told AVA. See
// docs/design/ava-memory-v2-research-and-proposal.md.

export const MEMORY_KINDS = ["fact", "person", "project", "decision", "commitment", "preference", "event"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/**
 * Who stands behind a record. Only Niko's own words produce stated, decided
 * or requested records; an idea AVA raised that he engaged with is
 * "discussed"; AVA's own conclusion is "inferred".
 */
export const SPEECH_ACTS = ["stated", "decided", "requested", "discussed", "inferred"] as const;
export type SpeechAct = (typeof SPEECH_ACTS)[number];

export const MEMORY_CONFIDENCE = ["high", "medium", "low"] as const;
export type MemoryConfidence = (typeof MEMORY_CONFIDENCE)[number];

/** active = current; history = replaced or ended; unconfirmed = waiting for Niko. */
export type MemoryStatus = "active" | "history" | "unconfirmed";
export type MemoryOrigin = "explicit" | "conversation" | "backfill" | "migration";
export type MemoryActor = "niko" | "ava" | "extractor" | "backfill" | "migration";

export type MemoryRecord = {
  id: string;
  kind: MemoryKind;
  topic: string;
  text: string;
  speechAct: SpeechAct;
  status: MemoryStatus;
  /** false = kept and searchable, but left out of the Brief ("stop bringing it up"). */
  carry: boolean;
  sensitive: boolean;
  confidence: MemoryConfidence;
  origin: MemoryOrigin;
  sourceSessionId: string | null;
  sourceMessageIds: number[];
  /** When Niko said it (the source message's time), not when it was stored. */
  saidAt: number;
  validFrom: number;
  validTo: number | null;
  dueAt: number | null;
  supersedesId: string | null;
  supersededById: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type NewMemory = {
  kind: MemoryKind;
  topic: string;
  text: string;
  speechAct: SpeechAct;
  confidence: MemoryConfidence;
  origin: MemoryOrigin;
  saidAt: number;
  sensitive?: boolean;
  /** Defaults to active. Sensitive or uncertain automatic records wait for Niko. */
  status?: "active" | "unconfirmed";
  sourceSessionId?: string | null;
  sourceMessageIds?: number[];
  dueAt?: number | null;
};

export type MemoryChange = {
  action: "added" | "updated" | "ended" | "stopped_carrying" | "carried" | "confirmed" | "forgotten";
  actor: MemoryActor;
  /** Null once forgotten: a forget never travels with its content. */
  record: MemoryRecord | null;
  recordId: string;
  sessionId: string | null;
};

export type MemoryWriteFailure = {
  ok: false;
  reason: "invalid" | "forgotten" | "not_found" | "stale" | "wrong_state";
  message: string;
};

export type MemoryWriteResult =
  | {
    ok: true;
    /** Read back from the database after the write, never the input echoed. */
    record: MemoryRecord;
    outcome: "added" | "unchanged" | "replaced" | "confirmed";
    replaced: MemoryRecord[];
  }
  | MemoryWriteFailure;
