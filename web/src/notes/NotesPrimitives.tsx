import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Atmosphere } from "../design/metal/Atmosphere.js";

/** Notes-local presentation adapters. No folder/document state or writes live here. */
export function NotesShell({ children, title, grid = false, pane }: { children: ReactNode; title: string; grid?: boolean; pane?: string }) {
  return <section aria-label={title} data-pane={pane} className="ds-root ds-notes h-full overflow-y-auto bg-canvas text-ink">
    <Atmosphere kind="silk" />
    <div className="ds-notes-content"><header className="ds-notes-title"><p>YOUR PERSONAL LIBRARY</p><h1>A place for your thinking.</h1></header>
      <div className={grid ? "ds-notes-layout" : ""}>{children}</div>
    </div>
  </section>;
}
export function OpenPlane({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ds-notes-plane ${className}`}>{children}</div>;
}
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { size?: "sm" | "default" | "lg" | "icon"; variant?: "default" | "outline" | "ghost" | "secondary" | "destructive" }>(function NotesButton({ size: _size, variant = "default", className = "", type = "button", ...props }, ref) {
  return <button {...props} type={type} ref={ref} className={`ds-focus ds-notes-button ds-notes-button-${variant} ${className}`} />;
});
