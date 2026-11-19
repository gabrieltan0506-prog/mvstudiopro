import { it, expect, vi, afterEach } from 'vitest';
import { knowledgeStructuredDistillContext, knowledgeDistillGateMax, KNOWLEDGE_DISTILL_GATE_MAX } from './knowledgeCardStructuredDistill';
import { KNOWLEDGE_DISTILL_WORKERS_START } from '../../shared/knowledgeConcurrency';

afterEach(() => { vi.unstubAllEnvs(); });
const reading = (text: string) => ({ version: 1, subtitle: '', accent: 'jade', blocks: [{ type: 'prose', title: `段落${text}`, note: '', text: `知识要点${text}。` }] });
function fixture() {
  const data = new Map<string, any>();
  const store = (prefix: string) => ({ prefix, read: async (k: string) => data.get(k), save: async (k: string, v: any) => { data.set(k, structuredClone(v)); } });
  const response = (request: any) => {
    const input = JSON.parse(request.contents[0].parts[0].text);
    // 每段正文取输入开头的段号标记，用于验证合并顺序。
    const marker = String(input.source.pages[0].body.match(/第(\d+)段/)?.[1] ?? 'x');
    const report = { kind: 'knowledge_publication_v1', sourceDigest: input.sourceDigest, title: '主题', pages: input.source.pages.map((page: any) => ({ id: page.id, headline: '主题', body: '一句话。', reading: reading(marker), imageDescription: '', imageStatus: 'absent', facts: [{ term: '要点', statement: '一条。' }], cautions: [] })) };
    return { status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(report) }] } }] }) };
  };
  return { data, store, response };
}
const book = (segments: number) => Array.from({ length: segments }, (_, i) => `第${i}段知识与条件。`.repeat(2000)).join('\n\n');

it('B3 手册读档：每通道起步 3，连续成功逐步加到上限 8（合计 ≤16），段号与合并顺序不变；请求闸限流信号使该通道工位减半', async () => {
  const { invokeDistillLlmPossiblyChunked } = await import('./knowledgeCardDistill');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key'); vi.stubEnv('EVOLINK_API_KEY', 'test-key');
  const f = fixture();
  const active = { openrouter: 0, evolink: 0 }, peak = { openrouter: 0, evolink: 0 };
  const firstWave: number[] = []; const labels: string[] = []; let calls = 0; let gatesSeen: any;
  const invoke = vi.fn(async (request: any, _scope: any, overrides: any) => {
    const channel = request.executionChannel as 'openrouter' | 'evolink';
    gatesSeen = overrides.gates;
    active[channel]++; peak[channel] = Math.max(peak[channel], active[channel]);
    calls++; if (calls <= 6) firstWave.push(active.openrouter + active.evolink);
    labels.push(overrides.logLabel);
    try {
      await new Promise(r => setTimeout(r, 3));
      // 第 40 次请求在 EvoLink 闸上记一次限流（与路由层 429/无心跳同一信号）。
      if (calls === 40) { await overrides.gates.evolink.acquire(); overrides.gates.evolink.release('rate_limited'); }
      return f.response(request);
    } finally { active[channel]--; }
  });
  const segments = 60;
  const result = await knowledgeStructuredDistillContext.run({ evidence: f.store('kc/user-1/job-a'), resume: f.store('kc/user-1/resume'), invoke: invoke as any },
    () => invokeDistillLlmPossiblyChunked({ sourceText: book(segments), extraText: '', imageUrls: [], documents: [], modelName: 'glm-5.3-flashx', detailLevel: 'full', minSectionsTotal: 4 }));
  expect(invoke).toHaveBeenCalledTimes(segments);
  expect(Math.max(...firstWave)).toBeLessThanOrEqual(2 * KNOWLEDGE_DISTILL_WORKERS_START);
  expect(peak.openrouter).toBeGreaterThan(KNOWLEDGE_DISTILL_WORKERS_START);
  expect(peak.openrouter).toBeLessThanOrEqual(8); expect(peak.evolink).toBeLessThanOrEqual(8);
  // 段身份标签与段数一一对应，未因在读数改变。
  expect(new Set(labels).size).toBe(segments);
  expect(labels.every(l => new RegExp(`^seg-\\d+of${segments}$`).test(l))).toBe(true);
  // 合并顺序 = 段序。
  const order = Array.from(result.matchAll(/知识要点(\d+)/g), m => Number(m[1]));
  expect(order).toEqual(Array.from({ length: segments }, (_, i) => i));
  expect(gatesSeen.evolink.rateLimited).toBe(1);
  // 请求闸上限跟随工位上限（2×8=16）。
  expect(gatesSeen.openrouter.max).toBe(16); expect(KNOWLEDGE_DISTILL_GATE_MAX).toBe(16);
}, 60_000);

