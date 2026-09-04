import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SubmitUnknownError } from "./submitOutcomeErrors.js";
import {
  assertGlbBuffer,
  createManhua3dTask,
  getManhua3dTask,
  resetManhua3dTaskDependenciesForTests,
  setManhua3dTaskDependenciesForTests,
} from "./manhua3dTask.js";

function validGlb(payload = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.byteLength + payload.byteLength, 8);
  return Buffer.concat([header, payload]);
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
    await fs.rm(dir, { recursive: true, force: true });
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
