import { useEffect, useState, type ReactNode } from "react";
import { CloudOff, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "./Button.js";
import { cn } from "./cn.js";

/** Nothing here yet: say what belongs here and offer the one action that fills it. */
export function EmptyState({ icon, title, body, action, className }: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid justify-items-center gap-3 px-6 py-12 text-center", className)}>
      {icon && <div aria-hidden="true" className="text-ink-3">{icon}</div>}
      <p className="text-body-lg text-ink">{title}</p>
      {body && <p className="max-w-[40ch] text-body text-ink-2">{body}</p>}
      {action}
    </div>
  );
}

/** A placeholder that holds the shape of content while it loads. */
export function Skeleton({ className, lines = 0 }: { className?: string; lines?: number }) {
  if (lines > 0) {
    return (
      <div role="status" aria-label="Loading" className={cn("grid gap-2", className)}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="ds-skeleton h-4 rounded-control" style={{ width: `${i === lines - 1 ? 60 : 100}%` }} />
        ))}
      </div>
    );
  }
  return <span role="status" aria-label="Loading" className={cn("ds-skeleton block rounded-card", className)} />;
}

/** Something failed: say what, and offer a retry when retrying can help. */
export function ErrorState({ title, body, onRetry, retrying, className }: {
  title: string;
  body?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("grid justify-items-center gap-3 rounded-card bg-danger-soft px-6 py-8 text-center", className)}>
      <TriangleAlert aria-hidden="true" size={22} className="text-danger" />
      <p className="text-body-lg text-ink">{title}</p>
      {body && <p className="max-w-[44ch] text-body text-ink-2">{body}</p>}
      {onRetry && <Button variant="glass" size="sm" loading={retrying} leading={<RotateCw size={14} aria-hidden="true" />} onClick={onRetry}>Try again</Button>}
    </div>
  );
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Appears only while the device is offline; AVA keeps working from its saved copy. */
export function OfflineBanner({ className }: { className?: string }) {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => {
    const update = () => setOnline(isOnline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  if (online) return null;
  return (
    <div role="status" className={cn("mx-auto flex w-fit items-center gap-2 rounded-full bg-warning-soft px-4 py-2 text-meta text-ink shadow-e1", className)}>
      <CloudOff aria-hidden="true" size={15} className="text-warning" />
      You're offline. Showing what AVA saved on this device.
    </div>
  );
}
