import { beforeEach, describe, expect, it, vi } from "vitest";

const gcs = vi.hoisted(() => ({
  create: vi.fn(),
  upload: vi.fn(),
  downloadVersioned: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
}));

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "bucket-a",
  uploadBufferToGcsIfAbsent: gcs.create,
  uploadBufferToGcs: gcs.upload,
  downloadGcsObjectVersioned: gcs.downloadVersioned,
  deleteGcsObject: gcs.remove,
  listGcsObjectNamesByPrefix: gcs.list,
}));

import {
  acquireNativeDeepReadEpisodeClaim,
  isNativeDeepReadClaimReclaimable,
  listNativeDeepReadEpisodeClaimStates,
  listNativeDeepReadEpisodeClaims,
  nativeDeepReadClaimObjectName,
  recordNativeDeepReadClaimFailure,
  takeoverNativeDeepReadEpisodeClaim,
} from "./manhuaNativeDeepReadClaim";

beforeEach(() => {
  vi.clearAllMocks();
  gcs.create.mockResolvedValue({ created: true });
  gcs.downloadVersioned.mockImplementation(async () => {
    const payload = JSON.parse(gcs.create.mock.calls[0]![0].buffer.toString("utf8"));
    return {
      buffer: Buffer.from(JSON.stringify({ runId: payload.runId })),
      bucket: "bucket-a",
      objectName: "claim.json",
      generation: "77",
    };
  });
  gcs.remove.mockResolvedValue(undefined);
  gcs.upload.mockResolvedValue({ gcsUri: "gs://bucket-a/claim.json" });
  gcs.list.mockResolvedValue([]);
});

