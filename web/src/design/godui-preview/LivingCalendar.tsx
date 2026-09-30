import { useRef, useState, type FormEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { GradientWave } from "./GradientWave.js";
import { TiltCard } from "./vendor/tilt-card/tilt-card.js";
import { uid, type DemoEvent, type WorkspaceProps } from "./demo-model.js";

const WEEK=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const WAVE=["#a6b5ca","#242f43","#d8e0ee","#7185a4"];
const dateKey=(d:Date)=>d.toISOString().slice(0,10);
const dateAt=(key:string)=>new Date(`${key}T12:00:00Z`);
const timeAt=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;
const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
export function validCalendarEvent(e:DemoEvent) {
  return /^\d{4}-\d{2}-\d{2}$/.test(e.date)&&Number.isFinite(dateAt(e.date).getTime())&&dateKey(dateAt(e.date))===e.date
    &&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(e.time)&&Number.isFinite(e.duration)&&e.duration>=5&&e.duration<=1440;
}
export function dragBlock(start:number,end:number) {
  const a=Math.max(0,Math.min(47,Math.floor(start))), b=Math.max(0,Math.min(47,Math.floor(end)));
  return {time:timeAt(480+Math.min(a,b)*15),duration:(Math.abs(a-b)+1)*15};
}

/** One sample calendar surface, shared by the proposal and persistent local demo.
 * No calendar API. Drag only prepares a draft; only Save calls the supplied owner. */
export function CalendarSurface({events,onSave,onDelete}:{events:DemoEvent[];onSave:(event:DemoEvent)=>void;onDelete:(id:string)=>void}) {
  const [date,setDate]=useState("2026-09-25"),[month,setMonth]=useState("2026-09-01"),[view,setView]=useState("Month");
  const [editor,setEditor]=useState<{event:DemoEvent;isNew:boolean}|null>(null),[notice,setNotice]=useState("");
  const [range,setRange]=useState<{day:string;start:number;end:number}|null>(null);
  const drag=useRef<{day:string;start:number;end:number;top:number;height:number}|null>(null),opener=useRef<HTMLElement|null>(null),addButton=useRef<HTMLButtonElement>(null);
  const skipClick=useRef(false);
  const safeEvents=events.filter(validCalendarEvent),anchor=dateAt(month),year=anchor.getUTCFullYear(),monthIndex=anchor.getUTCMonth();
  const days=new Date(Date.UTC(year,monthIndex+1,0)).getUTCDate(),offset=(anchor.getUTCDay()+6)%7;
  const key=(day:number)=>dateKey(new Date(Date.UTC(year,monthIndex,day,12)));
  const dayEvents=(d:string)=>safeEvents.filter(e=>e.date===d).sort((a,b)=>a.time.localeCompare(b.time));
  const week=Array.from({length:7},(_,i)=>{const d=dateAt(date);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7+i);return dateKey(d);});
  const close=()=>{setEditor(null);requestAnimationFrame(()=>{const target=opener.current?.isConnected?opener.current:addButton.current;target?.focus();});};
  const open=(d=date,time="14:00",duration=60,event?:DemoEvent)=>{
    opener.current=document.activeElement as HTMLElement|null;setDate(d);setNotice("");
    setEditor({event:event??{id:uid(),title:"",date:d,time,duration,location:"",attendance:"Planned"},isNew:!event});
  };
  const save=(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();if(!editor)return;const f=new FormData(e.currentTarget);
    const event:DemoEvent={...editor.event,title:String(f.get("title")).trim(),date:String(f.get("date")),time:String(f.get("time")),duration:Number(f.get("duration")),location:String(f.get("location")??""),attendance:String(f.get("attendance")??"Planned")};
    if(!event.title||!validCalendarEvent(event)){setNotice("Check the title, date, time and duration.");return;}
    onSave(event);setDate(event.date);setMonth(event.date.slice(0,7)+"-01");setNotice("Saved in this demo only. Your real calendar is unchanged.");close();
  };
  const begin=(e:PointerEvent<HTMLButtonElement>,d:string)=>{
    if(e.pointerType!=="mouse"||e.button!==0)return;
    const box=e.currentTarget.parentElement!.getBoundingClientRect();const start=Math.floor((e.clientY-box.top)/box.height*48);
    drag.current={day:d,start,end:start,top:box.top,height:box.height};setRange({day:d,start,end:start});
    e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();
  };
  const move=(e:PointerEvent<HTMLButtonElement>)=>{if(!drag.current)return;drag.current.end=Math.max(0,Math.min(47,Math.floor((e.clientY-drag.current.top)/drag.current.height*48)));setRange({...drag.current});};
  const finish=()=>{if(!drag.current)return;const r=drag.current;const block=dragBlock(r.start,r.end);drag.current=null;setRange(null);skipClick.current=true;open(r.day,block.time,block.duration);};
  const cancelDrag=()=>{drag.current=null;setRange(null);};
  const select=(d:string)=>{setDate(d);setEditor(null);};
  const shift=(direction:number)=>{if(view==="Week"){const d=dateAt(date);d.setUTCDate(d.getUTCDate()+direction*7);setDate(dateKey(d));setMonth(dateKey(d).slice(0,7)+"-01");}else{setMonth(dateKey(new Date(Date.UTC(year,monthIndex+direction,1,12))));}setEditor(null);};
  return <div className="lc-root"><div className="lc-wave" aria-hidden="true"><GradientWave colors={WAVE}/></div>
    <div className="lc-header"><div className="lc-month-title"><button aria-label={view==="Week"?"Previous week":"Previous month"} onClick={()=>shift(-1)}><ChevronLeft size={18}/></button><h2>{anchor.toLocaleDateString("en-GB",{month:"long",year:"numeric",timeZone:"UTC"})}</h2><button aria-label={view==="Week"?"Next week":"Next month"} onClick={()=>shift(1)}><ChevronRight size={18}/></button></div>
      <div className="ps-options" role="group" aria-label="Calendar view">{["Month","Week","Agenda"].map(v=><button key={v} aria-pressed={view===v} onClick={()=>setView(v)}>{v}</button>)}</div>
      <button ref={addButton} className="am-control lc-add" onClick={()=>open()} aria-label="New event"><Plus size={15}/>Add a block</button>
    </div><p className="lc-caption">EUROPE / DUBLIN · SAMPLE CALENDAR · {view==="Week"?"Drag an empty time to sketch a block, or click a time to type.":"Choose a day. Tap + to make room for something."}</p>
    <div className="lc-layout"><div className="lc-calendar">
      {view==="Month"?<><div className="lc-weekdays">{WEEK.map(d=><span key={d}>{d}</span>)}</div><div className="lc-month-grid">{Array.from({length:offset},(_,i)=><span key={`blank-${i}`}/>)}{Array.from({length:days},(_,i)=>{const d=key(i+1),items=dayEvents(d);return <div className="lc-day" key={d} data-selected={date===d}><button className="lc-select-day" aria-label={d} aria-pressed={date===d} onClick={()=>select(d)}><span>{i+1}</span>{items.slice(0,2).map(e=><small key={e.id}>{e.time} <b>{e.title}</b></small>)}{items.length>2&&<small>+{items.length-2} more</small>}</button><button className="lc-day-add" aria-label={`Add block on ${d}`} onClick={()=>open(d)}><Plus size={12}/></button></div>;})}</div></>:view==="Week"?<div className="lc-week-scroll"><div className="lc-week">
        {week.map((d,i)=><section key={d}><button className="lc-week-title" aria-pressed={date===d} onClick={()=>select(d)}>{WEEK[i]} <strong>{Number(d.slice(-2))}</strong></button><div className="lc-hours" role="group" aria-label={`Times for ${d}`}>
          {Array.from({length:12},(_,hour)=><button key={hour} className="lc-hour-slot" aria-label={`Add block on ${d} at ${timeAt((hour+8)*60)}`} onPointerDown={e=>begin(e,d)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onClick={e=>{if(e.detail===0||!skipClick.current)open(d,timeAt((hour+8)*60));skipClick.current=false;}}><span>{hour+8}:00</span></button>)}
          {dayEvents(d).map(event=>{const start=minutes(event.time);if(start<480||start>=1200)return null;return <button className="lc-week-event" key={event.id} style={{top:`${(start-480)/720*100}%`,height:`${Math.min(event.duration,1200-start)/720*100}%`}} aria-label={`Edit ${event.title} at ${event.time}`} onClick={()=>open(d,event.time,event.duration,event)}><b>{event.title}</b><span>{event.time} · {event.duration}m</span></button>;})}
          {range?.day===d&&<div className="lc-drag-block" style={{top:`${Math.min(range.start,range.end)/48*100}%`,height:`${(Math.abs(range.end-range.start)+1)/48*100}%`}}>{dragBlock(range.start,range.end).duration} min</div>}
        </div></section>)}
      </div></div>:<div className="lc-agenda">{safeEvents.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(e=><button key={e.id} onClick={()=>{setDate(e.date);open(e.date,e.time,e.duration,e);}}><span>{e.date} · {e.time}</span><strong>{e.title}</strong><small>{e.duration} minutes · {e.attendance}</small></button>)}{!safeEvents.length&&<p>No sample events yet.</p>}</div>}
    </div><aside className="lc-day-panel"><p className="lc-caption">YOUR DAY · {date}</p>
      {editor?<form key={editor.event.id} className="lc-editor" aria-label="Time block editor" onSubmit={save} onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();close();}}}>
        <div className="lc-editor-title"><h3>{editor.isNew?"Make a little room.":"Refine this block."}</h3><button type="button" onClick={close} aria-label="Cancel time block"><X size={16}/></button></div>
        <label>Event title<input name="title" required maxLength={160} placeholder="What is this time for?" defaultValue={editor.event.title} autoFocus/></label>
        <div className="lc-fields"><label>Date<input name="date" type="date" required defaultValue={editor.event.date}/></label><label>Time · Europe/Dublin<input name="time" type="time" required defaultValue={editor.event.time}/></label><label>Duration in minutes<input name="duration" type="number" min={5} max={1440} required defaultValue={editor.event.duration}/></label></div>
        <details><summary>Location & attendance</summary><label>Location<input name="location" maxLength={160} defaultValue={editor.event.location}/></label><label>Attendance<select name="attendance" defaultValue={editor.event.attendance}>{["Planned","Attending","Independent study","Skipped","Attended"].map(v=><option key={v}>{v}</option>)}</select></label></details>
        <div className="lc-editor-actions"><button className="dm-button" type="submit">Save event</button>{!editor.isNew&&<button className="am-control" type="button" onClick={()=>{onDelete(editor.event.id);setNotice("Removed from this demo only.");close();}}>Delete event</button>}</div>
        <p className="lc-caption">Nothing is saved until you press Save. Demo only.</p>
      </form>:<><h3>A little space<br/>for what matters.</h3>{dayEvents(date).map(e=><TiltCard className="lc-event-card" key={e.id}><button onClick={()=>open(e.date,e.time,e.duration,e)}><span>{e.time} <small>{e.duration} min</small></span><h4>{e.title}</h4><p>{e.location||"A space of your own"}</p><small>{e.attendance}</small></button></TiltCard>)}{!dayEvents(date).length&&<p>No sample events. Leave room, or add a block.</p>}<button className="am-control lc-add" onClick={()=>open()}><Plus size={15}/>Add a time block</button></>}
    </aside></div><p className="lc-notice" role="status">{notice}</p>
    {view==="Week"&&<p className="lc-caption">Week canvas shows 08:00–20:00. Earlier/later blocks remain available in Agenda and day details. Touch users tap a time; mouse users can drag.</p>}
  </div>;
}

export function CalendarDemo({demo}:WorkspaceProps) {
  return <CalendarSurface events={demo.state.events} onSave={event=>demo.update(s=>({...s,events:s.events.some(e=>e.id===event.id)?s.events.map(e=>e.id===event.id?event:e):[...s.events,event]}),"Demo event saved")} onDelete={id=>demo.update(s=>({...s,events:s.events.filter(e=>e.id!==id)}),"Demo event removed")}/>;
}
