import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createPreviewServer} from './serve.mjs';
import {CARDS,NAVS,CHATS,STUDY_KEY} from './studies-model.mjs';
const out='data/builds/atelier-studies-verification';await mkdir(out,{recursive:true});
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],external=[],results=[];
const check=(name,value)=>{assert.ok(value,name);results.push(name);console.log('PASS',name);};
async function open(width=1440,reducedMotion='no-preference'){
 const ctx=await browser.newContext({viewport:{width,height:1000},reducedMotion});const page=await ctx.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(r.url());});
 await page.goto(base);await page.evaluate(()=>document.fonts.ready);return page;
}
async function layout(page,label){
 const m=await page.evaluate(()=>({w:innerWidth,sw:document.documentElement.scrollWidth,small:[...document.querySelectorAll('main *')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<12).map(e=>e.className)}));
 check(`${label}: no horizontal page overflow`,m.sw<=m.w);check(`${label}: 12px text floor`,!m.small.length);
}
async function navigate(page,route){await page.locator(`[data-tab=${route}]`).click();await page.waitForFunction(r=>document.body.dataset.page===r,route);}
async function capture(page,name){await page.waitForTimeout(550);await page.screenshot({path:`${out}/${name}.png`,fullPage:false});}
try{
 const page=await open();check('fresh route opens new card studies',await page.locator('body').getAttribute('data-page')==='cards');
 for(const c of CARDS){
  await page.locator(`.study-picker [data-study-card=${c.id}]`).click();
  check(`${c.id}: actual chosen structure`,await page.locator('.object-hero [data-object]').getAttribute('data-object')===c.id);
  await layout(page,`desktop card ${c.id}`);await page.locator('.object-stage').scrollIntoViewIfNeeded();await capture(page,`card-${c.id}-1440`);
 }
 await page.locator('.save-study').click();await page.reload();check('card and shortlist survive reload',await page.locator('.save-study').getAttribute('aria-pressed')==='true'&&await page.locator('.object-hero [data-object]').getAttribute('data-object')==='index');
 const fold=page.locator('.object-hero .index-fold');await fold.locator('summary').focus();await page.keyboard.press('Enter');check('index collapses from keyboard',!await fold.getAttribute('open'));await page.keyboard.press('Enter');check('index expands from keyboard',await fold.evaluate(e=>e.open));
 await page.locator('.object-hero a[href="#notes"]').click();check('card links Notes',await page.locator('.document').count()===1);
 await page.goBack();await page.waitForFunction(()=>document.body.dataset.page==='cards');check('browser Back restores chosen card',await page.locator('.object-hero [data-object]').getAttribute('data-object')==='index');
 await navigate(page,'navigation');
 for(const n of NAVS){
  await page.locator(`[data-study-nav=${n.id}]`).click();const nav=page.locator('.motion-nav');
  if(n.id==='capsule')await nav.locator('.capsule-toggle').click();
  await nav.locator('[data-destination=notes]').focus();await page.keyboard.press('Enter');
  check(`${n.id}: keyboard destination changes`,await page.locator('#destination-title').innerText()==='Pick up the thread.');
  if(n.id==='capsule'){
   check('capsule closes and returns focus after selection',await nav.locator('.capsule-toggle').evaluate(e=>e===document.activeElement&&e.getAttribute('aria-expanded')==='false'));
   await nav.locator('.capsule-toggle').click();await page.keyboard.press('Escape');check('capsule Escape returns focus',await nav.locator('.capsule-toggle').evaluate(e=>e===document.activeElement));
  }
  if(n.id==='rail'){
   await page.waitForTimeout(550);const selection=await nav.locator('.nav-selection').boundingBox(),button=await nav.locator('[data-destination=notes]').boundingBox();
   check('rail selection settles exactly beneath chosen button',Math.abs(selection.x-button.x)<1&&Math.abs(selection.width-button.width)<1);
  }
  await layout(page,`desktop nav ${n.id}`);await page.locator('.navigation-stage').scrollIntoViewIfNeeded();await capture(page,`nav-${n.id}-1440`);
 }
 await page.locator('[data-study-nav=rail]').click();
 const selected=page.locator('.nav-selection');await page.locator('[data-destination=home]').click();await page.waitForTimeout(520);const before=await selected.evaluate(e=>getComputedStyle(e).transform);await page.locator('[data-destination=calendar]').click();await page.waitForTimeout(530);check('rail indicator visibly travels',before!==await selected.evaluate(e=>getComputedStyle(e).transform));
 await navigate(page,'talk');
 const draft='Add the database\nUse _princi150 exactly. <script>no()</script>';
 await page.locator('#preview-draft').fill(draft);
 for(const c of CHATS){await page.locator(`[data-study-chat=${c.id}]`).click();check(`${c.id}: preserves exact draft`,await page.locator('#preview-draft').inputValue()===draft);await layout(page,`desktop chat ${c.id}`);await page.locator('.conversation-shell').scrollIntoViewIfNeeded();await capture(page,`chat-${c.id}-1440`);}
 await page.reload();check('draft survives reload',await page.locator('#preview-draft').inputValue()===draft);
 await page.locator('#preview-draft').press('Enter');check('explicit Enter appends only local message',await page.locator('.local-message').count()===1&&await page.locator('.local-message>p').textContent()===draft);check('raw message HTML remains inert',await page.locator('.local-message script').count()===0);
 await page.locator('#preview-draft').press('Enter');check('blank Enter does not duplicate',await page.locator('.local-message').count()===1);
 await page.locator('[data-suggestion]').first().click();check('suggestion fills without sending',await page.locator('#preview-draft').inputValue()==='Help me understand feedback loops.'&&await page.locator('.local-message').count()===1);
 await page.locator('#preview-draft').press('Shift+Enter');check('Shift Enter remains a draft',await page.locator('.local-message').count()===1);
 await page.locator('#preview-draft').evaluate(e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));check('IME Enter does not submit',await page.locator('.local-message').count()===1);
 await page.locator('#context-toggle').click();check('context drawer opens',await page.locator('#chat-source-drawer').isVisible());await page.locator('#context-toggle').click();check('context drawer closes',!await page.locator('#chat-source-drawer').isVisible());
 await page.locator('.sample-activity summary').click();check('activity is honest sample context',await page.locator('.sample-activity p').isVisible()&&await page.locator('.sample-activity p').innerText().then(t=>t.includes('No tools were called')));
 await page.locator('#chat-nav').selectOption('capsule');await page.locator('.capsule-toggle').click();await page.locator('[data-destination=notes]').click();await page.waitForFunction(()=>document.body.dataset.page==='notes');
 check('Notes uses Silver Silk',await page.locator('#atmosphere').getAttribute('data-scene')==='silk');
 const dark=await page.locator('.document').evaluate(e=>getComputedStyle(e).backgroundColor);check('Notes reader is genuinely dark',dark.startsWith('rgba(22, 28, 37')||dark==='rgb(22, 28, 37)');
 const contrast=await page.locator('.notes-page').evaluate(root=>{
  const luminance=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  const background=luminance([43,53,66]); // brightest selected-note surface, conservative for darker reader.
  return [...root.querySelectorAll('.note-row-meta,.note-row p,.note-row>small,.document-subtitle,.document-breadcrumb')].map(e=>{
   const color=getComputedStyle(e).color.match(/[\d.]+/g).slice(0,3).map(Number);return (luminance(color)+.05)/(background+.05);
  });
 });check('dark Notes metadata meets 4.5:1 against brightest reading/list surface',Math.min(...contrast)>=4.5);
 await capture(page,'notes-dark-1440');await page.locator('#edit-note').click();check('Notes editor is dark',await page.locator('dialog[open]').evaluate(e=>getComputedStyle(e).backgroundColor==='rgb(26, 35, 48)'));await capture(page,'notes-editor-dark');await page.keyboard.press('Escape');
 await navigate(page,'calendar');check('Calendar uses Nocturne',await page.locator('#atmosphere').getAttribute('data-scene')==='nocturne');await capture(page,'calendar-preserved-1440');
 await page.locator('.skip-link').focus();await page.keyboard.press('Enter');check('skip link focuses current workspace without changing route',await page.locator('body').getAttribute('data-page')==='calendar'&&await page.locator('#content').evaluate(e=>e===document.activeElement));
 for(const width of [390,320]){
  const p=await open(width);
  for(const c of CARDS){await p.locator(`.study-picker [data-study-card=${c.id}]`).click();await layout(p,`${width} card ${c.id}`);await p.locator('.object-stage').scrollIntoViewIfNeeded();await capture(p,`card-${c.id}-${width}`);}
  await navigate(p,'navigation');
  for(const n of NAVS){await p.locator(`[data-study-nav=${n.id}]`).click();if(n.id==='capsule')await p.locator('.capsule-toggle').click();await p.locator('[data-destination=calendar]').click();await layout(p,`${width} nav ${n.id}`);await p.locator('.navigation-stage').scrollIntoViewIfNeeded();await capture(p,`nav-${n.id}-${width}`);}
  await navigate(p,'talk');
  for(const c of CHATS){await p.locator(`[data-study-chat=${c.id}]`).click();await layout(p,`${width} chat ${c.id}`);await p.locator('.conversation-shell').scrollIntoViewIfNeeded();await capture(p,`chat-${c.id}-${width}`);}
  await navigate(p,'notes');await layout(p,`${width} dark Notes`);await p.locator('#note-list [data-note]').first().click();await capture(p,`notes-dark-${width}`);await layout(p,`${width} dark reader`);
  await p.context().close();
 }
 const reduced=await open(390,'reduce');await navigate(reduced,'navigation');await reduced.locator('[data-study-nav=dock]').click();await reduced.locator('[data-destination=notes]').focus();check('reduced motion dock has no magnification',await reduced.locator('[data-destination=notes] .nav-symbol').evaluate(e=>getComputedStyle(e).transform==='none'));check('reduced motion backdrop static',await reduced.locator('body').getAttribute('data-paused')==='true');
 await reduced.emulateMedia({forcedColors:'active'});await capture(reduced,'forced-colors-nav');await layout(reduced,'forced-colors');await reduced.context().close();
 await navigate(page,'cards');await page.locator('[data-study-card=orbit]').first().click();await page.getByRole('button',{name:'Pause motion',exact:true}).click();check('manual pause stops dial animation',await page.locator('.object-hero .dial-light').evaluate(e=>getComputedStyle(e).animationName==='none'));
 await page.evaluate(key=>localStorage.setItem(key,'{"version":1,"card":"bad","draft":"<script>"}'),STUDY_KEY);await page.reload();check('malformed identifiers recover to known designs',await page.locator('.object-hero [data-object]').getAttribute('data-object')==='cut');
 check('zero console or page errors',errors.length===0);check('zero external or AVA API requests',external.length===0);
 await writeFile(`${out}/results.json`,JSON.stringify({assertions:results.length,results,errors,external},null,2));console.log(JSON.stringify({assertions:results.length,errors,external}));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
