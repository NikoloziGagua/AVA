/** One successful post by AVA to the development room (contract ava-room-member v2). */
export type RoomPostReceipt = {
  schemaVersion: 1;
  messageId: number;
  roomName: string;
  correlationId: string;
  postedAt: number;
};

export type RoomPosts = { schemaVersion: 1; items: RoomPostReceipt[] };

/** Defensive client-side check; the server already validates and rescrubs. */
export function validRoomPosts(value: unknown): RoomPosts | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { schemaVersion?: unknown; items?: unknown };
  if (v.schemaVersion !== 1 || !Array.isArray(v.items)) return null;
  const items = v.items.filter((i): i is RoomPostReceipt =>
    !!i && typeof i === "object"
    && Number.isInteger((i as RoomPostReceipt).messageId) && (i as RoomPostReceipt).messageId > 0
    && typeof (i as RoomPostReceipt).roomName === "string").slice(0, 3);
  return items.length ? { schemaVersion: 1, items } : null;
}
