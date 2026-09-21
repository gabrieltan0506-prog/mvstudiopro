import { describe, it, expect } from "vitest";
import { createManhuaPrevisStudio, manhuaPrevisRequestSchema, manhuaPrevisStudioSchema } from "@shared/manhuaPrevis";
import { addPrevisLibraryAction, PREVIS_LIBRARY_ACTIONS } from "./manhuaPrevisActionLibrary";

describe("动作库沿原白模合同添加", () => {
  it.each(PREVIS_LIBRARY_ACTIONS)("%s 进入同一草稿与提交参数，保留旧配置", kind => {
    const studio = createManhuaPrevisStudio(6, "11111111-1111-4111-8111-111111111111");
    if (kind === "walk") { studio.spec.actors[0].end = [0, 1]; studio.spec.actors[0].moveStartSec = 0; studio.spec.actors[0].moveEndSec = 6; }
    const snapshot = structuredClone(studio);
    const result = addPrevisLibraryAction(studio.spec, "actor-1", kind);
    expect(result.error).toBeUndefined();
    expect(studio).toEqual(snapshot);
    const saved = manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify({...studio, spec: result.spec})));
    const submitted = manhuaPrevisRequestSchema.parse({requestId:"22222222-2222-4222-8222-222222222222",scopeId:studio.scopeId,clipId:"clip-e01-g01",spec:saved.spec});
    expect(submitted.spec.actors[0].actions).toEqual([{kind,startSec:0,endSec:2}]);
    expect(submitted.spec.actors[0].start).toEqual(studio.spec.actors[0].start);
  });
  it("填已有空档，不覆盖原动作，不改变另一角色", () => {
    const studio=createManhuaPrevisStudio(6); const first=studio.spec.actors[0];
    first.actions=[{kind:"guard",startSec:2,endSec:4}];
    studio.spec.actors.push({...structuredClone(first),id:"other"});
    const result=addPrevisLibraryAction(studio.spec,first.id,"bow");
    expect(result.spec!.actors[0].actions).toEqual([{kind:"bow",startSec:0,endSec:2},...first.actions]);
    expect(result.spec!.actors[1]).toEqual(studio.spec.actors[1]);
  });
  it("没有空档明确拒绝，不产生重叠或拉长片长", () => {
    const studio=createManhuaPrevisStudio(2);studio.spec.actors[0].actions=[{kind:"guard",startSec:0,endSec:2}];
    expect(addPrevisLibraryAction(studio.spec,"actor-1","bow").error).toContain("空档");
  });
  it("旧无动作草稿恢复后可添加，无需迁移", () => {
    const old=manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify(createManhuaPrevisStudio())));
    expect(addPrevisLibraryAction(old.spec,"actor-1","guard").spec!.actors[0].actions).toHaveLength(1);
    expect(old.history).toEqual([]);expect(old.referenceHistory).toEqual([]);
  });
  it("咳嗽跳过短空档，保留掩口缓气时间", () => {
    const studio = createManhuaPrevisStudio(6);
    studio.spec.actors[0].actions = [{kind:"guard",startSec:0.8,endSec:2}];
    const result = addPrevisLibraryAction(studio.spec,"actor-1","cough");
    expect(result.spec!.actors[0].actions[1]).toEqual({kind:"cough",startSec:2,endSec:4});
    studio.spec.actors[0].actions = [{kind:"guard",startSec:0.8,endSec:5.5}];
    expect(addPrevisLibraryAction(studio.spec,"actor-1","cough").error).toContain("1.2 秒");
  });

  it("咳嗽未验收的带骨组合不能保存或提交", () => {
    const studio = createManhuaPrevisStudio(6);
    studio.spec.actors[0].assetRef = "char-a";
    studio.spec.actors[0].riggedModel = {sourceJobId:"m3d_test",targetHeight:1.7,forwardAxis:"+X"};
    expect(addPrevisLibraryAction(studio.spec,"actor-1","cough").error).toContain("咳嗽目前仅支持基础白模");
  });

});
