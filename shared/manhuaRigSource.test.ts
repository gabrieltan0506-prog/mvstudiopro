import { describe, expect, it } from "vitest";
import { listManhuaSameCharacterRefs, resolveManhuaRigSource } from "./manhuaRigSource";
import type { ManhuaCustomAssetRef } from "./manhuaCustomAssetRefs";

const model = (taskId: string, status: "succeeded" | "failed" = "succeeded", sourceVersion = "https://x/p.png") => ({ status, taskId, sourceImageUrl: sourceVersion, sourceVersion, glbUrl: `https://x/${taskId}.glb`, updatedAt: 1 });
const ref = (id: string, over: Partial<ManhuaCustomAssetRef> = {}): ManhuaCustomAssetRef =>
  ({ id, url: `https://x/${id}.png`, role: "character", labelZh: id, reviewStatus: "accepted", claimedAnchorIds: ["wa_char_aj"], ...over }) as ManhuaCustomAssetRef;

describe("绑骨模型来源解析", () => {
  it("锁脸图自己有就绪模型 → 用锁脸图；候选图也列进 options", () => {
    const primary = ref("p", { model3d: model("m_p", "succeeded", "https://x/p.png") });
    const apose = ref("a", { labelZh: "阿菁·A-pose", model3d: model("m_a", "succeeded", "https://x/a.png") });
    const r = resolveManhuaRigSource(primary, [primary, apose]);
    expect(r.source).toMatchObject({ refId: "p", isCandidate: false });
    expect(r.options.map((o) => o.refId)).toEqual(["p", "a"]);
  });

  it("锁脸图没模型（或模型失败）→ 用同人物第一张有就绪模型的候选图；不同人物 / 非人物 / 未确认的不算", () => {
    const primary = ref("p", { model3d: model("m_p", "failed") });
    const apose = ref("a", { labelZh: "阿菁·A-pose", model3d: model("m_a", "succeeded", "https://x/a.png") });
    const other = ref("o", { claimedAnchorIds: ["wa_char_cs"], model3d: model("m_o", "succeeded", "https://x/o.png") });
    const prop = ref("q", { role: "prop" as never, model3d: model("m_q", "succeeded", "https://x/q.png") });
    const pending = ref("z", { reviewStatus: "pending" as never, model3d: model("m_z", "succeeded", "https://x/z.png") });
    const r = resolveManhuaRigSource(primary, [primary, other, prop, pending, apose]);
    expect(r.source).toMatchObject({ refId: "a", isCandidate: true, labelZh: "阿菁·A-pose" });
    expect(r.source?.model.taskId).toBe("m_a");
    expect(r.options.map((o) => o.refId)).toEqual(["a"]);
    // 同人物 ref 列表不看确认状态（只看角色与认领），保持输入顺序
    expect(listManhuaSameCharacterRefs(primary, [primary, other, prop, pending, apose]).map((x) => x.id)).toEqual(["z", "a"]);
  });

  it("换图即换版本：候选图模型不是由当前那张图派生的（sourceVersion 不同）不算就绪；没有任何来源 → source 空", () => {
    const primary = ref("p");
    const stale = ref("a", { model3d: model("m_a", "succeeded", "https://x/old.png") });
    const r = resolveManhuaRigSource(primary, [primary, stale]);
    expect(r.source).toBeUndefined();
    expect(r.options).toEqual([]);
    expect(resolveManhuaRigSource(undefined, [primary]).options).toEqual([]);
  });
});
