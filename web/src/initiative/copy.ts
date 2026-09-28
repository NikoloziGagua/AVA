/** Words for AVA's ideas (contract ava-initiative), kept in one place. */

/** "1 idea", "3 ideas". */
export function ideaCount(pending: number): string {
  return pending === 1 ? "1 idea" : `${pending} ideas`;
}

export const IDEA_UNAVAILABLE = "This idea is no longer available.";
