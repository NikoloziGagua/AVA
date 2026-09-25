import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "./cn.js";

export type ButtonVariant = "solid" | "glass" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const BASE =
  "ds-focus relative inline-flex select-none items-center justify-center gap-2 overflow-hidden whitespace-nowrap font-ui font-medium " +
  "transition-[transform,background-color,color,opacity] duration-150 ease-out-soft active:scale-[0.97] " +
  "disabled:pointer-events-none disabled:opacity-45";

const VARIANT: Record<ButtonVariant, string> = {
  solid: "bg-solid text-on-solid shadow-e1 hover:opacity-90",
  glass: "ds-glass text-ink shadow-e1 hover:bg-glass-strong",
  quiet: "bg-transparent text-ink-2 hover:bg-glass hover:text-ink",
  danger: "bg-danger-soft text-danger hover:bg-danger hover:text-on-solid",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 rounded-control px-3 text-meta",
  md: "h-11 rounded-button px-4 text-body",
  lg: "h-12 rounded-button px-5 text-body-lg",
  icon: "h-11 w-11 rounded-full p-0",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the width, and marks the button busy. */
  loading?: boolean;
  /** A light sweep across the one main action on a screen (solid only). */
  shimmer?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "glass", size = "md", loading = false, shimmer = false, leading, trailing, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANT[variant], SIZE[size], className)}
      {...props}
    >
      {shimmer && variant === "solid" && <span aria-hidden="true" className="ds-shimmer" />}
      {loading ? <LoaderCircle aria-hidden="true" size={16} className="animate-spin" /> : leading}
      {children}
      {!loading && trailing}
    </button>
  );
});
