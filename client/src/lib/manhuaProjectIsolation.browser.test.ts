import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
it("真实工厂两个分页面切换/刷新隔离作品，原工作区不变，错误账号不挂载工厂", async () => {
  const built = await build({
    entryPoints: ["client/src/lib/manhuaFinalLayout.fixture.tsx"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
      "@/components/canvas/FreeformCanvas": path.resolve(
        "client/src/lib/__browserfixtures__/freeformCanvasProbe.tsx"
      ),
      "@/components/ManhuaScriptWorkbench": path.resolve(
        "client/src/lib/__browserfixtures__/manhuaWorkbenchProbe.tsx"
      ),
    },
    plugins: [
      {
        name: "auth",
        setup(b) {
          b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({
            path: "auth",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents:
              'export const useAuth=()=>({user:{id:1,role:"admin"},loading:false,isAuthenticated:true,logout:()=>{}});',
            loader: "js",
          }));
        },
      },
    ],
    loader: {
      ".png": "dataurl",
      ".svg": "dataurl",
      ".jpg": "dataurl",
      ".css": "text",
    },
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env": "__VITE_ENV__",
    },
    banner: {
      js: 'var __VITE_ENV__={DEV:false,PROD:true,MODE:"production",SSR:false};',
    },
    logLevel: "silent",
  });
  const seed = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `import {createNovelFactoryProject} from './client/src/lib/novelFactoryProject';(window as any).seed=(id,title)=>{const input={requestId:id,roundId:id,stage:'script',topic:title,direction:'本剧方向',episodeCount:3,chapterIndex:1,outline:'大纲',novel:'小说',templates:[],selectedTemplateIds:[]};const script={title,episodes:[1,2,3].map(index=>({index,title:'第'+index+'集',opening:'发现密信',payoff:'保住同伴',hook:'发现另一封密信',scenes:[{key:'E'+index+'-S1',场景:'雨夜书库，沈砚握住账本退后一步，眼神盯着守卫。',人物:'沈砚与守卫',妆容:'青衣湿透',灯光:'冷光照亮眉眼',氛围:'逼近的危机感',对白:'沈砚：「账本留在这里，人必须跟我走。」'}]}))};createNovelFactoryProject(localStorage,'1',{input,result:{requestId:id,stage:'script',text:JSON.stringify(script),templateIds:[],inputSha256:'a',resultSha256:id}});};`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.createBrowserContext();
    const prepare = async (id: string) => {
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.setRequestInterception(true);
      page.on(
        "request",
        r =>
          void r.respond({
            status: 200,
            contentType: "text/html",
            body: '<div id="root"></div>',
          })
      );
      await page.goto(`http://localhost:41849/canvas?project=${id}&owner=1`);
      return page;
    };
    const pageA = await prepare(A);
    await pageA.evaluate(() => {
      localStorage.setItem(
        "mv-manhua-writer-session-v1",
        JSON.stringify({ topic: "墨菁传原稿", guard: "keep" })
      );
      localStorage.setItem("mv-freeform-canvas-v1", "原作品画布");
    });
    await pageA.addScriptTag({ content: seed.outputFiles[0].text });
    await pageA.evaluate(
      ([a, b]) => {
        (window as any).seed(a, "作品甲");
        (window as any).seed(b, "作品乙");
      },
      [A, B]
    );
    const legacy = await pageA.evaluate(() => [
      localStorage.getItem("mv-manhua-writer-session-v1"),
      localStorage.getItem("mv-freeform-canvas-v1"),
    ]);
    await pageA.addScriptTag({ content: built.outputFiles[0].text });
    await pageA.waitForFunction(
      () =>
        Object.keys(localStorage).some(
          k =>
            k.includes("11111111") &&
            localStorage.getItem(k)?.includes("作品甲")
        ) && document.body.innerText.includes("切换作品")
    );
    await pageA.waitForFunction(
      () => (window as any).__wbProps?.seriesTitle === "作品甲"
    );
    expect(
      await pageA.evaluate(
        () =>
          (window as any).__wbProps?.writerPack?.episodes?.length ||
          JSON.parse(
            localStorage.getItem(
              "mv-manhua-project:1:11111111-1111-4111-8111-111111111111:mv-manhua-writer-session-v1"
            )!
          ).writerPack.episodes.length
      )
    ).toBe(3);
    const duplicate = await prepare(A);
    await duplicate.addScriptTag({content:built.outputFiles[0].text});
    await duplicate.waitForFunction(()=>document.body.innerText.includes("另一页面中编辑"));
    expect(await duplicate.evaluate(()=>(window as any).__wbProps)).toBeUndefined();
    await duplicate.close();
    const pageB = await prepare(B);
    await pageB.addScriptTag({ content: built.outputFiles[0].text });
    await pageB.waitForFunction(() =>
      document.body.innerText.includes("切换作品")
    );
    await pageB.waitForFunction(
      () => (window as any).__wbProps?.seriesTitle === "作品乙"
    );
    const topics = async (page: typeof pageA) =>
      page.evaluate(
        ([a, b]) =>
          [a, b].map(
            id =>
              JSON.parse(
                localStorage.getItem(
                  `mv-manhua-project:1:${id}:mv-manhua-writer-session-v1`
                )!
              ).topic
          ),
        [A, B]
      );
    expect(await topics(pageA)).toEqual(["作品甲", "作品乙"]);
    // Both real workspaces have mounted and saved their own state.
    await pageA.reload();
    await pageA.addScriptTag({ content: built.outputFiles[0].text });
    await pageA.waitForFunction(() =>
      document.body.innerText.includes("切换作品")
    );
    expect(await topics(pageA)).toEqual(["作品甲", "作品乙"]);
    expect(
      await pageA.evaluate(() => [
        localStorage.getItem("mv-manhua-writer-session-v1"),
        localStorage.getItem("mv-freeform-canvas-v1"),
      ])
    ).toEqual(legacy);
    await pageB.goto(`http://localhost:41849/canvas?project=${B}&owner=2`);
    await pageB.addScriptTag({ content: built.outputFiles[0].text });
    await pageB.waitForFunction(() =>
      document.body.innerText.includes("创建此作品的账号")
    );
    expect(await pageB.$("[data-navbar-workspace-navigation]")).toBeNull();
  } finally {
    await browser.close();
  }
}, 60000);
