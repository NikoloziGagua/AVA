import { MessagesSquare } from "lucide-react";
import type { RoomPosts } from "./room-posts.js";

/** Read-only note that AVA posted to the development room during this reply. */
export function RoomPostReceipt({ posts }: { posts: RoomPosts }) {
  return (
    <section
      data-testid="room-posts"
      aria-label="Posted to the dev room"
      className="grid min-w-0 gap-1 rounded-card bg-info-soft px-4 py-2.5 text-meta text-ink"
    >
      {posts.items.map((post) => (
        <div key={post.messageId} className="flex min-w-0 items-center gap-2">
          <MessagesSquare size={15} aria-hidden="true" className="shrink-0 text-info" />
          <span className="font-medium">Posted to the dev room</span>
          <span className="ml-auto shrink-0 font-ui-mono text-label text-ink-3">#{post.messageId}</span>
        </div>
      ))}
    </section>
  );
}
