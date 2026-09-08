import { describe, expect, it } from "vitest";
import { archiveKnowledgeCardGeneration, knowledgeCardGenerationError, knowledgeCardDraftError, parseKnowledgeCardMaterialSaved, knowledgeCardRemainingPages, splitKnowledgeCardMaterial, createKnowledgeCardMaterialBatches, editKnowledgeCardMaterialBatch } from "./knowledgeCardMaterialBatches";

describe("知识卡原文无损分框", () => {
  it.each([49_999, 50_000, 50_001, 100_001])("%i字符每框不超过5万且拼接还原", (n) => {
    const text = "文".repeat(n);
    const parts = splitKnowledgeCardMaterial(text);
    expect(parts.join("")).toBe(text);
    expect(parts.every(p => p.length <= 50_000)).toBe(true);
    expect(parts.length).toBe(Math.ceil(n / 50_000));
  });
  it("保留段落、空白、代理对和句末标点", () => {
    const text = "甲".repeat(39_998) + "\r\n" + "乙".repeat(49_999) + "😀。\n \t" + "丙".repeat(30_000);
    const parts = splitKnowledgeCardMaterial(text);
    expect(parts.join("")).toBe(text);
    expect(parts[0].endsWith("\n")).toBe(true);
    expect(parts.every(p => p.length <= 50_000 && !/[\uD800-\uDBFF]$/.test(p) && !/^[\uDC00-\uDFFF]/.test(p))).toBe(true);
  });
  it("编辑超长继续拆且保留旧稿、图片和其他框", () => {
    const batches = createKnowledgeCardMaterialBatches("甲".repeat(60_000));
    batches[0].draft = "原稿";
    batches[0].images = [{ url: "https://example.com/saved.png", pageIndex: 1 }];
    const next = editKnowledgeCardMaterialBatch(batches, batches[0].id, "新".repeat(100_001));
    expect(next).toHaveLength(4);
    expect(next[0].draft).toBe("原稿");
    expect(next[0].images).toEqual(batches[0].images);
    expect(next.at(-1)).toBe(batches[1]);
    expect(next.slice(0, 3).map(p => p.source).join("")).toBe("新".repeat(100_001));
  });
});


describe("已完成页恢复", () => {
  it("相同稿只补剩余页，编辑稿或改档后不误用旧成功页", () => {
    const batch = createKnowledgeCardMaterialBatches("材料")[0];
    batch.draft = "稿件甲";
    batch.generation = { draft: "稿件甲", model: "gpt-5.6-sol", pageTotal: 4, completed: [1, 2] };
    expect(knowledgeCardRemainingPages(batch, "gpt-5.6-sol", 4)).toEqual([3, 4]);
    expect(knowledgeCardRemainingPages(batch, "qwen3.8-max", 4)).toEqual([1, 2, 3, 4]);
    batch.draft = "稿件乙";
    expect(knowledgeCardRemainingPages(batch, "gpt-5.6-sol", 4)).toEqual([1, 2, 3, 4]);
  });
});


describe("本地草稿和任务恢复边界", () => {
  const valid = () => ({ version: 1, batches: [{ id: "one", source: "原文", draft: "稿件", draftModel: "gpt-5.6-sol", images: [{ url: "https://example.com/card.png", pageIndex: 1 }], generation: { draft: "稿件", model: "gpt-5.6-sol", pageTotal: 2, completed: [1] }, pending: { kind: "image", model: "gpt-5.6-sol", pageIndex: 2, jobId: "existing-job" } }] });
  it("恢复已知任务、完整稿件和已付费页，不丢记录", () => {
    const saved = valid();
    expect(parseKnowledgeCardMaterialSaved(JSON.stringify(saved))).toEqual(saved);
  });
  it.each([
    { images: [null] }, { images: [{ url: "javascript:alert(1)", pageIndex: 1 }] },
    { pending: { kind: "image", model: "gpt-5.6-sol", pageIndex: 3, jobId: "job" } },
    { pending: { kind: "image", model: "gpt-5.6-sol", pageIndex: 1 } },
    { pending: { kind: "image", model: "qwen3.8-max", pageIndex: 2 } },
    { generation: { draft: "稿件", model: "gpt-5.6-sol", pageTotal: 2, completed: null } },
    { generation: { draft: "稿件", model: "gpt-5.6-sol", pageTotal: 2, completed: [2] } },
    { error: {} }, { draftModel: "claude-opus-5" }, { source: "字".repeat(50_001) },
  ])("畸形记录整体拒绝且不悄悄开放重发", (bad) => {
    const saved = valid();
    Object.assign(saved.batches[0], bad);
    expect(() => parseKnowledgeCardMaterialSaved(JSON.stringify(saved))).toThrow();
  });
  it("拒绝重复框身份", () => {
    const saved = valid(); saved.batches.push(saved.batches[0]);
    expect(() => parseKnowledgeCardMaterialSaved(JSON.stringify(saved))).toThrow();
  });
  it("未知提交无job可以恢复但继续保留pending", () => {
    const saved = valid(); delete (saved.batches[0].pending as { jobId?: string }).jobId;
    expect(parseKnowledgeCardMaterialSaved(JSON.stringify(saved)).batches[0].pending?.jobId).toBeUndefined();
  });
  it("5万字符可生成，超长提炼稿保留内容但给出阻断错误", () => {
    expect(knowledgeCardDraftError("字".repeat(50_000))).toBeUndefined();
    expect(knowledgeCardDraftError("字".repeat(50_001))).toContain("超过50,000");
    const saved = valid(); saved.batches[0].draft = "字".repeat(50_001);
    expect(parseKnowledgeCardMaterialSaved(JSON.stringify(saved)).batches[0].draft.length).toBe(50_001);
  });
});


