import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";

// 使用完整首页与真实控件；只替换鉴权、上传存储及网络，不访问生产或生成媒体。
async function fixture(renderMedia = false) {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import HomePage from './client/src/pages/Home';
      globalThis.mountHome=()=>{globalThis.fixtureRoot=createRoot(document.getElementById('root'));globalThis.fixtureRoot.render(<QueryClientProvider client={new QueryClient()}><HomePage/></QueryClientProvider>);};
      globalThis.mountHome();
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent",
    plugins: [{ name: "home-network-boundaries", setup(b) {
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      b.onLoad({ filter: /[/\\]useAuth\.ts$/ }, () => ({ loader: "js", contents: `
        export const useAuth=()=>({user:{id:1,name:'创作者',credits:1000,role:'user'},isAuthenticated:true,loading:false,refresh:()=>{},logout:async()=>{}});
      ` }));
      b.onLoad({ filter: /[/\\]photoTemporaryMedia\.ts$/ }, () => ({ loader: "js", contents: `
        export const uploadPhotoTemporaryMedia=async file=>{globalThis.fixtureCalls.push({name:'photo.upload',input:{name:file.name,type:file.type}});return {url:'https://fixture.invalid/source.jpg',previewUrl:URL.createObjectURL(file)};};
        export const cachePhotoTemporaryMedia=async(url,kind)=>{globalThis.fixtureCalls.push({name:'photo.cache',input:{url,kind}});return url;};
      ` }));
      b.onLoad({ filter: /[/\\]trpc\.ts$/ }, () => ({ loader: "js", contents: `
        import React from 'react';
        const node=parts=>new Proxy(()=>{}, {get(_,key){
          const name=parts.join('.');
          if(key==='useQuery')return ()=>{const[n,set]=React.useState(0);return {data:globalThis.fixtureData[name],isLoading:false,error:null,refetch:async()=>set(v=>v+1)};};
          if(key==='useMutation')return opts=>{const[pending,set]=React.useState(false);const run=async input=>{set(true);try{const result=await globalThis.fixtureRpc(name,input);opts?.onSuccess?.(result);return result;}catch(e){opts?.onError?.(e);throw e;}finally{set(false);}};return {isPending:pending,mutateAsync:run,mutate:input=>void run(input).catch(()=>{})};};
          if(key==='useUtils')return ()=>node([]);
          if(key==='invalidate')return async()=>{};
          return node([...parts,String(key)]);
        }});
        export const trpc=node([]);
      ` }));
    } }],
  });
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setRequestInterception(true);
  page.on("request", async request => {
    const url = new URL(request.url());
    if (["blob:", "data:"].includes(url.protocol)) return request.continue();
    // 接线检查不解码正式整集媒体，也不在截图探针中重复载入大视频。
    if (url.pathname.endsWith(".mp4")) {
      if (!renderMedia || !url.pathname.startsWith("/home-assets/")) return request.respond({ status: 204, body: "" });
      const bytes = await readFile(path.resolve("client/public", `.${url.pathname}`));
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range || "");
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : start + 1_048_575, bytes.length - 1);
        return request.respond({ status: 206, contentType: "video/mp4", headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${bytes.length}` }, body: bytes.subarray(start, end + 1) });
      }
      return request.respond({ status: 200, contentType: "video/mp4", headers: { "Accept-Ranges": "bytes" }, body: bytes });
    }
    if (["/home-assets/", "/blog-assets/"].some(prefix => url.pathname.startsWith(prefix))) {
      try {
        const file = path.resolve("client/public", `.${url.pathname}`);
        const contentType = file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".png") ? "image/png" : "image/jpeg";
        return request.respond({ status: 200, contentType, body: await readFile(file) });
      } catch { /* 缺少本地的既有展示素材不访问远端。 */ }
    }
    if (url.hostname === "fixture.invalid" && url.pathname.endsWith(".jpg")) {
      return request.respond({ status: 200, contentType: "image/jpeg", headers: { "Access-Control-Allow-Origin": "*" }, body: await readFile("client/public/home-assets/mojing-episode-01-20261007-poster.jpg") });
    }
    return request.respond({ status: 200, contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' });
  });
  await page.goto("http://localhost:4177/");
  const assets = path.resolve("client/dist/assets");
  for (const style of (await readdir(assets)).filter(f => f.endsWith(".css"))) {
    await page.addStyleTag({ content: await readFile(path.join(assets, style), "utf8") });
  }
  await page.evaluate(() => {
    const g = globalThis as any;
    g.fixtureCalls = [];
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        // 核验下载消费者的真实地址与文件名；不让测试文件触发浏览器保存对话框。
        g.fixtureCalls.push({ name: "download.anchor", input: { href: this.href, fileName: this.download } });
        return;
      }
      nativeAnchorClick.call(this);
    };
    g.fixtureAnimationState = "running";
    g.fixtureRestoreFail = false;
    g.fixtureData = { "fileConversion.formats": { available: true, paidAvailable: true }, "fileConversion.quota": { remaining: 3 }, "fileConversion.history": [], "creations.list": { items: [], total: 0 } };
    g.fixtureRpc = async (name: string, input: any) => {
      g.fixtureCalls.push({ name, input });
      if (name === "homePhotoTools.restoreOldPhoto") {
        if (g.fixtureRestoreFail) throw new Error("修复失败，积分已退回");
        return { success: true, imageUrl: "https://fixture.invalid/restored.jpg", creditsUsed: 10, aspect: input.aspect };
      }
      if (name === "fileConversion.upload") return { uploadUrl: "https://fixture.invalid/upload", requiredHeaders: {}, objectName: "fixture-source" };
      if (name === "fileConversion.inspect") {
        g.fixtureData["fileConversion.history"] = [{ id: "inspection-1", status: "succeeded", fileName: input.fileName, formatId: input.formatId, lane: input.lane, phase: "inspect", result: { type: "inspection", notice: "文字层可转换", source: { bytes: input.bytes }, billing: { credits: 4, needsOcr: false, available: true } } }];
      }
      if (name === "fileConversion.convert") {
        g.fixtureData["fileConversion.history"] = [{ id: "conversion-1", status: "succeeded", fileName: "原件.pdf", formatId: "pdf-docx", lane: "paid", phase: "convert", result: { type: "converted", fileName: "原件.docx", bytes: 100, credits: 4 } }];
      }
      if (name === "fileConversion.download") return { url: "https://fixture.invalid/output.docx", fileName: "原件.docx" };
      if (name === "fileConversion.cancel") g.fixtureData["fileConversion.history"] = [];
      return { success: true, message: "已提交" };
    };
    window.confirm = () => true;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), location.href);
      const op = url.searchParams.get("op");
      g.fixtureCalls.push({ name: op || url.pathname, input: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null, method: init?.method || "GET" });
      let data: any = { ok: true };
      if (url.pathname === "/api/me") data = { id: 1 };
      if (op === "homePhotoUpscale") data = { ok: true, imageUrl: "https://fixture.invalid/upscaled.jpg", creditsUsed: 15 };
      if (op === "homePhotoAnimate") data = { ok: true, taskId: "fixture-animation", status: "running" };
      if (op === "homePhotoAnimateStatus") data = { ok: true, taskId: "fixture-animation", status: g.fixtureAnimationState, ...(g.fixtureAnimationState === "succeeded" ? { videoUrl: "https://fixture.invalid/animation.mp4", creditsUsed: 79 } : {}) };
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForSelector("#file-conversion");
  const click = async (root: string, text: string) => page.evaluate(({ root, text }) => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>(`${root} button`)).find(b => b.textContent?.trim() === text);
    if (!button || button.disabled) throw Error(`${root}: ${text} 不可用`);
    button.click();
  }, { root, text });
  return { browser, page, errors, click, script: bundle.outputFiles[0].text };
}

it("完整首页暖色主题、顺序、移动菜单及转换的检查确认下载接线", async () => {
  const { browser, page, errors, click } = await fixture();
  try {
    expect(await page.evaluate(() => document.body.textContent?.includes("最新动态"))).toBe(false);
    expect(await page.evaluate(() => document.body.textContent?.includes("先选要做的事"))).toBe(false);
    expect(await page.evaluate(() => Boolean(document.querySelector("#photo-tools")!.compareDocumentPosition(document.querySelector("#file-conversion")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    const colors = await page.evaluate(() => ({ bg: getComputedStyle(document.querySelector("[data-home-theme]")!).backgroundImage, ink: getComputedStyle(document.querySelector("h1")!).color }));
    expect(colors.bg).toContain("246, 230, 216");
    expect(colors.ink).toBe("rgb(37, 35, 33)");
    expect(await page.$eval("[data-conversion-free-quota]", el => el.textContent)).toContain("3 个文件");
    expect(await page.evaluate(() => document.querySelector("#file-conversion")?.textContent?.includes("来源 IP"))).toBe(false);
    await page.evaluate(() => { (globalThis as any).fixtureData["fileConversion.quota"] = { remaining: 1 }; });
    await click("#file-conversion", "刷新记录");
    await page.waitForFunction(() => document.querySelector("[data-conversion-free-quota]")?.textContent?.includes("1 / 3"));
    await page.evaluate(() => { (globalThis as any).fixtureData["fileConversion.quota"] = undefined; });
    await click("#file-conversion", "刷新记录");
    await page.waitForFunction(() => document.querySelector("[data-conversion-free-quota]")?.textContent?.includes("正在查询"));
    expect(await page.$eval("[data-conversion-free-quota]", el => el.textContent)).not.toContain("今日剩余 3 / 3");
    await page.evaluate(() => { (globalThis as any).fixtureData["fileConversion.quota"] = { remaining: 3 }; });
    await click("#file-conversion", "刷新记录");
    await mkdir("/tmp/home-warm-1009", { recursive: true });
    await page.screenshot({ path: "/tmp/home-warm-1009/desktop-hero.png" });
    await page.$eval("#photo-tools", el => el.scrollIntoView());
    await page.screenshot({ path: "/tmp/home-warm-1009/desktop-tools.png" });
    await click("#file-conversion", "电子书");
    expect(await page.$eval('[aria-label="选择原文件"]', el => el.getAttribute("accept"))).toBe(".epub");
    await click("#file-conversion", "文档");
    await page.$eval('[aria-label="选择原文件"]', el => {
      const dt = new DataTransfer(); dt.items.add(new File(["%PDF"], "原件.pdf", { type: "application/pdf" }));
      (el as HTMLInputElement).files = dt.files; el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.$eval('input[name="conversion-lane"]:not(:checked)', el => (el as HTMLInputElement).click());
    await click("#file-conversion", "免费检查文件");
    await page.waitForFunction(() => document.body.textContent?.includes("确认内容与费用，开始转换"));
    expect(await page.evaluate(() => (globalThis as any).fixtureCalls.some((c: any) => c.name === "fileConversion.convert"))).toBe(false);
    await click("#file-conversion", "确认内容与费用，开始转换");
    await page.waitForFunction(() => document.body.textContent?.includes("下载转换文件"));
    const calls = await page.evaluate(() => (globalThis as any).fixtureCalls);
    expect(calls.find((c: any) => c.name === "fileConversion.inspect").input).toMatchObject({ formatId: "pdf-docx", lane: "paid", fileName: "原件.pdf" });
    expect(calls.find((c: any) => c.name === "fileConversion.convert").input).toEqual({ id: "inspection-1", confirmedCredits: 4 });
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "/tmp/home-warm-1009/mobile-hero.png" });
    console.log("首页接线：开始检查手机菜单");
    await page.click('[aria-label="打开菜单"]');
    await page.waitForSelector(".home-product-portal");
    console.log("首页接线：手机菜单已打开");
    expect(await page.$eval(".home-product-portal", el => getComputedStyle(el).getPropertyValue("--hp-ink").trim())).toBe("#252321");
    const target = await page.$eval('.home-product-portal a[href="/#photo-tools"]', el => el.getAttribute("href"));
    expect(target).toBe("/#photo-tools");
    await page.$eval('.home-product-portal a[href="/#photo-tools"]', el => (el as HTMLAnchorElement).click());
    console.log("首页接线：已点击工具锚点");
    await page.waitForFunction(() => !document.querySelector(".home-product-portal"));
    await page.$eval("#file-conversion", el => el.scrollIntoView());
    await page.screenshot({ path: "/tmp/home-warm-1009/mobile-conversion.png" });
    await click("#file-conversion", "下载转换文件");
    expect(await page.evaluate(() => (globalThis as any).fixtureCalls.find((c: any) => c.name === "fileConversion.download").input)).toEqual({ id: "conversion-1" });
    expect(await page.evaluate(() => (globalThis as any).fixtureCalls.find((c: any) => c.name === "download.anchor").input)).toMatchObject({ fileName: "原件.docx" });
    expect(errors).toEqual([]);
    console.log("首页接线：转换检查/确认/下载、手机菜单与主题检查通过");
  } finally { await page.close(); await browser.close(); }
}, 120_000);

it("渲染真实首页代码的桌面与手机预览，保留既有样片，不提交生产任务", async () => {
  const { browser, page, errors } = await fixture(true);
  const output = "/Users/tangenjie/Downloads/2026Oct09/首页暖色UI预览";
  try {
    await mkdir(output, { recursive: true });
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 1);
    await page.screenshot({ path: path.join(output, "桌面-首屏.png") });
    await page.$eval("#photo-tools", el => el.scrollIntoView());
    await page.screenshot({ path: path.join(output, "桌面-图片工具箱.png") });
    await page.$eval("#file-conversion", el => el.scrollIntoView());
    await page.screenshot({ path: path.join(output, "桌面-文件转换.png") });
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(output, "手机-首屏.png") });
    await page.$eval("#photo-tools", el => el.scrollIntoView());
    await page.screenshot({ path: path.join(output, "手机-图片工具箱.png") });
    await page.$eval("#file-conversion", el => el.scrollIntoView());
    await page.screenshot({ path: path.join(output, "手机-文件转换.png") });
    expect(errors).toEqual([]);
  } finally { await page.close(); await browser.close(); }
}, 60_000);

it("照片放大与修复结果能被动画消费，刷新只查询原任务，失败不覆盖原图", async () => {
  const { browser, page, errors, click } = await fixture();
  try {
    await page.waitForFunction(() => !document.body.textContent?.includes("正在确认视频工具身份"));
    const file = await page.$('#photo-tools input[accept="image/jpeg,image/png,image/webp"]');
    await file!.uploadFile(path.resolve("client/public/home-assets/mojing-episode-01-20261007-poster.jpg"));
    await page.waitForFunction(() => (globalThis as any).fixtureCalls.some((c: any) => c.name === "photo.upload"));
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#photo-tools-upscale button")?.disabled);
    await click("#photo-tools-upscale", "放大 2× · 15 积分");
    await page.waitForSelector('#photo-tools-upscale img[src="https://fixture.invalid/upscaled.jpg"]');
    expect(await page.$eval('[data-flow-source="upscale"]', el => el.getAttribute("data-ready"))).toBe("true");
    const callsBeforeReuse = await page.evaluate(() => (globalThis as any).fixtureCalls.length);
    await click("[data-photo-flow]", "用放大结果修复 →");
    expect(await page.$eval("#photo-tools-restore select", el => (el as HTMLSelectElement).value)).toBe("upscale");
    expect(await page.evaluate(() => (globalThis as any).fixtureCalls.length)).toBe(callsBeforeReuse);
    await click("#photo-tools-restore", "修复并上色 · 10 积分");
    await page.waitForSelector('#photo-tools-restore img[src="https://fixture.invalid/restored.jpg"]');
    expect(await page.$eval('[data-flow-source="restore"]', el => el.getAttribute("data-ready"))).toBe("true");
    await click("[data-photo-flow]", "用上色结果制作动画 →");
    expect(await page.$eval("#photo-tools-animate select", el => (el as HTMLSelectElement).value)).toBe("restore");
    expect(await page.evaluate(() => (globalThis as any).fixtureCalls.filter((c: any) => c.name === "homePhotoAnimate").length)).toBe(0);
    await page.type("#photo-tools-animate textarea", "人物轻轻挥手");
    await click("#photo-tools-animate", "10 秒79 积分");
    const submitButton = await page.$("#photo-tools-animate button.w-full");
    await submitButton!.click();
    await page.waitForFunction(() => (globalThis as any).fixtureCalls.some((c: any) => c.name === "homePhotoAnimate"));
    const calls = await page.evaluate(() => (globalThis as any).fixtureCalls);
    expect(calls.find((c: any) => c.name === "homePhotoUpscale").input).toMatchObject({ imageUrl: "https://fixture.invalid/source.jpg", upscaleFactor: "x2" });
    expect(calls.find((c: any) => c.name === "homePhotoTools.restoreOldPhoto").input.imageUrl).toBe("https://fixture.invalid/upscaled.jpg");
    expect(calls.find((c: any) => c.name === "homePhotoAnimate").input).toMatchObject({ imageUrl: "https://fixture.invalid/restored.jpg", prompt: "人物轻轻挥手", duration: 10, resolution: "720p" });
    const pending = await page.evaluate(() => localStorage.getItem("home-photo-animation:v1:1"));
    expect(JSON.parse(pending!).taskId).toBe("fixture-animation");
    // 卸载并重挂完整首页，保留同源localStorage，验证恢复用同一个requestKey。
    await page.evaluate(() => { const g = globalThis as any; g.fixtureAnimationState = "succeeded"; g.fixtureRoot.unmount(); g.mountHome(); });
    await page.waitForSelector('#photo-tools-animate video[src="https://fixture.invalid/animation.mp4"]');
    expect(await page.evaluate(() => (globalThis as any).fixtureCalls.filter((c: any) => c.name === "homePhotoAnimate").length)).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("home-photo-animation:v1:1"))).toBe(null);
    // 修复失败仍保留本次上传的原图与已有结果，释放按钮锁。
    const again = await page.$('#photo-tools input[accept="image/jpeg,image/png,image/webp"]');
    await again!.uploadFile(path.resolve("client/public/home-assets/mojing-episode-01-20261007-poster.jpg"));
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#photo-tools-restore button")?.disabled);
    await page.evaluate(() => { (globalThis as any).fixtureRestoreFail = true; });
    await click("#photo-tools-restore", "修复并上色 · 10 积分");
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#photo-tools-restore button")?.disabled);
    expect(await page.$eval('img[alt="已上传照片"]', el => el.getAttribute("src"))).toMatch(/^blob:/);
    expect(await page.$('#photo-tools-restore img[src="https://fixture.invalid/restored.jpg"]')).toBe(null);
    expect(errors).toEqual([]);
  } finally { await page.close(); await browser.close(); }
}, 120_000);
