import { afterAll, beforeAll, expect, it as test } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";

let browser: Browser;
let bundle: string;
const it = (name: string, run: () => Promise<void>) => test(name, run, 20_000);
beforeAll(async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
      import React,{useState,StrictMode} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ManhuaPrevisStudioView} from './client/src/components/canvas/ManhuaPrevisStudio';
      import {createManhuaPrevisStudio} from './shared/manhuaPrevis';
      const f=globalThis.fixture={submits:[],gets:[],lists:[],updates:[],mode:'success',getResult:null};
      f.old={url:'https://offline.invalid/old.mp4',gcsUri:'gs://test/old.mp4',updatedAt:'2026-09-01T00:00:00Z'};
      f.makeBlock=(scope='11111111-1111-4111-8111-111111111111')=>({id:'clip-e01-g01',previsStudio:createManhuaPrevisStudio(10,scope),manhuaSegmentRefs:{previs:f.old}});
      f.response=(input)=>({jobId:'prv_test_job',status:'succeeded',params:input,output:{requestId:input.requestId,clipId:input.clipId,spec:input.spec,durationSec:input.spec.durationSec,gcsUri:'gs://test/unrelated-storage-folder/output.mp4',url:'https://offline.invalid/new.mp4',report:{warnings:['离线测试，不代表动作质量验收']}}});
      const services={submit:async input=>{f.submits.push(structuredClone(input));if(f.mode==='defer')return new Promise(resolve=>f.resolveSubmit=resolve);if(f.mode==='unknown')throw Error('离线模拟断网');const response=f.response(input);if(globalThis.keyedFixture)f.getResult=response;return response;},get:async id=>{f.gets.push(id);return f.getResult;},list:async (...args)=>{f.lists.push(args);if(f.mode==='defer-list')return new Promise(resolve=>f.resolveList=resolve);return {items:[],nextCursor:null};}};
      function App(){const [block,setBlock]=useState(()=>globalThis.keyedFixture?{...f.makeBlock(),previsStudio:undefined}:f.makeBlock());const [characters,setCharacters]=useState([{id:'character-mo',label:'墨屠'}]);const [shots,setShots]=useState([]);f.block=block;f.setBlock=setBlock;f.characters=characters;f.setCharacters=setCharacters;f.shots=shots;f.setShots=setShots;return <ManhuaPrevisStudioView key={globalThis.keyedFixture?block.id+':'+(block.previsStudio?.scopeId??'new'):undefined} block={block} characters={characters} sourceShots={shots} services={services} onChange={(studio,reference)=>{f.updates.push({studio:structuredClone(studio),reference});if(f.rejectSave)return false;setBlock(current=>({...current,previsStudio:studio,manhuaSegmentRefs:reference?{...current.manhuaSegmentRefs,previs:reference}:current.manhuaSegmentRefs}));return true;}}/>;}
      createRoot(document.getElementById('root')).render(globalThis.strictFixture?<StrictMode><App/></StrictMode>:<App/>);
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
        name: "禁止接入真实服务",
        setup(builder) {
          builder.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "offline",
          }));
          builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            loader: "js",
            contents: "export const trpc={};",
          }));
        },
      },
    ],
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": "{}",
    },
  });
  bundle = built.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30_000);
afterAll(async () => {
  await browser?.close();
});

async function open(strict = false, keyed = false) {
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (
      request.isNavigationRequest() &&
      request.url() === "http://localhost:41819/"
    )
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<html><link rel="icon" href="data:,"><div id="root"></div></html>',
      });
    else void request.abort();
  });
  await page.goto("http://localhost:41819");
  await page.evaluate(
    ({ strict, keyed }) => {
      (window as any).strictFixture = strict;
      (window as any).keyedFixture = keyed;
    },
    { strict, keyed }
  );
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector("[data-manhua-previs-studio]");
  return page;
}
async function click(page: Page, text: string) {
  await page.evaluate(label => {
    const button = Array.from(document.querySelectorAll("button")).find(
      b => b.textContent === label
    );
    if (!button || button.disabled) throw Error(`按钮不可用：${label}`);
    button.click();
  }, text);
}
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

