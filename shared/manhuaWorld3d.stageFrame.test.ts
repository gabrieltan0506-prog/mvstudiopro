import { describe, expect, it } from "vitest";
import { MANHUA_WORLD_3D_MODEL_CREDITS, normalizeManhuaStageFrameBinding } from "./manhuaWorld3d";
import { normalizeManhuaCustomAssetRefs } from "./manhuaCustomAssetRefs";

describe("导出视角图来源绑定（WL 交付门槛）", () => {
  it("归一化：世界任务号 + 场景图版本 + 机位缺一不可；人物 id 去空、集/段号只收正整数", () => {
    const full = normalizeManhuaStageFrameBinding({
      worldTaskId: "mw_abc",
      worldId: "w1",
      worldSourceVersion: "gs://b/deck.png",
      cameraKind: "ots",
      viewLabelZh: "过肩",
      actorIds: ["c1", "", "c2"],
      episode: 1,
      segmentIndex: 4,
      exportedAt: 1700000000000,
    });
    expect(full).toEqual({ worldTaskId: "mw_abc", worldId: "w1", worldSourceVersion: "gs://b/deck.png", cameraKind: "ots", viewLabelZh: "过肩", actorIds: ["c1", "c2"], episode: 1, segmentIndex: 4, exportedAt: 1700000000000 });
    expect(normalizeManhuaStageFrameBinding({ worldTaskId: "", worldSourceVersion: "gs://b/x", cameraKind: "ots" })).toBeUndefined();
    expect(normalizeManhuaStageFrameBinding({ worldTaskId: "mw", worldSourceVersion: "gs://b/x", cameraKind: "drone" })).toBeUndefined();
    expect(normalizeManhuaStageFrameBinding({ worldTaskId: "mw", worldSourceVersion: "gs://b/x", cameraKind: "single", episode: 0, segmentIndex: 1.5 })).toEqual({
      worldTaskId: "mw",
      worldSourceVersion: "gs://b/x",
      cameraKind: "single",
      viewLabelZh: "",
      actorIds: [],
      exportedAt: 0,
    });
    expect(normalizeManhuaStageFrameBinding(null)).toBeUndefined();
  });

  it("存稿往返：ref.stageFrame 经 normalizeManhuaCustomAssetRefs 原样保住；坏绑定被丢掉而不是留半截", () => {
    const refs = normalizeManhuaCustomAssetRefs([
      { id: "a", url: "https://x/a.png", role: "scene", labelZh: "甲板·过肩机位", stageFrame: { worldTaskId: "mw_1", worldSourceVersion: "gs://b/d.png", cameraKind: "establish", viewLabelZh: "建立", actorIds: ["c1"], exportedAt: 5 } },
      { id: "b", url: "https://x/b.png", role: "scene", labelZh: "甲板", stageFrame: { worldTaskId: "mw_1", cameraKind: "establish" } },
    ]);
    expect(refs[0]!.stageFrame).toEqual({ worldTaskId: "mw_1", worldSourceVersion: "gs://b/d.png", cameraKind: "establish", viewLabelZh: "建立", actorIds: ["c1"], exportedAt: 5 });
    expect(refs[1]!.stageFrame).toBeUndefined();
  });

  it("建世界一步价目表：draft 150、1.1 固定 1500、plus 区间", () => {
    expect(MANHUA_WORLD_3D_MODEL_CREDITS["marble-1.0-draft"]).toEqual({ min: 150, max: 150 });
    expect(MANHUA_WORLD_3D_MODEL_CREDITS["marble-1.1-plus"].max).toBeGreaterThan(MANHUA_WORLD_3D_MODEL_CREDITS["marble-1.1-plus"].min);
  });
});
