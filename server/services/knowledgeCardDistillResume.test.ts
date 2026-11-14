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

/** 带 generation 的内存桶：saveIfGeneration 与 GCS ifGenerationMatch 同语义（'0' = 仅当不存在）。 */
function versionedBucket() {
  const data = new Map<string, any>(), gen = new Map<string, number>();
  const put = (key: string, value: any) => { data.set(key, structuredClone(value)); gen.set(key, (gen.get(key) || 0) + 1); };
  const store = (prefix: string) => ({
    prefix, read: async (key: string) => data.get(key) ?? null, save: async (key: string, value: any) => { put(key, value); },
    readVersioned: async (key: string) => data.has(key) ? { value: structuredClone(data.get(key)), generation: String(gen.get(key)) } : null,
    saveIfGeneration: async (key: string, value: any, generation: string) => { if (String(gen.get(key) || 0) !== generation) return false; put(key, value); return true; },
  });
  return { data, store };
}

it('P1-1 情形A：任务A某段仍在长时间生成（超过3分钟）时任务B到达 → B不接回、不重买，等A的成果后零调用复用', async () => {
  const b = versionedBucket(); const active = new Set(['job-a']);
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  const calls: string[] = [];
  const invokeA = vi.fn(async (request: any, scope: any) => { calls.push(scope.prefix); await gate; return report(request); });
  const invokeB = vi.fn(async (request: any, scope: any) => { calls.push(scope.prefix); return report(request); });
  const ctx = (job: string, invoke: any) => ({ evidence: b.store(`knowledge-card-distill/user-7/${job}`), resume: b.store('knowledge-card-distill/user-7/resume'), invoke, jobId: job, jobActive: async (id: string) => active.has(id), leaseWaitMs: 5 });
  const text = '史记原文与注释。'.repeat(500);
  const a = knowledgeStructuredDistillContext.run(ctx('job-a', invokeA), () => invokeKnowledgeStructuredDistill(params(text)));
  await new Promise(r => setTimeout(r, 30));
  const bRun = knowledgeStructuredDistillContext.run(ctx('job-b', invokeB), () => invokeKnowledgeStructuredDistill(params(text)));
  await new Promise(r => setTimeout(r, 60)); // B 在等待，A 仍在生成
  expect(invokeB).not.toHaveBeenCalled();
  expect(Array.from(b.data.keys()).some(k => k.startsWith('knowledge-card-distill/user-7/job-b/') && k.endsWith('/waiting.json'))).toBe(true);
  release(); const outA = await a; active.delete('job-a');
  expect(await bRun).toBe(outA);
  expect(invokeB).not.toHaveBeenCalled(); expect(invokeA).toHaveBeenCalledTimes(1);
  expect(calls.every(p => p.startsWith('knowledge-card-distill/user-7/job-a/'))).toBe(true);
});

it('P1-1 情形B：A/B 同时开跑、交错写续做租约 → 每段只有一方购买', async () => {
  const b = versionedBucket(); const active = new Set(['job-a', 'job-b']);
  const invoke = vi.fn(async (request: any) => { await new Promise(r => setTimeout(r, 20)); return report(request); });
  const ctx = (job: string) => ({ evidence: b.store(`knowledge-card-distill/user-7/${job}`), resume: b.store('knowledge-card-distill/user-7/resume'), invoke: invoke as any, jobId: job, jobActive: async (id: string) => active.has(id), leaseWaitMs: 5 });
  const text = '史记原文与注释。'.repeat(5000); // 多批
  const run = (job: string) => knowledgeStructuredDistillContext.run(ctx(job), () => invokeKnowledgeStructuredDistill(params(text))).finally(() => active.delete(job));
  const [x, y] = await Promise.all([run('job-a'), run('job-b')]);
  expect(x).toBe(y);
  const leases = Array.from(b.data.entries()).filter(([k]) => k.endsWith('/attempt.json'));
  expect(invoke).toHaveBeenCalledTimes(leases.length);
});