it("编辑真实角色和动作后提交当前配置，候选不自动采用，采用与旧参考恢复闭合", async () => {
  const page = await open();
  try {
    await page.select('[aria-label="角色1项目资产"]', "character-mo");
    await click(page, "添加动作");
    await page.select('[aria-label="角色1动作1"]', "strike");
    await page.select('[aria-label="白模画幅"]', "9:16");
    await click(page, "确认生成动作白模");
    await page.waitForFunction(
      () => (window as any).fixture.block.previsStudio.history.length === 1
    );
    const actual = await page.evaluate(() => {
      const f = (window as any).fixture;
      return {
        input: f.submits[0],
        reference: f.block.manhuaSegmentRefs.previs,
        pending: f.block.previsStudio.pending,
        saved: f.updates.find((u: any) => u.studio.pending)?.studio.pending,
        selected: f.block.previsStudio.selectedJobId,
      };
    });
    expect(actual.input.spec.aspect).toBe("9:16");
    expect(actual.input.spec.actors[0]).toMatchObject({
      nameZh: "墨屠",
      assetRef: "character-mo",
      actions: [{ kind: "strike", startSec: 0, endSec: 10 }],
    });
    expect(actual.saved).toEqual(actual.input);
    expect(actual.pending).toBeUndefined();
    expect(actual.selected).toBeUndefined();
    expect(actual.reference.gcsUri).toBe("gs://test/old.mp4");
    await click(page, "采用为本段参考");
    await settle(page);
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.manhuaSegmentRefs.previs.motionGuideZh
      )
    ).toContain("墨屠（character-mo）");
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.previsStudio.referenceHistory[0].gcsUri
      )
    ).toBe("gs://test/old.mp4");
    await click(page, "恢复旧参考 1");
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri
      )
    ).toBe("gs://test/old.mp4");
    expect(
      await page.evaluate(() => (window as any).fixture.submits.length)
    ).toBe(1);
  } finally {
    await page.close();
  }
});

it("编辑中清空名称可以保存草稿，但无效配置不能提交渲染", async () => {
  const page = await open();
  try {
    await page.focus('[aria-label="角色1名称"]');
    await page.$eval('[aria-label="角色1名称"]', element => {
      const input = element as HTMLInputElement;
      input.select();
    });
    await page.keyboard.press("Backspace");
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.spec.actors[0].nameZh
      )
    ).toBe("");
    await click(page, "确认生成动作白模");
    await page.waitForSelector('[role="alert"]');
    expect(await page.evaluate(() => (window as any).fixture.submits)).toEqual(
      []
    );
  } finally {
    await page.close();
  }
});

it("提交结果不明后确认原编号，绝不创建第二个请求身份", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      (window as any).fixture.mode = "unknown";
    });
    await click(page, "确认生成动作白模");
    await page.waitForSelector('[role="alert"]');
    await click(page, "确认原请求（不新建编号）");
    await page.waitForFunction(
      () => (window as any).fixture.submits.length === 2
    );
    const actual = await page.evaluate(() => {
      const f = (window as any).fixture;
      return {
        calls: f.submits,
        pending: f.block.previsStudio.pending,
        gets: f.gets,
      };
    });
    expect(actual.calls[1]).toEqual(actual.calls[0]);
    expect(actual.pending).toEqual(actual.calls[0]);
    expect(actual.gets).toContain(actual.pending.requestId);
  } finally {
    await page.close();
  }
});

it("恢复草稿中的在途编号只查询原单，成功后保留候选且不自动提交", async () => {
  const page = await open(true);
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture;
      const pending = {
        requestId: "22222222-2222-4222-8222-222222222222",
        scopeId: f.block.previsStudio.scopeId,
        clipId: f.block.id,
        spec: f.block.previsStudio.spec,
      };
      f.getResult = f.response(pending);
      f.setBlock({
        ...f.block,
        previsStudio: { ...f.block.previsStudio, pending },
      });
    });
    await page.waitForFunction(
      () => (window as any).fixture.block.previsStudio.history.length === 1
    );
    const actual = await page.evaluate(() => {
      const f = (window as any).fixture;
      return {
        gets: f.gets,
        submits: f.submits,
        pending: f.block.previsStudio.pending,
        reference: f.block.manhuaSegmentRefs.previs.gcsUri,
        take: f.block.previsStudio.history[0],
      };
    });
    expect(actual.gets).toEqual(["22222222-2222-4222-8222-222222222222"]);
    expect(actual.submits).toEqual([]);
    expect(actual.pending).toBeUndefined();
    expect(actual.reference).toBe("gs://test/old.mp4");
    expect(actual.take.requestId).toBe(actual.gets[0]);
  } finally {
    await page.close();
  }
});

