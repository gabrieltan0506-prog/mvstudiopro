import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { knowledgeStructuredDistillContext, invokeKnowledgeStructuredDistill } from './knowledgeCardStructuredDistill';
import { KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION, KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION_V2 } from './knowledgeVerificationPolicy';
import { KNOWLEDGE_EDITION_INSTRUCTIONS } from './knowledgeCardEditionPreparation';

const reading = { version: 1, subtitle: '', accent: 'jade', blocks: [{ type: 'prose', title: '要点', note: '', text: '知识说明。' }] };
function bucket() {
  const data = new Map<string, any>();
  return { data, store: (prefix: string) => ({ prefix, read: async (k: string) => data.get(k) ?? null, save: async (k: string, v: any) => { data.set(k, structuredClone(v)); } }) };
}
const reply = (request: any) => {
  const input = JSON.parse(request.contents[0].parts[0].text);
  return { status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ kind: 'knowledge_publication_v1', sourceDigest: input.sourceDigest, title: '提炼', pages: input.source.pages.map((p: any) => ({ id: p.id, headline: '主题', body: '一句话。', reading, imageDescription: '', imageStatus: 'absent', facts: [{ term: '主题', statement: '说明。' }], cautions: [] })) }) }] } }] }) };
};
const params = { sourceText: '资治通鉴原文一段。', imageUrls: [], modelName: 'glm-5.3-flashx', minSections: 1 };
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sys = (r: any) => r.systemInstruction.parts[0].text as string;

it('原常量逐字不变（两档选节仍拼入原文）', () => {
  expect(hash(KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION)).toBe('2da385081c660b80d619eaebcb682aa1b2a9c847c4ff4838fd6dac83a0a0104e');
  expect(KNOWLEDGE_EDITION_INSTRUCTIONS).toContain(KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION);
  expect(KNOWLEDGE_EDITION_INSTRUCTIONS).not.toContain(KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION_V2);
});

it('新任务用 v2：模板无示例疑点、含三类限定与每段 2 条；身份带版本，判定落盘', async () => {
  const b = bucket(); const invoke = vi.fn(async (r: any) => reply(r));
  await knowledgeStructuredDistillContext.run({ evidence: b.store('kc/job-new'), invoke: invoke as any }, () => invokeKnowledgeStructuredDistill(params));
  const text = sys(invoke.mock.calls[0][0]);
  expect(text).toContain('cautions:[]');
  expect(text).not.toContain('cautions:[{kind:"uncertain",evidence:具体原句及问题');
  expect(text).toContain(KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION_V2);
  expect(text).not.toContain(KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION);
  expect(text).toMatch(/绝大多数段落没有疑点/); expect(text).toMatch(/每段最多保留最重要的2条/); expect(text).toMatch(/不因药名、数字或健康话题本身强制搜索/);
  expect(b.data.get('kc/job-new/distill-prompt-version.json').version).toBe('v2');
});

it('部署前在途任务续做：沿用 v1 目录与已存请求体逐字回放；未开工的分段也随整单用 v1', async () => {
  const b = bucket(); const invoke = vi.fn(async (r: any) => reply(r));
  // 模拟旧版：已建 v1 目录、已存 request.json 但未收回包（无判定记录）。
  const v1Identity = { text: params.sourceText, uploaded: [], references: [], model: params.modelName, level: undefined, chunk: '', stage: '', contract: 'knowledge-publication-json-distill-v1' };
  const digest = hash(v1Identity), root = `kc/job-old/json-${digest}`;
  const oldRequest = { executionChannel: 'openrouter', executionFamily: 'glm', readingNormalization: 'distill-v1', systemInstruction: { parts: [{ text: '旧版提示词原文' }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify({ sourceDigest: digest, source: { title: '原文件知识提炼', pages: [{ id: 'x', headline: '原稿分段1', body: params.sourceText, imageUrl: '', role: 'reading' }] } }) }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 1, responseMimeType: 'application/json' } };
  b.data.set(`${root}/input.json`, { marker: 'v1' });
  b.data.set(`${root}/batch-0/request.json`, { digest, request: oldRequest });
  const ctx = { evidence: b.store('kc/job-old'), invoke: invoke as any };
  // input.json 不与新计划相同时原代码会报「原稿身份变化」：这里只验证选用的是 v1 根目录与旧请求体。
  await knowledgeStructuredDistillContext.run(ctx, () => invokeKnowledgeStructuredDistill(params)).catch(() => {});
  expect(b.data.get('kc/job-old/distill-prompt-version.json').version).toBe('v1');
  expect(invoke).not.toHaveBeenCalled();
  b.data.delete(`${root}/input.json`); b.data.delete(`${root}/batch-0/request.json`);
  // 同一任务里的另一段（无旧目录）：按任务判定 v1，模板仍是旧版含示例疑点。
  await knowledgeStructuredDistillContext.run({ ...ctx }, () => invokeKnowledgeStructuredDistill({ ...params, sourceText: '另一段原文。' }));
  const text = sys(invoke.mock.calls[0][0]);
  expect(text).toContain(KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION); expect(text).toContain('cautions:[{kind:"uncertain",evidence:具体原句及问题');
});

it('旧版目录已存请求体时整段按原请求回放（请求体逐字不变）', async () => {
  const b = bucket(); const invoke = vi.fn(async (r: any) => reply(r));
  const ctx = () => ({ evidence: b.store('kc/job-r'), invoke: invoke as any });
  b.data.set('kc/job-r/distill-prompt-version.json', { version: 'v1' });
  await knowledgeStructuredDistillContext.run(ctx(), () => invokeKnowledgeStructuredDistill(params));
  const key = Array.from(b.data.keys()).find(k => k.endsWith('/batch-0/request.json'))!;
  const stored = structuredClone(b.data.get(key));
  b.data.delete(key.replace('request.json', 'raw.json')); b.data.delete(key.replace('request.json', 'report.json'));
  b.data.set('kc/job-r/distill-prompt-version.json', { version: 'v2' });
  await knowledgeStructuredDistillContext.run(ctx(), () => invokeKnowledgeStructuredDistill(params));
  expect(invoke.mock.calls[1][0]).toEqual(stored.request);
  expect(b.data.get(key)).toEqual(stored);
});
