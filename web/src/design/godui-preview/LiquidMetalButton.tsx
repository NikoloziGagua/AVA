import { liquidMetalFragmentShader, ShaderMount } from "@paper-design/shaders";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { useReducedMotion } from "motion/react";

/** Niko's supplied shader, dimensions, uniforms and three-layer button.
 * Uses the installed Paper API's dispose(), with bounded timers and keyboard ripples. */
export function LiquidMetalButton({ label = "Get Started", onClick, viewMode = "text", children, className = "" }: {
  label?: string; onClick?: () => void; viewMode?: "text" | "icon"; children?: ReactNode; className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mount = useRef<ShaderMount | null>(null);
  const hovered = useRef(false);
  const timers = useRef<Set<number>>(new Set());
  const nextId = useRef(0);
  const [ripples, setRipples] = useState<Array<{ x: number; y: number; id: number }>>([]);
  const [ready, setReady] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let shader: ShaderMount | null = null;
    try {
      shader = new ShaderMount(el, liquidMetalFragmentShader, {
        u_repetition: 4, u_softness: 0.5, u_shiftRed: 0.3, u_shiftBlue: 0.3,
        u_distortion: 0, u_contour: 0, u_angle: 45, u_scale: 8, u_shape: 1,
        u_offsetX: 0.1, u_offsetY: -0.1, u_colorBack: [0, 0, 0, 0], u_colorTint: [1, 1, 1, 1],
        u_isImage: false, u_fit: 2, u_rotation: 0, u_originX: 0.5, u_originY: 0.5,
        u_worldWidth: 0, u_worldHeight: 0,
      }, undefined, reduced ? 0 : 0.6, 1000, 1, 100_000);
      mount.current = shader;
      setReady(true);
    } catch { setReady(false); }
    return () => {
      mount.current = null;
      shader?.dispose();
      el.replaceChildren();
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current.clear();
    };
  }, [reduced]);
  const later = (callback: () => void, ms: number) => {
    const timer = window.setTimeout(() => { timers.current.delete(timer); callback(); }, ms);
    timers.current.add(timer);
  };
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (!reduced) {
      mount.current?.setSpeed(2.4);
      later(() => mount.current?.setSpeed(hovered.current ? 1 : 0.6), 300);
      const box = event.currentTarget.getBoundingClientRect();
      const ripple = { id: nextId.current++, x: event.detail ? event.clientX - box.left : box.width / 2, y: event.detail ? event.clientY - box.top : box.height / 2 };
      setRipples(value => [...value, ripple]);
      later(() => setRipples(value => value.filter(item => item.id !== ripple.id)), 600);
    }
    onClick?.();
  };
  return <button type="button" className={`am-liquid ${viewMode === "icon" ? "am-liquid-icon" : ""} ${className}`} aria-label={label}
    data-shader={ready ? "paper-liquid-metal" : "static-fallback"} onClick={click}
    onPointerEnter={() => { hovered.current = true; if (!reduced) mount.current?.setSpeed(1); }}
    onPointerLeave={() => { hovered.current = false; if (!reduced) mount.current?.setSpeed(0.6); }}>
    <div ref={host} className="am-liquid-shader" aria-hidden="true" />
    <span className="am-liquid-inner" aria-hidden="true" />
    <span className="am-liquid-label">{children ?? (viewMode === "icon" ? <Sparkles size={16} /> : label)}</span>
    {ripples.map(ripple => <span key={ripple.id} className="am-liquid-ripple" style={{ left: ripple.x, top: ripple.y }} />)}
  </button>;
}
