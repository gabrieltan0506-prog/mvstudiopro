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
  create: vi.fn(),
}));

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "bucket-a",
  listGcsObjectNamesByPrefix: gcs.list,
  downloadGcsObject: gcs.download,
  uploadBufferToGcsIfAbsent: gcs.create,
}));

import {
  buildNativeDeepReadProposalCard,
  ingestNativeDeepReadEpisode,
  listIngestedNativeDeepReadEpisodes,
  nativeDeepReadProposalObjectName,
  type NativeDeepReadIngestInput,
  type NativeDeepReadIngestSource,
} from "./manhuaNativeDeepReadIngest";

function makeInput(over: Partial<NativeDeepReadIngestInput> = {}): NativeDeepReadIngestInput {
  const beatGrid = Array.from({ length: 6 }, (_, i) => ({
    atSec: i,
    endSec: i + 1,
    conflictZh: "冲突推进",
    visualZh: `动作${i}`,
  }));
  const result: NativeDeepReadIngestSource = {
    beatGrid,
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
  gcs.create.mockReset();
});

describe("断点续跑", () => {
  it("按文件名前缀列举并识别已完成集", async () => {
    gcs.list.mockResolvedValue([nativeDeepReadProposalObjectName("abc123", 1)]);
    gcs.download.mockResolvedValue({ buffer: storedCardBuffer() });
    await expect(listIngestedNativeDeepReadEpisodes("abc123")).resolves.toEqual(new Set([1]));
    // 必须 literalPrefix：否则查的是 `..._ep/`，永远匹配不到 ep001.json
    expect(gcs.list).toHaveBeenCalledWith({
      prefix: "manhua-template-learn/proposals/tpl_native_abc123_ep",
      maxResults: 200,
      literalPrefix: true,
    });
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
});
