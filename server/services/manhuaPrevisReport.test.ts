import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import { PREVIS_BODY_BONES } from "../../shared/manhuaPrevisRig";
import { expectedPiggybackMotion } from "../../shared/manhuaPrevisPiggyback";
import { validatePrevisReport } from "./manhuaPrevisReport";

function fixture() {
  const spec = createManhuaPrevisStudio(2).spec;
  spec.actors.push({
    ...structuredClone(spec.actors[0]),
    id: "actor-2",
    nameZh: "角色 2",
    start: [0.5, 0],
    end: [0.5, 0],
  });
  spec.interactions = [
    {
      id: "pair-1",
      kind: "strike_recoil",
      actorId: "actor-1",
      targetActorId: "actor-2",
      startSec: 0,
      contactSec: 1,
      endSec: 2,
    },
  ];
  const report = {
    frames: 48,
    fps: 24,
    warnings: [],
    actors: spec.actors.map(actor => ({
      id: actor.id,
      nameZh: actor.nameZh,
      bones: 16,
      contactError: 0,
      stanceDrift: 0,
      offscreenFrames: [],
    })),
    interactions: [
      {
        id: "pair-1",
        kind: "strike_recoil",
        actorId: "actor-1",
        targetActorId: "actor-2",
        contactFrame: 25,
        contactError: 0,
        actualPoint: [0, 0, 1],
        targetPoint: [0, 0, 1],
      },
    ],
  };
  return { spec, report };
}
describe("白模报告双向动作契约", () => {
  it("读取真实接触坐标并保留报告字段", () => {
    const f = fixture();
    expect(validatePrevisReport(f.report, f.spec)).toEqual(f.report);
  });
  it("旧无事件报告继续兼容", () => {
    const f = fixture();
    delete f.spec.interactions;
    const { interactions: _, ...legacy } = f.report;
    expect(validatePrevisReport(legacy, f.spec)).toEqual(legacy);
  });
  it.each([
    "missing",
    "duplicate",
    "kind",
    "actorId",
    "targetActorId",
    "id",
    "frame",
    "distance",
    "error",
    "nan",
    "dimensions",
  ])("拒绝交互报告篡改：%s", mode => {
    const f = fixture(),
      event = f.report.interactions[0];
    if (mode === "missing") f.report.interactions = [];
    else if (mode === "duplicate") f.report.interactions.push({ ...event });
    else if (["kind", "actorId", "targetActorId", "id"].includes(mode))
      Object.assign(event, { [mode]: "wrong" });
    else if (mode === "frame") event.contactFrame = 26;
    else if (mode === "distance") event.actualPoint[0] = 0.01;
    else if (mode === "error") event.contactError = 0.001;
    else if (mode === "nan") event.actualPoint[0] = NaN;
    else event.actualPoint.push(1);
    expect(() => validatePrevisReport(f.report, f.spec)).toThrow();
  });
});

describe("背负滑落逐帧报告", () => {
  it("按配置重算接触曲线，拒绝报告自填的假接住数据", () => {
    const f = fixture();
    delete f.spec.interactions;
    f.spec.actors[1].start = [...f.spec.actors[0].start];
    f.spec.actors[1].end = [...f.spec.actors[0].end];
    f.spec.actors[1].actions = [{ kind: "idle", startSec: 0, endSec: 2 }];
    const slipCatch = { slipStartSec: .25, catchSec: .9, recoverEndSec: 1.8, dropMeters: .12 };
    f.spec.piggyback = { carrierId: f.spec.actors[0].id, passengerId: f.spec.actors[1].id, slipCatch };
    const samples = Array.from({ length: 48 }, (_, i) => {
      const frame = i + 1;
      const motion = expectedPiggybackMotion(slipCatch, frame);
      return { frame, supportError: motion.supportGap, expectedSupportGap: motion.supportGap,
        actualDropMeters: motion.dropMeters, gripError: 0, passengerFootHeight: .4 };
    });
    const report = { frames: 48, fps: 24, warnings: [],
      actors: f.report.actors.map((actor, i) => ({ ...actor, supportMode: i ? "carried" : "grounded" })),
      piggyback: { carrierId: f.spec.actors[0].id, passengerId: f.spec.actors[1].id, slipCatch,
        samples, boundaryZh: "基础人形测试" } };
    expect(validatePrevisReport(report, f.spec)).toEqual(report);
    report.piggyback.samples[14].supportError = 0;
    expect(() => validatePrevisReport(report, f.spec)).toThrow(/逐帧接触/);
    report.piggyback.samples[14].supportError = samples[14].expectedSupportGap;
    report.piggyback.samples[14].expectedSupportGap = 0;
    expect(() => validatePrevisReport(report, f.spec)).toThrow(/逐帧接触/);
    report.piggyback.samples[14].expectedSupportGap = expectedPiggybackMotion(slipCatch, 15).supportGap;
    report.piggyback.samples[14].actualDropMeters = 0;
    expect(() => validatePrevisReport(report, f.spec)).toThrow(/逐帧接触/);
  });
});

