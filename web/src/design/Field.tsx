import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn.js";

const CONTROL =
  "ds-focus w-full rounded-button bg-glass px-4 font-ui text-body text-ink shadow-e1 outline-none " +
  "placeholder:text-ink-3 transition-colors duration-150 hover:bg-glass-strong disabled:opacity-45 " +
  "aria-[invalid=true]:bg-danger-soft";

/** Label, optional hint and error around one control, wired for screen readers. */
export function Field({ label, hint, error, children, className }: {
  label: string;
  hint?: string;
  error?: string | null;
  /** Receives the ids the control must use. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  // The hint is replaced by the error, so only what is on screen is announced.
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-2", className)}>
      <label htmlFor={id} className="text-meta font-medium text-ink-2">{label}</label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && <p id={hintId} className="text-meta text-ink-3">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-meta text-danger">{error}</p>}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...props }, ref) {
  return <input ref={ref} className={cn(CONTROL, "h-11", className)} {...props} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, rows = 4, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(CONTROL, "min-h-24 resize-y py-3 leading-relaxed", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return <select ref={ref} className={cn(CONTROL, "h-11 appearance-none bg-raised pr-10", className)} {...props}>{children}</select>;
});

/** An on/off setting. The label is the setting's name; the state is announced by role=switch. */
export function Switch({ checked, onChange, label, disabled, className }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "ds-focus relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 disabled:opacity-45",
        checked ? "bg-solid" : "bg-glass-strong shadow-e1",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-6 w-6 rounded-full shadow-e1 transition-transform duration-240 ease-spring",
          checked ? "translate-x-5 bg-on-solid" : "translate-x-0 bg-raised",
        )}
      />
    </button>
  );
}
