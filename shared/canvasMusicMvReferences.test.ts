import { describe, expect, it } from "vitest";
import {
  isMvShotEngineSupported,
  mvShotReferenceLimits,
  applyAnchorImageToAll,
  assembleMvShotReferences,
  countMvShotReferences,
  mvShotReferenceGaps,
  type MvShotReferencesInput,
} from "./canvasMusicMvReferences";

const sf = (n: number) => `sf_${n.toString(16).padStart(48, "0")}`;
const img = (n: number, extra: Partial<{ hasRealPerson: boolean }> = {}) => ({
  assetId: sf(n),
  gcsUri: `gs://b/stock-footage/1/${sf(n)}.jpg`,
  ...extra,
});
const vid = (n: number, source: "previs" | "stock" = "stock") => ({
  source,
  gcsUri: `gs://b/${source}/${n}.mp4`,
  inSec: 0,
  outSec: 5,
  durationSec: 12,
});
const song = { jobId: "mv_slice_x", gcsUri: "gs://b/slices/x.wav", startSec: 140, endSec: 149 };
const shot = { startSec: 140, endSec: 149 } as const;

const full: MvShotReferencesInput = {
  anchorImage: img(1),
  sceneImages: [img(2), img(3)],
  motionVideos: [vid(1)],
  songSlice: song,
};

