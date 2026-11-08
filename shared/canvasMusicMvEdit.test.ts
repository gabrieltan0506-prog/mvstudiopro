import { describe, it, expect } from "vitest";
import {
  musicMvEditKey,
  musicMvEditDocumentSchema,
  commitMusicMvEdit,
  reorderMusicMvClip,
  splitMusicMvClip,
  trimMusicMvClip,
  undoMusicMvEdit,
  redoMusicMvEdit,
  musicMvEditIssues,
  musicMvEditPositions,
  bindMusicMvStockFootage,
  isMusicMvStockSource,
  musicMvClipMatchesShot,
  type MusicMvEditSession,
} from "./canvasMusicMvEdit";
import { canvasMusicMvPlanSchema } from "./canvasMusicMv";
const doc = () =>
  musicMvEditDocumentSchema.parse({
    version: 1,
    fps: 30,
    basePlanRequestId: "11111111-1111-4111-8111-111111111111",
    audioId: "song",
    audioDurationSec: 10,
    clips: [
      {
        id: "a",
        shotId: "a",
        blockId: "block-a",
        title: "人物",
        kind: "singing",
        sourceInFrame: 0,
        durationFrames: 150,
        source: { url: "gs://bucket/a.mp4", durationSec: 8 },
      },
      {
        id: "b",
        shotId: "b",
        blockId: "block-b",
        title: "空镜",
        kind: "generated",
        sourceInFrame: 30,
        durationFrames: 150,
        source: { url: "gs://bucket/b.mp4", durationSec: 10 },
      },
    ],
  });
const plan = canvasMusicMvPlanSchema.parse({
  version: 1,
  audioId: "song",
  audioDurationSec: 10,
  analysisBasis: "lyrics_and_user_description",
  shots: [
    {
      id: "a",
      kind: "singing",
      startSec: 0,
      endSec: 5,
      visualPrompt: "人物",
      cameraPrompt: "静止",
      lyricQuote: "",
      referenceIndices: [0],
    },
    {
      id: "b",
      startSec: 5,
      endSec: 10,
      visualPrompt: "空镜",
      cameraPrompt: "静止",
      lyricQuote: "",
      referenceIndices: [],
    },
  ],
});
describe("真实剪辑决定", () => {
  it("续签不改变GCS身份，但外部地址查询参数属于身份", () => {
    const a = doc(),
      b = doc();
    a.clips[0].source!.url =
      "https://storage.googleapis.com/bucket/a.mp4?X-Goog-Signature=old";
    b.clips[0].source!.url = "gs://bucket/a.mp4";
    expect(musicMvEditKey(a)).toBe(musicMvEditKey(b));
    a.clips[0].source!.url = "https://example.test/video?id=1";
    b.clips[0].source!.url = "https://example.test/video?id=2";
    expect(musicMvEditKey(a)).not.toBe(musicMvEditKey(b));
  });
  it("分割保留原源裁点并完整覆盖歌曲，演唱不失步", () => {
    const original = doc();
    const next = splitMusicMvClip(original, "a", 60, "a2");
    expect(
      next.clips.map(c => [c.id, c.sourceInFrame, c.durationFrames])
    ).toEqual([
      ["a", 0, 60],
      ["a2", 60, 90],
      ["b", 30, 150],
    ]);
    expect(musicMvEditIssues(next, plan)).toEqual([]);
    expect(original.clips).toHaveLength(2);
  });
  it("移位演唱检出错位，缩短片段检出歌曲缺口", () => {
    expect(
      musicMvEditIssues(reorderMusicMvClip(doc(), "a", 1), plan).join()
    ).toContain("偏离原唱段");
    expect(
      musicMvEditIssues(trimMusicMvClip(doc(), "b", 30, 90), plan).join()
    ).toContain("还缺 2.00 秒");
  });
  it("手动裁点拒绝越界、过短和重复身份", () => {
    expect(() => trimMusicMvClip(doc(), "b", 200, 150)).toThrow("裁点超出");
    expect(() => splitMusicMvClip(doc(), "b", 5, "c")).toThrow("至少0.5秒");
    expect(() => splitMusicMvClip(doc(), "b", 60, "a")).toThrow("重复");
  });
  it("多步编辑及撤销重做可JSON往返，不覆盖保存版本", () => {
    const start: MusicMvEditSession = {
      draft: doc(),
      undo: [],
      redo: [],
      versions: [],
    };
    const changed = commitMusicMvEdit(
      start,
      reorderMusicMvClip(start.draft, "a", 1)
    );
    const next = commitMusicMvEdit(
      changed,
      trimMusicMvClip(changed.draft, "b", 0, 120)
    );
    const restored = JSON.parse(JSON.stringify(next));
    expect(undoMusicMvEdit(undoMusicMvEdit(restored)).draft).toEqual(
      start.draft
    );
    expect(redoMusicMvEdit(undoMusicMvEdit(restored)).draft).toEqual(
      next.draft
    );
    expect(musicMvEditPositions(next.draft).map(x => x.startFrame)).toEqual([
      0, 120,
    ]);
  });
});

