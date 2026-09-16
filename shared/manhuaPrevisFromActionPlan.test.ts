import { describe, expect, it } from "vitest";
import { A, B, MAN, WOMAN, buildBoatFight } from "./manhuaActionPlanBoatFightFixture";
import { splitManhuaActionPlanForPrevis } from "./manhuaActionPlanSplit";
import { manhuaPrevisSpecSchema } from "./manhuaPrevis";
import { applyManhuaPrevisDraftToStudio, manhuaPrevisDraftFromExecutableShot } from "./manhuaPrevisFromActionPlan";
import { createManhuaPrevisStudio } from "./manhuaPrevis";
import { resolveManhuaCameraTempo } from "./manhuaCameraTempo";

const cam = (endSec: number) => ({
  source: "previs_cameras" as const,
  sourceShotRef: "pv",
  sourceRevision: "r",
  coverage: { startSec: 0, endSec },
  coverageBasis: "source" as const,
  sampling: { kind: "discrete" as const, fps: 24 },
  timedSamplesAvailable: true,
});

describe("动作计划 → 白模规格草案", () => {
  const plan = buildBoatFight();
  const { shots } = splitManhuaActionPlanForPrevis(plan);

  it("镜1 男女交锋：两条互动、时间来自 timing、持剑 → sword_guard；过生产 schema", () => {
    const shot = shots.find((s) => s.sourceShotId === "ap_shot_1")!;
    const d = manhuaPrevisDraftFromExecutableShot({ plan, shot, resolvedCamera: cam(6), aspect: "16:9", links: [{ actorId: MAN, assetRef: "asset_man" }] });
    expect(d.issuesZh).toEqual([]);
    expect(d.spec).not.toBeNull();
    expect(manhuaPrevisSpecSchema.safeParse(d.spec).success).toBe(true);
    expect(d.spec!.durationSec).toBe(6);
    expect(d.spec!.actors.map((a) => a.id)).toEqual([MAN, WOMAN]);
    expect(d.spec!.actors[0]!.assetRef).toBe("asset_man");
    expect(d.spec!.actors.every((a) => a.weapon === "practice_sword")).toBe(true);
    // phases(0,2)：起手 0–0.67，接触 0.67–1.33，卸力 1.33–2
    const it2 = d.spec!.interactions!;
    expect(it2.map((i) => [i.id, i.kind, i.actorId, i.targetActorId])).toEqual([
      ["ap_evt_1a", "sword_guard", MAN, WOMAN],
      ["ap_evt_1b", "sword_guard", WOMAN, MAN],
    ]);
    // 秒位吸附到 24 帧：0.6667 → 16/24
    expect(it2[0]!.startSec).toBe(0);
    expect(it2[0]!.contactSec).toBeCloseTo(16 / 24, 9);
    expect(it2[0]!.endSec).toBeCloseTo(2, 9);
    expect(it2[1]!.startSec).toBeCloseTo(2, 9);
    expect(it2[1]!.contactSec).toBeCloseTo(2 + 16 / 24, 9);
    expect(it2[1]!.endSec).toBeCloseTo(4, 9);
    expect(d.summaryZh.some((s) => s.includes("站位为默认排布"))).toBe(true);
    expect(d.summaryZh.some((s) => s.startsWith("运镜"))).toBe(true);
  });

  it("出水镜：只有出水者在场，浪花事件按接触点，错峰；画外去向进摘要", () => {
    const shot = shots.find((s) => s.kind === "water_emerge")!;
    const d = manhuaPrevisDraftFromExecutableShot({ plan, shot, resolvedCamera: cam(6), aspect: "9:16" });
    expect(d.spec).not.toBeNull();
    expect(d.spec!.actors.map((a) => a.id).sort()).toEqual([A, B].sort());
    expect(d.spec!.waterEmergence?.mode).toBe("staggered");
    expect(d.spec!.waterEmergence?.events.map((e) => e.actorId)).toEqual([A, B]);
    expect(d.spec!.waterEmergence?.events.every((e) => e.riseSec >= 0.5 && e.riseSec <= 3)).toBe(true);
    expect(d.summaryZh.some((s) => s.startsWith("画外"))).toBe(true);
    expect(d.spec!.interactions).toBeUndefined();
  });

  it("镜3 四人两组交锋：对手都在场 → 两条互动；无相机采样 → 带回相机问题但仍按文法编排切镜", () => {
    const shot = shots.find((s) => s.sourceShotId === "ap_shot_3")!;
    const d = manhuaPrevisDraftFromExecutableShot({ plan, shot, resolvedCamera: null, aspect: "16:9" });
    expect(d.spec!.interactions?.map((i) => `${i.actorId}>${i.targetActorId}`)).toEqual([`${MAN}>${A}`, `${WOMAN}>${B}`]);
    expect(d.issuesZh.some((s) => s.includes("相机"))).toBe(true);
    expect(d.spec!.cameras.length).toBeGreaterThanOrEqual(4);
    expect(d.spec!.cameras[d.spec!.cameras.length - 1]!.endSec).toBe(d.spec!.durationSec);
  });

  it("对手不在场 → 该互动不进规格并如实报出", () => {
    const shot = shots.find((s) => s.sourceShotId === "ap_shot_1")!;
    const broken = { ...shot, onstageActorIds: [MAN], offstage: [...shot.offstage, { actorId: WOMAN, presence: "offstage" as const, whereaboutsZh: "船尾" }] };
    const d = manhuaPrevisDraftFromExecutableShot({ plan, shot: broken, resolvedCamera: cam(6), aspect: "16:9" });
    expect(d.spec?.interactions).toBeUndefined();
    expect(d.issuesZh.join("\n")).toContain("不在本镜在场名单");
  });
});

