import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { isDefiniteRejection, withRiggedModelSourceAssetRefs } from "./manhuaPrevisSubmit";

const rigged = { sourceJobId: "m3d_import_1", forwardAxis: "+X" as const, targetHeight: 1.7 };
function spec() {
  const s = createManhuaPrevisStudio(4).spec;
  Object.assign(s.actors[0], { assetRef: "cust_face", riggedModel: { ...rigged } });
  return s;
}

describe("withRiggedModelSourceAssetRefs", () => {
  it("模型挂在候选图：补 sourceAssetRef＝候选图 ref，assetRef 不动", () => {
    const out = withRiggedModelSourceAssetRefs(spec(), [
      { id: "cust_face", model: { taskId: "m3d_import_1", assetRef: "cust_apose" } },
    ]);
    expect(out.actors[0].assetRef).toBe("cust_face");
    expect(out.actors[0].riggedModel?.sourceAssetRef).toBe("cust_apose");
  });
  it("模型任务号对不上 / 人物表没模型 / 无 riggedModel：原样返回同一对象", () => {
    const s = spec();
    expect(withRiggedModelSourceAssetRefs(s, [{ id: "cust_face", model: { taskId: "m3d_other", assetRef: "x" } }])).toBe(s);
    expect(withRiggedModelSourceAssetRefs(s, [{ id: "cust_face" }])).toBe(s);
    const bare = createManhuaPrevisStudio(4).spec;
    expect(withRiggedModelSourceAssetRefs(bare, [])).toBe(bare);
  });
  it("已是同一 sourceAssetRef 不重复改", () => {
    const s = spec();
    s.actors[0].riggedModel!.sourceAssetRef = "cust_apose";
    expect(withRiggedModelSourceAssetRefs(s, [{ id: "cust_face", model: { taskId: "m3d_import_1", assetRef: "cust_apose" } }])).toBe(s);
  });
});

describe("isDefiniteRejection", () => {
  it("只认 data.code=PRECONDITION_FAILED；断网、BAD_REQUEST、非 Error 都不算", () => {
    expect(isDefiniteRejection(Object.assign(new Error("x"), { data: { code: "PRECONDITION_FAILED" } }))).toBe(true);
    expect(isDefiniteRejection(Object.assign(new Error("x"), { data: { code: "BAD_REQUEST" } }))).toBe(false);
    expect(isDefiniteRejection(new Error("离线"))).toBe(false);
    expect(isDefiniteRejection({ data: { code: "PRECONDITION_FAILED" } })).toBe(false);
  });
});