it("历史预览以保存的 requestId 续签，不从 jobId 或对象路径猜编号", async () => {
  const page = await open();
  try {
    await click(page, "确认生成动作白模");
    await page.waitForFunction(
      () => (window as any).fixture.block.previsStudio.history.length === 1
    );
    await page.evaluate(() => {
      (window as any).fixture.gets = [];
    });
    await click(page, "预览");
    const actual = await page.evaluate(() => {
      const f = (window as any).fixture;
      return { gets: f.gets, requestId: f.submits[0].requestId };
    });
    expect(actual.gets).toEqual([actual.requestId]);
  } finally {
    await page.close();
  }
});

it("StrictMode 的 effect 重挂后仍能消费真实组件的生成回执", async () => {
  const page = await open(true);
  try {
    await click(page, "确认生成动作白模");
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.history.length
      )
    ).toBe(1);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.pending
      )
    ).toBeUndefined();
  } finally {
    await page.close();
  }
});

it("历史查询期间切换 scope，旧分页响应不能写入新项目", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      (window as any).fixture.mode = "defer-list";
    });
    await click(page, "恢复本段历史");
    await page.waitForFunction(() =>
      Boolean((window as any).fixture.resolveList)
    );
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.oldResponse = f.response({
        requestId: "22222222-2222-4222-8222-222222222222",
        scopeId: f.block.previsStudio.scopeId,
        clipId: f.block.id,
        spec: f.block.previsStudio.spec,
      });
      f.setBlock(f.makeBlock("33333333-3333-4333-8333-333333333333"));
    });
    await settle(page);
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.resolveList({ items: [f.oldResponse], nextCursor: null });
    });
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.history
      )
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.scopeId
      )
    ).toBe("33333333-3333-4333-8333-333333333333");
    expect(await page.$("video")).toBeNull();
  } finally {
    await page.close();
  }
});

it("草稿保存失败时不能提交渲染，采用保存失败时不得替换旧参考", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      (window as any).fixture.rejectSave = true;
    });
    await click(page, "确认生成动作白模");
    await settle(page);
    expect(await page.evaluate(() => (window as any).fixture.submits)).toEqual(
      []
    );
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.pending
      )
    ).toBeUndefined();
    await page.evaluate(() => {
      (window as any).fixture.rejectSave = false;
    });
    await click(page, "确认生成动作白模");
    await page.waitForFunction(
      () => (window as any).fixture.block.previsStudio.history.length === 1
    );
    await page.evaluate(() => {
      (window as any).fixture.rejectSave = true;
    });
    await click(page, "采用为本段参考");
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri
      )
    ).toBe("gs://test/old.mp4");
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.selectedJobId
      )
    ).toBeUndefined();
    expect(
      await page.$eval('[role="status"]', el => el.textContent)
    ).not.toContain("已采用");
  } finally {
    await page.close();
  }
});

it("首次保存使父级 key 从 new 变为 scope 重挂后，原单终态仍由查询恢复", async () => {
  const page = await open(true, true);
  try {
    expect(
      await page.evaluate(() => (window as any).fixture.block.previsStudio)
    ).toBeUndefined();
    await click(page, "确认生成动作白模");
    await page.waitForFunction(
      () => (window as any).fixture.block.previsStudio?.history.length === 1
    );
    const actual = await page.evaluate(() => {
      const f = (window as any).fixture;
      return { submits: f.submits, gets: f.gets, studio: f.block.previsStudio };
    });
    expect(actual.submits).toHaveLength(1);
    expect(actual.gets).toContain(actual.submits[0].requestId);
    expect(actual.studio.history[0].requestId).toBe(
      actual.submits[0].requestId
    );
    expect(actual.studio.pending).toBeUndefined();
  } finally {
    await page.close();
  }
});

