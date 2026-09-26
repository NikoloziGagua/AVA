import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, CalendarDays, Lightbulb, Mic, Plus, Sparkles } from "lucide-react";
import { LiquidMetalButton } from "./LiquidMetalButton.js";
import { FlapClock } from "./ReferenceCatalog.js";
import { DynamicIsland } from "./vendor/dynamic-island/dynamic-island.js";
import { ElasticText } from "./vendor/elastic-text/elastic-text.js";
import { ProgressiveCardReveal } from "./vendor/progressive-card-reveal/progressive-card-reveal.js";
import { ScrollTimeline } from "./vendor/scroll-timeline/scroll-timeline.js";
import { TiltCard } from "./vendor/tilt-card/tilt-card.js";
import { Breadcrumbs } from "./vendor/breadcrumbs/breadcrumbs.js";
import { CoverFlow } from "./vendor/cover-flow/cover-flow.js";
import { CardSwap } from "./vendor/card-swap/card-swap.js";
import { BentoGrid, BentoCard } from "./vendor/bento-grid/bento-grid.js";
import { AgentFlow } from "./vendor/agent-flow/agent-flow.js";
import { AnimatedBeam } from "./vendor/animated-beam/animated-beam.js";
import { ImageAccordion } from "./vendor/image-accordion/image-accordion.js";
import { Stepper } from "./vendor/stepper/stepper.js";
import { JellyButton } from "./vendor/jelly-button/jelly-button.js";
import { GooeyFab } from "./vendor/gooey-fab/gooey-fab.js";
import { GradientWave } from "./GradientWave.js";
import { WarpStarfield } from "./vendor/warp-starfield/warp-starfield.js";
import type { DemoRoute } from "./demo-model.js";
import type { FaceMode } from "../face/animator.js";

const Face = lazy(async () => ({default:(await import("./LivingFace.js")).LivingFace}));
export const STUDIES = [
  {id:"home",name:"Home",parts:"Living face · ElasticText · DynamicIsland · real liquid metal",why:"A presence, not a dashboard. The one thing for today is inside the status island.",route:"home"},
  {id:"voice",name:"Voice",parts:"Living face · status island · one metal hero",why:"Your conversation takes the stage. State controls here are animation samples, not a microphone.",route:"voice"},
  {id:"today",name:"Today",parts:"Split-flap clock · ScrollTimeline · progressive reveal",why:"Let time have a little character. Open only the detail you need.",route:"today"},
  {id:"chat",name:"Talk",parts:"Quiet text · AgentFlow on demand",why:"Read the answer first. Reveal an illustrative sequence of steps only when you ask.",route:"chat"},
  {id:"chats",name:"Conversations",parts:"Day groups · pinned cards",why:"Pinned conversations feel close; the rest remain quick to scan.",route:"chats"},
  {id:"notes",name:"Notes",parts:"Breadcrumbs · TiltCard · contextual capture",why:"Folders, files, then the page. A little depth on pinned files, no motion across the reading surface.",route:"notes"},
  {id:"calendar",name:"Calendar",parts:"Day timeline · progressive event details",why:"The calendar grid stays structural; selected-day detail becomes a readable timeline.",route:"calendar"},
  {id:"ideas",name:"Ideas",parts:"CoverFlow / CardSwap / list · JellyButton",why:"Ideas can be playful to browse without losing the fast list alternative.",route:"ideas"},
  {id:"memory",name:"Memory",parts:"Selected relationship · AnimatedBeam",why:"Show where a memory came from. These are illustrative links; live links must come from actual evidence.",route:"memory"},
  {id:"watches",name:"Reminders & watches",parts:"ProgressiveCardReveal",why:"Keep the next reminder visible and receipt details one tap away. No pretend deliveries.",route:"watches"},
  {id:"explore",name:"Explore AVA",parts:"BentoGrid · selected capability detail",why:"Explain what AVA can help with using useful outcomes, not a wall of technical names.",route:"explore"},
  {id:"visuals",name:"Visual explanations",parts:"ImageAccordion for visual artifacts",why:"Pictures get room when selected. Diagrams still keep their own appropriate renderers.",route:"visuals"},
  {id:"activity",name:"Activity",parts:"AnimatedBeam dotted pipeline",why:"Movement follows recorded work in the real product. This proposal uses visibly labelled samples.",route:"activity"},
  {id:"self",name:"Improvements",parts:"ScrollTimeline",why:"An understandable story of changes, evidence and how to use them.",route:"self"},
  {id:"settings",name:"Settings",parts:"Quiet controls · restrained JellyButton",why:"Settings should settle down and let you decide. No decorative work indicators.",route:"settings"},
  {id:"pairing",name:"First hello",parts:"GradientWave · Stepper",why:"A soft moving welcome, then clear steps. No real pairing or permissions in this study.",route:"pairing"},
  {id:"materials",name:"Metal comparison",parts:"Real shader versus CSS · Ink / Paper study",why:"Compare the material in motion before choosing. The CSS finish is not presented as the same effect.",route:"components"},
] as const;

