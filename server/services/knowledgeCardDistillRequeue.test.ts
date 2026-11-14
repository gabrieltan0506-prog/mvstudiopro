import { afterEach, expect, it, vi } from 'vitest';

const pages = vi.hoisted(() => ({ calls: 0, sheets: [] as any[] }));
vi.mock('./gcs.js', async (original) => ({ ...(await original() as object), signGsUriV4ReadUrl: () => 'https://example.invalid/upload.pdf' }));
vi.mock('./knowledgeCardDocumentPages.js', async (original) => ({
  ...(await original() as object),
  // 逐页备料（转换/抽字/挑页/渲染）计次：续做时应直接复用缓存，不再进入这里。
  prepareKnowledgeCardDocumentPages: vi.fn(async (params: any) => {
    pages.calls += 1;
    await params.selectPages(pages.sheets, 8);
    return { docKey: 'e0123456789abcde', fileName: params.fileName, pageCount: 8, selectedPages: [],
      pages: Array.from({ length: 8 }, (_, i) => ({ pageNumber: i + 1, text: `${'甲乙丙丁戊己庚辛'[i]}页知识与条件。`.repeat(1300) })) };
  }),
}));

import { knowledgeStructuredDistillContext } from './knowledgeCardStructuredDistill';
import { prepareKnowledgeCardCopy, __setKnowledgeCardDistillGatewayInvokerForTest } from './knowledgeCardDistill';
import { knowledgeDistillRequeuePlan } from './knowledgeDistillDiagnostics';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const reading = (text: string) => ({ version: 1, subtitle: '', accent: 'jade', blocks: [{ type: 'prose', title: '要点', note: '', text }] });
const report = (request: any) => {
  const input = JSON.parse(request.contents[0].parts[0].text);
  return { status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ kind: 'knowledge_publication_v1', sourceDigest: input.sourceDigest, title: '原文提炼', pages: input.source.pages.map((page: any) => ({ ...page, role: undefined, imageUrl: undefined, body: '知识说明。'.repeat(200), reading: reading('知识说明。'.repeat(200)), imageDescription: '', imageStatus: 'absent', facts: [{ term: '主题', statement: '知识说明。' }], cautions: [] })) }) }] } }] }) };
};

it('同一任务自动续做（第二次执行）：已完成段零模型调用，不再转换/挑页，只补未完成段；续做文案带未完成段数', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key'); vi.stubEnv('EVOLINK_API_KEY', 'test-key');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('%PDF-1.4 测试原稿'), { status: 200 })));
  const data = new Map<string, any>();
  const store = (prefix: string) => ({ prefix, read: async (k: string) => data.get(k) ?? null, save: async (k: string, v: any) => { data.set(k, structuredClone(v)); } });
  let failOnce = true;
  const invoke = vi.fn(async (request: any) => {
    const body = JSON.parse(request.contents[0].parts[0].text).source.pages.map((p: any) => p.body).join('');
    if (failOnce && body.includes('丙页')) throw Error('各跳均失败（测试）');
    return report(request);
  });
  const run = () => knowledgeStructuredDistillContext.run({ evidence: store('knowledge-card-distill/user-7/kc_job'), resume: store('knowledge-card-distill/user-7/resume'), jobId: 'kc_job', invoke: invoke as any }, () => prepareKnowledgeCardCopy({
    publicationEvidence: store('knowledge-card-distill/user-7/kc_job'), publicationResumeEvidence: store('knowledge-card-distill/user-7/resume'),
    files: [{ gcsUri: 'gs://b/uploads/u7/x.pdf', mimeType: 'application/pdf', fileName: '史记.pdf' }], userId: 7, forceDistill: true,
    distillModel: 'glm-5.3-flashx', detailLevel: 'full',
  }));
  const failure = await run().catch(e => e);
  const firstCalls = invoke.mock.calls.length;
  expect(pages.calls).toBe(1); expect(firstCalls).toBeGreaterThan(1);
  const plan = knowledgeDistillRequeuePlan(failure);
  expect(plan?.notice).toMatch(/^上次有 1 段未完成，正在自动续做，已完成的不重做$/);
  failOnce = false;
  const second = await run();
  expect(second.distilledMarkdown).toContain('知识说明。');
  expect(pages.calls).toBe(1); // 没有再转换/抽字/挑页
  expect(invoke).toHaveBeenCalledTimes(firstCalls + 1); // 只补那 1 段
  expect(second.extractionMethods.some((m: string) => m.endsWith(':document_pages_resumed'))).toBe(true);
}, 60_000);

