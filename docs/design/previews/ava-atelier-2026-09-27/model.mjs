export const STORAGE_KEY = 'ava:atelier:20260927:v1';
export const SCENES = [
  { id: 'nocturne', name: 'Nocturne', subtitle: 'Liquid light. Quiet confidence.', detail: 'A slow silver ribbon travels through deep graphite. Architectural light, not a blue wash.', use: 'My pick for Home & Voice', number: '01' },
  { id: 'orbit', name: 'Deep field', subtitle: 'Space, with a pulse.', detail: 'A genuine forward star field, a fine orbital horizon, and restrained warm light. More alive, never a screensaver behind your writing.', use: 'For the most futuristic AVA', number: '02' },
  { id: 'silk', name: 'Silver silk', subtitle: 'Something almost tangible.', detail: 'Hundreds of fine light threads bend into a metallic fabric. The material moves; your content stays still.', use: 'The expressive metal option', number: '03' },
  { id: 'dawn', name: 'Daybreak', subtitle: 'A different kind of future.', detail: 'Warm ivory, slow window-light and a soft violet caustic. A light direction designed for long reading sessions.', use: 'My pick for Notes', number: '04' },
];
export const MATERIALS = [
  { id: 'alloy', name: 'Milled alloy', subtitle: 'A precise instrument.', detail: 'A fine machined rim. A large time stamp. Brushed graphite. An edge catches the pointer; the content does not tilt.', use: 'The everyday default', number: '01' },
  { id: 'glass', name: 'Optical glass', subtitle: 'A little less weight.', detail: 'A translucent pane over a dark readable bed, one luminous edge and a lifted action. Glass as framing, not text distortion.', use: 'For short, important cards', number: '02' },
  { id: 'editorial', name: 'The editorial', subtitle: 'Information, beautifully set.', detail: 'No container to shout for attention. Oversized type, a narrow rule, warm paper and clear rhythm. A card that barely feels like one.', use: 'For notes and daily summaries', number: '03' },
  { id: 'stack', name: 'Living folio', subtitle: 'A small stack of possibility.', detail: 'Three staggered sheets, a vertical time rail, and a tactile lift. Flip the stack without hiding how many things remain.', use: 'For a few related items', number: '04' },
];
export const CATEGORIES = { study: { label: 'University', color: 'violet' }, focus: { label: 'Focus time', color: 'amber' }, life: { label: 'Life', color: 'sage' } };
export const TODAY = '2026-09-28';
export const MINUTE_PX = 4/3;
export function freshState() {
  return {
    version: 1, scene: 'nocturne', material: 'alloy', favourites: [],
    events: [
      { id:'lecture-1', title:'Agile Development', date:TODAY, start:540, duration:60, category:'study', attendance:'Attending', location:'Room B204', noteId:'agile' },
      { id:'focus-1', title:'Make room for deep work', date:TODAY, start:690, duration:90, category:'focus', attendance:'Planned', location:'Library', noteId:'' },
      { id:'life-1', title:'Out for a walk', date:TODAY, start:1020, duration:45, category:'life', attendance:'Planned', location:'Outside', noteId:'' },
      { id:'lecture-2', title:'Software Engineering', date:'2026-09-29', start:600, duration:90, category:'study', attendance:'Independent study', location:'Room A102', noteId:'software' },
      { id:'focus-2', title:'Build something that matters', date:'2026-09-30', start:570, duration:120, category:'focus', attendance:'Planned', location:'Home', noteId:'ava' },
      { id:'lecture-3', title:'Design patterns', date:'2026-10-01', start:780, duration:90, category:'study', attendance:'Attending', location:'Room B204', noteId:'software' },
      { id:'life-2', title:'A little reset', date:'2026-10-02', start:660, duration:60, category:'life', attendance:'Planned', location:'Personal time', noteId:'' },
    ],
    notes: [
      { id:'agile', title:'Agile Development', subtitle:'Small iterations. Better software.', folder:'Agile Development', area:'University', tag:'Lecture 04', pinned:true, updated:'28 Sep', body:'## The idea worth keeping\nAgile is not about going faster at any cost. It is about shortening the distance between an assumption and useful feedback.\n\nA small, working increment tells you more than a large, unfinished promise.\n\n## The loop\nMake an assumption. Build something small. Put it in front of someone. Learn. Then change the plan.\n\n## What I want to understand\n- When does an iteration become too small to be useful?\n- How do you measure progress without counting activity?\n- What changes when the customer is part of the team?\n\n## My conclusion\nKeep the direction. Stay flexible about the route.', links:['software','ava'] },
      { id:'software', title:'Designing software that lasts', subtitle:'Boundaries before frameworks.', folder:'Software Engineering', area:'University', tag:'Working note', pinned:true, updated:'27 Sep', body:'## A useful starting point\nGood boundaries make change local. Separate the part that changes frequently from the part that should remain dependable.\n\n## Questions for the next lecture\n- What is the smallest useful module?\n- How do we know when an abstraction helps?\n\n## Example\nKeep storage concerns outside a calendar interaction. The same event can be shown as a week, a day or an agenda.', links:['agile'] },
      { id:'ava', title:'An assistant, not another dashboard', subtitle:'Let the important things come forward.', folder:'AVA', area:'Projects', tag:'Idea thread', pinned:true, updated:'26 Sep', body:'## The direction\nAVA should feel like someone who has been paying attention. Notes, commitments and conversations belong to the same life.\n\n## A design principle\nThe interface should make it easy to find what matters, and quiet enough to think.\n\n## Next question\nWhat should AVA surface at the start of a normal day?', links:['agile'] },
      { id:'week', title:'A week with a little more room', subtitle:'Make time for the things that matter.', folder:'Journal', area:'Life', tag:'Reflection', pinned:false, updated:'25 Sep', body:'## What helped\nA short plan at the start of the day. Time outside. One block of uninterrupted work.\n\n## What to try\nLeave a little space between commitments. Not every blank hour needs a task.', links:[] },
    ],
  };
}
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const time = minute => `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
export const dayDate = value => new Date(`${value}T12:00:00Z`);
export const dateKey = date => date.toISOString().slice(0,10);
export function shiftDate(value, days) { const d=dayDate(value);d.setUTCDate(d.getUTCDate()+days);return dateKey(d); }
export function weekOf(value) { const d=dayDate(value);return shiftDate(value,-((d.getUTCDay()+6)%7)); }
export function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayDate(value).getTime()) && dateKey(dayDate(value))===value; }
export function validEvent(e) { return e && typeof e.id==='string' && e.id.length<=100 && typeof e.title==='string' && e.title.trim().length>0 && e.title.length<=160 && validDate(e.date) && Number.isInteger(e.start) && e.start>=0 && e.start<1440 && Number.isInteger(e.duration) && e.duration>=15 && e.start+e.duration<=1440 && Object.hasOwn(CATEGORIES,e.category) && ['Planned','Attending','Independent study','Skipped','Attended'].includes(e.attendance) && typeof e.location==='string' && e.location.length<=200 && typeof e.noteId==='string'; }
export function validNote(n) {return n&&typeof n.id==='string'&&n.id.length<=100&&['title','subtitle','folder','area','tag','updated'].every(k=>typeof n[k]==='string'&&n[k].length<=200)&&n.title.trim()&&typeof n.body==='string'&&n.body.length<=30000&&typeof n.pinned==='boolean'&&Array.isArray(n.links)&&n.links.length<=20&&n.links.every(x=>typeof x==='string'&&x.length<=100);}
export function loadState(raw) {
  try {if(!raw||raw.length>250000)return freshState();const s=JSON.parse(raw);if(s.version!==1||!SCENES.some(x=>x.id===s.scene)||!MATERIALS.some(x=>x.id===s.material)||!Array.isArray(s.events)||s.events.length>200||!s.events.every(validEvent)||!Array.isArray(s.notes)||s.notes.length>100||!s.notes.every(validNote)||new Set(s.events.map(e=>e.id)).size!==s.events.length||new Set(s.notes.map(n=>n.id)).size!==s.notes.length)return freshState();return {...s,favourites:Array.isArray(s.favourites)?s.favourites.filter(x=>typeof x==='string'&&/^(nocturne|orbit|silk|dawn)\/(alloy|glass|editorial|stack)$/.test(x)).slice(0,16):[]};}catch{return freshState();}
}
// Interval partitioning: every overlap cluster shares a deterministic column count.
export function layoutEvents(events) {
  const sorted=events.slice().sort((a,b)=>a.start-b.start||b.duration-a.duration||a.id.localeCompare(b.id));
  const output=[];let cluster=[],end=-1;
  const flush=()=>{const columns=[];const assigned=cluster.map(event=>{let col=columns.findIndex(e=>e<=event.start);if(col<0)col=columns.length;columns[col]=event.start+event.duration;return {...event,column:col};});output.push(...assigned.map(e=>({...e,columns:columns.length})));cluster=[];};
  for(const e of sorted){if(cluster.length&&e.start>=end){flush();end=-1;}cluster.push(e);end=Math.max(end,e.start+e.duration);}if(cluster.length)flush();return output;
}
export function draftRange(start,end) {const a=Math.min(1425,Math.max(0,Math.floor(start/15)*15)),b=Math.min(1425,Math.max(0,Math.floor(end/15)*15));return {start:Math.min(a,b),duration:Math.abs(a-b)+15};}
export function renderBody(body) {
  const output=[];let lines=[],kind='';
  const flush=()=>{if(!lines.length)return;output.push(kind==='list'?`<ul>${lines.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>`:`<p>${lines.map(esc).join('<br>')}</p>`);lines=[];};
  for(const line of body.split('\n')){
    if(!line.trim()){flush();kind='';continue;}
    if(line.startsWith('## ')){flush();kind='';output.push(`<h2>${esc(line.slice(3))}</h2>`);continue;}
    const next=line.startsWith('- ')?'list':'paragraph';if(next!==kind)flush();kind=next;lines.push(next==='list'?line.slice(2):line);
  }
  flush();return output.join('');
}
export const folderKey=(area,folder)=>JSON.stringify([area,folder]);
export const inFolder=(note,folder)=>folder==='All notes'||folder==='Pinned'&&note.pinned||folderKey(note.area,note.folder)===folder;
export function folderLabel(folder){try{const pair=JSON.parse(folder);if(Array.isArray(pair)&&pair.length===2)return pair[1];}catch{}return folder;}