const day = [
  {title:"Agile Development",detail:"09:00 · Room B204. Review your last discussion before class."},
  {title:"A little room to think",detail:"14:00 · A protected study block. Leave the rest flexible."},
  {title:"Close the loop",detail:"18:00 · Revisit the two open questions from today's notes."},
];
const ideas=["An assistant that feels present","A pocket-sized morning brief","Turn a lecture into a conversation"];

function Reveal({items=day}:{items?:{title:string;detail:string}[]}) {
  const [active,setActive]=useState(0);
  return <ProgressiveCardReveal activeIndex={active} onActiveChange={setActive} className="ps-reveal">
    {items.map(item=><ProgressiveCardReveal.Card key={item.title}>
      <ProgressiveCardReveal.CardCollapsed><span>{item.title}</span></ProgressiveCardReveal.CardCollapsed>
      <ProgressiveCardReveal.CardExpanded><div className="ps-reveal-content"><h3>{item.title}</h3><p>{item.detail}</p></div></ProgressiveCardReveal.CardExpanded>
    </ProgressiveCardReveal.Card>)}
  </ProgressiveCardReveal>;
}

function Presence({voice}:{voice:boolean}) {
  const [open,setOpen]=useState(false),[mode,setMode]=useState<FaceMode>(voice?"listening":"idle");
  return <div className="ps-presence">
    <div className="ps-local-stars" aria-hidden="true"><WarpStarfield starCount={320} speed={.6}/></div>
    <button className="ps-island-trigger" aria-expanded={open} onClick={()=>setOpen(v=>!v)} aria-label="Reveal today's one thing">
      <DynamicIsland size={open?"default":"compact"} presenceKey={`${mode}-${open}`}><span>{open?"Today's one thing":voice?`${mode} · preview`:"Here with you"}</span></DynamicIsland>
    </button>
    {open&&<div className="ps-one-thing"><Reveal items={[{title:"Today's one thing",detail:"Sample: Agile Development at 09:00. Live AVA would use the existing verified ranking."}]}/></div>}
    <div className="ps-face"><Suspense fallback={<p>Opening face…</p>}><Face mode={mode} label="Proposed AVA face"/></Suspense></div>
    <h3><ElasticText>{voice?"I'm here. Take your time.":"Good evening, Niko."}</ElasticText></h3>
    <LiquidMetalButton label={voice?"Change voice sample":"Try the Talk state"} onClick={()=>setMode(v=>v==="speaking"?"listening":"speaking")}><Mic size={15}/>{voice?"Voice sample":"Talk to AVA"}</LiquidMetalButton>
    <div className="ps-mini-bar"><Plus size={16}/><span>Ask AVA anything…</span><Mic size={16}/></div>
    <p className="ps-caption">2 WebGL contexts when available: face + one shader. No microphone.</p>
  </div>;
}

