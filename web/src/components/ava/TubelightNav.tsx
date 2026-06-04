import { useEffect, useState, type ComponentType } from "react";
import { motion } from "motion/react";
import { resolveActiveIndex } from "./tubelight-nav.js";

export interface TubelightItem {
  name: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  onSelect: () => void;
}

export interface TubelightNavProps {
  items: TubelightItem[];
  /** Name of the item to highlight; defaults to the first. */
  activeName?: string;
  className?: string;
}

/**
 * Glass pill navigation with a cyan "lamp" that springs to the active item
 * (motion `layoutId`). Adapted from the user's NavBar component: the items fire
 * Ava's view switch (`onSelect`) rather than routing. Icon always shows; label
 * appears on wider screens.
 */
export function TubelightNav({ items, activeName, className }: TubelightNavProps) {
  const [active, setActive] = useState(() => resolveActiveIndex(items, activeName));
  useEffect(() => {
    setActive(resolveActiveIndex(items, activeName));
  }, [activeName, items]);

  return (
    <div className={`glass flex items-center gap-1 rounded-full p-1 ${className ?? ""}`}>
      {items.map((item, i) => {
        const Icon = item.icon;
        const isActive = i === active;
        return (
          <button
            key={item.name}
            type="button"
            aria-label={item.name}
            aria-current={isActive ? "page" : undefined}
            onClick={() => {
              setActive(i);
              item.onSelect();
            }}
            className="relative cursor-pointer rounded-full px-4 py-2 text-[13px] font-semibold text-white/70 transition-colors hover:text-white flex items-center gap-2"
          >
            <Icon size={16} className="relative z-10" />
            <span className="relative z-10 hidden sm:inline">{item.name}</span>
            {isActive && (
              <motion.div
                layoutId="ava-lamp"
                className="absolute inset-0 rounded-full"
                style={{ background: "rgba(92,242,255,0.10)", zIndex: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 30 }}
              >
                {/* the "tubelight" bar + glows above the active item */}
                <div
                  className="absolute -top-1.5 left-1/2 h-1 w-8 -translate-x-1/2 rounded-b-full"
                  style={{ background: "var(--ac)" }}
                >
                  <div className="absolute -left-2 -top-2 h-5 w-12 rounded-full blur-md" style={{ background: "rgba(92,242,255,0.3)" }} />
                  <div className="absolute -top-1 h-5 w-8 rounded-full blur-md" style={{ background: "rgba(92,242,255,0.3)" }} />
                  <div className="absolute left-2 top-0 h-4 w-4 rounded-full blur-sm" style={{ background: "rgba(92,242,255,0.3)" }} />
                </div>
              </motion.div>
            )}
          </button>
        );
      })}
    </div>
  );
}
