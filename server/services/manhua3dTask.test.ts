import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SubmitRejectedError,
  SubmitUnknownError,
} from "./submitOutcomeErrors.js";
import {
  assertGlbBuffer,
  createManhua3dTask,
  downloadGlb,
  getManhua3dTask,
  importExistingManhua3dAsset,
  retryManhua3dTask,
  resetManhua3dTaskDependenciesForTests,
  setManhua3dTaskDependenciesForTests,
} from "./manhua3dTask.js";

function chunkedResponse(
  chunks: Buffer[],
  closeAfterChunks = true
): {
  response: Response;
  cancelled: ReturnType<typeof vi.fn>;
} {
  const cancelled = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (!chunk) {
        if (closeAfterChunks) controller.close();
        return closeAfterChunks ? undefined : new Promise<void>(() => undefined);
      }
      controller.enqueue(chunk);
    },
    cancel(reason) {
      cancelled(reason);
    },
  });
  return { response: new Response(body, { status: 200 }), cancelled };
}

function validGlb(payload = Buffer.alloc(0)): Buffer {
  const json = Buffer.from('{"asset":{"version":"2.0"}}');
  const jsonPaddedLength = Math.ceil(json.byteLength / 4) * 4;
  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonPaddedLength, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);
  const jsonChunk = Buffer.concat([
    jsonChunkHeader,
    json,
    Buffer.alloc(jsonPaddedLength - json.byteLength, 0x20),
  ]);
  const binPaddedLength = Math.ceil(payload.byteLength / 4) * 4;
  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binPaddedLength, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4);
  const body = payload.byteLength
    ? Buffer.concat([
        jsonChunk,
        binChunkHeader,
        payload,
        Buffer.alloc(binPaddedLength - payload.byteLength),
      ])
    : jsonChunk;
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.byteLength + body.byteLength, 8);
  return Buffer.concat([header, body]);
}

function inspectedGlb(buffer: Buffer) {
  return {
    header: buffer.subarray(0, 12),
    byteLength: buffer.byteLength,
    sha256: "a".repeat(64),
    generation: "42",
  };
}

