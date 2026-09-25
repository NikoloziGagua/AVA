import type { Look } from "../look.js";
import type { FaceAnimator } from "./animator.js";
import { faceColours } from "./colors.js";
import { FLOATS, type BuiltPoints } from "./model.js";
import { ATTRIBUTES, FRAGMENT_SHADER, UNIFORMS, VERTEX_SHADER } from "./shaders.js";

export class FaceRendererError extends Error {}

/** Owns the one WebGL context for the face. Created and disposed by FaceStage. */
export class FaceRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly buffer: WebGLBuffer;
  private readonly u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly attrs: Array<[location: number, size: number, offset: number]>;
  private count = 0;
  private look: Look = "ink";
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: false, powerPreference: "low-power" });
    if (!gl) throw new FaceRendererError("WebGL is unavailable.");
    this.gl = gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new FaceRendererError("Could not create a shader.");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new FaceRendererError(gl.getShaderInfoLog(shader) ?? "Shader failed.");
      return shader;
    };
    const program = gl.createProgram();
    if (!program) throw new FaceRendererError("Could not create a program.");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new FaceRendererError(gl.getProgramInfoLog(program) ?? "Program failed.");
    gl.useProgram(program);
    this.program = program;
    const buffer = gl.createBuffer();
    if (!buffer) throw new FaceRendererError("Could not create a buffer.");
    this.buffer = buffer;
    this.u = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)])) as FaceRenderer["u"];
    this.attrs = ATTRIBUTES.map(([name, size, offset]) => [gl.getAttribLocation(program, name), size, offset] as [number, number, number])
      .filter(([location]) => location >= 0);
    this.attrs.forEach(([location]) => gl.enableVertexAttribArray(location));
    gl.enable(gl.BLEND);
  }

  /** Uploads one point set and switches the look's blending and colours. */
  setPoints(points: BuiltPoints, look: Look): void {
    const gl = this.gl;
    this.look = look;
    this.count = points.count;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, points.data, gl.STATIC_DRAW);
    this.attrs.forEach(([location, size, offset]) => gl.vertexAttribPointer(location, size, gl.FLOAT, false, FLOATS * 4, offset * 4));
    const colours = faceColours(this.canvas);
    const ink = look === "ink";
    gl.blendFunc(gl.SRC_ALPHA, ink ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform3f(this.u.uColor, ...colours.dot);
    gl.uniform3f(this.u.uGlow, ...colours.light);
    gl.uniform1f(this.u.uLightAmt, ink ? 0.8 : 0.4);
    gl.uniform1f(this.u.uGain, ink ? 1.35 : 1);
    gl.uniform1f(this.u.uStipple, ink ? 0 : 1);
    gl.uniform1f(this.u.uHard, ink ? 0 : 1);
  }

  resize(): void {
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.gl.viewport(0, 0, w, h);
  }

  draw(t: number, anim: FaceAnimator): void {
    const gl = this.gl, s = anim.state, u = this.u;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.count) return;
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uBlink, s.blink);
    gl.uniform1f(u.uOpen, Math.max(0, s.open));
    gl.uniform1f(u.uSmile, s.smile);
    gl.uniform1f(u.uBrow, s.brow);
    gl.uniform1f(u.uThink, Math.max(0, s.think));
    gl.uniform1f(u.uEnergy, Math.max(0, s.energy));
    gl.uniform2f(u.uGaze, s.gx, s.gy);
    gl.uniform3f(u.uHead, s.yaw, s.pitch, s.roll);
    const light = anim.pointer ?? [0.45, 0.35];
    gl.uniform2f(u.uPointer, light[0], light[1]);
    gl.uniform1f(u.uAspect, this.canvas.width / this.canvas.height);
    gl.uniform1f(u.uPx, this.dpr * (this.look === "ink" ? 1.35 : 1.1));
    gl.drawArrays(gl.POINTS, 0, this.count);
  }

  /**
   * Frees this renderer's buffer and program. The canvas keeps its context so a
   * remount (or React's development double-mount) can draw again immediately;
   * the context itself goes when the canvas leaves the page.
   */
  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.buffer);
    gl.deleteProgram(this.program);
  }
}
