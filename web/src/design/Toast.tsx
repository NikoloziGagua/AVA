import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./cn.js";

export type ToastInput = {
  message: string;
  tone?: "neutral" | "success" | "danger";
  /** Optional one-word action, e.g. "Undo". */
  action?: { label: string; onAction: () => void };
  /** Milliseconds before it disappears; errors stay until dismissed. */
  duration?: number;
};
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/** Short, honest confirmations above the bottom bar. At most three at once. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((item) => item.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setItems((all) => [...all, { ...toast, id }].slice(-3));
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="ds-root pointer-events-none fixed inset-x-0 z-[60] mx-auto grid w-full max-w-md gap-2 px-4"
        style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}
      >
        {items.map((item) => <ToastView key={item.id} item={item} onDismiss={() => dismiss(item.id)} />)}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const tone = item.tone ?? "neutral";
  useEffect(() => {
    if (tone === "danger" && item.duration === undefined) return;
    const timer = window.setTimeout(onDismiss, item.duration ?? 5000);
    return () => window.clearTimeout(timer);
  }, [item.duration, onDismiss, tone]);
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "ds-toast pointer-events-auto flex items-center gap-3 rounded-button bg-raised px-4 py-3 font-ui text-body text-ink shadow-e3",
        tone === "success" && "bg-success-soft",
        tone === "danger" && "bg-danger-soft",
      )}
    >
      <span className="min-w-0 flex-1">{item.message}</span>
      {item.action && (
        <button type="button" onClick={() => { item.action!.onAction(); onDismiss(); }} className="ds-focus rounded-control px-2 py-1 text-meta font-semibold text-ink hover:bg-glass">
          {item.action.label}
        </button>
      )}
      <button type="button" aria-label="Dismiss" onClick={onDismiss} className="ds-focus rounded-control p-1 text-ink-3 hover:bg-glass hover:text-ink">
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside ToastProvider");
  return show;
}
