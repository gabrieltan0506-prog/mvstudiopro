import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
let browser: Browser, bundle: string;
beforeAll(async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
 import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';
 import {ManhuaAutoRigEditorView} from './client/src/components/canvas/ManhuaAutoRigEditor';
 import {AUTO_RIG_JOINTS} from './shared/manhuaAutoRig';
 const f=globalThis.fixture={submits:[],gets:[],applies:[],lists:0,mode:'success',current:null};
 const png='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="gray"/></svg>');
 f.response=r=>({jobId:'rig_test',status:'succeeded',params:r,error:null,createdAt:null,updatedAt:null,output:{stage:r.stage,requestId:r.requestId,sourceJobId:r.sourceJobId,assetRef:r.assetRef,sha256:'a'.repeat(64),sourceDigest:'b'.repeat(64),previewUrls:Array.from({length:r.stage==='inspect'?2:5},(_,i)=>png+'#'+i),...(r.stage==='inspect'?{inspection:{version:1,stage:'inspect',sourceDigest:'b'.repeat(64),sourceSha256:'a'.repeat(64),vertices:500,bounds:[[-.3,-1,0],[.3,1,2]],settings:r.settings,joints:Object.fromEntries(AUTO_RIG_JOINTS.map((k,i)=>[k,[0,(i-10)/20,1+(i%3)*.05]])),limitations:['离线夹具不验美术']}}:{})}});
 const services={submit:async r=>{f.submits.push(structuredClone(r));if(f.mode==='unknown')throw Error('离线模拟断网');return f.current=f.response(r);},get:async id=>{f.gets.push(id);return f.current;},list:async()=>{f.lists++;return {items:[],nextCursor:null}},adopt:async()=>({taskId:'m3d_adopted'}),restore:async()=>({taskId:'m3d_original'})};
 const root=createRoot(document.getElementById('root'));f.mount=()=>root.render(<StrictMode><ManhuaAutoRigEditorView assetRef="person" label="测试人物" sourceJobId={f.source??"m3d_original"} sourceVersion="v1" services={services} onApply={(model,id)=>{f.applies.push({model,id});return true;}} onClose={()=>root.render(null)}/></StrictMode>);f.mount();
 `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    plugins: [
      {
        name: "离线服务隔离",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "offline",
          }));
          b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            contents: "export const trpc={};",
            loader: "js",
          }));
        },
      },
    ],
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": "{}",
    },
  });
  bundle = built.outputFiles[0].text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await browser?.close();
});
async function open() {
  const p = await browser.newPage();
  p.setDefaultTimeout(5000);
  await p.setRequestInterception(true);
  p.on("request", r => {
    if (r.isNavigationRequest() && r.url() === "http://localhost:41829/")
      void r.respond({
        status: 200,
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    else if (r.url().startsWith("data:")) void r.continue();
    else void r.abort();
  });
  await p.goto("http://localhost:41829/");
  await p.evaluate(() => localStorage.clear());
  await p.addScriptTag({ content: bundle });
  await p.waitForSelector('[aria-label="人体模型绑骨"]');
  return p;
}
async function click(p: Page, label: string) {
  await p.evaluate(label => {
    const b = Array.from(document.querySelectorAll("button")).find(
      b => b.textContent === label
    );
    if (!b || b.disabled) throw Error("不可点击 " + label);
    b.click();
  }, label);
}
async function check(p: Page, index: number) {
  const inputs = await p.$$("input[type=checkbox]");
  await inputs[index].click();
}
it("必须加载两张图并人工确认，修改关节后撤销确认", async () => {
  const p = await open();
  try {
    await click(p, "检查当前模型");
    await p.waitForSelector("circle");
    await p.waitForFunction(
      () =>
        !document.querySelector<HTMLInputElement>("input[type=checkbox]")
          ?.disabled
    );
    await check(p, 0);
    await p.$eval('[aria-label="正面骨盆底"]', e => (e as SVGElement).focus());
    await p.keyboard.press("ArrowRight");
    expect(
      await p.$eval(
        "input[type=checkbox]",
        e => (e as HTMLInputElement).checked
      )
    ).toBe(false);
    expect(await p.evaluate(() => (window as any).fixture.submits.length)).toBe(
      1
    );
  } finally {
    await p.close();
  }
}, 15000);
it("确认点位提交后，五图确认才能采用，恢复保留原模型身份", async () => {
  const p = await open();
  try {
    await click(p, "检查当前模型");
    await p.waitForFunction(
      () =>
        document.querySelector("input[type=checkbox]") &&
        !document.querySelector<HTMLInputElement>("input[type=checkbox]")
          ?.disabled
    );
    await check(p, 0);
    await click(p, "按确认的关节生成带骨候选");
    await p.waitForFunction(
      () =>
        document.querySelectorAll("input[type=checkbox]").length === 2 &&
        !document.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1]
          .disabled
    );
    await check(p, 1);
    await click(p, "另存并采用带骨模型");
    await p.waitForFunction(() => (window as any).fixture.applies.length === 1);
    await click(p, "恢复原模型");
    await p.waitForFunction(() => (window as any).fixture.applies.length === 2);
    expect(
      await p.evaluate(() =>
        (window as any).fixture.applies.map(
          (x: { model: { taskId: string } }) => x.model.taskId
        )
      )
    ).toEqual(["m3d_adopted", "m3d_original"]);
    expect(await p.evaluate(() => (window as any).fixture.submits.length)).toBe(
      2
    );
  } finally {
    await p.close();
  }
}, 15000);
it("提交断网后仅查询原编号，明确确认提交也沿用原编号", async () => {
  const p = await open();
  try {
    await p.evaluate(() => ((window as any).fixture.mode = "unknown"));
    await click(p, "检查当前模型");
    await p.waitForSelector("[role=alert]");
    await click(p, "查询原任务");
    await click(p, "用原编号确认提交");
    await p.waitForFunction(() => (window as any).fixture.submits.length === 2);
    const f = await p.evaluate(() => ({
      submits: (window as any).fixture.submits,
      gets: (window as any).fixture.gets,
    }));
    expect(f.submits[0].requestId).toBe(f.submits[1].requestId);
    expect(f.gets).toEqual([f.submits[0].requestId]);
  } finally {
    await p.close();
  }
}, 15000);
it("关闭重开从本地原编号恢复，不自动重排", async () => {
  const p = await open();
  try {
    await p.evaluate(() => ((window as any).fixture.mode = "unknown"));
    await click(p, "检查当前模型");
    await p.waitForSelector("[role=alert]");
    await click(p, "关闭");
    await p.waitForFunction(
      () => !document.querySelector('[aria-label="人体模型绑骨"]')
    );
    await p.evaluate(() => (window as any).fixture.mount());
    await p.waitForFunction(() => (window as any).fixture.gets.length > 0);
    expect(await p.evaluate(() => (window as any).fixture.submits.length)).toBe(
      1
    );
  } finally {
    await p.close();
  }
}, 15000);

it("检查图读取失败撤销确认并禁止继续，不重新生成", async () => {
  const p = await open();
  try {
    await click(p, "检查当前模型");
    await p.waitForSelector("circle");
    await p.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>("input[type=checkbox]")
          ?.disabled === false
    );
    await check(p, 0);
    await p.$eval("img", e => e.dispatchEvent(new Event("error")));
    await p.waitForSelector("[role=alert]");
    expect(
      await p.$eval(
        "input[type=checkbox]",
        e => (e as HTMLInputElement).checked
      )
    ).toBe(false);
    expect(
      await p.$eval(
        "input[type=checkbox]",
        e => (e as HTMLInputElement).disabled
      )
    ).toBe(true);
    expect(await p.evaluate(() => (window as any).fixture.submits.length)).toBe(
      1
    );
  } finally {
    await p.close();
  }
}, 15000);
it("本机记录损坏仍继续读服务端历史", async () => {
  const p = await open();
  try {
    await click(p, "关闭");
    await p.waitForFunction(
      () => !document.querySelector('[aria-label="人体模型绑骨"]')
    );
    await p.evaluate(() => {
      localStorage.setItem("manhua-auto-rig:person:v1", "{broken");
      (window as any).fixture.lists = 0;
      (window as any).fixture.mount();
    });
    await p.waitForFunction(() => (window as any).fixture.lists > 0);
    expect(await p.evaluate(() => (window as any).fixture.submits.length)).toBe(
      0
    );
    expect(
      await p.$eval('[aria-label="人体模型绑骨"]', e => e.textContent)
    ).toContain("本机记录无法读取");
  } finally {
    await p.close();
  }
}, 15000);

it("鼠标拖动关节点后提交实际新坐标", async () => {
  const p = await open();
  try {
    await click(p, "检查当前模型");
    await p.waitForSelector('[aria-label="正面左肘"]');
    await p.$eval('[aria-label="正面左肘"]', e =>
      e.scrollIntoView({ block: "center" })
    );
    const before = await p.$eval('[aria-label="正面左肘"]', e => {
      const b = e.getBoundingClientRect();
      return {
        x: b.x + b.width / 2,
        y: b.y + b.height / 2,
        cx: Number(e.getAttribute("cx")),
      };
    });
    await p.mouse.move(before.x, before.y);
    await p.mouse.down();
    await p.mouse.move(before.x + 25, before.y - 10, { steps: 5 });
    await p.mouse.up();
    const after = await p.$eval('[aria-label="正面左肘"]', e =>
      Number(e.getAttribute("cx"))
    );
    expect(after).toBeGreaterThan(before.cx);
    await p.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>("input[type=checkbox]")
          ?.disabled === false
    );
    await check(p, 0);
    await click(p, "按确认的关节生成带骨候选");
    await p.waitForFunction(() => (window as any).fixture.submits.length === 2);
    const value = await p.evaluate(
      () => (window as any).fixture.submits[1].joints.elbowL
    );
    expect(value[1]).toBeGreaterThan(-0.2);
    expect(value[2]).toBeGreaterThan(1);
  } finally {
    await p.close();
  }
}, 15000);

it("当前模型变化撤销旧关节确认，新检查使用新模型身份", async () => {
  const p = await open();
  try {
    await click(p, "检查当前模型");
    await p.waitForSelector("circle");
    await p.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>("input[type=checkbox]")
          ?.disabled === false
    );
    await check(p, 0);
    await p.evaluate(() => {
      (window as any).fixture.source = "m3d_new_source";
      (window as any).fixture.mount();
    });
    await p.waitForFunction(() => !document.querySelector("circle"));
    await click(p, "检查当前模型");
    await p.waitForFunction(() => (window as any).fixture.submits.length === 2);
    expect(
      await p.evaluate(() => (window as any).fixture.submits[1].sourceJobId)
    ).toBe("m3d_new_source");
  } finally {
    await p.close();
  }
}, 15000);