describe("原生精读单集占位", () => {
  it("模型运行前条件创建，成功入库后按 generation 删除", async () => {
    const claim = await acquireNativeDeepReadEpisodeClaim("series_a", 3);
    expect(gcs.create).toHaveBeenCalledWith(expect.objectContaining({
      bucket: "bucket-a",
      objectName: "manhua-template-learn/native-claims/tpl_native_series_a_ep003.json",
    }));
    await claim.releaseAfterSuccess();
    expect(gcs.remove).toHaveBeenCalledWith({
      bucket: "bucket-a",
      objectName: "manhua-template-learn/native-claims/tpl_native_series_a_ep003.json",
      ifGenerationMatch: "77",
    });
  });

  it("对象已存在时停止，不读取或删除现有占位", async () => {
    gcs.create.mockResolvedValue({ created: false });
    await expect(acquireNativeDeepReadEpisodeClaim("series_a", 3)).rejects.toThrow("禁止自动重跑");
    expect(gcs.downloadVersioned).not.toHaveBeenCalled();
    expect(gcs.remove).not.toHaveBeenCalled();
  });

  it("条件创建响应已带 generation 时不再回读；回读通道故障不会留下无 handle 孤儿", async () => {
    gcs.create.mockResolvedValue({ created: true, generation: "91" });
    gcs.downloadVersioned.mockRejectedValue(new Error("gcs_stat_failed:503:temporary"));
    const claim = await acquireNativeDeepReadEpisodeClaim("series_a", 1);
    expect(gcs.downloadVersioned).not.toHaveBeenCalled();
    await claim.releaseBeforePaidCall();
    expect(gcs.remove).toHaveBeenCalledWith(expect.objectContaining({ ifGenerationMatch: "91" }));
  });

  it("条件创建已落对象但响应中断时，按同一 runId 回读取得可释放 handle", async () => {
    gcs.create.mockRejectedValue(new Error("gcs_upload_failed:503:response lost"));
    gcs.downloadVersioned.mockImplementation(async () => {
      const payload = JSON.parse(gcs.create.mock.calls[0]![0].buffer.toString("utf8"));
      return {
        buffer: Buffer.from(JSON.stringify({ runId: payload.runId })),
        bucket: "bucket-a",
        objectName: "claim.json",
        generation: "92",
      };
    });
    const claim = await acquireNativeDeepReadEpisodeClaim("series_a", 2);
    await claim.releaseBeforePaidCall();
    expect(gcs.remove).toHaveBeenCalledWith(expect.objectContaining({ ifGenerationMatch: "92" }));
  });

  it("干跑可列出当前合集的待核对集号", async () => {
    gcs.list.mockResolvedValue([
      nativeDeepReadClaimObjectName("series_a", 1),
      nativeDeepReadClaimObjectName("series_a", 20),
      "manhua-template-learn/native-claims/other.json",
    ]);
    await expect(listNativeDeepReadEpisodeClaims("series_a")).resolves.toEqual(new Set([1, 20]));
    expect(gcs.list).toHaveBeenCalledWith(expect.objectContaining({ literalPrefix: true }));
  });

  it("失败病历只按本轮 runId 与读到的 generation 条件写回", async () => {
    gcs.downloadVersioned.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify({ runId: "run-current", createdAt: "2026-08-26T00:00:00Z" })),
      bucket: "bucket-a",
      objectName: "claim.json",
      generation: "88",
    });
    await recordNativeDeepReadClaimFailure("series_a", 3, "run-current", "音轨字段不完整");
    expect(gcs.upload).toHaveBeenCalledWith(expect.objectContaining({
      bucket: "bucket-a",
      objectName: "manhua-template-learn/native-claims/tpl_native_series_a_ep003.json",
      ifGenerationMatch: "88",
    }));
    const saved = JSON.parse(gcs.upload.mock.calls[0]![0].buffer.toString("utf8"));
    expect(saved).toMatchObject({
      runId: "run-current",
      createdAt: "2026-08-26T00:00:00Z",
      lastErrorZh: "音轨字段不完整",
    });
  });

  it("旧任务失败回执晚到时不得覆盖新 runId 的占位", async () => {
    gcs.downloadVersioned.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify({ runId: "run-new" })),
      bucket: "bucket-a",
      objectName: "claim.json",
      generation: "89",
    });
    await recordNativeDeepReadClaimFailure("series_a", 3, "run-old", "旧任务晚到");
    expect(gcs.upload).not.toHaveBeenCalled();
  });

  it("病历回读只有 404 可视为已释放；503 不得静默伪装补写成功", async () => {
    gcs.downloadVersioned.mockRejectedValueOnce(new Error("gcs_stat_failed:404:not found"));
    await expect(recordNativeDeepReadClaimFailure("series_a", 3, "run-a", "失败"))
      .resolves.toBeUndefined();
    gcs.downloadVersioned.mockRejectedValueOnce(new Error("gcs_stat_failed:503:temporary"));
    await expect(recordNativeDeepReadClaimFailure("series_a", 3, "run-a", "失败"))
      .rejects.toThrow("gcs_stat_failed:503");

    gcs.downloadVersioned.mockResolvedValueOnce({
      buffer: Buffer.from("[]"),
      bucket: "bucket-a",
      objectName: "claim.json",
      generation: "93",
    });
    await expect(recordNativeDeepReadClaimFailure("series_a", 3, "run-a", "失败"))
      .rejects.toThrow("占位内容不是对象");
  });

  it("旧格式仅有 lastErrorZh 也属于已失败；单靠创建时间再旧也不能证明可接管", () => {
    expect(isNativeDeepReadClaimReclaimable({ lastErrorZh: "旧拒因", lastFailedAtIso: null }))
      .toBe(true);
    expect(isNativeDeepReadClaimReclaimable({ lastErrorZh: null, lastFailedAtIso: null }))
      .toBe(false);
  });

  it("列表后占位已释放的 404 直接省略；非 404 故障保守隔离", async () => {
    gcs.list.mockResolvedValue([nativeDeepReadClaimObjectName("series_a", 1)]);
    gcs.downloadVersioned.mockRejectedValueOnce(new Error("gcs_stat_failed:404:not found"));
    await expect(listNativeDeepReadEpisodeClaimStates("series_a")).resolves.toEqual(new Map());

    gcs.downloadVersioned.mockRejectedValueOnce(new Error("gcs_stat_failed:503:temporary"));
    await expect(listNativeDeepReadEpisodeClaimStates("series_a")).resolves.toEqual(new Map([[
      1,
      {
        episodeIndex: 1,
        generation: "",
        createdAtIso: null,
        lastErrorZh: null,
        lastFailedAtIso: null,
      },
    ]]));
  });

  it("失败病历按旧 generation 删除后原子新建；条件删除冲突时不新建", async () => {
    gcs.downloadVersioned.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify({ runId: "old", lastFailedAtIso: "2026-08-26T01:00:00Z" })),
      bucket: "bucket-a",
      objectName: nativeDeepReadClaimObjectName("series_a", 1),
      generation: "80",
    });
    gcs.create.mockResolvedValue({ created: true, generation: "81" });
    const claim = await takeoverNativeDeepReadEpisodeClaim("series_a", 1);
    expect(gcs.remove).toHaveBeenCalledWith(expect.objectContaining({ ifGenerationMatch: "80" }));
    await claim.releaseAfterSuccess();
    expect(gcs.remove).toHaveBeenLastCalledWith(expect.objectContaining({ ifGenerationMatch: "81" }));

    vi.clearAllMocks();
    gcs.downloadVersioned.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify({ lastErrorZh: "failed" })),
      bucket: "bucket-a",
      objectName: "claim.json",
      generation: "82",
    });
    gcs.remove.mockRejectedValue(new Error("gcs_delete_generation_conflict"));
    await expect(takeoverNativeDeepReadEpisodeClaim("series_a", 1)).rejects.toThrow();
    expect(gcs.create).not.toHaveBeenCalled();
  });

  it("接管回读非 404 故障关闭式停止，不猜占位已消失", async () => {
    gcs.downloadVersioned.mockRejectedValue(new Error("gcs_stat_failed:503:temporary"));
    await expect(takeoverNativeDeepReadEpisodeClaim("series_a", 1))
      .rejects.toThrow("gcs_stat_failed:503");
    expect(gcs.create).not.toHaveBeenCalled();
  });
});
