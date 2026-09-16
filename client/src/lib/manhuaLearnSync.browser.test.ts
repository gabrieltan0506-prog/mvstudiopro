import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import puppeteer from 'puppeteer';
import { expect, it } from 'vitest';

it('真实页面刷新回调在浏览器中同步检查点与导入区，不刷新页面；失败后同检查点可重试', async () => {
  const source = readFileSync('client/src/pages/PlatformPage.tsx', 'utf8');
  const start = source.indexOf('const refreshManhuaLearnServerJobs = useCallback(');
  const end = source.indexOf('\n  }, []);', start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const callback = source.slice(start, end + '\n  }, []);'.length);
  const cacheStart = source.indexOf('manhuaLearnCachesRefreshRef.current = async () =>');
  const cacheEnd = source.indexOf('\n  };', cacheStart);
  const cacheCallback = source.slice(cacheStart, cacheEnd + '\n  };'.length);
  const compiled = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, {useState,useRef,useCallback} from 'react';
    import {createRoot} from 'react-dom/client';
    import {nativeLearnTerminalProposalRefreshSignature} from './client/src/lib/manhuaLearnResultUi';
    function App(){
      const [jobs,setJobs]=useState([]),[cards,setCards]=useState(''),[detail,setDetail]=useState('');
      const manhuaLearnUserKeyRef=useRef('owner'),nativeProposalRefreshSignatureRef=useRef('');
      const manhuaLearnLagProbeRef=useRef(''),manhuaLearnActiveJobRef=useRef(null);
      const manhuaClaimsCanRefetchRef=useRef(false),manhuaClaimsRefetchRef=useRef(async()=>({}));
      const ownerTemplateOptimizeAllowed=true;
      const fetchState=async()=>{const r=await fetch('/state');if(!r.ok)throw Error('读取失败');return r.json()};
      const listManhuaLearnServerJobs=async()=>({items:[await fetchState()]});
      const manhuaViralProposalsRefetchRef=useRef(null);
      manhuaViralProposalsRefetchRef.current=async()=>{const j=await fetchState();setCards('导入区 '+j.output.nativePartialProposalCheckpoint.completedSegments);return {isError:false}};
      const trpcUtils={manhuaViralTemplate:{getProposalDetail:{invalidate:async()=>{const j=await fetchState();setDetail('详情 '+j.output.nativePartialProposalCheckpoint.completedSegments)}},getSeriesLearnSnapshot:{invalidate:async()=>{}},listApprovedPrivate:{invalidate:async()=>{}}}};
      const manhuaLearnCachesRefreshRef=useRef(async()=>{});
      ${cacheCallback}
      const setManhuaLearnServerJobs=setJobs,reuseManhuaLearnServerJobsIfUnchanged=(_,v)=>v;
      const setManhuaLearnServerJobsHydrated=()=>{},setManhuaLearnBasket=()=>{};
      ${callback}
      window.sync=refreshManhuaLearnServerJobs;
      return <><div id="progress">进度 {jobs[0]?.output.nativePartialProposalCheckpoint.completedSegments}</div><div id="cards">{cards}</div><div id="detail">{detail}</div></>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic' });
  let completed=1, reads=0, failAt=0;
  const server=createServer((req,res)=>{
    if(req.url==='/state'){
      reads++; if(reads===failAt){res.statusCode=503;res.end();return}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jobId:'j1',status:'running',input:{params:{nativeDeepReadConfirmed:true}},output:{nativePartialProposalCheckpoint:{episodeIndex:1,completedSegments:completed,totalSegments:4,updatedAt:String(completed)}}}));
    }else{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div>')}
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const browser=await puppeteer.launch({headless:true});
  try{
    const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:'+ (server.address() as any).port);
    await page.addScriptTag({content:compiled.outputFiles[0].text});
    await page.waitForFunction('typeof window.sync === "function"');
    await page.evaluate('window.sync()');await page.waitForFunction('document.querySelector("#detail").textContent === "详情 1"');
    completed=2; failAt=reads+2;
    await page.evaluate('window.sync()');
    expect(await page.$eval('#cards',e=>e.textContent)).toBe('导入区 1');
    await page.evaluate('window.sync()');await page.waitForFunction('document.querySelector("#detail").textContent === "详情 2"');
    expect(await page.$eval('#cards',e=>e.textContent)).toBe('导入区 2');
    expect(await page.$eval('#progress',e=>e.textContent)).toBe('进度 2');
    expect(await page.evaluate('performance.getEntriesByType("navigation").length')).toBe(1);
    expect(errors).toEqual([]);
  }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()))}
},60000);
