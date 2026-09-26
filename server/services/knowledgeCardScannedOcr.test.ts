/**
 * 0926 热修：扫描版 PDF（没有文字层）读档。
 * 用户令：页图直接进分段提炼读字（每次 8 页、不另收费）；特色参考页照旧、与读字图严格分开；
 * 没有参考页时模型自己出表格；广告/版权/空白/无关单页跳过；判断顺序修正。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  isKnowledgeCardScannedPage,
  knowledgeCardOcrPageObjectName,
  knowledgeCardPageObjectName,
  prepareKnowledgeCardDocumentPages,
  type KnowledgeCardDocumentPageSet,
} from "./knowledgeCardDocumentPages";
import { renderHtmlToPdf } from "./knowledgeCardEpubToPdf";
import {
  buildPageAlignedChunks,
  invokeDistillLlmPossiblyChunked,
  prepareKnowledgeCardCopy,
} from "./knowledgeCardDistill";
import { KNOWLEDGE_CARD_DISTILL_MODEL_GLM } from "../../shared/knowledgeCardDistillModels";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DOC = "0123456789abcdef";

function scannedDoc(pages: number, refPages: number[] = []): KnowledgeCardDocumentPageSet {
  return {
    docKey: DOC,
    fileName: "扫描书.pdf",
    pageCount: pages,
    selectedPages: refPages,
    pages: Array.from({ length: pages }, (_, i) => {
      const n = i + 1;
      return refPages.includes(n)
        ? { pageNumber: n, text: "", imageUrl: `https://signed/ref/p${n}.jpg`, reason: "表格" }
        : { pageNumber: n, text: "", ocrImageUrl: `https://signed/ocr/p${n}.jpg` };
    }),
  };
}

describe("扫描页检测与分目录存放", () => {
  it("没有文字层才算扫描页；读字图与参考页图不同目录", () => {
    expect(isKnowledgeCardScannedPage({ text: "" })).toBe(true);
    expect(isKnowledgeCardScannedPage({ text: " \n\t " })).toBe(true);
    expect(isKnowledgeCardScannedPage({ text: "第一章" })).toBe(false);
    expect(knowledgeCardOcrPageObjectName(7, DOC, 3)).toContain("/ocr/");
    expect(knowledgeCardOcrPageObjectName(7, DOC, 3)).not.toBe(knowledgeCardPageObjectName(7, DOC, 3));
  });

  it("真 PDF：文字页不渲染；未被选中的扫描页渲染成读字图；被选中的扫描页只当参考页", async () => {
    const img = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 230, g: 230, b: 230 } } }).png().toBuffer();
    const dataUri = `data:image/png;base64,${img.toString("base64")}`;
    const page = (inner: string) => `<div style="page-break-after:always">${inner}</div>`;
    const pdf = await renderHtmlToPdf(
      `<html><body>${page("<h1>有文字层的第一页</h1>")}${page(`<img src="${dataUri}" style="width:500px">`)}${page(`<img src="${dataUri}" style="width:500px">`)}</body></html>`,
    );
    const uploaded: string[] = [];
    const set = await prepareKnowledgeCardDocumentPages({
      buffer: pdf,
      fileName: "扫描书.pdf",
      userId: 42,
      selectPages: async () => [{ pageNumber: 3, reason: "表格" }],
      uploadPage: async (objectName) => {
        uploaded.push(objectName);
        return { gcsUri: `gs://b/${objectName}`, url: `https://signed/${objectName}` };
      },
    });
    const byNo = new Map(set.pages.map((p) => [p.pageNumber, p]));
    expect(byNo.get(1)!.text).toContain("有文字层");
    expect(byNo.get(1)!.ocrImageUrl).toBeUndefined();
    expect(byNo.get(1)!.imageUrl).toBeUndefined();
    // 第 2 页：扫描页、未选中 → 只有读字图，在 ocr/ 目录
    expect(byNo.get(2)!.ocrImageUrl).toContain("/ocr/p-002.jpg");
    expect(byNo.get(2)!.imageUrl).toBeUndefined();
    // 第 3 页：扫描页、被选为参考页 → 只有参考页图，不重复渲染读字图
    expect(byNo.get(3)!.imageUrl).toContain("/p-003.jpg");
    expect(byNo.get(3)!.imageUrl).not.toContain("/ocr/");
    expect(byNo.get(3)!.ocrImageUrl).toBeUndefined();
    expect(uploaded.filter((o) => o.includes("/ocr/"))).toEqual([knowledgeCardOcrPageObjectName(42, set.docKey, 2)]);
  }, 60_000);
});

describe("分段：读字图每次最多 8 张、与参考页分开", () => {
  it("20 页扫描 + 1 页参考：每段图合计 ≤ 8；读字图不进 pageImages", () => {
    const chunks = buildPageAlignedChunks([scannedDoc(20, [5])], "", 24_000, 8);
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.pageImages.length + c.ocrImages.length).toBeLessThanOrEqual(8);
    const allRef = chunks.flatMap((c) => c.pageImages.map((p) => p.pageNumber));
    const allOcr = chunks.flatMap((c) => c.ocrImages.map((p) => p.pageNumber));
    expect(allRef).toEqual([5]);
    expect(allOcr).toHaveLength(19);
    expect(allOcr).not.toContain(5);
  });
});

describe("请求内容：读字说明、跳过无关页、不给扫描页打标记、没有参考页时出表格", () => {
  it("整本扫描、没有参考页：走分段，每段带读字图与说明，系统提示含表格规则", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubEnv("EVOLINK_API_KEY", "e");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s");
    // 统稿对假回包判「过短」会换家重试：测试里不真等 30 秒
    vi.stubEnv("KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS", "0");
    vi.stubEnv("KNOWLEDGE_CARD_DISTILL_RETRY_BACKOFF_MS", "0");
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bodies: Array<Record<string, any>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      bodies.push(body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "## 一节标题\n\n| 项 | 说明 |\n|---|---|\n| 甲 | 乙丙丁 |\n\n- 要点一条内容\n- 要点二条内容" }, finish_reason: "stop" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    await invokeDistillLlmPossiblyChunked({
      sourceText: "",
      extraText: "",
      imageUrls: [],
      documents: [scannedDoc(10)],
      modelName: KNOWLEDGE_CARD_DISTILL_MODEL_GLM,
      minSectionsTotal: 6,
      detailLevel: "concise",
    });
    const chunkBodies = bodies.filter((b) => JSON.stringify(b.messages).includes("扫描页"));
    // 10 页扫描 → 8 + 2 两段（不走短文单发，不把整本塞进一个请求）
    expect(chunkBodies).toHaveLength(2);
    const first = chunkBodies[0]!;
    const user = first.messages.find((m: any) => m.role === "user").content as Array<any>;
    const images = user.filter((c) => c.type === "image_url").map((c) => c.image_url.url);
    expect(images).toHaveLength(8);
    expect(images.every((u: string) => u.includes("/ocr/"))).toBe(true);
    const userText = user.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    expect(userText).toMatch(/广告页、版权页/);
    expect(userText).toMatch(/空白页/);
    expect(userText).toMatch(/不要\*\*为它们写〔参考原页〕标记/);
    const system = first.messages.find((m: any) => m.role === "system").content as string;
    expect(system).toMatch(/没有原稿参考页时自己出表格/);
  });

  it("有参考页的段：系统提示给标记规则，不给「自己出表格」那条", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubEnv("EVOLINK_API_KEY", "e");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s");
    // 统稿对假回包判「过短」会换家重试：测试里不真等 30 秒
    vi.stubEnv("KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS", "0");
    vi.stubEnv("KNOWLEDGE_CARD_DISTILL_RETRY_BACKOFF_MS", "0");
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const systems: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      systems.push(String(body.messages?.find((m: any) => m.role === "system")?.content || ""));
      return new Response(JSON.stringify({ choices: [{ message: { content: "## 一节标题\n\n- 要点一条内容足够\n- 要点二条内容足够" }, finish_reason: "stop" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
    await invokeDistillLlmPossiblyChunked({
      sourceText: "",
      extraText: "",
      imageUrls: [],
      documents: [scannedDoc(4, [2])],
      modelName: KNOWLEDGE_CARD_DISTILL_MODEL_GLM,
      minSectionsTotal: 4,
      detailLevel: "concise",
    });
    const chunkSystem = systems.find((s) => s.includes("参考原页标记"))!;
    expect(chunkSystem).toBeTruthy();
    expect(chunkSystem).not.toMatch(/没有原稿参考页时自己出表格/);
  });
});

describe("prepare：扫描版不再被判「没内容」；判断顺序修正", () => {
  it("正文 0 字但有扫描页：照常进提炼，不报「请先输入」", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubEnv("EVOLINK_API_KEY", "e");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s");
    // 统稿对假回包判「过短」会换家重试：测试里不真等 30 秒
    vi.stubEnv("KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS", "0");
    vi.stubEnv("KNOWLEDGE_CARD_DISTILL_RETRY_BACKOFF_MS", "0");
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "# 总标题\n\n## 一节标题\n\n- 要点一条内容足够\n- 要点二条内容足够" }, finish_reason: "stop" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })));
    const out = await prepareKnowledgeCardCopy({
      forceDistill: true,
      distillModel: KNOWLEDGE_CARD_DISTILL_MODEL_GLM,
      userId: 7,
      extracted: { documentText: "", nonPageDocumentText: "", imageUrls: [], methods: [], documents: [scannedDoc(3)] },
    });
    expect(out.skippedDistill).toBe(false);
    expect(out.distilledMarkdown).toContain("## 一节标题");
  });

  it("有上传但什么都读不出：说是文件读不出来，不叫用户「请先上传」", async () => {
    await expect(prepareKnowledgeCardCopy({
      forceDistill: true,
      files: [{ gcsUri: "gs://b/x.pdf", mimeType: "application/pdf", fileName: "x.pdf" }],
      extracted: { documentText: "", nonPageDocumentText: "", imageUrls: [], methods: [], documents: [] },
    })).rejects.toThrow(/未能从文件读出任何内容/);
  });

  it("没上传也没文字：才报「请先输入文案或上传文件/图片」", async () => {
    await expect(prepareKnowledgeCardCopy({
      forceDistill: true,
      extracted: { documentText: "", nonPageDocumentText: "", imageUrls: [], methods: [], documents: [] },
    })).rejects.toThrow("请先输入文案或上传文件/图片");
  });
});
