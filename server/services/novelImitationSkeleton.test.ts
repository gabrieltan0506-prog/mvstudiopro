import { describe, expect, it, vi } from "vitest";
vi.mock("./manhuaNovelAdaptationRun", () => ({ callNovelStage: vi.fn() }));
import {
  NOVEL_IMITATION_SHARD_CHARS,
  NOVEL_IMITATION_SHARD_CONCURRENCY,
  novelImitationSkeletonSchema,
} from "../../shared/novelImitation";
import {
  NovelImitationSkeletonError,
  buildNovelImitationMergePrompt,
  buildNovelImitationShardPrompt,
  resolveNovelImitationSkeleton,
  splitNovelImitationShards,
  type NovelImitationSkeletonStats,
} from "./novelImitationSkeleton";
import type { NovelTemplateDigestStore } from "./novelTemplateDigest";

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

const chapter = (n: number, chars: number) => `第${n}章 标题${n}\n${"林凡走进青云宗。".repeat(Math.ceil(chars / 8)).slice(0, chars)}\n\n`;
const book = (chapters: number, chars = 9000) => Array.from({ length: chapters }, (_, i) => chapter(i + 1, chars)).join("");

const beat = (name: string, fn = "钩子") => ({ index: 9, name, function: fn, position: "第1章", roles: ["主角"], summary: `${name}的功能描述` });
const shardReply = (prompt: string) => {
  const m = prompt.match(/第(\d+)片（共(\d+)片）/)!;
  return JSON.stringify({ beats: [beat(`片${m[1]}拍A`), beat(`片${m[1]}拍B`, "爽点")], properNouns: ["林凡", `地名${m[1]}`, "林凡"] });
};
const mergeReply = JSON.stringify({ beats: [beat("开局", "钩子"), beat("升级", "冲突升级"), beat("收尾", "卷末悬念")], properNouns: ["林凡"] });

function fakeCall(opts: { fail?: (rid: string) => Error | string | null } = {}) {
  let active = 0;
  const state = { maxActive: 0, rids: [] as string[] };
  const call = vi.fn(async (prompt: string, _json: boolean, rid: string) => {
    active += 1;
    state.maxActive = Math.max(state.maxActive, active);
    await new Promise(r => setTimeout(r, 5));
    active -= 1;
    state.rids.push(rid);
    const f = opts.fail?.(rid);
    if (f instanceof Error) throw f;
    if (typeof f === "string") return { text: f, model: "mock" };
    return { text: rid.endsWith("merge") ? mergeReply : shardReply(prompt), model: "mock" };
  });
  return { call, state };
}

const base = { userId: 7, requestId: "req-1", modelPreference: "glm" as const };

describe("splitNovelImitationShards", () => {
  it("不丢字、不重叠，按章节切，每片不超上限", () => {
    const text = book(10);
    const shards = splitNovelImitationShards(text);
    expect(shards.join("")).toBe(text);
    expect(shards.length).toBeGreaterThan(1);
    for (const s of shards) {
      expect(s.length).toBeLessThanOrEqual(NOVEL_IMITATION_SHARD_CHARS);
      expect(s.startsWith("第")).toBe(true); // 每片都从章节标题开始
    }
  });

  it("单章超长时按段落 / 句子切，仍不丢字", () => {
    const para = "他推开门。".repeat(300) + "\n";
    const text = `第1章 长章\n${para.repeat(30)}`;
    const shards = splitNovelImitationShards(text, 5000);
    expect(shards.join("")).toBe(text);
    for (const s of shards) {
      expect(s.length).toBeLessThanOrEqual(5000);
      expect(/[。\n]$/.test(s)).toBe(true); // 不在句子中间切
    }
  });

  it("没有任何边界时硬切，空文本返回空数组；Chapter N 也算章节", () => {
    const text = "字".repeat(25);
    expect(splitNovelImitationShards(text, 10)).toEqual(["字".repeat(10), "字".repeat(10), "字".repeat(5)]);
    expect(splitNovelImitationShards("")).toEqual([]);
    const en = "Chapter 1\nabc.\nChapter 2\ndef.\n";
    expect(splitNovelImitationShards(en, 20)).toEqual(["Chapter 1\nabc.\n", "Chapter 2\ndef.\n"]);
  });
});