it('P3-2 旧任务已结束且留下确定性校验失败的完整回包 → 新任务在自己目录重做该段（不永久零调用失败）', async () => {
  const b = versionedBucket(); let bad = true;
  const invoke = vi.fn(async (request: any) => {
    const r = report(request); if (!bad) return r; bad = false;
    const env = JSON.parse(r.text), rep = JSON.parse(env.candidates[0].content.parts[0].text);
    rep.pages[0].id = '00000000-0000-4000-8000-000000000000'; env.candidates[0].content.parts[0].text = JSON.stringify(rep);
    return { status: 200, text: JSON.stringify(env) };
  });
  const ctx = (job: string) => ({ evidence: b.store(`knowledge-card-distill/user-7/${job}`), resume: b.store('knowledge-card-distill/user-7/resume'), invoke: invoke as any, jobId: job, jobActive: async () => false });
  const run = (job: string) => knowledgeStructuredDistillContext.run(ctx(job), () => invokeKnowledgeStructuredDistill(params('短原文一段。')));
  await expect(run('job-a')).rejects.toThrow(); expect(invoke).toHaveBeenCalledTimes(1);
  await expect(run('job-a')).rejects.toThrow(); expect(invoke).toHaveBeenCalledTimes(1); // 同一任务恢复：照旧不重买
  expect(await run('job-b')).toContain('明确的知识说明'); expect(invoke).toHaveBeenCalledTimes(2);
  expect(Array.from(b.data.keys()).some(k => k.startsWith('knowledge-card-distill/user-7/job-b/') && k.endsWith('/raw.json'))).toBe(true);
});

it('P3-1 已有报告但未生成成稿：疑点归位接回出报告的那次目录，旧归位回执未闭合时不再买', async () => {
  const b = versionedBucket(); const invoke = vi.fn(async (request: any) => {
    const input = JSON.parse(request.contents[0].parts[0].text);
    if (input.source?.title === '已有疑点对应原章') throw Error('不应购买疑点归位');
    const r = JSON.parse(report(request).text); const rep = JSON.parse(r.candidates[0].content.parts[0].text);
    rep.pages = rep.pages.map((p: any) => ({ ...p, reading: { version: 1, subtitle: '', accent: 'jade', blocks: [{ type: 'prose', title: '甲章', note: '', text: '甲' }, { type: 'prose', title: '乙章', note: '', text: '乙' }] }, cautions: [{ kind: 'uncertain', evidence: '无法定位的疑点', message: '待核' }] }));
    r.candidates[0].content.parts[0].text = JSON.stringify(rep); return { status: 200, text: JSON.stringify(r) };
  });
  const ctx = (job: string) => ({ evidence: b.store(`knowledge-card-distill/user-7/${job}`), resume: b.store('knowledge-card-distill/user-7/resume'), invoke: invoke as any, jobId: job, jobActive: async () => false });
  // 任务A：报告已落续做根；疑点归位留下未闭合回执后进程中断（模拟：删掉 rendered，并放一条 pending 归位回执）
  await knowledgeStructuredDistillContext.run(ctx('job-a'), () => invokeKnowledgeStructuredDistill(params('短原文一段。')));
  const rendered = Array.from(b.data.keys()).find(k => k.endsWith('/rendered.json'))!; b.data.delete(rendered);
  const reportKey = Array.from(b.data.keys()).find(k => k.includes('/resume/') && k.endsWith('/report.json'))!;
  const from = b.data.get(reportKey).from as string;
  const bindingRequestKey = Array.from(b.data.keys()).find(k => k.startsWith(from) && /caution-binding-[^/]+\/request\.json$/.test(k));
  const bindingDir = bindingRequestKey ? bindingRequestKey.replace(/\/request\.json$/, '') : `${from}/caution-binding-x`;
  for (const k of Array.from(b.data.keys())) if (k.startsWith(bindingDir) && !k.endsWith('/request.json')) b.data.delete(k);
  b.data.set(`${bindingDir}/route-glm-openrouter.json`, { state: 'pending', requestDigest: 'x' });
  const calls = invoke.mock.calls.length;
  const out = await knowledgeStructuredDistillContext.run(ctx('job-b'), () => invokeKnowledgeStructuredDistill(params('短原文一段。')));
  expect(out).toContain('甲'); expect(invoke).toHaveBeenCalledTimes(calls);
  expect(Array.from(b.data.keys()).some(k => k.startsWith('knowledge-card-distill/user-7/job-b/') && k.includes('caution-binding'))).toBe(false);
});

