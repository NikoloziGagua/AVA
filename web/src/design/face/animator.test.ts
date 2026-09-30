import { describe, expect, it } from "vitest";
import { breathCurve, FaceAnimator } from "./animator.js";

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Steps at 60 fps from t=0, calling `each` after every frame. */
function run(anim: FaceAnimator, seconds: number, each: (frame: number, t: number) => void = () => {}) {
  for (let frame = 1; frame <= Math.round(seconds * 60); frame++) {
    anim.step(frame / 60, 1 / 60);
    each(frame, frame / 60);
  }
}

describe("FaceAnimator calm profile (the default)", () => {
  it("behaves exactly as before the lively profile existed", () => {
    // Recorded from the original animator (commit before this change), same seed and steps.
    const expected: Record<number, number[]> = {
      30: [0, 0, 0.003592475, 0.001333913, 0, 0.1, 0.12],
      102: [-0.086679211, -0.082375012, 0.020855672, 0.00785587, 0, 0.1, 0.12],
      198: [0.119855931, 0.094878215, 0.03989048, 0.01585185, 0, 0.1, 0.12],
      354: [0.019879978, 0.028916278, 0.049195116, 0.052993047, 0, 0.247853642, 0.248052706],
      546: [-0.124303353, 0.080812653, 0.020148511, 0.022464898, 0, 0.100003743, 0.120002689],
      600: [-0.111819147, 0.010016756, 0.006811146, 0.019743472, 0, 0.100000034, 0.120000021],
    };
    const anim = new FaceAnimator(lcg(42));
    expect(anim.profile).toBe("calm");
    for (let frame = 1; frame <= 600; frame++) {
      anim.mode = frame > 300 && frame < 420 ? "listening" : "idle";
      anim.step(frame / 60, 1 / 60);
      expect(anim.state.breath).toBe(0);
      expect(anim.state.drift).toBe(0);
      const want = expected[frame];
      if (!want) continue;
      const s = anim.state;
      [s.gx, s.gy, s.yaw, s.pitch, s.blink, s.energy, s.smile].forEach((value, at) => expect(value).toBeCloseTo(want[at]!, 8));
    }
  });
});

describe("breathCurve", () => {
  it("breathes in faster than it breathes out, then rests", () => {
    expect(breathCurve(0)).toBe(0);
    expect(breathCurve(0.38)).toBeCloseTo(1, 6);
    expect(breathCurve(0.2)).toBeGreaterThan(breathCurve(0.1));
    expect(breathCurve(0.6)).toBeLessThan(breathCurve(0.45));
    expect(breathCurve(0.95)).toBe(0);
    expect(breathCurve(1.2)).toBeCloseTo(breathCurve(0.2), 9);
  });
});

describe("FaceAnimator lively profile", () => {
  it("breathes about every four to five seconds, within 0..1", () => {
    const anim = new FaceAnimator(lcg(7), { profile: "lively" });
    let peaks = 0, previous = 0, rising = false, min = Infinity, max = -Infinity;
    run(anim, 60, () => {
      const b = anim.state.breath;
      min = Math.min(min, b); max = Math.max(max, b);
      if (b > previous) rising = true;
      else if (rising && b < previous) { peaks += 1; rising = false; }
      previous = b;
    });
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max).toBeGreaterThan(0.95);
    expect(peaks).toBeGreaterThanOrEqual(12);
    expect(peaks).toBeLessThanOrEqual(16);
  });

  it("looks around with natural head turns and keeps coming back to look at you", () => {
    const anim = new FaceAnimator(lcg(11), { profile: "lively" });
    let maxYaw = 0, facingYou = 0, frames = 0;
    run(anim, 60, (frame) => {
      if (frame < 60) return;
      frames += 1;
      maxYaw = Math.max(maxYaw, Math.abs(anim.state.yaw));
      if (Math.abs(anim.state.gx) < 0.1 && Math.abs(anim.state.yaw) < 0.05) facingYou += 1;
    });
    expect(maxYaw).toBeGreaterThan(0.1);
    expect(maxYaw).toBeLessThanOrEqual(0.25);
    expect(facingYou / frames).toBeGreaterThan(0.25);
  });

  it("moves the eyes first and the head after them", () => {
    const anim = new FaceAnimator(lcg(3), { profile: "lively" });
    let checked = false;
    run(anim, 20, () => {
      if (checked || Math.abs(anim.state.gx) < 0.2) return;
      // The first time the eyes are well away, the head has only begun to turn.
      expect(Math.abs(anim.state.yaw)).toBeLessThan(0.06);
      checked = true;
    });
    expect(checked).toBe(true);
  });

  it("holds exactly still once reduced motion is on, even mid-breath", () => {
    const anim = new FaceAnimator(lcg(9), { profile: "lively" });
    run(anim, 5.6);
    expect(anim.state.breath).toBeGreaterThan(0.05);
    expect(anim.state.drift).toBeGreaterThan(0.5);
    anim.still = true;
    anim.step(5.7, 1 / 60);
    expect(anim.state.breath).toBe(0);
    expect(anim.state.drift).toBe(0);
    for (let i = 0; i < 120; i++) anim.step(6 + i / 60, 1 / 60);
    expect(anim.state.breath).toBe(0);
    expect(anim.state.drift).toBe(0);
  });

  it("draws a still frame with no breath and no drift, and never changes its mode", () => {
    const anim = new FaceAnimator(lcg(5), { profile: "lively" });
    anim.step(0, 0);
    expect(anim.state.breath).toBe(0);
    expect(anim.state.drift).toBe(0);
    anim.mode = "listening";
    run(anim, 10);
    expect(anim.mode).toBe("listening");
    expect(anim.state.drift).toBeGreaterThan(0.9);
  });
});
