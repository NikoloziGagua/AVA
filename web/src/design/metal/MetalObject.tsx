import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

/** The selected Atelier structures, bound by callers to authoritative data only.
 * No fake duration, progress ring, status, interaction or decorative serial number. */
export function MetalObject({ variant, title, eyebrow, value, detail, onClick, label, compact = false }: {
  variant: "cut" | "time" | "twin";
  title: string;
  eyebrow: string;
  value?: string;
  detail?: ReactNode;
  onClick?: () => void;
  label?: string;
  compact?: boolean;
}) {
  const content = <>
    <span className="ds-object-value">
      <span className="ds-object-eyebrow">{eyebrow}</span>
      {value && <strong>{value}</strong>}
    </span>
    <span className="ds-object-story">
      <span className="ds-object-title">{title}</span>
      {detail && <span className="ds-object-detail">{detail}</span>}
    </span>
    {onClick && <ArrowUpRight size={18} aria-hidden="true" className="ds-object-arrow" />}
  </>;
  const className = `ds-metal-object ds-object-${variant}${compact ? " ds-object-compact" : ""}${onClick ? " ds-focus" : ""}`;
  return onClick
    ? <button type="button" className={className} aria-label={label} onClick={onClick}>{content}</button>
    : <div className={className}>{content}</div>;
}
