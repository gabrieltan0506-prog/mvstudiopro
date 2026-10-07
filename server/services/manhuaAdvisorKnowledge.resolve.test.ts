import { expect, it, vi } from "vitest";
import { createManhuaAdvisorKnowledge } from "./manhuaAdvisorKnowledge";
import { parseManhuaViralTemplateCard, toPublicManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";
const name = "manhua-template-learn/approved/tpl_a123.json";
const raw = { id: "tpl_a123", publicCode: "A123", nameZh: "PrivateSource", laneZh: "古言种田", status: "approved", beatGrid: [],
  summaryZh: "PrivateLearnedMethod", classification: { emotionTagsZh: ["悬念"], narrativeFeatureTagsZh: ["试探"],
    audienceExperienceTagsZh: ["紧张"], performanceTagsZh: ["PrivatePerformance"], audiovisualTagsZh: ["PrivateCamera"] } };
const buffer = () => Buffer.from(JSON.stringify(raw));
function setup() {
  const list = vi.fn(async () => [{ name, generation: "1" }]);
  const read = vi.fn(async () => ({ buffer: buffer(), generation: "1" }));
  const legacy = vi.fn(async () => ({ card: parseManhuaViralTemplateCard(raw)!, appliedTemplate: { publicId: "mt_a123", nameZh: "匿名模板" } }));
  return { ...createManhuaAdvisorKnowledge({ list, read, legacy }), list, read, legacy };
}
it("scanned ID reads exactly one current approved object with no list/fallback; summary uses public DTO fields only", async () => {
  const store = setup(); const scan = await store.refresh(); store.list.mockClear(); store.read.mockClear();
  const pub = toPublicManhuaViralTemplateCard(parseManhuaViralTemplateCard(raw)!)!;
  expect(scan.snapshot!.templates[0]).toMatchObject({ laneZh: pub.laneZh, classificationTagsZh: pub.classificationTagsZh, nameZh: pub.nameZh });
  expect(JSON.stringify(scan)).not.toContain("Private");
  const result = await store.resolveTemplate("MT_A123");
  expect(result).toMatchObject({ resolution: "indexed", appliedTemplate: { publicId: "mt_a123" }, card: { summaryZh: "PrivateLearnedMethod" } });
  expect(store.read).toHaveBeenCalledTimes(1);
  expect(store.read).toHaveBeenCalledWith({ name, generation: "1" });
  expect(store.list).not.toHaveBeenCalled(); expect(store.legacy).not.toHaveBeenCalled();
});
it("unscanned uses explicitly identified legacy full-catalog path; a scanned unknown ID does not", async () => {
  const store = setup(); expect(await store.resolveTemplate("mt_a123")).toMatchObject({ resolution: "legacy_full_catalog" });
  expect(store.legacy).toHaveBeenCalledTimes(1); expect(store.list).not.toHaveBeenCalled();
  await store.refresh(); store.legacy.mockClear(); store.read.mockClear();
  expect(await store.resolveTemplate("mt_ffff")).toEqual({ error: "not_found" });
  expect(await store.resolveTemplate("tpl_a123")).toEqual({ error: "bad_id" });
  expect(store.legacy).not.toHaveBeenCalled(); expect(store.read).not.toHaveBeenCalled();
});
it.each(["generation", "identity", "status", "publicCode"])("changed %s requires explicit refresh, keeps old snapshot and never guesses", async field => {
  const store = setup(); const first = await store.refresh(); store.list.mockClear();
  const changed = field === "identity" ? { ...raw, id: "tpl_other" } : field === "status" ? { ...raw, status: "proposed" }
    : field === "publicCode" ? { ...raw, publicCode: "FFFF" } : raw;
  store.read.mockResolvedValue({ buffer: Buffer.from(JSON.stringify(changed)), generation: field === "generation" ? "2" : "1" });
  expect(await store.resolveTemplate("mt_a123")).toEqual({ error: "refresh_required" });
  expect(store.inspect().status).toBe("stale"); expect(store.inspect().snapshot).toEqual(first.snapshot);
  expect(store.list).not.toHaveBeenCalled(); expect(store.legacy).not.toHaveBeenCalled();
});
it("deleted scanned card fails closed without whole-catalog fallback", async () => {
  const store = setup(); await store.refresh(); store.read.mockRejectedValue(new Error("gcs_stat_failed:404"));
  expect(await store.resolveTemplate("mt_a123")).toEqual({ error: "not_found" });
  expect(store.inspect().status).toBe("stale"); expect(store.legacy).not.toHaveBeenCalled();
});
