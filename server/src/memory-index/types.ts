export const MEMORY_INDEX_KINDS = ["research", "idea", "remembered"] as const;
export type MemoryIndexKind = typeof MEMORY_INDEX_KINDS[number];

export const MEMORY_PRIVACY_LEVELS = ["personal", "project"] as const;
export type MemoryPrivacyLevel = typeof MEMORY_PRIVACY_LEVELS[number];

export type MemoryEmbeddingStatus = "pending" | "ready" | "unavailable";
export type MemorySourceStatus = "verified" | "changed" | "unavailable";
export type MemoryRetrievalMode = "recent" | "lexical" | "semantic" | "hybrid";
export type MemoryCaptureMode = "explicit" | "automatic";

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
  embeddingStatus: MemoryEmbeddingStatus;
  createdAt: number;
  updatedAt: number;
};

export type MemorySourceEvidence = {
  type: "conversation_range";
  label: string;
  sessionId: string | null;
  fromMessageId: number;
  throughMessageId: number;
  messageCount: number;
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
  source: MemorySourceEvidence;
  match: MemoryMatchEvidence;
  usable: boolean;
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
  results: MemoryIndexResult[];
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
  kind: MemoryIndexKind;
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
};

export type CaptureMemoryResult = {
  created: boolean;
  result: MemoryIndexResult;
};
