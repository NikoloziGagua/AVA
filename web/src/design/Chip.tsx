import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn.js";

export type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  leading?: ReactNode;
};

/** A pill-shaped choice or suggestion. Toggle chips expose aria-pressed. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, leading, className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected === undefined ? undefined : selected}
      className={cn(
        "ds-focus inline-flex h-9 items-center gap-2 rounded-full px-4 font-ui text-meta font-medium",
        "transition-[transform,background-color,color] duration-150 ease-out-soft active:scale-[0.97]",
        selected ? "bg-solid text-on-solid shadow-e1" : "ds-glass text-ink shadow-e1 hover:bg-glass-strong",
        className,
      )}
      {...props}
    >
      {leading}
      {children}
    </button>
  );
});

/** A few next steps offered under a prompt. Picking one hands its text back. */
export function SuggestionChips({ suggestions, onPick, label = "Suggestions", className }: {
  suggestions: readonly string[];
  onPick: (suggestion: string) => void;
  label?: string;
  className?: string;
}) {
  if (!suggestions.length) return null;
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap justify-center gap-2", className)}>
      {suggestions.map((text) => <Chip key={text} onClick={() => onPick(text)}>{text}</Chip>)}
    </div>
  );
}
