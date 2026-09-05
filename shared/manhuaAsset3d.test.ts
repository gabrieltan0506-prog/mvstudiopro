import { describe, expect, it } from "vitest";
import { normalizeManhuaAsset3dRef } from "./manhuaAsset3d.js";

describe("normalizeManhuaAsset3dRef", () => {
  it("续签瞬时失败时保留 succeeded 的长期任务身份", () => {
    expect(
      normalizeManhuaAsset3dRef({
        status: "succeeded",
        taskId: "task-3",
        sourceImageUrl: "https://cdn.example.com/c3.png",
        sourceVersion: "gs://bucket/images/c3.png",
        glbGcsUri: "gs://bucket/models/c3.glb",
        updatedAt: 1,
      }),
    ).toMatchObject({
      taskId: "task-3",
      glbGcsUri: "gs://bucket/models/c3.glb",
      glbUrl: undefined,
    });
  });

  it("只有临时 HTTPS 地址、没有 gs:// 身份的伪成功态仍被拒绝", () => {
    expect(
      normalizeManhuaAsset3dRef({
        status: "succeeded",
        taskId: "task-4",
        sourceImageUrl: "https://cdn.example.com/c4.png",
        sourceVersion: "v1",
        glbUrl: "https://provider.example.com/temporary.glb",
        updatedAt: 1,
      }),
    ).toBeUndefined();
  });
});
