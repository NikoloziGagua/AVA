import { afterEach, describe, expect, it, vi } from "vitest";
import { FaceAnimator } from "./animator.js";
import { FaceRenderer, FaceRendererError } from "./renderer.js";

vi.mock("./colors.js", () => ({ faceColours: () => ({ dot: [1, 1, 1], light: [1, 1, 1] }) }));

/** A WebGL stand-in that records what was created and released. */
function fakeGl(options: { compiles?: boolean[]; links?: boolean; buffer?: boolean; loseExtension?: boolean } = {}) {
  const compiles = [...(options.compiles ?? [true, true])];
  const calls = { deleteShader: [] as unknown[], detachShader: [] as unknown[], deleteProgram: [] as unknown[], uniforms: {} as Record<string, number>, lost: 0 };
  let shaders = 0;
  const known: Record<string, unknown> = {
    createShader: () => ({ shader: ++shaders }),
    createProgram: () => ({ program: 1 }),
    createBuffer: () => (options.buffer === false ? null : { buffer: 1 }),
    getShaderParameter: () => compiles.shift() ?? true,
    getProgramParameter: () => options.links ?? true,
    getShaderInfoLog: () => "compile failed",
    getProgramInfoLog: () => "link failed",
    getAttribLocation: () => -1,
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    uniform1f: (location: { name: string } | null, value: number) => { if (location) calls.uniforms[location.name] = value; },
    deleteShader: (shader: unknown) => calls.deleteShader.push(shader),
    detachShader: (_program: unknown, shader: unknown) => calls.detachShader.push(shader),
    deleteProgram: (program: unknown) => calls.deleteProgram.push(program),
    getExtension: (name: string) => (name === "WEBGL_lose_context" && options.loseExtension !== false ? { loseContext: () => { calls.lost += 1; } } : null),
  };
  const gl = new Proxy(known, { get: (target, name: string) => (name in target ? target[name] : () => null) });
  const canvas = { getContext: () => gl } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("FaceRenderer shader lifetime", () => {
  it("releases both shaders once the program links, and keeps the program", () => {
    const { canvas, calls } = fakeGl();
    new FaceRenderer(canvas);
    expect(calls.detachShader).toEqual([{ shader: 1 }, { shader: 2 }]);
    expect(calls.deleteShader).toEqual([{ shader: 1 }, { shader: 2 }]);
    expect(calls.deleteProgram).toEqual([]);
  });

  it("releases the shaders and the program when linking fails", () => {
    const { canvas, calls } = fakeGl({ links: false });
    expect(() => new FaceRenderer(canvas)).toThrow(FaceRendererError);
    expect(calls.deleteShader).toEqual([{ shader: 1 }, { shader: 2 }]);
    expect(calls.detachShader).toEqual([]);
    expect(calls.deleteProgram).toEqual([{ program: 1 }]);
  });

  it("releases the linked program when no buffer can be made", () => {
    const { canvas, calls } = fakeGl({ buffer: false });
    expect(() => new FaceRenderer(canvas)).toThrow("Could not create a buffer.");
    expect(calls.deleteShader).toEqual([{ shader: 1 }, { shader: 2 }]);
    expect(calls.deleteProgram).toEqual([{ program: 1 }]);
  });

  it("releases the shader that was made when the second one fails to compile", () => {
    const { canvas, calls } = fakeGl({ compiles: [true, false] });
    expect(() => new FaceRenderer(canvas)).toThrow("compile failed");
    expect(calls.deleteShader).toEqual([{ shader: 1 }, { shader: 2 }]);
    expect(calls.deleteProgram).toEqual([{ program: 1 }]);
  });
});

describe("FaceRenderer presence, breath and drift", () => {
  const points = { count: 1, data: new Float32Array(14) } as never;

  it("makes her dots more solid on request, within 0.8-1.4 of the look's gain", () => {
    const { canvas, calls } = fakeGl();
    const renderer = new FaceRenderer(canvas);
    renderer.setPoints(points, "ink");
    expect(calls.uniforms.uGain).toBeCloseTo(1.35, 6);
    renderer.setPresence(1.12);
    expect(calls.uniforms.uGain).toBeCloseTo(1.35 * 1.12, 6);
    renderer.setPresence(5);
    expect(calls.uniforms.uGain).toBeCloseTo(1.35 * 1.4, 6);
    renderer.setPresence(Number.NaN);
    expect(calls.uniforms.uGain).toBeCloseTo(1.35, 6);
    renderer.setPresence(1.2);
    renderer.setPoints(points, "paper");
    expect(calls.uniforms.uGain).toBeCloseTo(1.2, 6);
  });

  it("passes the lively breath and drift to the shader, and zero for the calm face", () => {
    const { canvas, calls } = fakeGl();
    const renderer = new FaceRenderer(canvas);
    renderer.setPoints(points, "ink");
    const calm = new FaceAnimator(() => 0.5);
    for (let i = 1; i <= 120; i++) calm.step(i / 60, 1 / 60);
    renderer.draw(2, calm);
    expect(calls.uniforms.uBreath).toBe(0);
    expect(calls.uniforms.uDrift).toBe(0);
    const lively = new FaceAnimator(() => 0.5, { profile: "lively" });
    for (let i = 1; i <= 90; i++) lively.step(i / 60, 1 / 60);
    renderer.draw(1.5, lively);
    expect(calls.uniforms.uBreath).toBeCloseTo(lively.state.breath, 9);
    expect(calls.uniforms.uBreath).toBeGreaterThan(0);
    expect(calls.uniforms.uDrift).toBeCloseTo(lively.state.drift, 9);
  });
});

describe("FaceRenderer context release", () => {
  it("gives the context back once, and only when asked", () => {
    const { canvas, calls } = fakeGl();
    const renderer = new FaceRenderer(canvas);
    renderer.dispose();
    expect(calls.lost).toBe(0);
    renderer.release();
    expect(calls.lost).toBe(1);
  });

  it("does nothing when the browser has no lose-context extension", () => {
    const { canvas, calls } = fakeGl({ loseExtension: false });
    const renderer = new FaceRenderer(canvas);
    renderer.dispose();
    expect(() => renderer.release()).not.toThrow();
    expect(calls.lost).toBe(0);
  });
});
