import { MessagesSquare } from "lucide-react";
import type { RoomPosts } from "./room-posts.js";

/** Read-only note that AVA posted to the development room during this reply. */
export function RoomPostReceipt({ posts }: { posts: RoomPosts }) {
  return (
    <section
      data-testid="room-posts"
      aria-label="Posted to the dev room"
      className="mt-1 min-w-0 rounded-xl border border-sky-300/20 bg-sky-300/[0.05] px-3 py-2 text-[11px] text-sky-50/80"
    >
      {posts.items.map((post) => (
        <div key={post.messageId} className="flex min-w-0 items-center gap-2">
          <MessagesSquare size={13} aria-hidden="true" className="shrink-0" />
          <span className="font-medium tracking-wide">Posted to the dev room</span>
          <span className="ml-auto shrink-0 text-white/45">#{post.messageId}</span>
        </div>
      ))}
    </section>
  );
}
