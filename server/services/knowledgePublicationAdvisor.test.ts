import { describe, it, expect, vi } from "vitest";
import { layoutFromSource } from "../../shared/editableLayout";
import {
  reviewKnowledgePublication,
  knowledgeSourceDigest,
  validateKnowledgeImageReceipts,
  KNOWLEDGE_VISUAL_ADVISOR_MODEL,
} from "./knowledgePublicationAdvisor";
const make = () => {
  const doc = layoutFromSource({
    kind: "knowledge-publication",
    owner: "7",
    sourceId: "x",
    title: "河流知识",
    body: "河流注入海洋",
    images: { 1: "https://storage.googleapis.com/test/own.png" },
  });
  doc.publication!.source.pages[0].imageUrl = "gs://test/own.png";
  const source = doc.publication!.source,
    digest = knowledgeSourceDigest(source),
    sha = "a".repeat(64);
  const report = {
    kind: "knowledge_publication_v1",
    sourceDigest: digest,
    title: source.title,
    pages: source.pages.map(p => ({
      id: p.id,
      headline: p.headline,
      body: "河流汇集地表径流，通常流向地势较低的区域。",
      imageDescription: "图中蓝色水道流入海洋",
      imageStatus: "consistent",
      facts: [{ term: "河流", statement: "河流流向地势较低区域" }],
      cautions: [],
    })),
  };
  const storage = new Map<string, any>();
  const envelope = (value: any, image = true) => ({
    status: 200,
    text: JSON.stringify({
      modelVersion: KNOWLEDGE_VISUAL_ADVISOR_MODEL,
      usageMetadata: {
        promptTokensDetails: image
          ? [{ modality: "IMAGE", tokenCount: 100 }]
          : [],
      },
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(value) }] },
        },
      ],
    }),
  });
  const deps = {
    load: vi.fn(async () => ({ ...doc, publication: doc.publication! })),
    image: vi.fn(async () => ({
      buffer: Buffer.from("test"),
      sha256: sha,
      mimeType: "image/png",
      width: 100,
      height: 100,
    })),
    read: vi.fn(async (name: string) => storage.get(name) || null),
    save: vi.fn(async (name: string, value: any) => {
      storage.set(name, structuredClone(value));
    }),
    count: vi.fn(async () => ({ totalTokens: 500, method: "test-estimate" })),
    post: vi.fn(async () => envelope(report)),
  };
  const context = { documentId: doc.id, batchIndex: 0, attempt: 0 };
  return { doc, source, digest, sha, report, storage, deps, context, envelope };
};
describe("知识卡实际图像输入与回执恢复", () => {
  it("发送真实GCS图，先保存raw，重放不再调用模型，整套结果覆盖原页", async () => {
    const f = make();
    await reviewKnowledgePublication(7, f.context, f.deps as any);
    const request = f.deps.post.mock.calls[0] as unknown as [any];
    expect(
      request[0].contents[0].parts.some(
        (p: any) => p.fileData?.fileUri === "gs://test/own.png"
      )
    ).toBe(true);
    expect(
      Array.from(f.storage.keys()).some(k => k.endsWith("raw-0.json"))
    ).toBe(true);
    expect(request[0].generationConfig.responseMimeType).toBe("application/json");
    expect(request[0].systemInstruction.parts[0].text).toContain("已标注疑点，等待全册整理后统一联网核实。");
    await reviewKnowledgePublication(7, f.context, f.deps as any);
    expect(f.deps.post).toHaveBeenCalledTimes(1);
    f.deps.post.mockImplementationOnce(async () =>
      f.envelope({ sourceDigest: f.digest, findings: [] }, false)
    );
    const result = await reviewKnowledgePublication(
      7,
      { ...f.context, batchIndex: 1 },
      f.deps as any
    );
    expect(result).toMatchObject({ pages: [{ id: f.source.pages[0].id }] });
    await reviewKnowledgePublication(
      7,
      { ...f.context, batchIndex: 1 },
      f.deps as any
    );
    expect(f.deps.post).toHaveBeenCalledTimes(1);
  });
  it("无读图token或错误模型不得冒充图文完成，失败raw仍永久保留", async () => {
    const f = make();
    f.deps.post.mockImplementationOnce(async () => f.envelope(f.report, false));
    await expect(
      reviewKnowledgePublication(7, f.context, f.deps as any)
    ).rejects.toThrow("图片读取回执");
    expect(
      Array.from(f.storage.keys()).some(k => k.endsWith("raw-0.json"))
    ).toBe(true);
    await expect(
      reviewKnowledgePublication(7, f.context, f.deps as any)
    ).rejects.toThrow("图片读取回执");
    expect(f.deps.post).toHaveBeenCalledTimes(1);
  });
  it("未完成全部页批不能执行全书核对；预检超量不提交生成", async () => {
    const f = make();
    await expect(
      reviewKnowledgePublication(
        7,
        { ...f.context, batchIndex: 1 },
        f.deps as any
      )
    ).rejects.toThrow("尚未完成");
    expect(f.deps.post).not.toHaveBeenCalled();
    f.deps.count.mockResolvedValueOnce({ totalTokens: 800001, method: "test-estimate" });
    await expect(
      reviewKnowledgePublication(7, f.context, f.deps as any)
    ).rejects.toThrow("超过");
    expect(f.deps.post).not.toHaveBeenCalled();
  });
  it("配图回执不能漏图、增加异图或混入不同版本", () => {
    const f = make();
    expect(() => validateKnowledgeImageReceipts(f.source, [])).toThrow("覆盖");
    expect(() =>
      validateKnowledgeImageReceipts(f.source, [
        { uri: "gs://test/own.png", sha256: f.sha },
        { uri: "gs://test/own.png", sha256: "b".repeat(64) },
      ])
    ).toThrow("版本");
  });
});

