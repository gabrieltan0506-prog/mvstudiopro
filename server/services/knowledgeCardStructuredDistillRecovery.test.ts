import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';

// 分段字数调到下限 4000：300 段大书只占约 120 万字，测试内存可控；单段身份/证据/状态机与 24000 字一致。
vi.hoisted(() => { process.env.KNOWLEDGE_CARD_DISTILL_GLM_CHUNK_CHARS = '4000'; process.env.KNOWLEDGE_CARD_DISTILL_GLM_CHUNK_THRESHOLD = '6000'; });

import { knowledgeStructuredDistillContext, invokeKnowledgeStructuredDistill, splitKnowledgeDistillPiece } from './knowledgeCardStructuredDistill';

/**
 * 替身路由：模拟真实三跳回落「一个证据目录内的额度」——目录里已有失败回执时原地秒败、不再购买（旧行为卡死的根源）；
 * 没有回执时算一次购买，按策略成功或写下失败回执后抛「所有已配置通道均失败」。
 */
type Policy = (segment: number, scope: string, body: string) => 'ok' | 'fail' | 'hold' | 'crash';
const reading = (title: string, text: string) => ({ version: 1, subtitle: '', accent: 'jade', blocks: [{ type: 'prose', title, note: '', text }] });
const markers = (body: string) => Array.from(body.matchAll(/【段(\d+)·句(\d+)】/g)).map(m => `${m[1]}-${m[2]}`);
function harness(policy: Policy) {
  const data = new Map<string, any>();
  const evidence = (prefix: string) => ({ prefix, read: async (k: string) => data.get(k) ?? null, save: async (k: string, v: any) => { data.set(k, structuredClone(v)); } });
  const purchases: { segment: number; scope: string }[] = [];
  const invoke = vi.fn(async (request: any, scope: any) => {
    const input = JSON.parse(request.contents[0].parts[0].text);
    const body = input.source.pages.map((p: any) => p.body).join('\n');
    const segment = Number(body.match(/【段(\d+)·/)?.[1] ?? -1);
    const receiptKey = `${scope.prefix}/route-glm-openrouter.json`;
    const old = await scope.read(receiptKey);
    if (old?.state === 'failed') throw new Error('图文整理的所有已配置通道均失败，原稿与各跳回执已保存：HTTP 500');
    if (old?.state === 'pending') throw new Error('原请求回执尚未闭合，保留原任务，不重复提交或切换通道');
    const decision = policy(segment, scope.prefix, body);
    if (decision === 'crash') throw new Error('测试用派发前故障');
    purchases.push({ segment, scope: scope.prefix });
    if (decision === 'hold') { await scope.save(receiptKey, { state: 'pending', route: 'glm-openrouter' }); throw new Error('原请求回执尚未闭合，保留原任务，不重复提交或切换通道'); }
    if (decision === 'fail') { await scope.save(receiptKey, { state: 'failed', route: 'glm-openrouter', status: 500 }); throw new Error('图文整理的所有已配置通道均失败，原稿与各跳回执已保存：HTTP 500'); }
    const report = { kind: 'knowledge_publication_v1', sourceDigest: input.sourceDigest, title: '原文提炼', pages: input.source.pages.map((page: any) => {
      const own = markers(page.body);
      return { id: page.id, headline: '本段主题', body: '本段主题。', reading: reading(`提炼${own[0]}至${own[own.length - 1]}`, `要点覆盖${own.length}句。`), imageDescription: '', imageStatus: 'absent', facts: [{ term: '主题', statement: '本段主题。' }], cautions: [] };
    }) };
    return { status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(report) }] } }] }) };
  });
  return { data, evidence, invoke, purchases };
}
/** 每段约 3600 字、180 句，句间换行、段间空行：外层按 4000 字切恰好一段一份，减半在句界。 */
const book = (segments: number) => Array.from({ length: segments }, (_, s) =>
  Array.from({ length: 180 }, (_, k) => `【段${String(s).padStart(3, '0')}·句${String(k).padStart(3, '0')}】知识条件与因果说明。`).join('\n')).join('\n\n');

async function runBook(h: ReturnType<typeof harness>, segments: number, options: { jobPrefix?: string; notices?: string[]; extra?: Record<string, unknown> } = {}) {
  const { invokeDistillLlmPossiblyChunked } = await import('./knowledgeCardDistill');
  const store: any = { evidence: h.evidence(options.jobPrefix || 'knowledge-card-distill/user-7/kc_big'), invoke: h.invoke, recoveryRetryDelaysMs: [0, 0, 0], ...options.extra };
  const markdown = await knowledgeStructuredDistillContext.run(store, () => invokeDistillLlmPossiblyChunked({
    sourceText: book(segments), extraText: '', imageUrls: [], documents: [], modelName: 'glm-5.3-flashx', detailLevel: 'full', minSectionsTotal: 4,
    onNotice: notice => options.notices?.push(notice),
  }));
  return { markdown, gaps: store.distillGaps as any[] | undefined };
}
const stripTimes = (value: any): any => Array.isArray(value) ? value.map(stripTimes)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'at').map(([k, v]) => [k, stripTimes(v)])) : value;

