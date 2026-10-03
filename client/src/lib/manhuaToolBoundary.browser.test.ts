import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ManhuaToolBoundary} from './client/src/components/canvas/ManhuaToolBoundary';
    import {ManhuaShotSearch} from './client/src/components/ManhuaShotSearch';
    import {filterManhuaShots} from './client/src/lib/manhuaShotSearch';
    const state = globalThis.fixture = {broken:true,generated:0,selected:[],jobId:'existing-job',history:['original-take']};
    function Panel(){if(state.broken)throw new Error('test rendering fault');return <button onClick={()=>state.generated++}>生成白模</button>}
    function App(){const [notes,setNotes]=useState('原镜头描述');const [query,setQuery]=useState('');const [index,setIndex]=useState(-1);
      const shots=[{index:3,durationSec:2,cameraZh:'近景',actionZh:'阿菁'},{index:9,durationSec:3,cameraZh:'远景',actionZh:'墨屠'}];
      return <><textarea aria-label="原镜头描述" value={notes} onChange={e=>setNotes(e.target.value)}/><ManhuaShotSearch query={query} onQueryChange={setQuery} results={filterManhuaShots(shots,query)} total={2} selectedIndex={index} onSelect={i=>{state.selected.push(i);setIndex(i)}}/><ManhuaToolBoundary title="动作白模"><Panel/></ManhuaToolBoundary></>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",tsconfig:"tsconfig.json",define:{"process.env.NODE_ENV":'"test"'} });
  bundle=result.outputFiles[0].text;
  browser=await puppeteer.launch({headless:true});
},30000);
afterAll(async()=>{await browser?.close()});
it("局部渲染错误保留编辑与原任务，恢复不生成；搜索方向键与输入法互不干扰",async()=>{
  const page=await browser.newPage();
  try{
    await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle});
    await page.waitForSelector('[role="alert"]');
    await page.type('[aria-label="原镜头描述"]','继续编辑');
    await page.focus('[aria-label="搜索本集分镜"]');
    await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');
    expect(await page.evaluate(()=>(window as any).fixture.selected)).toEqual([0,1,0]);
    await page.$eval('[aria-label="搜索本集分镜"]',element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));
    expect(await page.evaluate(()=>(window as any).fixture.selected)).toEqual([0,1,0]);
    await page.evaluate(()=>(window as any).fixture.broken=false);
    await page.click('[role="alert"] button');
    await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));
    expect(await page.$eval('[aria-label="原镜头描述"]',e=>(e as HTMLTextAreaElement).value)).toContain('继续编辑');
    expect(await page.evaluate(()=>({generated:(window as any).fixture.generated,jobId:(window as any).fixture.jobId,history:(window as any).fixture.history}))).toEqual({generated:0,jobId:'existing-job',history:['original-take']});
  }finally{await page.close()}
},15000);
