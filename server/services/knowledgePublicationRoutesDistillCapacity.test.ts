import { describe, it, expect, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import {
  invokeKnowledgePublicationRoutes, knowledgeDistillPageBodyCapacity, knowledgeReasoningEffort, knowledgeChannelReasoningEffort,
  knowledgeRouteReasonCategory, KNOWLEDGE_PAGE_BODY_CAPACITY, KNOWLEDGE_DISTILL_PAGE_BODY_MAX, KNOWLEDGE_PUBLICATION_ROUTE_VERSION, type KnowledgeModelRequest,
} from './knowledgePublicationRoutes';
import { KnowledgeJsonSyntaxError } from './knowledgeModelJson';

const GLM_OR = 'z-ai/glm-5.3-flashx', GLM_EVO = 'glm-5.3-flashx';
/** 读档（distill-v1）单页：输入 inputChars 字，回答 reading 渲染约 outputChars 字。 */
function distill(inputChars: number, outputChars: (url: string) => number, options: { distill?: boolean } = {}) {
  const id = randomUUID(), sourceDigest = 'b'.repeat(64), storage = new Map<string, any>();
  const source = { title: '原文件知识提炼', pages: [{ id, headline: '原稿分段1', body: '原'.repeat(inputChars), imageUrl: '', role: 'reading' }] };
  const request: KnowledgeModelRequest = {
    executionChannel: 'openrouter', executionFamily: 'glm', ...(options.distill === false ? {} : { readingNormalization: 'distill-v1' as const }),
    systemInstruction: { parts: [{ text: '测试指令' }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify({ sourceDigest, source }) }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 32768, responseMimeType: 'application/json' },
  };
  const answer = (chars: number) => ({ kind: 'knowledge_publication_v1', sourceDigest, title: '主题', pages: [{ id, headline: '主题', body: '一句话主题。', imageDescription: '', imageStatus: 'absent',
    facts: [{ term: '要点', statement: '一条。' }], cautions: [],
    // 多个 prose 块：每块 text ≤ 合同单块上限，渲染后总长约 chars。
    reading: { version: 1, subtitle: '', accent: 'jade', blocks: Array.from({ length: Math.max(1, Math.ceil(chars / 4000)) }, (_, i) => ({ type: 'prose', title: `小节${i + 1}`, note: '', text: '知'.repeat(Math.min(4000, chars - i * 4000)) })) } }] });
  const bodies: any[] = [];
  const fetch = vi.fn(async (url: string, init: any) => {
    const body = JSON.parse(init.body); bodies.push(body);
    return new Response(JSON.stringify({ model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer(outputChars(url))) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const evidence = { prefix: 'cap/0', read: async (k: string) => storage.get(k) ?? null, save: async (k: string, v: unknown) => { storage.set(k, structuredClone(v)); } };
  const logs: string[] = [];
  const deps = { key: () => 'test-key', sign: () => 'https://example.invalid/x.png', thumbnail: async () => null, sleep: async () => {}, now: () => Date.now(), lateReceiptWaitMs: 0, fetch: fetch as any, log: (l: string) => { logs.push(l); } };
  return { request, evidence, deps, storage, fetch, bodies, logs };
}

describe('B5 读档单页容量：合法长稿收下，失控稿仍拒收并换路', () => {
  it('容量函数：从不比原 12000 更严，按输入两倍放宽，封顶合同 50000', () => {
    expect(knowledgeDistillPageBodyCapacity(0)).toBe(KNOWLEDGE_PAGE_BODY_CAPACITY);
    expect(knowledgeDistillPageBodyCapacity(3000)).toBe(12000);
    expect(knowledgeDistillPageBodyCapacity(24000)).toBe(48000);
    expect(knowledgeDistillPageBodyCapacity(40000)).toBe(KNOWLEDGE_DISTILL_PAGE_BODY_MAX);
  });
  it('24000 字输入、约 16000 字的合法压实稿：一次收下（原规则会判写坏并逐跳重买）', async () => {
    const f = distill(24000, () => 16000);
    const out = JSON.parse((await invokeKnowledgePublicationRoutes(f.request, f.evidence, f.deps)).text);
    expect(out.gateway).toBe('glm-openrouter');
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(out.candidates[0].content.parts[0].text).pages[0].body.length).toBeGreaterThan(12000);
  });
  it('失控超长（超过输入两倍）仍算写坏：回执记 reasonCategory=body_over_capacity，同跳修复一次后切到另一通道', async () => {
    // OpenRouter 两次都写出 60000 字（> 2×24000），EvoLink 正常。
    const f = distill(24000, url => url.includes('openrouter') ? 60000 : 16000);
    const out = JSON.parse((await invokeKnowledgePublicationRoutes(f.request, f.evidence, f.deps)).text);
    expect(out.gateway).toBe('glm-evolink');
    expect(f.fetch).toHaveBeenCalledTimes(3);
    for (const key of ['cap/0/route-glm-openrouter.json', 'cap/0/route-glm-openrouter-retry-1.json']) {
      const receipt = f.storage.get(key);
      expect(receipt.state).toBe('failed');
      expect(receipt.reasonCategory).toBe('body_over_capacity');
      expect(receipt.reason).toContain('超出容量');
    }
    expect(f.logs.some(l => l.includes('category=body_over_capacity') && l.includes('next=switch_hop'))).toBe(true);
    // 恢复：已收成功回执零调用重放。
    f.fetch.mockClear(); await invokeKnowledgePublicationRoutes(f.request, f.evidence, f.deps); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('非读档请求（审校等）保持原 12000 上限不变', async () => {
    const f = distill(24000, url => url.includes('openrouter') ? 13000 : 11000, { distill: false });
    const out = JSON.parse((await invokeKnowledgePublicationRoutes(f.request, f.evidence, f.deps)).text);
    expect(out.gateway).toBe('glm-evolink');
    expect(f.storage.get('cap/0/route-glm-openrouter.json').reasonCategory).toBe('body_over_capacity');
  });
  it('原因类别：HTTP、版本、截断、语法、合同各归其类', () => {
    expect(knowledgeRouteReasonCategory(new Error('HTTP 429'), { status: 429, text: '' })).toBe('http_rate_limited');
    expect(knowledgeRouteReasonCategory(new Error('HTTP 503'), { status: 503, text: '' })).toBe('http_transient');
    expect(knowledgeRouteReasonCategory(new Error('HTTP 400'), { status: 400, text: '' })).toBe('http_rejected');
    const ok = { status: 200, text: '' };
    expect(knowledgeRouteReasonCategory(new Error('实际模型版本不符，原回包已保留，未采用'), ok)).toBe('model_mismatch');
    expect(knowledgeRouteReasonCategory(new Error('本批输出超过模型单次输出容量'), ok)).toBe('output_limit');
    expect(knowledgeRouteReasonCategory(new Error('模型输出未完整结束（finish_reason=x）'), ok)).toBe('incomplete');
    expect(knowledgeRouteReasonCategory(new KnowledgeJsonSyntaxError('x'), ok)).toBe('json_syntax');
    expect(knowledgeRouteReasonCategory(Object.assign(new Error('bad'), { name: 'ZodError' }), ok)).toBe('contract_schema');
    expect(knowledgeRouteReasonCategory(new Error('模型没有输出自动表格图文结构'), ok)).toBe('missing_reading');
    expect(knowledgeRouteReasonCategory(new Error('其他'), ok)).toBe('contract_other');
  });
});

describe('B4 思考档位按请求类型传入，不进入回执身份', () => {
  it('缺省：全部 high（1120 站长定）；env 只认 low/medium/high', () => {
    expect(knowledgeReasoningEffort('distill', { KNOWLEDGE_CAUTION_BINDING_REASONING_EFFORT: 'low' })).toBe('high');
    expect(knowledgeReasoningEffort('caution_binding', {})).toBe('high');
    expect(knowledgeReasoningEffort('page_triage', {})).toBe('high');
    expect(knowledgeReasoningEffort('caution_binding', { KNOWLEDGE_CAUTION_BINDING_REASONING_EFFORT: 'LOW' })).toBe('low');
    expect(knowledgeReasoningEffort('page_triage', { KNOWLEDGE_PAGE_TRIAGE_REASONING_EFFORT: 'xhigh' })).toBe('high');
    expect(knowledgeChannelReasoningEffort('openrouter', 'medium')).toBe('medium');
    expect(knowledgeChannelReasoningEffort('evolink', 'medium')).toBe('high');
    expect(knowledgeChannelReasoningEffort('evolink', 'low')).toBe('low');
  });
  it('缺省 high 与原硬编码一致；改档后同一请求的旧回执仍零调用复用（requestDigest 不含档位）', async () => {
    const f = distill(1000, url => url.includes('openrouter') ? 60000 : 500);
    await invokeKnowledgePublicationRoutes(f.request, f.evidence, f.deps);
    expect(f.bodies[0].reasoning).toEqual({ effort: 'high' });
    expect(f.bodies[2].reasoning_effort).toBe('high');
    const digests = new Set(Array.from(f.storage.entries()).filter(([k]) => /route-.*\.json$/.test(k)).map(([, v]) => v.requestDigest));
    expect(digests.size).toBe(1);
    f.fetch.mockClear();
    await invokeKnowledgePublicationRoutes(f.request, f.evidence, { ...f.deps, reasoningEffort: 'medium' });
    expect(f.fetch).not.toHaveBeenCalled();
    const expected = createHash('sha256').update(JSON.stringify([KNOWLEDGE_PUBLICATION_ROUTE_VERSION, f.request])).digest('hex');
    expect(Array.from(digests)[0]).toBe(expected);
    const g = distill(1000, () => 500);
    await invokeKnowledgePublicationRoutes(g.request, g.evidence, { ...g.deps, reasoningEffort: 'medium' });
    expect(g.bodies[0].reasoning).toEqual({ effort: 'medium' });
    expect(g.storage.get('cap/0/route-glm-openrouter.json').requestDigest).toBe(createHash('sha256').update(JSON.stringify([KNOWLEDGE_PUBLICATION_ROUTE_VERSION, g.request])).digest('hex'));
  });
});
