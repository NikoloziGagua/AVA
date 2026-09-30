export type StrategyActor = "niko" | "ava" | "codex" | "system";

export type StrategyRoomStatus =
  | "discussing"
  | "awaiting_niko"
  | "approved"
  | "paused"
  | "failed";

export type StrategyPhase =
  | "framing"
  | "codex_review"
  | "cross_review"
  | "codex_final"
  | "synthesis"
  | "waiting_for_niko"
  | "approved"
  | "paused"
  | "failed";

export type StrategyMessageKind =
  | "message"
  | "position"
  | "review"
  | "synthesis"
  | "decision"
  | "status"
  | "error";

export type StrategyRoom = {
  id: string;
  title: string;
  topic: string;
  status: StrategyRoomStatus;
  phase: StrategyPhase;
  activeActor: StrategyActor | null;
  round: number;
  version: number;
  livingBrief: string | null;
  conclusion: string | null;
  codexThreadId: string | null;
  sourceSessionId: string | null;
  sourceThroughMessageId: number | null;
  returnedMessageId: number | null;
  returnedAt: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
  stoppedAt: number | null;
};

export type StrategyMessage = {
  id: string;
  roomId: string;
  sequence: number;
  author: StrategyActor;
  kind: StrategyMessageKind;
  content: string;
  correlationId: string;
  createdAt: number;
};

export type StrategyEvent = {
  seq: number;
  eventId: string;
  roomId: string;
  type: string;
  payload: unknown;
  createdAt: number;
};

export type StrategyRoomDetail = {
  room: StrategyRoom;
  messages: StrategyMessage[];
};
