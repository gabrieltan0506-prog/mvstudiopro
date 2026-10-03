import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import puppeteer, { type Browser, type Page } from "puppeteer";
let browser: Browser;
let server: Server;
let origin: string;
let bundle: string;
const stops: string[] = [];
beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { KnowledgeCardPageTasks } from './client/src/lib/knowledgeCardPageTask';
    const tasks = new KnowledgeCardPageTasks('1');
    window.tasks = tasks; window.errors = []; window.left = 0;
    window.detach = tasks.attach(() => window.left++, message => window.errors.push(message));
  ` }, bundle: true, write: false, format: "iife", platform: "browser" });
  bundle = result.outputFiles[0]!.text;
  server = createServer((req, res) => {
    const url = new URL(req.url || "/", 'http://local');
    if (url.pathname.includes('/cancel')) {
      stops.push(url.pathname.split('/')[5]!);
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({ status: 'failed', cancelled: true }));
    } else if (url.pathname === '/app.js') { res.setHeader('Content-Type','application/javascript'); res.end(bundle); }
    else { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><title>Knowledge card lifecycle</title><script src="/app.js"></script>'); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('no test server');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); await new Promise<void>(r => server.close(() => r())); });
const begin = (page: Page, action = 'knowledge_card_distill') => page.evaluate(a => (window as any).tasks.begin(a), action);
async function newPage() { const p = await browser.newPage(); await p.goto(origin); return p; }

describe('知识卡刷新终止（真实浏览器导航，无生产调用）', () => {
  it('刷新会送停止请求，新页面确认回执后清掉待停止记录', async () => {
    const p = await newPage(); const id = await begin(p);
    await p.reload({ waitUntil: 'networkidle0' });
    expect(stops).toContain(id);
    expect(await p.evaluate(() => sessionStorage.getItem('mvs-knowledge-card-page-requests.v1:1'))).toBe('[]');
    await p.close();
  });
  it('卸载请求丢失，刷新后的页面仍补发；提交尚无后台编号也能停', async () => {
    const p = await newPage(); const id = await begin(p, 'knowledge_card_derive_level');
    // Simulate the browser dropping teardown events, with enqueue still awaiting its response.
    await p.evaluate(() => (window as any).detach());
    expect(stops).not.toContain(id);
    await p.reload({ waitUntil: 'networkidle0' });
    expect(stops).toContain(id);
    expect(await p.evaluate(() => (window as any).errors)).toEqual([]);
    await p.close();
  });
  it('隐藏标签和组件 effect 重挂不取消；已完成任务刷新不再取消', async () => {
    const p = await newPage(); const id = await begin(p);
    await p.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      (window as any).detach();
      (window as any).detach = (window as any).tasks.attach(() => {}, () => {});
    });
    expect(stops).not.toContain(id);
    await p.evaluate(id => (window as any).tasks.finish(id), id);
    await p.reload({ waitUntil: 'networkidle0' });
    expect(stops).not.toContain(id);
    await p.close();
  });
  it('刷新一个标签不会终止另一个标签的任务', async () => {
    const a = await newPage(), b = await newPage();
    const aid = await begin(a), bid = await begin(b);
    await a.reload({ waitUntil: 'networkidle0' });
    expect(stops).toContain(aid); expect(stops).not.toContain(bid);
    await b.evaluate(id => (window as any).tasks.finish(id), bid);
    await a.close(); await b.close();
  });
  it('停止回执失败保留记录并显示错误，网络恢复后可重新确认', async () => {
    const p = await newPage(); const id = await begin(p);
    await p.evaluate(() => (window as any).detach());
    await p.setRequestInterception(true);
    const fail = (q: import('puppeteer').HTTPRequest) => q.url().includes('/cancel') ? q.respond({ status: 503, body: '{}' }) : q.continue();
    p.on('request', fail);
    await p.reload({ waitUntil: 'networkidle0' });
    expect(await p.evaluate(() => (window as any).errors.length)).toBe(1);
    expect(await p.evaluate(() => sessionStorage.getItem('mvs-knowledge-card-page-requests.v1:1'))).toContain(id);
    p.off('request', fail); await p.setRequestInterception(false);
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await p.waitForFunction(() => sessionStorage.getItem('mvs-knowledge-card-page-requests.v1:1') === '[]');
    expect(stops).toContain(id);
    await p.close();
  });
});
