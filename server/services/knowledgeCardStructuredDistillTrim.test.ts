import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { knowledgeStructuredDistillContext, invokeKnowledgeStructuredDistill, KNOWLEDGE_DISTILL_OUTPUT_TRIM_INSTRUCTION } from './knowledgeCardStructuredDistill';
import { invokeKnowledgePublicationRoutes, KNOWLEDGE_PUBLICATION_ROUTE_VERSION } from './knowledgePublicationRoutes';

const reading = { version: 1, subtitle: '', accent: 'jade', blocks: [
  { type: 'table', title: '饮食与活动配合', note: '适用于成人', columns: ['项目', '要点'], rows: [['饮食', '少油少盐'], ['活动', '每周五次快走']] },
  { type: 'prose', title: '原因', note: '', text: '两者配合才能稳定改善指标。' },
] };
/** 旧格式：body 长篇复述 reading、facts 多条；新格式：body 一句话、facts 恰好 1 条。reading 完全相同。 */
const answer = (input: any, format: 'old' | 'new', withTemplate = false) => ({ kind: 'knowledge_publication_v1', sourceDigest: input.sourceDigest, title: '生活习惯', pages: input.source.pages.map((p: any) => ({
  id: p.id, headline: '饮食与活动', imageDescription: '', imageStatus: 'absent', cautions: [], reading: withTemplate ? { ...reading, templateId: 'fusion_ink_mountains', templateReason: '主题适合' } : reading,
  body: format === 'old' ? '## 饮食与活动配合\n\n饮食少油少盐，活动每周五次快走，适用于成人。两者配合才能稳定改善指标。'.repeat(20) : '本段讲饮食与活动配合。',
  facts: format === 'old' ? [{ term: '饮食', statement: '少油少盐' }, { term: '活动', statement: '每周五次快走' }, { term: '配合', statement: '两者配合' }] : [{ term: '配合', statement: '饮食与活动配合' }],
})) });
const inputOf = (request: any) => JSON.parse(request.contents[0].parts[0].text);
function store() {
  const data = new Map<string, any>();
  return { data, at: (prefix: string) => ({ prefix, read: async (k: string) => data.get(k), save: async (k: string, v: any) => { data.set(k, structuredClone(v)); } }) };
}
const params = { sourceText: '饮食少油少盐、每周快走五次的原文说明。', imageUrls: [], modelName: 'glm-5.3-flashx', minSections: 1 };
const routeVia = (fetch: any) => (request: any, scope: any, overrides: any) => invokeKnowledgePublicationRoutes(request, scope, { ...overrides, key: () => 'test-key', fetch });
const modelResponse = (model: string, content: unknown) => new Response(JSON.stringify({ model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

it('B1 新请求带精简说明；已写 request.json 的在途批次沿用旧提示词原文，旧格式已付回执零调用接回', async () => {
  const s = store(); let first: { request: any; prefix: string } | undefined;
  // 1) 旧部署：请求已落盘后进程被杀（invoke 未返回）。
  const crash = vi.fn(async (request: any, scope: any) => { first = { request, prefix: scope.prefix }; throw Object.assign(new Error('进程被杀（注入）'), { code: 'SIGKILL' }); });
  await expect(knowledgeStructuredDistillContext.run({ evidence: s.at('kc/u1/job-a'), invoke: crash as any }, () => invokeKnowledgeStructuredDistill(params))).rejects.toThrow('进程被杀');
  expect(first!.request.systemInstruction.parts[0].text).toContain(KNOWLEDGE_DISTILL_OUTPUT_TRIM_INSTRUCTION);
  expect(first!.request.systemInstruction.parts[0].text).toContain('body:一句话写本段主题');
  // 把落盘请求改成旧提示词（模拟旧部署写下的 request.json），并写一份旧格式的已收回执（已付费）。
  const saved = s.data.get(`${first!.prefix}/request.json`);
  saved.request.systemInstruction.parts[0].text = '旧提示词：pages:[{body:正文,facts:[{term,statement}]}]；body与reading一致。';
  s.data.set(`${first!.prefix}/request.json`, saved);
  const requestDigest = createHash('sha256').update(JSON.stringify([KNOWLEDGE_PUBLICATION_ROUTE_VERSION, saved.request])).digest('hex');
  s.data.set(`${first!.prefix}/route-glm-openrouter.json`, { requestDigest, route: 'glm-openrouter', model: 'z-ai/glm-5.3-flashx', state: 'received',
    response: { status: 200, text: await modelResponse('z-ai/glm-5.3-flashx', answer(inputOf(saved.request), 'old')).text() } });
  // 2) 新部署续做：必须重放旧请求原文（requestDigest 一致），零网络。
  const fetch = vi.fn(async () => { throw new Error('不应发出新购买'); });
  const sent: string[] = [];
  const invoke = vi.fn(async (request: any, scope: any, overrides: any) => { sent.push(request.systemInstruction.parts[0].text); return routeVia(fetch)(request, scope, overrides); });
  const out = await knowledgeStructuredDistillContext.run({ evidence: s.at('kc/u1/job-a'), invoke: invoke as any }, () => invokeKnowledgeStructuredDistill(params));
  expect(fetch).not.toHaveBeenCalled();
  expect(sent).toEqual([saved.request.systemInstruction.parts[0].text]);
  expect(out).toContain('## 饮食与活动配合'); expect(out).toContain('每周五次快走');
});

it('B1 旧格式已完成段：续做根下的旧报告被新任务零模型调用复用', async () => {
  const s = store();
  const old = vi.fn(async (request: any) => ({ status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer(inputOf(request), 'old')) }] } }] }) }));
  const a = await knowledgeStructuredDistillContext.run({ evidence: s.at('kc/u2/job-a'), resume: s.at('kc/u2/resume'), invoke: old as any }, () => invokeKnowledgeStructuredDistill(params));
  expect(old).toHaveBeenCalledTimes(1);
  const report = Array.from(s.data.entries()).find(([k]) => k.startsWith('kc/u2/resume/') && k.endsWith('/report.json'))![1];
  expect(report.report.pages[0].facts).toHaveLength(3);
  const none = vi.fn(async () => { throw new Error('不应调用模型'); });
  const b = await knowledgeStructuredDistillContext.run({ evidence: s.at('kc/u2/job-b'), resume: s.at('kc/u2/resume'), invoke: none as any }, () => invokeKnowledgeStructuredDistill(params));
  expect(none).not.toHaveBeenCalled(); expect(b).toBe(a);
});

