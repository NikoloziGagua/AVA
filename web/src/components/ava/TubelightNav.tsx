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
    <div className={`glass flex items-center gap-0.5 rounded-full p-1 sm:gap-1 ${className ?? ""}`}>
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
            className="relative flex cursor-pointer items-center gap-2 rounded-full px-2 py-2 text-[13px] font-semibold text-white/70 transition-colors hover:text-white sm:px-4"
          >
            <Icon size={16} className="relative z-10" />
            <span className="relative z-10 hidden sm:inline">{item.name}</span>
            {isActive && (
              <motion.div
                layoutId="ava-lamp"
                className="absolute inset-0 rounded-full"
                style={{ background: "rgba(92,242,255,0.10)", zIndex: 0, willChange: "transform" }}
                transition={{ type: "spring", stiffness: 320, damping: 30 }}
              >
                {/* The "tubelight" bar above the active item. Its bloom is drawn
                    with box-shadow (a cached compositor layer) rather than
                    blur()-filtered glow divs, so the moving lamp never re-rasters
                    a blurred subtree as it springs between items. */}
                <div
                  className="absolute -top-1.5 left-1/2 h-1 w-8 -translate-x-1/2 rounded-b-full"
                  style={{
                    background: "var(--ac)",
                    boxShadow:
                      "0 0 10px 2px rgba(92,242,255,0.55)," +
                      "0 -2px 12px 2px rgba(92,242,255,0.45)," +
                      "0 6px 18px 1px rgba(92,242,255,0.30)",
                  }}
                />
              </motion.div>
            )}
          </button>
        );
      })}
    </div>
  );
}
