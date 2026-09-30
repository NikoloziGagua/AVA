import { useEffect, useState } from "react";

export const DESTINATIONS = [
  ["home","Home","Your space"], ["today","Today","The day ahead"],
  ["chat","Talk","Think with AVA"], ["voice","Voice","A natural conversation"],
  ["chats","Conversations","Pick up a thread"], ["notes","Notes","Folders, files & study"],
  ["calendar","Calendar","Your time, clearly"], ["ideas","Ideas","Room to develop"],
  ["memory","Memory","What AVA remembers"], ["watches","Reminders & watches","Keep an eye on things"],
  ["explore","Explore AVA","Understand her capabilities"], ["visuals","Visual explanations","Make things click"],
  ["activity","Activity","See what happened"], ["self","Self development","Improvements & approvals"],
  ["settings","Settings","Make AVA yours"], ["strategy","Strategy Room","Think together"],
  ["pairing","Pair a device","Connection preview"], ["intro","Welcome","First-run experience"],
  ["components","Components","All 21 references"],
  ["proposal","Proposed design","Our screen-by-screen motion proposal"],
] as const;
export type DemoRoute = typeof DESTINATIONS[number][0];
export type WorkspaceRoute = Exclude<DemoRoute,"home"|"voice"|"components"|"proposal">;
export type Note = {id:string; folder:string; title:string; body:string; kind:"note"|"idea"; stage:string; pinned:boolean};
export type DemoEvent = {id:string; title:string; date:string; time:string; duration:number; location:string; attendance:string};
export type Chat = {id:string; title:string; pinned:boolean; messages:{role:"user"|"assistant";text:string}[]};
export type DemoState = {
  version:1; folders:{id:string;name:string;parent:string|null}[]; notes:Note[];
  events:DemoEvent[]; tasks:{id:string;title:string;done:boolean}[];
  chats:Chat[]; currentChat:string;
  watches:{id:string;title:string;kind:string;schedule:string;active:boolean}[];
  memories:{id:string;title:string;body:string;source:string;pinned:boolean;status:string}[];
  rules:{id:string;title:string;active:boolean}[];
  preferences:{speed:string;motion:string;voice:string;notifications:boolean;worker:string};
  improvements:{id:string;title:string;state:string;worker:string}[];
  log:{id:string;title:string;time:string}[];
};
export const DEMO_KEY="ava:metal-demo:v1";
export const uid=()=>`demo-${crypto.randomUUID()}`;
export function freshDemo():DemoState {return {
  version:1,
  folders:[{id:"uni",name:"University",parent:null},{id:"agile",name:"Agile Development",parent:"uni"},{id:"software",name:"Software Engineering",parent:"uni"},{id:"life",name:"Life",parent:null},{id:"ava",name:"AVA",parent:null}],
  notes:[
    {id:"n1",folder:"agile",title:"Shorter loops, better decisions",kind:"note",stage:"Review",pinned:true,body:"# Lecture 04 · Feedback loops\n\nThe point of a short iteration is not speed alone. It is the opportunity to learn before committing to the wrong direction.\n\n## The central idea\n\nA useful loop has three parts: **make a prediction**, observe what happened, and change the next decision.\n\n## A concrete example\n\nShow a rough prototype to one person before polishing ten screens. The feedback should change what we build next.\n\n## Questions to revisit\n\n- When does feedback become noise?\n- How do we distinguish progress from activity?\n\n## My conclusion\n\nMeasure whether the decision improved—not merely whether the loop was fast."},
    {id:"n2",folder:"software",title:"Designing for change",kind:"note",stage:"Doing",pinned:false,body:"# Designing for change\n\nGood boundaries let one part change without surprising the rest.\n\n## Working principle\n\nKeep data ownership clear. Put policy in one place. Test the boundary.\n\n## Next step\n\nDraw the request path and identify where validation belongs."},
    {id:"n3",folder:"life",title:"A week with more breathing room",kind:"note",stage:"Ideas",pinned:false,body:"# A week with more breathing room\n\nProtect two uninterrupted study blocks. Leave Friday afternoon flexible.\n\n- Keep commitments visible\n- Capture loose thoughts quickly\n- Review on Sunday"},
    {id:"i1",folder:"ava",title:"An assistant that feels present",kind:"idea",stage:"Doing",pinned:true,body:"AVA should feel attentive, not busy.\n\nA calm home, natural voice and direct access to notes. Personality through useful continuity—not extra words."},
    {id:"i2",folder:"ava",title:"A pocket-sized morning brief",kind:"idea",stage:"Ideas",pinned:false,body:"One minute. What matters today, what changed, and the one thing worth moving forward."},
    {id:"i3",folder:"life",title:"Turn a lecture into a conversation",kind:"idea",stage:"Review",pinned:false,body:"Discuss the hard parts first. Keep examples, open questions and conclusions together in a living note."},
  ],
  events:[{id:"e1",title:"Agile Development",date:"2026-09-25",time:"09:00",duration:60,location:"Room B204",attendance:"Attending"},{id:"e2",title:"Independent study",date:"2026-09-25",time:"14:00",duration:90,location:"Library",attendance:"Planned"},{id:"e3",title:"Software Engineering",date:"2026-09-28",time:"11:00",duration:60,location:"Room A102",attendance:"Attending"}],
  tasks:[{id:"t1",title:"Finish the Agile reflection",done:false},{id:"t2",title:"Review the architecture sketch",done:false},{id:"t3",title:"Capture this week's ideas",done:true}],
  chats:[{id:"c1",title:"Making room for the important things",pinned:true,messages:[{role:"user",text:"Help me make this week a little less crowded."},{role:"assistant",text:"Three things matter: your reflection, the next lecture, and a clear block to think.\n\nI’d protect **Friday afternoon** and keep the rest flexible. Your notes already have the thread—we don’t need to start again.\n\nThis is a scripted demo conversation, not a live response."}]},{id:"c2",title:"Understanding feedback loops",pinned:false,messages:[{role:"user",text:"Why are shorter feedback loops useful?"},{role:"assistant",text:"They let you find a wrong assumption while it is still cheap to change.\n\n**Shorter is useful only when the feedback changes the next decision.**\n\nIllustrative response for this demo."}]}],currentChat:"c1",
  watches:[{id:"w1",title:"Reflection deadline",kind:"Reminder",schedule:"25 Sep · 18:00 · Europe/Dublin",active:true},{id:"w2",title:"Weekly planning check-in",kind:"AVA check",schedule:"Sunday · 17:00",active:true},{id:"w3",title:"Development continuation",kind:"Codex watcher",schedule:"Paused · one-off",active:false}],
  memories:[{id:"m1",title:"A calm, direct assistant",body:"Prefer concise answers, warm judgment and a clear next step.",source:"Demo conversation · Making room",pinned:true,status:"Current"},{id:"m2",title:"Agile reflection: the core argument",body:"Feedback matters when it changes a decision, not simply when it arrives quickly.",source:"Demo note · Shorter loops, better decisions",pinned:false,status:"Current"},{id:"m3",title:"Friday afternoon study block",body:"Protect Friday afternoon for uninterrupted work.",source:"Demo conversation · Planning the week",pinned:false,status:"Needs review"}],
  rules:[{id:"r1",title:"Ask before sending a message to someone",active:true},{id:"r2",title:"Keep notifications quiet overnight",active:true}],
  preferences:{speed:"Fast",motion:"System",voice:"OpenAI Realtime",notifications:false,worker:"Codex"},
  improvements:[{id:"s1",title:"A calmer, more expressive home",state:"Applied example",worker:"Codex"},{id:"s2",title:"Refine the daily briefing",state:"Awaiting approval",worker:"Claude Code"}],log:[],
};}
function loadDemo():DemoState {
  try {const raw=localStorage.getItem(DEMO_KEY);if(!raw||raw.length>500_000)return freshDemo();const v=JSON.parse(raw) as DemoState;const collections=["folders","notes","events","tasks","chats","watches","memories","rules","improvements","log"] as const;
    if(v.version!==1||!v.preferences||typeof v.currentChat!=="string"||!collections.every(k=>Array.isArray(v[k])&&v[k].length<=300&&v[k].every(r=>r&&typeof r.id==="string")))return freshDemo();
    // localStorage is untrusted. Validate every rendered value before restoring.
    const strings=(o:object,keys:string[])=>keys.every(k=>typeof (o as Record<string,unknown>)[k]==="string");
    if(!v.notes.every(n=>strings(n,["title","body","folder","stage"])&&["note","idea"].includes(n.kind)&&typeof n.pinned==="boolean")
      ||!v.chats.every(c=>strings(c,["title"])&&typeof c.pinned==="boolean"&&Array.isArray(c.messages)&&c.messages.length<=600&&c.messages.every(m=>m&&typeof m.text==="string"&&["user","assistant"].includes(m.role)))
      ||!v.folders.every(f=>strings(f,["name"])&&(f.parent===null||typeof f.parent==="string"))
      ||!v.events.every(e=>strings(e,["title","date","time","location","attendance"])&&Number.isFinite(e.duration))
      ||!v.tasks.every(t=>strings(t,["title"])&&typeof t.done==="boolean")
      ||!v.watches.every(w=>strings(w,["title","kind","schedule"])&&typeof w.active==="boolean")
      ||!v.memories.every(m=>strings(m,["title","body","source","status"])&&typeof m.pinned==="boolean")
      ||!v.rules.every(r=>strings(r,["title"])&&typeof r.active==="boolean")
      ||!v.improvements.every(i=>strings(i,["title","state","worker"]))
      ||!v.log.every(l=>strings(l,["title","time"]))
      ||!strings(v.preferences,["speed","motion","voice","worker"])||typeof v.preferences.notifications!=="boolean")return freshDemo();return v;
  }catch{return freshDemo();}
}
export function useDemoState(){
  const [state,setState]=useState<DemoState>(loadDemo),[notice,setNotice]=useState("");
  useEffect(()=>{try{localStorage.setItem(DEMO_KEY,JSON.stringify(state));}catch{setNotice("Browser storage unavailable. Changes last for this visit only.");}},[state]);
  const update=(change:(s:DemoState)=>DemoState,message="Demo saved")=>{setState(s=>{const next=change(s);return {...next,log:[{id:uid(),title:message,time:new Date().toISOString()},...s.log].slice(0,80)};});setNotice(message);};
  return {state,update,notice,setNotice,reset:()=>{setState(freshDemo());setNotice("Demo reset. Real AVA data was not touched.");}};
}
export type DemoStore=ReturnType<typeof useDemoState>;
export type WorkspaceProps={route:WorkspaceRoute;demo:DemoStore;navigate:(r:DemoRoute)=>void};
export function readDemoRoute():DemoRoute {const v=new URLSearchParams(location.hash.slice(1)).get("demo");return DESTINATIONS.some(d=>d[0]===v)?v as DemoRoute:"home";}
