import { describe, expect, it } from "vitest";
import { createAdvisorPrevisStudio, inferPrevisCharacterShape } from "./manhuaAdvisorPrevisInitial";
import { repairManhuaPrevisCast } from "./manhuaPrevisCastRepair";
import { applyAdvisorPrevisCandidate, makeAdvisorPrevisTarget } from "./manhuaAdvisorPrevisEdit";

const characters = [{ id: "horse", label: "墨屠", shape: "horse" as const }, { id: "mother", label: "娘" }];
const baseline = () => createAdvisorPrevisStudio({ durationSec: 9, castZh: "墨屠", shots: [], characters: [{ ...characters[0], shape: "human" }] });
describe("核对已有预演人物", () => {
  it("补娘并校正马形，保留旧编号、动作、媒体和可撤销历史", () => {
    const old = baseline(); old.selectedJobId = "old-render";
    const next = repairManhuaPrevisCast(old, characters, { additions: [{ assetRef: "mother", shape: "human" }], shapes: [{ actorId: old.spec.actors[0].id, shape: "horse" }] });
    expect(next.spec.actors.map(actor => [actor.nameZh, actor.assetRef, actor.shape])).toEqual([["墨屠", "horse", "horse"], ["娘", "mother", "human"]]);
    expect(next.spec.actors[0].id).toBe(old.spec.actors[0].id);
    expect(next.spec.actors[0].actions).toEqual(old.spec.actors[0].actions);
    expect(next.selectedJobId).toBe("old-render"); expect(next.history).toEqual(old.history);
    expect(next.specHistory?.at(-1)?.spec).toEqual(old.spec);
    expect(old.spec.actors).toHaveLength(1); expect(old.spec.actors[0].shape).toBe("human");
    expect(() => applyAdvisorPrevisCandidate("clip", next, { target: makeAdvisorPrevisTarget("clip", old), patch: { kind: "previs_edit_v1", summaryZh: "旧候选", unsupportedZh: [], cameras: old.spec.cameras } })).toThrow("本段配置已变化");
  });
  it("骨骼不兼容则保留原模型并拒绝，不静默去骨", () => {
    const old = baseline(); old.spec.actors[0].riggedModel = { sourceJobId: "m3d_existing", forwardAxis: "+X", targetHeight: 1.7 };
    expect(() => repairManhuaPrevisCast(old, characters, { additions: [], shapes: [{ actorId: old.spec.actors[0].id, shape: "horse" }] })).toThrow("原模型配置保留");
    expect(old.spec.actors[0].riggedModel.sourceJobId).toBe("m3d_existing");
  });
  it("无变化不追加历史，缺资产和重复人物拒绝", () => {
    const old = baseline(); expect(repairManhuaPrevisCast(old, characters, { additions: [], shapes: [] })).toBe(old);
    for (const assetRef of ["missing", "horse"]) expect(() => repairManhuaPrevisCast(old, characters, { additions: [{ assetRef, shape: "human" }], shapes: [] })).toThrow();
  });
  it("在途任务不能修改身份", () => {
    const old = baseline(); old.pending = { requestId: "existing", scopeId: old.scopeId, clipId: "clip", spec: old.spec };
    expect(() => repairManhuaPrevisCast(old, characters, { additions: [], shapes: [] })).toThrow("在途渲染");
  });
  it("识别本集瘸马，不把马尾发型识别成马", () => {
    expect(inferPrevisCharacterShape("瘸马形态，戴眼罩")).toBe("horse");
    expect(inferPrevisCharacterShape("少女，高马尾")).toBe("human");
  });
});