it("提交期间切换 scope，旧生成回执不能成为新项目候选", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      (window as any).fixture.mode = "defer";
    });
    await click(page, "确认生成动作白模");
    await page.waitForFunction(() =>
      Boolean((window as any).fixture.resolveSubmit)
    );
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.setBlock(f.makeBlock("33333333-3333-4333-8333-333333333333"));
    });
    await settle(page);
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.resolveSubmit(f.response(f.submits[0]));
    });
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.history
      )
    ).toEqual([]);
    expect(await page.$("video")).toBeNull();
  } finally {
    await page.close();
  }
});

async function setupScript(page: Page) {
  await page.evaluate(() => {
    const f=(window as any).fixture;
    f.beforeSpec=structuredClone(f.block.previsStudio.spec);
    f.setCharacters([{id:'qing',label:'阿菁',tag:'@人物1'},{id:'guard',label:'家丁',tag:'@人物2'}]);
    f.setShots([{index:7,durationSec:4,actionZh:'阿菁一拳击中家丁，家丁受击后仰。'}]);
  });
  await page.waitForSelector('[data-previs-script-draft]');
}
async function toggleLabel(page: Page, text: string) {
  await page.evaluate(text => {
    const label=Array.from(document.querySelectorAll('label')).find(el=>el.textContent?.includes(text));
    const input=label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if(!input||input.disabled)throw Error('复选框不可用：'+text);
    input.click();
  },text);
  await settle(page);
}

it('剧本草案先预览再确认，仅改配置，撤销精确恢复旧spec与旧参考',async()=>{
  const page=await open();
  try {
    await setupScript(page);await click(page,'从本段剧本生成动作草案');await settle(page);
    expect(await page.$eval('[data-previs-script-draft]',e=>e.textContent)).toContain('双人事件 1 个');
    const before=await page.evaluate(()=>{const f=(window as any).fixture;return {old:f.beforeSpec,current:f.block.previsStudio.spec,submits:f.submits,updates:f.updates};});
    expect(before.current).toEqual(before.old);expect(before.submits).toEqual([]);expect(before.updates).toEqual([]);
    await toggleLabel(page,'我已审阅动作');await click(page,'采用动作草案');await settle(page);
    const adopted=await page.evaluate(()=>{const f=(window as any).fixture;return {studio:f.block.previsStudio,reference:f.block.manhuaSegmentRefs.previs,submits:f.submits};});
    expect(adopted.studio.spec.interactions).toHaveLength(1);
    expect(adopted.studio.spec.actors.map((a:any)=>a.assetRef)).toEqual(['qing','guard']);
    expect(adopted.studio.specHistory[0].spec).toEqual(before.old);
    expect(adopted.reference.gcsUri).toBe('gs://test/old.mp4');expect(adopted.submits).toEqual([]);
    await click(page,'恢复上一份动作配置（不改已采用参考）');await settle(page);
    expect(await page.evaluate(()=>(window as any).fixture.block.previsStudio.spec)).toEqual(before.old);
    expect(await page.evaluate(()=>(window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri)).toBe('gs://test/old.mp4');
  }finally{await page.close();}
});

it('草案预览后原镜改变，已勾选审阅也不能采用旧草案',async()=>{
  const page=await open();
  try {
    await setupScript(page);await click(page,'从本段剧本生成动作草案');await toggleLabel(page,'我已审阅动作');
    await page.evaluate(()=>{const f=(window as any).fixture;f.setShots([{...f.shots[0],actionZh:'阿菁静立。'}]);});await settle(page);
    expect(await page.$eval('[data-previs-script-draft]',e=>e.textContent)).toContain('原剧本或角色已变化');
    expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='采用动作草案')?.disabled)).toBe(true);
    expect(await page.evaluate(()=>(window as any).fixture.updates)).toEqual([]);
    expect(await page.evaluate(()=>(window as any).fixture.submits)).toEqual([]);
  }finally{await page.close();}
});

