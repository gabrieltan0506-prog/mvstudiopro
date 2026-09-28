import { describe, expect, it } from "vitest";
import { evaluateManhuaAsset3dEligibility, manhuaAsset3dSourceIdentity, normalizeManhuaAsset3dRef, type ManhuaAsset3dRef } from "./manhuaAsset3d.js";

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

describe("3D 模型来源图身份（0929 墨屠：旧任务记 https、当前图记 gs://）", () => {
  const gs = "gs://b/generated/manhua-asset-edited/1788538371654_xkc2wh.png";
  const signed = "https://storage.googleapis.com/b/generated/manhua-asset-edited/1788538371654_xkc2wh.png?X-Goog-Date=20260908T000000Z&X-Goog-Signature=abc";
  const model = (sourceVersion: string): ManhuaAsset3dRef => ({
    taskId: "m3d_x", updatedAt: 1, sourceVersion, sourceImageUrl: signed, status: "succeeded",
    glbGcsUri: "gs://b/manhua-3d/x.glb", glbUrl: "https://example.test/x.glb",
  });
  const asset = (model3d: ManhuaAsset3dRef) => ({
    role: "character" as const, reviewStatus: "accepted" as const, url: "https://example.test/now.png", gcsUri: gs, model3d,
  });

  it("同一 GCS 对象的签名 https（路径式／子域式）与 gs:// 同身份；签名轮换不算换图", () => {
    expect(manhuaAsset3dSourceIdentity(signed)).toBe(gs);
    expect(manhuaAsset3dSourceIdentity("https://b.storage.googleapis.com/generated/manhua-asset-edited/1788538371654_xkc2wh.png?X-Goog-Signature=new")).toBe(gs);
    expect(evaluateManhuaAsset3dEligibility(asset(model(signed))).currentModel3d?.taskId).toBe("m3d_x");
  });

  it("反例：别的对象、别的桶、非 GCS 地址只差查询串，都不是同一张图", () => {
    expect(evaluateManhuaAsset3dEligibility(asset(model("https://storage.googleapis.com/b/generated/other.png?X-Goog-Signature=abc"))).currentModel3d).toBeUndefined();
    expect(evaluateManhuaAsset3dEligibility(asset(model(signed.replace("/b/", "/b2/")))).currentModel3d).toBeUndefined();
    expect(manhuaAsset3dSourceIdentity("https://img.test/get?id=1")).not.toBe(manhuaAsset3dSourceIdentity("https://img.test/get?id=2"));
    expect(manhuaAsset3dSourceIdentity("")).toBe("");
  });
});
