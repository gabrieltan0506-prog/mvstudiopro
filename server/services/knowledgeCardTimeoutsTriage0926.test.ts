/**
 * 0926 用户令四项：
 * 1. 带扫描读字图的段单跳超时 6 分钟（纯文字段不变）
 * 2. 挑页用户消息不套提炼外壳（GLM 两家被带偏答成提炼稿）
 * 3. 分组统稿 / 收紧节数 10 分钟；选 GLM 时统稿 GLM 只试一次，失败交 DeepSeek
 * 4. 每跳成功记路由与用时
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setKnowledgeCardDistillGatewayInvokerForTest,
  invokeDistillLlmPossiblyChunked,
  knowledgeCardRefineChain,
  makeKnowledgeCardPageSelector,
  KNOWLEDGE_CARD_OCR_CHUNK_TIMEOUT_MS,
  KNOWLEDGE_CARD_REFINE_TIMEOUT_MS,
} from "./knowledgeCardDistill";
import type { KnowledgeCardDocumentPageSet } from "./knowledgeCardDocumentPages";
import { KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK, KNOWLEDGE_CARD_DISTILL_MODEL_GLM } from "../../shared/knowledgeCardDistillModels";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __setKnowledgeCardDistillGatewayInvokerForTest(null);
});

function keys() {
  vi.stubEnv("OPENROUTER_API_KEY", "o");
  vi.stubEnv("EVOLINK_API_KEY", "e");
  vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "s");
  vi.stubEnv("KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS", "0");
  vi.stubEnv("KNOWLEDGE_CARD_DISTILL_RETRY_BACKOFF_MS", "0");
}

const label = (s: { gateway: string; tier: string }) => `${s.gateway}:${s.tier}`;
const SECTION = (n: number) => `## 第${n}节标题足够长\n\n| 项 | 说明 |\n|---|---|\n| 甲 | 乙丙丁 |\n\n- 要点一条内容足够长\n- 要点二条内容足够长\n- 要点三条内容足够长`;

function mixedDoc(): KnowledgeCardDocumentPageSet {
  // 前 8 页扫描（读字图），后面 1 页有长文字：前后两段一段读图、一段纯文字
  const scanned = Array.from({ length: 8 }, (_, i) => ({ pageNumber: i + 1, text: "", ocrImageUrl: `https://signed/ocr/p${i + 1}.jpg` }));
  return {
    docKey: "0123456789abcdef",
    fileName: "混合书.pdf",
    pageCount: 9,
    selectedPages: [],
    pages: [...scanned, { pageNumber: 9, text: "有文字层的正文。".repeat(200) }],
  };
}

function textDoc(): KnowledgeCardDocumentPageSet {
  // 另一份文档（有文字层）：自成纯文字段
  return { docKey: "fedcba9876543210", fileName: "电子书.pdf", pageCount: 1, selectedPages: [], pages: [{ pageNumber: 1, text: "有文字层的正文。".repeat(200) }] };
}

describe("1. 读图段 6 分钟，纯文字段不变", () => {
  it("读字图段 timeoutMs = 6 分钟；纯文字段不传（走 profile 默认）", async () => {
    keys();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const seen: Array<{ ocr: number; timeoutMs?: number }> = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p) => {
      if (/段（/.test(String(p.chunkLabel || ""))) seen.push({ ocr: p.ocrImages?.length ?? 0, timeoutMs: p.timeoutMs });
      return [1, 2, 3].map(SECTION).join("\n\n");
    });
    await invokeDistillLlmPossiblyChunked({
      sourceText: "", extraText: "", imageUrls: [], documents: [mixedDoc(), textDoc()],
      modelName: KNOWLEDGE_CARD_DISTILL_MODEL_GLM, minSectionsTotal: 6, detailLevel: "full",
    });
    const ocrCall = seen.find((c) => c.ocr > 0)!;
    const textCall = seen.find((c) => c.ocr === 0)!;
    expect(KNOWLEDGE_CARD_OCR_CHUNK_TIMEOUT_MS).toBe(360_000);
    expect(ocrCall.timeoutMs).toBe(360_000);
    expect(textCall.timeoutMs).toBeUndefined();
  });
});

describe("2. 挑页用户消息不套提炼外壳", () => {
  it("选 GLM：用户消息只有挑页原话 + 目录页图，没有「提炼 / 知识卡片 Markdown」字样", async () => {
    keys();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const bodies: Array<Record<string, any>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"pages":[{"page":2,"reason":"表格"}]}' }, finish_reason: "stop" }] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
    const sheets = [{ index: 1, pageNumbers: [1, 2, 3], imageUrl: "https://signed/s1.jpg", gcsUri: "gs://b/s1.jpg" }];
    const picked = await makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_GLM)(sheets as never, 3);
    expect(picked).toEqual([{ pageNumber: 2, reason: "表格" }]);
    const user = bodies[0]!.messages.find((m: any) => m.role === "user").content as Array<any>;
    const text = user.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    expect(text).toMatch(/^全书共 3 页/);
    expect(text).not.toMatch(/提炼|知识卡片 Markdown|## 小节/);
    expect(user.filter((c) => c.type === "image_url").map((c) => c.image_url.url)).toEqual(["https://signed/s1.jpg"]);
    // 系统提示仍是挑页说明
    expect(bodies[0]!.messages.find((m: any) => m.role === "system").content).toMatch(/只输出 JSON/);
  });
});

describe("3. 统稿 10 分钟；GLM 只试一次，失败交 DeepSeek", () => {
  it("统稿链：选 GLM → OR·GLM 一跳后直接 DeepSeek 两家，再千问；选 DeepSeek 链序不变", () => {
    keys();
    expect(knowledgeCardRefineChain(KNOWLEDGE_CARD_DISTILL_MODEL_GLM).map(label)).toEqual([
      "openrouter:glm", "openrouter:deepseek", "evolink:deepseek", "dashscope_sg:qwen", "openrouter:qwen",
    ]);
    expect(knowledgeCardRefineChain(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK).map(label)).toEqual([
      "openrouter:deepseek", "evolink:deepseek", "openrouter:glm", "evolink:glm", "dashscope_sg:qwen", "openrouter:qwen",
    ]);
  });

  it("实际统稿请求：GLM 超时后第二跳就是 DeepSeek，单跳超时 10 分钟", async () => {
    keys();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const refineHops: Array<{ hop: string; timeoutMs?: number }> = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p) => {
      const isRefine = !/段（/.test(String(p.chunkLabel || "")) && Boolean(p.systemOverride);
      if (isRefine) {
        refineHops.push({ hop: `${p.gateway}:${p.tier}`, timeoutMs: p.timeoutMs });
        if (p.tier === "glm") throw new Error("文档较长，提炼超时，请稍后重试");
        return Array.from({ length: 8 }, (_, i) => SECTION(i + 1)).join("\n\n");
      }
      return Array.from({ length: 6 }, (_, i) => SECTION(i + 1)).join("\n\n");
    });
    // 纯文字长稿 → 分段 → 统稿
    await invokeDistillLlmPossiblyChunked({
      sourceText: "正文段落内容。".repeat(12_000), extraText: "", imageUrls: [], documents: [],
      modelName: KNOWLEDGE_CARD_DISTILL_MODEL_GLM, minSectionsTotal: 8, detailLevel: "full",
    });
    expect(refineHops.length).toBeGreaterThanOrEqual(2);
    expect(refineHops[0]!.hop).toBe("openrouter:glm");
    expect(refineHops[1]!.hop).toBe("openrouter:deepseek");
    expect(refineHops.some((h) => h.hop === "evolink:glm")).toBe(false);
    expect(KNOWLEDGE_CARD_REFINE_TIMEOUT_MS).toBe(600_000);
    // group/tighten 用 10 分钟；final 仍用自己的 15 分钟（更长）
    for (const h of refineHops) expect([600_000, 900_000]).toContain(h.timeoutMs);
  });
});

describe("4. 每跳成功记路由与用时", () => {
  it("成功时打一行「成功 OpenRouter(GLM) 用时 Ns · 段名 · 读字图 N」", async () => {
    keys();
    const infos: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...a: unknown[]) => { infos.push(a.map(String).join(" ")); });
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: [1, 2, 3].map(SECTION).join("\n\n") }, finish_reason: "stop" }] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      })));
    await invokeDistillLlmPossiblyChunked({
      sourceText: "", extraText: "", imageUrls: [], documents: [mixedDoc()],
      modelName: KNOWLEDGE_CARD_DISTILL_MODEL_GLM, minSectionsTotal: 6, detailLevel: "full",
    });
    const ok = infos.filter((l) => l.includes("[knowledgeCardDistill] 成功"));
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.some((l) => /成功 (OpenRouter|EvoLink)\(GLM\) 用时 \d+s · 第 \d+\/\d+ 段.* · 读字图 8/.test(l))).toBe(true);
  });
});
