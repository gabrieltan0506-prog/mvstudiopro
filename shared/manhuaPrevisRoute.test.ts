import { describe, it, expect } from "vitest";
import {
  createManhuaPrevisStudio,
  manhuaPrevisSpecSchema,
  manhuaPrevisDraftSchema,
  formatPrevisMotionGuide,
  previsShortestAngleDeg,
  previsSpecKey,
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
  const studio = createManhuaPrevisStudio(6),
    a = studio.spec.actors[0];
  a.motionRoute = [
    { timeSec: 0, position: [-1, 0], facingDeg: 0 },
    { timeSec: 3, position: [0, 0], facingDeg: 180 },
    { timeSec: 143 / 24, position: [-1, 0], facingDeg: 0 },
  ];
  return studio;
}
describe("分段路线时间、峰速、朝向与草稿", () => {
  it("保留节点及指南，旧配置无新增语句和身份变化", () => {
    const { spec } = fixture();
    expect(manhuaPrevisSpecSchema.parse(spec)).toEqual(spec);
    expect(formatPrevisMotionGuide(spec)).toContain(
      "3秒位置（0，0），朝向180度"
    );
    expect(formatPrevisMotionGuide(spec)).toContain("不代表自动避碰");
    const old = structuredClone(spec);
    delete old.actors[0].motionRoute;
    expect(formatPrevisMotionGuide(old)).not.toContain("分段路线");
    expect(previsSpecKey(spec)).not.toBe(previsSpecKey(old));
    expect(manhuaPrevisSpecSchema.parse(old)).toEqual(old);
  });
  it.each([
    [170, -170, 20],
    [-170, 170, -20],
    [0, 180, 180],
    [180, 0, 180],
    [-180, 180, 0],
  ])("最短角差%s→%s=%s", (a, b, expected) =>
    expect(previsShortestAngleDeg(a, b)).toBe(expected)
  );
  it.each([
    "empty",
    "one",
    "startTime",
    "lastTime",
    "startPosition",
    "endPosition",
    "facing",
    "fraction",
    "order",
    "gap",
    "fastMove",
    "fastTurn",
    "water",
    "creature",
  ])("拒绝非法%s", mode => {
    const { spec } = fixture(),
      a = spec.actors[0],
      r = a.motionRoute!;
    if (mode === "empty") a.motionRoute = [];
    if (mode === "one") a.motionRoute = r.slice(0, 1);
    if (mode === "startTime") r[0].timeSec = 0.25;
    if (mode === "lastTime") r[2].timeSec = 6;
    if (mode === "startPosition") r[0].position[0] = 0;
    if (mode === "endPosition") r[2].position[0] = 0;
    if (mode === "facing") r[0].facingDeg = 10;
    if (mode === "fraction") r[1].timeSec = 3.01;
    if (mode === "order") r[1].timeSec = 6;
    if (mode === "gap") r[1].timeSec = 1 / 24;
    if (mode === "fastMove") r[1].position = [10, 0];
    if (mode === "fastTurn") r[1].timeSec = 1;
    if (mode === "water")
      spec.waterEmergence = {
        mode: "simultaneous",
        events: [
          {
            actorId: a.id,
            crossSec: 1,
            riseSec: 1,
            height: 1,
            waveRadius: 1,
            waveHeight: 1,
            waveDurationSec: 1,
          },
        ],
      };
    if (mode === "creature")
      a.creature = {
        preset: "four_tail_black_wings",
        transformStartSec: 0,
        transformEndSec: 1,
      };
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });
  it("峰速边界和短弧正确，不沿旧移动时长误拒绝路线", () => {
    const { spec } = fixture(),
      a = spec.actors[0];
    a.moveEndSec = 0.25;
    a.end = [1, 0];
    a.motionRoute = [
      { timeSec: 0, position: [-1, 0], facingDeg: 0 },
      { timeSec: 2.5, position: [1, 0], facingDeg: 180 },
      { timeSec: 143 / 24, position: [1, 0], facingDeg: 180 },
    ];
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
    a.motionRoute[1].position[0] = 1.01;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    a.motionRoute[1].position[0] = 1;
    a.moveEndSec = 0;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });
  it("180度转向至少2.25秒，角跨边界走20度短弧", () => {
    const { spec } = fixture(),
      a = spec.actors[0];
    a.motionRoute![1].position = [-1, 0];
    a.motionRoute![1].timeSec = 2.25;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
    a.motionRoute![1].timeSec = 53 / 24;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    a.facingDeg = 170;
    a.motionRoute![0].facingDeg = 170;
    a.motionRoute![1].facingDeg = -170;
    a.motionRoute![1].timeSec = 0.25;
    a.motionRoute![2].facingDeg = -170;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
  });
  it("未闭合路线空数组和非法数字草稿云往返不丢身份", () => {
    const studio = fixture();
    studio.specHistory = [
      {
        spec: structuredClone(studio.spec),
        createdAt: "2026-09-13",
        reasonZh: "改前",
      },
    ];
    studio.spec.actors[0].motionRoute![1] = {
      timeSec: -1,
      position: [30, -30],
      facingDeg: 999,
    };
    expect(manhuaPrevisDraftSchema.parse(studio.spec)).toEqual(studio.spec);
    const b = normalizeCanvasBlock({
      ...defaultCanvasBlock("video", 0, 0),
      previsStudio: studio,
    });
    const payload = buildManhuaCloudDraftPayload({
      writerSession: {},
      blocks: [b],
      edges: [],
    });
    expect(
      parseManhuaCloudDraftPayload(JSON.stringify(payload))?.canvas.blocks[0]
        .previsStudio
    ).toEqual(JSON.parse(JSON.stringify(studio)));
    studio.spec.actors[0].motionRoute = [];
    expect(
      manhuaPrevisDraftSchema.parse(studio.spec).actors[0].motionRoute
    ).toEqual([]);
  });
});
