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
    load: vi.fn(async () => doc),
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
    count: vi.fn(async () => ({ totalTokens: 500 })),
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
    expect(f.deps.post).toHaveBeenCalledTimes(2);
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
    f.deps.count.mockResolvedValueOnce({ totalTokens: 800001 });
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
 expect(request.systemInstruction.parts[0].text).toContain(level==='full'?'本套为完整版图卡':'本套为精华版图卡');
 await reviewKnowledgePublication(7,f.context,f.deps as any);expect(f.deps.post).toHaveBeenCalledTimes(1);
});