it('不得自动续做：熔断、内容安全、确定性失败；可续做：部分段未完成', () => {
  const wrap = (cause: unknown) => new Error('读档整理未完成：…', { cause });
  expect(knowledgeDistillRequeuePlan(wrap(Object.assign(new Error('多段连续未通过'), { knowledgeDistillNoRequeue: 'breaker:consecutive=5' })))).toBeNull();
  expect(knowledgeDistillRequeuePlan(wrap(Object.assign(new Error('x'), { knowledgeDistillNoRequeue: 'breaker:both_channels_down' })))).toBeNull();
  expect(knowledgeDistillRequeuePlan(wrap(Object.assign(new Error('内容安全'), { code: 'sse_content_safety' })))).toBeNull();
  expect(knowledgeDistillRequeuePlan(new Error('未能从文件读出任何内容'))).toBeNull();
  expect(knowledgeDistillRequeuePlan(new Error('提炼原稿身份变化，禁止覆盖旧结果'))).toBeNull();
  expect(knowledgeDistillRequeuePlan(wrap(Object.assign(new Error('已完成 160/164 段'), { knowledgeDistillIncomplete: { completed: 160, total: 164 } })))?.notice)
    .toBe('上次有 4 段未完成，正在自动续做，已完成的不重做');
});

it('N2 挑页有一组失败：逐页备料不写缓存，本次失败不自动续做；同任务再执行时重新准备，不复用残缺结果', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key'); vi.stubEnv('EVOLINK_API_KEY', 'test-key');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('%PDF-1.4 另一份原稿'), { status: 200 })));
  pages.calls = 0; pages.sheets = [{ index: 0, pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8], imageUrl: 'https://example.invalid/s.jpg', gcsUri: 'gs://b/knowledge-card-distill/sheets/u7/e0123456789abcde/s-000.jpg' }];
  __setKnowledgeCardDistillGatewayInvokerForTest(async () => { throw Error('HTTP 401'); }); // 挑页组失败（确定性错误，不退避）
  try {
    const data = new Map<string, any>();
    const store = (prefix: string) => ({ prefix, read: async (k: string) => data.get(k) ?? null, save: async (k: string, v: any) => { data.set(k, structuredClone(v)); } });
    let failOnce = true;
    const invoke = vi.fn(async (request: any) => {
      const body = JSON.parse(request.contents[0].parts[0].text).source.pages.map((p: any) => p.body).join('');
      if (failOnce && body.includes('丙页')) throw Error('各跳均失败（测试）');
      return report(request);
    });
    const run = () => knowledgeStructuredDistillContext.run({ evidence: store('knowledge-card-distill/user-7/kc_job2'), resume: store('knowledge-card-distill/user-7/resume'), jobId: 'kc_job2', invoke: invoke as any }, () => prepareKnowledgeCardCopy({
      publicationEvidence: store('knowledge-card-distill/user-7/kc_job2'), publicationResumeEvidence: store('knowledge-card-distill/user-7/resume'),
      files: [{ gcsUri: 'gs://b/uploads/u7/y.pdf', mimeType: 'application/pdf', fileName: '史记.pdf' }], userId: 7, forceDistill: true,
      distillModel: 'glm-5.3-flashx', detailLevel: 'full',
    }));
    const failure = await run().catch(e => e);
    expect(pages.calls).toBe(1);
    expect(Array.from(data.keys()).some(k => k.includes('/documents/'))).toBe(false);
    expect(knowledgeDistillRequeuePlan(failure)).toBeNull();
    failOnce = false;
    await run();
    expect(pages.calls).toBe(2); // 重新准备，不复用残缺挑页
  } finally { __setKnowledgeCardDistillGatewayInvokerForTest(null); pages.sheets = []; }
}, 60_000);
