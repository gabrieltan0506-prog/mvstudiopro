import { describe, expect, it } from "vitest";
import { directManhuaCamerasFromShots, manhuaDirectionCameraHints, type ManhuaDirectedActor } from "./manhuaCameraDirection";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema } from "./manhuaPrevis";

// 《墨菁传》第1集第1段镜1–4 分镜原文（0929 正式页只读取数）
const shots = [
  { index: 1, durationSec: 5, cameraZh: "近景→中景；阿菁肩后平视；快切后横移贴身跟拍", actionZh: "阿菁背着病母奔走：娘双臂环住阿菁肩颈、双脚离地。棕马墨屠跛行跟在两人身后。" },
  { index: 2, durationSec: 3, cameraZh: "极近景→低角中景；地面低机位；跟蹄一拍，抬镜露眼罩", actionZh: "极低机位贴近棕马墨屠的前蹄，画面上沿露出墨屠左眼旧布眼罩。" },
  { index: 3, durationSec: 5, cameraZh: "过肩→掌心特写；曹三侧后方、守住马在画左；视线切掌心，短促前推", actionZh: "曹三跨出摊柱，盯住墨屠带伤肩，掌心暗红聚成一团" },
  { index: 4, durationSec: 4, cameraZh: "全景→冲击近景；沿曹三出掌方向，轴线不翻；一次迅猛横切，接触瞬间定一拍", actionZh: "曹三第一掌打中墨屠肩；马撞裂木摊、血口与木片同向飞出；阿菁骤回头" },
];
const lerp = (a: [number, number], b: [number, number], t0: number, t1: number) => (t: number): [number, number] => {
  const u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
};
const actors: ManhuaDirectedActor[] = [
  { id: "aj", nameZh: "阿菁", shape: "human", at: lerp([-1, 0], [-0.3, 0.25], 0, 8.75) },
  { id: "niang", nameZh: "娘", shape: "human", at: lerp([-1, 0], [-0.3, 0.25], 0, 8.75), carriedBy: "aj" },
  { id: "mt", nameZh: "墨屠", shape: "horse", at: lerp([1, 0], [0.75, 0], 0, 14.875) },
  { id: "cs", nameZh: "曹三", shape: "human", at: lerp([3, 0], [2, 0], 8.75, 17), facingAt: () => 180 },
];
const plan = directManhuaCamerasFromShots({ shots, actors, durationSec: 17, aspect: "16:9", directionCardId: "embodied_fable_system" });
const cut = (shotIndex: number, i = 0) => plan.cameras.filter((c) => c.shotIndex === shotIndex)[i]!;

describe("按分镜自动排运镜", () => {
  it("排出的机位连续覆盖全片且过白模合同", () => {
    expect(plan.errorsZh).toEqual([]);
    expect(plan.cameras.length).toBeLessThanOrEqual(8);
    const spec = { ...createManhuaPrevisStudio(17).spec, cameras: plan.cameras.map(({ shotIndex: _s, noteZh: _n, ...c }) => c) };
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
  });
  it("「切」拆成硬切，无「切」的「→」是一镜内连续运动", () => {
    expect(plan.cameras.filter((c) => c.shotIndex === 3)).toHaveLength(2);
    expect(plan.cameras.filter((c) => c.shotIndex === 2)).toHaveLength(1);
  });
  it("贴地极近景跟蹄，连续抬到低角中景并拉开焦距", () => {
    const c = cut(2);
    expect(c.position[2]).toBe(0.3);
    expect(c.target[2]).toBeLessThan(0.8);
    expect(c.lens).toBe(65);
    expect(c.endLens).toBe(35);
    expect(c.endTarget![2]).toBeGreaterThan(1.5);
  });
  it("掌心特写短推：终点更近、焦距推长", () => {
    const c = cut(3, 1);
    const d0 = Math.hypot(...c.position.map((n, i) => n - c.target[i]!));
    const d1 = Math.hypot(...c.endPosition!.map((n, i) => n - (c.endTarget ?? c.target)[i]!));
    expect(d1).toBeLessThan(d0);
    expect(c.endLens!).toBeGreaterThan(c.lens);
  });
  it("冲击近景对准被打的墨屠肩与出掌之间，不是出手的人；「横切」不当横移", () => {
    const c = cut(4, 1);
    expect(c.noteZh).toContain("肩部");
    expect(c.noteZh).toContain("墨屠");
    expect(c.noteZh).not.toContain("横移");
    const horseX = actors[2]!.at(14.5)[0], caoX = actors[3]!.at(14.5)[0];
    expect(c.target[0]).toBeGreaterThan(horseX);
    expect(c.target[0]).toBeLessThan(caoX);
  });
  it("背负同位的过肩不把机位插进人体", () => {
    const c = cut(1);
    const d = Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1]);
    expect(d).toBeGreaterThan(1);
    expect(c.noteZh).toContain("过阿菁肩");
  });
  it("白模时长对不上分镜合计时报错，不猜", () => {
    const bad = directManhuaCamerasFromShots({ shots, actors, durationSec: 20 });
    expect(bad.cameras).toEqual([]);
    expect(bad.errorsZh[0]).toContain("不一致");
  });
  it("导演包只取卡片写明的手法", () => {
    expect(manhuaDirectionCameraHints("embodied_fable_system")).toEqual({ reactionToNonHuman: true, masterViewFirst: true });
    expect(manhuaDirectionCameraHints("no-such-card")).toEqual({ reactionToNonHuman: false, masterViewFirst: false });
  });
});

