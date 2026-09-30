import type { VisualMessage } from "./types.js";
import { VisualMessageCard, type VisualSemanticActionHandler } from "./VisualMessageCard.js";

/** Optional advanced workspace wrapper. Inline chat uses VisualMessageCard
 * directly and is the primary presentation path. */
export function VisualExplanationViewer({
  visual,
  onSemanticAction,
}: {
  visual: VisualMessage;
  onSemanticAction?: VisualSemanticActionHandler;
}) {
  return <VisualMessageCard visual={visual} mode="workspace" onSemanticAction={onSemanticAction} />;
}
