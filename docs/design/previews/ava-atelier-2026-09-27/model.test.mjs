import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState,loadState,validEvent,validNote,validDate,shiftDate,weekOf,layoutEvents,draftRange,renderBody,esc,folderKey,inFolder,folderLabel,SCENES,MATERIALS} from './model.mjs';
import {createPreviewServer} from './serve.mjs';
test('four genuinely separate background and material identifiers',()=>{assert.equal(new Set(SCENES.map(x=>x.id)).size,4);assert.equal(new Set(MATERIALS.map(x=>x.id)).size,4);});
test('fixtures validate and round-trip independently',()=>{const a=freshState(),b=freshState();assert.deepEqual(loadState(JSON.stringify(a)),a);a.events.pop();assert.equal(b.events.length,7);assert.ok(b.events.every(validEvent));assert.ok(b.notes.every(validNote));});
for(const [name,raw] of [['malformed','{'],['oversized','x'.repeat(250001)],['wrong version',JSON.stringify({...freshState(),version:2})],['wrong material',JSON.stringify({...freshState(),material:'unknown'})],['duplicate',JSON.stringify({...freshState(),events:[freshState().events[0],freshState().events[0]]})],['bad entries',JSON.stringify({...freshState(),events:[null]})]])test(`storage rejects ${name}`,()=>assert.deepEqual(loadState(raw),freshState()));
test('shortlist accepts known pairings only',()=>{assert.deepEqual(loadState(JSON.stringify({...freshState(),favourites:['orbit/glass','<script>','dawn/editorial']})).favourites,['orbit/glass','dawn/editorial']);});
test('one-day time bounds and attendance values',()=>{const e=freshState().events[0];for(const patch of [{title:' '},{date:'2026-02-30'},{start:-1},{duration:14},{start:1430,duration:60},{category:'unknown'},{attendance:'sent'}])assert.ok(!validEvent({...e,...patch}),JSON.stringify(patch));assert.ok(validEvent({...e,start:1425,duration:15}));});
test('date navigation is independent of machine timezone and DST',()=>{assert.equal(shiftDate('2026-10-25',1),'2026-10-26');assert.equal(weekOf('2026-10-04'),'2026-09-28');assert.equal(shiftDate('2026-12-31',1),'2027-01-01');assert.ok(!validDate('2026-02-29'));assert.ok(validDate('2028-02-29'));});
test('draft drag snaps, reverses and clamps',()=>{assert.deepEqual(draftRange(600,630),{start:600,duration:45});assert.deepEqual(draftRange(632,600),{start:600,duration:45});assert.deepEqual(draftRange(-20,10),{start:0,duration:15});assert.deepEqual(draftRange(1600,1500),{start:1425,duration:15});});
test('overlap layout is stable without mutating data',()=>{const e=freshState().events[0],events=[{...e,id:'a',start:540,duration:60},{...e,id:'b',start:555,duration:90},{...e,id:'c',start:600,duration:45},{...e,id:'d',start:645,duration:30}];const original=JSON.stringify(events),result=layoutEvents(events);assert.equal(JSON.stringify(events),original);assert.deepEqual(result.map(e=>[e.id,e.column,e.columns]),[['a',0,2],['b',1,2],['c',0,2],['d',0,1]]);assert.deepEqual(layoutEvents([...events].reverse()),result);});
test('heading only consumes its own line; body and lists remain semantic',()=>{assert.equal(renderBody('## Title\nSome words\nMore words\n\n## Next\n- One\n- Two'),'<h2>Title</h2><p>Some words<br>More words</p><h2>Next</h2><ul><li>One</li><li>Two</li></ul>');});
test('raw HTML and URL-shaped input remain inert text',()=>{assert.equal(esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');assert.ok(!renderBody('## <script>alert(1)</script>\n<a href="javascript:alert(1)">').includes('<script>'));});
test('folder identity includes space, not just a duplicated name',()=>{const n={...freshState().notes[0],area:'University',folder:'Reading'};assert.equal(inFolder(n,folderKey('Projects','Reading')),false);assert.equal(inFolder(n,folderKey('University','Reading')),true);assert.equal(folderLabel(folderKey('University','Reading')),'Reading');});
test('note validation bounds bodies and links',()=>{const n=freshState().notes[0];assert.ok(!validNote({...n,body:'x'.repeat(30001)}));assert.ok(!validNote({...n,links:Array(21).fill('x')}));assert.ok(!validNote({...n,title:''}));});
test('preview server is read-only, bounded to preview and local fonts',async()=>{
  const server=createPreviewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const html=await fetch(base);assert.equal(html.status,200);assert.match(await html.text(),/connect-src 'none'/);
    assert.equal((await fetch(base+'/fonts/Geist-Variable.woff2')).status,200);
    for(const path of ['/..%2F..%2F..%2F..%2F.env','/api/chat','/fonts/..%2F..%2F.env','/serve.mjs?x=1','/verify.mjs','/README.md'])assert.equal((await fetch(base+path)).status,404);
    assert.equal((await fetch(base,{method:'POST',body:'no'})).status,405);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
