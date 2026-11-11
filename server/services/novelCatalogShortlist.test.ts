import { describe, it, expect, vi } from "vitest";
vi.mock("./manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: vi.fn(),
  resolveViralTemplateForExpand: vi.fn(),
}));
vi.mock("./manhuaNovelAdaptationRun", () => ({ callNovelStage: vi.fn() }));
import {
  NOVEL_CATALOG_SHORTLIST_MAX,
  shortlistNovelCatalog,
  shouldShortlistNovelCatalog,
  validateNovelCatalogShortlistPicks,
} from "./novelCatalogShortlist";
import { buildNovelTestPrompt, executeNovelTest } from "./novelWorkspaceTest";
import { novelTestInputSchema } from "../../shared/novelWorkspace";
import type { NovelTemplateDigestStore } from "./novelTemplateDigest";

const catalog = Array.from({ length: 98 }, (_, i) => ({
  publicId: `mt_c${String(i).padStart(3, "0")}`,
  craft: `手法${i}`,
  methods: `方法${i}`,
  intro: `能力简介${i}：`.repeat(30),
  tags: ["反转", "复仇", `标签${i}`],
}));
const input = novelTestInputSchema.parse({
  requestId: "11111111-1111-4111-8111-111111111111",
  roundId: "22222222-2222-4222-8222-222222222222",
  stage: "advice",
  topic: "女娲",
  direction: "代价与抉择",
  source: { label: "底本", text: "底本正文".repeat(1000) },
  templates: [],
  selectedTemplateIds: [],
  episodeCount: 3,
});

function memoryStore() {
  const objects = new Map<string, string>();
  const store: NovelTemplateDigestStore = {
    read: async name => objects.get(name) ?? null,
    writeIfAbsent: async (name, body) => { if (objects.has(name)) throw new Error("exists"); objects.set(name, body); },
  };
  return { store, objects };
}
const shardIdsOf = (prompt: string): string[] => {
  const line = prompt.split("\n\n").find(p => p.includes('"catalogShard"'))!;
  return JSON.parse(line).catalogShard.map((e: { publicId: string }) => e.publicId);
};
/** 假线路：每片选该片第 2、3 名并夹带一个本片不存在的 id 与重复 id。 */
const pickingCall = (behaviour: (ids: string[], requestId: string) => string | Error = ids => JSON.stringify({ picks: [{ publicId: ids[1], why: "好" }, { publicId: "mt_fake", why: "假" }, { publicId: ids[1], why: "重复" }, { publicId: ids[2], why: "也好" }] })) => {
  const calls: Array<{ requestId: string; ids: string[] }> = [];
  let active = 0;
  let maxActive = 0;
  const call = vi.fn(async (prompt: string, _json: boolean, requestId: string) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(r => setTimeout(r, 5));
    active -= 1;
    const ids = shardIdsOf(prompt);
    calls.push({ requestId, ids });
    const out = behaviour(ids, requestId);
    if (out instanceof Error) throw out;
    return { text: out, model: "mock" };
  });
  return { call, calls, get maxActive() { return maxActive; } };
};

