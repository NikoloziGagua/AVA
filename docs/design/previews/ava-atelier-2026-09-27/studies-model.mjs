// Preferences and text belong only to this isolated preview, never to live AVA.
export const STUDY_KEY = 'ava:atelier:studies:20260927:v1';
export const CARDS = [
  {id:'open',name:'Open form',tag:'TYPE, NOT A CONTAINER',detail:'One oversized time. An open composition. The background does the holding.',use:'A single important thing on Today.'},
  {id:'signal',name:'Signal',tag:'ONE CONTINUOUS LINE',detail:'An illuminated strip, a quiet pulse and information that reads in one glance.',use:'The next commitment, without another panel.'},
  {id:'cut',name:'Cut / 03',tag:'PRECISION-MILLED',detail:'A chamfered edge, engraved information and a silver ticket you want to pick up.',use:'An event or an important saved object.'},
  {id:'orbit',name:'Time object',tag:'AN INSTRUMENT, NOT A TILE',detail:'A sixty-minute dial carries the event. Type stays still while the light moves.',use:'One upcoming event. Not a progress indicator.'},
  {id:'split',name:'Twin plane',tag:'TWO SURFACES, ONE THOUGHT',detail:'Time on a small silver plane; the story on graphite. Depth through separation.',use:'A small collection of genuinely different objects.'},
  {id:'index',name:'Living index',tag:'QUIET UNTIL YOU ASK',detail:'A compact editorial row that opens into its own reading space.',use:'A list of notes, commitments or ideas.'},
];
export const NAVS = [
  {id:'rail',name:'Liquid rail',detail:'One silver selection glides beneath the labels. Stable targets; no jumping text.'},
  {id:'dock',name:'Proximity dock',detail:'Icons rise toward your pointer or keyboard focus. Labels stay readable.'},
  {id:'capsule',name:'Command capsule',detail:'One compact object unfolds into four destinations. Escape brings you back.'},
  {id:'line',name:'Light trace',detail:'Almost no chrome. A traveling thread of light marks where you are.'},
];
export const CHATS = [
  {id:'quiet',name:'Quiet voice',detail:'An open page, generous typography and just the conversation.'},
  {id:'studio',name:'Thinking studio',detail:'The conversation beside its source. Context is a pull-out, not a dashboard.'},
  {id:'editorial',name:'Editorial thread',detail:'A question-led composition, with the answer as a calm, structured brief.'},
];
export const DESTINATIONS = [
  {id:'home',label:'Home',icon:'spark'}, {id:'talk',label:'Talk',icon:'quote'},
  {id:'notes',label:'Notes',icon:'book'}, {id:'calendar',label:'Calendar',icon:'calendar'},
];
export function freshStudies(){return {version:1,card:'cut',nav:'rail',chat:'quiet',draft:'',messages:[],saved:[]};}
export function loadStudies(raw){
  const defaults=freshStudies();
  try{
    if(typeof raw!=='string'||raw.length>200000)return defaults;
    const s=JSON.parse(raw);if(s?.version!==1)return defaults;
    return {...defaults,
      card:CARDS.some(x=>x.id===s.card)?s.card:defaults.card,
      nav:NAVS.some(x=>x.id===s.nav)?s.nav:defaults.nav,
      chat:CHATS.some(x=>x.id===s.chat)?s.chat:defaults.chat,
      draft:typeof s.draft==='string'?s.draft.slice(0,2000):'',
      messages:Array.isArray(s.messages)?s.messages.filter(x=>typeof x==='string'&&x.trim()&&x.length<=2000).slice(-12):[],
      saved:Array.isArray(s.saved)?[...new Set(s.saved.filter(x=>CARDS.some(c=>c.id===x)))]:[],
    };
  }catch{return defaults;}
}
export function addMessage(state,text){
  if(typeof text!=='string'||!text.trim()||text.length>2000)return state;
  return {...state,draft:'',messages:[...state.messages,text].slice(-12)};
}
export function sceneForPage(page,legacy='nocturne'){
  return page==='materials'?legacy:['notes','navigation'].includes(page)?'silk':'nocturne';
}