it('B1 新旧两种格式经正式路由校验都通过，reading 相同则成稿逐字相同（body/facts 不进入成稿）', async () => {
  const outputs: string[] = [];
  for (const format of ['old', 'new'] as const) {
    const s = store();
    const fetch = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body); const user = body.messages.find((m: any) => m.role === 'user');
      const text = typeof user.content === 'string' ? user.content : user.content.filter((p: any) => p.type === 'text').map((p: any) => p.text)[0];
      return modelResponse(body.model, answer(JSON.parse(text), format, true));
    });
    outputs.push(await knowledgeStructuredDistillContext.run({ evidence: s.at(`kc/u3/${format}`), invoke: routeVia(fetch) as any }, () => invokeKnowledgeStructuredDistill(params)));
    expect(fetch).toHaveBeenCalledTimes(1);
    const accepted = JSON.parse(JSON.parse(Array.from(s.data.entries()).find(([k]) => k.endsWith('/accepted.json'))![1].normalized.text).candidates[0].content.parts[0].text);
    // 路由已用 reading 重写 body：两种格式落盘的 body 相同。
    expect(accepted.pages[0].body).toContain('饮食与活动配合');
    expect(accepted.pages[0].body).not.toContain('本段讲');
  }
  expect(outputs[0]).toBe(outputs[1]);
});
