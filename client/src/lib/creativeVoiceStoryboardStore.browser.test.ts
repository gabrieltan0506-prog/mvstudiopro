import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser, bundle: string, serial = 0;
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: 'import * as api from "./client/src/lib/creativeVoiceStoryboardStore"; window.storyboards=api;', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife", platform: "browser" })).outputFiles[0].text;
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
});
afterAll(async () => { await browser?.close(); });
async function pageForTest(): Promise<Page> {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => void request.respond({ status: 200, contentType: "text/html", body: "<html></html>" }));
  await page.goto(`https://storyboard-${++serial}.test`);
  await page.addScriptTag({ content: bundle });
  return page;
}

it("本地存储满时完整大候选仍可事务保存，刷新恢复且旧记录不删除", async () => {
  const page = await pageForTest();
  try {
    const result = await page.evaluate(async () => {
      const api = (window as any).storyboards, key = "mvs:voice-storyboard:v1:1:project-a";
      const candidate = { id: "full", scope: "1:project-a", episode: 2, status: "ready", resultState: "returned", source: "原稿", text: "完整末尾", blocks: [{ id: "preserved-video", outputUrl: "/existing.mp4", full: "x".repeat(6 * 1024 * 1024) }], edges: [] };
      let quotaReached = false;
      for (let index = 0; index < 64; index++) { try { localStorage.setItem(`existing:${index}`, "x".repeat(200_000)); } catch { quotaReached = true; break; } }
      let oldSaveFailed = false;
      try { localStorage.setItem(key, JSON.stringify(candidate)); } catch { oldSaveFailed = true; }
      const oldCount = localStorage.length;
      await api.saveVoiceStoryboardDurable(localStorage, key, candidate, { expectedRaw: null });
      const raw = await api.readVoiceStoryboardRaw(localStorage, key);
      return { quotaReached, oldSaveFailed, exact: raw === JSON.stringify(candidate), legacyCount: localStorage.length === oldCount, legacyCandidate: localStorage.getItem(key) };
    });
    expect(result).toEqual({ quotaReached: true, oldSaveFailed: true, exact: true, legacyCount: true, legacyCandidate: null });
    await page.reload(); await page.addScriptTag({ content: bundle });
    expect(await page.evaluate(async () => {
      const raw = await (window as any).storyboards.readVoiceStoryboardRaw(localStorage, "mvs:voice-storyboard:v1:1:project-a");
      const candidate = JSON.parse(raw);
      return { end: candidate.text, bytes: candidate.blocks[0].full.length, video: candidate.blocks[0].outputUrl };
    })).toEqual({ end: "完整末尾", bytes: 6 * 1024 * 1024, video: "/existing.mp4" });
  } finally { await page.close(); }
}, 30000);

it("旧未知请求阻断覆盖，已知结果原子归档，旧页面新写请求仍阻断", async () => {
  const page = await pageForTest();
  try {
    expect(await page.evaluate(async () => {
      const api = (window as any).storyboards, key = "mvs:voice-storyboard:v1:1:project-a";
      const pending = { id: "original", scope: "1:project-a", episode: 2, status: "pending", resultState: "unknown", source: "source" };
      const original = JSON.stringify(pending); localStorage.setItem(key, original);
      const result: Record<string, boolean> = {};
      result.oldRead = await api.readVoiceStoryboardRaw(localStorage, key) === original;
      try { await api.saveVoiceStoryboardDurable(localStorage, key, { ...pending, id: "replacement" }); } catch { result.overwriteBlocked = true; }
      try { await api.archiveVoiceStoryboardDurable(localStorage, key, pending); } catch { result.unknownBlocked = true; }
      const returned = { ...pending, status: "ready", resultState: "returned", text: "原付费结果末尾" };
      await api.saveVoiceStoryboardDurable(localStorage, key, returned, { expectedRaw: original });
      let olderStatusBlocked = false;
      try { await api.saveVoiceStoryboardDurable(localStorage, key, { ...pending }); } catch { olderStatusBlocked = true; }
      result.olderStatusBlocked = olderStatusBlocked;
      await api.archiveVoiceStoryboardDurable(localStorage, key, returned);
      result.archived = await api.readVoiceStoryboardRaw(localStorage, key) === null;
      result.legacyPreserved = localStorage.getItem(key) === original;
      await api.saveVoiceStoryboardDurable(localStorage, key, { ...returned, id: "new-import" }, { expectedRaw: null });
      localStorage.setItem(key, JSON.stringify({ ...pending, id: "old-page-new-request" }));
      try { await api.readVoiceStoryboardRaw(localStorage, key); } catch { result.oldPageConflict = true; }
      return result;
    })).toEqual({ oldRead: true, overwriteBlocked: true, unknownBlocked: true, olderStatusBlocked: true, archived: true, legacyPreserved: true, oldPageConflict: true });
  } finally { await page.close(); }
});

