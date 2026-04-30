import * as React from "react";

export interface NodePos {
  x: number;
  y: number;
  angle: number;
  zIndex: number;
  opacity: number;
}

export function computeNodePosition({
  index,
  total,
  radius,
  rotationDeg,
}: {
  index: number;
  total: number;
  radius: number;
  rotationDeg: number;
}): NodePos {
  const angleDeg = ((index / total) * 360 + rotationDeg) % 360;
  const rad = (angleDeg * Math.PI) / 180;
  const x = radius * Math.cos(rad);
  const y = radius * Math.sin(rad);
  const zIndex = Math.round(100 + 50 * Math.cos(rad));
  const opacity = Math.max(0.4, Math.min(1, 0.4 + 0.6 * ((1 + Math.sin(rad)) / 2)));
  return { x, y, angle: angleDeg, zIndex, opacity };
}

export interface OrbitRingProps {
  radius: number;
  rotationDeg: number;
  borderClassName?: string;
  children: React.ReactNode;
}

export function OrbitRing({ radius, borderClassName, children }: OrbitRingProps) {
  return (
    <div
      className={
        "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full " +
        (borderClassName ?? "border border-white/10")
      }
      style={{ width: radius * 2, height: radius * 2 }}
    >
      {children}
    </div>
  );
}
