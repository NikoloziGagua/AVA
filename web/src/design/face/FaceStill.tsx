import { useEffect, useRef, useState } from "react";
import { cn } from "../cn.js";
import { sharedFaceAsset, type FaceAsset } from "./asset.js";
import { faceColours } from "./colors.js";
import { useDocumentLook } from "./useDocumentLook.js";

/**
 * A still picture of AVA's face drawn from the same dots on a 2D canvas: the
 * tiny face in the bottom bar, and the fallback wherever WebGL is unavailable.
 * It never opens a WebGL context (contract ui-remodel v2 §5).
 */
export function FaceStill({ size, className, label }: { size: number; className?: string; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const look = useDocumentLook();
  const [asset, setAsset] = useState<FaceAsset | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    sharedFaceAsset().then((loaded) => { if (alive) setAsset(loaded); }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!asset || !canvas) return;
    const g = canvas.getContext("2d");
    if (!g) { setFailed(true); return; }
    const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;
    g.clearRect(0, 0, px, px);
    const ink = look === "ink";
    const set = ink ? asset.glow : asset.stipple;
    const n = Math.min(set.count, Math.max(1500, Math.round(px * px * 1.2)));
    // Keep the crop's aspect ratio inside the square canvas.
    const aspect = asset.crop.halfX / asset.crop.halfY;
    const w = aspect >= 1 ? px : px * aspect, h = aspect >= 1 ? px / aspect : px;
    const ox = (px - w) / 2, oy = (px - h) / 2;
    const dot = Math.max(0.6, px / 90);
    g.fillStyle = faceColours(canvas).dotCss;
    for (let i = 0; i < n; i++) {
      const tone = set.tone(i);
      g.globalAlpha = ink ? tone * 0.9 : 0.25 + 0.7 * (1 - tone);
      g.fillRect(ox + set.u(i) * w, oy + set.v(i) * h, dot, dot);
    }
    g.globalAlpha = 1;
  }, [asset, look, size]);

  if (failed) {
    return <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("ds-orb block rounded-full", className)} style={{ width: size, height: size }} />;
  }
  return (
    <canvas
      ref={canvasRef}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("block rounded-full", className)}
      style={{ width: size, height: size }}
    />
  );
}
