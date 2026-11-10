import { describe, expect, it } from "vitest";
import {
  MV_SCENE_CONSISTENCY_THRESHOLD,
  MV_SCENE_DEFAULT_LOCATION_ZH,
  MV_SCENE_LOCK_RULE_ZH,
  extractMvSceneLocations,
  judgeMvSceneConsistency,
  mvSceneConsistencyPairs,
  mvSceneManualBaseWarning,
  mvSceneSignatureFromGray,
  mvSceneSimilarity,
  parseMvSceneLocations,
  planMvSceneImage,
} from "./canvasMusicMvSceneLock";
import { buildStockPhotoPersonEditPrompt, stockPhotoPersonEditInputSchema } from "./stockPhotoPersonEdit";
import { MUSIC_MV_BEATS_INSTRUCTIONS } from "./musicMvCraft";
import { compileMvShotTimedPrompt } from "./canvasMusicMvShotPrompt";

const shot = (id: string, visualPrompt: string, actionZh?: string) => ({ id, visualPrompt, ...(actionZh ? { beats: [{ actionZh }] } : {}) });
const SF = (c: string) => `sf_${c.repeat(48)}`;

describe("场景连续性锁：地点表", () => {
  it("抽地点去掉主语与动词前缀", () => {
    expect(extractMvSceneLocations("两人站在商店门口争执，雨落在街角")).toEqual(["商店门口", "街角"]);
  });
  it("无明确换景：全片同一地点（含「同一条街」与无地点描述的镜头）", () => {
    const plan = parseMvSceneLocations([
      shot("K1", "两人在商店门口争执"),
      shot("K2", "女生推开男生"),
      shot("K3", "男生站在商店门口淋雨"),
      shot("K4", "同一条街，镜头拉远，雨更大"),
      shot("K5", "特写他的眼睛"),
      shot("K6", "她在路口回头"),
    ]);
    expect(plan.locations).toHaveLength(1);
    expect(plan.locations[0]!.nameZh).toBe("商店门口");
    expect(Object.values(plan.byShot).every(id => id === "loc1")).toBe(true);
  });
  it("剧情明确换景才另起地点；回到旧地点复用原地点", () => {
    const plan = parseMvSceneLocations([
      shot("K1", "两人在商店门口争执"),
      shot("K2", "镜头跟随", "她转身跑开，来到地铁站"),
      shot("K3", "他回到商店门口独自站着"),
    ]);
    expect(plan.locations.map(l => l.nameZh)).toEqual(["商店门口", "地铁站"]);
    expect(plan.byShot).toEqual({ K1: "loc1", K2: "loc2", K3: "loc1" });
  });
  it("全片无地点描述 → 取创作说明，否则默认全片同一地点", () => {
    expect(parseMvSceneLocations([shot("a", "特写"), shot("b", "远景")], "雨夜，便利店门口的告白").locations[0]!.nameZh).toBe("便利店门口");
    expect(parseMvSceneLocations([shot("a", "特写"), shot("b", "远景")]).locations).toEqual([{ id: "loc1", nameZh: MV_SCENE_DEFAULT_LOCATION_ZH, shotIds: ["a", "b"] }]);
  });
});

describe("场景连续性锁：同地点强制用母版底图 edit", () => {
  const plan = parseMvSceneLocations([shot("K1", "商店门口争执"), shot("K2", "推搡"), shot("K5", "特写")]);
  const refs = {
    K1: { sceneImages: [{ gcsUri: "gs://b/stock/master.jpg", assetId: SF("a") }] },
    K2: { sceneImages: [] },
  };
  it("首镜无母版 → set_master；后续镜 → master_edit，底图=母版（图库编号），附锁定句", () => {
    expect(planMvSceneImage("K1", plan, {}).mode).toBe("set_master");
    expect(planMvSceneImage("K1", plan, refs).mode).toBe("set_master");
    const p = planMvSceneImage("K5", plan, refs);
    expect(p).toMatchObject({ mode: "master_edit", locationZh: "商店门口", base: { baseAssetId: SF("a") }, sceneLockZh: MV_SCENE_LOCK_RULE_ZH });
  });
  it("母版是生成图 → baseSource；改图请求通过校验，指令带同地点硬锁", () => {
    const p = planMvSceneImage("K2", plan, { K1: { sceneImages: [{ gcsUri: "gs://b/gen/k1.png" }] } });
    if (p.mode !== "master_edit") throw new Error("应为 master_edit");
    expect(p.base).toEqual({ baseSource: "gs://b/gen/k1.png" });
    const req = stockPhotoPersonEditInputSchema.parse({
      requestId: "a51d8a78-1c90-4f1d-9c1e-324e7a3f4659", ...p.base, sceneLockLocationZh: p.locationZh, cast: "lead",
      people: [{ slot: "lead", source: "gs://b/face.jpg", identityPhoto: true }], actionText: "他淋雨站着", aspectRatio: "9:16",
    });
    const prompt = buildStockPhotoPersonEditPrompt(req);
    expect(prompt).toContain('SAME LOCATION LOCK (HARD): image 1 is the MASTER PLATE of the location "商店门口"');
    expect(prompt).toContain(MV_SCENE_LOCK_RULE_ZH);
  });
  it("底图必须且只能一张", () => {
    const base = { requestId: "a51d8a78-1c90-4f1d-9c1e-324e7a3f4659", cast: "lead", people: [{ slot: "lead", source: "x", identityPhoto: true }], actionText: "站着" };
    expect(stockPhotoPersonEditInputSchema.safeParse(base).success).toBe(false);
    expect(stockPhotoPersonEditInputSchema.safeParse({ ...base, baseAssetId: SF("a"), baseSource: "gs://b/x.png" }).success).toBe(false);
  });
  it("手动换别的底图 → 「与母版地点不一致」需确认；母版本身/母版镜不提示", () => {
    expect(mvSceneManualBaseWarning("K5", { gcsUri: "gs://b/stock/baroque.jpg", assetId: SF("c") }, plan, refs)).toMatch(/^与母版地点不一致/);
    expect(mvSceneManualBaseWarning("K5", { gcsUri: "gs://b/stock/master.jpg", assetId: SF("a") }, plan, refs)).toBeUndefined();
    expect(mvSceneManualBaseWarning("K1", { gcsUri: "gs://b/stock/other.jpg" }, plan, refs)).toBeUndefined();
  });
});