describe("顾问阶段全库目录分片并发初选", () => {
  it("启用条件：顾问阶段 + 带简介 + 大于一片", () => {
    expect(shouldShortlistNovelCatalog(input, catalog)).toBe(true);
    expect(shouldShortlistNovelCatalog({ stage: "outline" }, catalog)).toBe(false);
    expect(shouldShortlistNovelCatalog(input, catalog.slice(0, 25))).toBe(false);
    expect(shouldShortlistNovelCatalog(input, catalog.map(({ intro: _i, ...rest }) => rest))).toBe(false);
  });

  it("每片并发各发一次（并发上限 4），只留本片真实 id、去重；raw 与 parsed 证据各一份", async () => {
    const fake = pickingCall();
    const { store, objects } = memoryStore();
    const result = await shortlistNovelCatalog({ userId: 7, input, catalog, call: fake.call, store });
    expect(fake.call).toHaveBeenCalledTimes(4); // 98 条 / 25 = 4 片
    expect(new Set(fake.calls.map(c => c.requestId)).size).toBe(4);
    expect(fake.maxActive).toBeGreaterThan(1);
    expect(fake.maxActive).toBeLessThanOrEqual(4);
    expect(result.shortlisted).toBe(true);
    expect(result.stats.shards).toBe(4);
    expect(result.stats.fallbackShards).toEqual([]);
    expect(result.catalog.map(c => c.publicId)).toEqual(["mt_c001", "mt_c002", "mt_c026", "mt_c027", "mt_c051", "mt_c052", "mt_c076", "mt_c077"]);
    expect(result.catalog.every(c => "intro" in c)).toBe(true);
    const names = Array.from(objects.keys());
    expect(names.filter(n => n.includes("-raw-"))).toHaveLength(4);
    expect(names.filter(n => n.includes("-parsed-"))).toHaveLength(4);
    expect(names.every(n => n.startsWith("novel-catalog-shortlist/user-7/"))).toBe(true);
    const raw = JSON.parse(objects.get(names.find(n => n.includes("shard-0-raw-"))!)!);
    expect(raw.response.text).toContain("mt_fake");
    const parsed = JSON.parse(objects.get(names.find(n => n.includes("shard-0-parsed-"))!)!);
    expect(parsed.picks.map((p: any) => p.publicId)).toEqual(["mt_c001", "mt_c002"]);
    // 底本摘要截在 1500 字内
    expect(fake.calls.length).toBe(4);
  });

  it("入围去重且总数不超过上限 16（每片最多 4 个）", async () => {
    const fake = pickingCall(ids => JSON.stringify({ picks: ids.slice(0, 8).map(publicId => ({ publicId, why: "x" })) }));
    const { store } = memoryStore();
    const big = Array.from({ length: 150 }, (_, i) => ({ ...catalog[0]!, publicId: `mt_b${i}` }));
    const result = await shortlistNovelCatalog({ userId: 1, input, catalog: big, call: fake.call, store });
    expect(fake.call).toHaveBeenCalledTimes(6);
    expect(result.catalog).toHaveLength(NOVEL_CATALOG_SHORTLIST_MAX);
    expect(new Set(result.stats.picked).size).toBe(NOVEL_CATALOG_SHORTLIST_MAX);
    expect(validateNovelCatalogShortlistPicks({ picks: [1, 2, 3, 4, 5].map(i => ({ publicId: `a${i}` })) }, ["a1", "a2", "a3", "a4", "a5"])).toHaveLength(4);
  });

  it("单片失败（抛错 / 非 JSON / 一个没选）→ 该片回退取前 4 条，不挡流程", async () => {
    const fake = pickingCall((ids, requestId) => {
      if (requestId.endsWith("-0")) return new Error("boom");
      if (requestId.endsWith("-1")) return "不是JSON";
      if (requestId.endsWith("-2")) return JSON.stringify({ picks: [{ publicId: "mt_fake" }] });
      return JSON.stringify({ picks: [{ publicId: ids[5], why: "好" }] });
    });
    const { store, objects } = memoryStore();
    const result = await shortlistNovelCatalog({ userId: 1, input, catalog, call: fake.call, store });
    expect(result.shortlisted).toBe(true);
    expect(result.stats.fallbackShards.map(f => f.shard)).toEqual([0, 1, 2]);
    expect(result.stats.fallbackShards[1]!.reason).toBe("not_json");
    expect(result.stats.fallbackShards[2]!.reason).toBe("empty_selection");
    expect(result.catalog.map(c => c.publicId)).toEqual([
      "mt_c000", "mt_c001", "mt_c002", "mt_c003", "mt_c025", "mt_c026", "mt_c027", "mt_c028", "mt_c050", "mt_c051", "mt_c052", "mt_c053", "mt_c080",
    ]);
    // 抛错的片没有回包，无证据；其余三片 raw / parsed 各一份（非 JSON 也保存了原始返回）
    expect(Array.from(objects.keys()).filter(n => n.includes("-raw-"))).toHaveLength(3);
    expect(Array.from(objects.keys()).filter(n => n.includes("-parsed-"))).toHaveLength(3);
  });

  it("全部分片失败 → 回退全库（现状）", async () => {
    const fake = pickingCall(() => new Error("down"));
    const { store } = memoryStore();
    const result = await shortlistNovelCatalog({ userId: 1, input, catalog, call: fake.call, store });
    expect(result.shortlisted).toBe(false);
    expect(result.allFailed).toBe(true);
    expect(result.catalog).toHaveLength(98);
    expect(result.stats.fallbackShards).toHaveLength(4);
  });

  it("证据写不进 → 不消费该片返回（回退）", async () => {
    const fake = pickingCall();
    const store: NovelTemplateDigestStore = { read: async () => null, writeIfAbsent: async () => { throw new Error("gcs"); } };
    const result = await shortlistNovelCatalog({ userId: 1, input, catalog, call: fake.call, store });
    expect(result.shortlisted).toBe(false);
    expect(result.stats.fallbackShards.every(f => f.reason === "raw_evidence_unsaved")).toBe(true);
  });

  it("小库（≤ 一片）不分片、不调用", async () => {
    const fake = pickingCall();
    const result = await shortlistNovelCatalog({ userId: 1, input, catalog: catalog.slice(0, 20), call: fake.call, store: memoryStore().store });
    expect(fake.call).not.toHaveBeenCalled();
    expect(result.shortlisted).toBe(false);
    expect(result.allFailed).toBe(false);
    expect(result.catalog).toHaveLength(20);
  });

  it("初选提示词：底本摘要截到 1500 字内，只含本片条目", async () => {
    const prompts: string[] = [];
    const call = vi.fn(async (prompt: string) => { prompts.push(prompt); return { text: JSON.stringify({ picks: [] }), model: "m" }; });
    await shortlistNovelCatalog({ userId: 1, input, catalog, call, store: memoryStore().store });
    const payload = JSON.parse(prompts[0]!.split("\n\n").find(p => p.includes('"catalogShard"'))!);
    expect(payload.sourceDigest.length).toBeLessThanOrEqual(1500);
    expect(payload.sourceDigest.length).toBeGreaterThan(1000);
    expect(payload.catalogShard).toHaveLength(25);
  });

  it("终选提示词的目录只含入围条目、显著小于全库；校验仍用全库 id", async () => {
    const shortlist = catalog.filter((_, i) => i % 7 === 0).slice(0, 12);
    const full = buildNovelTestPrompt(input, "模板摘要", catalog);
    const slim = buildNovelTestPrompt(input, "模板摘要", shortlist, { shortlisted: true });
    const ids = (prompt: string) => JSON.parse(prompt.split("\n\n").find(p => p.includes('"availableCatalog"'))!).availableCatalog.map((c: any) => c.publicId);
    expect(ids(slim)).toEqual(shortlist.map(c => c.publicId));
    const catalogChars = (prompt: string) => JSON.stringify(JSON.parse(prompt.split("\n\n").find(p => p.includes('"availableCatalog"'))!).availableCatalog).length;
    expect(catalogChars(slim)).toBeLessThan(catalogChars(full) / 6);
    expect(slim.length).toBeLessThan(full.length / 2);
    expect(slim).toContain("目录是初选后的入围名单");
    expect(full).not.toContain("目录是初选后的入围名单");
    // 推荐了入围名单之外、但在全库里的 id：校验照常通过（不因入围变严）
    const outside = catalog[97]!.publicId;
    const prompts: string[] = [];
    const value = await executeNovelTest(
      input, "模板摘要", catalog,
      async (prompt) => { prompts.push(prompt); return { text: JSON.stringify({ assessment: "评估", recommendations: [outside, catalog[0]!.publicId, catalog[7]!.publicId].map(publicId => ({ publicId, reason: "r", tradeoff: "t" })) }), model: "m" }; },
      async () => undefined, undefined, shortlist,
    );
    expect(ids(prompts[0]!)).toEqual(shortlist.map(c => c.publicId));
    expect(JSON.stringify(value)).toContain(outside);
    // 不在全库的 id 仍被拒（不变松）
    await expect(executeNovelTest(
      input, "模板摘要", catalog,
      async () => ({ text: JSON.stringify({ assessment: "评估", recommendations: ["mt_nope", catalog[0]!.publicId, catalog[7]!.publicId].map(publicId => ({ publicId, reason: "r", tradeoff: "t" })) }), model: "m" }),
      async () => undefined, undefined, shortlist,
    )).rejects.toThrow();
  });
});