it('20 段小书全成功：证据目录、请求体、成稿与改动前逐字相同（基线哈希），不写任何恢复文件', async () => {
  const h = harness(() => 'ok');
  const { markdown, gaps } = await runBook(h, 20, { jobPrefix: 'knowledge-card-distill/user-7/kc_small' });
  expect(h.purchases).toHaveLength(20);
  expect(gaps ?? []).toEqual([]);
  expect(Array.from(h.data.keys()).some(k => /recovery|retry-|split-/.test(k))).toBe(false);
  const entries = Array.from(h.data.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stripTimes(v)]);
  const requests = h.invoke.mock.calls.map(([request, scope]: any) => [scope.prefix, request]).sort(([a]: any, [b]: any) => a.localeCompare(b));
  const digest = createHash('sha256').update(JSON.stringify({ markdown, entries, requests })).digest('hex');
  // 基线 = main c30e8a9 上同一用例算出的哈希（先跑基线代码取值，再改代码）。
  expect(digest).toBe('96fa5578e08ec35d5d70e0218c6cf35c6eae88a4edff917f647983e89f59e435');
}, 60_000);

it('300 段大书：1 段首轮三跳明确失败 → 新证据目录完整重试成功；原失败回执逐字保留；整本完成', async () => {
  const h = harness((segment, scope) => segment === 17 && !scope.includes('recovery') ? 'fail' : 'ok');
  const { markdown, gaps } = await runBook(h, 300);
  expect(gaps ?? []).toEqual([]);
  expect(h.purchases.filter(p => p.segment === 17).map(p => p.scope.replace(/.*\/json-[a-f0-9]+\//, ''))).toEqual(['batch-0', 'batch-0-recovery/retry-1']);
  expect(h.purchases).toHaveLength(301);
  const failedReceipt = Array.from(h.data.entries()).find(([k, v]) => k.endsWith('batch-0/route-glm-openrouter.json') && v.state === 'failed');
  expect(failedReceipt?.[1]).toEqual({ state: 'failed', route: 'glm-openrouter', status: 500 });
  expect(markdown).toContain('提炼017-000至017-179');
  expect(markdown.indexOf('提炼016-000')).toBeLessThan(markdown.indexOf('提炼017-000'));
  expect(markdown.indexOf('提炼017-000')).toBeLessThan(markdown.indexOf('提炼018-000'));
}, 120_000);

it('300 段大书：1 段首轮与新目录都失败 → 对半切分（新目录、新请求身份）各自成功，按原顺序拼回', async () => {
  const h = harness((segment, scope) => segment === 42 && !scope.includes('split-') ? 'fail' : 'ok');
  const notices: string[] = [];
  const { markdown, gaps } = await runBook(h, 300, { notices });
  expect(gaps ?? []).toEqual([]);
  const seg = h.purchases.filter(p => p.segment === 42).map(p => p.scope.replace(/.*\/json-[a-f0-9]+\//, ''));
  expect(seg).toEqual(expect.arrayContaining(['batch-0', 'batch-0-recovery/retry-1', 'batch-0-recovery/split-0', 'batch-0-recovery/split-1']));
  expect(seg).toHaveLength(4);
  // 两半请求身份不同于原段，且互不相同。
  const digests = h.invoke.mock.calls.filter(([, scope]: any) => /split-\d$/.test(scope.prefix)).map(([request]: any) => JSON.parse(request.contents[0].parts[0].text).sourceDigest);
  expect(new Set(digests).size).toBe(2);
  const a = markdown.indexOf('提炼042-000至'), b = markdown.indexOf('至042-179');
  expect(a).toBeGreaterThan(markdown.indexOf('提炼041-000'));
  expect(b).toBeGreaterThan(a);
  expect(markdown.indexOf('提炼043-000')).toBeGreaterThan(b);
  // 两半首尾句衔接，不丢句。
  const half = markdown.match(/提炼042-000至042-(\d+)/)![1], next = String(Number(half) + 1).padStart(3, '0');
  expect(markdown).toContain(`提炼042-${next}至042-179`);
  expect(notices.some(n => n.includes('未能提炼'))).toBe(false);
}, 120_000);

it('300 段大书：1 段始终失败 → 记为缺口（段号/原文位置/原因类别），整本完成，前台提醒可见，其余 299 段齐全', async () => {
  const h = harness(segment => segment === 99 ? 'fail' : 'ok');
  const notices: string[] = [];
  const { markdown, gaps } = await runBook(h, 300, { notices });
  expect(gaps).toHaveLength(1);
  expect(gaps![0]).toMatchObject({ segment: 100, totalSegments: 300, category: 'routes_exhausted' });
  expect(gaps![0].ranges).toEqual([{ start: 0, end: expect.any(Number) }]);
  expect(gaps![0].sourceLabel).toContain('第 100 段');
  expect(gaps![0].evidence.length).toBeGreaterThanOrEqual(4); // 原目录 + 新目录 + 两半，全部保留可查
  expect(notices.some(n => /第 100 段未能提炼，已保留原文位置/.test(n))).toBe(true);
  expect(markdown).not.toContain('提炼099-');
  for (const s of [0, 98, 100, 299]) expect(markdown).toContain(`提炼${String(s).padStart(3, '0')}-000`);
  // 缺口记录永久落盘，原失败回执均在。
  const gapFiles = Array.from(h.data.keys()).filter(k => k.endsWith('batch-0-recovery/state.json'));
  expect(gapFiles).toHaveLength(1);
  expect(h.data.get(gapFiles[0]).gap).toBeTruthy();
  expect(Array.from(h.data.entries()).filter(([k, v]) => k.endsWith('route-glm-openrouter.json') && v.state === 'failed')).toHaveLength(4);
}, 120_000);

it('续跑不秒败：旧任务目录里已有失败回执（额度已用完）→ 不原地秒败，新目录重试；已成功段零调用', async () => {
  // 第一次执行（旧部署）：第 5 段写下失败回执后，用一个非明确失败模拟进程中断（任务未完成）。
  let crashed = false;
  const crashPolicy: Policy = (segment, scope) => {
    if (segment === 5 && !scope.includes('recovery')) return 'fail';
    if (segment === 5 && !crashed) { crashed = true; return 'crash'; }
    return 'ok';
  };
  const h1 = harness(crashPolicy);
  await expect(runBook(h1, 30, { jobPrefix: 'knowledge-card-distill/user-7/kc_resume' })).rejects.toThrow();
  const before = h1.purchases.length;
  expect(h1.purchases.filter(p => p.segment === 5)).toHaveLength(1); // 原目录一次购买失败；新目录派发前中断，未购买
  // 续跑（同任务号、同证据）：成功段零调用，第 5 段不回原目录秒败，直接在新目录重试成功。
  const resumed = await runBook(h1, 30, { jobPrefix: 'knowledge-card-distill/user-7/kc_resume' });
  expect(h1.purchases.length - before).toBe(1);
  expect(h1.purchases[h1.purchases.length - 1].scope).toMatch(/batch-0-recovery\/retry-1$/);
  expect(resumed.markdown).toContain('提炼005-000');
  // 再续一次：全部零调用回放。
  const again = await runBook(h1, 30, { jobPrefix: 'knowledge-card-distill/user-7/kc_resume' });
  expect(h1.purchases.length - before).toBe(1);
  expect(again.markdown).toBe(resumed.markdown);
}, 120_000);

it('续跑：已判缺口的段零调用回放缺口，不再购买；减半中途中断后续跑只补未完成的一半', async () => {
  const h = harness(segment => segment === 3 ? 'fail' : 'ok');
  const first = await runBook(h, 12, { jobPrefix: 'knowledge-card-distill/user-7/kc_gap' });
  const count = h.purchases.length;
  expect(first.gaps).toHaveLength(1);
  const second = await runBook(h, 12, { jobPrefix: 'knowledge-card-distill/user-7/kc_gap' });
  expect(h.purchases.length).toBe(count);
  expect(second.gaps).toEqual(first.gaps);
  expect(second.markdown).toBe(first.markdown);

  let crashed = false;
  const h2 = harness((segment, scope) => {
    if (segment !== 7) return 'ok';
    if (!scope.includes('split-')) return 'fail';
    if (scope.endsWith('split-1') && !crashed) { crashed = true; return 'crash'; }
    return 'ok';
  });
  await expect(runBook(h2, 12, { jobPrefix: 'knowledge-card-distill/user-7/kc_half' })).rejects.toThrow();
  const seg7 = () => h2.purchases.filter(p => p.segment === 7).map(p => p.scope.replace(/.*\/json-[a-f0-9]+\//, ''));
  expect(seg7()).toEqual(['batch-0', 'batch-0-recovery/retry-1', 'batch-0-recovery/split-0']);
  const resumed = await runBook(h2, 12, { jobPrefix: 'knowledge-card-distill/user-7/kc_half' });
  expect(seg7()).toEqual(['batch-0', 'batch-0-recovery/retry-1', 'batch-0-recovery/split-0', 'batch-0-recovery/split-1']);
  expect(resumed.gaps ?? []).toEqual([]);
  expect(resumed.markdown).toContain('至007-179');
}, 120_000);

it('未闭合回执（结果未知）不换目录、不重买：原样保留任务等待恢复', async () => {
  const h = harness(() => 'hold');
  const run = () => knowledgeStructuredDistillContext.run({ evidence: h.evidence('kc/u1/job-hold'), invoke: h.invoke as any, recoveryRetryDelaysMs: [0] } as any,
    () => invokeKnowledgeStructuredDistill({ sourceText: book(1), imageUrls: [], modelName: 'glm-5.3-flashx', minSections: 1 }));
  await expect(run()).rejects.toThrow('尚未闭合');
  await expect(run()).rejects.toThrow('尚未闭合');
  expect(h.purchases).toHaveLength(1);
  expect(Array.from(h.data.keys()).some(k => k.includes('recovery'))).toBe(false);
});

it('临时性存储错误不计入重试次数：新目录写入抖动一次后原地重做同一步，不跳到减半', async () => {
  const h = harness((segment, scope) => scope.includes('recovery') ? 'ok' : 'fail');
  let blips = 0;
  const evidence = h.evidence('kc/u1/job-blip');
  const flaky = { ...evidence, save: async (k: string, v: any) => {
    if (k.endsWith('retry-1/request.json') && blips < 2) { blips++; throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }); }
    return evidence.save(k, v);
  } };
  const result = await knowledgeStructuredDistillContext.run({ evidence: flaky, invoke: h.invoke as any, recoveryRetryDelaysMs: [0, 0, 0] } as any,
    () => invokeKnowledgeStructuredDistill({ sourceText: book(1), imageUrls: [], modelName: 'glm-5.3-flashx', minSections: 1 }));
  expect(blips).toBe(2);
  expect(result).toContain('提炼000-000至000-179');
  expect(h.purchases.map(p => p.scope.replace(/.*\/json-[a-f0-9]+\//, ''))).toEqual(['batch-0', 'batch-0-recovery/retry-1']);
  const state = Array.from(h.data.entries()).find(([k]) => k.endsWith('batch-0-recovery/state.json'))![1];
  expect(state.failures.map((f: any) => f.stage)).toEqual(['base']);
});

it('内容审核拒绝：不换目录、不减半（同一原文必然再拒），直接记缺口，类别 content_safety', async () => {
  const data = new Map<string, any>();
  const evidence = { prefix: 'kc/u1/job-safety', read: async (k: string) => data.get(k) ?? null, save: async (k: string, v: any) => { data.set(k, structuredClone(v)); } };
  const invoke = vi.fn(async () => { throw Object.assign(new Error('内容被安全策略拦截'), { name: 'SseContentSafetyError', code: 'sse_content_safety' }); });
  const store: any = { evidence, invoke, recoveryRetryDelaysMs: [] };
  const run = () => knowledgeStructuredDistillContext.run(store, () => invokeKnowledgeStructuredDistill({ sourceText: book(1), imageUrls: [], modelName: 'glm-5.3-flashx', minSections: 1, chunkLabel: '第 3/9 段（第 3 段）' }));
  const error: any = await run().catch(e => e);
  expect(error.knowledgeDistillGap[0]).toMatchObject({ segment: 3, totalSegments: 9, category: 'content_safety', whole: true });
  expect(invoke).toHaveBeenCalledTimes(1);
  await run().catch(() => {});
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('对半切分：两片拼接逐字等于原文、起点可回溯；再减半受下限约束', () => {
  const body = book(1);
  const [a, b] = splitKnowledgeDistillPiece({ path: '', pages: [{ headline: 'h', body, start: 100 }] })!;
  expect(a.pages[0].body + b.pages[0].body).toBe(body);
  expect(b.pages[0].start).toBe(100 + a.pages[0].body.length);
  expect(a.pages[0].body.endsWith('\n')).toBe(true);
  expect(splitKnowledgeDistillPiece(a)).toBeNull(); // 约 1800 字 < 2×1500
  const pages = [1, 2, 3].map(i => ({ headline: `p${i}`, body: `第${i}页`, start: i }));
  const [x, y] = splitKnowledgeDistillPiece({ path: '', pages })!;
  expect([...x.pages, ...y.pages]).toEqual(pages);
});
