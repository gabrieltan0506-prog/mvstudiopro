import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

it("点击续作后显示原单进度，先回填底稿，完成后自动回填成稿", async () => {
  const bundle = await build({
    stdin: {resolveDir:process.cwd(),loader:"tsx",contents:`
      import {createRoot} from "react-dom/client";
      import {KnowledgeCardRecovery} from "./client/src/components/platform/KnowledgeCardRecovery";
      import {useState} from "react";
      import {KnowledgeCardProgress} from "./client/src/components/platform/KnowledgeCardProgress";
      const track=()=>{};
      function Panel(){const [progress,setProgress]=useState({status:"idle",percent:0});return <><main><KnowledgeCardProgress state={progress}/></main><KnowledgeCardRecovery onProgress={setProgress} onTracking={track} disabled={false} onStart={d=>{window.draft=d.markdown;return true;}} onFinish={v=>{window.applied=v.markdown;return true;}} onApply={v=>{window.applied=v.markdown;return true;}}/></>;}
      createRoot(document.getElementById("root")).render(<Panel/>);
    `},
    bundle:true,write:false,jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},
    plugins:[{name:"模拟任务边界",setup(b){
      b.onResolve({filter:/^@\/lib\/(trpc|jobs)$/},a=>({path:a.path,namespace:"test"}));
      b.onLoad({filter:/.*/,namespace:"test"},a=>({contents:a.path.endsWith("/jobs")?`
        export async function pollJobUntilTerminal(id,opts){
          window.polled=id;
          opts.onPoll({status:"running",output:{distillStage:"verifying",distillStageDone:915,distillStageTotal:1092}});
          window.finishStage=()=>opts.onPoll({status:"running",updatedAt:"2026-11-20T12:43:00Z",output:{distillStage:"revising",distillStep:"保存完整版正文和章节",editionStepNumber:7,editionStepTotal:14,distillStageDone:16,distillStageTotal:120}});
          return new Promise(resolve=>window.finish=()=>resolve({status:"succeeded"}));
        }`:`
        const utils={mvAnalysis:{getLastKnowledgeVerificationDraft:{fetch:async()=>({jobId:"kc_original",markdown:"原任务底稿",finished:false})},getKnowledgeCardRecovery:{fetch:async()=>({markdown:"续作成稿",total:0,images:[]})}}};
        export const trpc={useUtils:()=>utils,mvAnalysis:{
          deleteKnowledgeCardRecovery:{useMutation:()=>({})},
          resumeLastKnowledgeVerification:{useMutation:()=>({mutateAsync:async()=>({jobId:"kc_original"})})}
        }};`}));
    }}],
  });
  const browser=await puppeteer.launch({headless:true,args:["--no-sandbox"]});
  try{
    const page=await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.locator('::-p-text(从上次任务续作)').click();
    await page.waitForFunction(()=>document.body.innerText.includes("915/1092"));
    expect(await page.evaluate(()=>(window as any).polled)).toBe("kc_original");
    await page.evaluate(()=>(window as any).finishStage());
    await page.waitForFunction(()=>document.body.innerText.includes("保存完整版正文和章节"));
    const text = await page.evaluate(()=>document.body.innerText);
    expect(await page.evaluate(()=>(window as any).draft)).toBe("原任务底稿");
    expect(text).toContain("本步完成后还剩 7 步");
    expect(await page.$$eval("main [role=progressbar]",e=>e.length)).toBe(2);
    expect(await page.$$eval("[data-knowledge-card-recovery] [role=progressbar]", e=>e.length)).toBe(0);
    expect(text).toContain("后台最近更新");
    expect(text).toContain("页面最近查询");
    expect(text).toContain("16/120");
    expect(text).not.toContain("1092/1092");
    await page.evaluate(()=>(window as any).finish());
    await page.waitForFunction(()=>document.body.innerText.includes("成稿已回填"));
    expect(await page.evaluate(()=>(window as any).applied)).toBe("续作成稿");
  }finally{await browser.close();}
},60000);
