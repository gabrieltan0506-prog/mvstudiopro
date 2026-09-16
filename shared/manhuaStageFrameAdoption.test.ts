import { describe, expect, it } from "vitest";
import {
  evaluateManhuaStageFrameAdoption,
  isManhuaShotIdOfSegment,
  listManhuaUsableStageFramesForSegment,
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
const WORLD_MAP = { "gs://b/deck.png": "mw_w1" };
const ctx = { shotId: SHOT, episode: 1, segmentIndex: 4, actorIds: ["c_cs", "c_aj"], currentWorldTaskIdBySourceVersion: WORLD_MAP };

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
    // 同一张场景图被重建了世界 → 旧图失效
    expect(evaluateManhuaStageFrameAdoption(ref("a"), { ...ctx, currentWorldTaskIdBySourceVersion: { "gs://b/deck.png": "mw_w2" } })).toMatchObject({ adopted: true, usable: false, staleCode: "world_changed", reasonZh: expect.stringContaining("重建过") });
    // 那张场景图已换版本/不在资产里 → 失效（不是拿别的场景去比）
    expect(evaluateManhuaStageFrameAdoption(ref("a"), { ...ctx, currentWorldTaskIdBySourceVersion: { "gs://b/other.png": "mw_w1" } })).toMatchObject({ staleCode: "world_changed", reasonZh: expect.stringContaining("已不在资产里") });
    // 本剧多场景：另一个场景重建世界不影响本张图
    expect(evaluateManhuaStageFrameAdoption(ref("a"), { ...ctx, currentWorldTaskIdBySourceVersion: { "gs://b/deck.png": "mw_w1", "gs://b/alley.png": "mw_w9" } })).toEqual({ adopted: true, usable: true });
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
    expect(bad[0]!.reasonZh).toContain("重建过");
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

  it("出站口径：只有采用且未失效的才交给出站层；失效的必须走单独名单，不能混进可用清单", () => {
    // 这一条钉的是 canvasRunBlock 的消费约定：出站只吃 listManhuaUsableStageFrames 的结果，
    // 采用与失效判定在页面侧一次做完，出站层不重做业务判定，也不靠中文标签猜。
    const ok = ref("ok");
    const otherWorld = ref("otherWorld", { stageFrame: binding({ worldTaskId: "mw_rebuilt" }) });
    const otherActors = ref("otherActors", { stageFrame: binding({ actorIds: ["c_aj"] }) });
    const otherSeg = ref("otherSeg", { stageFrame: binding({ segmentIndex: 9 }) });
    const notAdopted = ref("notAdopted", { stageFrameAdoptions: [] });
    const refs = [ok, otherWorld, otherActors, otherSeg, notAdopted];
    expect(listManhuaUsableStageFrames(refs, ctx).map((r) => r.id)).toEqual(["ok"]);
    expect(listManhuaStaleStageFrames(refs, ctx).map((x) => [x.ref.id, x.staleCode])).toEqual([
      ["otherWorld", "world_changed"],
      ["otherActors", "actors_changed"],
      ["otherSeg", "shot_moved"],
    ]);
  });

  it("按集段取采用图：镜序由分镜定，出站侧不枚举镜序（枚举错了采用永远命中不了）", () => {
    // 自审 R1 抓到的真阻断：面板写入的 shotId 用真实镜序（如 t10/t11/t12），
    // 出站侧曾硬写 [1,2,3]，两边对不上，采用的图一张也进不了请求。
    expect(isManhuaShotIdOfSegment("ap_shot_e1_s4_t12", 1, 4)).toBe(true);
    expect(isManhuaShotIdOfSegment("ap_shot_e1_s40_t1", 1, 4)).toBe(false);
    expect(isManhuaShotIdOfSegment("ap_shot_e2_s4_t1", 1, 4)).toBe(false);
    expect(isManhuaShotIdOfSegment("", 1, 4)).toBe(false);

    const segCtx = { episode: 1, segmentIndex: 4, actorIds: ["c_cs", "c_aj"], currentWorldTaskIdBySourceVersion: WORLD_MAP };
    const t12 = ref("t12", { stageFrameAdoptions: [{ shotId: "ap_shot_e1_s4_t12", adoptedAt: 3 }] });
    const otherSeg = ref("otherSeg", { stageFrameAdoptions: [{ shotId: "ap_shot_e1_s5_t1", adoptedAt: 3 }] });
    const staleWorld = ref("staleWorld", { stageFrame: binding({ worldSourceVersion: "gs://b/gone.png" }), stageFrameAdoptions: [{ shotId: "ap_shot_e1_s4_t7", adoptedAt: 3 }] });
    expect(listManhuaUsableStageFramesForSegment([t12, otherSeg, staleWorld], segCtx).map((r) => r.id)).toEqual(["t12"]);
  });
});
