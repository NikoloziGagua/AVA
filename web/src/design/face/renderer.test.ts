import { afterEach, describe, expect, it, vi } from "vitest";
import { FaceRenderer, FaceRendererError } from "./renderer.js";

/** A WebGL stand-in that records what was created and released. */
function fakeGl(options: { compiles?: boolean[]; links?: boolean; buffer?: boolean } = {}) {
  const compiles = [...(options.compiles ?? [true, true])];
  const calls = { deleteShader: [] as unknown[], detachShader: [] as unknown[], deleteProgram: [] as unknown[] };
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
    deleteShader: (shader: unknown) => calls.deleteShader.push(shader),
    detachShader: (_program: unknown, shader: unknown) => calls.detachShader.push(shader),
    deleteProgram: (program: unknown) => calls.deleteProgram.push(program),
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
