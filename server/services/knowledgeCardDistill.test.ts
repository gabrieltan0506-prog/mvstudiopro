import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL,
  estimateKnowledgeCardDistillChunks,
  knowledgeCardDistillProfile,
  mergeDistilledMarkdownChunks,
  shouldRunKnowledgeCardDistillAsync,
  splitSourceTextForDistill,
  suggestKnowledgeCardMinSections,
} from "./knowledgeCardDistill";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE_RETIRED,
  KNOWLEDGE_CARD_DISTILL_MODEL_KIMI_RETIRED,
  KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS,
  KNOWLEDGE_CARD_DISTILL_MODEL_GLM,
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR,
  KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
  KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
  KNOWLEDGE_CARD_DISTILL_MODEL_TERRA,
  resolveKnowledgeCardDistillModel,
} from "../../shared/knowledgeCardDistillModels";

describe("knowledgeCardDistill model", () => {
  it("defaults to DeepSeek V4 Flash (0910 拍板：不用 Sol)", () => {
    expect(resolveKnowledgeCardDistillModel(undefined)).toBe(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK);
    expect(KNOWLEDGE_CARD_DISTILL_MODEL).toBe(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK);
  });

  it("only two tiers remain: DeepSeek V4.1 Flash and GLM 5.3 Flash", () => {
    expect(KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS.map((o) => o.id)).toEqual([
      KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
      KNOWLEDGE_CARD_DISTILL_MODEL_GLM,
    ]);
  });

  it("migrates retired Sol / Claude / Kimi tiers to DeepSeek; legacy terra / OR-qwen kept", () => {
    expect(resolveKnowledgeCardDistillModel(KNOWLEDGE_CARD_DISTILL_MODEL_SOL)).toBe(
      KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
    );
    expect(resolveKnowledgeCardDistillModel(KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE_RETIRED)).toBe(
      KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
    );
    expect(resolveKnowledgeCardDistillModel(KNOWLEDGE_CARD_DISTILL_MODEL_KIMI_RETIRED)).toBe(
      KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
    );
    expect(resolveKnowledgeCardDistillModel(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN)).toBe(
      KNOWLEDGE_CARD_DISTILL_MODEL_GLM,
    );
    expect(resolveKnowledgeCardDistillModel(KNOWLEDGE_CARD_DISTILL_MODEL_TERRA)).toBe(
      KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
    );
    expect(resolveKnowledgeCardDistillModel(KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR)).toBe(
      KNOWLEDGE_CARD_DISTILL_MODEL_GLM,
    );
  });

  it("falls back on unknown id to DeepSeek", () => {
    expect(resolveKnowledgeCardDistillModel("not-a-model")).toBe(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK);
  });
});

describe("suggestKnowledgeCardMinSections", () => {
  it("scales with source length so a book is not crushed to 1 section", () => {
    expect(suggestKnowledgeCardMinSections(100)).toBeLessThanOrEqual(2);
    expect(suggestKnowledgeCardMinSections(3000)).toBeGreaterThanOrEqual(4);
    expect(suggestKnowledgeCardMinSections(50_000)).toBeGreaterThanOrEqual(15);
  });

  // 用户 2026-08-05：提炼是取重点让人快速读懂，不是把 9.5 万字摊成几十页
  it("stays readable for a long book instead of growing linearly", () => {
    expect(suggestKnowledgeCardMinSections(10_000)).toBeLessThanOrEqual(12);
    // 9.5 万字：旧式线性会要 68 节；用户选定约 28 节（并页后约 5 张卡）
    const book = suggestKnowledgeCardMinSections(95_000);
    expect(book).toBeGreaterThanOrEqual(24);
    expect(book).toBeLessThanOrEqual(30);
    // 字数再翻几倍也只多几节，且封顶 36
    expect(suggestKnowledgeCardMinSections(300_000)).toBeLessThanOrEqual(36);
  });

  it("grows monotonically", () => {
    const lengths = [1_000, 5_000, 20_000, 60_000, 150_000];
    for (let i = 1; i < lengths.length; i += 1) {
      expect(suggestKnowledgeCardMinSections(lengths[i]!)).toBeGreaterThanOrEqual(
        suggestKnowledgeCardMinSections(lengths[i - 1]!),
      );
    }
  });
});

