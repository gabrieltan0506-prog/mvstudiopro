/** 真实导演面板的微调、重新采用和恢复；顾问网络使用离线回执。 */
import {expect,it} from "vitest";
import {build} from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("自动候选保留原回执，手动微调取消采用，恢复后同一版本进入顾问与视频",async()=>{
 const result=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{DigitalHumanFilmDirectorPanel}from'./client/src/components/DigitalHumanFilmDirectorPanel';
 import{newDigitalHumanDraft,digitalHumanFilmTarget,loadDigitalHumanDraft,prepareDigitalHumanVideo}from'./shared/digitalHumanStudio';
 import{buildDigitalHumanAdvisorProject}from'./client/src/lib/digitalHumanAdvisor';
 const d=newDigitalHumanDraft('7','00000000-0000-4000-8000-000000000001'),aid='00000000-0000-4000-8000-000000000002';
 d.script='核对资料。';d.voiceId='test';d.portrait={source:'gs://test-only/p.png',name:'本人'};d.scene={source:'gs://test-only/s.png',name:'书房'};
 d.audios=[{request:{billingRequestId:aid,input:d.script,voice:d.voiceId,speakerZh:'本人',speakerId:'test',voiceStateZh:''},source:'gs://test-only/a.wav',durationSec:6,status:'succeeded'}];d.approvedAudioRequestId=aid;
 const target=digitalHumanFilmTarget(d);globalThis.reply={kind:'digital-human-film',targetId:d.id,revision:target.revision,summary:'核对资料',bgm:'post',subtitles:'off',shots:[{startSec:0,endSec:6,dialogue:d.script,voiceMode:'onscreen',expression:'目光专注',performance:'认真讲述',action:'右手展开资料',camera:'6.5–9秒推近',lighting:'柔光照脸',atmosphere:'安静专注',soundEffect:'不加事件音效',visualEffect:'资料卡淡入，边缘局部反光',environmentSound:'书房持续轻底声，跨镜连续'}]};
 globalThis.count=0;globalThis.saved=d;
 function App(){const[draft,setDraft]=React.useState(d);globalThis.changeScene=()=>setDraft(old=>({...old,scene:{source:'gs://test-only/new-room.png',name:'调整后书房'}}));globalThis.restore=()=>setDraft(loadDigitalHumanDraft(JSON.stringify(globalThis.saved),'7'));globalThis.consume=()=>({prompt:prepareDigitalHumanVideo(draft,'00000000-0000-4000-8000-000000000003').prompt,context:buildDigitalHumanAdvisorProject(draft).context});return <DigitalHumanFilmDirectorPanel draft={draft} disabled={false} save={fn=>setDraft(old=>{const next=fn(old);globalThis.saved=next;return next})} beforeSubmit={async()=>{}} acquireWork={()=>()=>{}}/>;}createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'offline',setup(b){b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:'rpc',namespace:'offline'}));b.onLoad({filter:/.*/,namespace:'offline'},()=>({contents:`export const trpc={mvAnalysis:{askPlatformSkillQa:{useMutation:()=>({mutateAsync:async()=>{globalThis.count++;return{answer:JSON.stringify(globalThis.reply)}}})},getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:5,price:12},refetch:async()=>({data:{remaining:5,price:12}})})}}};`,loader:'js'}));}}],logLevel:'silent'});
 const browser=await puppeteer.launch({headless:true});
 try{
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);page.on('request',r=>{void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'});});await page.goto('https://example.test');await page.addScriptTag({content:result.outputFiles[0].text});
 const click=async(text:string)=>page.evaluate(t=>{const b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent===t);if(!b||b.disabled)throw Error('按钮不可用:'+t);b.click();},text);
 await click('生成完整导演方案');await page.waitForFunction(()=>document.body.textContent?.includes('方案需要修正'));
 await page.evaluate(()=>{const t=Array.from(document.querySelectorAll('textarea')).find(e=>e.value==='6.5–9秒推近')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(t,'0.5–3秒推近，镜头保持平视');t.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>(globalThis as any).saved.filmDirector.plan.shots[0].camera.includes('保持平视'));
 await page.click('input[type=checkbox]');await click('采用完整导演方案');await page.waitForFunction(()=>(globalThis as any).saved.filmDirector.adopted);
 await page.evaluate(()=>(globalThis as any).restore());const consumed=await page.evaluate(()=>(globalThis as any).consume());expect(consumed.prompt).toContain('保持平视');expect(consumed.prompt).toContain('资料卡淡入');expect(consumed.prompt).toContain('书房持续轻底声');expect(consumed.context.shotSummary).toContain('保持平视');
 await page.evaluate(()=>(globalThis as any).changeScene());await page.waitForFunction(()=>document.body.textContent?.includes('按当前素材重新核对并采用'));expect(await page.$eval('input[type=checkbox]',e=>(e as HTMLInputElement).checked)).toBe(false);
 await page.click('input[type=checkbox]');await click('按当前素材重新核对并采用');await page.waitForFunction(()=>document.body.textContent?.includes('当前方案已采用'));expect(await page.evaluate(()=>(globalThis as any).consume().context.shotSummary)).toContain('保持平视');

 await page.evaluate(()=>{const t=document.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(t,'');t.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>!(globalThis as any).saved.filmDirector.adopted);expect(await page.$eval('input[type=checkbox]',e=>(e as HTMLInputElement).checked)).toBe(false);
 const receipt=await page.evaluate(()=>({count:(globalThis as any).count,storage:(globalThis as any).saved.advisorStorage}));expect(receipt.count).toBe(1);expect(Object.values(receipt.storage).some(v=>String(v).includes('6.5–9秒'))).toBe(true);expect(errors).toEqual([]);
 }finally{await browser.close();}
},60_000);
