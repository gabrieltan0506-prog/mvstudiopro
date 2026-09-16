import { describe, expect, it } from "vitest";
import {
  evaluateManhuaStageFrameAdoption,
  formatManhuaStageFrameSourceZh,
  listManhuaStaleStageFrames,
  listManhuaUsableStageFrames,
  normalizeManhuaStageFrameAdoptions,
  toggleManhuaStageFrameAdoption,
} from "./manhuaStageFrameAdoption";

const SHOT = "ap_shot_e1_s4_t2";
const binding = (over: Record<string, unknown> = {}) => ({
  worldTaskId: "mw_w1",
  worldId: "world-abc",
  worldSourceVersion: "gs://b/deck.png",
  cameraKind: "ots" as const,
  viewLabelZh: "过肩",
  actorIds: ["c_aj", "c_cs"],
  episode: 1,
  segmentIndex: 4,
  exportedAt: 100,
  ...over,
});
type TestRef = { id: string; labelZh?: string; stageFrame?: ReturnType<typeof binding>; stageFrameAdoptions?: Array<{ shotId: string; adoptedAt: number }> };
const ref = (id: string, over: Record<string, unknown> = {}): TestRef => ({ id, labelZh: id, stageFrame: binding(), stageFrameAdoptions: [{ shotId: SHOT, adoptedAt: 5 }], ...over });
const ctx = { shotId: SHOT, episode: 1, segmentIndex: 4, actorIds: ["c_cs", "c_aj"], worldTaskId: "mw_w1", worldSourceVersion: "gs://b/deck.png" };

describe("视角图采用到某一镜", () => {
  it("采用且世界/演员/集段一致 → 可用；演员顺序不同不算变化", () => {
    expect(evaluateManhuaStageFrameAdoption(ref("a"), ctx)).toEqual({ adopted: true, usable: true });
  });

  it("没绑定或没采用 → adopted=false，不进出站", () => {
    expect(evaluateManhuaStageFrameAdoption(ref("a", { stageFrame: undefined }), ctx)).toEqual({ adopted: false, usable: false });
    expect(evaluateManhuaStageFrameAdoption(ref("a", { stageFrameAdoptions: [] }), ctx)).toEqual({ adopted: false, usable: false });
    expect(evaluateManhuaStageFrameAdoption(ref("a", { stageFrameAdoptions: [{ shotId: "ap_shot_e1_s4_t9", adoptedAt: 1 }] }), ctx)).toEqual({ adopted: false, usable: false });
  });

  it("换世界 / 换场景图版本 / 人物名单变化 / 跨集跨段 → 采用仍在但不可用，各给中文原因", () => {
    expect(evaluateManhuaStageFrameAdoption(ref("a"), { ...ctx, worldTaskId: "mw_w2" })).toMatchObject({ adopted: true, usable: false, staleCode: "world_changed" });
    expect(evaluateManhuaStageFrameAdoption(ref("a"), { ...ctx, worldSourceVersion: "gs://b/deck-v2.png" })).toMatchObject({ staleCode: "world_changed", reasonZh: expect.stringContaining("场景参考图已换版本") });
    expect(evaluateManhuaStageFrameAdoption(ref("a"), { ...ctx, actorIds: ["c_aj"] })).toMatchObject({ staleCode: "actors_changed" });
    expect(evaluateManhuaStageFrameAdoption(ref("a"), { ...ctx, shotId: SHOT, segmentIndex: 5 })).toMatchObject({ staleCode: "shot_moved" });
  });

  it("出站清单只吃可用图，按采用时间新到旧；失效的单独列出来不静默丢", () => {
    const fresh = ref("new", { stageFrameAdoptions: [{ shotId: SHOT, adoptedAt: 99 }] });
    const old = ref("old", { stageFrameAdoptions: [{ shotId: SHOT, adoptedAt: 1 }] });
    const stale = ref("stale", { stageFrame: binding({ worldTaskId: "mw_other" }) });
    const none = ref("none", { stageFrameAdoptions: [] });
    const refs = [old, stale, fresh, none];
    expect(listManhuaUsableStageFrames(refs, ctx).map((r) => r.id)).toEqual(["new", "old"]);
    const bad = listManhuaStaleStageFrames(refs, ctx);
    expect(bad.map((x) => x.ref.id)).toEqual(["stale"]);
    expect(bad[0]!.reasonZh).toContain("另一个 3D 世界");
  });

  it("采用/取消是同一个开关；去重、有上限；normalize 丢掉坏行", () => {
    const one = toggleManhuaStageFrameAdoption(undefined, SHOT, 7);
    expect(one).toEqual([{ shotId: SHOT, adoptedAt: 7 }]);
    expect(toggleManhuaStageFrameAdoption(one, SHOT, 9)).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => ({ shotId: `s${i}`, adoptedAt: i }));
    expect(normalizeManhuaStageFrameAdoptions(many).length).toBe(8);
    expect(normalizeManhuaStageFrameAdoptions([{ shotId: "" }, { shotId: "x" }, { shotId: "x" }])).toEqual([{ shotId: "x", adoptedAt: 0 }]);
    expect(normalizeManhuaStageFrameAdoptions("nope")).toEqual([]);
  });

  it("来源说明给的是世界、机位、人物、集段，不是中文标签猜的", () => {
    const s = formatManhuaStageFrameSourceZh(ref("a"), (id) => ({ c_aj: "阿菁", c_cs: "曹三" })[id] || id);
    expect(s).toContain("第1集段04");
    expect(s).toContain("过肩机位");
    expect(s).toContain("人物 阿菁、曹三");
    expect(s).toContain("世界 world-ab");
    expect(formatManhuaStageFrameSourceZh({ id: "x" })).toBe("");
  });
});
