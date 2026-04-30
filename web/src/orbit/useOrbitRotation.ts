import { useEffect, useState } from "react";

const TICK_MS = 20;
const DEG_PER_TICK = 0.3;

export function useOrbitRotation({ paused }: { paused: boolean }) {
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setAngle((a) => (a + DEG_PER_TICK) % 360);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [paused]);

  return { angle };
}