describe("MV 镜头参考组装", () => {
  it("完整参考：按数组顺序编号，@image1 恒为主锚图，职责声明逐项", () => {
    const out = assembleMvShotReferences(full, shot);
    expect(out.imageGcsUris[0]).toBe(img(1).gcsUri);
    expect(out.imageGcsUris).toHaveLength(3);
    expect(out.videoGcsUris).toEqual([vid(1).gcsUri]);
    expect(out.audioGcsUris).toEqual([song.gcsUri]);
    expect(out.counts).toEqual({ image: 3, video: 1, audio: 1, total: 5 });
    expect(out.promptAppendix).toContain("@图片1定义全片人物造型");
    expect(out.promptAppendix).toContain("@图片2、@图片3定义本镜的场景");
    expect(out.promptAppendix).toContain("@视频1是运镜参考片");
    expect(out.promptAppendix).toContain("@音频1是本镜 140–149 秒的歌曲切片");
    expect(out.promptAppendix).toContain("声音只生成本镜画面里的环境音与特效音");
    expect(out.promptAppendix).toContain("禁止生成任何音乐、配乐、人声、歌声、哼唱或旋律");
    expect(out.hasRealPerson).toBe(false);
  });

  it("缺主锚图 / 缺场景与参考片 / 缺切片 → 阻断并逐条报中文", () => {
    expect(() => assembleMvShotReferences({ sceneImages: [], motionVideos: [] }, shot)).toThrow(/缺全片主锚图.*缺本镜场景图或动作参考片.*缺本镜歌曲切片/);
    const gaps = mvShotReferenceGaps({ anchorImage: img(1), sceneImages: [img(2)], motionVideos: [], songSlice: song });
    expect(gaps.blocking).toEqual([]);
    expect(gaps.advisory.map(g => g.code)).toEqual(["scene", "motion"]);
  });

  it("总数 >9 或单类超 Mini 上限 → 阻断，不裁剪放行", () => {
    const over: MvShotReferencesInput = {
      anchorImage: img(1),
      sceneImages: [img(2), img(3), img(4), img(5), img(6), img(7), img(8)],
      motionVideos: [vid(1), vid(2)],
      songSlice: song,
    };
    expect(countMvShotReferences(over).total).toBe(11);
    expect(() => assembleMvShotReferences(over, shot)).toThrow(/超过 9 项上限/);
    const tooManyVideos: MvShotReferencesInput = {
      anchorImage: img(1),
      sceneImages: [],
      motionVideos: [vid(1), vid(2), vid(3), vid(4)],
      songSlice: song,
    };
    expect(() => assembleMvShotReferences(tooManyVideos, shot)).toThrow();
  });

  it("2.5 上限 30/10/10：同一张表放宽，不另造", () => {
    const refs: MvShotReferencesInput = {
      anchorImage: img(1),
      sceneImages: [img(2), img(3), img(4), img(5), img(6), img(7), img(8), img(9)],
      motionVideos: [vid(1)],
      songSlice: song,
    };
    expect(() => assembleMvShotReferences(refs, shot, "2.0-mini")).toThrow(/超过 9 项上限/);
    // 2.5 仍受总数 9 约束（用户拍板「喂满 ≤9」），单类放宽只影响类上限文案
    expect(mvShotReferenceGaps(refs, "2.5").blocking.map(g => g.code)).toEqual(["over_limit"]);
  });

  it("白模优先：source=previs 的职责文案是白模站位片；对口型镜头切片写口型同步", () => {
    const out = assembleMvShotReferences({ ...full, motionVideos: [vid(1, "previs"), vid(2)] }, { ...shot, kind: "singing" });
    expect(out.promptAppendix).toContain("@视频1是白模站位片");
    expect(out.promptAppendix).toContain("@视频2是运镜参考片");
    expect(out.promptAppendix).toContain("歌曲唱段，人物口型");
    expect(out.videoWindows).toEqual([{ inSec: 0, outSec: 5 }, { inSec: 0, outSec: 5 }]);
  });

  it("含真人素材标记向上传递；重复素材拒绝", () => {
    expect(assembleMvShotReferences({ ...full, sceneImages: [img(2, { hasRealPerson: true })] }, shot).hasRealPerson).toBe(true);
    expect(() => assembleMvShotReferences({ ...full, sceneImages: [img(1)] }, shot)).toThrow(/重复/);
  });

  it("视频出点校验：出点 ≤ 入点或超时长拒绝", () => {
    expect(() => assembleMvShotReferences({ ...full, motionVideos: [{ ...vid(1), outSec: 0 }] }, shot)).toThrow();
    expect(() => assembleMvShotReferences({ ...full, motionVideos: [{ ...vid(1), outSec: 13 }] }, shot)).toThrow();
  });

  it("一键套主锚图到全部镜头：只换 anchorImage", () => {
    const out = applyAnchorImageToAll({ a: full, b: undefined }, ["a", "b"], img(9));
    expect(out.a.anchorImage?.assetId).toBe(sf(9));
    expect(out.a.sceneImages).toHaveLength(2);
    expect(out.b).toEqual({ anchorImage: img(9), sceneImages: [], motionVideos: [] });
  });

  it("1109 模型可选：单类上限读漫剧引擎表；HappyHorse 不收参考视频/音频，不入 MV", () => {
    expect(mvShotReferenceLimits("wan-3.0")).toEqual({ image: 10, video: 5, audio: 5 });
    expect(mvShotReferenceLimits("minimax-hailuo-3")).toEqual({ image: 9, video: 3, audio: 3 });
    expect(mvShotReferenceLimits("2.5")).toEqual({ image: 30, video: 10, audio: 10 });
    expect(isMvShotEngineSupported("seedance-2.0-fast")).toBe(true);
    expect(isMvShotEngineSupported("happyhorse-1.1")).toBe(false);
    expect(mvShotReferenceGaps(full, "happyhorse-1.1").blocking[0]!.messageZh).toContain("不支持");
  });

  it("1109 站位参考必填：复杂镜头缺 @视频 即阻断", () => {
    const noMotion = { ...full, motionVideos: [] };
    expect(mvShotReferenceGaps(noMotion).blocking).toEqual([]);
    expect(mvShotReferenceGaps(noMotion, "2.0-mini", { requiresStaging: true }).blocking.map(g => g.messageZh)).toContain("该镜需白模站位或实拍运镜参考");
    expect(() => assembleMvShotReferences(noMotion, shot, "2.0-mini", { requiresStaging: true })).toThrow(/该镜需白模站位或实拍运镜参考/);
    expect(() => assembleMvShotReferences(full, shot, "2.0-mini", { requiresStaging: true })).not.toThrow();
  });
});
