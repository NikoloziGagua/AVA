import { useEffect, useState } from "react";
import { DEFAULT_TIME_ZONE } from "../calendar/api.js";
import { StatusIsland } from "../design/index.js";
import { LazyFace } from "../design/face/LazyFace.js";
import { Atmosphere } from "../design/metal/Atmosphere.js";
import { LazyStarfield } from "../design/metal/LazyStarfield.js";

function greeting(now: Date, timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
  const part = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}, Niko.`;
}

function clock(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(at);
}

/**
 * Home: AVA's face, a greeting and the bottom bar, nothing else (Niko,
 * 2026-09-27: no "one thing" card and no starting points).
 */
export function HomeScreen({ timeZone = DEFAULT_TIME_ZONE }: {
  onStartChat?: (text: string) => void;
  onOpenNote?: (noteId: string) => void;
  onOpenCalendar?: () => void;
  onOpenReminders?: () => void;
  timeZone?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="ds-root ds-atelier-home absolute inset-0 bg-canvas font-ui text-ink">
      <Atmosphere kind="nocturne" still />
      <LazyStarfield />
      <main className="ds-home-composition relative mx-auto grid w-full max-w-xl grid-cols-[minmax(0,1fr)] justify-items-center gap-3 px-4 text-center">
        <StatusIsland mode="idle" time={clock(now, timeZone)} />
        <div className="ds-home-face ds-backlight relative w-full">
          <LazyFace label="AVA" className="relative" />
        </div>
        <h1 className="text-title md:text-display">{greeting(new Date(now), timeZone)}</h1>
      </main>
    </div>
  );
}
