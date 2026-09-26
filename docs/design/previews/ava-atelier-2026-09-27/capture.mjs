import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const out='data/builds/atelier-review';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  for(const width of [1440,390,320]){
    const page=await browser.newPage({viewport:{width,height:width>500?1000:844}});
    page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
    page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE ERROR',m.text());});
    for(const route of ['materials','calendar','notes']){
      await page.goto(`http://127.0.0.1:5176/#${route}`);await page.waitForTimeout(600);
      if(route==='notes'&&width<760)await page.locator('[data-note]').first().click();
      await page.screenshot({path:`${out}/${route}-${width}.png`,fullPage:true});
      console.log(route,width,await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth,text:document.body.innerText.slice(0,250)})));
    }
    await page.close();
  }
}finally{await browser.close();}
