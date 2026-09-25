import { useRef, type KeyboardEvent } from "react";
import { cn } from "./cn.js";

export type SegmentedOption<T extends string> = { value: T; label: string };

/**
 * A small set of mutually exclusive views or settings, as a radio group with a
 * sliding thumb. Arrow keys, Home and End move the selection.
 */
export function Segmented<T extends string>({ options, value, onChange, label, className }: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  const move = (next: number) => {
    const wrapped = (next + options.length) % options.length;
    onChange(options[wrapped]!.value);
    refs.current[wrapped]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: options.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    move(keys[event.key]!);
  };

  return (
    <div role="radiogroup" aria-label={label} className={cn("relative grid auto-cols-fr grid-flow-col rounded-button bg-glass p-1", className)}>
      <span
        aria-hidden="true"
        className="absolute bottom-1 left-1 top-1 rounded-control bg-solid shadow-e1 transition-transform duration-240 ease-spring"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((option, at) => (
        <button
          key={option.value}
          ref={(node) => { refs.current[at] = node; }}
          type="button"
          role="radio"
          aria-checked={at === index}
          tabIndex={at === index ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={onKeyDown}
          className={cn(
            "ds-focus relative z-10 h-9 rounded-control px-3 font-ui text-meta font-medium transition-colors duration-150",
            at === index ? "text-on-solid" : "text-ink-2 hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