it("同稿同模型页数变化阻止续购，新稿不误触历史门禁", () => {
  const batch = createKnowledgeCardMaterialBatches("原文")[0];
  batch.draft = "稿甲";
  batch.generation = { draft: "稿甲", model: "gpt-5.6-sol", pageTotal: 2, completed: [] };
  expect(knowledgeCardGenerationError(batch, "gpt-5.6-sol", 4)).toContain("已停止生成");
  expect(knowledgeCardGenerationError(batch, "gpt-5.6-sol", 2)).toBeUndefined();
  batch.draft = "稿乙";
  expect(knowledgeCardGenerationError(batch, "gpt-5.6-sol", 4)).toBeUndefined();
});


it("改主体位置不跳过旧位置成功页，旧无位置记录按左侧恢复", () => {
  const batch = createKnowledgeCardMaterialBatches("原文")[0];
  batch.draft = "稿甲";
  batch.generation = { draft: "稿甲", model: "gpt-5.6-sol", pageTotal: 2, completed: [1] };
  expect(knowledgeCardRemainingPages(batch, "gpt-5.6-sol", 2)).toEqual([2]);
  batch.subjectPosition = "center";
  expect(knowledgeCardRemainingPages(batch, "gpt-5.6-sol", 2)).toEqual([1, 2]);
});


it("center首次分框和编辑新增框均继承主体位置", () => {
  const first = createKnowledgeCardMaterialBatches("字".repeat(50001), "center");
  expect(first.map(b => b.subjectPosition)).toEqual(["center", "center"]);
  expect(editKnowledgeCardMaterialBatch(first, first[0].id, "新".repeat(50001)).map(b => b.subjectPosition)).toEqual(["center", "center", "center"]);
});
it("左中往返保留原左完成记录，旧存储仍可读取", () => {
  const batch = createKnowledgeCardMaterialBatches("原文")[0]; batch.draft = "稿甲";
  batch.images = [{ url: "https://example.com/a.png", pageIndex: 1 }];
  batch.generation = { draft: "稿甲", model: "gpt-5.6-sol", pageTotal: 2, completed: [1] };
  batch.generationHistory = archiveKnowledgeCardGeneration(batch);
  batch.subjectPosition = "center";
  batch.generation = { draft: "稿甲", model: "gpt-5.6-sol", subjectPosition: "center", pageTotal: 2, completed: [1] };
  batch.images.push({ url: "https://example.com/center.png", pageIndex: 1, subjectPosition: "center" });
  batch.subjectPosition = "left";
  const restored = parseKnowledgeCardMaterialSaved(JSON.stringify({ version: 1, batches: [batch] })).batches[0];
  expect(knowledgeCardRemainingPages(restored, "gpt-5.6-sol", 2)).toEqual([2]);
  expect(() => parseKnowledgeCardMaterialSaved(JSON.stringify({ version: 1, batches: [{ ...batch, generationHistory: [null] }] }))).toThrow();
});

it.each(["generation", "generationHistory"] as const)("%s不能用左侧图片证明居中页面已完成", (slot) => {
  const batch = createKnowledgeCardMaterialBatches("原文", "center")[0];
  batch.draft = "稿甲";
  batch.images = [{ url: "https://example.com/left.png", pageIndex: 1 }];
  const centered = { draft: "稿甲", model: "gpt-5.6-sol" as const, subjectPosition: "center" as const, pageTotal: 2, completed: [1] };
  if (slot === "generation") batch.generation = centered;
  else batch.generationHistory = [centered];
  const read = () => parseKnowledgeCardMaterialSaved(JSON.stringify({ version: 1, batches: [batch] }));
  expect(read).toThrow();
  batch.images.push({ url: "https://example.com/center.png", pageIndex: 1, subjectPosition: "center" });
  expect(knowledgeCardRemainingPages(read().batches[0], "gpt-5.6-sol", 2)).toEqual([2]);
});
