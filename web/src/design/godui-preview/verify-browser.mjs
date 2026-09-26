// Run from repo root with an isolated build: node this-file.mjs data/builds/metal-proposal.
// No AVA API or microphone access. Never rebuild served web/dist for this check.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2] ?? 'web/dist');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.bin':'application/octet-stream','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!path.startsWith(root+'\\')&&!path.startsWith(root+'/'))throw Error('Path');res.setHeader('Content-Type',mime[extname(path)]??'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/?godui-preview`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],writes=[],results=[];
try {
  // Fresh profile/origin; let the real registration execute in both build modes.
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'});
  const p=await context.newPage();
  p.setDefaultTimeout(10_000);
  p.on('pageerror',e=>{errors.push(e.message);console.error('Browser error at',p.url(),e.stack);});
  p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  p.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
  await p.goto(url);
  await p.locator('.am-face canvas').waitFor();
  await p.waitForTimeout(800);
  // Test actual geometry, not just overflow:hidden or a screenshot of the top.
  for(const [width,height] of [[1440,900],[1366,650],[390,844],[320,568],[844,390]]) {
    await p.setViewportSize({width,height});
    for(const view of ['Home','Voice']) {
      await p.getByRole('button',{name:view,exact:true}).click();
      await p.waitForTimeout(400);
      const fit=await p.locator('.am-root').evaluate(root=>{
        const selectors=['.am-header','.am-presence','.am-face','.am-intro','.am-home-actions','.am-voice-controls','.am-state-options','.am-composer-wrap'];
        return {vertical:root.scrollHeight-root.clientHeight,horizontal:root.scrollWidth-root.clientWidth,
          outside:selectors.flatMap(selector=>{const e=root.querySelector(selector);if(!e)return[];const r=e.getBoundingClientRect();return r.top < -1 || r.bottom > innerHeight+1 || r.left < -1 || r.right > innerWidth+1 ? [selector] : [];}),
          faceHeight:root.querySelector('.am-face').getBoundingClientRect().height};
      });
      assert.ok(fit.vertical<=1,`${view} ${width}x${height} vertical overflow: ${JSON.stringify(fit)}`);
      assert.ok(fit.horizontal<=1,`${view} ${width}x${height} horizontal overflow`);
      assert.deepEqual(fit.outside,[],`${view} ${width}x${height} clipped controls`);
      assert.ok(fit.faceHeight>=64,`${view} ${width}x${height} face still visible`);
      await p.screenshot({path:resolve(tmpdir(),`ava-metal-fit-${view.toLowerCase()}-${width}x${height}.png`)});
      await p.getByRole('button',{name:'Expand Ask AVA',exact:true}).click();
      const composer=await p.locator('.am-composer').boundingBox();
      assert.ok(composer && composer.y>=0 && composer.y+composer.height<=height+1,'expanded composer fits');
      await p.getByRole('textbox',{name:'Ask AVA anything'}).press('Escape');
    }
  }
  await p.setViewportSize({width:1440,height:1000});
  await p.getByRole('button',{name:'Home',exact:true}).click();
  await p.screenshot({path:resolve(tmpdir(),'ava-metal-home-v2.png')});
  const stars=p.locator('.am-atmosphere canvas');
  const starPixels=()=>stars.evaluate(canvas=>canvas.toDataURL());
  const before=await starPixels();await p.waitForTimeout(300);assert.notEqual(await starPixels(),before,'stars must move');
  await p.getByRole('button',{name:'Expand Ask AVA',exact:true}).click();
  await p.getByRole('textbox').fill('A precise thought / _username');
  await p.getByRole('textbox').press('Escape');
  await p.getByRole('button',{name:'Voice',exact:true}).click();
  await p.getByRole('button',{name:'Type exact wording',exact:true}).click();
  assert.equal(await p.getByRole('textbox').inputValue(),'A precise thought / _username');
  await p.getByRole('textbox').press('Escape');
  await p.getByText('Preview states',{exact:true}).click();
  await p.getByRole('button',{name:'speaking',exact:true}).click();
  await p.screenshot({path:resolve(tmpdir(),'ava-metal-voice-v2.png')});
  await p.getByRole('button',{name:'Components',exact:true}).click();
  const nav=p.getByRole('navigation',{name:'Component references'});
  assert.equal(await nav.locator('button').count(),21);
  for(let i=0;i<21;i++) {
    await nav.locator('button').nth(i).click();await p.waitForTimeout(200);
    const name=await p.locator('.am-reference h2').textContent();
    if(i===0)assert.equal(await p.locator('[data-shader="paper-liquid-metal"]').count(),2);
    if(i===1){assert.equal(await p.locator('.am-gradient').getAttribute('data-renderer'),'webgl-gradient-wave');const a=await p.locator('.am-gradient').screenshot();await p.waitForTimeout(350);assert.notDeepEqual(await p.locator('.am-gradient').screenshot(),a,'gradient moves');await p.screenshot({path:resolve(tmpdir(),'ava-metal-gradient-v2.png')});}
    results.push(name);
    console.log('Verified reference:',name);
  }
  await p.setViewportSize({width:390,height:844});
  for(const view of ['Home','Voice','Components']) {
    await p.getByRole('button',{name:view,exact:true}).click();
    await p.waitForTimeout(250);
    assert.equal(await p.locator('.am-root').evaluate(e=>e.scrollWidth>e.clientWidth+1),false,`${view} overflow`);
    await p.screenshot({path:resolve(tmpdir(),`ava-metal-${view.toLowerCase()}-mobile.png`)});
  }
  const destinations=['Today','Talk','Conversations','Notes','Calendar','Ideas','Memory','Reminders & watches','Explore AVA','Visual explanations','Activity','Self development','Settings','Strategy Room','Pair a device','Welcome'];
  const open=async name=>{await p.getByRole('button',{name:'All AVA workspaces',exact:true}).click();await p.getByRole('navigation',{name:'All workspaces'}).getByRole('button',{name:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' ')}).click();await p.getByRole('heading',{level:1,name,exact:true}).waitFor();};
  for(const width of [1440,390]) {
    await p.setViewportSize({width,height:width===390?844:1000});
    for(const name of destinations){await open(name);await p.waitForTimeout(100);assert.equal(await p.locator('.am-root').evaluate(e=>e.scrollWidth>e.clientWidth+1),false,`${name} ${width} overflow`);console.log('Verified workspace:',name,width);}
    for(const name of ['Today','Notes','Calendar','Talk','Memory','Activity']){await open(name);await p.screenshot({path:resolve(tmpdir(),`ava-metal-full-${name.toLowerCase()}-${width}.png`)});}
  }
  await open('Notes');await p.getByRole('button',{name:'New file',exact:true}).click();await p.getByLabel('Title',{exact:true}).fill('Browser persistence check');await p.getByLabel('Content · Markdown supported',{exact:true}).fill('A local fixture. No live AVA writes.');await p.getByRole('button',{name:'Save file',exact:true}).click();
  await p.reload();await p.getByRole('heading',{level:1,name:'Notes',exact:true}).waitFor();await p.getByText('Browser persistence check',{exact:true}).click();await p.getByRole('heading',{name:'Browser persistence check',exact:true}).waitFor();
  await p.getByRole('button',{name:'Delete file',exact:true}).click();await p.getByRole('button',{name:'Undo',exact:true}).click();
  await open('Settings');await p.goBack();await p.getByRole('heading',{level:1,name:'Notes',exact:true}).waitFor();
  await p.getByRole('button',{name:'All AVA workspaces',exact:true}).click();await p.getByRole('textbox',{name:'Find a workspace'}).press('Escape');assert.equal(await p.getByRole('dialog').count(),0);assert.equal(await p.getByRole('button',{name:'All AVA workspaces',exact:true}).evaluate(e=>e===document.activeElement),true,'menu focus returned');
  await open('Visual explanations');for(const format of ['SVG','PNG']){const download=p.waitForEvent('download');await p.getByRole('button',{name:`Export ${format}`,exact:true}).click();assert.equal((await download).suggestedFilename(),`ava-demo-visual.${format.toLowerCase()}`);}
  // Joint proposal is a separate local composition, not a live screen redesign.
  await p.getByRole('button',{name:'All AVA workspaces',exact:true}).click();
  await p.getByRole('navigation',{name:'All workspaces'}).getByRole('button',{name:/^Proposed design /}).click();
  await p.getByRole('heading',{name:'AVA, with a little more life.'}).waitFor();
  const proposalNav=p.getByRole('navigation',{name:'Proposed screens'});
  const proposalNames=await proposalNav.locator('button').allTextContents();
  assert.equal(proposalNames.length,17);
  const selectStudy=async name=>{await proposalNav.getByRole('button',{name:new RegExp(name+'$')}).click();await p.waitForTimeout(250);};
  for(const width of [1440,390,320]) {
    await p.setViewportSize({width,height:width===1440?1000:844});
    for(let i=0;i<proposalNames.length;i++) {
      await proposalNav.locator('button').nth(i).click();await p.waitForTimeout(250);
      const fit=await p.locator('.ps-artboard').evaluate(e=>({scroll:e.scrollWidth-e.clientWidth,right:e.getBoundingClientRect().right}));
      assert.ok(fit.scroll<=1 && fit.right<=width+1,`${proposalNames[i]} ${width} proposal overflow: ${JSON.stringify(fit)}`);
      assert.equal(await p.locator('.ps-artboard').count(),1,'only one study mounted');
      console.log('Verified proposal:',proposalNames[i],width);
    }
    for(const name of ['Home','Today','Notes','Metal comparison']) {
      await selectStudy(name);await p.locator('.ps-artboard').scrollIntoViewIfNeeded();
      await p.screenshot({path:resolve(tmpdir(),`ava-metal-proposal-${name.toLowerCase().replaceAll(' ','-')}-${width}.png`)});
    }
  }
  await selectStudy('Metal comparison');
  assert.equal(await p.locator('.ps-artboard [data-shader="paper-liquid-metal"]').count(),1);
  await p.getByRole('button',{name:'Try real liquid metal',exact:true}).click();
  await p.getByRole('status').filter({hasText:'Real shader pressed.'}).waitFor();
  await p.getByRole('button',{name:'Paper study',exact:true}).click();
  assert.equal(await p.locator('.ps-material-samples').getAttribute('data-paper'),'true');
  await selectStudy('Ideas');
  for(const style of ['Card-swap','List','Cover-flow']) await p.getByRole('button',{name:style,exact:true}).click();
  await selectStudy('Home');
  await p.getByRole('button',{name:"Reveal today's one thing"}).press('Enter');
  await p.getByText(/Live AVA would use the existing verified ranking/).waitFor();
  await selectStudy('Talk');await p.getByRole('button',{name:'What AVA did · sample'}).click();
  await p.locator('.ps-flow').waitFor();
  await selectStudy('Notes');await p.getByRole('button',{name:'Open full notes layout'}).click();
  await p.getByRole('heading',{level:1,name:'Notes',exact:true}).waitFor();
  await p.goBack();await p.getByRole('heading',{name:'AVA, with a little more life.'}).waitFor();
  await p.reload();await p.getByRole('heading',{name:'AVA, with a little more life.'}).waitFor();
  await p.getByRole('button',{name:'Components',exact:true}).click();
  await p.getByRole('navigation',{name:'Component references'}).getByRole('button',{name:/ScrollTimeline/}).click();
  await p.locator('.am-root').evaluate(e=>e.scrollTo({top:e.scrollHeight,behavior:'instant'}));
  assert.ok(await p.locator('.am-root').evaluate(e=>e.scrollTop)>0,'scrollable');
  await p.emulateMedia({reducedMotion:'reduce'});await p.reload();await p.waitForTimeout(800);
  const still=await starPixels();await p.waitForTimeout(300);assert.ok((await starPixels())===still,'reduced motion stars static');
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  console.log(JSON.stringify({passed:results,workspaces:destinations,proposalStudies:proposalNames,proposalWidths:[1440,390,320],localPersistence:true,exports:['SVG','PNG'],historyAndFocus:true,viewports:[1440,390],presenceFits:[[1440,900],[1366,650],[390,844],[320,568],[844,390]],reducedMotion:true,errors,writes,screenshots:tmpdir()},null,2));
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
