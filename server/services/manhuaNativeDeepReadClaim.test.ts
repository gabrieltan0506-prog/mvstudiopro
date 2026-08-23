import { beforeEach, describe, expect, it, vi } from "vitest";

const gcs = vi.hoisted(() => ({
  create: vi.fn(),
  downloadVersioned: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
}));

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "bucket-a",
  uploadBufferToGcsIfAbsent: gcs.create,
  downloadGcsObjectVersioned: gcs.downloadVersioned,
  deleteGcsObject: gcs.remove,
  listGcsObjectNamesByPrefix: gcs.list,
}));

import {
  acquireNativeDeepReadEpisodeClaim,
  listNativeDeepReadEpisodeClaims,
  nativeDeepReadClaimObjectName,
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

  it("干跑可列出当前合集的待核对集号", async () => {
    gcs.list.mockResolvedValue([
      nativeDeepReadClaimObjectName("series_a", 1),
      nativeDeepReadClaimObjectName("series_a", 20),
      "manhua-template-learn/native-claims/other.json",
    ]);
    await expect(listNativeDeepReadEpisodeClaims("series_a")).resolves.toEqual(new Set([1, 20]));
    expect(gcs.list).toHaveBeenCalledWith(expect.objectContaining({ literalPrefix: true }));
  });
});
