import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimFaceSignalWriter,
  getFaceSignalMode,
  resetFaceSignalForTests,
  sampleFaceSignalLevels,
  subscribeFaceSignalMode,
} from "./faceSignal.js";

afterEach(() => resetFaceSignalForTests());

describe("faceSignal", () => {
  it("notifies React consumers only when the mode actually changes", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeFaceSignalMode(changed);
    const writer = claimFaceSignalWriter("openai");
    writer.setMode("idle");
    writer.setMode("listening");
    writer.setMode("listening");
    writer.publishInput(0.7, 10);
    expect(getFaceSignalMode()).toBe("listening");
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("clamps input and expires it on the shared monotonic clock", () => {
    const writer = claimFaceSignalWriter("live");
    writer.publishInput(4, 1_000);
    expect(sampleFaceSignalLevels(1_250).input).toBe(1);
    expect(sampleFaceSignalLevels(1_251).input).toBe(0);
    expect(sampleFaceSignalLevels(999).input).toBe(0);
    writer.publishInput(Number.NaN, 2_000);
    expect(sampleFaceSignalLevels(2_000).input).toBe(0);
  });

  it("samples measured output but never fabricates synthetic output", () => {
    const writer = claimFaceSignalWriter("openai");
    writer.setOutputSource("measured", () => 1.7);
    expect(sampleFaceSignalLevels()).toMatchObject({ output: 1, outputSource: "measured" });
    writer.setOutputSource("synthetic");
    expect(sampleFaceSignalLevels()).toMatchObject({ output: 0, outputSource: "synthetic" });
    writer.setOutputSource("none");
    expect(sampleFaceSignalLevels()).toMatchObject({ output: 0, outputSource: "none" });
  });

  it("fails a throwing or non-finite measured sampler closed to zero", () => {
    const writer = claimFaceSignalWriter("openai");
    writer.setOutputSource("measured", () => { throw new Error("gone"); });
    expect(sampleFaceSignalLevels().output).toBe(0);
    writer.setOutputSource("measured", () => Number.POSITIVE_INFINITY);
    expect(sampleFaceSignalLevels().output).toBe(0);
  });

  it("ignores late writes, resets and releases from a superseded engine", () => {
    const oldWriter = claimFaceSignalWriter("old");
    oldWriter.setMode("speaking");
    const current = claimFaceSignalWriter("current");
    current.setMode("listening");
    current.publishInput(0.4, 100);

    oldWriter.setMode("thinking");
    oldWriter.publishInput(1, 100);
    oldWriter.setOutputSource("synthetic");
    oldWriter.reset();
    oldWriter.release();

    expect(getFaceSignalMode()).toBe("listening");
    expect(sampleFaceSignalLevels(100)).toEqual({ input: 0.4, output: 0, outputSource: "none" });
  });

  it("makes current reset and release idempotent and hard-zeroes the signal", () => {
    const writer = claimFaceSignalWriter("openai");
    writer.setMode("speaking");
    writer.publishInput(0.8, 10);
    writer.setOutputSource("measured", () => 0.6);
    writer.reset();
    expect(getFaceSignalMode()).toBe("idle");
    expect(sampleFaceSignalLevels(10)).toEqual({ input: 0, output: 0, outputSource: "none" });
    writer.release();
    writer.release();
    expect(getFaceSignalMode()).toBe("idle");
  });
});
