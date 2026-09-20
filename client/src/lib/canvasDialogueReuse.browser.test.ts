import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("找回已有对白真实按钮保存候选，不调用生成且重新挂载保留",async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
 import {defaultCanvasBlock} from './client/src/lib/canvasTypes';import {emptyCanvasAudioStudio,createCanvasAudioCue,canvasAudioCueInputKey} from './shared/canvasAudioStudio';
 const f=globalThis.fixture={submissions:[]};
 const fail=async()=>{f.submissions.push('unexpected');throw Error('禁止付费');};
 const services={generateDialogue:fail,getDialogue:async()=>null,draftMusic:fail,generateMusic:fail,getMusic:async()=>null,listMusic:async()=>[],queuePost:fail,getPost:async()=>null};
 const old={...createCanvasAudioCue('dialogue','old'),speakerZh:'娘',textZh:'阿菁……慢点，我喘不上来。',voice:'test-voice',emotion:'[tired]'};
 const take={id:'existing-take',gcsUri:'gs://test/original.wav',previewUrl:'',durationSec:4.944,createdAt:'',inputKey:canvasAudioCueInputKey(old)};
 const source={...defaultCanvasBlock('video',0,0),id:'old-block',episodeIndex:1,audioStudio:{...emptyCanvasAudioStudio(),cues:[{...old,takes:[take]}]}};
 function App(){const [key,setKey]=useState(0);const [block,setBlock]=useState({...defaultCanvasBlock('video',0,0),id:'new-block',episodeIndex:1,videoModel:'seedance-2.5',prompt:'目标时长：15秒',audioStudio:{...emptyCanvasAudioStudio(),cues:[{...old,id:'new',voice:'',emotion:'',startSec:6,endSec:10}]}});f.state=block.audioStudio;f.remount=()=>setKey(x=>x+1);return <CanvasAudioStudioView key={key} block={block} dialogueSources={[source]} services={services} onChange={audioStudio=>setBlock(b=>({...b,audioStudio:JSON.parse(JSON.stringify(audioStudio))}))}/>;}
 createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},plugins:[{name:"离线服务",setup(b){b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:"offline",namespace:"offline"}));b.onLoad({filter:/.*/,namespace:"offline"},()=>({contents:"export const trpc={};",loader:"js"}));}}],define:{"process.env.NODE_ENV":'"test"',"import.meta.env":"{}"}});
 const browser=await puppeteer.launch({headless:true});const page=await browser.newPage();
 try{
 await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());await page.goto('http://localhost:41823');await page.addScriptTag({content:built.outputFiles[0]!.text});
 await page.waitForSelector('[data-dialogue-reuse]');
 await page.click('[data-dialogue-reuse] summary');await page.click('[data-dialogue-reuse] button');
 await page.waitForFunction(()=>(globalThis as any).fixture.state.cues[0].takes.length===1);
 const cue=await page.evaluate(()=>(globalThis as any).fixture.state.cues[0]);
 expect(cue.takes[0].id).toBe('existing-take');expect(cue.startSec).toBe(6);expect(cue.endSec).toBe(10);expect(cue.approved).toBe(false);expect(cue.selectedTakeId).toBeUndefined();
 await page.evaluate(()=>(globalThis as any).fixture.remount());
 await page.waitForFunction(()=>document.body.innerText.includes('候选 1'));
 expect(await page.evaluate(()=>(globalThis as any).fixture.submissions)).toEqual([]);
 expect(await page.$$('[data-dialogue-reuse]')).toHaveLength(0);
 }finally{await browser.close();}
},60000);
