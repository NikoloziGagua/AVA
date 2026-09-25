import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { AudioLines, ChevronDown, Home, Layers, Mic, MicOff, Plus, Send, Sparkles, X } from "lucide-react";
import { MotionConfig } from "motion/react";
import { WarpStarfield } from "./vendor/warp-starfield/warp-starfield.js";
import { DynamicIsland } from "./vendor/dynamic-island/dynamic-island.js";
import { LiquidMetalButton } from "./LiquidMetalButton.js";
import { ReferenceCatalog } from "./ReferenceCatalog.js";
import type { FaceMode } from "../face/animator.js";
import "./godui-preview.css";

const FaceStage = lazy(async () => ({ default: (await import("./LivingFace.js")).LivingFace }));
type View = "home" | "voice" | "components";
const states: FaceMode[] = ["idle", "listening", "thinking", "speaking"];
const stateText: Record<FaceMode,string> = {idle:"Here with you",listening:"I'm listening",thinking:"Connecting the dots",speaking:"Let's work through it"};

export function GodUiPreview() {
  const [view,setView]=useState<View>("home"), [face,setFace]=useState<FaceMode>("idle");
  const [warp,setWarp]=useState(false), [expanded,setExpanded]=useState(false);
  const [draft,setDraft]=useState(""), [answer,setAnswer]=useState("");
  const scrollRef=useRef<HTMLDivElement>(null), inputRef=useRef<HTMLTextAreaElement>(null), triggerRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{const root=document.documentElement, previous=root.dataset.look;root.dataset.look="ink";return()=>{if(previous)root.dataset.look=previous;else delete root.dataset.look;};},[]);
  useEffect(()=>{if(expanded)inputRef.current?.focus();},[expanded,view]);
  const navigate=(next:View)=>{setView(next);setFace(next==="voice"?"listening":"idle");scrollRef.current?.scrollTo({top:0,behavior:"instant"});};
  const closeComposer=()=>{setExpanded(false);requestAnimationFrame(()=>triggerRef.current?.focus());};
  const submit=(event:FormEvent)=>{event.preventDefault();if(!draft.trim())return;setAnswer(draft.trim());setDraft("");setExpanded(false);setFace("speaking");};
  return <MotionConfig reducedMotion="user"><div ref={scrollRef} className={`gdu-root am-root am-view-${view}`} data-testid="godui-preview">
    <div className="am-atmosphere" aria-hidden="true"><WarpStarfield color="#c6d5ea" speed={warp?1.6:.72} warp={warp} starCount={1000} depth={1.8} parallax={22}/></div>
    <header className="am-header"><button className="am-wordmark" onClick={()=>navigate("home")} aria-label="AVA preview home"><span className="am-logo">A</span><span>AVA</span></button><nav aria-label="Preview destinations">{([{id:"home",label:"Home",icon:Home},{id:"voice",label:"Voice",icon:AudioLines},{id:"components",label:"Components",icon:Layers}] as const).map(({id,label,icon:Icon})=><button key={id} aria-current={view===id?"page":undefined} onClick={()=>navigate(id)}><Icon size={15}/><span>{label}</span></button>)}</nav><span className="am-preview-label">DESIGN PREVIEW</span></header>
    {view!=="components"?<main className="am-main">
      <div className="am-topline"><span/><button className="am-star-toggle" aria-pressed={warp} onClick={()=>setWarp(value=>!value)}><Sparkles size={13}/>{warp?"Hyperspace":"Gentle motion"}</button></div>
      <div className="am-presence"><DynamicIsland size={face==="thinking"?"default":"compact"} presenceKey={face}><span className={`am-status-dot am-status-${face}`}/><span className="am-status-text" role="status">{stateText[face]}</span></DynamicIsland></div>
      <section className="am-stage" aria-label="AVA presence">
        <div className="am-face-halo" aria-hidden="true"/>
        <div className="am-face" data-state={face}><Suspense fallback={<div className="am-face-loading" role="status">AVA</div>}><FaceStage mode={face} label={`AVA ${face} preview`}/></Suspense></div>
        <div className="am-face-reflection" aria-hidden="true"/>
        <div className="am-intro"><h1>{view==="home"?"Good to see you, Niko.":stateText[face]+"."}</h1></div>
      </section>
      {view==="home"?<div className="am-home-actions"><LiquidMetalButton label="Talk to AVA" onClick={()=>navigate("voice")}><Mic size={15}/>Talk to AVA</LiquidMetalButton></div>:<div className="am-voice-controls"><LiquidMetalButton label={face==="idle"?"Resume listening":"Pause listening"} viewMode="icon" onClick={()=>setFace(value=>value==="idle"?"listening":"idle")}>{face==="idle"?<MicOff size={18}/>:<Mic size={18}/>}</LiquidMetalButton><button className="am-control" onClick={()=>setExpanded(true)}>Type exact wording</button><LiquidMetalButton label="Leave voice" viewMode="icon" onClick={()=>navigate("home")}><X size={18}/></LiquidMetalButton></div>}
      {view==="voice"&&<details className="am-state-options"><summary>Preview states</summary><div className="am-voice-states" role="group" aria-label="Preview voice states">{states.map(state=><button key={state} aria-pressed={face===state} onClick={()=>setFace(state)}>{state}</button>)}</div></details>}
      {answer&&<aside className="am-local-reply" aria-label="Preview conversation"><span>YOUR THOUGHT</span><p>{answer}</p><small>Preview only · this stays in this page.</small><button onClick={()=>{setAnswer("");setFace("idle");}} aria-label="Dismiss preview thought"><X size={15}/></button></aside>}
    </main>:<ReferenceCatalog scrollRef={scrollRef}/>}
    {view!=="components"&&<div className={`am-composer-wrap ${expanded?"is-expanded":""}`}>
      {expanded?<form className="am-composer" onSubmit={submit}><div className="am-composer-heading"><Sparkles size={15}/><span>A thought, a question, a place to start.</span><button type="button" aria-label="Collapse composer" onClick={closeComposer}><ChevronDown size={18}/></button></div><textarea ref={inputRef} value={draft} onChange={event=>setDraft(event.target.value)} aria-label="Ask AVA anything" placeholder="Ask AVA anything…" onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();closeComposer();}else if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}}}/><div className="am-composer-footer"><span>Shift + Enter for a new line</span><button type="submit" aria-label="Submit preview thought" disabled={!draft.trim()}><Send size={17}/></button></div></form>:<div className="am-compact-composer"><button ref={triggerRef} onClick={()=>setExpanded(true)} aria-expanded="false" aria-label="Expand Ask AVA"><Plus size={17}/><span>{draft||"Ask AVA anything…"}</span></button><button aria-label="Open voice preview" onClick={()=>navigate("voice")}><AudioLines size={20}/></button></div>}
    </div>}
  </div></MotionConfig>;
}
