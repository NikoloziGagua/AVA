/** Original Canvas2D studies. One context, bounded DPR, no network or WebGL. */
export function mountBackdrop(canvas) {
  const ctx=canvas.getContext('2d');
  let width=1,height=1,scene='nocturne',paused=false,frame=0,last=0,t=0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const stars=Array.from({length:420},(_,i)=>({x:Math.sin(i*127.1)*1.8,y:Math.cos(i*311.7)*1.3,z:(i*.61803398875)%1}));
  function draw(){
    if(!ctx)return;
    ctx.clearRect(0,0,width,height);
    const w=width,h=height;
    if(scene==='nocturne'){
      const glow=ctx.createRadialGradient(w*.78,h*.45,0,w*.75,h*.45,w*.55);
      glow.addColorStop(0,'#69707740');glow.addColorStop(.45,'#222a3040');glow.addColorStop(1,'#03040600');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
      for(let i=0;i<130;i++){
        const k=i/130,phase=t*.22;
        const y=h*(.08+k*.44)+Math.sin(k*5+phase)*h*.06;
        const bright=Math.pow(Math.max(0,Math.cos(k*8-phase)),18);
        const shade=Math.round(80+bright*175);
        ctx.strokeStyle=`rgba(${shade},${shade+Math.min(5,255-shade)},${shade},${.10+bright*.6})`;
        ctx.lineWidth=.55+bright*1.2;
        ctx.beginPath();ctx.moveTo(-w*.15,y-h*.2);
        ctx.bezierCurveTo(w*.7,y-h*.1,w*(.7+Math.sin(phase)*.05),h*.92-k*h*.13,w*1.23,h*.66+k*h*.1);ctx.stroke();
      }
    } else if(scene==='orbit'){
      const cx=w*.7,cy=h*.4,depth=Math.min(w,h);
      const halo=ctx.createRadialGradient(cx,cy,0,cx,cy,depth*.66);halo.addColorStop(0,'#514b3935');halo.addColorStop(.4,'#26282e24');halo.addColorStop(1,'#02030600');ctx.fillStyle=halo;ctx.fillRect(0,0,w,h);
      ctx.save();ctx.translate(cx,cy);ctx.rotate(-.32);ctx.strokeStyle='#b9b3a930';ctx.lineWidth=.7;for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(0,0,depth*(.28+i*.035),depth*(.11+i*.026),0,0,Math.PI*2);ctx.stroke();}ctx.restore();
      const count=w<600?180:stars.length;
      for(let i=0;i<count;i++){const s=stars[i],z=(s.z+t*.035)%1,scale=.15+z*1.65;const x=cx+s.x*depth*scale,y=cy+s.y*depth*scale;const a=.2+z*z*.8;ctx.fillStyle=i%7===0?`rgba(237,203,154,${a})`:`rgba(205,216,230,${a})`;ctx.beginPath();ctx.arc(x,y,.45+z*1.3,0,Math.PI*2);ctx.fill();}
    } else if(scene==='silk'){
      for(let i=0;i<135;i++){
        const k=i/135,light=Math.pow((Math.sin(k*15+t*.22)+1)/2,6);
        ctx.strokeStyle=`rgba(${100+light*150},${108+light*140},${118+light*130},${.13+light*.46})`;ctx.lineWidth=.7;
        ctx.beginPath();
        for(let x=-40;x<=w+40;x+=16){const nx=x/w,y=h*(.12+k*.7)+Math.sin(nx*5.4+k*4+t*.18)*h*.19+Math.sin(nx*2-k*7-t*.12)*h*.12;if(x===-40)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
      }
    } else {
      const x=w*(.72+Math.sin(t*.08)*.12),y=h*(.25+Math.cos(t*.11)*.1);
      const g=ctx.createRadialGradient(x,y,0,x,y,w*.62);g.addColorStop(0,'#bdadd65c');g.addColorStop(.48,'#ecdcc65e');g.addColorStop(1,'#f4f1e900');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
      ctx.save();ctx.translate(w*.68,h*.1);ctx.rotate(.48+Math.sin(t*.1)*.015);
      for(let i=0;i<8;i++){const grad=ctx.createLinearGradient(i*55,0,i*55+22,0);grad.addColorStop(0,'#fff0');grad.addColorStop(.5,'#ffffff90');grad.addColorStop(1,'#fff0');ctx.fillStyle=grad;ctx.fillRect(i*55,-h,24,h*3);}ctx.restore();
    }
    canvas.dataset.scene=scene;canvas.dataset.frame=String(Math.round(t*100));
  }
  function resize(){const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5);width=r.width;height=r.height;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx?.setTransform(dpr,0,0,dpr,0,0);draw();}
  function tick(now){const dt=last?Math.min((now-last)/1000,.05):0;last=now;if(!paused&&!reduced.matches&&!document.hidden){t+=dt;draw();}frame=requestAnimationFrame(tick);}
  const observer=new ResizeObserver(resize);observer.observe(canvas);reduced.addEventListener('change',draw);resize();frame=requestAnimationFrame(tick);
  return {setScene(value){scene=value;draw();},setPaused(value){paused=value;draw();},get reduced(){return reduced.matches;},destroy(){cancelAnimationFrame(frame);observer.disconnect();reduced.removeEventListener('change',draw);}};
}
