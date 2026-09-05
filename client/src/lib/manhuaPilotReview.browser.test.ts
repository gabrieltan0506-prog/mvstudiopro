import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";

// 离线组件交互测试：仅驱动真实 React 组件/Hook，不访问生产、也不代表线上验收。
let browser: Browser;
let fixture: string;
beforeAll(async () => {
  const bundled = await build({
    stdin: {
      contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { ManhuaPilotReviewPanel } from './client/src/components/ManhuaPilotReviewPanel';
      import { useManhuaPilotReview } from './client/src/lib/useManhuaPilotReview';
      import { resolveManhuaEpisodeClipVideoModel } from './client/src/lib/canvasDramaStudio';
      const root = createRoot(document.getElementById('root'));
      const f = globalThis.fixture = { decisions: [], loads: [], posts: [], failures: [] };
      function Harness({input}) { f.hook = useManhuaPilotReview(input); return <div>{f.hook.review?.status || 'loading'}</div>; }
      f.renderHook = input => root.render(<Harness input={input}/>);
      f.renderEpisodeHook = (input,blocks,focusEpisode,uiModel,picked) => root.render(<Harness input={{...input,
        episodeIndex:focusEpisode,
        videoModel:resolveManhuaEpisodeClipVideoModel(blocks,focusEpisode,picked ? uiModel : undefined)}}/>);
      f.renderPanel = state => root.render(<ManhuaPilotReviewPanel key={state.taskId + ':' + state.outputUrl} state={state}
        onRefresh={() => f.refreshes = (f.refreshes || 0) + 1}
        onReview={(decision,taskId) => new Promise((resolve,reject) => f.decisions.push({decision,taskId,resolve,reject}))}/>);
    `,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: { "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "离线审批回执",
        setup(builder) {
          builder.onResolve({ filter: /manhuaPilotReviewClient$/ }, () => ({
            path: "test-review-client",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: `
        export async function fingerprintManhuaPilotProject(date,pack) { return pack.version.repeat(64); }
        export function loadManhuaPilotReview(scope) { return new Promise((resolve,reject) => globalThis.fixture.loads.push({scope,resolve,reject})); }
        export function submitManhuaPilotDecision(input) { return new Promise((resolve,reject) => globalThis.fixture.posts.push({input,resolve,reject})); }
      `,
          }));
        },
      },
    ],
  });
  fixture = bundled.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await browser?.close();
});

async function openFixture(): Promise<Page> {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => void request.abort());
  await page.setContent(
    '<!doctype html><html lang="zh-CN"><body><div id="root"></div></body></html>'
  );
  await page.addScriptTag({ content: fixture });
  return page;
}
const scopeInput = {
  userId: "test-user",
  confirmedAt: "2026-09-05",
  pack: { version: "a" },
  episodeIndex: 1,
  videoModel: "seedance-2.5",
};
const generated = {
  status: "generated",
  taskId: "test-task-a",
  outputUrl: "https://test.invalid/a.mp4",
};
describe("真实审批组件与异步上下文（离线浏览器）", () => {
  it("历史项目和切集后的状态请求与本集实际引擎一致", async () => {
    const page = await openFixture();
    try {
      const blocks = [
        {
          kind: "video",
          id: "clip-e01-g01-a",
          episodeIndex: 1,
          videoModel: "seedance-2.5",
        },
        {
          kind: "video",
          id: "clip-e02-g01-b",
          episodeIndex: 2,
          videoModel: "seedance-2.0-mini",
        },
      ];
      const render = (ep: number) =>
        `fixture.renderEpisodeHook(${JSON.stringify(scopeInput)},${JSON.stringify(blocks)},${ep},'seedance-2.0-mini',false)`;
      await page.evaluate(render(1));
      await page.waitForFunction("fixture.loads.length === 1");
      expect(await page.evaluate("fixture.loads[0].scope.videoModel")).toBe(
        "seedance-2.5"
      );
      await page.evaluate(
        `fixture.loads[0].resolve(${JSON.stringify(generated)})`
      );
      await page.waitForFunction(
        "fixture.hook.review?.taskId === 'test-task-a'"
      );
      await page.evaluate(render(2));
      await page.waitForFunction("fixture.loads.length === 2");
      expect(await page.evaluate("fixture.loads[1].scope.episodeIndex")).toBe(
        2
      );
      expect(await page.evaluate("fixture.loads[1].scope.videoModel")).toBe(
        "seedance-2.0-mini"
      );
      expect(await page.evaluate("fixture.hook.review")).toBeNull();
      await page.evaluate("fixture.loads[1].resolve({status:'not_started'})");
      await page.waitForFunction(
        "fixture.hook.review?.status === 'not_started'"
      );
    } finally {
      await page.close();
    }
  });
  it("审批只绑定正在播放的任务；加载失败不能批准，但可以退回", async () => {
    const page = await openFixture();
    try {
      await page.evaluate(`fixture.renderPanel(${JSON.stringify(generated)})`);
      await page.waitForSelector("video");
      expect(await page.$eval("video", v => v.getAttribute("src"))).toBe(
        generated.outputUrl
      );
      expect(
        await page.$eval(
          '[data-pilot-action="approve"]',
          b => (b as HTMLButtonElement).disabled
        )
      ).toBe(true);
      await page.$eval("video", v => v.dispatchEvent(new Event("loadeddata")));
      await page.waitForFunction(
        `!document.querySelector('[data-pilot-action="approve"]').disabled`
      );
      await page.click('[data-pilot-action="approve"]');
      await page.waitForFunction("fixture.decisions.length === 1");
      expect(
        await page.evaluate(
          "fixture.decisions.map(({decision,taskId})=>({decision,taskId}))"
        )
      ).toEqual([{ decision: "approve", taskId: "test-task-a" }]);
      await page.evaluate(
        "fixture.decisions[0].reject(new Error('test response lost'))"
      );
      await page.waitForSelector('[role="alert"]');
      expect(
        await page.$eval('[role="alert"]', node => node.textContent)
      ).toContain("不会自动重新出片");
      expect(
        await page.$eval(
          '[data-pilot-action="approve"]',
          b => (b as HTMLButtonElement).disabled
        )
      ).toBe(true);
      await page.evaluate(
        `fixture.renderPanel(${JSON.stringify({ ...generated, taskId: "test-task-b", outputUrl: "https://test.invalid/b.mp4" })})`
      );
      await page.waitForFunction(
        "document.querySelector('video').src.endsWith('/b.mp4')"
      );
      await page.$eval("video", v => v.dispatchEvent(new Event("error")));
      expect(
        await page.$eval(
          '[data-pilot-action="approve"]',
          b => (b as HTMLButtonElement).disabled
        )
      ).toBe(true);
      await page.click('[data-pilot-action="reject"]');
      await page.waitForFunction("fixture.decisions.length === 2");
      expect(await page.evaluate("fixture.decisions[1].taskId")).toBe(
        "test-task-b"
      );
      expect(await page.evaluate("fixture.decisions[1].decision")).toBe(
        "reject"
      );
    } finally {
      await page.close();
    }
  });

  it("切换项目后旧审批回包不污染新项目，也不错误提示新项目已批准", async () => {
    const page = await openFixture();
    try {
      await page.evaluate(`fixture.renderHook(${JSON.stringify(scopeInput)})`);
      await page.waitForFunction("fixture.loads.length === 1");
      await page.evaluate(
        `fixture.loads[0].resolve(${JSON.stringify(generated)})`
      );
      await page.waitForFunction("fixture.hook.review?.status === 'generated'");
      await page.evaluate(
        "void fixture.hook.decide('approve','test-task-a').catch(e=>fixture.failures.push(e.message))"
      );
      await page.waitForFunction("fixture.posts.length === 1");
      await page.evaluate(
        `fixture.renderHook(${JSON.stringify({ ...scopeInput, pack: { version: "b" } })})`
      );
      await page.waitForFunction("fixture.loads.length === 2");
      await page.evaluate(
        `fixture.posts[0].resolve(${JSON.stringify({ ...generated, status: "approved" })}); fixture.loads[1].resolve({status:'not_started'})`
      );
      await page.waitForFunction(
        "fixture.failures.length === 1 && fixture.hook.review?.status === 'not_started'"
      );
      expect(await page.evaluate("fixture.hook.key")).toContain("b".repeat(64));
      expect(await page.evaluate("fixture.failures[0]")).toContain(
        "当前项目已切换"
      );
    } finally {
      await page.close();
    }
  });

  it("审核保存回包丢失保持锁定，刷新只恢复原记录，不重发审批或生成", async () => {
    const page = await openFixture();
    try {
      await page.evaluate(`fixture.renderHook(${JSON.stringify(scopeInput)})`);
      await page.waitForFunction("fixture.loads.length === 1");
      await page.evaluate(
        `fixture.loads[0].resolve(${JSON.stringify(generated)})`
      );
      await page.waitForFunction("fixture.hook.review?.status === 'generated'");
      await page.evaluate(
        "void fixture.hook.decide('approve','test-task-a').catch(e=>fixture.failures.push(e.message))"
      );
      await page.waitForFunction("fixture.posts.length === 1");
      await page.evaluate(
        "fixture.posts[0].reject(new Error('test lost response'))"
      );
      await page.waitForFunction(
        "fixture.hook.error && fixture.hook.review === null"
      );
      await page.evaluate("fixture.hook.refresh()");
      await page.waitForFunction("fixture.loads.length === 2");
      await page.evaluate(
        `fixture.loads[1].resolve(${JSON.stringify({ ...generated, status: "approved" })})`
      );
      await page.waitForFunction("fixture.hook.review?.status === 'approved'");
      expect(await page.evaluate("fixture.posts.length")).toBe(1);
      expect(await page.evaluate("fixture.hook.review.taskId")).toBe(
        "test-task-a"
      );
    } finally {
      await page.close();
    }
  });
});
