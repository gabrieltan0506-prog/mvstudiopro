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
 const services={submit:async r=>{f.submits.push(structuredClone(r));if(f.submit)return f.submit(r);if(f.mode==='unknown')throw Error('离线模拟断网');return f.current=f.response(r);},get:async id=>{f.gets.push(id);return f.get?f.get(id):f.current;},list:async()=>{f.lists++;if(f.list)return f.list();return {items:[],nextCursor:null}},adopt:async()=>({taskId:'m3d_adopted'}),restore:async()=>({taskId:'m3d_original'})};
 globalThis.fixtureSetup?.(f);
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
async function open(setup?: string) {
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
  if (setup)
    await p.addScriptTag({ content: `globalThis.fixtureSetup=${setup}` });
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

it("迟到的历史终态不能清除新任务编号或停止追踪", async () => {
  const p = await open();
  try {
    await click(p, "检查当前模型");
    await p.waitForSelector("circle");
    await p.evaluate(() => {
      const f = (window as any).fixture;
      const old = f.current;
      f.get = () =>
        new Promise(resolve => {
          f.release = () => resolve(old);
        });
      f.submit = (r: any) =>
        (f.current = { ...f.response(r), status: "queued", output: null });
      document.querySelector("details")!.open = true;
      document.querySelector<HTMLButtonElement>("details button")!.click();
    });
    await p.waitForFunction(() => Boolean((window as any).fixture.release));
    await click(p, "检查当前模型");
    await p.waitForFunction(() => (window as any).fixture.submits.length === 2);
    await p.evaluate(() => (window as any).fixture.release());
    await p.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some(
        b => b.textContent === "查询原任务"
      )
    );
    expect(
      await p.evaluate(() => ({
        stored: JSON.parse(localStorage.getItem("manhua-auto-rig:person:v1")!)
          .requestId,
        expected: (window as any).fixture.submits[1].requestId,
        disabled: Array.from(document.querySelectorAll("button")).find(
          b => b.textContent === "检查当前模型"
        )!.disabled,
      }))
    ).toEqual(
      expect.objectContaining({ disabled: true, stored: expect.any(String) })
    );
    const ids = await p.evaluate(() => [
      JSON.parse(localStorage.getItem("manhua-auto-rig:person:v1")!).requestId,
      (window as any).fixture.submits[1].requestId,
    ]);
    expect(ids[0]).toBe(ids[1]);
  } finally {
    await p.close();
  }
}, 15000);

it("首次历史列表迟到不能把已完成请求恢复为排队", async () => {
  const p = await open(
    `f=>{f.releases=[];f.list=()=>new Promise(resolve=>f.releases.push(resolve));}`
  );
  try {
    await click(p, "检查当前模型");
    await p.waitForSelector("circle");
    await p.evaluate(() => {
      const f = (window as any).fixture;
      for (const resolve of f.releases)
        resolve({
          items: [{ ...f.current, status: "queued", output: null }],
          nextCursor: null,
        });
    });
    await p.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).find(
          b => b.textContent === "检查当前模型"
        )?.disabled === false
    );
    expect(
      await p.evaluate(() => localStorage.getItem("manhua-auto-rig:person:v1"))
    ).toBeNull();
    expect(await p.$$("circle")).toHaveLength(42);
  } finally {
    await p.close();
  }
}, 15000);

it("查询已完成后迟到的提交排队回执不能倒退状态或重新保留编号", async () => {
  const p = await open();
  try {
    await p.evaluate(() => {
      const f = (window as any).fixture;
      f.submit = (r: any) =>
        new Promise(resolve => {
          f.current = f.response(r);
          f.release = () =>
            resolve({ ...f.current, status: "queued", output: null });
        });
    });
    await click(p, "检查当前模型");
    await p.waitForFunction(() => Boolean((window as any).fixture.release));
    // 提交响应未返回时，既有轮询仍查询同一编号。
    await p.waitForSelector("circle", { timeout: 8000 });
    await p.evaluate(() => (window as any).fixture.release());
    await p.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).find(
          b => b.textContent === "检查当前模型"
        )?.disabled === false
    );
    expect(
      await p.evaluate(() => localStorage.getItem("manhua-auto-rig:person:v1"))
    ).toBeNull();
    expect(await p.evaluate(() => (window as any).fixture.submits.length)).toBe(
      1
    );
  } finally {
    await p.close();
  }
}, 15000);

it("当前任务结束不能删除其他页面后来保存的请求编号", async () => {
  const p = await open();
  try {
    await p.evaluate(() => {
      const f = (window as any).fixture;
      f.submit = (r: any) => {
        localStorage.setItem(
          "manhua-auto-rig:person:v1",
          JSON.stringify({
            ...r,
            requestId: "55555555-5555-4555-8555-555555555555",
          })
        );
        return (f.current = f.response(r));
      };
    });
    await click(p, "检查当前模型");
    await p.waitForSelector("circle");
    expect(
      await p.evaluate(
        () =>
          JSON.parse(localStorage.getItem("manhua-auto-rig:person:v1")!)
            .requestId
      )
    ).toBe("55555555-5555-4555-8555-555555555555");
  } finally {
    await p.close();
  }
}, 15000);

it("0917 轮询遇网关 HTML 回包不当失败：只提示、继续查同一编号，下一轮恢复后清提示", async () => {
  const p = await open(`f=>{f.submit=r=>({jobId:'rig_test',status:'running',params:r,error:null,createdAt:null,updatedAt:null,output:null});let n=0;f.get=id=>{n++;if(n===1)throw new SyntaxError('Unexpected token <, <!DOCTYPE ... is not valid JSON');return f.response(f.submits[0]);};}`);
  try {
    await click(p, "检查当前模型");
    // 第 1 轮（约 5 秒后）拿到 HTML：不能进 [role=alert]，只能是提示，并且明确说继续查同一编号
    await p.waitForFunction(() => document.body.textContent?.includes("继续查同一编号"), { timeout: 9000 });
    expect(await p.$("[role=alert]")).toBeNull();
    // 第 2 轮恢复：同一编号、没有第二次提交、提示清掉
    await p.waitForFunction(() => (window as any).fixture.gets.length >= 2, { timeout: 9000 });
    await p.waitForFunction(() => !document.body.textContent?.includes("继续查同一编号"), { timeout: 9000 });
    const f = await p.evaluate(() => ({ submits: (window as any).fixture.submits.length, gets: (window as any).fixture.gets }));
    expect(f.submits).toBe(1);
    expect(new Set(f.gets).size).toBe(1);
    expect(await p.$("[role=alert]")).toBeNull();
  } finally {
    await p.close();
  }
}, 30000);

it("0917 反例：轮询拿到服务端明确错误码（需登录）必须进 [role=alert]，不能当瞬时只提示", async () => {
  const p = await open(`f=>{f.submit=r=>({jobId:'rig_test',status:'running',params:r,error:null,createdAt:null,updatedAt:null,output:null});f.get=()=>{throw Object.assign(new Error('Please login (10001)'),{data:{code:'UNAUTHORIZED',httpStatus:401}});};}`);
  try {
    await click(p, "检查当前模型");
    await p.waitForSelector("[role=alert]", { timeout: 9000 });
    const alert = await p.$eval("[role=alert]", el => el.textContent || "");
    expect(alert).toContain("Please login (10001)");
    expect(await p.evaluate(() => document.body.textContent?.includes("继续查同一编号"))).toBe(false);
  } finally {
    await p.close();
  }
}, 30000);
