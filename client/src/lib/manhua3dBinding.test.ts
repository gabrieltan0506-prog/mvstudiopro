import { describe, expect, it } from "vitest";
import type { ManhuaAsset3dRef } from "@shared/manhuaAsset3d";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import { applyManhua3dBinding, createManhua3dOperationGuard } from "./manhua3dBinding";

const sourceVersion = "gs://test-bucket/uploads/u1/character.png";
function model(taskId: string, updatedAt = 10): ManhuaAsset3dRef {
  return {
    taskId,
    updatedAt,
    sourceVersion,
    sourceImageUrl: "https://example.test/character.png",
    status: "succeeded",
    glbGcsUri: `gs://test-bucket/uploads/u1/${taskId}.glb`,
    glbUrl: `https://example.test/${taskId}.glb`,
  };
}
function asset(model3d?: ManhuaAsset3dRef): ManhuaCustomAssetRef {
  return {
    id: "horse",
    role: "character",
    reviewStatus: "accepted",
    url: "https://example.test/character.png",
    gcsUri: sourceVersion,
    model3d,
  };
}

describe("人物 3D 提交与迟到回写", () => {
  it("同一人物生成／导入互斥，另一人物不被阻塞，旧 finally 不解锁新操作", () => {
    const guard = createManhua3dOperationGuard();
    const first = guard.begin("horse")!;
    expect(guard.begin("horse")).toBeNull();
    expect(guard.begin("hero")).not.toBeNull();
    guard.end("horse", first);
    const second = guard.begin("horse")!;
    guard.end("horse", first);
    expect(guard.begin("horse")).toBeNull();
    guard.end("horse", second);
    expect(guard.assetIds()).toEqual(["hero"]);
  });

  it("新 GLB 绑定后，旧任务刷新／轮询回执不能把旧模型写回来", () => {
    const afterImport = applyManhua3dBinding([asset(model("old"))], "horse", model("new"), "old");
    expect(afterImport[0].model3d?.taskId).toBe("new");
    const afterLateRefresh = applyManhua3dBinding(afterImport, "horse", model("old", 99));
    expect(afterLateRefresh[0]).toBe(afterImport[0]);
    const afterLateSubmit = applyManhua3dBinding(
      afterImport,
      "horse",
      model("older-import", 100),
      "old",
    );
    expect(afterLateSubmit[0]).toBe(afterImport[0]);
  });

  it("新绑定支持原本无 3D 的人物；换图、删除、其他人物不被迟到响应覆盖", () => {
    expect(applyManhua3dBinding([asset()], "horse", model("new"), null)[0].model3d?.taskId).toBe(
      "new",
    );
    const changed = { ...asset(), gcsUri: "gs://test-bucket/uploads/u1/new-image.png" };
    expect(applyManhua3dBinding([changed], "horse", model("new"), null)[0]).toBe(changed);
    expect(applyManhua3dBinding([], "horse", model("new"), null)).toEqual([]);
    const other = { ...asset(), id: "hero" };
    expect(applyManhua3dBinding([other], "horse", model("new"), null)[0]).toBe(other);
    const reclassified: ManhuaCustomAssetRef = { ...asset(), role: "scene" };
    expect(applyManhua3dBinding([reclassified], "horse", model("new"), null)[0]).toBe(reclassified);
  });

  it("同一任务的倒序状态不回退，续签回执仍能更新预览地址", () => {
    const current = asset(model("same", 20));
    expect(
      applyManhua3dBinding([current], "horse", { ...model("same", 10), status: "running" })[0],
    ).toBe(current);
    const refreshed = { ...model("same", 20), glbUrl: "https://example.test/refreshed.glb" };
    expect(applyManhua3dBinding([current], "horse", refreshed)[0].model3d?.glbUrl).toBe(
      refreshed.glbUrl,
    );
  });
});
