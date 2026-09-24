export type SavedItemKind = "note" | "idea" | "reminder" | "watch" | "memory";

/** One thing AVA saved during a reply (server-sanitized). */
export type SavedItem = {
  kind: SavedItemKind;
  id: string;
  title: string;
};

/** What AVA saved while producing one reply; shown as a Saved card. */
export type SavedItems = {
  schemaVersion: 1;
  items: SavedItem[];
};

export const SAVED_KIND_LABEL: Record<SavedItemKind, string> = {
  note: "Note",
  idea: "Idea",
  reminder: "Reminder",
  watch: "Watch",
  memory: "Memory",
};

/** Where tapping a saved item takes Sir. */
export type SavedItemDestination =
  | { view: "notes"; noteId: string }
  | { view: "schedule" }
  | { view: "watches"; watchId: string }
  | { view: "memory" };

export function savedItemDestination(item: SavedItem): SavedItemDestination {
  switch (item.kind) {
    case "note":
    case "idea":
      return { view: "notes", noteId: item.id };
    case "reminder":
      return { view: "schedule" };
    case "watch":
      return { view: "watches", watchId: item.id };
    case "memory":
      return { view: "memory" };
  }
}