it('P1-2 熔断：连续 5 段失败即停止领取新段，在途收尾，以中性文案失败并保留已完成段', async () => {
  const { invokeDistillLlmPossiblyChunked, KNOWLEDGE_DISTILL_BREAKER_CONSECUTIVE, KNOWLEDGE_CARD_CHUNK_WORKERS_PER_ROUTE } = await import('./knowledgeCardDistill');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key'); vi.stubEnv('EVOLINK_API_KEY', 'test-key');
  const b = bucket(); const invoke = vi.fn(async () => { await new Promise(r => setTimeout(r, 5)); throw Error('输出合同不符（测试）'); });
  const text = Array.from({ length: 30 }, (_, i) => (`第${i}段知识与条件。`).repeat(2600)).join('\n\n');
  const failure = await knowledgeStructuredDistillContext.run(
    { evidence: b.store('knowledge-card-distill/user-7/job-a'), resume: b.store('knowledge-card-distill/user-7/resume'), invoke: invoke as any },
    () => invokeDistillLlmPossiblyChunked({ sourceText: text, extraText: '', imageUrls: [], documents: [], modelName: 'glm-5.3-flashx', detailLevel: 'full', minSectionsTotal: 4 })).catch(e => e);
  expect(failure.message).toMatch(/多段连续未通过，已停止后续分段；已完成 0\/\d+ 段/);
  expect(invoke.mock.calls.length).toBeLessThanOrEqual(KNOWLEDGE_DISTILL_BREAKER_CONSECUTIVE + 2 * KNOWLEDGE_CARD_CHUNK_WORKERS_PER_ROUTE - 1);
  expect(invoke.mock.calls.length).toBeLessThan(30);
}, 60_000);

it('EPUB 转出 PDF 的原稿身份：只差 CreationDate/ModDate/ID 时相同，内容不同则不同；16 位十六进制', async () => {
  const { knowledgeCardConvertedPdfKey } = await import('./knowledgeCardDocumentPages');
  const pdf = (date: string, id: string, body: string) => Buffer.from(`%PDF-1.4\n1 0 obj << /CreationDate (D:${date}+00'00') /ModDate (D:${date}+00'00') >> endobj\n2 0 obj << /Length 9 >> stream\n${body}\nendstream\ntrailer << /ID [<${id}> <${id}>] >>\n%%EOF`, 'latin1');
  const a = knowledgeCardConvertedPdfKey(pdf('20261114090408', 'AABBCC', '太史公曰')), b2 = knowledgeCardConvertedPdfKey(pdf('20261115101010', '112233', '太史公曰'));
  expect(a).toBe(b2); expect(a).toMatch(/^[0-9a-f]{16}$/);
  expect(knowledgeCardConvertedPdfKey(pdf('20261114090408', 'AABBCC', '项羽本纪'))).not.toBe(a);
});

it('挑页结果缓存：同一目录页对象再提交零模型调用；有组失败时不落盘', async () => {
  const { knowledgeCardResumablePageSelector, __setKnowledgeCardDistillGatewayInvokerForTest } = await import('./knowledgeCardDistill');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key'); vi.stubEnv('EVOLINK_API_KEY', 'test-key');
  const b = bucket(); let fail = false;
  const hook = vi.fn(async () => { if (fail) throw Error('HTTP 401'); return '{"pages":[{"page":3,"reason":"世系表"}]}'; });
  __setKnowledgeCardDistillGatewayInvokerForTest(hook as any);
  try {
    const sheets = [{ index: 0, pageNumbers: [1, 2, 3], imageUrl: 'https://example.invalid/s0.jpg', gcsUri: 'gs://b/knowledge-card-distill/sheets/u7/e123/s-000.jpg' }];
    const select = () => knowledgeStructuredDistillContext.run({ evidence: b.store('knowledge-card-distill/user-7/job-a'), resume: b.store('knowledge-card-distill/user-7/resume') }, () => knowledgeCardResumablePageSelector('glm-5.3-flashx')(sheets as any, 3));
    const first = await select(); expect(first).toEqual([{ pageNumber: 3, reason: '世系表' }]);
    const calls = hook.mock.calls.length; expect(calls).toBeGreaterThan(0);
    expect(await select()).toEqual(first); expect(hook).toHaveBeenCalledTimes(calls);
    const other = [{ ...sheets[0], gcsUri: 'gs://b/knowledge-card-distill/sheets/u7/e999/s-000.jpg' }];
    fail = true;
    const pick = () => knowledgeStructuredDistillContext.run({ evidence: b.store('knowledge-card-distill/user-7/job-b'), resume: b.store('knowledge-card-distill/user-7/resume') }, () => knowledgeCardResumablePageSelector('glm-5.3-flashx')(other as any, 3));
    expect(await pick()).toEqual([]);
    expect(Array.from(b.data.keys()).filter(k => k.includes('/page-selection/'))).toHaveLength(1);
  } finally { __setKnowledgeCardDistillGatewayInvokerForTest(null); }
}, 60_000);