function creatureFixture() {
  const f = fixture();
  delete f.spec.interactions;
  const actor = f.spec.actors[0];
  actor.shape = "horse";
  actor.creature = {
    preset: "four_tail_black_wings",
    transformStartSec: 0.5,
    transformEndSec: 1.5,
  };
  const report = {
    ...f.report,
    interactions: [],
    creatures: [
      {
        ownerId: actor.id,
        preset: "four_tail_black_wings",
        tailCount: 4,
        wingCount: 2,
        tailBones: 12,
        wingBones: 6,
        meshObjects: 36,
        transform: { ...actor.creature },
        offscreenFrames: [] as number[],
        boundaryZh: "白模尾翼范围",
        stages: Array.from({ length: 48 }, (_, index) => {
          const timeSec = index / 24,
            phase = Math.max(0, Math.min(1, (timeSec - 0.5) / 1));
          const progress = phase * phase * (3 - 2 * phase);
          return {
            frame: index + 1,
            timeSec,
            progress,
            visibleFraction: progress > 0 ? 1 : 0,
          };
        }),
      },
    ],
  };
  return { spec: f.spec, report };
}

function modelFixture() {
  const f = fixture();
  delete f.spec.interactions;
  const actor = f.spec.actors[0];
  actor.assetRef = "asset-1";
  actor.riggedModel = {
    sourceJobId: "m3d_saved",
    forwardAxis: "+X",
    targetHeight: 1.7,
  };
  const source = {
    actorId: actor.id,
    sourceJobId: "m3d_saved",
    sha256: "a".repeat(64),
    bytes: 2048,
  };
  const report = {
    ...f.report,
    interactions: [],
    models: [
      {
        ...source,
        vertices: 100,
        meshVertices: 100,
        accessorComponents: 1500,
        instanceComponents: 1500,
        instanceIndices: 300,
        imagePixels: 0,
        meshes: 1,
        jointNames: [...PREVIS_BODY_BONES] as string[],
        morphNames: [],
        mappedBones: 16,
        boneMap: Object.fromEntries(
          PREVIS_BODY_BONES.map(name => [name, name])
        ) as Record<(typeof PREVIS_BODY_BONES)[number], string>,
        forwardAxis: "+X",
        targetHeight: 1.7,
        weightedVertices: 100,
        retargetFrames: 48,
        retargetMode: "rest-corrected-rotation-preserve-target-lengths",
        contactValidated: false,
        boundaryZh: "源白模脚底误差不代表角色网格接地",
        offscreenFrames: [] as number[],
      },
    ],
  };
  return { spec: f.spec, report, sources: [source] };
}
describe("带骨模型报告与侧载存证", () => {
  it.each([
    ["meshVertices", 250001],
    ["accessorComponents", 8000001],
    ["instanceComponents", 8000001],
    ["instanceIndices", 1500001],
    ["imagePixels", 33554433],
  ] as const)("资源字段%s须存在且不能越界", (field, overflow) => {
    const f = modelFixture();
    Object.assign(f.report.models[0], { [field]: overflow });
    expect(() => validatePrevisReport(f.report, f.spec, f.sources)).toThrow();
    Reflect.deleteProperty(f.report.models[0], field);
    expect(() => validatePrevisReport(f.report, f.spec, f.sources)).toThrow();
  });
  it("显式骨名与真实导入映射一致时可完整保存", () => {
    const f = modelFixture();
    f.spec.actors[0].riggedModel!.boneMap = { pelvis: "实际骨盆" };
    f.report.models[0].boneMap.pelvis = "实际骨盆";
    f.report.models[0].jointNames[0] = "实际骨盆";
    expect(
      validatePrevisReport(f.report, f.spec, f.sources).models?.[0].boneMap
        .pelvis
    ).toBe("实际骨盆");
  });
  it.each([
    "missing",
    "truncated",
    "extra",
    "duplicate",
    "not-in-joints",
    "explicit-mismatch",
  ])("拒绝不完整或篡改的实际骨映射：%s", mode => {
    const f = modelFixture(),
      model = f.report.models[0];
    f.spec.actors[0].riggedModel!.boneMap = { pelvis: "pelvis" };
    if (mode === "missing") Reflect.deleteProperty(model, "boneMap");
    else if (mode === "truncated")
      Reflect.deleteProperty(model.boneMap, "head");
    else if (mode === "extra") Reflect.set(model.boneMap, "tail", "tail");
    else if (mode === "duplicate") model.boneMap.head = "neck";
    else if (mode === "not-in-joints") model.boneMap.head = "不存在的骨骼";
    else {
      model.boneMap.pelvis = "spine";
      model.boneMap.spine = "pelvis";
    }
    expect(() => validatePrevisReport(f.report, f.spec, f.sources)).toThrow();
  });
  it.each(["valid", "missing", "eyes", "frames", "quality"])(
    "表演报告检查：%s",
    mode => {
      const f = modelFixture();
      f.spec.actors[0].riggedModel!.performance = {
        controller: {
          eyeBones: { left: "eye-left", right: "eye-right" },
          expressions: {
            calm: { calm: 1 },
            tense: { tense: 1 },
            surprised: { surprised: 1 },
          },
        },
        cues: [
          {
            startSec: 0,
            endSec: 2,
            gazeTarget: [1, 1, 1],
            headYawDeg: 0,
            headPitchDeg: 0,
            breathAmplitude: 0.01,
            breathHz: 0.25,
            expression: "calm",
            intensity: 1,
          },
        ],
      };
      const performance = {
        frames: 48,
        eyeBones: ["eye-left", "eye-right"],
        expressions: ["calm", "tense", "surprised"],
        cueCount: 1,
        qualityAccepted: false,
      };
      const report = {
        ...f.report,
        models: [
          {
            ...f.report.models[0],
            ...(mode === "missing" ? {} : { performance }),
          },
        ],
      };
      if (mode === "eyes") performance.eyeBones.reverse();
      if (mode === "frames") performance.frames = 47;
      if (mode === "quality") performance.qualityAccepted = true;
      if (mode === "valid")
        expect(
          validatePrevisReport(report, f.spec, f.sources).models?.[0]
            .performance?.qualityAccepted
        ).toBe(false);
      else
        expect(() => validatePrevisReport(report, f.spec, f.sources)).toThrow();
    }
  );
  it("匹配的非空重定向报告通过，仍标为接地未验证", () => {
    const f = modelFixture();
    expect(
      validatePrevisReport(f.report, f.spec, f.sources).models?.[0]
        .contactValidated
    ).toBe(false);
  });
  it.each([
    "missing",
    "duplicate",
    "actor",
    "source",
    "sha",
    "bytes",
    "height",
    "axis",
    "frames",
    "empty",
    "contact",
    "manifest",
    "offscreen",
  ])("拒绝模型报告伪通过：%s", mode => {
    const f = modelFixture(),
      model = f.report.models[0];
    if (mode === "missing") f.report.models = [];
    else if (mode === "duplicate") f.report.models.push({ ...model });
    else if (mode === "actor") model.actorId = "wrong";
    else if (mode === "source") model.sourceJobId = "m3d_other";
    else if (mode === "sha") model.sha256 = "b".repeat(64);
    else if (mode === "bytes") model.bytes++;
    else if (mode === "height") model.targetHeight = 2;
    else if (mode === "axis") model.forwardAxis = "+Y";
    else if (mode === "frames") model.retargetFrames = 47;
    else if (mode === "empty") model.weightedVertices = 0;
    else if (mode === "contact") model.contactValidated = true;
    else if (mode === "manifest") f.sources = [];
    else model.offscreenFrames.push(49);
    expect(() => validatePrevisReport(f.report, f.spec, f.sources)).toThrow();
  });
});
describe("白模尾翼报告契约", () => {
  it("完整展开逐帧报告通过", () => {
    const f = creatureFixture();
    expect(validatePrevisReport(f.report, f.spec)).toEqual(f.report);
  });
  it.each([
    "missing",
    "duplicate",
    "owner",
    "transform",
    "truncate",
    "frame",
    "progress",
    "visibility",
    "tailCount",
    "mesh",
    "offscreen",
  ])("拒绝尾翼伪完整报告：%s", mode => {
    const f = creatureFixture(),
      creature = f.report.creatures[0];
    if (mode === "missing") f.report.creatures = [];
    else if (mode === "duplicate") f.report.creatures.push({ ...creature });
    else if (mode === "owner") creature.ownerId = "wrong";
    else if (mode === "transform") creature.transform.transformEndSec = 1.75;
    else if (mode === "truncate") creature.stages.pop();
    else if (mode === "frame") creature.stages[2].frame = 2;
    else if (mode === "progress") creature.stages[24].progress = 0;
    else if (mode === "visibility") creature.stages[24].visibleFraction = 0;
    else if (mode === "tailCount") creature.tailCount = 3;
    else if (mode === "mesh") creature.meshObjects = 35;
    else creature.offscreenFrames.push(49);
    expect(() => validatePrevisReport(f.report, f.spec)).toThrow();
  });
});
