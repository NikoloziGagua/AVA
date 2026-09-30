import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge that knows the design tokens. Without this, `text-body` (a
 * size) and `text-ink` (a colour) look like the same group and one is dropped.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "title", "heading", "body-lg", "body", "meta", "label"] }],
      shadow: [{ shadow: ["e1", "e2", "e3"] }],
      rounded: [{ rounded: ["control", "button", "card", "sheet"] }],
      "font-family": [{ font: ["ui", "ui-mono"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