it.each(['concise','full'] as const)('真实分批构造保留%s档位，回放不重发，档位进入源摘要',async level=>{
 const f=make();f.source.detailLevel=level;const digest=knowledgeSourceDigest(f.source);
 expect(digest).not.toBe(f.digest);f.report.sourceDigest=digest;
 await reviewKnowledgePublication(7,f.context,f.deps as any);
 const request=(f.deps.post.mock.calls[0] as unknown as [any])[0];
 const payload=request.contents[0].parts.map((p:any)=>p.text).filter(Boolean).map((t:string)=>{try{return JSON.parse(t)}catch{return null}}).find((p:any)=>p?.source);
 expect(payload.source.detailLevel).toBe(level);
 expect(request.systemInstruction.parts[0].text).toContain(level==='full'?'主要与次要重点均先去重、浓缩':'次要重点以文字、表格保留');
 await reviewKnowledgePublication(7,f.context,f.deps as any);expect(f.deps.post).toHaveBeenCalledTimes(1);
});

it('并发批次把权威云稿分配的通道传给真实路由，原请求恢复不改通道',async()=>{
 const f=make();f.doc.publication!.parallel={channels:{0:'evolink'},completed:[]};
 await reviewKnowledgePublication(7,f.context,f.deps);
 expect((f.deps.post.mock.calls[0] as any)[0].executionChannel).toBe('evolink');
 await reviewKnowledgePublication(7,f.context,f.deps);expect(f.deps.post).toHaveBeenCalledTimes(1);
});
it('旧请求加入并发调度后仍复用原永久请求，不改变已提交模型输入',async()=>{
 const f=make();f.deps.post.mockRejectedValueOnce(Error('原通道回执待恢复'));
 await expect(reviewKnowledgePublication(7,f.context,f.deps)).rejects.toThrow('待恢复');
 f.doc.publication!.parallel={channels:{0:'evolink'},completed:[]};
 await reviewKnowledgePublication(7,f.context,f.deps);
 expect((f.deps.post.mock.calls[1] as any)[0].executionChannel).toBeUndefined();
 expect((f.deps.post.mock.calls[1] as any)[0]).toEqual((f.deps.post.mock.calls[0] as any)[0]);
});

it('GLM搜索的模型费用随同一批报告持久化，恢复不丢失也不重购',async()=>{
 const f=make();const research={status:'succeeded',model:'glm-5.3-flashx',gateway:'glm-evolink',usage:{prompt_tokens:12,server_tool_use_details:{web_search_requests:1}},traces:[]};
 const raw=f.envelope(f.report);const env=JSON.parse(raw.text);env.research=research;raw.text=JSON.stringify(env);f.deps.post.mockResolvedValueOnce(raw);
 await reviewKnowledgePublication(7,f.context,f.deps as any);
 const reports=Array.from(f.storage.entries()).filter(([key])=>key.endsWith('/report.json'));
 expect(reports).toHaveLength(1);expect(reports[0][1].research).toEqual(research);
 await reviewKnowledgePublication(7,f.context,f.deps as any);expect(f.deps.post).toHaveBeenCalledTimes(1);
});

