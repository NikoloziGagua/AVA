import type { ReactNode } from "react";
import { cn } from "./cn.js";

/**
 * The frame every new screen sits in: the look's canvas, the UI font, safe
 * areas, and room at the bottom for the bottom bar. Static background only.
 */
export function AppFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("ds-root min-h-dvh bg-canvas font-ui text-ink antialiased", className)}
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      {children}
    </div>
  );
}

/** One screen's content column. Bottom padding keeps content clear of the bottom bar. */
export function Page({ children, width = "normal", className }: {
  children: ReactNode;
  width?: "narrow" | "normal" | "wide";
  className?: string;
}) {
  const max = width === "narrow" ? "max-w-xl" : width === "wide" ? "max-w-6xl" : "max-w-3xl";
  return (
    <main className={cn("mx-auto grid w-full gap-8 px-4 pt-6 sm:px-6", max, className)} style={{ paddingBottom: "calc(120px + env(safe-area-inset-bottom, 0px))" }}>
      {children}
    </main>
  );
}

export function PageHeader({ title, subtitle, actions, className }: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="grid gap-1">
        <h1 className="text-title text-ink">{title}</h1>
        {subtitle && <p className="text-body text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A group of related content with a small label above it. */
export function Section({ label, aside, children, className }: {
  label?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-3", className)}>
      {(label || aside) && (
        <div className="flex items-center justify-between gap-3 px-1">
          {label && <h2 className="font-ui-mono text-label uppercase text-ink-3">{label}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
