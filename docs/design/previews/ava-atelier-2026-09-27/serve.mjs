import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,extname,sep} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const fonts=resolve(root,'../../../..','web/public/fonts');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.woff2':'font/woff2'};
const assets=new Set(['index.html','styles.css','studies.css','app.mjs','backdrop.mjs','calendar.mjs','notes.mjs','model.mjs','icons.mjs','studies.mjs','studies-model.mjs']);
const fontNames=new Set(['Geist-Variable.woff2','GeistMono-Variable.woff2']);
export function createPreviewServer(){return createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const isFont=url.pathname.startsWith('/fonts/');
    const base=isFont?fonts:root;
    const name=isFont?url.pathname.slice(7):url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    if(!(isFont?fontNames:assets).has(name)){res.writeHead(404);res.end();return;}
    const path=resolve(base,name);
    if(!path.startsWith(base+sep)||!Object.hasOwn(types,extname(path))){res.writeHead(404);res.end();return;}
    const data=await readFile(path);res.setHeader('Content-Type',types[extname(path)]);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404);res.end('Not found');}
});}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=createPreviewServer(),port=Number(process.argv[2]||5176);server.listen(port,'127.0.0.1',()=>console.log(`AVA Design Atelier: http://127.0.0.1:${server.address().port}/`));
}