it('B3 env 上限 4：每通道在读不超过 4，请求闸上限跟随为 8；已完成段再提交零调用', async () => {
  const { invokeDistillLlmPossiblyChunked } = await import('./knowledgeCardDistill');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key'); vi.stubEnv('EVOLINK_API_KEY', 'test-key');
  vi.stubEnv('KNOWLEDGE_DISTILL_WORKERS_PER_CHANNEL_MAX', '4');
  expect(knowledgeDistillGateMax('openrouter')).toBe(8);
  const f = fixture(); const active = { openrouter: 0, evolink: 0 }, peak = { openrouter: 0, evolink: 0 };
  const invoke = vi.fn(async (request: any) => {
    const c = request.executionChannel as 'openrouter' | 'evolink'; active[c]++; peak[c] = Math.max(peak[c], active[c]);
    try { await new Promise(r => setTimeout(r, 2)); return f.response(request); } finally { active[c]--; }
  });
  const run = () => knowledgeStructuredDistillContext.run({ evidence: f.store('kc/user-2/job-a'), resume: f.store('kc/user-2/resume'), invoke: invoke as any },
    () => invokeDistillLlmPossiblyChunked({ sourceText: book(40), extraText: '', imageUrls: [], documents: [], modelName: 'glm-5.3-flashx', detailLevel: 'full', minSectionsTotal: 4 }));
  const first = await run();
  expect(peak.openrouter).toBeLessThanOrEqual(4); expect(peak.evolink).toBeLessThanOrEqual(4);
  expect(invoke).toHaveBeenCalledTimes(40);
  expect(await run()).toBe(first); expect(invoke).toHaveBeenCalledTimes(40);
}, 60_000);

it('B3 失败注入：部分段失败时报部分失败（不报全成功），在途收尾，工位不泄漏、不挂起；再提交只补失败段', async () => {
  const { invokeDistillLlmPossiblyChunked } = await import('./knowledgeCardDistill');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key'); vi.stubEnv('EVOLINK_API_KEY', 'test-key');
  const f = fixture(); let failing = true;
  const invoke = vi.fn(async (request: any, _s: any, o: any) => {
    await new Promise(r => setTimeout(r, 2));
    if (failing && /^seg-(3|17|29)of/.test(o.logLabel)) throw Object.assign(new Error('ENOSPC: no space left on device（注入）'), { code: 'ENOSPC' });
    return f.response(request);
  });
  const run = () => knowledgeStructuredDistillContext.run({ evidence: f.store('kc/user-3/job-a'), resume: f.store('kc/user-3/resume'), invoke: invoke as any },
    () => invokeDistillLlmPossiblyChunked({ sourceText: book(36), extraText: '', imageUrls: [], documents: [], modelName: 'glm-5.3-flashx', detailLevel: 'full', minSectionsTotal: 4 }));
  const error = await run().catch(e => e);
  expect(error.message).toContain('已完成 33/36 段');
  expect(error.knowledgeDistillIncomplete).toEqual({ completed: 33, total: 36 });
  failing = false; const before = invoke.mock.calls.length;
  const result = await run();
  expect(invoke.mock.calls.length - before).toBe(3);
  expect(Array.from(result.matchAll(/知识要点(\d+)/g), m => Number(m[1]))).toEqual(Array.from({ length: 36 }, (_, i) => i));
}, 60_000);

it('B3 取消：等待工位的分段不再领取，整单以取消收口且不挂起', async () => {
  const { invokeDistillLlmPossiblyChunked } = await import('./knowledgeCardDistill');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key'); vi.stubEnv('EVOLINK_API_KEY', 'test-key');
  const f = fixture(), controller = new AbortController(); let calls = 0;
  const invoke = vi.fn(async (request: any) => {
    if (++calls === 8) controller.abort(new Error('用户终止（注入）'));
    await new Promise(r => setTimeout(r, 2)); controller.signal.throwIfAborted(); return f.response(request);
  });
  const started = Date.now();
  const error = await knowledgeStructuredDistillContext.run({ evidence: f.store('kc/user-4/job-a'), invoke: invoke as any },
    () => invokeDistillLlmPossiblyChunked({ abortSignal: controller.signal, sourceText: book(40), extraText: '', imageUrls: [], documents: [], modelName: 'glm-5.3-flashx', detailLevel: 'full', minSectionsTotal: 4 })).catch(e => e);
  expect(String(error?.message ?? error)).toContain('终止');
  expect(calls).toBeLessThan(40);
  expect(Date.now() - started).toBeLessThan(10_000);
}, 30_000);

it('B3 接线：该通道请求闸收到限流/无心跳结果时，本通道分段工位立即减半（另一通道不受影响）', async () => {
  const { invokeDistillLlmPossiblyChunked } = await import('./knowledgeCardDistill');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key'); vi.stubEnv('EVOLINK_API_KEY', 'test-key');
  const f = fixture(); const logs: string[] = [];
  const info = vi.spyOn(console, 'info').mockImplementation((line: unknown) => { logs.push(String(line)); });
  let calls = 0;
  const invoke = vi.fn(async (request: any, _s: any, overrides: any) => {
    await new Promise(r => setTimeout(r, 2));
    // 第 12 次请求：EvoLink 闸记一次限流（与路由层 429/无心跳同一出口 release('rate_limited')）。
    if (++calls === 12) { await overrides.gates.evolink.acquire(); overrides.gates.evolink.release('rate_limited'); }
    return f.response(request);
  });
  try {
    await knowledgeStructuredDistillContext.run({ evidence: f.store('kc/user-5/job-a'), invoke: invoke as any },
      () => invokeDistillLlmPossiblyChunked({ sourceText: book(30), extraText: '', imageUrls: [], documents: [], modelName: 'glm-5.3-flashx', detailLevel: 'full', minSectionsTotal: 4 }));
  } finally { info.mockRestore(); }
  const throttled = logs.filter(l => /分段工位 channel=\w+ \d+->\d+ cause=throttled/.test(l));
  expect(throttled).toHaveLength(1);
  const [, from, to] = throttled[0].match(/channel=evolink (\d+)->(\d+)/)!.map(Number) as unknown as [string, number, number];
  expect(to).toBe(Math.max(1, Math.floor(from / 2)));
}, 60_000);