function TimeStudy({journal=false}:{journal?:boolean}) {
  const scroll=useRef<HTMLDivElement>(null);
  const [ready,setReady]=useState(false);
  // The vendor's layout-time useScroll must receive an already-attached container.
  useEffect(()=>setReady(true),[]);
  return <div ref={scroll} className="ps-time">
    {!journal&&<><p className="ps-eyebrow">EUROPE / DUBLIN · LIVE CLOCK, SAMPLE AGENDA</p><FlapClock/></>}
    {ready&&<ScrollTimeline container={scroll} data={(journal?[
      {date:"01",title:"A calmer home",content:<p>Illustrative change: more room for AVA, fewer competing controls.</p>},
      {date:"02",title:"A living material",content:<p>Compare the real liquid shader with the lighter CSS finish.</p>},
    ]:day.map((d,i)=>({date:["09:00","14:00","18:00"][i]!,title:d.title,content:<Reveal items={[d]}/>})))}/>}
  </div>;
}

function IdeasStudy() {
  const [view,setView]=useState("Cover-flow"),[notice,setNotice]=useState("");
  const cards=ideas.map((title,i)=><article className="ps-idea" key={title}><span>0{i+1} / IDEA STUDY</span><Lightbulb size={28}/><h3>{title}</h3><p>Keep the thought, its questions and the next step together.</p></article>);
  return <div className="ps-ideas"><div className="ps-options" role="group" aria-label="Idea browsing style">{["Cover-flow","Card-swap","List"].map(v=><button key={v} aria-pressed={view===v} onClick={()=>setView(v)}>{v}</button>)}</div>
    {view==="Cover-flow"?<CoverFlow itemWidth={220} itemHeight={260} reflection={false}>{cards}</CoverFlow>:view==="Card-swap"?<CardSwap className="ps-card-swap">{cards}</CardSwap>:<div className="ps-list">{cards}</div>}
    <JellyButton onClick={()=>setNotice("Capture would open here. This proposal has not saved an idea.")}>New idea</JellyButton><p role="status">{notice}</p>
  </div>;
}

function NotesStudy() {
  const [notice,setNotice]=useState("");
  return <div className="ps-notes"><Breadcrumbs items={[{label:"University"},{label:"Agile Development"},{label:"Feedback loops"}]}/>
    <div className="ps-notes-columns"><TiltCard className="ps-pinned"><BookOpen/><p className="ps-eyebrow">PINNED FILE</p><h3>Shorter loops.<br/>Better decisions.</h3><p>Move your pointer to feel the depth.</p></TiltCard>
      <article className="ps-reading"><span className="ps-eyebrow">LECTURE 04 · SAMPLE NOTE</span><h3>The important part is what changes.</h3><p>A useful feedback loop changes your next decision. Capture the example, the open question, and the conclusion—not just a transcript.</p><h4>A question to return to</h4><p>When does feedback become noise?</p></article></div>
    <div className="ps-capture"><GooeyFab actions={[{label:"New note",icon:<BookOpen/>,onClick:()=>setNotice("Note capture selected — no live write.")},{label:"New idea",icon:<Lightbulb/>,onClick:()=>setNotice("Idea capture selected — no live write.")} ]}/></div><p role="status">{notice}</p>
  </div>;
}

function Connections({memory=false}:{memory?:boolean}) {
  const container=useRef<HTMLDivElement>(null), a=useRef<HTMLDivElement>(null), b=useRef<HTMLDivElement>(null), c=useRef<HTMLDivElement>(null);
  return <div className="ps-connections"><p>ILLUSTRATIVE RELATIONSHIPS · NOT A LIVE RUN</p><div ref={container} className="ps-beam-stage">
    <div ref={a} className="ps-node">{memory?"Conversation":"Request"}</div><div ref={b} className="ps-node">{memory?"Checkpoint":"AVA"}</div><div ref={c} className="ps-node">{memory?"Source":"Evidence"}</div>
    <AnimatedBeam containerRef={container} fromRef={a} toRef={b} pathDashArray="0.1 8" duration={4}/><AnimatedBeam containerRef={container} fromRef={b} toRef={c} pathDashArray="0.1 8" duration={4} delay={.6}/>
  </div><Reveal items={[{title:memory?"Where this memory came from":"Inspect the evidence",detail:"Production links and states must come from retained authoritative evidence, never the animation itself."}]}/></div>;
}