describe("1468 R1 · 边界：秒位吸附与短镜出水", () => {
  const plan = buildBoatFight();
  const { shots } = splitManhuaActionPlanForPrevis(plan);
  const isFrame = (t: number) => Math.abs(t * 24 - Math.round(t * 24)) < 1e-6;

  it("接触点贴着镜头两端：吸附 24 帧后仍 startSec < contactSec < endSec ≤ durationSec，且都在帧上", () => {
    const shot = shots.find((s) => s.sourceShotId === "ap_shot_1")!;
    const nearEdges = {
      ...shot,
      events: [
        { eventId: "e_head", kind: "attack" as const, actorId: MAN, targetActorId: WOMAN, outcome: "hit", slowMotionIntent: false,
          phases: [{ kind: "windup" as const, sourceStartSec: 0, sourceEndSec: 0.05 }, { kind: "contact" as const, sourceStartSec: 0.05, sourceEndSec: 0.1 }, { kind: "recover" as const, sourceStartSec: 0.1, sourceEndSec: 0.2 }] },
        { eventId: "e_tail", kind: "attack" as const, actorId: WOMAN, targetActorId: MAN, outcome: "blocked", slowMotionIntent: false,
          phases: [{ kind: "windup" as const, sourceStartSec: 5.9, sourceEndSec: 5.95 }, { kind: "contact" as const, sourceStartSec: 5.95, sourceEndSec: 5.98 }, { kind: "recover" as const, sourceStartSec: 5.98, sourceEndSec: 6 }] },
      ],
    };
    const d = manhuaPrevisDraftFromExecutableShot({ plan, shot: nearEdges as typeof shot, resolvedCamera: cam(6), aspect: "16:9" });
    const D = d.timing.durationSec;
    expect(d.spec).not.toBeNull();
    for (const i of d.spec!.interactions!) {
      expect(i.startSec).toBeLessThan(i.contactSec);
      expect(i.contactSec).toBeLessThan(i.endSec);
      expect(i.endSec).toBeLessThanOrEqual(D);
      expect([i.startSec, i.contactSec, i.endSec].every(isFrame)).toBe(true);
    }
  });

  it("出水点贴着镜尾（浪花 1.5s 放不下）：不抛，spec 为 null 且带回合同原因；出水点仍不越过 durationSec", () => {
    const water = shots.find((s) => s.kind === "water_emerge")!;
    const late = {
      ...water,
      events: water.events.map((e) => (e.kind === "emerge"
        ? { ...e, phases: [{ kind: "windup" as const, sourceStartSec: water.sourceSpan.endSec - 0.3, sourceEndSec: water.sourceSpan.endSec - 0.1 }, { kind: "contact" as const, sourceStartSec: water.sourceSpan.endSec - 0.1, sourceEndSec: water.sourceSpan.endSec }] }
        : e)),
    };
    const d = manhuaPrevisDraftFromExecutableShot({ plan, shot: late as typeof water, resolvedCamera: cam(6), aspect: "9:16" });
    expect(d.spec).toBeNull();
    expect(d.issuesZh.join("\n")).toMatch(/最后一个实际视频帧|上升与浪花/);
  });
});


describe("1468 R2 · 套用草案可撤销", () => {
  it("套用把当前规格压进 specHistory 末尾；「恢复上一份」弹回原规格", () => {
    const plan = buildBoatFight();
    const { shots } = splitManhuaActionPlanForPrevis(plan);
    const d = manhuaPrevisDraftFromExecutableShot({ plan, shot: shots[0]!, resolvedCamera: cam(6), aspect: "16:9" });
    const studio = createManhuaPrevisStudio();
    const before = studio.spec;
    const applied = applyManhuaPrevisDraftToStudio(studio, d.spec!, "2026-09-16T00:00:00.000Z");
    expect(applied.spec).toEqual(d.spec);
    expect(applied.specHistory?.at(-1)).toEqual({ spec: before, createdAt: "2026-09-16T00:00:00.000Z", reasonZh: "套用动作计划草案前的配置" });
    // 与工作台「恢复上一份动作配置」同一算法：取末条回填、历史去尾
    const restored = { ...applied, spec: applied.specHistory!.at(-1)!.spec, specHistory: applied.specHistory!.slice(0, -1) };
    expect(restored.spec).toEqual(before);
    expect(restored.specHistory).toEqual(studio.specHistory ?? []);
  });
});

