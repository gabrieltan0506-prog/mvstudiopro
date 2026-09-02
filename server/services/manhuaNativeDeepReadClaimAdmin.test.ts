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
  sweepOrphanNativeDeepReadClaimsOnStartup,
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

describe("启动孤儿占位清扫", () => {
  const NOW = Date.parse("2026-09-02T06:00:00.000Z");
  const claimAt = (iso: string, extra: Record<string, unknown> = {}) => ({
    buffer: Buffer.from(JSON.stringify({ runId: "r", createdAt: iso, ...extra })),
    bucket: "bucket-a",
    objectName: "manhua-template-learn/native-claims/tpl_native_x_ep001.json",
    generation: "9",
  });

  it("重启后无病历的旧占位立即清除（条件删除带 generation）", async () => {
    gcs.list.mockResolvedValue(["manhua-template-learn/native-claims/tpl_native_x_ep001.json"]);
    gcs.download.mockResolvedValue(claimAt("2026-09-02T05:41:00.000Z"));
    await expect(sweepOrphanNativeDeepReadClaimsOnStartup(NOW)).resolves.toEqual({ swept: 1, kept: 0 });
    expect(gcs.remove).toHaveBeenCalledWith({
      bucket: "bucket-a",
      objectName: "manhua-template-learn/native-claims/tpl_native_x_ep001.json",
      ifGenerationMatch: "9",
    });
  });

  it("带失败病历的占位保留——面板要靠病历答「卡在哪」，它们本就自动让位", async () => {
    gcs.list.mockResolvedValue(["manhua-template-learn/native-claims/tpl_native_x_ep001.json"]);
    gcs.download.mockResolvedValue(claimAt("2026-09-02T04:00:00.000Z", { lastErrorZh: "门禁未过" }));
    await expect(sweepOrphanNativeDeepReadClaimsOnStartup(NOW)).resolves.toEqual({ swept: 0, kept: 1 });
    expect(gcs.remove).not.toHaveBeenCalled();
  });

  it("建立不足 2 分钟的占位跳过，防部署重叠窗口误杀新锁", async () => {
    gcs.list.mockResolvedValue(["manhua-template-learn/native-claims/tpl_native_x_ep001.json"]);
    gcs.download.mockResolvedValue(claimAt("2026-09-02T05:59:30.000Z"));
    await expect(sweepOrphanNativeDeepReadClaimsOnStartup(NOW)).resolves.toEqual({ swept: 0, kept: 1 });
    expect(gcs.remove).not.toHaveBeenCalled();
  });

  it("删除换代冲突按保留计，不当成清扫成功", async () => {
    gcs.list.mockResolvedValue(["manhua-template-learn/native-claims/tpl_native_x_ep001.json"]);
    gcs.download.mockResolvedValue(claimAt("2026-09-02T05:00:00.000Z"));
    gcs.remove.mockRejectedValue(new Error("gcs_delete_generation_conflict"));
    await expect(sweepOrphanNativeDeepReadClaimsOnStartup(NOW)).resolves.toEqual({ swept: 0, kept: 1 });
  });
});