it("跨窗口竞争仅一个新请求落盘，旧历史不可改写，事务写失败保留原请求", async () => {
  const page = await pageForTest();
  try {
    expect(await page.evaluate(async () => {
      const api = (window as any).storyboards, key = "mvs:voice-storyboard:v1:1:project-a";
      const base = { scope: "1:project-a", episode: 2, status: "pending", resultState: "unknown", source: "source" };
      const receipts = await Promise.allSettled([api.saveVoiceStoryboardDurable(localStorage, key, { ...base, id: "one" }, { expectedRaw: null }), api.saveVoiceStoryboardDurable(localStorage, key, { ...base, id: "two" }, { expectedRaw: null })]);
      const raw = await api.readVoiceStoryboardRaw(localStorage, key), original = JSON.parse(raw);
      const history = `${key}:history:original:check`;
      await api.saveVoiceStoryboardDurable(localStorage, history, original);
      let historyBlocked = false;
      try { await api.saveVoiceStoryboardDurable(localStorage, history, { ...original, text: "changed" }); } catch { historyBlocked = true; }
      const put = IDBObjectStore.prototype.put;
      let failed = false;
      try { IDBObjectStore.prototype.put = function () { throw new Error("虚构写入失败"); }; await api.saveVoiceStoryboardDurable(localStorage, key, { ...original, status: "ready", text: "new" }); }
      catch { failed = true; } finally { IDBObjectStore.prototype.put = put; }
      return { winners: receipts.filter(receipt => receipt.status === "fulfilled").length, historyBlocked, failed, retained: await api.readVoiceStoryboardRaw(localStorage, key) === raw };
    })).toEqual({ winners: 1, historyBlocked: true, failed: true, retained: true });
  } finally { await page.close(); }
});

it("作品命名空间隔离，错误账号/作用域拒绝，读取失败不当作空请求", async () => {
  const page = await pageForTest();
  try {
    const one = "11111111-1111-4111-8111-111111111111", two = "22222222-2222-4222-8222-222222222222";
    await page.goto(`https://storyboard-${serial}.test/canvas?owner=1&project=${one}`); await page.addScriptTag({ content: bundle });
    expect(await page.evaluate(async project => {
      const api = (window as any).storyboards, key = `mvs:voice-storyboard:v1:1:${project}`, candidate = { id: "scoped", scope: `1:${project}`, episode: 2, status: "ready", resultState: "returned", source: "source", text: "saved" };
      await api.saveVoiceStoryboardDurable(localStorage, key, candidate, { expectedRaw: null });
      let accountBlocked = false, scopeBlocked = false;
      try { await api.readVoiceStoryboardRaw(localStorage, `mvs:voice-storyboard:v1:2:${project}`); } catch { accountBlocked = true; }
      try { await api.saveVoiceStoryboardDurable(localStorage, key, { ...candidate, scope: "1:other" }); } catch { scopeBlocked = true; }
      return { accountBlocked, scopeBlocked };
    }, one)).toEqual({ accountBlocked: true, scopeBlocked: true });
    await page.goto(`https://storyboard-${serial}.test/canvas?owner=1&project=${two}`); await page.addScriptTag({ content: bundle });
    expect(await page.evaluate(async project => await (window as any).storyboards.readVoiceStoryboardRaw(localStorage, `mvs:voice-storyboard:v1:1:${project}`), two)).toBeNull();
    await page.goto(`https://storyboard-${serial}.test/canvas?owner=1&project=${one}`); await page.addScriptTag({ content: bundle });
    expect(await page.evaluate(async project => {
      const api = (window as any).storyboards, key = `mvs:voice-storyboard:v1:1:${project}`;
      const open = IDBFactory.prototype.open; let failed = false;
      try { IDBFactory.prototype.open = function () { throw new Error("虚构读取失败"); }; await api.readVoiceStoryboardRaw(localStorage, key); }
      catch { failed = true; } finally { IDBFactory.prototype.open = open; }
      return { failed, text: JSON.parse(await api.readVoiceStoryboardRaw(localStorage, key)).text };
    }, one)).toEqual({ failed: true, text: "saved" });
  } finally { await page.close(); }
});
