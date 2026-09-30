/** One successful post by AVA to the development room (contract ava-room-member v2). */
export type RoomPostReceipt = {
  schemaVersion: 1;
  messageId: number;
  roomName: string;
  correlationId: string;
  postedAt: number;
};

export type RoomPosts = { schemaVersion: 1; items: RoomPostReceipt[] };

const MAX_ITEMS = 3;
const MAX_TEXT = 128;

function validItem(value: unknown): value is RoomPostReceipt {
  if (!value || typeof value !== "object") return false;
  const i = value as Record<string, unknown>;
  return i.schemaVersion === 1
    && Number.isSafeInteger(i.messageId) && (i.messageId as number) > 0
    && typeof i.roomName === "string" && i.roomName.trim().length > 0 && i.roomName.length <= MAX_TEXT
    && typeof i.correlationId === "string" && i.correlationId.trim().length > 0 && i.correlationId.length <= MAX_TEXT
    && typeof i.postedAt === "number" && Number.isFinite(i.postedAt) && i.postedAt >= 0;
}

/** Defensive client-side check (the server already validates and rescrubs): strict, deduped, bounded. */
export function validRoomPosts(value: unknown): RoomPosts | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { schemaVersion?: unknown; items?: unknown };
  if (v.schemaVersion !== 1 || !Array.isArray(v.items)) return null;
  const seen = new Set<number>();
  const items: RoomPostReceipt[] = [];
  for (const raw of v.items) {
    if (!validItem(raw) || seen.has(raw.messageId)) continue;
    seen.add(raw.messageId);
    items.push(raw);
    if (items.length >= MAX_ITEMS) break;
  }
  return items.length ? { schemaVersion: 1, items } : null;
}
