export type MemoryContextSelection = {
  entryId: string;
  title: string;
  kind: string;
  project: string | null;
  sourceStatus: "verified" | "changed" | "unavailable";
  matchMode: "recent" | "lexical" | "semantic" | "hybrid";
  matchReason: string;
  sourceTruncated: boolean;
};

/** Public, sanitized projection attached to an AVA response. */
export type MemoryContext = {
  schemaVersion: 1;
  status: "used" | "no_match" | "suppressed" | "unavailable" | "error";
  reason: string;
  project: string | null;
  mode: "recent" | "lexical" | "semantic" | "hybrid" | null;
  semanticAvailable: boolean;
  notice: string | null;
  selected: MemoryContextSelection[];
};