const stockAsset = {
  assetId: `sf_${"a".repeat(48)}`,
  gcsUri: "gs://bucket/stock-footage/7/sf_a.mp4",
  kind: "video" as const,
  purpose: "mv" as const,
  usage: "insert" as const,
  durationSec: 12.4,
};
describe("图库素材绑定到MV片段", () => {
  it("正向：生成镜头换成素材切片，绑定资产身份与源时长内裁点，可JSON往返", () => {
    const next = bindMusicMvStockFootage(doc(), "b", stockAsset);
    const clip = next.clips[1];
    expect(clip.kind).toBe("footage");
    expect(clip.source).toEqual({
      url: stockAsset.gcsUri,
      taskId: stockAsset.assetId,
      durationSec: 12.4,
    });
    expect(clip.sourceInFrame).toBe(0);
    expect(clip.durationFrames).toBe(150);
    expect(next.clips[0]).toEqual(doc().clips[0]);
    expect(isMusicMvStockSource(clip.source)).toBe(true);
    expect(musicMvEditDocumentSchema.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
    // 计划里是 generated，仍视为同一镜头；剪辑问题清单不报来源不一致。
    expect(musicMvEditIssues(next, plan).join()).not.toContain("来源不一致");
  });
  it("正向：素材短于片段时收缩到素材可用帧，缺口交给剪辑问题提示", () => {
    const next = bindMusicMvStockFootage(doc(), "b", { ...stockAsset, durationSec: 3.99 });
    expect(next.clips[1].durationFrames).toBe(119);
    expect(musicMvEditIssues(next, plan).join()).toContain("还缺");
  });
  it("反向：裁点超出图库素材向下取整帧数被拒绝", () => {
    const next = bindMusicMvStockFootage(doc(), "b", { ...stockAsset, durationSec: 5.01 });
    expect(next.clips[1].durationFrames).toBe(150);
    expect(() => trimMusicMvClip(next, "b", 1, 150)).toThrow("裁点超出");
  });
  it("反向：对口型、参考图、非MV用途、照片、缺时长、过短或非gs地址一律拒绝", () => {
    expect(() => bindMusicMvStockFootage(doc(), "a", stockAsset)).toThrow("对口型");
    expect(() => bindMusicMvStockFootage(doc(), "x", stockAsset)).toThrow("不存在");
    for (const bad of [
      { usage: "reference" as const },
      { purpose: "marketing" as const },
      { kind: "photo" as const },
      { assetId: "sf_123" },
      { gcsUri: "https://videos.pexels.com/a.mp4" },
    ])
      expect(() => bindMusicMvStockFootage(doc(), "b", { ...stockAsset, ...bad })).toThrow("MV");
    expect(() => bindMusicMvStockFootage(doc(), "b", { ...stockAsset, durationSec: undefined })).toThrow("时长");
    expect(() => bindMusicMvStockFootage(doc(), "b", { ...stockAsset, durationSec: 0.4 })).toThrow("0.5秒");
  });
  it("反向：文档层拒绝图库源挂在非素材片段或存签名地址", () => {
    const raw = JSON.parse(JSON.stringify(doc()));
    raw.clips[1].source = { url: stockAsset.gcsUri, taskId: stockAsset.assetId, durationSec: 12 };
    expect(() => musicMvEditDocumentSchema.parse(raw)).toThrow("素材切片");
    raw.clips[1].kind = "footage";
    raw.clips[1].source.url = "https://storage.googleapis.com/bucket/a.mp4?X-Goog-Signature=1";
    expect(() => musicMvEditDocumentSchema.parse(raw)).toThrow("永久存储");
  });
  it("镜头匹配：只有非对口型镜头可被图库素材替换", () => {
    const stockClip = { kind: "footage" as const, source: { url: stockAsset.gcsUri, taskId: stockAsset.assetId, durationSec: 12 } };
    expect(musicMvClipMatchesShot({}, stockClip)).toBe(true);
    expect(musicMvClipMatchesShot({ kind: "footage" }, stockClip)).toBe(true);
    expect(musicMvClipMatchesShot({ kind: "singing" }, stockClip)).toBe(false);
    expect(musicMvClipMatchesShot({}, { kind: "footage", source: { url: "gs://b/x.mp4", taskId: "canvas-task", durationSec: 5 } })).toBe(false);
  });
});
