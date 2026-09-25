import { Children, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn.js";

/**
 * Cards stacked on top of each other that fan out when opened, e.g. what's
 * coming up. Closed, only the first is readable and the rest peek behind it.
 */
export function FloatingStack({ label, children, defaultOpen = false, className }: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const items = Children.toArray(children);
  if (items.length <= 1) return <div className={className}>{items}</div>;
  return (
    <div className={cn("grid gap-2", className)}>
      <div className={cn("grid", open ? "gap-3" : "pb-6")}>
        {items.map((item, at) => (
          <div
            key={at}
            aria-hidden={!open && at > 0 ? true : undefined}
            inert={!open && at > 0 ? true : undefined}
            className={cn("transition-[transform,opacity] duration-400 ease-spring", !open && "[grid-area:1/1]")}
            style={!open ? { transform: `translateY(${Math.min(at, 2) * 12}px) scale(${1 - Math.min(at, 2) * 0.05})`, opacity: at > 2 ? 0 : 1 - at * 0.28, zIndex: items.length - at } : undefined}
          >
            {item}
          </div>
        ))}
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="ds-focus justify-self-center rounded-full px-3 py-1.5 text-meta text-ink-2 transition-colors hover:bg-glass hover:text-ink"
      >
        {open ? `Show less` : `Show all ${items.length} ${label}`}
      </button>
    </div>
  );
}

export type TileProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  title: string;
  meta?: string;
};

/** A large tappable square for a place to go, e.g. a notes folder. */
export function Tile({ icon, title, meta, className, type = "button", ...props }: TileProps) {
  return (
    <button
      type={type}
      className={cn(
        "ds-focus grid min-h-28 content-between gap-5 rounded-card bg-surface p-4 text-left shadow-e2",
        "transition-[transform,background-color] duration-240 ease-out-soft hover:-translate-y-0.5 hover:bg-surface-strong active:scale-[0.98]",
        className,
      )}
      {...props}
    >
      {icon && <span aria-hidden="true" className="text-ink-2">{icon}</span>}
      <span className="grid gap-1">
        <span className="text-body-lg text-ink">{title}</span>
        {meta && <span className="font-ui-mono text-label uppercase text-ink-3">{meta}</span>}
      </span>
    </button>
  );
}

export function TileGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4", className)}>{children}</div>;
}

/**
 * One item in a list, separated from its neighbours by space, not a line.
 * Pass onClick to make the whole row a button.
 */
export function Row({ leading, title, meta, trailing, onClick, className }: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      {leading && <span className="shrink-0 text-ink-2">{leading}</span>}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-body text-ink">{title}</span>
        {meta && <span className="truncate text-meta text-ink-2">{meta}</span>}
      </span>
      {trailing && <span className="shrink-0 text-ink-3">{trailing}</span>}
    </>
  );
  const classes = cn("flex w-full items-center gap-3 rounded-button px-3 py-3 text-left", className);
  return onClick
    ? <button type="button" onClick={onClick} className={cn("ds-focus transition-colors duration-150 hover:bg-glass", classes)}>{body}</button>
    : <div className={classes}>{body}</div>;
}
