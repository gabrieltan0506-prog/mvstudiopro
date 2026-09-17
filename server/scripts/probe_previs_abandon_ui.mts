/**
 * 「原编号不存在，放弃它」的**组件级**探针（真 React + 真 DOM，esbuild 打包 + Puppeteer 跑）。
 *
 * 为什么不用纯函数单测：这条出口的错法全在**调用顺序**上——重挂载时先开放权限再去查、
 * 放弃时不复查就清 pending、复查抛错却把任务丢掉。只用假 store 测纯函数覆盖不到这些。
 *
 * 运行：npx tsx server/scripts/probe_previs_abandon_ui.mts
 */
import { build } from "esbuild";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";

const ROOT = process.cwd();
const ELEVEN_MIN = 11 * 60_000;

const ENTRY = `
import React from "react";
import { createRoot } from "react-dom/client";
import { ManhuaPrevisStudioView } from "@/components/canvas/ManhuaPrevisStudio";
import { createManhuaPrevisStudio } from "@shared/manhuaPrevis";

const REQ = "req-under-test";
const studio = { ...createManhuaPrevisStudio(2), scopeId: "scope-1" };
studio.pending = { requestId: REQ, scopeId: "scope-1", clipId: "clip-1", spec: studio.spec };

const state = { studio, published: [] };
function App() {
  const [, force] = React.useState(0);
  window.__rerender = () => force(n => n + 1);
  const block = { id: "clip-1", previsStudio: state.studio };
  return React.createElement(ManhuaPrevisStudioView, {
    block,
    characters: [{ id: "c1", label: "阿菁" }],
    services: {
      submit: async () => { throw new Error("not used"); },
      list: async () => ({ items: [], nextCursor: null }),
      get: (id) => window.__get(id),
    },
    onChange: (next) => {
      state.studio = next;
      state.published.push(next.pending ? next.pending.requestId : null);
      window.__rerender && window.__rerender();
      return true;
    },
  });
}
window.__state = state;
createRoot(document.getElementById("root")).render(React.createElement(App));
`;

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "previs-abandon-ui-"));
  const entry = path.join(dir, "entry.tsx");
  await fs.writeFile(entry, ENTRY);
  await build({
    entryPoints: [entry],
    bundle: true,
    outfile: path.join(dir, "bundle.js"),
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".ts": "ts", ".tsx": "tsx" },
    alias: { "@": path.join(ROOT, "client/src"), "@shared": path.join(ROOT, "shared") },
    // entry 落在临时目录，解析 react 之类要显式指到仓库的 node_modules
    absWorkingDir: ROOT,
    nodePaths: [path.join(ROOT, "node_modules")],
    logLevel: "silent",
  });
  const bundle = await fs.readFile(path.join(dir, "bundle.js"), "utf8");
  await fs.writeFile(
    path.join(dir, "index.html"),
    `<!doctype html><meta charset="utf-8"><div id="root"></div><script>${bundle}</script>`,
  );

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures.push(label + (detail === undefined ? "" : " → " + JSON.stringify(detail)));
    console.log((ok ? "OK   " : "FAIL ") + label + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  };

  // file:// 下 Chrome 直接禁掉 sessionStorage（SecurityError），时间戳种不进去 —— 必须走 http
  const html = await fs.readFile(path.join(dir, "index.html"), "utf8");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const pageUrl = `http://127.0.0.1:${port}/`;

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

  type Scenario = {
    label: string;
    get: string; // 浏览器里的 window.__get 实现
    /** 点击「放弃」之前把 window.__mode 切成这个值：模拟「等待期间一直查不到，点下去那一刻任务其实在」 */
    modeBeforeClick?: "running" | "throw";
    storageAgeMs?: number | null;
    breakStorage?: boolean;
    expect: (r: { abandonVisible: boolean; pendingAfterClick: string | null; clicked: boolean; mounted: boolean }) => boolean;
    detail?: string;
  };

  const scenarios: Scenario[] = [
    {
      label: "旧计时已超十分钟但本次查询悬而未决：按钮不出现（不凭旧缓存开放放弃）",
      get: "() => new Promise(() => {})",
      storageAgeMs: ELEVEN_MIN,
      expect: (r) => r.abandonVisible === false && r.mounted,
    },
    {
      label: "本次查询明确回 null 且计时已满：按钮出现，点了真的放弃",
      get: "async () => null",
      storageAgeMs: ELEVEN_MIN,
      expect: (r) => r.abandonVisible && r.clicked && r.pendingAfterClick === null,
    },
    {
      label: "点击时复查发现任务其实在跑：保留编号，不清 pending",
      get: "async () => { if (window.__mode === 'running') return { jobId: 'prv_x', status: 'running', output: null, params: { requestId: 'req-under-test', scopeId: 'scope-1', clipId: 'clip-1', spec: window.__state.studio.spec } }; return null; }",
      modeBeforeClick: "running",
      storageAgeMs: ELEVEN_MIN,
      expect: (r) => r.abandonVisible && r.clicked && r.pendingAfterClick === "req-under-test",
    },
    {
      label: "点击时复查抛错：保留编号，不清 pending",
      get: "async () => { if (window.__mode === 'throw') throw new Error('network down'); return null; }",
      modeBeforeClick: "throw",
      storageAgeMs: ELEVEN_MIN,
      expect: (r) => r.abandonVisible && r.clicked && r.pendingAfterClick === "req-under-test",
    },
    {
      label: "sessionStorage 取值即抛（隐私模式）：组件照常挂载，不崩",
      get: "async () => null",
      breakStorage: true,
      expect: (r) => r.mounted,
    },
  ];

  for (const s of scenarios) {
    // 每个场景一张新页：evaluateOnNewDocument 会累积，复用同一张页会把上一场景的注入带过来
    const page = await browser.newPage();
    page.on("pageerror", (e: unknown) => failures.push(`页面异常（${s.label}）：` + String(e)));
    await page.evaluateOnNewDocument(
      (getSrc: string, ageMs: number | null | undefined, breakStorage: boolean) => {
        if (breakStorage) {
          Object.defineProperty(window, "sessionStorage", {
            get() {
              throw new Error("SecurityError");
            },
          });
        } else if (typeof ageMs === "number") {
          // about:blank 之类的文档里 sessionStorage 也会被禁，探针自己不能因此抛
          try {
            window.sessionStorage.setItem(
              "manhua-previs-missing-since:req-under-test",
              String(Date.now() - ageMs),
            );
          } catch {
            /* 下面的断言会因为按钮不出现而失败，不需要在这里报错 */
          }
        }
        // eslint-disable-next-line no-eval
        (window as unknown as { __get: unknown }).__get = eval(getSrc);
      },
      s.get,
      s.storageAgeMs ?? null,
      Boolean(s.breakStorage),
    );
    await page.goto(pageUrl);
    await page.waitForSelector("#root *", { timeout: 10_000 }).catch(() => {});
    // 轮询间隔 4 秒，等两轮足够拿到第一次 get 结果
    await new Promise((r) => setTimeout(r, 5_000));
    const result = await page.evaluate(async (mode: string | null) => {
      if (mode) (window as unknown as { __mode: string }).__mode = mode;
      const btn = document.querySelector("[data-previs-abandon-pending]") as HTMLButtonElement | null;
      const mounted = Boolean(document.querySelector("#root *"));
      let clicked = false;
      if (btn) {
        btn.click();
        clicked = true;
        await new Promise((r) => setTimeout(r, 1_000));
      }
      const st = (window as unknown as { __state: { studio: { pending?: { requestId: string } } } }).__state;
      return {
        abandonVisible: Boolean(btn),
        clicked,
        mounted,
        pendingAfterClick: st?.studio?.pending?.requestId ?? null,
      };
    }, s.modeBeforeClick ?? null);
    check(s.label, s.expect(result), result);
    await page.close();
  }

  await browser.close();
  server.close();
  if (failures.length) {
    console.error("PROBE_FAILED", failures);
    process.exit(1);
  }
  console.log("PROBE_OK");
}

void main().catch((error) => {
  console.error("PROBE_FAILED", error);
  process.exit(1);
});
