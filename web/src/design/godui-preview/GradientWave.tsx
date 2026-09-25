import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

const DEFAULT_COLORS = ["#38bdf8", "#ffffff", "#38bdf8", "#ffffff", "#38bdf8", "#ffffff"];
const DEFAULT_FREQUENCY: [number, number] = [0.0001, 0.0009];
const DEFAULT_DEFORM = { incline: 0.5, noiseAmp: 250, noiseFlow: 5 };
type Deform = { incline?: number; offsetTop?: number; offsetBottom?: number; noiseFreq?: [number, number]; noiseAmp?: number; noiseSpeed?: number; noiseFlow?: number; noiseSeed?: number };

// Same simplex noise and vertex-deformed layered colour wave as Niko's MiniGl
// source. Explicit uniforms replace its dynamic class layer: props update values,
// all six supplied colours work, sizing uses the container, resources are freed.
const NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);
vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
float n_=1./7.;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);
vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;
vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}`;

export function GradientWave({ colors = DEFAULT_COLORS, isPlaying = true, className = "", shadowPower = 8, darkenTop = false, noiseSpeed = 0.00001, noiseFrequency = DEFAULT_FREQUENCY, deform = DEFAULT_DEFORM }: {
  colors?: string[]; isPlaying?: boolean; className?: string; shadowPower?: number; darkenTop?: boolean;
  noiseSpeed?: number; noiseFrequency?: [number, number]; deform?: Deform;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const configKey = JSON.stringify({ colors, shadowPower, darkenTop, noiseSpeed, noiseFrequency, deform });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true });
    if (!gl) return;
    const config = JSON.parse(configKey) as { colors: string[]; shadowPower: number; darkenTop: boolean; noiseSpeed: number; noiseFrequency: [number, number]; deform: Deform };
    const palette = config.colors.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6);
    while (palette.length < 2) palette.push("#ffffff");
    const d = { incline: 0, offsetTop: -0.5, offsetBottom: -0.5, noiseFreq: [3, 4], noiseAmp: 320, noiseSpeed: 10, noiseFlow: 3, noiseSeed: 5, ...config.deform };
    const shaders: WebGLShader[] = [];
    const buffers: WebGLBuffer[] = [];
    let program: WebGLProgram | null = null;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    let seen: IntersectionObserver | undefined;
    let visible = true;
    let disposed = false;
    const cleanup = () => {
      disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); seen?.disconnect();
      buffers.forEach(b => gl.deleteBuffer(b)); shaders.forEach(s => gl.deleteShader(s)); if (program) gl.deleteProgram(program);
    };
    try {
      const layers = palette.slice(1).map((_, i) => {
        const j = i + 1;
        return `float n${j}=smoothstep(.1,${(0.63 + .07 * j).toFixed(6)},snoise(vec3(noiseCoord.x*${(2 + j / palette.length).toFixed(6)}+time*${(6.5 + .3*j).toFixed(6)},noiseCoord.y*${(3 + j/palette.length).toFixed(6)},time*${(11 + .3*j).toFixed(6)}+${(5+10*j).toFixed(6)}))/2.+.5);v_color=mix(v_color,u_colors[${j}],pow(n${j},4.));`;
      }).join("\n");
      const vertex = `precision highp float;attribute vec2 uv;uniform vec2 u_resolution;uniform float u_time;uniform vec3 u_colors[${palette.length}];varying vec3 v_color;${NOISE}
void main(){vec2 uvNorm=uv*2.-1.;float time=u_time*${config.noiseSpeed};vec2 noiseCoord=u_resolution*uvNorm*vec2(${config.noiseFrequency.map(n=>n.toFixed(8)).join(",")});
float tilt=u_resolution.y/2.*uvNorm.y;float incline=u_resolution.x*uvNorm.x/2.*${Number(d.incline).toFixed(5)};float offset=u_resolution.x/2.*${Number(d.incline).toFixed(5)}*mix(${Number(d.offsetBottom).toFixed(5)},${Number(d.offsetTop).toFixed(5)},uv.y);
float noise=snoise(vec3(noiseCoord.x*${Number(d.noiseFreq[0]).toFixed(5)}+time*${Number(d.noiseFlow).toFixed(5)},noiseCoord.y*${Number(d.noiseFreq[1]).toFixed(5)},time*${Number(d.noiseSpeed).toFixed(5)}+${Number(d.noiseSeed).toFixed(5)}))*${Number(d.noiseAmp).toFixed(5)};
noise=max(0.,noise*(1.-pow(abs(uvNorm.y),2.)));vec2 pos=uvNorm*u_resolution*.5;pos.y+=tilt+incline+noise-offset;
v_color=u_colors[0];${layers}gl_Position=vec4(pos/u_resolution*2.,0.,1.);}`;
      const fragment = `precision highp float;varying vec3 v_color;uniform vec2 u_resolution;void main(){vec3 c=v_color;${config.darkenTop ? `vec2 st=gl_FragCoord.xy/u_resolution;c.g-=pow(max(0.,st.y+sin(-12.)*st.x),${config.shadowPower.toFixed(4)})*.4;` : ""}gl_FragColor=vec4(c,1.);}`;
      const compile = (type: number, source: string) => {
        const s = gl.createShader(type)!; shaders.push(s); gl.shaderSource(s, source); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("Gradient shader unavailable"); return s;
      };
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Gradient program unavailable");
      gl.useProgram(program);
      const xs = 64, ys = 48, points: number[] = [], indices: number[] = [];
      for (let y=0;y<=ys;y++) for (let x=0;x<=xs;x++) { points.push(x/xs,y/ys); if(x<xs&&y<ys){const i=y*(xs+1)+x;indices.push(i,i+xs+1,i+1,i+1,i+xs+1,i+xs+2);} }
      const vertices=gl.createBuffer()!, index=gl.createBuffer()!; buffers.push(vertices,index);
      gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.STATIC_DRAW);
      const location=gl.getAttribLocation(program,"uv"); gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
      palette.forEach((color,i)=>{const n=parseInt(color.slice(1),16);gl.uniform3f(gl.getUniformLocation(program!,`u_colors[${i}]`),((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255);});
      const time=gl.getUniformLocation(program,"u_time"), resolution=gl.getUniformLocation(program,"u_resolution");
      let elapsed=0, last=performance.now();
      const draw=()=>{gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform1f(time,elapsed);gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_SHORT,0);};
      const resize=()=>{const rect=canvas.getBoundingClientRect();canvas.width=Math.max(1,Math.round(rect.width));canvas.height=Math.max(1,Math.round(rect.height));gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(resolution,canvas.width,canvas.height);draw();};
      resize(); observer=new ResizeObserver(resize);observer.observe(canvas);
      seen=new IntersectionObserver(([entry])=>{visible=entry?.isIntersecting??true;});seen.observe(canvas);
      const tick=(now:number)=>{if(disposed)return;if(visible&&!document.hidden){elapsed+=Math.min(now-last,1000/15);draw();}last=now;frame=requestAnimationFrame(tick);};
      if(isPlaying&&!reduced) frame=requestAnimationFrame(tick);
      canvas.dataset.renderer="webgl-gradient-wave";
    } catch { cleanup(); canvas.dataset.renderer="static-fallback"; }
    return cleanup;
  }, [configKey, isPlaying, reduced]);
  return <canvas ref={canvasRef} className={`am-gradient ${className}`} aria-hidden="true" />;
}
