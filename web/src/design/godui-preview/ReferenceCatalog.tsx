import { useEffect, useRef, useState, type RefObject } from "react";
import { Activity, Folder, FolderOpen, Globe2, Home, Layers, Pencil, Share, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { WarpStarfield } from "./vendor/warp-starfield/warp-starfield.js";
import { BeamDraw } from "./vendor/beam-draw/beam-draw.js";
import { ScrollTimeline } from "./vendor/scroll-timeline/scroll-timeline.js";
import { AnimatedBeam } from "./vendor/animated-beam/animated-beam.js";
import { AgentFlow } from "./vendor/agent-flow/agent-flow.js";
import { ElasticText } from "./vendor/elastic-text/elastic-text.js";
import { TiltCard } from "./vendor/tilt-card/tilt-card.js";
import { Stepper } from "./vendor/stepper/stepper.js";
import { SplitFlapDisplay } from "./vendor/split-flap-display/split-flap-display.js";
import { ProgressiveCardReveal } from "./vendor/progressive-card-reveal/progressive-card-reveal.js";
import { ImageAccordion } from "./vendor/image-accordion/image-accordion.js";
import { CoverFlow } from "./vendor/cover-flow/cover-flow.js";
import { CardSwap } from "./vendor/card-swap/card-swap.js";
import { BentoGrid, BentoCard } from "./vendor/bento-grid/bento-grid.js";
import { DynamicIsland, type DynamicIslandSize } from "./vendor/dynamic-island/dynamic-island.js";
import { Breadcrumbs } from "./vendor/breadcrumbs/breadcrumbs.js";
import { JellyButton } from "./vendor/jelly-button/jelly-button.js";
import { GooeyFab } from "./vendor/gooey-fab/gooey-fab.js";
import { LiquidMetalButton } from "./LiquidMetalButton.js";
import { GradientWave } from "./GradientWave.js";

export const REFERENCES = ["LiquidMetalButton", "GradientWave", "WarpStarfield", "BeamDraw", "ScrollTimeline", "AnimatedBeam", "AnimatedBeam · dotted pipeline", "AgentFlow", "ElasticText", "TiltCard", "Stepper", "SplitFlapDisplay", "ProgressiveCardReveal", "ImageAccordion", "CoverFlow", "CardSwap", "BentoGrid + BentoCard", "DynamicIsland", "Breadcrumbs", "JellyButton", "GooeyFab"] as const;
export const CLOCK = ["012", "0123456789", ":", "012345", "0123456789", ":", "012345", "0123456789"];
export function FlapClock() {
  const [time, setTime] = useState("");
  useEffect(() => { const tick=()=>setTime(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Dublin",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date()));tick();const id=window.setInterval(tick,1000);return()=>clearInterval(id); },[]);
  return <SplitFlapDisplay value={time} align="center" size="sm" charset={CLOCK} />;
}
function Beams({ dotted }: { dotted: boolean }) {
  const containerRef=useRef<HTMLDivElement>(null), clientRef=useRef<HTMLDivElement>(null), edgeRef=useRef<HTMLDivElement>(null), computeRef=useRef<HTMLDivElement>(null), dbRef=useRef<HTMLDivElement>(null);
  return <div ref={containerRef} className="am-beams">
    <div ref={clientRef} className="am-node">{dotted?"Client":"Source"}</div>
    <div ref={edgeRef} className="am-node">{dotted?"Edge":"Core"}</div>
    {dotted&&<><div ref={computeRef} className="am-node">Compute</div><div ref={dbRef} className="am-node">Database</div></>}
    <AnimatedBeam containerRef={containerRef} fromRef={clientRef} toRef={edgeRef} pathDashArray={dotted?"0.1 8":undefined} duration={4} delay={0}/>
    {dotted&&<><AnimatedBeam containerRef={containerRef} fromRef={edgeRef} toRef={computeRef} pathDashArray="0.1 8" duration={4} delay={.6}/><AnimatedBeam containerRef={containerRef} fromRef={computeRef} toRef={dbRef} pathDashArray="0.1 8" duration={4} delay={1.2}/></>}
  </div>;
}
const nodes=[{id:"trigger",label:"Trigger",sublabel:"user message",x:90,y:170},{id:"planner",label:"Planner",sublabel:"opus-4.8",x:320,y:170},{id:"search",label:"Search tool",sublabel:"web",x:560,y:80},{id:"code",label:"Code tool",sublabel:"sandbox",x:560,y:260},{id:"synth",label:"Synthesize",sublabel:"opus-4.8",x:800,y:170},{id:"answer",label:"Answer",x:1020,y:170}];
const edges=[{id:"e1",from:"trigger",to:"planner"},{id:"e2",from:"planner",to:"search",curvature:40},{id:"e3",from:"planner",to:"code",curvature:-40},{id:"e4",from:"search",to:"synth",curvature:-40},{id:"e5",from:"code",to:"synth",curvature:40},{id:"e6",from:"synth",to:"answer"}];
const legs=[{icon:"✈️",label:"Flight",meta:"~3 hours",distance:"2,400 miles",time:"~3 hours"},{icon:"",label:"Train",meta:"~12 hours",distance:"1,100 miles",time:"~12 hours"},{icon:"",label:"Driving",meta:"~18 hours",distance:"332 miles",time:"~2 hours"},{icon:"",label:"Cycling",meta:"~2 days",distance:"60 miles",time:"~2 days"},{icon:"",label:"Walking",meta:"~40 minutes",distance:"2 miles",time:"~40 minutes"}];
// The supplied /photos/*.jpg files were not attached. Use local original vector
// landscapes for those slots, retaining the exact accordion implementation.
function landscape(color: string, index: number) {return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 700"><defs><linearGradient id="g" x2=".8" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#070a10"/></linearGradient></defs><path fill="url(#g)" d="M0 0h500v700H0z"/><circle cx="340" cy="180" r="85" fill="#ffffff" opacity=".22"/><path d="M-50 610 170 ${200+index*30} 300 400 410 290 560 700H0" fill="#171f29"/><path d="M-50 670 160 420 250 520 450 390 560 700H0" fill="#0a1119"/></svg>`)}`;}
const panels=[{title:"Mountains",description:"Alpine ridges at first light."},{title:"Rivers",description:"Glacial water carving the valley."},{title:"Waterfalls",description:"A 60-metre drop into the basin."},{title:"Forests",description:"Old growth as far as you can see."}].map((p,i)=>({...p,image:landscape(["#adb8ce","#58a5b0","#598397","#728b66"][i]!,i)}));
const features=[{title:"Realtime sync",body:"Every change lands instantly across every device."},{title:"Built-in analytics",body:"Understand usage without wiring up a single event."},{title:"Edge delivery",body:"Served from the closest region, every request."}];

export function ReferenceCatalog({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const [selected,setSelected]=useState(0);
  const [active,setActive]=useState(1),[leg,setLeg]=useState(4),[size,setSize]=useState<DynamicIslandSize>("default");
  const [feedback,setFeedback]=useState("Try a component. Demo text is sample content.");
  const [playing,setPlaying]=useState(true);
  const steps=[{label:"Plan"},{label:"Build"},{label:"Review"}];
  const demo=()=>{switch(selected){
    case 0:return <div className="am-demo-row"><LiquidMetalButton label="Get Started" onClick={()=>setFeedback("Metal button clicked")}/><LiquidMetalButton label="Sparkles" viewMode="icon" onClick={()=>setFeedback("Icon button clicked")}/></div>;
    case 1:return <><div className="am-wave-demo"><GradientWave isPlaying={playing}/></div><button className="am-control" onClick={()=>setPlaying(p=>!p)}>{playing?"Pause wave":"Play wave"}</button></>;
    case 2:return <div className="relative h-[320px] w-full overflow-hidden rounded-xl border border-border bg-background"><WarpStarfield warp speed={1.6}/></div>;
    case 3:return <div className="am-beam-draw"><BeamDraw container={scrollRef} preserveAspectRatio="none" className="absolute inset-0 size-full"/><span className="am-node" style={{left:0,top:"50%"}}>API Core</span>{["Database","Auth","Payments","Analytics"].map((name,i)=><span key={name} className="am-node" style={{right:0,top:["10%","37.5%","62.5%","90%"][i]}}>{name}</span>)}</div>;
    case 4:return <ScrollTimeline container={scrollRef} data={[{date:"2021",title:"The first commit",content:<p>A single component.</p>},{date:"2023",title:"Ten thousand stars",content:<p>The community took over.</p>},{date:"2025",title:"One hundred components",content:<p>Every surface, polished.</p>}]}/>;
    case 5:case 6:return <Beams dotted={selected===6}/>;
    case 7:return <AgentFlow nodes={nodes} edges={edges} autoPlay className="h-[400px] w-full"/>;
    case 8:return <ElasticText className="text-4xl font-sans">Design for Humans</ElasticText>;
    case 9:return <TiltCard className="w-72 p-6"><h3 className="text-lg font-semibold text-foreground">Designed in 3D</h3><p className="mt-2 text-sm text-muted-foreground">Move your pointer across the card — it tilts toward you with parallax depth and a glare that tracks the cursor.</p></TiltCard>;
    case 10:return <div className="am-step-demo"><Stepper steps={steps} active={active}/><div className="am-demo-row"><button className="am-control" onClick={()=>setActive(s=>Math.max(0,s-1))}>Back</button><button className="am-control" onClick={()=>setActive(s=>Math.min(steps.length,s+1))}>Next</button></div></div>;
    case 11:return <FlapClock/>;
    case 12:return <ProgressiveCardReveal activeIndex={leg} onActiveChange={setLeg} className="w-[360px] max-w-full">{legs.map(item=><ProgressiveCardReveal.Card key={item.label}><ProgressiveCardReveal.CardCollapsed><div className="flex items-center justify-between gap-4"><span className="flex items-center gap-2 font-medium"><span aria-hidden>{item.icon}</span>{item.label}</span><span className="text-sm text-muted-foreground">{item.meta}</span></div></ProgressiveCardReveal.CardCollapsed><ProgressiveCardReveal.CardExpanded><div className="flex flex-col gap-4"><span className="flex items-center gap-2 font-medium">{item.icon}{item.label}</span><div className="flex items-end justify-between gap-6"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Distance</p><p className="text-3xl font-semibold">{item.distance}</p></div><div className="text-right"><p className="text-xs uppercase tracking-wide text-muted-foreground">Time</p><p className="text-3xl font-semibold">{item.time}</p></div></div></div></ProgressiveCardReveal.CardExpanded></ProgressiveCardReveal.Card>)}</ProgressiveCardReveal>;
    case 13:return <><ImageAccordion panels={panels} height="24rem"/><p className="am-footnote">Your photo files were not supplied; these four image slots use local illustrated landscapes.</p></>;
    case 14:return <CoverFlow defaultIndex={2} onChange={i=>setFeedback(`Cover ${i+1} selected`)}>{[ ["Nightfall","Aurora Grey"],["Golden Hour","Marlowe"],["Deep Field","Vesper"] ].map(([title,artist],i)=><div key={title} className="am-album" style={{backgroundImage:`url("${landscape(["#525e8c","#bba070","#647b87"][i]!,i)}")`}}><strong>{title}</strong><span>{artist}</span></div>)}</CoverFlow>;
    case 15:return <CardSwap className="h-64 w-80 max-w-full">{features.map(f=><div key={f.title} className="flex h-full w-full flex-col justify-end rounded-2xl border border-border bg-card p-7 shadow-xl"><h3 className="text-xl font-semibold text-foreground">{f.title}</h3><p className="mt-2 text-sm text-muted-foreground">{f.body}</p></div>)}</CardSwap>;
    case 16:return <BentoGrid className="max-w-4xl"><BentoCard colSpan={2} icon={<Sparkles/>} title="Interfaces that feel alive" description="Spring-driven motion and pixel-tuned details, ready to drop in."/><BentoCard rowSpan={2} icon={<Activity/>} title="Realtime analytics" description="Every interaction streamed and charted as it happens."/><BentoCard icon={<ShieldCheck/>} title="Enterprise-grade" description="SOC 2 Type II, SSO, and audit logs out of the box."/><BentoCard icon={<Globe2/>} title="120ms p95 globally" description="Served from 35 edge regions, close to every user."/></BentoGrid>;
    case 17:return <div className="am-island-demo"><DynamicIsland size={size} presenceKey={size}><span>{size==="large"?"Now Playing · Nightfall":"AVA is here"}</span></DynamicIsland><button className="am-control" onClick={()=>setSize(s=>s==="large"?"default":"large")}>{size==="large"?"Collapse":"Now Playing"}</button></div>;
    case 18:return <Breadcrumbs items={[{label:"Home",href:"#",icon:<Home size={14}/>},{label:"Workspace",href:"#",icon:<Layers size={14}/>},{label:"Settings",href:"#",icon:<Folder size={14}/>},{label:"Billing",icon:<FolderOpen size={14}/>}]} />;
    case 19:return <JellyButton variant="primary" onClick={()=>setFeedback("Jelly button clicked")}>Get started</JellyButton>;
    case 20:return <div className="am-fab-demo"><GooeyFab actions={[{label:"Edit",icon:<Pencil/>,onClick:()=>setFeedback("Edit selected")},{label:"Share",icon:<Share/>,onClick:()=>setFeedback("Share selected (local preview)")},{label:"Delete",icon:<Trash2/>,onClick:()=>setFeedback("Delete selected (local preview)")}]} /></div>;
  }};
  return <section className="am-catalog" aria-label="All supplied components"><div className="am-catalog-heading"><span>THE COMPLETE COLLECTION</span><h1>Every reference. In motion.</h1><p>21 demonstrations from your snippets. Select one to explore its full interaction.</p></div><div className="am-catalog-layout"><nav className="am-catalog-list" aria-label="Component references">{REFERENCES.map((name,i)=><button key={name} aria-current={selected===i?"true":undefined} onClick={()=>{setSelected(i);setFeedback("Try a component. Demo text is sample content.");}}><span>{String(i+1).padStart(2,"0")}</span>{name}</button>)}</nav><div className="am-reference"><h2>{REFERENCES[selected]}</h2><div className="am-reference-stage" key={selected}>{demo()}</div><p className="am-footnote" role="status">{feedback}</p></div></div></section>;
}