function TalkStudy() {
  const [open,setOpen]=useState(false);
  return <div className="ps-talk"><p className="ps-user">Help me untangle this week.</p><h3>Three things matter.</h3><p>Your reflection, tomorrow's lecture, and a clear block to think. I'd protect Friday afternoon and keep the rest flexible.</p><p className="ps-caption">Illustrative reply, not a model response.</p>
    <button className="am-control" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>What AVA did · sample</button>
    {open&&<><AgentFlow className="ps-flow" draggable={false} nodes={[{id:"request",label:"Request",x:80,y:80},{id:"context",label:"Context",x:320,y:80},{id:"answer",label:"Synthesis",x:560,y:80}]} edges={[{id:"a",from:"request",to:"context"},{id:"b",from:"context",to:"answer"}]} autoPlay/><p className="ps-caption">A live version would use actual tool steps, not this auto-play.</p></>}
  </div>;
}

function Materials() {
  const [paper,setPaper]=useState(false),[feedback,setFeedback]=useState("");
  return <div className="ps-materials"><div className="ps-options" role="group" aria-label="Material look">{[false,true].map(v=><button key={String(v)} aria-pressed={v===paper} onClick={()=>setPaper(v)}>{v?"Paper study":"Ink study"}</button>)}</div>
    <div className="ps-material-samples" data-paper={paper}><article><h3>Liquid metal</h3><LiquidMetalButton label="Try real liquid metal" onClick={()=>setFeedback("Real shader pressed.")}>Talk to AVA</LiquidMetalButton><p>Actual Paper shader.<br/>1 WebGL context when supported.</p></article>
    <article><h3>CSS metal</h3><button className="dm-button primary" onClick={()=>setFeedback("CSS material pressed.")}>Talk to AVA</button><p>Gradients and reflections.<br/>0 WebGL contexts.</p></article></div>
    <p role="status">{feedback||"Hover, press and compare. These finishes are intentionally shown side by side."}</p><p className="ps-caption">Paper is a material sample, not a claim that every screen has been themed.</p></div>;
}

function WelcomeStudy() {
  const [step,setStep]=useState(0);
  return <div className="ps-welcome"><div className="ps-wave"><GradientWave colors={["#a6b5ca","#242f43","#d8e0ee","#7185a4"]}/></div><div className="ps-welcome-content"><p className="ps-eyebrow">A FIRST HELLO</p><h3>A little less to carry.</h3><p>Your thoughts, your time, your assistant.</p><Stepper className="ps-stepper" steps={[{label:"Welcome"},{label:"Your space"},{label:"Ready"}]} active={step}/><button className="am-control" onClick={()=>setStep(v=>(v+1)%3)}>Next preview step</button><p className="ps-caption">No device pairing, permissions or account changes.</p></div></div>;
}