it('N3 两任务都在跑：A 的某段最终失败后租约标 failed，等待中的 B 接管重做；持有方一直不出成果时 B 等到上限按本段未完成收口、不购买', async () => {
  const b = versionedBucket(); const active = new Set(['job-a', 'job-b']);
  const invokeA = vi.fn(async () => { await new Promise(r => setTimeout(r, 30)); throw Error('各跳均失败（测试）'); });
  const invokeB = vi.fn(async (request: any) => report(request));
  const ctx = (job: string, invoke: any, extra: object = {}) => ({ evidence: b.store(`knowledge-card-distill/user-7/${job}`), resume: b.store('knowledge-card-distill/user-7/resume'), invoke, jobId: job, jobActive: async (id: string) => active.has(id), leaseWaitMs: 5, ...extra });
  const text = '短原文一段。';
  const a = knowledgeStructuredDistillContext.run(ctx('job-a', invokeA), () => invokeKnowledgeStructuredDistill(params(text))).catch(e => e);
  await new Promise(r => setTimeout(r, 5));
  const out = await knowledgeStructuredDistillContext.run(ctx('job-b', invokeB), () => invokeKnowledgeStructuredDistill(params(text)));
  expect((await a).message).toContain('各跳均失败'); expect(active.has('job-a')).toBe(true); // A 仍在跑（其它段），但本段已标 failed
  expect(out).toContain('明确的知识说明'); expect(invokeB).toHaveBeenCalledTimes(1);
  const lease = Array.from(b.data.entries()).find(([k]) => k.endsWith('/attempt.json'))![1];
  expect(lease).toMatchObject({ jobId: 'job-b', previous: 'job-a' });
  // 等待上限：持有方 C 在跑且一直不出成果
  const c = versionedBucket(); const hold = new Promise<never>(() => {});
  const holder = knowledgeStructuredDistillContext.run({ evidence: c.store('u/job-c'), resume: c.store('u/resume'), invoke: (async () => hold) as any, jobId: 'job-c', jobActive: async () => true }, () => invokeKnowledgeStructuredDistill(params('另一段原文。')));
  void holder;
  await new Promise(r => setTimeout(r, 10));
  const invokeD = vi.fn(async (request: any) => report(request));
  await expect(knowledgeStructuredDistillContext.run({ evidence: c.store('u/job-d'), resume: c.store('u/resume'), invoke: invokeD as any, jobId: 'job-d', jobActive: async () => true, leaseWaitMs: 5, leaseWaitMaxMs: 40 },
    () => invokeKnowledgeStructuredDistill(params('另一段原文。')))).rejects.toThrow('等待超时，本段未完成');
  expect(invokeD).not.toHaveBeenCalled();
});

it('M1 自动续做重新认领自己的租约时清掉 failed 标记：另一任务此后只能等待，不会把正在重做的段当成可接管而重复购买', async () => {
  const b = versionedBucket(); const active = new Set(['job-a', 'job-b']);
  const text = '短原文一段。';
  const ctx = (job: string, invoke: any, extra: object = {}) => ({ evidence: b.store(`knowledge-card-distill/user-7/${job}`), resume: b.store('knowledge-card-distill/user-7/resume'), invoke, jobId: job, jobActive: async (id: string) => active.has(id), leaseWaitMs: 5, ...extra });
  // 第一轮：A 的这一段最终失败，租约被标 failed
  const failing = vi.fn(async () => { throw Error('各跳均失败（测试）'); });
  await knowledgeStructuredDistillContext.run(ctx('job-a', failing), () => invokeKnowledgeStructuredDistill(params(text))).catch(() => undefined);
  const leaseKey = Array.from(b.data.keys()).find(k => k.endsWith('/attempt.json'))!;
  expect(b.data.get(leaseKey)).toMatchObject({ jobId: 'job-a', failed: true });
  // 第二轮（同任务号自动续做）：A 重新认领并开始购买，购买在途
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const retrying = vi.fn(async (request: any) => { await gate; return report(request); });
  const a = knowledgeStructuredDistillContext.run(ctx('job-a', retrying), () => invokeKnowledgeStructuredDistill(params(text)));
  await vi.waitFor(() => expect(retrying).toHaveBeenCalledTimes(1));
  expect(b.data.get(leaseKey)).toMatchObject({ jobId: 'job-a', failed: false });
  // B 到达同一段：必须等待 A，不购买
  const invokeB = vi.fn(async (request: any) => report(request));
  const bRun = knowledgeStructuredDistillContext.run(ctx('job-b', invokeB), () => invokeKnowledgeStructuredDistill(params(text)));
  await new Promise(r => setTimeout(r, 40));
  expect(invokeB).not.toHaveBeenCalled();
  release();
  expect(await a).toContain('明确的知识说明');
  expect(await bRun).toContain('明确的知识说明');
  expect(invokeB).not.toHaveBeenCalled();
  expect(retrying).toHaveBeenCalledTimes(1);
});
