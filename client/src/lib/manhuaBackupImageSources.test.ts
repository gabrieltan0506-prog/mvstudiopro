import { describe, expect, it } from "vitest";
import { buildManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import { collectManhuaBackupImageSources } from "./manhuaBackupImageSources";

const url = (name: string) => `https://test.invalid/${name}.png`;

describe("工作区备份图片来源", () => {
  it("从真实快照收齐节点历史、三态候选、两份资产和四格场景，不改原稿", () => {
    const refs = ["常态", "过程", "完全体"].map((name, index) => ({
      id: `motu-${index}`,
      role: "character" as const,
      url: url(name),
      labelZh: name,
      claimedAnchorIds: ["motu"],
    }));
    const payload = buildManhuaCloudDraftPayload({
      writerSession: { customAssetRefs: refs },
      blocks: [
        {
          id: "keyart-e01-s01",
          kind: "image",
          prompt: "墨屠护住阿菁",
          x: 0,
          y: 0,
          width: 160,
          height: 200,
          outputUrl: url("当前静帧"),
          outputUrls: [url("旧静帧"), url("常态")],
          refImageUrl: url("底图"),
          editMaskUrl: url("遮罩"),
          lastFrameUrl: url("接续帧"),
          editFusionUrls: [url("融图")],
        },
      ],
      edges: [],
      factoryPrefs: {
        customAssetRefs: [
          ...refs,
          { id: "aqing", role: "character", url: url("阿菁") },
          {
            id: "scene",
            role: "scene",
            url: url("场景主图"),
            gcsUri: "gs://test-bucket/scene.png",
            tileUrls: {
              topLeft: url("俯视"),
              topRight: url("平视"),
              bottomLeft: url("侧视"),
              bottomRight: url("背视"),
            },
            model3d: { glbUrl: "https://test.invalid/model.glb" },
          },
        ],
      },
    });
    const before = JSON.stringify(payload);
    const result = collectManhuaBackupImageSources(payload);
    expect(result.map(item => item.sourceUrl)).toEqual(
      [
        "当前静帧",
        "底图",
        "遮罩",
        "接续帧",
        "旧静帧",
        "常态",
        "融图",
        "过程",
        "完全体",
        "阿菁",
        "场景主图",
        "俯视",
        "平视",
        "侧视",
        "背视",
      ].map(url)
    );
    expect(result.find(item => item.sourceUrl === url("场景主图"))).toEqual({
      sourceUrl: url("场景主图"),
      gcsUri: "gs://test-bucket/scene.png",
    });
    expect(result.find(item => item.sourceUrl === url("俯视"))).toEqual({
      sourceUrl: url("俯视"),
    });
    expect(JSON.stringify(payload)).toBe(before);
  });

  it("保留导演板新旧字段与仅有长期身份的板图，重复URL补齐长期身份", () => {
    const payload = buildManhuaCloudDraftPayload({
      writerSession: {},
      blocks: [],
      edges: [],
      factoryPrefs: {
        customAssetRefs: [{ id: "board-copy", url: url("主板") }],
        directorBoardMainByEpisode: {
          1: { url: url("主板"), gcsUri: "gs://test-bucket/main.png" },
          2: url("旧主板"),
          3: { gcsUri: "gs://test-bucket/only-main.png" },
        },
        directorBoardBySegment: {
          1: {
            1: { url: url("分段板"), gcsUri: "gs://test-bucket/segment.png" },
            2: "gs://test-bucket/only-segment.png",
            3: url("旧分段板"),
          },
        },
        directorBoardMotionOverlayBySegment: {
          1: { 1: { url: url("非图片轨迹") } },
        },
      },
    });
    expect(collectManhuaBackupImageSources(payload)).toEqual([
      { sourceUrl: url("主板"), gcsUri: "gs://test-bucket/main.png" },
      { sourceUrl: url("旧主板") },
      {
        sourceUrl: "gs://test-bucket/only-main.png",
        gcsUri: "gs://test-bucket/only-main.png",
      },
      { sourceUrl: url("分段板"), gcsUri: "gs://test-bucket/segment.png" },
      {
        sourceUrl: "gs://test-bucket/only-segment.png",
        gcsUri: "gs://test-bucket/only-segment.png",
      },
      { sourceUrl: url("旧分段板") },
    ]);
  });

  it("空旧稿不造来源，不扫描视频、音轨和GLB字段", () => {
    const payload = buildManhuaCloudDraftPayload({
      writerSession: {},
      edges: [],
      blocks: [
        {
          id: "clip-e01-s01",
          kind: "video",
          prompt: "测试",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          outputUrl: "https://test.invalid/clip.mp4",
          refImageUrl: url("视频节点参考"),
        },
      ],
      factoryPrefs: {
        customAssetRefs: [
          {
            id: "empty",
            url: "  ",
            tileUrls: null,
            model3d: { glbUrl: "https://test.invalid/model.glb" },
          },
        ],
        audioReferenceLock: { url: "https://test.invalid/audio.mp3" },
      },
    });
    expect(collectManhuaBackupImageSources(payload)).toEqual([]);
    expect(
      collectManhuaBackupImageSources(
        buildManhuaCloudDraftPayload({
          writerSession: {},
          blocks: [],
          edges: [],
        })
      )
    ).toEqual([]);
  });

  it("不截断候选数量，仅按去空白后的原URL去重", () => {
    const candidates = Array.from({ length: 101 }, (_, i) => ({
      id: String(i),
      url: url(`候选${i}`),
    }));
    const payload = buildManhuaCloudDraftPayload({
      writerSession: {},
      blocks: [],
      edges: [],
      factoryPrefs: {
        customAssetRefs: [
          ...candidates,
          { id: "duplicate", url: ` ${url("候选0")} ` },
        ],
      },
    });
    const sources = collectManhuaBackupImageSources(payload);
    expect(sources).toHaveLength(101);
    expect(sources[100]).toEqual({ sourceUrl: url("候选100") });
  });
});