it('草案预览后手工编辑配置，旧草案禁采用且不覆盖新朝向',async()=>{
  const page=await open();
  try {
    await setupScript(page);await click(page,'从本段剧本生成动作草案');await toggleLabel(page,'我已审阅动作');
    await page.focus('[aria-label="朝向角度"]');await page.$eval('[aria-label="朝向角度"]',e=>(e as HTMLInputElement).select());
    await page.keyboard.type('45');await settle(page);
    expect(await page.evaluate(()=>(window as any).fixture.block.previsStudio.spec.actors[0].facingDeg)).toBe(45);
    expect(await page.$eval('[data-previs-script-draft]',e=>e.textContent)).toContain('当前动作配置已变化');
    expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='采用动作草案')?.disabled)).toBe(true);
    expect(await page.evaluate(()=>(window as any).fixture.block.previsStudio.specHistory)).toBeUndefined();
    expect(await page.evaluate(()=>(window as any).fixture.submits)).toEqual([]);
    await click(page,'从本段剧本生成动作草案');await settle(page);
    expect(await page.$eval('[data-previs-script-draft]',e=>e.textContent)).not.toContain('当前动作配置已变化');
    expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='采用动作草案')?.disabled)).toBe(true);
  }finally{await page.close();}
});

it('尾翼勾选与取消真实编辑，不提交渲染，不替换旧参考',async()=>{
  const page=await open();
  try {
    await page.select('[aria-label="角色1形体"]','horse');await page.click('[aria-label="角色1四尾黑翼"]');await settle(page);
    expect(await page.evaluate(()=>(window as any).fixture.block.previsStudio.spec.actors[0].creature.preset)).toBe('four_tail_black_wings');
    await page.focus('[aria-label="显形结束"]');await page.$eval('[aria-label="显形结束"]',e=>(e as HTMLInputElement).select());
    await page.keyboard.press('Backspace');await settle(page);
    expect(await page.evaluate(()=>(window as any).fixture.block.previsStudio.spec.actors[0].creature.transformEndSec)).toBe(0);
    await page.click('[aria-label="角色1四尾黑翼"]');await settle(page);
    expect(await page.evaluate(()=>(window as any).fixture.block.previsStudio.spec.actors[0].creature)).toBeUndefined();
    expect(await page.evaluate(()=>(window as any).fixture.submits)).toEqual([]);
    expect(await page.evaluate(()=>(window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri)).toBe('gs://test/old.mp4');
  }finally{await page.close();}
});

it('已有模型表单先取消再应用，无自动提交且停用后保留来源模型',async()=>{
  const page=await open();
  try {
    await page.evaluate(()=>{const f=(window as any).fixture;f.setCharacters([{id:'character-mo',label:'墨屠',model:{taskId:'m3d_test'}}]);});
    await settle(page);await page.select('[aria-label="角色1项目资产"]','character-mo');
    await page.evaluate(()=>Array.from(document.querySelectorAll('summary')).find(e=>e.textContent?.includes('角色模型与表演'))?.click());
    await toggleLabel(page,'启用当前角色的已有带骨模型');
    expect(await page.evaluate(()=>(window as any).fixture.block.previsStudio.spec.actors[0].riggedModel)).toBeUndefined();
    await click(page,'取消编辑');await settle(page);
    expect(await page.evaluate(()=>(window as any).fixture.block.previsStudio.spec.actors[0].riggedModel)).toBeUndefined();
    await toggleLabel(page,'启用当前角色的已有带骨模型');await click(page,'应用角色配置');await settle(page);
    expect(await page.evaluate(()=>(window as any).fixture.block.previsStudio.spec.actors[0].riggedModel)).toMatchObject({sourceJobId:'m3d_test',targetHeight:1.7});
    expect(await page.evaluate(()=>(window as any).fixture.submits)).toEqual([]);
    await toggleLabel(page,'启用当前角色的已有带骨模型');await click(page,'应用角色配置');await settle(page);
    expect(await page.evaluate(()=>(window as any).fixture.block.previsStudio.spec.actors[0].riggedModel)).toBeUndefined();
    expect(await page.evaluate(()=>(window as any).fixture.characters[0].model.taskId)).toBe('m3d_test');
    expect(await page.evaluate(()=>(window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri)).toBe('gs://test/old.mp4');
  }finally{await page.close();}
});
