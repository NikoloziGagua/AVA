/** Point shaders for the face (ui-remodel v2 §5): one program, glow (Ink) or engraving (Paper). */

export const VERTEX_SHADER = `
precision highp float;
attribute vec3 aPos; attribute float aBright; attribute float aRand; attribute float aBlink;
attribute float aJaw; attribute float aLip; attribute float aIris; attribute float aBrow;
attribute vec2 aSmile; attribute float aHead; attribute float aFade;
uniform float uTime, uBlink, uOpen, uSmile, uBrow, uAspect, uPx, uThink, uEnergy, uGain, uStipple, uBreath, uDrift;
uniform vec2 uGaze; uniform vec3 uHead; uniform vec2 uPointer;
varying float vA; varying float vLight;
mat2 rot(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }
void main() {
  vec3 p = aPos; float t = uTime;
  p.y += aBlink * uBlink;
  p.y -= aJaw * uOpen * 0.085;
  p.y += aLip * uOpen * 0.014;
  p.xy += aSmile * uSmile;
  p.y += aBrow * uBrow * 0.032;
  p.xy += aIris * uGaze * vec2(0.022, 0.014);
  float loose = 1.0 + uThink * 2.0 * (1.0 - aHead * 0.6) + uDrift * 1.2;
  p.x += 0.0035 * sin(t * 1.7 + aRand * 40.0) * loose;
  p.y += 0.0035 * cos(t * 1.5 + aRand * 31.0) * loose;
  p.y += 0.006 * sin(t * 1.1);
  // A breath lifts the shoulders and chest a little, the head a little less.
  float body = 1.0 - aHead;
  p.y += uBreath * (0.010 * body + 0.004 * aHead);
  p.x *= 1.0 + uBreath * 0.008 * body;
  vec3 pivot = vec3(0.0, -0.45, -0.35);
  vec3 q = p - pivot;
  q.xz = rot(-uHead.x) * q.xz;
  q.yz = rot(uHead.y) * q.yz;
  q.xy = rot(uHead.z) * q.xy;
  q += pivot;
  p = mix(p, q, aHead);
  float persp = 1.0 / (2.3 - p.z);
  vec2 s = p.xy * persp * 2.2;
  s.x /= uAspect;
  gl_Position = vec4(s, 0.0, 1.0);
  gl_PointSize = uPx * mix(0.85 + aBright * 1.3, 0.38 + aBright * aBright * 1.5, uStipple) * persp * 2.3;
  vec2 dv = (s - uPointer) * vec2(uAspect, 1.0);
  vLight = exp(-dot(dv, dv) / 0.1);
  vA = mix(aBright * (0.62 + uEnergy * 0.35), 0.45 + 0.55 * aBright, uStipple) * aFade * uGain;
}`;

export const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uColor; uniform vec3 uGlow; uniform float uLightAmt; uniform float uHard;
varying float vA; varying float vLight;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float m = smoothstep(0.5, mix(0.05, 0.34, uHard), d);
  vec3 col = mix(uColor, uGlow, vLight * uLightAmt);
  gl_FragColor = vec4(col, m * clamp(vA + vLight * uLightAmt * 0.35, 0.0, 1.0));
}`;

export const ATTRIBUTES: ReadonlyArray<readonly [name: string, size: number, offset: number]> = [
  ["aPos", 3, 0], ["aBright", 1, 3], ["aRand", 1, 4], ["aBlink", 1, 5], ["aJaw", 1, 6], ["aLip", 1, 7],
  ["aIris", 1, 8], ["aBrow", 1, 9], ["aSmile", 2, 10], ["aHead", 1, 12], ["aFade", 1, 13],
];

export const UNIFORMS = [
  "uTime", "uBlink", "uOpen", "uSmile", "uBrow", "uAspect", "uPx", "uThink", "uEnergy", "uGain", "uStipple",
  "uGaze", "uHead", "uPointer", "uColor", "uGlow", "uLightAmt", "uHard", "uBreath", "uDrift",
] as const;
