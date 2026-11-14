import { afterEach, expect, it, vi } from 'vitest';
import { knowledgeStructuredDistillContext, invokeKnowledgeStructuredDistill, KNOWLEDGE_DISTILL_RESUME_VERSION } from './knowledgeCardStructuredDistill';
import { invokeKnowledgePublicationRoutes, KNOWLEDGE_LATE_RECEIPT_WAIT_MS } from './knowledgePublicationRoutes';

afterEach(() => { vi.unstubAllEnvs(); });

const reading = (text: string) => ({ version: 1, subtitle: '', accent: 'jade', blocks: [{ type: 'prose', title: '饮食与活动配合', note: '', text }] });
/** 同一 GCS 桶：按完整对象名存取（各任务前缀不同，续做根按用户）。 */
function bucket() {
  const data = new Map<string, any>();
  const store = (prefix: string) => ({ prefix, read: async (key: string) => data.get(key) ?? null, save: async (key: string, value: any) => { data.set(key, structuredClone(value)); } });
  return { data, store };
}
const report = (request: any) => {
  const input = JSON.parse(request.contents[0].parts[0].text);
  return { status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ kind: 'knowledge_publication_v1', sourceDigest: input.sourceDigest, title: '原文提炼', pages: input.source.pages.map((page: any) => ({ ...page, role: undefined, imageUrl: undefined, body: '明确的知识说明。', reading: reading('明确的知识说明。'), imageDescription: '', imageStatus: 'absent', facts: [{ term: '主题', statement: '知识说明。' }], cautions: [] })) }) }] } }] }) };
};
/** 走真实路由的上游：从消息里取回原稿身份并回一份合同内的结构化 JSON。 */
const upstream = (model: string, body: any) => {
  const message = body.messages.find((m: any) => m.role === 'user');
  const text = typeof message.content === 'string' ? message.content : message.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
  const input = JSON.parse(text);
  const out = { kind: 'knowledge_publication_v1', sourceDigest: input.sourceDigest, title: '原文提炼', pages: input.source.pages.map((page: any) => ({ id: page.id, headline: '真实主题', body: '知识说明。', reading: { ...reading('知识说明。'), templateId: 'fusion_ink_mountains', templateReason: '主题适合' }, imageDescription: '', imageStatus: 'absent', facts: [{ term: '主题', statement: '知识说明。' }], cautions: [] })) };
  return new Response(JSON.stringify({ model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(out) } }] }), { status: 200 });
};
const params = (sourceText: string) => ({ sourceText, imageUrls: [], modelName: 'glm-5.3-flashx', minSections: 1 });

it('(i) 同一用户换任务号再提交同一份原稿：已完成批次零模型调用复用；(iii) 换用户或换原稿一律重新调用', async () => {
  const b = bucket(); const invoke = vi.fn(async (request: any) => report(request));
  const run = (user: number, job: string, text: string) => knowledgeStructuredDistillContext.run(
    { evidence: b.store(`knowledge-card-distill/user-${user}/${job}`), resume: b.store(`knowledge-card-distill/user-${user}/resume`), invoke: invoke as any },
    () => invokeKnowledgeStructuredDistill(params(text)));
  const text = '史记原文与注释。'.repeat(5000);
  const first = await run(7, 'job-a', text); const bought = invoke.mock.calls.length; expect(bought).toBeGreaterThan(1);
  const second = await run(7, 'job-b', text);
  expect(invoke).toHaveBeenCalledTimes(bought); expect(second).toBe(first);
  expect(Array.from(b.data.keys()).some(k => k.startsWith('knowledge-card-distill/user-7/job-b/') && k.endsWith('/reused.json'))).toBe(true);
  expect(Array.from(b.data.keys()).some(k => k.startsWith(`knowledge-card-distill/user-7/resume/${KNOWLEDGE_DISTILL_RESUME_VERSION}/`) && k.endsWith('/rendered.json'))).toBe(true);
  await run(8, 'job-c', text); expect(invoke).toHaveBeenCalledTimes(bought * 2);
  await run(7, 'job-d', text + '另一份原稿。'); expect(invoke.mock.calls.length).toBeGreaterThan(bought * 2);
});

