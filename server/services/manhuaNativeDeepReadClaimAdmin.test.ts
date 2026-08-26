import { beforeEach, describe, expect, it, vi } from "vitest";

const gcs = vi.hoisted(() => ({
  list: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "bucket-a",
  listGcsObjectNamesByPrefix: gcs.list,
  downloadGcsObjectVersioned: gcs.download,
  deleteGcsObject: gcs.remove,
}));

import {
  discardNativeDeepReadClaimForEpisode,
  listNativeDeepReadClaimAdminRows,
} from "./manhuaNativeDeepReadClaimAdmin";
import { nativeDeepReadClaimObjectName } from "./manhuaNativeDeepReadClaim";

beforeEach(() => {
  vi.clearAllMocks();
  gcs.list.mockResolvedValue([nativeDeepReadClaimObjectName("series_a", 3)]);
  gcs.download.mockResolvedValue({
    buffer: Buffer.from(JSON.stringify({
      runId: "run-3",
      createdAt: "2026-08-26T01:02:03.000Z",
      lastErrorZh: "结构未通过",
    })),
    bucket: "bucket-a",
    objectName: nativeDeepReadClaimObjectName("series_a", 3),
    generation: "77",
  });
  gcs.remove.mockResolvedValue(undefined);
});

describe("原生精读占位管理", () => {
  it("列表下发读取时的 generation，供点击弃置时做并发保护", async () => {
    await expect(listNativeDeepReadClaimAdminRows("series_a")).resolves.toEqual([{
      episodeIndex: 3,
      claimGeneration: "77",
      createdAtIso: "2026-08-26T01:02:03.000Z",
      lastErrorZh: "结构未通过",
      lastFailedAtIso: null,
      reclaimable: true,
    }]);
  });

  it("弃置只删除 UI 列表看到的 generation，不重新读取并误删新任务", async () => {
    await discardNativeDeepReadClaimForEpisode("series_a", 3, "77");
    expect(gcs.download).not.toHaveBeenCalled();
    expect(gcs.remove).toHaveBeenCalledWith({
      bucket: "bucket-a",
      objectName: nativeDeepReadClaimObjectName("series_a", 3),
      ifGenerationMatch: "77",
    });
  });

  it("占位已经换代时给出刷新提示，不把冲突当成删除成功", async () => {
    gcs.remove.mockRejectedValue(new Error("gcs_delete_generation_conflict"));
    await expect(discardNativeDeepReadClaimForEpisode("series_a", 3, "77"))
      .rejects.toThrow("占位已变化，请刷新后重试");
  });
});
