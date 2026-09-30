import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../motion.js";
import { sharedFaceAsset } from "../face/asset.js";
import { FaceAnimator, type FaceMode } from "../face/animator.js";
import { buildPoints } from "../face/model.js";
import { FaceRenderer } from "../face/renderer.js";
import { claimFaceSlot } from "../face/FaceStage.js";
import { FaceStill } from "../face/FaceStill.js";

/** Opt-in lively preview: same portrait, explicit still mode, no voice changes. */
export function LivingFace({mode, label}: {mode:FaceMode; label:string}) {
  const canvas=useRef<HTMLCanvasElement>(null), modeRef=useRef(mode);
  modeRef.current=mode;
  const reduced=useReducedMotion();
  const redraw=useRef<(()=>void)|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    if(failed)return;
    const release=claimFaceSlot();
    if(!release){setFailed(true);return;}
    let alive=true, frame=0, renderer:FaceRenderer|undefined;
    let resize:ResizeObserver|undefined, seen:IntersectionObserver|undefined;
    let visible=true;
    const anim=new FaceAnimator(Math.random,{profile:"lively"}), el=canvas.current!;
    anim.still=reduced;
    const move=(e:PointerEvent)=>{const r=el.getBoundingClientRect();anim.pointer=[(e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2];};
    const leave=()=>{anim.pointer=null;};
    const lost=(e:Event)=>{e.preventDefault();setFailed(true);};
    el.addEventListener("webglcontextlost",lost);
    if(!reduced){el.addEventListener("pointermove",move);el.addEventListener("pointerleave",leave);}
    void sharedFaceAsset().then(asset=>{
      if(!alive)return;
      renderer=new FaceRenderer(el);
      renderer.setPoints(buildPoints(asset,"glow",window.innerWidth<600?26_000:asset.glow.count),"ink");
      renderer.setPresence(1.12);
      renderer.resize();
      let last=performance.now(), elapsed=0;
      const draw=(dt:number)=>{
        anim.mode=modeRef.current;anim.step(elapsed,dt);
        renderer!.draw(reduced?0:elapsed,anim);
      };
      draw(0);
      redraw.current=()=>{if(reduced)draw(0);};
      resize=new ResizeObserver(()=>{renderer?.resize();if(reduced)draw(0);});resize.observe(el);
      seen=new IntersectionObserver(([entry])=>{visible=entry?.isIntersecting??false;});seen.observe(el);
      const tick=(now:number)=>{const dt=Math.min(.05,(now-last)/1000);last=now;if(visible&&!document.hidden){elapsed+=dt;draw(dt);}frame=requestAnimationFrame(tick);};
      if(!reduced)frame=requestAnimationFrame(tick);
    }).catch(()=>{if(alive)setFailed(true);});
    return()=>{alive=false;redraw.current=null;cancelAnimationFrame(frame);resize?.disconnect();seen?.disconnect();el.removeEventListener("pointermove",move);el.removeEventListener("pointerleave",leave);el.removeEventListener("webglcontextlost",lost);renderer?.dispose();release();};
  },[reduced,failed]);
  useEffect(()=>{redraw.current?.();},[mode]);
  return failed?<FaceStill size={520} label={label}/>:<canvas ref={canvas} data-face="live" data-motion={reduced?"still":"expressive"} role="img" aria-label={label} className="am-living-face"/>;
}
