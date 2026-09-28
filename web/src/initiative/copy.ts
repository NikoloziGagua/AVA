/** Words for AVA's ideas (contract ava-initiative), kept in one place. */

/** "1 idea", "3 ideas". */
export function ideaCount(pending: number): string {
  return pending === 1 ? "1 idea" : `${pending} ideas`;
}

export const IDEA_UNAVAILABLE = "This idea is no longer available.";

/** A source edited since AVA wrote the idea (contract ava-initiative v2). */
export const SOURCE_CHANGED = "Changed since AVA wrote this";
