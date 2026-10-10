const STYLE_IDS = ["03_greek", "08_impressionism", "31_haring", "10_nouveau", "30_matisse", "24_hopper", "18_klimt", "35_shinkai", "33_rubberhose", "11_cubism", "06_renaissance", "13_pop", "04_roman", "36_picasso_blue", "23_dali", "26_vaporwave", "28_monet", "25_ghibli", "29_seurat", "12_bauhaus", "02_egypt", "01_cave", "09_postimp", "16_2026", "20_dunhuang", "19_munch", "32_rembrandt", "22_constructivism", "34_shadowpuppet", "17_ink", "14_8bit", "05_gothic", "15_raytrace", "27_kirby", "21_kusama"];
const GRAMMAR_IDS = ["t2_keynote_ui", "y5_kinetic_type", "y4_storytime", "y2_vox", "y3_whiteboard", "y1_kurzgesagt", "t3_finance_chart", "t1_3b1b"];
// Product adapter. Only bundled, allowlisted scripts; no arbitrary executable content.
(() => {
 let started=false, playing=false, position=0, anchor=0;
 const reply=(type,extra={})=>parent!==window&&parent.postMessage({type,...extra},location.origin);
 const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('样式文件加载失败'));document.head.appendChild(s)});
 async function start(spec){
  if(started)return;started=true;
  if(!spec||!['animation','art'].includes(spec.mode)||!GRAMMAR_IDS.includes(spec.grammar)||!(spec.duration>=1&&spec.duration<=180))throw new Error('动画参数无效');
  if(![[1280,720],[720,1280],[1920,1080],[1080,1920]].some(([w,h])=>w===spec.width&&h===spec.height))throw new Error('画幅无效');
  if(spec.composition){
   if(spec.mode!=='animation')throw new Error('逐镜编排只用于动画模式');
   window.COMPOSITION_SPEC=spec;
   await load('composition.js');
  }else if(spec.mode==='art'){
   if(!Array.isArray(spec.scenes)||!spec.scenes.length||spec.scenes.length>35||spec.scenes.some(s=>!STYLE_IDS.includes(s.style)))throw new Error('艺术场景无效');
   window.ERAS=spec.scenes.map((s,i)=>({id:s.style,dur:s.duration,...(i&&s.transition!=='none'?{transition:{type:s.transition==='fade'?'crossfade':s.transition,dur:Math.min(.4,s.duration/3)}}:{})}));
   window.SCENES={};window.__bootErrors=[];
   await load('transitions.js');
   for(const id of new Set(spec.scenes.map(s=>s.style)))await load('scenes/'+id+'.js');
   for(const e of ERAS){const s=SCENES[e.id];if(!s?.draw)throw new Error('场景未就绪');e.draw=s.draw;if(s.init)e.init=s.init;if(e.transition&&!TRANSITIONS[e.transition.type]){if(e.transition.type==='crossfade')delete e.transition;else await load('transitions/'+e.transition.type+'.js')}}
   window.FILM_DURATION=spec.duration;
   await load('engine.js');
  }else{
   window.CLIP_SPEC={...spec,cues:spec.cues.map(({imageUri,...q})=>q)};
   await load('clip.js');
  }
  const until=Date.now()+120000;
  while(!window.__ready){if(window.__bootFailed)throw new Error(window.__bootFailed);if(Date.now()>until)throw new Error('预览加载超时');await new Promise(r=>setTimeout(r,30))}
  if(spec.mode==='art'){
   const raw=window.__canvas,draw=window.renderFrame;
   raw.style.display='none';const out=document.createElement('canvas');out.width=spec.width;out.height=spec.height;document.body.appendChild(out);const ctx=out.getContext('2d');window.__canvas=out;
   window.renderFrame=t=>{draw(t);ctx.fillStyle=spec.background;ctx.fillRect(0,0,out.width,out.height);const scale=Math.min(out.width/raw.width,out.height/raw.height);ctx.drawImage(raw,(out.width-raw.width*scale)/2,(out.height-raw.height*scale)/2,raw.width*scale,raw.height*scale);if(spec.title){ctx.fillStyle='#ffffff';ctx.strokeStyle='#222222';ctx.lineWidth=3;ctx.textAlign='center';ctx.font=Math.round(out.width*.045)+'px sans-serif';ctx.strokeText(spec.title,out.width/2,out.height*.88,out.width*.9);ctx.fillText(spec.title,out.width/2,out.height*.88,out.width*.9)}};
  }
  window.renderFrame(0);window.__productReady=true;reply('art-motion-ready');
  const tick=now=>{if(playing){position=Math.min(spec.duration-1/spec.fps,(now-anchor)/1000);window.renderFrame(position);if(position>=spec.duration-1/spec.fps)playing=false;}requestAnimationFrame(tick)};requestAnimationFrame(tick);
 }
 const fail=e=>{window.__bootFailed=String(e?.message||e);reply('art-motion-error',{message:window.__bootFailed})};
 addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin)return;const m=e.data;if(m?.type==='art-motion-init')start(m.spec).catch(fail);if(m?.type==='art-motion-seek'&&window.__productReady){playing=false;position=Math.max(0,Math.min(window.__total,Number(m.time)||0));window.renderFrame(position)}if(m?.type==='art-motion-play'&&window.__productReady){playing=!playing;if(position>=window.__total-1/30)position=0;anchor=performance.now()-position*1000}});
 if(window.__ART_SPEC)start(window.__ART_SPEC).catch(fail);else reply('art-motion-awaiting');
})();
