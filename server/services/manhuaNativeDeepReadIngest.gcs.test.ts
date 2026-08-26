/**
 * 入库与断点续跑的 GCS 行为。
 *
 * 纯函数测试覆盖不到这一层——早前的结构化演练全绿，问题却全在这里：
 * prefix 被补斜线导致续跑恒空、未知状态被当成未跑、无条件上传互相覆盖。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gcs = vi.hoisted(() => ({
  list: vi.fn(),
  download: vi.fn(),
  downloadVersioned: vi.fn(),
  create: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "bucket-a",
  listGcsObjectNamesByPrefix: gcs.list,
  downloadGcsObject: gcs.download,
  downloadGcsObjectVersioned: gcs.downloadVersioned,
  uploadBufferToGcsIfAbsent: gcs.create,
  uploadBufferToGcs: gcs.upload,
}));

import {
  buildNativeDeepReadProposalCard,
  ingestNativeDeepReadEpisode,
  listIngestedNativeDeepReadEpisodeRecords,
  listIngestedNativeDeepReadEpisodes,
  nativeDeepReadProposalObjectName,
  type NativeDeepReadIngestInput,
  type NativeDeepReadIngestSource,
} from "./manhuaNativeDeepReadIngest";
import { noAudioManhuaNativeAnalysis } from "../../shared/manhuaNativeAudioAnalysis";

function makeInput(over: Partial<NativeDeepReadIngestInput> = {}): NativeDeepReadIngestInput {
  const beatGrid = Array.from({ length: 6 }, (_, i) => ({
    atSec: i,
    endSec: i + 1,
    conflictZh: "冲突推进",
    visualZh: `动作${i}`,
  }));
  const result: NativeDeepReadIngestSource = {
    beatGrid,
    subtitleTrack: [],
    resolvedAudioChunks: [],
    classification: {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: ["信息递进"],
      performanceTagsZh: ["克制爆发"],
      audiovisualTagsZh: ["冷暖对撞"],
      audienceExperienceTagsZh: ["持续紧张"],
    },
    audioAnalysis: noAudioManhuaNativeAnalysis(120),
    reusableZh: "通用手法",
    genPromptHintZh: "生成要素",
    segmentCount: 2,
    shotCount: 6,
    failedSegmentCount: 0,
    droppedCount: 0,
    truncated: false,
    model: "qwen3.8-max",
    attemptedSegments: 2,
    usingPlanQuota: true,
    usage: { costCny: 0.5 },
    completedSegmentIndexes: [0, 1],
    sourceDigest: "a".repeat(64),
    segmentSnapshotSha256: "b".repeat(64),
    assemblyComplete: true,
  };
  return {
    seriesKey: "abc123",
    episodeIndex: 1,
    sourceUrl: "https://example.com/ep1",
    result,
    ...over,
  };
}

function storedCardBuffer(): Buffer {
  const card = buildNativeDeepReadProposalCard(makeInput());
  if (!card) throw new Error("fixture card invalid");
  return Buffer.from(JSON.stringify(card));
}

beforeEach(() => {
  gcs.list.mockReset();
  gcs.download.mockReset();
  gcs.downloadVersioned.mockReset();
  gcs.create.mockReset();
  gcs.upload.mockReset();
  gcs.downloadVersioned.mockImplementation(async (params) => ({
    ...(await gcs.download(params)),
    generation: "1",
  }));
});

describe("断点续跑", () => {
  it("按文件名前缀列举并识别已完成集", async () => {
    gcs.list.mockResolvedValue([nativeDeepReadProposalObjectName("abc123", 1)]);
    gcs.download.mockResolvedValue({ buffer: storedCardBuffer() });
    await expect(listIngestedNativeDeepReadEpisodes("abc123")).resolves.toEqual(new Set([1]));
    // 必须 literalPrefix：否则查的是 `..._ep/`，永远匹配不到 ep001.json
    expect(gcs.list).toHaveBeenCalledWith({
      prefix: "manhua-template-learn/proposals/tpl_native_abc123_ep",
      // 集号范围 1–999，默认必须列满：200 是「单批发车上限」，
      // 拿它当「系列累计上限」会让第 201 集起被当成没跑过、重新付费
      maxResults: 999,
      literalPrefix: true,
    });
  });

  it("逐集记录保留**稳定来源**，供同名单源判断续跑还是追加", async () => {
    // 只有集号不够：native 不产 digest，同名剧再导入一个视频时
    // 要靠稳定来源判断这是同一素材续跑，还是新素材该追加到下一集号
    gcs.list.mockResolvedValue([nativeDeepReadProposalObjectName("abc123", 1)]);
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(
        JSON.stringify(buildNativeDeepReadProposalCard(makeInput({ episodeIndex: 1 }))),
        "utf8",
      ),
    });
    const rows = await listIngestedNativeDeepReadEpisodeRecords("abc123");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.episodeIndex).toBe(1);
    expect(rows[0]!.sourceUrl).toBeTruthy();
  });

  it("卡片没有稳定来源时按无效处理，不静默放行", async () => {
    gcs.list.mockResolvedValue([nativeDeepReadProposalObjectName("abc123", 1)]);
    const card = buildNativeDeepReadProposalCard(makeInput({ episodeIndex: 1 })) as Record<string, unknown>;
    gcs.download.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify({ ...card, sourceRefs: [] }), "utf8"),
    });
    await expect(listIngestedNativeDeepReadEpisodeRecords("abc123")).rejects.toThrow(
      /已停止续跑/,
    );
  });

  it("列表状态未知时停止续跑，不把未知当作全部未跑（否则 20 集重烧一遍）", async () => {
    gcs.list.mockRejectedValue(new Error("gcs_list_failed:503"));
    await expect(listIngestedNativeDeepReadEpisodes("abc123")).rejects.toThrow("避免重复精读");
    expect(gcs.download).not.toHaveBeenCalled();
  });

  it("已有对象读取失败时停止续跑", async () => {
    gcs.list.mockResolvedValue([nativeDeepReadProposalObjectName("abc123", 1)]);
    gcs.download.mockRejectedValue(new Error("gcs_download_failed:503"));
    await expect(listIngestedNativeDeepReadEpisodes("abc123")).rejects.toThrow("停止续跑");
  });

  it("对象存在但内容无效时停手交人工，不自动当成没跑过", async () => {
    gcs.list.mockResolvedValue([nativeDeepReadProposalObjectName("abc123", 1)]);
    gcs.download.mockResolvedValue({ buffer: Buffer.from("{}") });
    await expect(listIngestedNativeDeepReadEpisodes("abc123")).rejects.toThrow("无法确认内容");
  });

  it("旧版原生卡缺五维分类或声音结构时在付费续跑前关闭式停止", async () => {
    const current = JSON.parse(storedCardBuffer().toString("utf8")) as Record<string, unknown>;
    delete current.audioStory;
    gcs.list.mockResolvedValue([nativeDeepReadProposalObjectName("abc123", 1)]);
    gcs.download.mockResolvedValue({ buffer: Buffer.from(JSON.stringify(current)) });
    await expect(listIngestedNativeDeepReadEpisodes("abc123"))
      .rejects.toThrow("旧版卡需先处理后重学");
  });

  it("别的合集的卡不会被算进本合集已完成", async () => {
    gcs.list.mockResolvedValue([nativeDeepReadProposalObjectName("zzz999", 4)]);
    await expect(listIngestedNativeDeepReadEpisodes("abc123")).resolves.toEqual(new Set());
    expect(gcs.download).not.toHaveBeenCalled();
  });
});

describe("入库写入", () => {
  it("首次写入使用条件创建", async () => {
    gcs.create.mockResolvedValue({ created: true });
    await expect(ingestNativeDeepReadEpisode(makeInput())).resolves.toMatchObject({
      created: true,
      objectName: "manhua-template-learn/proposals/tpl_native_abc123_ep001.json",
    });
    expect(gcs.create).toHaveBeenCalledTimes(1);
    expect(gcs.download).not.toHaveBeenCalled();
  });

  it("并发后到者复用先写入的有效卡，不覆盖", async () => {
    gcs.create.mockResolvedValue({ created: false });
    gcs.download.mockResolvedValue({ buffer: storedCardBuffer() });
    await expect(ingestNativeDeepReadEpisode(makeInput())).resolves.toMatchObject({
      created: false,
    });
    expect(gcs.create).toHaveBeenCalledTimes(1);
  });

  it("同名对象存在但内容无效时停止，不覆盖", async () => {
    gcs.create.mockResolvedValue({ created: false });
    gcs.download.mockResolvedValue({ buffer: Buffer.from("{}") });
    await expect(ingestNativeDeepReadEpisode(makeInput())).rejects.toThrow("未覆盖");
  });

  it("缺来源地址直接拒写，不产生不可追溯的卡", async () => {
    await expect(
      ingestNativeDeepReadEpisode(makeInput({ sourceUrl: "  " })),
    ).rejects.toThrow("来源地址");
    expect(gcs.create).not.toHaveBeenCalled();
  });

  it("部分提案按 1/2→2/2 单调 CAS 补全，不覆盖成倒退或分叉", async () => {
    const partial = makeInput({
      result: {
        ...makeInput().result,
        segmentCount: 1,
        failedSegmentCount: 1,
        completedSegmentIndexes: [0],
        assemblyComplete: false,
        segmentSnapshotSha256: "c".repeat(64),
      },
    });
    const previous = buildNativeDeepReadProposalCard(partial)!;
    gcs.create.mockResolvedValue({ created: false });
    gcs.downloadVersioned.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(previous), "utf8"),
      generation: "9",
    });
    gcs.upload.mockResolvedValue({});

    const completed = await ingestNativeDeepReadEpisode(makeInput());
    expect(completed.created).toBe(false);
    expect(completed.card.provenance?.nativeVideoDeepRead).toMatchObject({
      successSegments: 2,
      attemptedSegments: 2,
      completedSegmentIndexes: [0, 1],
      assemblyComplete: true,
    });
    expect(gcs.upload).toHaveBeenCalledWith(expect.objectContaining({
      ifGenerationMatch: "9",
      objectName: nativeDeepReadProposalObjectName("abc123", 1),
    }));

    gcs.upload.mockClear();
    gcs.downloadVersioned.mockResolvedValue({
      buffer: storedCardBuffer(),
      generation: "10",
    });
    await expect(ingestNativeDeepReadEpisode(partial)).rejects.toThrow(/倒退或分叉/);
    expect(gcs.upload).not.toHaveBeenCalled();
  });
});

describe("部分卡不冒充整集完成", () => {
  it("记录可列出供 UI 展示，但续学跳过集合只包含真正 2/2 完成的卡", async () => {
    const partialInput = makeInput({
      result: {
        ...makeInput().result,
        segmentCount: 1,
        failedSegmentCount: 1,
        completedSegmentIndexes: [0],
        assemblyComplete: false,
        segmentSnapshotSha256: "c".repeat(64),
      },
    });
    const partialCard = buildNativeDeepReadProposalCard(partialInput)!;
    gcs.list.mockResolvedValue([nativeDeepReadProposalObjectName("abc123", 1)]);
    gcs.download.mockResolvedValue({ buffer: Buffer.from(JSON.stringify(partialCard), "utf8") });

    await expect(listIngestedNativeDeepReadEpisodeRecords("abc123")).resolves.toEqual([
      expect.objectContaining({ episodeIndex: 1, complete: false, successSegments: 1, attemptedSegments: 2 }),
    ]);
    await expect(listIngestedNativeDeepReadEpisodes("abc123")).resolves.toEqual(new Set());
  });
});

describe("大系列断点：列举上限不能截断（重复付费风险）", () => {
  /** 造 n 张有效卡的列举结果与下载内容 */
  const seedCards = (indexes: number[]) => {
    const names = indexes.map((i) => nativeDeepReadProposalObjectName("abc123", i));
    gcs.list.mockResolvedValue(names);
    gcs.download.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => {
      const m = String(gcsUri).match(/_ep(\d{3})\.json$/);
      const idx = Number(m?.[1]);
      const card = buildNativeDeepReadProposalCard(makeInput({ episodeIndex: idx }));
      return { buffer: Buffer.from(JSON.stringify(card), "utf8") };
    });
  };

  it("🔴 201 张卡时第 201 集必须被识别为已入库（否则会重跑重付费）", async () => {
    const all = Array.from({ length: 201 }, (_, i) => i + 1);
    seedCards(all);
    const done = await listIngestedNativeDeepReadEpisodes("abc123");
    expect(done.size).toBe(201);
    expect(done.has(201)).toBe(true);
  });

  it("🔴 501 张卡时第 501 集必须被识别（通用列举原本硬钳 500）", async () => {
    const all = Array.from({ length: 501 }, (_, i) => i + 1);
    seedCards(all);
    const done = await listIngestedNativeDeepReadEpisodes("abc123");
    expect(done.has(501)).toBe(true);
  });

  it("任一张读不动就 fail-closed —— 把未知当没跑过等于重烧一遍", async () => {
    const all = Array.from({ length: 30 }, (_, i) => i + 1);
    seedCards(all);
    gcs.download.mockImplementationOnce(async () => {
      throw new Error("gcs_download_failed:503");
    });
    await expect(listIngestedNativeDeepReadEpisodes("abc123")).rejects.toThrow("已停止续跑");
  });
});
