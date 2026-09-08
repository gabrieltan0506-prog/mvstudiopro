import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setKnowledgeCardDistillGatewayInvokerForTest,
  buildPageAlignedChunks,
  distillGatewayChain,
  makeKnowledgeCardPageSelector,
} from "./knowledgeCardDistill";
import { KNOWLEDGE_CARD_DISTILL_MODEL_QWEN, KNOWLEDGE_CARD_DISTILL_MODEL_SOL } from "../../shared/knowledgeCardDistillModels";
import type { KnowledgeCardDocumentPageSet } from "./knowledgeCardDocumentPages";

afterEach(() => {
  vi.unstubAllEnvs();
  __setKnowledgeCardDistillGatewayInvokerForTest(null);
});

describe("distillGatewayChain（0908：EvoLink 主通道，各档官方兜底）", () => {
  it("Sol: EvoLink → OpenAI 官方；Qwen: 百炼新加坡 token plan → EvoLink（0909 拍板）", () => {
    vi.stubEnv("EVOLINK_API_KEY", "ev-key");
    vi.stubEnv("OPENAI_API_KEY", "sk-official123");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "sg-key");
    expect(distillGatewayChain(KNOWLEDGE_CARD_DISTILL_MODEL_SOL)).toEqual(["evolink", "openai_official"]);
    expect(distillGatewayChain(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN)).toEqual(["dashscope_sg", "evolink"]);
  });

  it("missing keys shrink the chain instead of pointing at an unconfigured channel", () => {
    vi.stubEnv("EVOLINK_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-official123");
    vi.stubEnv("OPENAI_CHAT_API_KEY", "");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "");
    expect(distillGatewayChain(KNOWLEDGE_CARD_DISTILL_MODEL_SOL)).toEqual(["openai_official"]);
    expect(distillGatewayChain(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN)).toEqual([]);
    vi.stubEnv("EVOLINK_API_KEY", "ev-key");
    expect(distillGatewayChain(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN)).toEqual(["evolink"]);
  });
});

describe("目录页扫读挑页（makeKnowledgeCardPageSelector）", () => {
  it("falls over to the official channel when EvoLink fails, keeps only pages present on the sheets", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "ev-key");
    vi.stubEnv("OPENAI_API_KEY", "sk-official123");
    const calls: string[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p) => {
      calls.push(p.gateway);
      if (p.gateway === "evolink") throw new Error("算力紧张，请稍后再试");
      return `选好了：{"pages":[{"page":41,"reason":"分式图解"},{"page":999,"reason":"不存在"},{"page":2}]}`;
    });
    const select = makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_SOL);
    const picked = await select([{ index: 1, pageNumbers: Array.from({ length: 48 }, (_, i) => i + 1), imageUrl: "https://signed/sheet-1.jpg", gcsUri: "gs://b/sheet-1.jpg" }], 48);
    expect(calls).toEqual(["evolink", "openai_official"]);
    expect(picked).toEqual([{ pageNumber: 41, reason: "分式图解" }, { pageNumber: 2, reason: undefined }]);
  });

  it("fatal quota errors do not fall over; triage failure yields no pages instead of breaking distill", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "ev-key");
    vi.stubEnv("OPENAI_API_KEY", "sk-official123");
    const calls: string[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p) => {
      calls.push(p.gateway);
      throw new Error("提炼账户额度不足，请稍后重试或联系管理员");
    });
    const select = makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_SOL);
    const picked = await select([{ index: 1, pageNumbers: [1, 2, 3], imageUrl: "https://signed/sheet-1.jpg", gcsUri: "gs://b/sheet-1.jpg" }], 3);
    expect(calls).toEqual(["evolink"]);
    expect(picked).toEqual([]);
  });
});

describe("buildPageAlignedChunks", () => {
  const doc = (pages: Array<{ n: number; text: string; img?: boolean }>): KnowledgeCardDocumentPageSet => ({
    docKey: "0123456789abcdef",
    fileName: "book.pdf",
    pageCount: pages.length,
    selectedPages: pages.filter((p) => p.img).map((p) => p.n),
    pages: pages.map((p) => ({ pageNumber: p.n, text: p.text, ...(p.img ? { imageUrl: `https://signed/p${p.n}.jpg`, imageGcsUri: `gs://b/p${p.n}` } : {}) })),
  });

  it("keeps a selected page's image in the same chunk as its text; extra text goes last", () => {
    const pages = Array.from({ length: 6 }, (_, i) => ({ n: i + 1, text: `第${i + 1}页正文`.repeat(40), img: i === 1 || i === 4 }));
    const chunks = buildPageAlignedChunks([doc(pages)], "用户补充的一段话", 700);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const withP2 = chunks.find((c) => c.text.includes("第2页正文"));
    expect(withP2?.pageImages.map((p) => p.pageNumber)).toEqual([2]);
    const withP5 = chunks.find((c) => c.text.includes("第5页正文"));
    expect(withP5?.pageImages.map((p) => p.pageNumber)).toEqual([5]);
    expect(chunks[chunks.length - 1]!.label).toBe("补充文字");
    expect(chunks.flatMap((c) => c.pageImages).length).toBe(2);
  });

  it("caps reference page images per chunk so image-heavy books do not build one giant request", () => {
    const pages = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, text: "短", img: true }));
    const chunks = buildPageAlignedChunks([doc(pages)], "", 100_000, 8);
    expect(chunks.length).toBe(4);
    expect(Math.max(...chunks.map((c) => c.pageImages.length))).toBe(8);
    expect(chunks.flatMap((c) => c.pageImages).length).toBe(30);
  });

  it("two page documents are chunked once each (no double distill of the same text)", () => {
    const a = doc(Array.from({ length: 3 }, (_, i) => ({ n: i + 1, text: `A${i}`.repeat(50) })));
    const b = { ...doc(Array.from({ length: 3 }, (_, i) => ({ n: i + 1, text: `B${i}`.repeat(50) }))), docKey: "fedcba9876543210", fileName: "b.pdf" };
    const chunks = buildPageAlignedChunks([a, b], "", 100_000);
    const all = chunks.map((c) => c.text).join("\n");
    expect(all.split("【book.pdf 第 1 页】").length - 1).toBe(1);
    expect(all.split("【b.pdf 第 1 页】").length - 1).toBe(1);
    expect(all.split("【b.pdf 第 3 页】").length - 1).toBe(1);
    expect(chunks.every((c) => c.label !== "补充文字")).toBe(true);
  });
});
