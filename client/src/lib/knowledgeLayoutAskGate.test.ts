import { beforeEach, describe, expect, it } from "vitest";
import { createKnowledgeLayoutGate, knowledgeLayoutAskVisible, readKnowledgeLayoutChoice, runAfterKnowledgeLayoutDecision, writeKnowledgeLayoutChoice } from "./knowledgeLayoutAskGate";

const flush = () => new Promise(r => setTimeout(r, 0));

describe("图片出完后再问排版闸门", () => {
  beforeEach(() => {
    const map = new Map<string, string>();
    (globalThis as any).localStorage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  });

  it("未选择前审校请求为 0；选「只要图片」后仍为 0", async () => {
    const gate = createKnowledgeLayoutGate();
    let reviewRequests = 0;
    const started = runAfterKnowledgeLayoutDecision(() => gate.wait(), () => { reviewRequests++; });
    await flush(); await flush();
    expect(reviewRequests).toBe(0);
    gate.choose("images_only");
    expect(await started).toBe(false);
    expect(reviewRequests).toBe(0);
    // 第二次选择无效（只认第一次），不会补发
    gate.choose("layout");
    await flush();
    expect(reviewRequests).toBe(0);
  });

  it("选「排版成册」后与原来一致：恰好启动一次原流程", async () => {
    const gate = createKnowledgeLayoutGate();
    let reviewRequests = 0;
    const started = runAfterKnowledgeLayoutDecision(() => gate.wait(), () => { reviewRequests++; });
    await flush();
    expect(reviewRequests).toBe(0);
    gate.choose("layout");
    expect(await started).toBe(true);
    expect(reviewRequests).toBe(1);
  });

  it("无闸（旧路径/手动开始）立即启动，行为不变；面板已离开时不启动", async () => {
    let n = 0;
    expect(await runAfterKnowledgeLayoutDecision(undefined, () => { n++; })).toBe(true);
    expect(n).toBe(1);
    const gate = createKnowledgeLayoutGate("layout");
    expect(await runAfterKnowledgeLayoutDecision(() => gate.wait(), () => { n++; }, () => false)).toBe(false);
    expect(n).toBe(1);
  });

  it("刷新后：图片已齐、未开始整理、未记录选择 → 仍询问；已选只要图片 → 不再弹", () => {
    const base = { cardsOnly: false, reviewStarted: false, rendering: false, inflight: 0, images: ["a", "b"] };
    expect(readKnowledgeLayoutChoice("doc1")).toBeNull();
    expect(knowledgeLayoutAskVisible({ ...base, choice: readKnowledgeLayoutChoice("doc1") })).toBe(true);
    writeKnowledgeLayoutChoice("doc1", "images_only");
    expect(knowledgeLayoutAskVisible({ ...base, choice: readKnowledgeLayoutChoice("doc1") })).toBe(false);
    expect(readKnowledgeLayoutChoice("doc2")).toBeNull();
  });

  it("图片未齐/有失败空页/在途/出图中/只出卡片/已开始整理时不问", () => {
    const base = { cardsOnly: false, reviewStarted: false, rendering: false, inflight: 0, images: ["a", "b"], choice: null };
    expect(knowledgeLayoutAskVisible({ ...base, images: ["a", ""] })).toBe(false);
    expect(knowledgeLayoutAskVisible({ ...base, images: [] })).toBe(false);
    expect(knowledgeLayoutAskVisible({ ...base, inflight: 1 })).toBe(false);
    expect(knowledgeLayoutAskVisible({ ...base, rendering: true })).toBe(false);
    expect(knowledgeLayoutAskVisible({ ...base, cardsOnly: true })).toBe(false);
    expect(knowledgeLayoutAskVisible({ ...base, reviewStarted: true })).toBe(false);
  });
});