it('最终Markdown核实后修订正文和事实索引，原稿保留且恢复不重新购买',async()=>{
 const f=make();
 f.report.pages[0].body='已确认的水循环知识。未经证实的矛盾主张。';
 f.report.pages[0].facts=[{term:'水循环',statement:f.report.pages[0].body}];
 (f.report.pages[0].cautions as any[]).push({kind:'uncertain',evidence:'原句「未经证实的矛盾主张」；问题：前后说法不一',message:'已标注疑点，等待全册整理后统一联网核实。'});
 const original=JSON.stringify(f.source);
 await reviewKnowledgePublication(7,f.context,f.deps as any);
 f.deps.post.mockImplementationOnce(async()=>f.envelope({sourceDigest:f.digest,findings:[],verificationMarkdown:'未经证实的矛盾主张没有可靠资料，删除该主张，保留水循环知识。',sources:[]},false));
 f.deps.post.mockImplementationOnce(async()=>f.envelope({...f.report,pages:[{...f.report.pages[0],body:'已确认的水循环知识。',reading:undefined,imageDescription:'',imageStatus:'absent',facts:[{term:'水循环',statement:'已确认的水循环知识。'}]}]},false));
 const result:any=await reviewKnowledgePublication(7,{...f.context,batchIndex:1},f.deps as any);
 expect(result.pages[0].body).toBe('已确认的水循环知识。');
 expect(result.pages[0].facts[0].statement).not.toContain('未经证实');
 expect(JSON.stringify(f.source)).toBe(original);
 const requests=f.deps.post.mock.calls as unknown as [any][];
 expect(requests[1][0]).toMatchObject({researchOnly:true,generationConfig:{responseMimeType:'text/markdown'}});
 expect(requests[2][0].systemInstruction.parts.map((p:any)=>p.text).join('\n')).toContain('查不到公开依据或只有转载/卖书资料');
 expect(requests[2][0].systemInstruction.parts.at(-1).text).toContain('evidenceState=missing');
 expect(Array.from(f.storage.keys()).some(k=>k.endsWith('final-markdown-0/report.json'))).toBe(true);
 await reviewKnowledgePublication(7,{...f.context,batchIndex:1},f.deps as any);
 expect(f.deps.post).toHaveBeenCalledTimes(3);
});

it('旧核对回执的卖书来源不再作为佐证，新修订保留作者独家经验并保存前后稿',async()=>{
 const f=make();
 f.report.pages[0].body='作者独家经验：用小碟预先分好调味料，做菜时不容易手重。';
 f.report.pages[0].facts=[{term:'备菜经验',statement:f.report.pages[0].body}];
 (f.report.pages[0].cautions as any[]).push({kind:'uncertain',evidence:'原句「用小碟预先分好调味料」；问题：适用条件不明确',message:'已标注疑点，等待全册整理后统一联网核实。'});
 await reviewKnowledgePublication(7,f.context,f.deps as any);
 const low={url:'https://mbook.kongfz.com/1/2/',title:'独家经验手册',content:'出版社：测试出版社。加入购物车。'};
 f.deps.post.mockImplementationOnce(async()=>f.envelope({sourceDigest:f.digest,findings:[],verificationMarkdown:'旧记录自称已证实。',sources:[low],evidenceState:'available'},false));
 f.deps.post.mockImplementationOnce(async()=>f.envelope({...f.report,pages:[{...f.report.pages[0],imageDescription:'',imageStatus:'absent'}]},false));
 const result:any=await reviewKnowledgePublication(7,{...f.context,batchIndex:1},f.deps as any);
 expect(result.pages[0].body).toContain('作者独家经验');
 const request=(f.deps.post.mock.calls as unknown as [any][])[2][0];
 expect(request.systemInstruction.parts.map((p:any)=>p.text).join('\n')).toContain('正文统一简短标为“作者独家经验”');
 const verification=JSON.parse(request.contents[0].parts.at(-1).text).finalVerification[0];
 expect(verification.evidenceState).toBe('missing');expect(verification.sources).toEqual([]);
 expect(verification.sourceWarnings.join('')).toContain('原书经验仍按精简保留');
 const saved=Array.from(f.storage.entries()).find(([key])=>key.endsWith('final-markdown-0/report.json'))![1];
 expect(saved.before.body).toBe(f.report.pages[0].body);expect(saved.after.body).toBe(f.report.pages[0].body);
 await reviewKnowledgePublication(7,{...f.context,batchIndex:1},f.deps as any);expect(f.deps.post).toHaveBeenCalledTimes(3);
});
