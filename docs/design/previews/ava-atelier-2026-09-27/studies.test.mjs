import test from 'node:test';
import assert from 'node:assert/strict';
import {CARDS,NAVS,CHATS,freshStudies,loadStudies,addMessage,sceneForPage} from './studies-model.mjs';
test('six distinct card structures, four navs and three text compositions',()=>{
  for(const [items,count] of [[CARDS,6],[NAVS,4],[CHATS,3]])assert.equal(new Set(items.map(x=>x.id)).size,count);
});
test('fresh preference state is independent and round-trips',()=>{
  const a=freshStudies(),b=freshStudies();assert.deepEqual(loadStudies(JSON.stringify(a)),a);a.saved.push('cut');assert.deepEqual(b.saved,[]);
});
for(const raw of [null,'{','x'.repeat(200001),'null','[]','{"version":2}'])test(`invalid state fails safely: ${String(raw).slice(0,20)}`,()=>assert.deepEqual(loadStudies(raw),freshStudies()));
test('unknown identifiers and duplicate shortlist are rejected',()=>{
  const s=loadStudies(JSON.stringify({version:1,card:'<script>',nav:'no',chat:'no',saved:['cut','cut','bad','open']}));
  assert.equal(s.card,'cut');assert.equal(s.nav,'rail');assert.equal(s.chat,'quiet');assert.deepEqual(s.saved,['cut','open']);
});
test('draft and messages stay bounded without manufacturing assistant replies',()=>{
  const s=loadStudies(JSON.stringify({version:1,draft:'a'.repeat(2500),messages:[null,' ',...Array(14).fill('x')]}));
  assert.equal(s.draft.length,2000);assert.equal(s.messages.length,12);assert.ok(s.messages.every(x=>x==='x'));
});
test('explicit preview submit preserves exact text; blank/oversized submits are inert',()=>{
  const s=freshStudies(),text=' <img src=x>\nNiko’s exact words ';
  assert.equal(addMessage(s,'  '),s);assert.equal(addMessage(s,'x'.repeat(2001)),s);
  const next=addMessage(s,text);assert.equal(next.messages[0],text);assert.equal(next.draft,'');assert.deepEqual(s.messages,[]);
});
test('page atmospheres use approved pair and leave archived comparisons intact',()=>{
  assert.equal(sceneForPage('notes'),'silk');assert.equal(sceneForPage('navigation'),'silk');
  for(const page of ['talk','calendar','cards','references'])assert.equal(sceneForPage(page),'nocturne');
  assert.equal(sceneForPage('materials','dawn'),'dawn');
});
test('maximally escaped bounded content still round-trips',()=>{
 const s={...freshStudies(),draft:'\u0000'.repeat(2000),messages:Array(12).fill('A'+'\u0000'.repeat(1999))};
 assert.deepEqual(loadStudies(JSON.stringify(s)),s);
});