const visualPanels=["The request path","A week of ideas","Connections that matter"].map((title,i)=>({title,description:"Original local illustration · sample artifact",image:`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><rect width="400" height="500" fill="${["#26354b","#3a3553","#253f41"][i]}"/><circle cx="200" cy="200" r="${80+i*25}" stroke="#cad9ee" stroke-width="2" fill="none"/><path d="M40 350Q200 80 360 350" stroke="#ffffff" fill="none"/></svg>`)}`}));

function Study({id}:{id:string}) {
  if(id==="home"||id==="voice")return <Presence voice={id==="voice"}/>;
  if(id==="today"||id==="calendar"||id==="self")return <TimeStudy journal={id==="self"}/>;
  if(id==="ideas")return <IdeasStudy/>;
  if(id==="notes")return <NotesStudy/>;
  if(id==="activity"||id==="memory")return <Connections memory={id==="memory"}/>;
  if(id==="chat")return <TalkStudy/>;
  if(id==="materials")return <Materials/>;
  if(id==="pairing")return <WelcomeStudy/>;
  if(id==="visuals")return <div className="ps-visuals"><ImageAccordion panels={visualPanels} height="26rem"/><p className="ps-caption">Local illustrative images. Diagrams/maps retain their own renderers.</p></div>;
  if(id==="explore")return <BentoGrid className="ps-bento"><BentoCard colSpan={2} icon={<BookOpen/>} title="Think it through" description="Discuss a lecture, preserve the main ideas, pick up where you left off."/><BentoCard icon={<CalendarDays/>} title="See your day" description="Commitments with enough space to think."/><BentoCard icon={<Sparkles/>} title="Make it clear" description="Choose a visual that fits the question."/></BentoGrid>;
  if(id==="watches")return <Reveal items={[{title:"Reflection deadline",detail:"Sample reminder: scheduled for 18:00 Europe/Dublin. Sending has not been attempted."},{title:"Delivery receipt",detail:"Not recorded in this design sample. No animation can prove delivery."}]}/>;
  if(id==="chats")return <div className="ps-conversation-list"><p className="ps-eyebrow">PINNED</p><TiltCard className="ps-pinned"><h3>Making room for the important things</h3><p>Continue your thinking from where you left it.</p></TiltCard><p className="ps-eyebrow">YESTERDAY</p><p>Understanding feedback loops</p><p>Designing for change</p></div>;
  return <div className="ps-settings"><h3>Make AVA yours.</h3><Reveal items={[{title:"Look & motion",detail:"Ink / Paper. Full, reduced or system motion. Existing preferences remain authoritative."},{title:"Voice",detail:"Provider and voice settings stay honest about availability."}]}/><JellyButton onClick={()=>{}}>A small tactile response</JellyButton><p className="ps-caption">Demonstration only. No preference saved.</p></div>;
}

export default function ProposalStudio({navigate}:{navigate:(route:DemoRoute)=>void}) {
  const [selected,setSelected]=useState<string>("home"),[lines,setLines]=useState(false);
  const current=STUDIES.find(s=>s.id===selected)!;
  return <main className="ps-root"><header className="ps-heading"><p className="ps-eyebrow">CODEX + CLAUDE · A PROPOSAL TO REACT TO</p><h1>AVA, with a little more life.</h1><p>Choose a screen. Try its movement. Then tell us what feels like her.</p><p className="ps-caption">Sample content only. No live tasks, messages, microphone or data changes.</p></header>
    <div className="ps-layout"><nav className="ps-nav" aria-label="Proposed screens">{STUDIES.map((s,i)=><button key={s.id} aria-current={s.id===selected?"page":undefined} onClick={()=>setSelected(s.id)}><span>{String(i+1).padStart(2,"0")}</span>{s.name}</button>)}</nav>
      <section className="ps-selected" aria-label="Selected design proposal"><div className="ps-study-heading"><div><h2>{current.name}</h2><p>{current.parts}</p></div><label><input type="checkbox" checked={lines} onChange={e=>setLines(e.target.checked)}/> Quiet structural lines</label></div>
        <div className="ps-artboard" data-lines={lines} data-study={current.id}><Study key={current.id} id={current.id}/></div>
        <div className="ps-rationale"><p>{current.why}</p><button className="am-control" onClick={()=>navigate(current.route)}>Open full {current.name.toLowerCase()} layout <ArrowUpRight size={15}/></button></div>
        <details className="ps-notes"><summary>What is proposed, and what is not?</summary><p>This is a composition study. Full workspace behavior remains in the existing demo. The complete 21-component catalog is retained. Nothing here changes the production graphics budget, theme, navigation or approval policy.</p><p>Suggested choices: genuine liquid metal on hero actions; quiet structural lines where useful; keep Paper; split-flap on Today; optional playful Ideas browsing alongside a list.</p><button className="am-control" onClick={()=>navigate("components")}>Open all 21 original references</button></details>
      </section></div>
  </main>;
}