describe("splitSourceTextForDistill", () => {
  it("keeps short text as one chunk", () => {
    expect(splitSourceTextForDistill("短文")).toEqual(["短文"]);
  });

  it("splits long text into multiple chunks", () => {
    const body = "段落要点。\n\n".repeat(4000);
    const chunks = splitSourceTextForDistill(body, 10_000);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("per-model distill profiles", () => {
  it("两档各有自己的切段与思考档；便宜档写得更满", () => {
    const deepseek = knowledgeCardDistillProfile(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK);
    const glm = knowledgeCardDistillProfile(KNOWLEDGE_CARD_DISTILL_MODEL_GLM);

    // 两档都是 100 万上下文：段大、并发高；GLM 便宜档节内条数更宽
    expect(glm.chunkChars).toBe(deepseek.chunkChars);
    expect(glm.concurrency).toBe(deepseek.concurrency);
    expect(glm.bulletsPerSection.max).toBeGreaterThan(deepseek.bulletsPerSection.max);

    // 0910 用户令：思考一律 high（GLM 5.3 恒开思考，档位只有 low/high/max 生效）
    expect(deepseek.effortChunk).toBe("high");
    expect(deepseek.effortFinal).toBe("high");
    expect(glm.effortChunk).toBe("high");
    expect(glm.effortFinal).toBe("high");

    for (const p of [deepseek, glm]) {
      expect(p.chunkRetries).toBeGreaterThanOrEqual(1);
      expect(p.requestTimeoutMs).toBeGreaterThanOrEqual(60_000);
    }
  });

  it("routes only long books to the background job", () => {
    expect(shouldRunKnowledgeCardDistillAsync(5_000)).toBe(false);
    expect(shouldRunKnowledgeCardDistillAsync(25_000)).toBe(false);
    expect(shouldRunKnowledgeCardDistillAsync(95_000)).toBe(true);
  });

  it("estimates chunk count per model", () => {
    expect(estimateKnowledgeCardDistillChunks(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK, 3_000)).toBe(1);
    const deepseekChunks = estimateKnowledgeCardDistillChunks(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK, 95_000);
    const glmChunks = estimateKnowledgeCardDistillChunks(KNOWLEDGE_CARD_DISTILL_MODEL_GLM, 95_000);
    expect(glmChunks).toBe(deepseekChunks);
  });
});

describe("mergeDistilledMarkdownChunks", () => {
  it("keeps first title and concatenates section bodies", () => {
    const merged = mergeDistilledMarkdownChunks([
      "# 总题\n\n## A\n- 1",
      "# 总题\n\n## B\n- 2",
      "## C\n- 3",
    ]);
    expect(merged.startsWith("# 总题")).toBe(true);
    expect(merged).toContain("## A");
    expect(merged).toContain("## B");
    expect(merged).toContain("## C");
    expect(merged.match(/^# /gm)?.length).toBe(1);
  });
});

describe("长书单段失败不拖垮整本（0910）", () => {
  it("失败段是结构化记录不是正文（审查 P1：占位文字不得算成功）；致命错误照旧整本抛", async () => {
    const { distillOneChunkOrSkip } = await import("./knowledgeCardDistill");
    const notices: string[] = [];
    const out = await distillOneChunkOrSkip(n => notices.push(n), 120, 11, "第12章", async () => {
      throw new Error("模型返回格式异常：Unexpected token <");
    });
    expect(out.ok).toBe(false);
    expect(out).toMatchObject({ ok: false, whereZh: "第 12/120 段（第12章）" });
    expect(JSON.stringify(out)).not.toContain("未能提炼");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("第 12/120 段（第12章）提炼失败已跳过");
    // 空稿也算失败，不许当成功正文
    const empty = await distillOneChunkOrSkip(n => notices.push(n), 3, 0, "x", async () => "   ");
    expect(empty.ok).toBe(false);
    expect(notices).toHaveLength(2);
    await expect(
      distillOneChunkOrSkip(n => notices.push(n), 120, 0, "x", async () => {
        throw new Error("额度不足");
      }),
    ).rejects.toThrow("额度不足");
    expect(notices).toHaveLength(2);
    expect(await distillOneChunkOrSkip(undefined, 3, 0, "x", async () => "## 正常")).toEqual({ ok: true, markdown: "## 正常" });
  });
});
