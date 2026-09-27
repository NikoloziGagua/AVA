import { SCENES,MATERIALS,STORAGE_KEY,esc,loadState } from './model.mjs';
import { icon } from './icons.mjs';
import { mountBackdrop } from './backdrop.mjs';
import { calendarView, bindCalendar } from './calendar.mjs';
import { notesView, bindNotes } from './notes.mjs';
import { studiesView, bindStudies } from './studies.mjs';
import { sceneForPage } from './studies-model.mjs';
const content=document.querySelector('#content');
let initial;try{initial=localStorage.getItem(STORAGE_KEY);}catch{}
let state=loadState(initial),paused=false,route='',toastTimer=0,cleanup=()=>{},focusSearch=false;
const backdrop=mountBackdrop(document.querySelector('#atmosphere'));
const dialog=document.querySelector('#editor-dialog');
const choices=document.querySelector('#choices-dialog');
const ui={calendarDate:'2026-09-28',calendarView:innerWidth<760?'day':'week',category:'all',note:'agile',folder:'All notes',query:'',focus:false,notePane:'list',stackIndex:0};
export const api={
  get state(){return state;},ui,icon,esc,render,
  update(change,message){state=change(state);try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));if(message)toast(message);}catch{toast('Browser storage is unavailable. Changes last for this visit only.');} },
  toast,navigate(name){location.hash=name;},
  openDialog(html,onOpen){const previous=document.activeElement;dialog.innerHTML=html;dialog.showModal();dialog.querySelector('[data-close]')?.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{if(previous?.isConnected)previous.focus();},{once:true});onOpen?.(dialog);},
  closeDialog(){dialog.close();},
};
function toast(message){clearTimeout(toastTimer);const el=document.querySelector('#toast');el.textContent=message;el.classList.add('visible');toastTimer=setTimeout(()=>el.classList.remove('visible'),4500);}
function renderCard(type,compact=false){
  const index=type==='stack'&&!compact?ui.stackIndex:0;
  const items=[{title:'Agile Development',start:'09:00',end:'10:00',category:'LECTURE / 04',location:'Room B204',status:'Attending'},{title:'Independent study',start:'14:00',end:'15:30',category:'FOCUS / 02',location:'The library',status:'Planned'},{title:'Software Engineering',start:'11:00',end:'12:00',category:'LECTURE / 05',location:'Room A102',status:'Attending'}];
  const e=items[index];
  return `<article class="study-card card-${type} ${compact?'compact':''}" data-card="${type}"><div class="card-sheen" aria-hidden="true"></div><div class="card-number">${type==='stack'?`${String(index+1).padStart(2,'0')} / 03`:'MON / 28'}</div><div class="card-top"><span class="card-eyebrow">${e.category}</span><span class="card-emblem">${icon(type==='editorial'?'book':'spark',19)}</span></div><div class="card-time">${e.start}<span>— ${e.end}</span></div><h3>${e.title}</h3><p class="card-description">A small step forward.<br>A little closer to understanding.</p><div class="card-meta"><span>${icon('calendar',15)} ${e.location}</span><span><i></i>${e.status}</span></div><div class="card-bottom"><button class="card-open" data-card-open="${type}">Open your day ${icon('arrow',17)}</button>${type==='stack'?`<button class="stack-next icon-button" aria-label="Next folio card" ${compact?'disabled':''}>${icon('layers',19)}</button>`:`<span class="card-duration">60 min</span>`}</div></article>`;
}
function materials(){
  const scene=SCENES.find(s=>s.id===state.scene),material=MATERIALS.find(m=>m.id===state.material);
  return `<section class="material-stage"><div class="stage-heading"><div class="eyebrow"><span class="live-dot"></span> A NEW DIRECTION, NOT A NEW COAT OF PAINT</div><h1>A little more<br><em>extraordinary.</em></h1><p>AVA should feel alive.<br>And still give you room to think.</p><div class="stage-caption"><span>${scene.number} / ${scene.name}</span><small>${scene.subtitle}</small></div><div class="quick-pickers"><label>Background<select id="quick-scene">${SCENES.map(x=>`<option value="${x.id}" ${x.id===state.scene?'selected':''}>${x.name}</option>`).join('')}</select></label><label>Card material<select id="quick-material">${MATERIALS.map(x=>`<option value="${x.id}" ${x.id===state.material?'selected':''}>${x.name}</option>`).join('')}</select></label></div><button class="text-button" id="open-choices">My shortlist ${icon('arrow',17)}</button></div><div class="hero-card-wrap">${renderCard(state.material)}<p class="hero-label">${material.number} / ${material.name}<span>Same day. A different feeling.</span></p></div><div class="stage-footer"><span>4 atmospheres × 4 materials. Try your own combination.</span><button class="pill" id="favourite">${icon('heart',16)} ${state.favourites.includes(state.scene+'/'+state.material)?'Shortlisted':'Keep this pairing'}</button></div></section>
  <section class="design-console" aria-label="Compare design directions"><div class="console-section"><div class="section-label"><span>01 / ATMOSPHERE</span><p>Give AVA a sense of place.</p></div><div class="scene-options">${SCENES.map(s=>`<button class="scene-option ${s.id===state.scene?'selected':''}" data-scene-choice="${s.id}" aria-pressed="${s.id===state.scene}"><span class="scene-swatch swatch-${s.id}"><i></i><b>${s.number}</b></span><span>${s.name}</span><small>${s.subtitle}</small></button>`).join('')}</div><p class="selection-explanation"><b>${scene.use}.</b> ${scene.detail}</p></div>
  <div class="console-section"><div class="section-label"><span>02 / MATERIAL</span><p>Four ideas of what a card can be.</p></div><div class="material-options">${MATERIALS.map(m=>`<button class="material-option ${m.id===state.material?'selected':''}" data-material-choice="${m.id}" aria-pressed="${m.id===state.material}"><span>${m.number}</span><div><b>${m.name}</b><small>${m.subtitle}</small></div>${icon(m.id==='alloy'?'layers':m.id==='glass'?'globe':m.id==='editorial'?'type':'book',22)}</button>`).join('')}</div><p class="selection-explanation"><b>${material.use}.</b> ${material.detail}</p></div></section>
  <section class="card-comparison"><div class="section-title"><div><span class="eyebrow">THE SAME CONTENT. FOUR DIFFERENT PERSONALITIES.</span><h2>See them side by side.</h2></div><span class="sample-caption">Illustrative schedule · not live data</span></div><div class="comparison-grid">${MATERIALS.map(m=>`<div class="comparison-item"><div class="comparison-label">${m.number} / ${m.name}</div>${renderCard(m.id,true)}<button class="text-button" data-use-material="${m.id}">Try ${m.name.toLowerCase()} ${icon('up',15)}</button></div>`).join('')}</div></section>
  <footer class="concept-footer"><p>Previous round: these four cards were rejected.<br>Nocturne and Silver Silk remain the chosen atmospheres; Notes is now dark.</p><a href="#cards">See the new card directions ${icon('arrow',18)}</a><span>Archive only · local sample data · zero AVA API calls</span></footer>`;
}
const references=[
 ['Rauno','Interfaces with physical intuition','https://rauno.me/craft','Toolbar morphs, spatial controls and dock studies. Our navigation uses stable targets with moving selection and bounded icon lift; no source code copied.'],
 ['Magic UI Dock','Motion around the pointer','https://magicui.design/docs/components/dock','A dock can feel alive without moving the target itself. Our original proximity study also responds to keyboard focus.'],
 ['Aceternity','Reveal more, only when asked','https://ui.aceternity.com/components/expandable-card','Expandable composition informed the living index and command capsule. Native details and buttons keep this preview dependency-free.'],
 ['React Bits','A wider shape vocabulary','https://www.reactbits.dev/get-started/index','Dock, pill navigation and reflective card references encouraged genuinely different silhouettes rather than recoloring the same rectangle.'],
 ['Vercel Geist','Selection should stay legible','https://vercel.com/geist/tabs','Clear labels and selection semantics inform the preview switchers. Motion supplements the current state; it never replaces it.'],
 ['assistant-ui','Conversation is a working surface','https://www.assistant-ui.com/','Reviewed for conversational composition. Our three original chat studies keep sources near the answer and drafts intact; no assistant-ui runtime is installed.'],
 ['Linear','Structure without clutter','https://linear.app/now/behind-the-latest-design-refresh','Quiet navigation, consistent actions, deliberate hierarchy. Borrow the discipline, not the entire app.'],
 ['Notion Calendar','Time is the interface','https://www.notion.com/product/calendar','A readable time canvas, quick navigation and documents connected to events. No oversized cards around every hour.'],
 ['Craft','Notes deserve a beautiful page','https://www.craft.do/','A document-first canvas with folders behind it. Give writing room; move metadata out of the way.'],
 ['Reflect','Connected thinking','https://reflect.app/','Search and linked notes keep ideas connected. Context should be discoverable without turning everything into a graph.'],
 ['Raycast','Useful controls, tactile details','https://www.raycast.com/','Fast, compact actions and keyboard-first interaction. Material is an accent, not an obstacle.'],
 ['Paper','Light that feels like a material','https://shaders.paper.design/','Explore fluid, fluted and metallic motion. These preview backgrounds are original Canvas2D studies, not copied shaders.'],
 ['Magic UI','Pointer light','https://v3.magicui.design/docs/components/magic-card','A soft spotlight can make a surface feel physical. Here it is restrained and never distorts text.'],
 ['21st','A broad interaction palette','https://21st.dev/','Component catalogue reviewed for possibilities. No catalogue dependency or unreviewed generated code is installed.'],
];
function referenceView(){return `<section class="references-page"><span class="eyebrow">RESEARCH / SEPTEMBER 2026 / ROUND 03</span><h1>Something you feel.<br><em>Every time you use it.</em></h1><p class="lede">Niko's direction: keep Nocturne and Silver Silk, keep the Calendar and Notes layouts, make Notes dark, rethink the cards. Then make navigation and conversation feel alive.</p><div class="reference-grid">${references.map(([name,title,url,body])=>`<a class="reference" href="${url}" target="_blank" rel="noopener noreferrer"><span>${name}${icon('up',17)}</span><h2>${title}</h2><p>${body}</p></a>`).join('')}</div><div class="research-note"><h2>What this round explores</h2><p>Six card structures, four animated navigation alternatives and three text-chat compositions. The previous cards are archived, not endorsed. Calendar stays on Nocturne; Notes and navigation studies use Silver Silk. No automatic atmosphere switching while you read.</p><p>All code and visual studies are original. No component library, copied website assets or new dependency installed. A local draft is not an AVA message. Sample context is not a tool trace or hidden reasoning.</p><p>One Canvas2D backdrop. Zero WebGL contexts. Motion can be paused; reduced motion is automatic. No physical-phone performance claim.</p><a class="text-button" href="#materials">Previous round / rejected card archive ${icon('arrow',18)}</a></div></section>`;}
function bindMaterials(){
  for(const key of ['scene','material'])document.querySelector(`#quick-${key}`).onchange=e=>{api.update(s=>({...s,[key]:e.target.value}));render(false);document.querySelector(`#quick-${key}`)?.focus({preventScroll:true});};
  document.querySelectorAll('[data-scene-choice]').forEach(b=>b.addEventListener('click',()=>{const top=scrollY;api.update(s=>({...s,scene:b.dataset.sceneChoice}));render(false);scrollTo(0,top);document.querySelector(`[data-scene-choice="${state.scene}"]`)?.focus({preventScroll:true});}));
  document.querySelectorAll('[data-material-choice],[data-use-material]').forEach(b=>b.addEventListener('click',()=>{const value=b.dataset.materialChoice||b.dataset.useMaterial,top=scrollY;api.update(s=>({...s,material:value}));render(false);scrollTo(0,b.dataset.useMaterial?0:top);document.querySelector(`[data-material-choice="${value}"]`)?.focus({preventScroll:true});}));
  document.querySelectorAll('[data-card-open]').forEach(b=>b.addEventListener('click',()=>api.navigate('calendar')));
  document.querySelector('.hero-card-wrap .stack-next')?.addEventListener('click',()=>{ui.stackIndex=(ui.stackIndex+1)%3;const y=scrollY;render(false);scrollTo(0,y);document.querySelector('.hero-card-wrap .stack-next')?.focus({preventScroll:true});});
  document.querySelector('#favourite')?.addEventListener('click',()=>{const pair=state.scene+'/'+state.material;api.update(s=>({...s,favourites:s.favourites.includes(pair)?s.favourites.filter(p=>p!==pair):[...s.favourites,pair]}),'Shortlist updated on this browser.');const y=scrollY;render(false);scrollTo(0,y);document.querySelector('#favourite').focus({preventScroll:true});});
  document.querySelector('#open-choices')?.addEventListener('click',()=>{
    choices.innerHTML=`<button class="dialog-close icon-button" aria-label="Close shortlist">${icon('close')}</button><span class="eyebrow">YOUR DESIGN DIRECTION</span><h2 id="choices-title">A little shortlist.</h2><p>These are preferences, not an instruction to change live AVA.</p><ul class="shortlist">${state.favourites.map(pair=>{const [s,m]=pair.split('/');return `<li>${SCENES.find(x=>x.id===s).name}<span>+</span>${MATERIALS.find(x=>x.id===m).name}</li>`;}).join('')||'<li>No pairings yet. Try the materials, then keep one.</li>'}</ul><button class="primary-button" id="export-choices">${icon('download',17)} Download my choices</button>`;
    choices.showModal();choices.querySelector('.dialog-close').onclick=()=>choices.close();choices.querySelector('#export-choices').onclick=()=>{const blob=new Blob([JSON.stringify({schema:1,purpose:'Design discussion only',createdAt:new Date().toISOString(),selected:{background:state.scene,card:state.material},shortlist:state.favourites},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ava-design-choices.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  });
  document.querySelectorAll('.study-card').forEach(card=>card.addEventListener('pointermove',e=>{const r=card.getBoundingClientRect();card.style.setProperty('--mx',`${e.clientX-r.left}px`);card.style.setProperty('--my',`${e.clientY-r.top}px`);}));
}
function render(scroll=true){
  cleanup();cleanup=()=>{};
  const next=location.hash.slice(1);route=['cards','navigation','talk','materials','calendar','notes','references'].includes(next)?next:'cards';
  document.body.dataset.page=route;document.body.dataset.scene=sceneForPage(route,state.scene);document.body.dataset.material=state.material;
  // Workspaces choose a deliberate quieter atmosphere; comparison preferences stay intact.
  backdrop.setScene(sceneForPage(route,state.scene));
  document.querySelectorAll('[data-tab]').forEach(a=>{if(a.dataset.tab===route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  content.innerHTML=['cards','navigation','talk'].includes(route)?studiesView(route):route==='materials'?materials():route==='calendar'?calendarView(api):route==='notes'?notesView(api):referenceView();
  if(['cards','navigation','talk'].includes(route))cleanup=bindStudies(api,route);else if(route==='materials')bindMaterials();else if(route==='calendar')cleanup=bindCalendar(api);else if(route==='notes')cleanup=bindNotes(api);
  if(scroll){window.scrollTo(0,0);content.focus({preventScroll:true});}
  if(focusSearch){focusSearch=false;document.querySelector('#note-search')?.focus();}
}
const motion=document.querySelector('#motion-toggle');
function motionLabel(){motion.innerHTML=icon(paused||backdrop.reduced?'play':'pause',17);motion.setAttribute('aria-label',backdrop.reduced?'Reduced motion is active':paused?'Resume motion':'Pause motion');motion.title=motion.getAttribute('aria-label');motion.disabled=backdrop.reduced;document.body.dataset.paused=String(paused||backdrop.reduced);}
motion.onclick=()=>{paused=!paused;backdrop.setPaused(paused);motionLabel();};
document.querySelector('.skip-link').onclick=e=>{e.preventDefault();content.focus();content.scrollIntoView({block:'start',behavior:'instant'});};
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',motionLabel);
window.addEventListener('hashchange',()=>{dialog.close();choices.close();render();});
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'&&!dialog.open&&!choices.open){e.preventDefault();ui.focus=false;ui.notePane='list';focusSearch=true;if(route!=='notes')location.hash='notes';else render(false);}});
motionLabel();render(false);