describe("场景连续性锁：出视频前一致性预检", () => {
  const W = 32;
  const img = (f: (x: number, y: number) => number) => Array.from({ length: W * W }, (_, i) => Math.max(0, Math.min(255, Math.round(f(i % W, Math.floor(i / W))))));
  const street = img((x, y) => (x < 12 ? 60 : 180) + (y > 22 ? -40 : 0) + (x % 8 < 2 ? 30 : 0));
  const sig = (g: number[]) => mvSceneSignatureFromGray(g, W, W);
  it("同地点换光线（整体变暗、降对比）仍判一致；结构完全不同判不一致", () => {
    const relit = img((x, y) => 0.6 * street[y * W + x]! + 10);
    const other = img((x, y) => 255 - street[(W - 1 - y) * W + (W - 1 - x)]! * 0.5 + (y % 5) * 9);
    expect(mvSceneSimilarity(sig(street), sig(street))).toBe(1);
    expect(mvSceneSimilarity(sig(street), sig(relit))).toBeGreaterThanOrEqual(MV_SCENE_CONSISTENCY_THRESHOLD);
    expect(mvSceneSimilarity(sig(street), sig(other))).toBeLessThan(MV_SCENE_CONSISTENCY_THRESHOLD);
    const report = judgeMvSceneConsistency("商店门口", "gs://m", sig(street), [
      { shotId: "K4", shotLabel: "镜头 4", gcsUri: "gs://k4", signature: sig(relit) },
      { shotId: "K5", shotLabel: "镜头 5", gcsUri: "gs://k5", signature: sig(other) },
    ]);
    expect(report.items.map(i => i.ok)).toEqual([true, false]);
    expect(report.warningsZh).toEqual(["镜头 5 的场景图与「商店门口」母版差异明显，可能不是同一地点"]);
  });
  it("阈值可调：阈值为 0 全部通过", () => {
    const r = judgeMvSceneConsistency("x", "gs://m", sig(street), [{ shotId: "a", gcsUri: "g", signature: sig(img(() => 0)) }], 0);
    expect(r.warningsZh).toEqual([]);
  });
  it("比对对：每地点母版 vs 同地点其余全部场景图（跳过母版本身）", () => {
    const plan = parseMvSceneLocations([shot("K1", "商店门口"), shot("K2", "推搡"), shot("K3", "走进地铁站")]);
    const groups = mvSceneConsistencyPairs(plan, {
      K1: { sceneImages: [{ gcsUri: "gs://m", assetId: SF("a") }, { gcsUri: "gs://k1b" }] },
      K2: { sceneImages: [{ gcsUri: "gs://k2" }] },
      K3: { sceneImages: [{ gcsUri: "gs://k3" }] },
    });
    expect(groups).toEqual([{ locationZh: "商店门口", masterGcsUri: "gs://m", masterAssetId: SF("a"), items: [{ shotId: "K1", gcsUri: "gs://k1b" }, { shotId: "K2", gcsUri: "gs://k2" }] }]);
  });
  it("尺寸不足直接报错", () => {
    expect(() => mvSceneSignatureFromGray([1, 2, 3], 3, 1)).toThrow("缩略图尺寸不足");
  });
});

describe("场景连续性锁：编排与镜头提示词", () => {
  it("逐窗节拍指令含地点连续规则", () => {
    expect(MUSIC_MV_BEATS_INSTRUCTIONS).toContain("全片地点连续，除非剧情明确换景");
  });
  it("首窗场景行写地点名与锁定句，与光色贯穿共存；未给地点不写", () => {
    const refs = { anchorImage: { gcsUri: "gs://b/a.png" }, sceneImages: [{ gcsUri: "gs://b/s.jpg" }, { gcsUri: "gs://b/s2.jpg" }], motionVideos: [] };
    const beat = { startSec: 0, endSec: 3, actionZh: "争执", cameraZh: "中景", lightingZh: "阴天冷光", moodZh: "紧张", sfxZh: "雨声" };
    const base = { engine: "seedance-2.0-mini" as const, modelLabel: "m", resolution: "480p", aspectRatio: "9:16" as const, generateDurationSec: 5, references: refs };
    const s = { shotId: "K4", startSec: 0, endSec: 5, visualPrompt: "两人争执", cameraPrompt: "中景", beats: [beat, { ...beat, startSec: 3, endSec: 5 }] };
    const out = compileMvShotTimedPrompt(s, { ...base, locationZh: "商店门口" });
    expect(out.text).toContain(`地点：商店门口（${MV_SCENE_LOCK_RULE_ZH}）`);
    expect(out.text).toContain("阴天冷光");
    expect(compileMvShotTimedPrompt(s, base).text).not.toContain("地点：");
  });
});
