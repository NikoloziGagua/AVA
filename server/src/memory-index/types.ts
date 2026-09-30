export const MEMORY_INDEX_KINDS = ["research", "idea", "remembered", "improvement", "artifact"] as const;
export type MemoryIndexKind = typeof MEMORY_INDEX_KINDS[number];

/** Kinds that may be captured from conversation evidence by a user or agent. */
export const CONVERSATION_MEMORY_KINDS = ["research", "idea", "remembered"] as const;
export type ConversationMemoryKind = typeof CONVERSATION_MEMORY_KINDS[number];

export const MEMORY_PRIVACY_LEVELS = ["personal", "project"] as const;
export type MemoryPrivacyLevel = typeof MEMORY_PRIVACY_LEVELS[number];

export type MemoryEmbeddingStatus = "pending" | "ready" | "unavailable";
export type MemorySourceStatus = "verified" | "changed" | "unavailable";
export type MemoryRetrievalMode = "recent" | "lexical" | "semantic" | "hybrid";
export type MemoryCaptureMode = "explicit" | "automatic";

export const MEMORY_GOVERNANCE_ACTORS = ["user", "ava"] as const;
export type MemoryGovernanceActor = typeof MEMORY_GOVERNANCE_ACTORS[number];
export const MEMORY_GOVERNANCE_EVENT_KINDS = [
  "corrected",
  "pinned",
  "unpinned",
  "superseded",
  "conflict_opened",
  "conflict_resolved",
] as const;
export type MemoryGovernanceEventKind = typeof MEMORY_GOVERNANCE_EVENT_KINDS[number];
export type MemoryGovernanceRetrievalState = "current" | "history" | "superseded" | "conflicted";

export const MEMORY_CHECKPOINT_KINDS = [
  "initial",
  "revision",
  "decision",
  "conclusion",
  "topic_shift",
  "open_question",
  "next_step",
] as const;
export type MemoryCheckpointKind = typeof MEMORY_CHECKPOINT_KINDS[number];

export type MemoryIndexEntry = {
  id: string;
  version: number;
  kind: MemoryIndexKind;
  title: string;
  summary: string;
  conclusions: string[];
  openQuestions: string[];
  nextSteps: string[];
  tags: string[];
  project: string | null;
  privacyLevel: MemoryPrivacyLevel;
  captureMode: MemoryCaptureMode;
  captureReason: string | null;
  threadId: string;
  parentEntryId: string | null;
  checkpointSequence: number;
  checkpointKind: MemoryCheckpointKind;
  checkpointReason: string | null;
  embeddingStatus: MemoryEmbeddingStatus;
  createdAt: number;
  updatedAt: number;
};

export type MemorySourceEvidence = {
  type: "conversation_range" | "improvement_record" | "automation_artifact";
  label: string;
  sessionId: string | null;
  fromMessageId: number;
  throughMessageId: number;
  messageCount: number;
  /** Stable source identity for non-conversation records (for example git:<sha>). */
  reference: string | null;
  /** Present only when the authoritative source is a committed AVA change. */
  commitSha: string | null;
  status: MemorySourceStatus;
  verifiedAt: number;
  reason: string;
};

export type MemoryMatchEvidence = {
  mode: MemoryRetrievalMode;
  reason: string;
  semanticScore: number | null;
  lexicalScore: number;
  sharedTerms: string[];
};

export type MemoryIndexResult = {
  entry: MemoryIndexEntry;
  /** Original immutable compact record before any user-governed correction. */
  originalEntry: MemoryIndexEntry;
  source: MemorySourceEvidence;
  match: MemoryMatchEvidence;
  lineage: {
    threadId: string;
    parentEntryId: string | null;
    sequence: number;
    kind: MemoryCheckpointKind;
    reason: string | null;
    totalCheckpoints: number;
    isLatest: boolean;
  };
  governance: {
    threadVersion: number;
    pinned: boolean;
    state: MemoryGovernanceRetrievalState;
    retrievalEligible: boolean;
    corrected: boolean;
    correctionEventId: string | null;
    correctionReason: string | null;
    supersededByThreadId: string | null;
    conflictWithThreadIds: string[];
    updatedAt: number;
    events: MemoryGovernanceEvent[];
  };
  usable: boolean;
};

export type MemoryGovernanceEvent = {
  id: string;
  threadId: string;
  entryId: string | null;
  kind: MemoryGovernanceEventKind;
  actor: MemoryGovernanceActor;
  reason: string;
  targetThreadId: string | null;
  resultingVersion: number;
  createdAt: number;
};

export type MemorySourceRead = {
  result: MemoryIndexResult;
  messages: Array<{ id: number; role: string; content: string }>;
  truncated: boolean;
  returnedCharacters: number;
};

export type MemorySearchResponse = {
  query: string;
  project: string | null;
  mode: MemoryRetrievalMode;
  semanticAvailable: boolean;
  notice: string | null;
  suppressedByGovernance: number;
  results: MemoryIndexResult[];
};

export type MemoryCorrection = {
  title?: string;
  summary?: string;
  conclusions?: string[];
  openQuestions?: string[];
  nextSteps?: string[];
  tags?: string[];
};

export type MemoryGovernanceMutation = {
  ok: true;
  event: MemoryGovernanceEvent;
  result: MemoryIndexResult;
} | {
  ok: false;
  reason: "not_found" | "privacy_scope" | "version_conflict" | "invalid_state" | "source_unverified";
  currentVersion: number | null;
  message: string;
};

export type MemoryEmbedding = {
  provider: string;
  model: string;
  vector: number[];
};

export interface MemoryEmbedder {
  readonly provider: string;
  readonly model: string;
  embed(text: string): Promise<MemoryEmbedding>;
}

export type CaptureMemoryInput = {
  sessionId: string;
  fromMessageId: number;
  throughMessageId: number;
  kind: ConversationMemoryKind;
  title: string;
  summary: string;
  conclusions?: string[];
  openQuestions?: string[];
  nextSteps?: string[];
  tags?: string[];
  project?: string | null;
  privacyLevel?: MemoryPrivacyLevel;
  /** Internal provenance. Authenticated routes and agent tools always use explicit. */
  captureMode?: MemoryCaptureMode;
  captureReason?: string | null;
  /** Internal immutable-lineage input. Explicit captures start a new thread. */
  parentEntryId?: string | null;
  expectedParentVersion?: number;
  checkpointKind?: MemoryCheckpointKind;
  checkpointReason?: string | null;
};

export type CaptureMemoryResult = {
  created: boolean;
  result: MemoryIndexResult;
};

export type CaptureImprovementInput = {
  commitSha: string;
  sourceKind: "git_commit" | "self_swap";
  actor: "ava" | "codex" | "claude" | "niko" | "other";
  title: string;
  summary: string;
  capabilities?: string[];
  changedFiles?: string[];
  verification?: string[];
  tags?: string[];
  shippedAt?: number;
  /** Boot reconciliation may persist immediately and embed in the background. */
  deferEmbedding?: boolean;
};

export type CaptureAutomationArtifactInput = { recordId: string; deferEmbedding?: boolean };
