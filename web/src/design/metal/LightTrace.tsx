import { useRef, type CSSProperties, type KeyboardEvent } from "react";

/** Navigation only. Selection comes from App; moving keyboard focus never navigates. */
export function LightTrace({ items, current, onNavigate }: {
  items: readonly { id: string; label: string }[];
  current: string | null;
  onNavigate: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const index = items.findIndex((item) => item.id === current);
  const move = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    if (!buttons.length) return;
    event.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (at + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  if (!items.length) return null;
  return <div ref={ref} role="group" aria-label="Quick navigation" className="ds-light-trace" onKeyDown={move}
    style={{ "--trace-count": items.length, "--trace-index": Math.max(0, index) } as CSSProperties}>
    {items.map((item) => <button key={item.id} type="button" className="ds-focus"
      aria-current={item.id === current ? "page" : undefined} onClick={() => onNavigate(item.id)}>{item.label}</button>)}
    <span aria-hidden="true" className="ds-light-trace-mark" hidden={index < 0} />
  </div>;
}
