import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

it("点击续作后显示原单进度，完成后由用户选择恢复正文", async () => {
  const bundle = await build({
    stdin: {resolveDir:process.cwd(),loader:"tsx",contents:`
      import {createRoot} from "react-dom/client";
      import {KnowledgeCardRecovery} from "./client/src/components/platform/KnowledgeCardRecovery";
      createRoot(document.getElementById("root")).render(<KnowledgeCardRecovery disabled={false} onApply={v=>{window.applied=v.markdown;return true;}}/>);
    `},
    bundle:true,write:false,jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},
    plugins:[{name:"模拟任务边界",setup(b){
      b.onResolve({filter:/^@\/lib\/(trpc|jobs)$/},a=>({path:a.path,namespace:"test"}));
      b.onLoad({filter:/.*/,namespace:"test"},a=>({contents:a.path.endsWith("/jobs")?`
        export async function pollJobUntilTerminal(id,opts){
          window.polled=id;
          opts.onPoll({status:"running",output:{distillStage:"verifying",distillStageDone:915,distillStageTotal:1092}});
          return new Promise(resolve=>window.finish=()=>resolve({status:"succeeded"}));
        }`:`
        const utils={mvAnalysis:{getKnowledgeCardRecovery:{fetch:async()=>({markdown:"续作成稿",total:0,images:[]})}}};
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
    await page.evaluate(()=>(window as any).finish());
    await page.waitForFunction(()=>document.body.innerText.includes("续作成稿"));
    expect(await page.evaluate(()=>(window as any).applied)).toBeUndefined();
    await page.locator('::-p-text(恢复正文与已有图片)').click();
    expect(await page.evaluate(()=>(window as any).applied)).toBe("续作成稿");
  }finally{await browser.close();}
},60000);
