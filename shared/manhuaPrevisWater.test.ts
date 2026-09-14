import { describe, expect, it } from "vitest";
import {
  createManhuaPrevisStudio,
  manhuaPrevisSpecSchema,
  manhuaPrevisDraftSchema,
  formatPrevisMotionGuide,
  previsSpecKey,
  PREVIS_RENDER_UNIT_BUDGET,
} from "./manhuaPrevis";
import {
  buildManhuaCloudDraftPayload,
  parseManhuaCloudDraftPayload,
} from "./manhuaCloudDraft";
import {
  defaultCanvasBlock,
  normalizeCanvasBlock,
} from "../client/src/lib/canvasTypes";
function fixture() {
  const studio = createManhuaPrevisStudio(5);
  const actor = studio.spec.actors[0];
  studio.spec.actors = [-4, 0, 4].map((x, i) => ({
    ...structuredClone(actor),
    id: `actor-${i + 1}`,
    nameZh: `人物${i + 1}`,
    start: [x, 0],
    end: [x, 0],
  }));
  studio.spec.waterEmergence = {
    mode: "simultaneous",
    events: studio.spec.actors.map(a => ({
      actorId: a.id,
      crossSec: 1,
      riseSec: 1.25,
      height: 2.8,
      waveRadius: 1.5,
      waveHeight: 1.8,
      waveDurationSec: 2.5,
    })),
  };
  return studio;
}
describe("独立出水契约、草稿与参考", () => {
  it("保留全部事件、原预算及确切指南秒位", () => {
    const { spec } = fixture();
    expect(manhuaPrevisSpecSchema.parse(spec)).toEqual(spec);
    expect(PREVIS_RENDER_UNIT_BUDGET).toBe(2700);
    const guide = formatPrevisMotionGuide(spec);
    expect(guide).toContain("同时冲出");
    expect(guide).toContain(
      "人物1：1秒头部首先破水，随后1.25秒竖直上升，2.25秒根节点达到水面上2.8米"
    );
    expect(guide).toContain("独立浪花1—3.5秒，最大半径1.5米、高1.8米");
    expect(guide).toContain("不互相遮挡或汇合");
    expect(guide).toContain("不代表真实水质");
    const old = structuredClone(spec);
    delete old.waterEmergence;
    expect(previsSpecKey(old)).not.toEqual(previsSpecKey(spec));
    expect(formatPrevisMotionGuide(old)).not.toContain("出水");
    expect(manhuaPrevisSpecSchema.parse(old)).toEqual(old);
  });
  it.each([
    ["crossSec", 0.49],
    ["riseSec", 0.49],
    ["riseSec", 3.1],
    ["height", 0.49],
    ["height", 5.1],
    ["waveRadius", 0.39],
    ["waveRadius", 2.51],
    ["waveHeight", 0.29],
    ["waveHeight", 3.1],
    ["waveDurationSec", 0.49],
    ["waveDurationSec", 4.1],
  ] as const)("拒绝范围外 %s=%s", (key, value) => {
    const { spec } = fixture();
    spec.waterEmergence!.events[0][key] = value;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });
  it("显式空值不伪装成未启用，待机和空互动不妨碍出水", () => {
    const { spec } = fixture();
    expect(
      manhuaPrevisSpecSchema.safeParse({ ...spec, waterEmergence: null })
        .success
    ).toBe(false);
    spec.interactions = [];
    spec.actors[0].actions = [{ kind: "idle", startSec: 0, endSec: 5 }];
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
  });
  it("错峰至少一帧，无需事件数组按时间排序", () => {
    const { spec } = fixture();
    const water = spec.waterEmergence!;
    water.mode = "staggered";
    water.events.forEach((e, i) => {
      e.crossSec = 1 + (2 - i) / 24;
    });
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
    water.events[2].crossSec = water.events[1].crossSec;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });
  it("完成时刻能恰好落在末帧，下一帧被拒绝", () => {
    const { spec } = fixture();
    spec.waterEmergence!.events.forEach(e => {
      e.crossSec = 1;
      e.riseSec = 3;
      e.waveDurationSec = 95 / 24;
    });
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
    spec.waterEmergence!.events[0].waveDurationSec = 4;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });
  it.each([
    "unknown",
    "duplicate",
    "missing",
    "empty",
    "mode",
    "fraction",
    "riseFraction",
    "waveFraction",
    "overlap",
    "moving",
    "horse",
    "weapon",
    "action",
    "contact",
    "duration",
    "actors",
  ])("拒绝%s非法生产配置", mode => {
    const { spec } = fixture();
    const water = spec.waterEmergence!;
    if (mode === "unknown") water.events[0].actorId = "unknown";
    if (mode === "duplicate") water.events[0].actorId = water.events[1].actorId;
    if (mode === "missing") water.events.pop();
    if (mode === "empty") water.events = [];
    if (mode === "mode") water.events[0].crossSec += 1 / 24;
    if (mode === "fraction") water.events[0].crossSec = 1.01;
    if (mode === "riseFraction") water.events[0].riseSec = 1.01;
    if (mode === "waveFraction") water.events[0].waveDurationSec = 1.01;
    if (mode === "overlap") spec.actors[0].start = spec.actors[0].end = [-3, 0];
    if (mode === "moving") spec.actors[0].end[0] += 1;
    if (mode === "horse") spec.actors[0].shape = "horse";
    if (mode === "weapon") spec.actors[0].weapon = "practice_sword";
    if (mode === "action")
      spec.actors[0].actions = [{ kind: "strike", startSec: 0, endSec: 1 }];
    if (mode === "contact")
      spec.interactions = [
        {
          id: "e",
          kind: "strike_guard",
          actorId: "actor-1",
          targetActorId: "actor-2",
          startSec: 0.5,
          contactSec: 1,
          endSec: 2,
        },
      ];
    if (mode === "duration") {
      spec.durationSec = 9;
      spec.cameras[0].endSec = 9;
    }
    if (mode === "actors") {
      spec.actors.push({
        ...structuredClone(spec.actors[0]),
        id: "actor-4",
        start: [8, 0],
        end: [8, 0],
      });
      water.events.push({ ...water.events[0], actorId: "actor-4" });
    }
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });
  it("保守范围可在任一平面轴分离，保留0.1米间距", () => {
    const { spec } = fixture();
    spec.actors[0].start = spec.actors[0].end = [0, -3.1];
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
    spec.actors[0].start = spec.actors[0].end = [0, -3.09];
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });
  it("未闭合数字和空事件草稿可以云往返，历史生产快照仍严格保留", () => {
    const studio = fixture();
    const original = structuredClone(studio.spec);
    studio.history = [
      {
        jobId: "water-job",
        requestId: "11111111-1111-4111-8111-111111111111",
        gcsUri: "gs://test/preview.mp4",
        url: "https://example.test/preview.mp4",
        durationSec: 5,
        createdAt: "2026-09-13",
        spec: original,
      },
    ];
    studio.specHistory = [
      { spec: original, createdAt: "2026-09-13", reasonZh: "改前" },
    ];
    Object.assign(studio.spec.waterEmergence!.events[0], {
      crossSec: -1,
      riseSec: 0,
      height: -2,
      waveRadius: 0,
      waveHeight: 0,
      waveDurationSec: 0,
    });
    expect(manhuaPrevisDraftSchema.parse(studio.spec)).toEqual(studio.spec);
    expect(manhuaPrevisSpecSchema.safeParse(studio.spec).success).toBe(false);
    const block = normalizeCanvasBlock({
      ...defaultCanvasBlock("video", 0, 0),
      id: "water-clip",
      previsStudio: studio,
    });
    const payload = buildManhuaCloudDraftPayload({
      writerSession: {},
      blocks: [block],
      edges: [],
    });
    expect(
      parseManhuaCloudDraftPayload(JSON.stringify(payload))?.canvas.blocks[0]
        .previsStudio
    ).toEqual(JSON.parse(JSON.stringify(studio)));
    studio.spec.waterEmergence!.events = [];
    expect(
      manhuaPrevisDraftSchema.parse(studio.spec).waterEmergence?.events
    ).toEqual([]);
  });
});
