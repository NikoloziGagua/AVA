import type { VisualMessage } from "./types.js";
import { VisualMessageCard, type VisualSemanticActionHandler } from "./VisualMessageCard.js";

/** Optional advanced workspace wrapper. Inline chat uses VisualMessageCard
 * directly and is the primary presentation path. */
export function VisualExplanationViewer({
  visual,
  render,
  onSemanticAction,
}: {
  visual: VisualMessage;
  render?: (source: string, id: string, title: string, description: string) => Promise<string>;
  onSemanticAction?: VisualSemanticActionHandler;
}) {
  return <VisualMessageCard visual={visual} mode="workspace" render={render} onSemanticAction={onSemanticAction} />;
}