describe("白模相机扩展字段", () => {
  const base = createManhuaPrevisStudio(4).spec;
  const withCam = (cam: Record<string, unknown>) => ({ ...base, cameras: [{ startSec: 0, endSec: 4, position: [0, -5, 1.5], target: [0, 0, 1.2], lens: 35, ...cam }] });
  it("焦距终点与环绕升降可用", () => {
    expect(manhuaPrevisSpecSchema.safeParse(withCam({ endLens: 60 })).success).toBe(true);
    expect(manhuaPrevisSpecSchema.safeParse(withCam({ orbitDeg: 40, orbitRise: 1 })).success).toBe(true);
  });
  it("环绕升降不能单独用，升降后高度须在范围内", () => {
    expect(manhuaPrevisSpecSchema.safeParse(withCam({ orbitRise: 1 })).success).toBe(false);
    expect(manhuaPrevisSpecSchema.safeParse(withCam({ orbitDeg: 40, orbitRise: -1.4 })).success).toBe(false);
    expect(manhuaPrevisSpecSchema.safeParse(withCam({ endLens: 80 })).success).toBe(false);
  });
});

describe("自动排镜输出一定过白模相机合同（审查反例）", () => {
  const valid = (input: Parameters<typeof directManhuaCamerasFromShots>[0]) => {
    const p = directManhuaCamerasFromShots(input);
    expect(p.errorsZh).toEqual([]);
    const spec = { ...createManhuaPrevisStudio(input.durationSec).spec, aspect: input.aspect ?? "16:9", cameras: p.cameras.map(({ shotIndex: _s, noteZh: _n, ...c }) => c) };
    const r = manhuaPrevisSpecSchema.safeParse(spec);
    expect(r.success ? [] : r.error.issues.map((i) => i.message)).toEqual([]);
    return p;
  };
  const one: ManhuaDirectedActor[] = [{ id: "a", nameZh: "阿菁", shape: "human", at: () => [0, 0] }];
  it("0.5 秒的镜写了快切也切不开：改为一镜内连续运动，不产出零帧机位", () => {
    const p = valid({ durationSec: 3, actors: one, shots: [{ index: 1, durationSec: 0.5, cameraZh: "近景→特写；平视；快切" }, { index: 2, durationSec: 2.5, cameraZh: "中景；平视；定机" }] });
    expect(p.cameras.filter((c) => c.shotIndex === 1)).toHaveLength(1);
    expect(p.notesZh.join("")).toContain("改为一镜内连续运动");
  });
  it("不足一帧的镜直接报错，不猜着并镜", () => {
    const p = directManhuaCamerasFromShots({ durationSec: 3, actors: one, shots: [{ index: 1, durationSec: 0.01, cameraZh: "近景" }, { index: 2, durationSec: 2.99, cameraZh: "中景" }] });
    expect(p.cameras).toEqual([]);
    expect(p.errorsZh[0]).toContain("不足一帧");
  });
  it("过肩接横移时相对向量扫过看向点：途中也保持半米以上", () => {
    valid({ durationSec: 3, aspect: "9:16", shots: [{ index: 1, durationSec: 3, cameraZh: "近景脸；曹三肩后；横移", actionZh: "先生冲击墨屠眼罩" }],
      actors: [{ id: "m", nameZh: "墨屠", shape: "horse", at: () => [0, 0], facingAt: () => 0 }, { id: "c", nameZh: "曹三", shape: "human", at: () => [0.4, 0], facingAt: () => 180 }] });
  });
  it("环绕圈出舞台就不环绕，说明里也不写环绕", () => {
    const p = valid({ durationSec: 3, shots: [{ index: 1, durationSec: 3, cameraZh: "远景背影；墨屠侧后方；绕到侧面下降", actionZh: "曹三冲击先生" }],
      actors: [{ id: "m", nameZh: "墨屠", shape: "human", at: () => [-8, 6], facingAt: () => 30 }, { id: "c", nameZh: "曹三", shape: "human", at: () => [12, -12], facingAt: () => 180 }, { id: "x", nameZh: "先生", shape: "human", at: () => [11.5, -11.5], facingAt: () => 0 }] });
    expect(p.cameras[0]!.orbitDeg).toBeUndefined();
    expect(p.cameras[0]!.noteZh).not.toContain("环绕");
  });
  it("景别×机位×运镜×站位网格全部过合同", { timeout: 20000 }, () => {
    const scales = ["极近景", "特写蹄", "近景手", "中景", "全景", "远景背影", "近景→中景", "特写→全景，切", "极近景→低角中景→全景，反打"];
    const angles = ["俯拍", "低角仰拍", "地面低机位", "过阿菁肩", "曹三肩后", ""];
    const moves = ["推近", "后拉", "横移", "上升", "下降", "环绕上升", "环绕下降", "跟拍", "抬镜", ""];
    const casts: ManhuaDirectedActor[][] = [
      one,
      [{ id: "a", nameZh: "阿菁", shape: "human", at: () => [11.8, -11.8], facingAt: () => 90 }, { id: "c", nameZh: "曹三", shape: "human", at: () => [11.8, -11.8], facingAt: () => -90 }],
      [{ id: "a", nameZh: "阿菁", shape: "human", at: (s) => [-12 + s * 4, -12 + s * 4], facingAt: () => 45 }, { id: "m", nameZh: "墨屠", shape: "horse", at: () => [0.3, 0], facingAt: () => 180 }, { id: "c", nameZh: "曹三", shape: "human", at: () => [0, 0], facingAt: () => 0 }],
    ];
    let n = 0;
    for (const cast of casts) for (const aspect of ["16:9", "9:16"] as const) for (const s of scales) for (const a of angles) for (const m of moves) {
      valid({ durationSec: 4, aspect, actors: cast, shots: [{ index: 1, durationSec: 1, cameraZh: `${s}；${a}；${m}`, actionZh: "曹三冲击墨屠肩，阿菁反应回头" }, { index: 2, durationSec: 3, cameraZh: `${s}曹三；${a}；${m}` }] });
      n += 1;
    }
    expect(n).toBe(3 * 2 * scales.length * angles.length * moves.length);
  });
});

