import { describe, expect, it, vi } from "vitest";
import {
  digestNovelTemplates,
  novelTemplateDigestKey,
  shouldDigestNovelTemplates,
  type NovelTemplateDigestStore,
} from "./novelTemplateDigest";

function memoryStore() {
  const objects = new Map<string, string>();
  const store: NovelTemplateDigestStore = {
    read: async name => objects.get(name) ?? null,
    writeIfAbsent: async (name, body) => {
      if (!objects.has(name)) objects.set(name, body);
    },
  };
  return { objects, store };
}

const input = {
  topic: "重生复仇",
  direction: "女主冷静布局",
  requestId: "req-1",
  templates: [
    { publicId: "mt_a", role: "开场钩子", weight: 60 },
    { publicId: "mt_b", role: "反转", weight: 40 },
  ],
};
const sources = [
  { publicId: "mt_a", role: "开场钩子", cardSha256: "sha-a", text: "原文A".repeat(50) },
  { publicId: "mt_b", role: "反转", cardSha256: "sha-b", text: "原文B".repeat(50) },
];
const card = (publicId: string) =>
  JSON.stringify({
    publicId,
    methods: [{ name: "倒叙切入", how: "先写结果再补因", when: "开场" }],
    dialogue: "对白只给半句信息",
    pacing: "每段末留一个疑问",
    avoid: ["不照搬原模板的宫斗设定"],
  });
const promptId = (prompt: string) => (prompt.includes('"publicId":"mt_a"') ? "mt_a" : "mt_b");

describe("digestNovelTemplates", () => {
  it("每个模板各调用一次且并发执行", async () => {
    const { store } = memoryStore();
    let inFlight = 0;
    let maxInFlight = 0;
    const call = vi.fn(async (prompt: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 10));
      inFlight--;
      return { text: card(promptId(prompt)), model: "fake" };
    });
    const out = await digestNovelTemplates({ userId: 7, input, sources, call, store });
    expect(call).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(2);
    expect(out.stats).toEqual({ cached: [], fresh: expect.arrayContaining(["mt_a", "mt_b"]), fallback: [] });
    expect(out.templates).toContain("mt_a / 分工：开场钩子\n手法：\n1. 倒叙切入");
    expect(out.templates).toContain("mt_b / 分工：反转\n");
    expect(out.templates).not.toContain("原文A");
  });

  it("命中缓存零调用", async () => {
    const { store } = memoryStore();
    const call = vi.fn(async (prompt: string) => ({ text: card(promptId(prompt)), model: "fake" }));
    await digestNovelTemplates({ userId: 7, input, sources, call, store });
    call.mockClear();
    const out = await digestNovelTemplates({ userId: 7, input, sources, call, store });
    expect(call).not.toHaveBeenCalled();
    expect(out.stats.cached.sort()).toEqual(["mt_a", "mt_b"]);
  });

  it("缓存键随方向/权重变化，对象路径按用户隔离", async () => {
    const k1 = novelTemplateDigestKey(input, sources[0], 60);
    expect(novelTemplateDigestKey({ ...input, direction: "别的方向" }, sources[0], 60)).not.toBe(k1);
    expect(novelTemplateDigestKey(input, sources[0], 50)).not.toBe(k1);
    const { objects, store } = memoryStore();
    await digestNovelTemplates({
      userId: 7, input, sources, store,
      call: async p => ({ text: card(promptId(p)), model: "fake" }),
    });
    expect(objects.has(`novel-template-digest/user-7/${k1}.json`)).toBe(true);
  });

  it("一个失败只回退那一个", async () => {
    const { store } = memoryStore();
    const call = vi.fn(async (prompt: string) => {
      if (promptId(prompt) === "mt_b") throw new Error("boom");
      return { text: card("mt_a"), model: "fake" };
    });
    const out = await digestNovelTemplates({ userId: 7, input, sources, call, store });
    expect(out.stats).toEqual({ cached: [], fresh: ["mt_a"], fallback: ["mt_b"] });
    expect(out.templates).toContain(`mt_b / 分工：反转\n${sources[1].text}`);
    expect(out.templates).not.toContain("原文A");
  });

  it("非 JSON、methods 为空、超长均回退原文", async () => {
    for (const text of [
      "不是JSON",
      JSON.stringify({ publicId: "mt_a", methods: [] }),
      JSON.stringify({ publicId: "mt_a", methods: [{ name: "长", how: "字".repeat(2000), when: "" }] }),
    ]) {
      const { store } = memoryStore();
      const out = await digestNovelTemplates({
        userId: 7, input: { ...input, templates: [input.templates[0]] }, sources: [sources[0]], store,
        call: async () => ({ text, model: "fake" }),
      });
      expect(out.stats.fallback).toEqual(["mt_a"]);
      expect(out.templates).toBe(`mt_a / 分工：开场钩子\n${sources[0].text}`);
    }
  });

  it("原始与解析证据各存一份，失败也保留，再次提炼只增不覆盖", async () => {
    const { objects, store } = memoryStore();
    let n = 0;
    const one = { ...input, templates: [input.templates[0]] };
    const bad = async () => ({ text: JSON.stringify({ publicId: "mt_a", methods: [] }), model: "fake" });
    await digestNovelTemplates({ userId: 7, input: one, sources: [sources[0]], store, call: bad, now: () => ++n });
    await digestNovelTemplates({ userId: 7, input: one, sources: [sources[0]], store, call: bad, now: () => ++n });
    const key = novelTemplateDigestKey(one, sources[0], 60);
    const names = Array.from(objects.keys());
    const raw = names.filter(k => k.startsWith(`novel-template-digest/user-7/evidence/${key}/raw-`));
    const parsed = names.filter(k => k.startsWith(`novel-template-digest/user-7/evidence/${key}/parsed-`));
    expect(raw).toHaveLength(2);
    expect(parsed).toHaveLength(2);
    expect(JSON.parse(objects.get(raw[0])!).response.text).toContain('"methods":[]');
    expect(JSON.parse(objects.get(parsed[0])!).parsed).toEqual({ publicId: "mt_a", methods: [] });
    expect(objects.has(`novel-template-digest/user-7/${key}.json`)).toBe(false);
  });
});

describe("shouldDigestNovelTemplates", () => {
  it("仅 chapter / script 阶段提炼", () => {
    expect(shouldDigestNovelTemplates("chapter")).toBe(true);
    expect(shouldDigestNovelTemplates("script")).toBe(true);
    expect(shouldDigestNovelTemplates("advice")).toBe(false);
    expect(shouldDigestNovelTemplates("outline")).toBe(false);
  });
});