describe("PR-6 · 节奏档进白模草案", () => {
  const plan = buildBoatFight();
  const { shots } = splitManhuaActionPlanForPrevis(plan);
  const shot = shots.find((s) => s.sourceShotId === "ap_shot_1")!;
  it("不传 tempo：老口径不变，cameraPromptZh 每镜一句、tempoZh 为空", () => {
    const d = manhuaPrevisDraftFromExecutableShot({ plan, shot, resolvedCamera: cam(6), aspect: "16:9" });
    expect(d.cameraPromptZh.length).toBe(d.spec!.cameras.length);
    expect(d.tempoZh).toBe("");
    expect(d.summaryZh.some((l) => l.startsWith("节奏："))).toBe(false);
  });
  it("快档：摘要多一行「节奏：快 · 原因」，每镜运镜句与 cameraPromptZh 同源；慢档 ≤3 镜且句里有慢环绕", () => {
    const fast = resolveManhuaCameraTempo({ intentZh: "燃", hasContact: true });
    const d = manhuaPrevisDraftFromExecutableShot({ plan, shot, resolvedCamera: cam(6), aspect: "16:9", tempo: fast });
    expect(d.spec).not.toBeNull();
    expect(d.tempoZh).toMatch(/^快 · /);
    expect(d.summaryZh).toContain(`节奏：${d.tempoZh}`);
    expect(d.cameraPromptZh.length).toBe(d.spec!.cameras.length);
    for (const line of d.cameraPromptZh) expect(d.summaryZh.join("\n")).toContain(line);
    const slow = resolveManhuaCameraTempo({ intentZh: "静", hasContact: false });
    const s2 = manhuaPrevisDraftFromExecutableShot({ plan, shot, resolvedCamera: cam(6), aspect: "16:9", tempo: slow });
    expect(s2.spec!.cameras.length).toBeLessThanOrEqual(3);
    expect(s2.tempoZh).toMatch(/^慢 · /);
    // 镜1 首个接触贴片头，建立镜让位给接触镜（不推迟接触）；慢环绕在摘要备注里说明
    expect(s2.summaryZh.some((l) => l.includes("慢环绕"))).toBe(true);
  });
  it("用户改风格档覆盖 tempo.style：cameraStyle=handheld 时句子带手持、切点同硬切", () => {
    const fast = resolveManhuaCameraTempo({ intentZh: "燃", hasContact: true });
    const hard = manhuaPrevisDraftFromExecutableShot({ plan, shot, resolvedCamera: cam(6), aspect: "16:9", tempo: fast });
    const hand = manhuaPrevisDraftFromExecutableShot({ plan, shot, resolvedCamera: cam(6), aspect: "16:9", tempo: fast, cameraStyle: "handheld" });
    expect(hand.spec!.cameras.map((c) => [c.startSec, c.endSec])).toEqual(hard.spec!.cameras.map((c) => [c.startSec, c.endSec]));
    expect(hand.cameraPromptZh.every((l) => l.includes("手持"))).toBe(true);
    expect(hand.tempoZh).toContain("手持");
  });
});

describe("PR-6 · 套用草案带上运镜句", () => {
  it("传草案则写入 draftCameraPromptZh/draftTempoZh；不传则清掉旧句；规格历史照压", () => {
    const plan = buildBoatFight();
    const { shots } = splitManhuaActionPlanForPrevis(plan);
    const d = manhuaPrevisDraftFromExecutableShot({ plan, shot: shots[0]!, resolvedCamera: cam(6), aspect: "16:9", tempo: resolveManhuaCameraTempo({ intentZh: "燃", hasContact: true }) });
    const studio = createManhuaPrevisStudio();
    const applied = applyManhuaPrevisDraftToStudio(studio, d.spec!, "2026-09-16T00:00:00.000Z", d);
    expect(applied.draftCameraPromptZh).toEqual(d.cameraPromptZh);
    expect(applied.draftTempoZh).toBe(d.tempoZh);
    expect(applied.specHistory).toHaveLength(1);
    const again = applyManhuaPrevisDraftToStudio(applied, studio.spec as typeof d.spec & object, "2026-09-16T00:00:01.000Z");
    expect(again.draftCameraPromptZh).toBeUndefined();
    expect(again.draftTempoZh).toBeUndefined();
    expect(again.specHistory).toHaveLength(2);
  });
});