it('(iv) 前一次提交留下未闭合回执：新任务接回原证据目录等迟到回执，不在新目录重买', async () => {
  const b = bucket(); const fetcher = vi.fn(async () => { throw new Error('stream reset'); });
  const invoke = (request: any, scope: any, overrides: any) => invokeKnowledgePublicationRoutes(request, scope, { ...overrides, key: () => 'test-key', fetch: fetcher as any, lateReceiptWaitMs: KNOWLEDGE_LATE_RECEIPT_WAIT_MS, sleep: async () => { throw Error('等待迟到回执中'); } });
  const run = (job: string) => knowledgeStructuredDistillContext.run(
    { evidence: b.store(`knowledge-card-distill/user-7/${job}`), resume: b.store('knowledge-card-distill/user-7/resume'), invoke: invoke as any },
    () => invokeKnowledgeStructuredDistill(params('短原文一段。')));
  await expect(run('job-a')).rejects.toThrow('等待迟到回执中'); expect(fetcher).toHaveBeenCalledTimes(1);
  const unknown = Array.from(b.data.entries()).find(([k, v]) => k.startsWith('knowledge-card-distill/user-7/job-a/') && /route-[^/]+\.json$/.test(k) && v.state === 'unknown');
  expect(unknown).toBeTruthy();
  await expect(run('job-b')).rejects.toThrow('等待迟到回执中'); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(Array.from(b.data.keys()).some(k => k.startsWith('knowledge-card-distill/user-7/job-b/') && /route-/.test(k))).toBe(false);
});

it('(ii) 一段失败不拖停其余段：其余段跑完并落盘，最后按段数报失败；重新提交只补未完成段', async () => {
  const { invokeDistillLlmPossiblyChunked } = await import('./knowledgeCardDistill');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key'); vi.stubEnv('EVOLINK_API_KEY', 'test-key');
  const b = bucket(); let failSecond = true;
  const invoke = vi.fn(async (request: any) => {
    const body = JSON.parse(request.contents[0].parts[0].text).source.pages.map((p: any) => p.body).join('');
    if (failSecond && body.startsWith('乙')) throw Error('各跳均失败（测试）');
    return report(request);
  });
  const text = ['甲', '乙', '丙', '丁', '戊'].map(c => (c + '段知识与条件。').repeat(3000)).join('\n\n');
  const run = (job: string) => knowledgeStructuredDistillContext.run(
    { evidence: b.store(`knowledge-card-distill/user-7/${job}`), resume: b.store('knowledge-card-distill/user-7/resume'), invoke: invoke as any },
    () => invokeDistillLlmPossiblyChunked({ sourceText: text, extraText: '', imageUrls: [], documents: [], modelName: 'glm-5.3-flashx', detailLevel: 'full', minSectionsTotal: 4 }));
  const failure = await run('job-a').catch(error => error);
  expect(failure.message).toMatch(/已完成 4\/5 段，1 段未完成/);
  expect(failure.knowledgeDistillDiagnostics).toHaveLength(1);
  expect(failure.knowledgeDistillDiagnostics[0]).toMatchObject({ segment: 2, total: 5 });
  expect(invoke).toHaveBeenCalledTimes(5);
  failSecond = false;
  expect(await run('job-b')).toContain('## 饮食与活动配合');
  expect(invoke).toHaveBeenCalledTimes(6);
}, 30_000);

