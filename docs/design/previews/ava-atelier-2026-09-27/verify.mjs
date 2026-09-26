import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createPreviewServer} from './serve.mjs';
import {STORAGE_KEY,MINUTE_PX} from './model.mjs';
const out='data/builds/atelier-verification';await mkdir(out,{recursive:true});
const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],external=[],results=[];
const check=(name,condition=true)=>{assert.ok(condition,name);results.push(name);console.log('PASS',name);};
async function open(width=1440,reducedMotion='no-preference'){
 const ctx=await browser.newContext({viewport:{width,height:1000},reducedMotion});const page=await ctx.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(r.url());});
 await page.goto(base);await page.evaluate(()=>document.fonts.ready);return page;
}
async function layout(page,label){const measure=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,small:[...document.querySelectorAll('main *')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<12).map(e=>e.className)}));check(`${label}: no horizontal page overflow`,measure.scroll<=measure.width);check(`${label}: 12px text floor`,!measure.small.length);}
async function stored(page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORAGE_KEY);}
try{
 const page=await open();
 for(const scene of ['nocturne','orbit','silk','dawn'])for(const material of ['alloy','glass','editorial','stack']){
  await page.locator('#quick-scene').selectOption(scene);await page.locator('#quick-material').selectOption(material);
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  check(`pairing ${scene}/${material}`,await page.locator('.hero-card-wrap [data-card]').getAttribute('data-card')===material);
  await layout(page,`${scene}/${material}`);
  if(material==='alloy'){
   const pixels=await page.locator('canvas').evaluate(c=>c.toDataURL());await page.waitForTimeout(180);
   check(`${scene}: actual pixels animate`,pixels!==await page.locator('canvas').evaluate(c=>c.toDataURL()));
   await page.screenshot({path:`${out}/background-${scene}.png`});
  }
  if(scene==='nocturne')await page.screenshot({path:`${out}/card-${material}.png`});
 }
 await page.locator('#favourite').click();await page.locator('#open-choices').click();
 const download=page.waitForEvent('download');await page.locator('#export-choices').click();const dl=await download;check('shortlist JSON download',dl.suggestedFilename()==='ava-design-choices.json');
 await page.keyboard.press('Escape');await page.reload();check('pairing survives reload',(await stored(page)).material==='stack'&&(await stored(page)).favourites.includes('dawn/stack'));
 await page.getByRole('button',{name:'Pause motion',exact:true}).click();const frame=await page.locator('canvas').getAttribute('data-frame');await page.waitForTimeout(250);check('manual motion pause',frame===await page.locator('canvas').getAttribute('data-frame'));
 await page.getByRole('button',{name:'Resume motion',exact:true}).click();await page.waitForTimeout(150);check('motion resumes',frame!==await page.locator('canvas').getAttribute('data-frame'));
 await page.locator('[data-tab=calendar]').click();await page.locator('#new-event').click();check('event dialog is modal',await page.locator('dialog[open]').count()===1);
 await page.getByRole('textbox',{name:'Event title',exact:true}).fill('Cancelled sample');await page.keyboard.press('Escape');check('cancel creates nothing',(await stored(page)).events.length===7);check('cancel restores keyboard focus',await page.locator('#new-event').evaluate(e=>e===document.activeElement));
 await page.locator('#new-event').click();await page.getByRole('textbox',{name:'Event title',exact:true}).fill('A considered hour');await page.getByLabel('Start time',{exact:true}).fill('15:00');await page.getByLabel('Duration',{exact:true}).selectOption('45');await page.getByRole('button',{name:'Create time block'}).click();
 let data=await stored(page),created=data.events.find(e=>e.title==='A considered hour');check('explicit event save',created?.start===900&&created.duration===45);
 await page.reload();await page.locator(`[data-event="${created.id}"]`).first().click();check('event survives reload',await page.getByRole('textbox',{name:'Event title',exact:true}).inputValue()==='A considered hour');await page.getByLabel('Attendance',{exact:true}).selectOption('Independent study');await page.getByRole('button',{name:'Save changes'}).click();check('attendance intent saved',(await stored(page)).events.find(e=>e.id===created.id).attendance==='Independent study');
 await page.locator('[data-view=month]').click();await layout(page,'month');await page.screenshot({path:`${out}/calendar-month.png`});await page.locator('.month-day[data-date="2026-09-28"]').click();check('month opens exact day',await page.locator('[data-view=day]').getAttribute('aria-pressed')==='true');
 // True mouse range creation; 15-minute cells, 45-minute total range.
 const col=page.locator('[data-column="2026-09-28"]');const rect=await col.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+780*MINUTE_PX+3);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2,rect.y+810*MINUTE_PX+3,{steps:5});await page.mouse.up();check('mouse range creates 45-minute draft',await page.getByLabel('Duration',{exact:true}).inputValue()==='45');await page.keyboard.press('Escape');
 // Native HTML5 drop path with exact local ID, then undo.
 await col.evaluate((el,id)=>{const dt=new DataTransfer();dt.setData('application/x-ava-atelier-event',id);el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,clientY:el.getBoundingClientRect().top+845*4/3}));},created.id);
 check('drag move persisted',(await stored(page)).events.find(e=>e.id===created.id).start===840);await page.locator('#undo-move').click();check('undo restores exact event',(await stored(page)).events.find(e=>e.id===created.id).start===900);
 await page.locator(`[data-event="${created.id}"]`).first().click();await page.getByRole('button',{name:'Delete sample event'}).click();check('fixture event deleted',(await stored(page)).events.length===7);
 await page.locator('[data-view=week]').click();await page.screenshot({path:`${out}/calendar-week.png`});await page.locator('[data-event="lecture-1"]').first().click();await page.locator('#linked-note').click();check('event links exact note',await page.locator('.document-page>h1').innerText()==='Agile Development');
 check('note paragraphs not swallowed into headings',await page.locator('.document-body h2').first().innerText()==='The idea worth keeping');await page.screenshot({path:`${out}/notes-desktop.png`});
 await page.locator('#note-search').fill('boundaries');check('note search matches body',await page.locator('#note-list [data-note]').count()===1);await page.locator('#note-list [data-note]').click();
 await page.locator('#edit-note').click();await page.getByLabel('Note title',{exact:true}).fill('<img src=x onerror=alert(1)>');await page.getByLabel('Note body',{exact:true}).fill('## A safe heading\nWords worth keeping.\n\n- First thought\n- Second thought');await page.getByRole('button',{name:'Save note',exact:true}).click();
 check('HTML rendered as text, never executed',await page.locator('.document-page>h1').innerText()==='<img src=x onerror=alert(1)>'&&await page.locator('.document-page img').count()===0);
 await page.reload();check('edited note persists',(await stored(page)).notes.find(n=>n.id==='software').body.includes('Words worth keeping.'));
 await page.locator('#new-note').click();await page.getByLabel('Note title',{exact:true}).fill('A new thought');await page.getByLabel('Note space',{exact:true}).fill('Life');await page.getByLabel('Note folder',{exact:true}).fill('Fresh thinking');await page.getByLabel('Note body',{exact:true}).fill('Keep it simple.');await page.getByRole('button',{name:'Save note',exact:true}).click();check('new note and folder',(await stored(page)).notes.length===5&&await page.locator('.folder-child').filter({hasText:'Fresh thinking'}).count()===1);
 await page.locator('#pin-note').click();check('pin state persists',(await stored(page)).notes.find(n=>n.title==='A new thought').pinned);
 await page.locator('#focus-note').click();check('focus mode hides index',!await page.locator('.note-index').isVisible());await page.keyboard.press('Enter');check('focus toggle keyboard operation',await page.locator('.note-index').isVisible());
 await page.locator('#ask-note').click();check('honest conversational preview',(await page.locator('#editor-dialog').innerText()).includes('does not contact AVA'));await page.keyboard.press('Escape');
 await page.locator('[data-tab=calendar]').click();await page.goBack();check('browser Back restores Notes',await page.locator('[data-tab=notes]').getAttribute('aria-current')==='page');
 await page.keyboard.press('Control+k');check('keyboard search shortcut',await page.locator('#note-search').evaluate(e=>e===document.activeElement));
 for(const width of [390,320]){
  const p=await open(width);
  for(const material of ['alloy','glass','editorial','stack']){await p.locator('#quick-material').selectOption(material);await layout(p,`${width} ${material}`);}
  await p.screenshot({path:`${out}/materials-${width}.png`});
  await p.locator('[data-tab=calendar]').click();check(`${width} defaults to day`,await p.locator('[data-view=day]').getAttribute('aria-pressed')==='true');await layout(p,`${width} calendar`);await p.screenshot({path:`${out}/calendar-${width}.png`});
  await p.locator('#new-event').click();await layout(p,`${width} event dialog`);await p.screenshot({path:`${out}/event-editor-${width}.png`});await p.keyboard.press('Escape');
  await p.locator('[data-tab=notes]').click();await p.locator('#note-folder').selectOption(JSON.stringify(['Projects','AVA']));check(`${width} folder browsing`,await p.locator('#note-list [data-note]').count()===1);await p.locator('#note-list [data-note]').click();await layout(p,`${width} note reading`);await p.screenshot({path:`${out}/notes-${width}.png`});
  await p.locator('#notes-back').click();check(`${width} reader returns to filtered library`,await p.locator('#note-search').isVisible());
  await p.locator('[data-tab=references]').click();await layout(p,`${width} references`);await p.context().close();
 }
 const reduced=await open(390,'reduce');const rframe=await reduced.locator('canvas').getAttribute('data-frame');await reduced.waitForTimeout(250);check('OS reduced-motion produces static frame',rframe===await reduced.locator('canvas').getAttribute('data-frame')&&await reduced.getByRole('button',{name:'Reduced motion is active'}).isDisabled());await reduced.emulateMedia({forcedColors:'active'});check('forced colors removes decorative backdrop',!await reduced.locator('.atmosphere').isVisible());
 const recovery=await open(390);await recovery.evaluate(k=>localStorage.setItem(k,'invalid fixture'),STORAGE_KEY);await recovery.reload();check('malformed local fixture recovers to defaults',await recovery.locator('#quick-scene').inputValue()==='nocturne');
 await recovery.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('test-only unavailable storage');};});await recovery.locator('#quick-scene').selectOption('orbit');check('storage failure disclosed',await recovery.locator('#toast').innerText()==='Browser storage is unavailable. Changes last for this visit only.');
 const intervals=await recovery.evaluate(()=>new Promise(resolve=>{const times=[];let prior;function tick(t){if(prior)times.push(t-prior);prior=t;if(times.length<120)requestAnimationFrame(tick);else{times.sort((a,b)=>a-b);resolve({medianMs:times[60],p95Ms:times[114],frames:120});}}requestAnimationFrame(tick);}));console.log('MEASURE',JSON.stringify(intervals));
 check('no external requests or AVA API calls',external.length===0);check('no browser errors',errors.length===0);
 await writeFile(`${out}/results.json`,JSON.stringify({checks:results.length,results,errors,external,intervals,scope:'Headless Edge local concept. Not live AVA or a physical phone.'},null,2));
 console.log(`PASS: ${results.length} browser checks. ${out}`);
}catch(e){console.error('FAIL',e,errors);process.exitCode=1;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
