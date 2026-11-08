/** 仅恢复已保存整册排版请求；不创建图片、正文或一致性任务。 */
import fs from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import puppeteer from 'puppeteer';
import { eq } from 'drizzle-orm';
import { appRouter } from '../server/routers';
import { createContext } from '../server/_core/context';
import { sdk } from '../server/_core/sdk';
import { registerManhuaAdvisorStream } from '../server/routers/manhuaAdvisorStream';
import { getDb } from '../server/db';
import { users } from '../drizzle/schema';
import { getJobByIdStrict } from '../server/jobs/repository';
import { assertWorkerProbeLease } from '../server/services/workerProbeLease';
import { COOKIE_NAME } from '../shared/const';
import { knowledgeConversationInput, buildKnowledgeConversationRequest } from '../server/services/knowledgeConversationAdvisor';
import { listGcsObjectNamesByPrefix } from '../server/services/gcs';
import { loadKnowledgeBookLayoutInput } from '../server/services/knowledgeBookLayout';

if (process.env.FLY_PROCESS_GROUP !== 'rig') throw Error('只能在本次授权工作机执行');
await assertWorkerProbeLease();
const root = process.argv[2], mode = process.argv[3] || 'prepare';
if (!root || !['prepare', 'run'].includes(mode)) throw Error('必须指定独立目录和prepare或run');
const previousRoot = '/data/handbook-remaining7-1107';
const previous = JSON.parse(await fs.readFile(path.join(previousRoot, 'continuation.json'), 'utf8'));
const original = await getJobByIdStrict(previous.sourceJobId);
if (!original || original.status !== 'succeeded') throw Error('原始稿件任务尚未成功');
const db = await getDb();
if (!db) throw Error('数据库不可用');
const [user] = await db.select().from(users).where(eq(users.id, Number(original.userId))).limit(1);
if (!user) throw Error('原稿所有者不存在');
const caller = appRouter.createCaller({ req: { headers: {} }, res: {}, user,
  clientDisconnected: new AbortController().signal } as any);
const loaded = await caller.editableLayout.get();
const doc = loaded.library?.documents.find(d => d.id === previous.documentId);
const pub = doc?.publication;
if (!doc || !pub?.review || pub.source.verificationJobId !== previous.sourceJobId ||
    doc.pages.length !== 36 || pub.review.pages.length !== 36 ||
    doc.pages.filter(p => p.imageUrl).length !== 23 ||
    pub.source.pages.filter(p => p.imageJobId).length !== 23) {
  throw Error('原36内容单元、23图或已完成审校不符，禁止重新生成');
}
if (pub.completedBatches !== 28 || Object.keys(pub.chapterReviews || {}).length !== 36) {
  throw Error('原正文与一致性未全部保存，不能由此入口重做');
}
const layoutId = pub.automaticLayout?.requestId;
const turn = pub.conversation?.find(t => t.request.id === layoutId);
if (!layoutId || !turn || turn.request.action !== 'layout' ||
    turn.request.manuscript !== pub.manuscript || !turn.request.layoutSourceDigest) {
  throw Error('原整册排版请求未保存，不创建新请求编号');
}
if (pub.layoutConversationId && pub.layoutConversationId !== layoutId) {
  throw Error('原稿已采用其他排版版本，禁止覆盖');
}
for (const page of pub.source.pages.filter(p => p.imageJobId)) {
  const jobId = pub.imageReplacements?.[page.imageJobId!] || page.imageJobId!;
  const job = await getJobByIdStrict(jobId);
  if (!job || String(job.userId) !== String(user.id) || job.status !== 'succeeded' ||
      !(job.output as any)?.compositeImageUrl) throw Error('原配图未成功，禁止重购');
}
const quote = await caller.editableLayout.publicationQuote({ documentId: doc.id, purpose: 'conversation' });
if (quote.maxCredits !== 0) throw Error('顾问额外报价不为零，未启动');
const book = await loadKnowledgeBookLayoutInput(user.id, doc.id);
const context = { documentId: doc.id, purpose: 'conversation' as const, attempt: 0,
  batchIndex: pub.conversation!.findIndex(t => t.request.id === layoutId) };
