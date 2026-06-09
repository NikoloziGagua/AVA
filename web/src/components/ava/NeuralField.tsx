import { useEffect, useRef, type CSSProperties } from "react";
import { useReducedMotion } from "../../lib/useReducedMotion.js";

export interface NeuralFieldProps {
  /** Output ceiling — kept low so it sits behind the panel bloom. */
  opacity?: number;
  /** Lead color (linear 0..1 rgb). Defaults to cyan #5cf2ff. */
  color?: [number, number, number];
  /** Pointer-reactive drift (calm; lerped inside the rAF). */
  reactive?: boolean;
  className?: string;
}

/**
 * Memory background: a raw-WebGL fbm "neuro" field tinted cyan/mercury, very low
 * opacity, behind the panel bloom. No three.js — one fullscreen triangle, one
 * fragment program, one draw call (~0.4–0.8ms/frame). DPR capped 1.25, sized to
 * the CONTAINER (not window).
 *
 * Lifecycle mirrors DottedSurface: reduced motion renders one static frame and
 * never schedules rAF; cleanup cancels rAF, loses the GL context, removes the
 * canvas, drops the pointer listener. `gl === null` → CSS radial-gradient haze so
 * Memory never loses its backdrop.
 */

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// fbm (3 octaves) neuro field, tinted by u_color with a mercury secondary mix.
const FRAG = `
precision mediump float;
uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_pointer;
uniform vec3  u_color;
uniform vec3  u_color2;
uniform float u_opacity;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p){
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 3; i++){ v += amp * noise(p); p *= 2.0; amp *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  vec2 drift = (u_pointer - 0.5) * 0.35;
  float t = u_time * 0.05;
  float n = fbm(p * 2.2 + drift + vec2(t, -t * 0.7));
  float n2 = fbm(p * 4.0 - drift + vec2(-t * 0.5, t));
  float field = smoothstep(0.35, 0.85, n) * 0.7 + n2 * 0.3;
  vec3 col = mix(u_color2, u_color, field);
  float a = field * u_opacity;
  gl_FragColor = vec4(col * a, a); // premultiplied
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function NeuralField({
  opacity = 0.25,
  color = [0.36, 0.95, 1.0],
  reactive = true,
  className,
}: NeuralFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";

    const gl = (canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true }) ||
      canvas.getContext("experimental-webgl", { premultipliedAlpha: true, alpha: true })) as
      | WebGLRenderingContext
      | null;

    // Fallback: no WebGL → a static CSS cyan haze so Memory keeps a backdrop.
    if (!gl) {
      const haze = document.createElement("div");
      haze.style.position = "absolute";
      haze.style.inset = "0";
      haze.style.pointerEvents = "none";
      haze.style.opacity = String(opacity * 0.8);
      haze.style.background =
        "radial-gradient(ellipse 70% 60% at 50% 35%, rgba(92,242,255,0.5), transparent 70%)";
      container.appendChild(haze);
      return () => {
        if (haze.parentElement === container) container.removeChild(haze);
      };
    }

    container.appendChild(canvas);

    const vert = compile(gl, gl.VERTEX_SHADER, VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vert || !frag || !program) {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      if (canvas.parentElement === container) container.removeChild(canvas);
      return;
    }
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    gl.useProgram(program);

    // Fullscreen triangle (covers the clip space, no index buffer).
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uPointer = gl.getUniformLocation(program, "u_pointer");
    const uColor = gl.getUniformLocation(program, "u_color");
    const uColor2 = gl.getUniformLocation(program, "u_color2");
    const uOpacity = gl.getUniformLocation(program, "u_opacity");

    gl.uniform3f(uColor, color[0], color[1], color[2]);
    gl.uniform3f(uColor2, 0.624, 0.776, 0.831); // mercury #9fc6d4
    gl.uniform1f(uOpacity, opacity);

    // Non-null aliases so the closures below keep the narrowing (TS widens `gl`
    // / `container` back to nullable inside nested functions otherwise).
    const glx = gl;
    const el = container;

    const DPR = Math.min(1.25, window.devicePixelRatio || 1);
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * DPR));
      canvas.height = Math.max(1, Math.floor(h * DPR));
      glx.viewport(0, 0, canvas.width, canvas.height);
      glx.uniform2f(uRes, canvas.width, canvas.height);
    };
    resize();

    // Pointer target (0..1); lerped toward inside the rAF, not per-event.
    const target = { x: 0.5, y: 0.5 };
    const cur = { x: 0.5, y: 0.5 };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      target.x = (e.clientX - r.left) / Math.max(1, r.width);
      target.y = 1 - (e.clientY - r.top) / Math.max(1, r.height);
    };
    if (reactive) window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", resize);

    let frameId = 0;
    const start = performance.now();
    const draw = (now: number) => {
      cur.x += (target.x - cur.x) * 0.04;
      cur.y += (target.y - cur.y) * 0.04;
      glx.uniform1f(uTime, (now - start) / 1000);
      glx.uniform2f(uPointer, cur.x, cur.y);
      glx.drawArrays(glx.TRIANGLES, 0, 3);
      frameId = requestAnimationFrame(draw);
    };

    if (reduced) {
      glx.uniform1f(uTime, 0);
      glx.uniform2f(uPointer, 0.5, 0.5);
      glx.drawArrays(glx.TRIANGLES, 0, 3);
    } else {
      frameId = requestAnimationFrame(draw);
    }

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      if (reactive) window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", resize);
      glx.deleteBuffer(buf);
      glx.deleteProgram(program);
      glx.deleteShader(vert);
      glx.deleteShader(frag);
      glx.getExtension("WEBGL_lose_context")?.loseContext();
      if (canvas.parentElement === el) el.removeChild(canvas);
    };
  }, [reduced, opacity, color, reactive]);

  // position:FIXED (not absolute) so the field tracks the VIEWPORT, not the
  // scroller's full content box. Inside PanelShell's `overflow-y-auto` scroll
  // root an absolute inset-0 would size the WebGL canvas to the entire
  // scrollable content height (2–3× the viewport once Observations/Projects
  // expand) and scroll away — an oversized fragment shader re-rendered every
  // rAF. Fixed caps the canvas at screen size and pins it behind the bloom.
  const style: CSSProperties = { position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" };
  return <div ref={containerRef} className={className} style={style} aria-hidden="true" />;
}