describe("自动排镜不绑定具体剧名", () => {
  const still = (x: number, y: number) => () => [x, y] as [number, number];
  const reactionShot = [{ index: 1, durationSec: 4, cameraZh: "近景；平视；推近", actionZh: "白泽回头，痛喘一声" }];
  it("非人判定按形体：名字里没有马/墨的四足也拿到反应镜长焦", () => {
    const plan = directManhuaCamerasFromShots({ shots: reactionShot, durationSec: 4, directionCardId: "embodied_fable_system",
      actors: [{ id: "bz", nameZh: "白泽", shape: "horse", at: still(0, 0) }, { id: "p", nameZh: "少年", shape: "human", at: still(2, 0) }] });
    expect(plan.errorsZh).toEqual([]);
    expect(plan.cameras[0]!.lens).toBeGreaterThanOrEqual(55);
  });
  it("名字带「墨」的人不被当成非人角色", () => {
    const plan = directManhuaCamerasFromShots({ shots: [{ ...reactionShot[0]!, actionZh: "墨尘回头，痛喘一声" }], durationSec: 4, directionCardId: "embodied_fable_system",
      actors: [{ id: "mc", nameZh: "墨尘", shape: "human", at: still(0, 0) }, { id: "h", nameZh: "黑马", shape: "horse", at: still(2, 0) }] });
    expect(plan.cameras[0]!.lens).toBe(50);
  });
});