const canonicalInput = knowledgeConversationInput(doc, context, book);
const modelRequest = buildKnowledgeConversationRequest(doc, context, [], book);
const modelText = modelRequest.contents[0].parts.find((part: any) => typeof part.text === 'string') as { text: string };
if (!modelText) throw Error('正式排版请求没有正文');
const canonicalInputBytes = Buffer.byteLength(JSON.stringify(canonicalInput), 'utf8');
const modelInputBytes = Buffer.byteLength(modelText.text, 'utf8');
const bookInputBytes = Buffer.byteLength(JSON.stringify(book), 'utf8');
if (canonicalInputBytes !== 978261 || bookInputBytes !== 341682) throw Error('完整原输入容量与已核原回执不符，未进入模型');
if (book.sourceDigest !== turn.request.layoutSourceDigest || modelInputBytes > 750000) throw Error('正式排版输入身份或容量仍不符');
const conversationPrefix = 'knowledge-publications/user-' + user.id + '/' + doc.id + '/conversation/' + layoutId;
const conversationObjects = await listGcsObjectNamesByPrefix({ prefix: conversationPrefix, allPages: true });
const stableImage = (url: string) => url.split('?')[0];
const frozen = {
  documentId: doc.id, sourceJobId: previous.sourceJobId, publicationRequestId: pub.requestId,
  layoutRequestId: layoutId, source: { ...pub.source, pages: pub.source.pages.map(p => ({ ...p, imageUrl: stableImage(p.imageUrl) })) }, review: pub.review, manuscript: pub.manuscript,
  imageReplacements: pub.imageReplacements,
  pages: doc.pages.map(p => ({ id: p.id, headline: p.headline, body: p.body, imageUrl: stableImage(p.imageUrl) })),
};
const frozenDigest = createHash('sha256').update(JSON.stringify(frozen)).digest('hex');
await fs.mkdir(root, { recursive: true });
const manifestFile = path.join(root, 'resume-manifest.json');
if (existsSync(manifestFile)) {
  const old = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  if (old.frozenDigest !== frozenDigest || old.layoutRequestId !== layoutId) throw Error('准备后稿件版本变化，禁止恢复旧请求');
}
const manifest = {
  at: new Date().toISOString(), documentId: doc.id, sourceJobId: previous.sourceJobId,
  publicationRequestId: pub.requestId, layoutRequestId: layoutId, frozenDigest,
  contentUnits: 36, imageCount: 23, completedBatches: 28, modelsStarted: false,
  canonicalInputBytes, bookInputBytes, modelInputBytes, layoutSourceDigestMatches: true, bindingValidatedByProductionBuilder: true,
  conversationObjects: conversationObjects.map(name => name.slice(conversationPrefix.length)),
  adoptedLayout: pub.layoutConversationId || null, originalImageJobIds: previous.imageJobIds,
};
await fs.writeFile(manifestFile, JSON.stringify(manifest));
if (mode === 'prepare') {
  console.log(JSON.stringify({ status: 'prepared', ...manifest }));
  process.exit(0);
}
const startedFile = path.join(root, 'started.json');
if (existsSync(startedFile)) throw Error('此接续已启动，只查询原运行，不重复启动');
await fs.writeFile(startedFile, JSON.stringify({ at: new Date().toISOString(), frozenDigest, layoutId }));
const status = async (stage: string, extra: any = {}) => fs.writeFile(path.join(root, 'live.json'), JSON.stringify({
  at: new Date().toISOString(), stage, documentId: doc.id, layoutRequestId: layoutId, done: 23, total: 23, ...extra,
}));
const safe = (message: unknown) => String(message || '').replace(/(?:https?|gs):\/\/[^\s]+/g, '[地址]');
const app = express();
app.use(express.json({ limit: '30mb' }));
app.use('/api/trpc', createExpressMiddleware({ router: appRouter, createContext }));
registerManhuaAdvisorStream(app);
app.get('/api/jobs/:id', async (req, res) => {
  const context = await createContext({ req, res, info: undefined as never });
  const job = await getJobByIdStrict(req.params.id);
  if (!context.user || !job || String(job.userId) !== String(context.user.id)) { res.sendStatus(404); return; }
  res.json(job);
});
app.get('/bootstrap', async (req, res) => {
  const context = await createContext({ req, res, info: undefined as never });
  if (context.user?.id !== user.id) { res.sendStatus(401); return; }
  res.json({ documentId: doc.id });
});
app.get('/panel.js', (_req, res) => res.sendFile(path.join(root, 'panel.js')));
app.get('/', (_req, res) => res.type('html').send('<html><body><div id="root"></div><script src="/panel.js"></script></body></html>'));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + (server.address() as any).port;
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookie({ name: COOKIE_NAME, value: await sdk.createSessionToken(user.openId, { expiresInMs: 4 * 3600000 }),
    url: base, httpOnly: true });
  let exportResult: any;
  let exportCaptureError = '';
  let exportCapture: Promise<void> = Promise.resolve();
  page.on('response', response => {
    if (response.url().includes('editableLayout.exportPublication')) {
      exportCapture = exportCapture.then(async () => {
        const raw = await response.text();
        await fs.writeFile(path.join(root, 'export-response.json'), raw);
        const parsed = JSON.parse(raw), data = Array.isArray(parsed) ? parsed[0] : parsed;
        exportResult = data?.result?.data?.json || data?.result?.data;
        if (data?.error) throw Error('正式PDF出口返回错误，原响应已保存');
      }).catch(async error => { exportCaptureError = safe(error.message); await status('export_failed', { error: exportCaptureError }); });
    }
  });
  page.on('pageerror', error => { void fs.appendFile(path.join(root, 'ui-errors.log'), safe(error) + '\n'); });
  page.on('dialog', dialog => { void dialog.accept(); });
  await status('restoring_original_layout');
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  // 已采用方案时只点击原组件导出按钮；绝不重调顾问或自己生成PDF。
  if (pub.layoutConversationId) {
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.trim() === '确认生成图文知识手册'));
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '确认生成图文知识手册');
      if (!button || button.disabled) throw Error('原PDF导出按钮不可用');
      button.click();
    });
  }
  for (;;) {
    await exportCapture;
    if (exportCaptureError) throw Error(exportCaptureError);
    const progress = await page.evaluate(() => ({
      text: document.body.innerText, finished: (window as any).__handbookFinished, error: (window as any).__handbookError,
    }));
    await fs.writeFile(path.join(root, 'ui-state.json'), JSON.stringify({ at: new Date().toISOString(), ...progress }));
    if (exportResult?.pdfError) throw Error(exportResult.pdfError);
    if (progress.error) throw Error(progress.error);
    if (progress.finished) {
      if (!exportResult?.pdfUrl || !exportResult.totalPages || exportResult.imagePages !== 23) {
        throw Error('正式PDF回执缺少完整页数或23图信息');
      }
      await status('pdf_download', { result: progress.finished });
      const response = await fetch(exportResult.pdfUrl);
      if (!response.ok || !response.body) throw Error('正式PDF下载失败：HTTP ' + response.status);
      const pdfFile = path.join(root, 'delivered.pdf');
      await pipeline(Readable.fromWeb(response.body as any), createWriteStream(pdfFile));
      const handle = await fs.open(pdfFile, 'r');
      const magic = Buffer.alloc(4);
      try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
      if (magic.toString() !== '%PDF') throw Error('正式出口返回文件不是PDF');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(pdfFile)) hash.update(chunk);
      const artifact = { at: new Date().toISOString(), bytes: (await fs.stat(pdfFile)).size, sha256: hash.digest('hex'),
        imagePages: exportResult.imagePages, totalPages: exportResult.totalPages, billing: exportResult.billing };
      await fs.writeFile(path.join(root, 'artifact.json'), JSON.stringify(artifact));
      await status('pdf_returned', { result: progress.finished, artifact });
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  await page.screenshot({ path: path.join(root, 'ui-final.png'), fullPage: true });
} catch (error) {
  await status('publication_failed', { error: safe((error as Error).message) });
  const pages = await browser?.pages();
  if (pages?.length) await pages[pages.length - 1].screenshot({ path: path.join(root, 'ui-final.png'), fullPage: true }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
