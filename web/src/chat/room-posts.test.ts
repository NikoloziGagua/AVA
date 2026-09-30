import { describe, expect, it } from "vitest";
import { validRoomPosts } from "./room-posts.js";

const good = { schemaVersion: 1, messageId: 7, roomName: "klevar", correlationId: "c1", postedAt: 1 };

describe("validRoomPosts", () => {
  it("keeps valid receipts, dedupes by message id and caps at three", () => {
    const out = validRoomPosts({ schemaVersion: 1, items: [good, { ...good }, { ...good, messageId: 8 }, { ...good, messageId: 9 }, { ...good, messageId: 10 }] });
    expect(out?.items.map((i) => i.messageId)).toEqual([7, 8, 9]);
  });

  it("drops malformed or out-of-bounds items", () => {
    const bad = [
      { ...good, schemaVersion: 2 }, { ...good, messageId: 0 }, { ...good, messageId: 1.5 },
      { ...good, roomName: "" }, { ...good, roomName: "x".repeat(129) }, { ...good, correlationId: " " },
      { ...good, postedAt: -1 }, { ...good, postedAt: Number.NaN }, null, "x",
    ];
    expect(validRoomPosts({ schemaVersion: 1, items: bad })).toBeNull();
    expect(validRoomPosts({ schemaVersion: 2, items: [good] })).toBeNull();
    expect(validRoomPosts(null)).toBeNull();
  });
});