describe("manhua3dTask", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "manhua3d-task-test-"));
    vi.stubEnv("MANHUA_3D_TASK_DIR", dir);
    vi.stubEnv("WAVESPEED_API_KEY", "test-key");
  });

  afterEach(async () => {
    resetManhua3dTaskDependenciesForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("生成 GLB 按流读取并在累计超限时取消下载", async () => {
    const glb = validGlb(Buffer.from("streamed-mesh"));
    const accepted = chunkedResponse([
      glb.subarray(0, 7),
      glb.subarray(7, 19),
      glb.subarray(19),
    ]);
    const arrayBuffer = vi.spyOn(accepted.response, "arrayBuffer");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(accepted.response));

    await expect(
      downloadGlb("https://result.test/model.glb", glb.byteLength)
    ).resolves.toEqual(glb);
    expect(arrayBuffer).not.toHaveBeenCalled();

    const oversizedGlb = validGlb(Buffer.alloc(32));
    const oversized = chunkedResponse(
      [oversizedGlb.subarray(0, 8), oversizedGlb.subarray(8)],
      false
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(oversized.response));
    await expect(
      downloadGlb("https://result.test/oversized.glb", 12)
    ).rejects.toThrow("glb_too_large");
    expect(oversized.cancelled).toHaveBeenCalledTimes(1);
  });

  it("同用户、素材、来源版本及选项只提交一次", async () => {
    const submit = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { predictionId: "pred-idem" };
    });
    setManhua3dTaskDependenciesForTests({
      isConfigured: () => true,
      submit,
      poll: vi
        .fn()
        .mockResolvedValue({ state: "running", status: "processing" }),
    });
    const input = {
      userId: 7,
      assetRef: "character:black-horse",
      sourceVersion: "sha256:source-v1",
      sourceImageUrl: "https://assets.test/black-horse-front.png",
      options: { geometryQuality: "detailed" as const },
    };

    const [first, second] = await Promise.all([
      createManhua3dTask(input),
      createManhua3dTask(input),
    ]);
    expect(first.taskId).toBe(second.taskId);
    expect(submit).toHaveBeenCalledTimes(1);

    const signedUrlRotated = await createManhua3dTask({
      ...input,
      sourceImageUrl:
        "https://assets.test/black-horse-front.png?new-signature=test",
    });
    expect(signedUrlRotated.taskId).toBe(first.taskId);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("同一来源用不同质量选项会产生不同任务，避免错误复用", async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ predictionId: "pred-standard" })
      .mockResolvedValueOnce({ predictionId: "pred-detailed" });
    setManhua3dTaskDependenciesForTests({
      isConfigured: () => true,
      submit,
      poll: vi
        .fn()
        .mockResolvedValue({ state: "running", status: "processing" }),
    });
    const base = {
      userId: 7,
      assetRef: "character:black-horse",
      sourceVersion: "sha256:source-v1",
      sourceImageUrl: "https://assets.test/black-horse-front.png",
    };
    const standard = await createManhua3dTask({
      ...base,
      options: { geometryQuality: "standard" },
    });
    const detailed = await createManhua3dTask({
      ...base,
      options: { geometryQuality: "detailed" },
    });

    expect(standard.taskId).not.toBe(detailed.taskId);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("缺少服务端通道配置时不落任务、不提交上游", async () => {
    const submit = vi.fn();
    setManhua3dTaskDependenciesForTests({ isConfigured: () => false, submit });

    await expect(
      createManhua3dTask({
        userId: 7,
        assetRef: "character:black-horse",
        sourceVersion: "sha256:no-key",
        sourceImageUrl: "https://assets.test/black-horse-front.png",
      })
    ).rejects.toThrow("manhua3d_service_unavailable");
    expect(submit).not.toHaveBeenCalled();
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("导入同账号 GCS 下的有效 GLB，不调用建模上游并可幂等恢复", async () => {
    const submit = vi.fn();
    const glb = validGlb(Buffer.from("existing-model"));
    const inspectUploadedGlb = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return inspectedGlb(glb);
    });
    const immutableGcsUri = `gs://test-bucket/manhua-3d/u7/imports/character-black-horse/${"a".repeat(64)}/model.glb`;
    const rewriteUploadedGlb = vi.fn().mockResolvedValue({ gcsUri: immutableGcsUri });
    setManhua3dTaskDependenciesForTests({
      submit,
      getBucketName: () => "test-bucket",
      inspectUploadedGlb,
      rewriteUploadedGlb,
      signGlb: uri => `https://signed.test/${encodeURIComponent(uri)}`,
    });
    const input = {
      userId: 7,
      assetRef: "character:black-horse",
      sourceVersion: "sha256:source-v1",
      sourceImageUrl: "https://assets.test/black-horse-front.png",
      glbGcsUri: "gs://test-bucket/uploads/u7/existing.glb",
    };

    const [first, second] = await Promise.all([
      importExistingManhua3dAsset(input),
      importExistingManhua3dAsset(input),
    ]);
    const restored = await importExistingManhua3dAsset(input);

    expect(first.status).toBe("succeeded");
    expect(first.taskId).toMatch(/^m3d_import_/);
    expect(first.glbGcsUri).toBe(immutableGcsUri);
    expect(first.glbUrl).toContain("https://signed.test/");
    expect(second.taskId).toBe(first.taskId);
    expect(restored.taskId).toBe(first.taskId);
    expect(submit).not.toHaveBeenCalled();
    expect(inspectUploadedGlb).toHaveBeenCalledTimes(1);
    expect(rewriteUploadedGlb).toHaveBeenCalledWith({
      sourceGcsUri: input.glbGcsUri,
      sourceGeneration: "42",
      destinationObjectName: `manhua-3d/u7/imports/character-black-horse/${"a".repeat(64)}/model.glb`,
    });
  });

  it("导入 GLB 拒绝跨账号对象与伪造文件头", async () => {
    const inspectUploadedGlb = vi
      .fn()
      .mockRejectedValue(new Error("invalid_glb_magic"));
    setManhua3dTaskDependenciesForTests({
      getBucketName: () => "test-bucket",
      inspectUploadedGlb,
      rewriteUploadedGlb: vi.fn(),
    });
    const base = {
      userId: 7,
      assetRef: "character:black-horse",
      sourceVersion: "sha256:source-v1",
      sourceImageUrl: "https://assets.test/black-horse-front.png",
    };

    await expect(
      importExistingManhua3dAsset({
        ...base,
        glbGcsUri: "gs://test-bucket/uploads/u8/stolen.glb",
      })
    ).rejects.toThrow("manhua3d_glb_forbidden");
    expect(inspectUploadedGlb).not.toHaveBeenCalled();

    await expect(
      importExistingManhua3dAsset({
        ...base,
        glbGcsUri: "gs://test-bucket/uploads/u7/fake.glb",
      })
    ).rejects.toThrow("invalid_glb_magic");
  });

  it("导入流式验真超过 250MB 时保留 glb_too_large 错误分类", async () => {
    const inspectUploadedGlb = vi
      .fn()
      .mockRejectedValue(new Error("gcs_download_too_large"));
    setManhua3dTaskDependenciesForTests({
      getBucketName: () => "test-bucket",
      inspectUploadedGlb,
      rewriteUploadedGlb: vi.fn(),
    });

    await expect(
      importExistingManhua3dAsset({
        userId: 7,
        assetRef: "character:black-horse",
        sourceVersion: "sha256:oversize",
        sourceImageUrl: "https://assets.test/black-horse-front.png",
        glbGcsUri: "gs://test-bucket/uploads/u7/oversize.glb",
      })
    ).rejects.toThrow("glb_too_large");
  });

  it("不同 GLB 最多同时验真两个，拥塞时关闭式拒绝且不触发建模", async () => {
    const submit = vi.fn();
    const resolvers: Array<() => void> = [];
    const glb = validGlb(Buffer.from("mesh"));
    const inspectUploadedGlb = vi.fn(
      () =>
        new Promise<ReturnType<typeof inspectedGlb>>(resolve => {
          resolvers.push(() => resolve(inspectedGlb(glb)));
        })
    );
    setManhua3dTaskDependenciesForTests({
      submit,
      getBucketName: () => "test-bucket",
      inspectUploadedGlb,
      rewriteUploadedGlb: vi.fn(async input => ({
        gcsUri: `gs://test-bucket/${input.destinationObjectName}`,
      })),
      signGlb: uri => `https://signed.test/${encodeURIComponent(uri)}`,
    });
    const base = {
      userId: 7,
      assetRef: "character:black-horse",
      sourceVersion: "sha256:source-v1",
      sourceImageUrl: "https://assets.test/black-horse-front.png",
    };
    const first = importExistingManhua3dAsset({
      ...base,
      glbGcsUri: "gs://test-bucket/uploads/u7/first.glb",
    });
    const second = importExistingManhua3dAsset({
      ...base,
      glbGcsUri: "gs://test-bucket/uploads/u7/second.glb",
    });

    await vi.waitFor(() => expect(inspectUploadedGlb).toHaveBeenCalledTimes(2));
    await expect(
      importExistingManhua3dAsset({
        ...base,
        glbGcsUri: "gs://test-bucket/uploads/u7/third.glb",
      })
    ).rejects.toThrow("manhua3d_glb_import_busy");
    expect(submit).not.toHaveBeenCalled();

    resolvers.splice(0).forEach(resolve => resolve());
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("POST 结果未知后转 reconcile_manual，后续查询也不会重复提交", async () => {
    const submit = vi
      .fn()
      .mockRejectedValue(new SubmitUnknownError("socket closed"));
    setManhua3dTaskDependenciesForTests({ isConfigured: () => true, submit });

    const created = await createManhua3dTask({
      userId: 7,
      assetRef: "character:black-horse",
      sourceVersion: "sha256:unknown-v1",
      sourceImageUrl: "https://assets.test/black-horse-front.png",
    });
    expect(created.status).toBe("reconcile_manual");
    expect(created.errorZh).toContain("停止自动重试");

    const queried = await getManhua3dTask(created.taskId, 7);
    expect(queried?.status).toBe("reconcile_manual");
    expect(submit).toHaveBeenCalledTimes(1);
    await expect(retryManhua3dTask(created.taskId, 7)).rejects.toThrow(
      "manhua3d_retry_reconcile_forbidden"
    );
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("明确失败可生成新的幂等重试任务，同一失败任务不会重复提交", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new SubmitRejectedError("bad image"))
      .mockResolvedValueOnce({ predictionId: "pred-retry" });
    setManhua3dTaskDependenciesForTests({
      isConfigured: () => true,
      submit,
      poll: vi
        .fn()
        .mockResolvedValue({ state: "running", status: "processing" }),
    });
    const failed = await createManhua3dTask({
      userId: 7,
      assetRef: "character:black-horse",
      sourceVersion: "sha256:retry-v1",
      sourceImageUrl: "https://assets.test/black-horse-front.png",
    });
    expect(failed.status).toBe("failed");
    expect(await retryManhua3dTask(failed.taskId, 8)).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);

    const retried = await retryManhua3dTask(failed.taskId, 7);
    const duplicate = await retryManhua3dTask(failed.taskId, 7);
    expect(retried?.taskId).not.toBe(failed.taskId);
    expect(retried?.status).toBe("running");
    expect(duplicate?.taskId).toBe(retried?.taskId);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("完成后验证 glTF 头、上传 GCS，并持久返回重新签发的下载地址", async () => {
    const glb = validGlb(Buffer.from("mesh-test"));
    const uploadGlb = vi.fn().mockResolvedValue({
      bucket: "test-bucket",
      objectName: "manhua-3d/u7/model.glb",
      gcsUri: "gs://test-bucket/manhua-3d/u7/model.glb",
    });
    setManhua3dTaskDependenciesForTests({
      isConfigured: () => true,
      submit: vi.fn().mockResolvedValue({ predictionId: "pred-success" }),
      poll: vi.fn().mockResolvedValue({
        state: "completed",
        sourceGlbUrl: "https://result.test/model.glb",
      }),
      downloadGlb: vi.fn().mockResolvedValue(glb),
      uploadGlb,
      signGlb: vi.fn().mockReturnValue("https://storage.test/signed-model.glb"),
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    const task = await createManhua3dTask({
      userId: 7,
      assetRef: "character:black-horse",
      sourceVersion: "sha256:success-v1",
      sourceImageUrl: "https://assets.test/black-horse-front.png",
      options: { texture: true, pbr: true },
    });
    expect(task).toMatchObject({
      status: "succeeded",
      predictionId: "pred-success",
      glbGcsUri: "gs://test-bucket/manhua-3d/u7/model.glb",
      glbUrl: "https://storage.test/signed-model.glb",
      glbBytes: glb.byteLength,
    });
    expect(task.glbSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(uploadGlb).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "model/gltf-binary",
        buffer: glb,
      })
    );

    const disk = JSON.parse(
      await fs.readFile(path.join(dir, `${task.taskId}.json`), "utf8")
    );
    expect(disk.glbGcsUri).toBe(task.glbGcsUri);
    expect(disk.glbUrl).toBe(task.glbUrl);
  });

  it("过期地址续签失败时清除旧 URL，但保留成功任务与 GCS 身份", async () => {
    const glb = validGlb(Buffer.from("mesh-sign-refresh"));
    let now = new Date("2026-09-04T00:00:00.000Z");
    const signGlb = vi
      .fn()
      .mockReturnValueOnce("https://storage.test/first-signed.glb")
      .mockImplementationOnce(() => {
        throw new Error("signer unavailable");
      });
    setManhua3dTaskDependenciesForTests({
      isConfigured: () => true,
      submit: vi.fn().mockResolvedValue({ predictionId: "pred-sign-refresh" }),
      poll: vi.fn().mockResolvedValue({
        state: "completed",
        sourceGlbUrl: "https://result.test/model.glb",
      }),
      downloadGlb: vi.fn().mockResolvedValue(glb),
      uploadGlb: vi.fn().mockResolvedValue({
        bucket: "test-bucket",
        objectName: "manhua-3d/u7/sign-refresh/model.glb",
        gcsUri: "gs://test-bucket/manhua-3d/u7/sign-refresh/model.glb",
      }),
      signGlb,
      now: () => now,
    });
    const created = await createManhua3dTask({
      userId: 7,
      assetRef: "character:black-horse",
      sourceVersion: "sha256:sign-refresh-v1",
      sourceImageUrl: "https://assets.test/black-horse-front.png",
    });
    expect(created.glbUrl).toBe("https://storage.test/first-signed.glb");

    now = new Date("2026-09-12T00:00:00.000Z");
    const refreshed = await getManhua3dTask(created.taskId, 7);
    expect(refreshed).toMatchObject({
      taskId: created.taskId,
      status: "succeeded",
      glbGcsUri: "gs://test-bucket/manhua-3d/u7/sign-refresh/model.glb",
    });
    expect(refreshed?.glbUrl).toBeUndefined();
    expect(refreshed?.glbUrlExpiresAt).toBeUndefined();

    const disk = JSON.parse(
      await fs.readFile(path.join(dir, `${created.taskId}.json`), "utf8")
    );
    expect(disk.status).toBe("succeeded");
    expect(disk.taskId).toBe(created.taskId);
    expect(disk.glbGcsUri).toBe(refreshed?.glbGcsUri);
    expect(disk.glbUrl).toBeUndefined();
    expect(disk.glbUrlExpiresAt).toBeUndefined();
    expect(disk.lastTransientError).toBe("sign_failed:signer unavailable");
  });

  it("拒绝伪装成 GLB 的上游文件，不上传坏产物", async () => {
    const uploadGlb = vi.fn();
    setManhua3dTaskDependenciesForTests({
      isConfigured: () => true,
      submit: vi.fn().mockResolvedValue({ predictionId: "pred-invalid" }),
      poll: vi.fn().mockResolvedValue({
        state: "completed",
        sourceGlbUrl: "https://result.test/not-a-model.bin",
      }),
      downloadGlb: vi.fn().mockResolvedValue(Buffer.from("not-a-glb")),
      uploadGlb,
    });

    const task = await createManhua3dTask({
      userId: 7,
      assetRef: "character:black-horse",
      sourceVersion: "sha256:invalid-v1",
      sourceImageUrl: "https://assets.test/black-horse-front.png",
    });
    expect(task.status).toBe("failed");
    expect(task.errorZh).toBe("生成结果不是有效的 GLB 模型");
    expect(uploadGlb).not.toHaveBeenCalled();
    expect(() => assertGlbBuffer(Buffer.from("not-a-glb"))).toThrow(
      "invalid_glb_magic"
    );
  });
});
