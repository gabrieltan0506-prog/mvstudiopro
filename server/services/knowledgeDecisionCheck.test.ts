import { describe, expect, it, vi } from "vitest";
import {
  buildKnowledgeDecisionBatch,
  knowledgeDecisionChapters,
  knowledgeDecisionCheckEnabled,
  readKnowledgeDecisionCheck,
  runKnowledgeDecisionCheck,
} from "./knowledgeDecisionCheck";
import type { GeminiDecisionResult } from "./geminiDecisionGateway";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const source = {
  readingContract: "image-primary-v1" as const,
  pages: [
    { id: id(1), headline: "一", body: "图内文字一", imageUrl: "gs://b/1.png", imageJobId: "j1" },
    { id: id(2), headline: "二", body: "纯文字页", imageUrl: "" },
    { id: id(3), headline: "三", body: "图内文字三", imageUrl: "gs://b/3.png", imageJobId: "j3" },
  ],
};
const pages = [
  { id: id(1), headline: "一", body: "说明一，含 42% 的数据" },
  { id: id(2), headline: "二", body: "说明二" },
  { id: id(3), headline: "三", body: "说明三", sources: [{ title: "来源甲", url: "https://example.com/a" }] },
];
const digest = "a".repeat(64);

function store() {
  const files = new Map<string, unknown>();
  return {
    files,
    read: vi.fn(async (name: string) => (files.has(name) ? JSON.parse(JSON.stringify(files.get(name))) : null)),
    save: vi.fn(async (name: string, value: unknown) => { files.set(name, JSON.parse(JSON.stringify(value))); }),
  };
}

describe("knowledgeDecisionCheck 纯函数", () => {
  it("缺省关闭，只有 =1 才开", () => {
    expect(knowledgeDecisionCheckEnabled({})).toBe(false);
    expect(knowledgeDecisionCheckEnabled({ KNOWLEDGE_DECISION_CHECK: "true" })).toBe(false);
    expect(knowledgeDecisionCheckEnabled({ KNOWLEDGE_DECISION_CHECK: "1" })).toBe(true);
  });

  it("只选图主文辅新稿中的带图章；旧稿零章", () => {
    const chapters = knowledgeDecisionChapters(source, pages);
    expect(chapters.map((c) => c.pageId)).toEqual([id(1), id(3)]);
    expect(chapters[0]).toMatchObject({ index: 0, imageText: "图内文字一", prose: "说明一，含 42% 的数据" });
    expect(chapters[1].sources).toEqual(["来源甲 https://example.com/a"]);
    expect(knowledgeDecisionChapters({ pages: source.pages }, pages)).toEqual([]);
  });

  it("一批多章：每章两题、题 id 唯一，input 只含文字", () => {
    const { input, questions } = buildKnowledgeDecisionBatch(knowledgeDecisionChapters(source, pages));
    expect(questions.map((q) => q.id)).toEqual(["c1_restate", "c1_unsourced", "c3_restate", "c3_unsourced"]);
    expect(input).toContain("第3章：三");
    expect(input).toContain("【图内文字】\n图内文字一");
    expect(input).not.toMatch(/base64/);
    for (const q of questions) expect(q.options.length).toBe(3);
  });
});

describe("runKnowledgeDecisionCheck", () => {
  const okDecide = vi.fn(async (params: { questions: { id: string }[]; save: (n: string, v: unknown) => Promise<unknown> }): Promise<GeminiDecisionResult> => {
    await params.save("raw-1", { text: "{}" });
    const answers = Object.fromEntries(params.questions.map((q) => [q.id, {
      choice: q.id.endsWith("restate") ? "restates" : "some", unknownChoice: false, probabilities: null, confidence: 0.6,
    }]));
    return { status: "ok", model: "gemini-decision-1", attempts: 1, elapsedMs: 1, answers, missing: [], totalInputTokens: 100, costUsd: 0.00001 };
  });

  it("关闭时零调用零读写", async () => {
    const s = store();
    const decide = vi.fn();
    expect(await runKnowledgeDecisionCheck({ deps: { ...s, decide: decide as any, env: {} }, root: "r", digest, source, pages })).toBeNull();
    expect(decide).not.toHaveBeenCalled();
    expect(s.read).not.toHaveBeenCalled();
    expect(s.save).not.toHaveBeenCalled();
  });

  it("开启：结果与证据落 decision-check/，同内容重入零调用；不改传入的页", async () => {
    const s = store();
    const before = JSON.stringify(pages);
    okDecide.mockClear();
    const env = { KNOWLEDGE_DECISION_CHECK: "1", KNOWLEDGE_DECISION_CHECK_BATCH: "1" };
    const summary = await runKnowledgeDecisionCheck({ deps: { ...s, decide: okDecide as any, env }, root: "r", digest, source, pages });
    expect(okDecide).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ kind: "knowledge_decision_check_v1", advisory: true, chapterCount: 2 });
    expect(summary!.flagged).toEqual({ restates: [id(1), id(3)], unsourced: [id(1), id(3)] });
    expect(summary!.chapters[0].restate).toEqual({ choice: "restates", confidence: 0.6, probabilities: null });
    expect(Array.from(s.files.keys()).every((k) => k.startsWith("r/decision-check/"))).toBe(true);
    expect(Array.from(s.files.keys()).some((k) => /batch-0\/raw-1\.json$/.test(k))).toBe(true);
    expect(JSON.stringify(pages)).toBe(before);
    expect(await readKnowledgeDecisionCheck(s.read, "r")).toMatchObject({ chapterCount: 2 });

    okDecide.mockClear();
    await runKnowledgeDecisionCheck({ deps: { ...s, decide: okDecide as any, env }, root: "r", digest, source, pages });
    expect(okDecide).not.toHaveBeenCalled();
  });

  it("判定不可用或存储出错：不抛错；不可用批次不写可复用汇总，下次重入再试", async () => {
    const s = store();
    const env = { KNOWLEDGE_DECISION_CHECK: "1" };
    const down = vi.fn(async (): Promise<GeminiDecisionResult> => ({ status: "unavailable", reason: "http_503", attempts: 2, elapsedMs: 1 }));
    const summary = await runKnowledgeDecisionCheck({ deps: { ...s, decide: down as any, env }, root: "r", digest, source, pages });
    expect(summary!.batches[0]).toMatchObject({ status: "unavailable", reason: "http_503" });
    expect(summary!.chapters[0].restate).toBeNull();
    await runKnowledgeDecisionCheck({ deps: { ...s, decide: down as any, env }, root: "r", digest, source, pages });
    expect(down).toHaveBeenCalledTimes(2);

    const broken = { read: async () => { throw new Error("gcs"); }, save: async () => undefined };
    await expect(runKnowledgeDecisionCheck({ deps: { ...broken, decide: down as any, env }, root: "r", digest, source, pages })).resolves.toBeNull();
  });
});
