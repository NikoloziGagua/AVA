import { describe, it, expect } from "vitest";
import { NO_REACTION, toggleLike, toggleDislike } from "./message-actions.js";

describe("message reactions", () => {
  it("like toggles on, and off again", () => {
    const liked = toggleLike(NO_REACTION);
    expect(liked.liked).toBe(true);
    expect(toggleLike(liked).liked).toBe(false);
  });

  it("liking clears a dislike and vice-versa (mutually exclusive)", () => {
    const disliked = toggleDislike(NO_REACTION);
    expect(disliked.disliked).toBe(true);
    const thenLiked = toggleLike(disliked);
    expect(thenLiked.liked).toBe(true);
    expect(thenLiked.disliked).toBe(false);
  });
});