describe("提示词", () => {
  it("只要 JSON、只写结构与功能位，且不含禁用词", () => {
    const shard = buildNovelImitationShardPrompt("正文", 0, 3);
    const merge = buildNovelImitationMergePrompt([{ beats: [{ ...beat("x"), index: 1 }], properNouns: ["林凡"] }]);
    for (const p of [shard, merge]) {
      expect(p).toContain("仅返回JSON");
      expect(p).toContain("人物功能位");
      expect(p).toContain("示例底稿");
      for (const w of ["侵权", "抄袭", "洗稿", "查重"]) expect(p).not.toContain(w);
    }
    expect(shard).toContain("第1片（共3片）");
    expect(merge).toContain("重新连续编号");
    expect(merge).toContain("80");
  });
});

describe("resolveNovelImitationSkeleton", () => {
  it("多片：调用次数 = 片数 + 1，并发不超上限，结果过 schema 且 index 连续，证据 raw/parsed 分别保存", async () => {
    const text = book(12); // 约 11 万字 → 5 片
    const shards = splitNovelImitationShards(text).length;
    expect(shards).toBeGreaterThan(NOVEL_IMITATION_SHARD_CONCURRENCY);
    const { call, state } = fakeCall();
    const { store, objects } = memoryStore();
    let stats: NovelImitationSkeletonStats | undefined;
    const skeleton = await resolveNovelImitationSkeleton({ ...base, baseText: text, call, store, onStats: s => (stats = s) });
    expect(call).toHaveBeenCalledTimes(shards + 1);
    expect(state.maxActive).toBeLessThanOrEqual(NOVEL_IMITATION_SHARD_CONCURRENCY);
    expect(state.maxActive).toBeGreaterThan(1);
    expect(state.rids.at(-1)).toBe("req-1:imitation-skeleton-merge");
    expect(novelImitationSkeletonSchema.parse(skeleton)).toEqual(skeleton);
    expect(skeleton.beats.map(b => b.index)).toEqual([1, 2, 3]);
    // 专有名词：汇总 + 各片补齐，去重
    expect(skeleton.properNouns[0]).toBe("林凡");
    expect(new Set(skeleton.properNouns).size).toBe(skeleton.properNouns.length);
    expect(skeleton.properNouns).toContain(`地名${shards}`);
    const names = Array.from(objects.keys());
    for (let i = 0; i < shards; i++) {
      expect(names.filter(n => n.includes(`/evidence/`) && n.includes(`/shard-${i}-raw-`))).toHaveLength(1);
      expect(names.filter(n => n.includes(`/evidence/`) && n.includes(`/shard-${i}-parsed-`))).toHaveLength(1);
    }
    expect(names.filter(n => n.includes("/merge-raw-"))).toHaveLength(1);
    expect(names.filter(n => n.includes("/merge-parsed-"))).toHaveLength(1);
    expect(names.every(n => n.startsWith("novel-imitation-skeleton/user-7/"))).toBe(true);
    const raw = JSON.parse(objects.get(names.find(n => n.includes("/merge-raw-"))!)!);
    expect(raw.response.text).toBe(mergeReply);
    expect(stats).toMatchObject({ cached: false, shards, merged: true });
  });

  it("只有一片时不汇总，直接整理成骨架（index 重排、专有名词去重）", async () => {
    const { call } = fakeCall();
    const { store } = memoryStore();
    const skeleton = await resolveNovelImitationSkeleton({ ...base, baseText: chapter(1, 3000), call, store });
    expect(call).toHaveBeenCalledTimes(1);
    expect(skeleton.beats.map(b => b.index)).toEqual([1, 2]);
    expect(skeleton.properNouns).toEqual(["林凡", "地名1"]);
  });

  it("缓存命中 0 次调用；同文本不同线路不共用缓存", async () => {
    const text = book(6);
    const { store } = memoryStore();
    const first = fakeCall();
    const a = await resolveNovelImitationSkeleton({ ...base, baseText: text, call: first.call, store });
    const second = fakeCall();
    let stats: NovelImitationSkeletonStats | undefined;
    const b = await resolveNovelImitationSkeleton({ ...base, requestId: "req-2", baseText: text, call: second.call, store, onStats: s => (stats = s) });
    expect(second.call).toHaveBeenCalledTimes(0);
    expect(b).toEqual(a);
    expect(stats?.cached).toBe(true);
    const third = fakeCall();
    await resolveNovelImitationSkeleton({ ...base, modelPreference: "carbon", baseText: text, call: third.call, store });
    expect(third.call).toHaveBeenCalledTimes(splitNovelImitationShards(text).length + 1);
  });

  it("某片失败：其余片照跑，抛错写明第几片失败、不汇总不写缓存；证据保留；重试只补失败片", async () => {
    const text = book(12);
    const shards = splitNovelImitationShards(text).length;
    const { store, objects } = memoryStore();
    const bad = fakeCall({ fail: rid => (rid === "req-1:imitation-skeleton-2" ? "不是JSON" : rid === "req-1:imitation-skeleton-3" ? new TypeError("x") : null) });
    const err = await resolveNovelImitationSkeleton({ ...base, baseText: text, call: bad.call, store }).catch(e => e);
    expect(err).toBeInstanceOf(NovelImitationSkeletonError);
    expect(err.code).toBe("NOVEL_IMITATION_SKELETON_SHARD_FAILED");
    expect(err.message).toContain("第3、4片失败");
    expect(err.failures).toEqual([{ shard: 3, reason: "not_json" }, { shard: 4, reason: "call_failed:TypeError" }]);
    expect(bad.call).toHaveBeenCalledTimes(shards); // 不汇总
    const names = Array.from(objects.keys());
    expect(names.some(n => n.includes("/shard-2-raw-"))).toBe(true);
    expect(JSON.parse(objects.get(names.find(n => n.includes("/shard-2-parsed-"))!)!).parseError).toBe("not_json");
    expect(names.some(n => /novel-imitation-skeleton\/user-7\/[0-9a-f]{64}\.json$/.test(n))).toBe(false);

    const retry = fakeCall();
    const skeleton = await resolveNovelImitationSkeleton({ ...base, baseText: text, call: retry.call, store });
    expect(retry.call).toHaveBeenCalledTimes(2 + 1);
    expect(skeleton.beats.length).toBe(3);
    expect(Array.from(objects.keys()).length).toBeGreaterThan(names.length); // 只增不删
    for (const n of names) expect(objects.has(n)).toBe(true);
  });

  it("分片回包不合 schema / 汇总失败 / 原始证据写不进去 → 抛错，不消费", async () => {
    const text = book(6);
    const invalid = fakeCall({ fail: rid => (rid.endsWith("-0") ? JSON.stringify({ beats: [], properNouns: [] }) : null) });
    const e1 = await resolveNovelImitationSkeleton({ ...base, baseText: text, call: invalid.call, store: memoryStore().store }).catch(e => e);
    expect(e1.failures).toEqual([{ shard: 1, reason: "schema_invalid" }]);

    const mergeBad = fakeCall({ fail: rid => (rid.endsWith("merge") ? new Error("boom") : null) });
    const e2 = await resolveNovelImitationSkeleton({ ...base, baseText: text, call: mergeBad.call, store: memoryStore().store }).catch(e => e);
    expect(e2.code).toBe("NOVEL_IMITATION_SKELETON_MERGE_FAILED");

    const failing: NovelTemplateDigestStore = { read: async () => null, writeIfAbsent: async () => { throw new Error("gcs down"); } };
    const e3 = await resolveNovelImitationSkeleton({ ...base, baseText: chapter(1, 100), call: fakeCall().call, store: failing }).catch(e => e);
    expect(e3.failures).toEqual([{ shard: 1, reason: "raw_evidence_unsaved" }]);
  });
});