it('双通道接手：一个通道全程余额不足（402），全部分段仍由另一通道完成，其余分段不再先撞坏通道', async () => {
  const { invokeDistillLlmPossiblyChunked } = await import('./knowledgeCardDistill');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key'); vi.stubEnv('EVOLINK_API_KEY', 'test-key');
  const b = bucket(); const logs: string[] = [];
  const fetcher = vi.fn(async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    if (String(url).includes('evolink')) return new Response('{"error":{"message":"insufficient balance"}}', { status: 402 });
    // 好通道每发 3 秒：让另一通道的工位（错峰 3.5 秒启动）也领到分段，验证坏通道名下的分段被接手。
    await new Promise(resolve => setTimeout(resolve, 3000));
    return upstream(body.model, body);
  });
  const invoke = (request: any, scope: any, overrides: any) => {
    request.systemInstruction.parts = [{ text: '测试用结构化正文，只验证既有JSON合同。' }];
    return invokeKnowledgePublicationRoutes(request, scope, { ...overrides, key: () => 'test-key', fetch: fetcher as any, sleep: async () => {}, log: (l: string) => logs.push(l) });
  };
  const text = Array.from({ length: 8 }, (_, i) => (`第${i}段知识与条件。`).repeat(2600)).join('\n\n');
  const out = await knowledgeStructuredDistillContext.run(
    { evidence: b.store('knowledge-card-distill/user-7/job-a'), resume: b.store('knowledge-card-distill/user-7/resume'), invoke: invoke as any },
    () => invokeDistillLlmPossiblyChunked({ sourceText: text, extraText: '', imageUrls: [], documents: [], modelName: 'glm-5.3-flashx', detailLevel: 'full', minSectionsTotal: 4 }));
  expect(out).toContain('知识说明。');
  const calls = fetcher.mock.calls.map(c => String(c[0]));
  const okCalls = calls.filter(u => !u.includes('evolink')).length, badCalls = calls.filter(u => u.includes('evolink')).length;
  expect(okCalls).toBe(8);
  // 坏通道只在被判 down 之前撞到（首发并发的那几路）；之后的分段直接从另一通道起步。
  expect(badCalls).toBeGreaterThan(0); expect(badCalls).toBeLessThanOrEqual(3);
  expect(logs.some(l => l.includes('reason=channel_down') && l.includes('channel=evolink'))).toBe(true);
}, 60_000);

it('失败诊断：按回执汇总类别、各跳通道与结果、各跳耗时、最后心跳距失败多久；不含正文/地址', async () => {
  const { collectKnowledgeDistillDiagnostic, knowledgeDistillDiagnosticsOf } = await import('./knowledgeDistillDiagnostics');
  const b = bucket(); const s = b.store('x');
  await s.save('p/batch-0/route-glm-evolink.json', { state: 'interrupted', startedAt: '2026-11-14T00:00:00.000Z', interruptedAt: '2026-11-14T00:06:00.000Z', reason: '传输中断，见 https://api.example.com/v1' });
  await s.save('p/batch-0/glm-evolink-heartbeat.json', { at: '2026-11-14T00:02:00.000Z' });
  await s.save('p/batch-0/route-glm-openrouter.json', { state: 'failed', startedAt: '2026-11-14T00:06:00.000Z', endedAt: '2026-11-14T00:06:05.000Z', response: { status: 402, text: '{}' }, reason: 'HTTP 402' });
  const d = await collectKnowledgeDistillDiagnostic(s, 'p/batch-0', new Error('图文整理的所有已配置通道均失败'), { segment: 29, total: 164, label: '史记 p300' }, new Date('2026-11-14T00:10:00.000Z'));
  expect(d).toMatchObject({ segment: 29, total: 164, category: 'insufficient_credit', categoryZh: '该通道额度不足（HTTP 402）', lastHeartbeatAgoMs: 8 * 60_000 });
  expect(d.hops).toEqual([
    { route: 'glm-evolink', channel: 'evolink', family: 'glm', state: 'interrupted', reason: '传输中断，见 [地址]', durationMs: 6 * 60_000 },
    { route: 'glm-openrouter', channel: 'openrouter', family: 'glm', state: 'failed', httpStatus: 402, reason: '该通道额度不足', durationMs: 5000 },
  ]);
  const wrapped = new Error('读档整理未完成', { cause: Object.assign(new Error('x'), { knowledgeDistillDiagnostics: [d] }) });
  expect(knowledgeDistillDiagnosticsOf(wrapped)).toEqual([d]);
});
