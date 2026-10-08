import { describe, expect, it } from "vitest";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import { PREVIS_BODY_BONES, PREVIS_QUADRUPED_SOURCE_BONES } from "../../shared/manhuaPrevisRig";
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
  it("搀扶必须提交连续全部接触帧，搭肩与扶臂都不能脱开", () => {
    const {spec,report}=fixture();spec.interactions![0].kind="support_walk";
    const base={...report,interactions:[{...report.interactions[0],kind:"support_walk",supportSamples:Array.from({length:24},(_,i)=>({frame:i+25,actualPoint:[0,0,1],targetPoint:[0,0,1],gripPoint:[0,.1,1],shoulderPoint:[0,.1,1]}))}]};
    expect(()=>validatePrevisReport(base,spec)).not.toThrow();
    for(const mutation of ["missing","frame","grip","support"]){
      const bad=structuredClone(base);const rows=bad.interactions[0].supportSamples;
      if(mutation==="missing")rows.pop();if(mutation==="frame")rows[3].frame=29;
      if(mutation==="grip")rows[3].gripPoint[0]=.02;if(mutation==="support")rows[3].actualPoint[0]=.02;
      expect(()=>validatePrevisReport(bad,spec)).toThrow(/搀扶/);
    }
  });
  it("在场窗口须逐帧对齐，离场帧不得冒充出画或在场", () => {
    const f = fixture();
    delete f.spec.interactions;
    f.spec.actors[0].visibleRanges = [{ startSec: 0, endSec: 1 }];
    const { interactions: _, ...report } = f.report;
    const actor = report.actors[0] as { visibleFrames?: number[]; offscreenFrames: number[] };
    actor.visibleFrames = Array.from({ length: 24 }, (_, i) => i + 1);
    expect(validatePrevisReport(report, f.spec)).toEqual(report);
    actor.visibleFrames[23] = 25;
    expect(() => validatePrevisReport(report, f.spec)).toThrow(/在场逐帧/);
    actor.visibleFrames[23] = 24;
    actor.offscreenFrames = [25];
    expect(() => validatePrevisReport(report, f.spec)).toThrow(/离场角色/);
  });
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
const measuredFeet = (frames: number, first=1) => ({footVertices:[3,3],meshMeasured:true,
  samples:Array.from({length:frames},(_,i)=>({frame:i+first,minimumHeight:0,soleHeights:[0,0]}))});
const measuredHand = (frames: number, first=1, startSec=0, endSec=2, height=1.7) => ({
  handVertices:3,meshMeasured:true,anchorKind:"head-relative-estimate",mouthAnatomyValidated:false,
  samples:Array.from({length:frames},(_,i)=>{
    const u=((i+first-1)/24-startSec)/Math.max(1/24,(Math.ceil(endSec*24)-1)/24-startSec);
    const smooth=(v:number)=>{const x=Math.max(0,Math.min(1,v));return x*x*(3-2*x);};
    return {frame:i+first,scale:height/1.7,hold:smooth(u/.22)*(1-smooth((u-.76)/.24)),handTargetGap:0,handWristGap:0,recoveryError:0};
  })});
describe("带骨模型报告与侧载存证", () => {
  it("生产报告消费真实背负回执，缺失时不能拿源人偶背负替代", () => {
    const f=modelFixture();
    const second=f.spec.actors[1];second.assetRef="asset-2";
    second.riggedModel={...f.spec.actors[0].riggedModel!,sourceJobId:"m3d_second"};
    f.spec.piggyback={carrierId:f.spec.actors[0].id,passengerId:second.id};
    f.report.models.push({...structuredClone(f.report.models[0]),actorId:second.id,sourceJobId:"m3d_second",sha256:"b".repeat(64)});
    f.sources.push({...f.sources[0],actorId:second.id,sourceJobId:"m3d_second",sha256:"b".repeat(64)});
    Object.assign(f.report.actors[1],{supportMode:"carried"});
    const report={...f.report,riggedPiggyback:{
      carrier:{actorId:f.sources[0].actorId,sourceJobId:f.sources[0].sourceJobId,sha256:f.sources[0].sha256},
      passenger:{actorId:f.sources[1].actorId,sourceJobId:f.sources[1].sourceJobId,sha256:f.sources[1].sha256},meshMeasured:true,normalSpeedValidated:false,boundaryZh:"仅几何测试",
      samples:Array.from({length:48},(_,i)=>({frame:i+1,supportError:0,gripError:0,carrierSoleHeights:[0,.1],passengerSoleHeights:[.2,.2],maxBoneLengthError:0,blockAmount:0,blockError:0})),
    }};
    expect(()=>validatePrevisReport(report,f.spec,f.sources)).not.toThrow();
    const {riggedPiggyback:_real,...missing}=report;
    expect(()=>validatePrevisReport(missing,f.spec,f.sources)).toThrow("真实背负逐帧报告缺失");
  });

  it("带骨坐卧必须返回同来源的实际支撑与双脚逐帧回执，不接受基础人体报告替代", () => {
    const f = modelFixture();
    f.spec.actors[0].humanPosture = {mode:"hold",posture:"recline",supportHeight:.45,reclineDeg:45};
    f.spec.actors[0].actions=[];
    const model=f.report.models[0];
    const contact = {actorId:f.spec.actors[0].id,sourceJobId:model.sourceJobId,sha256:model.sha256,mode:"hold",frames:48,
      meshValidated:false,normalSpeedValidated:false,
      meshMeasurement:{footVertices:[3,3],meshMeasured:true,samples:Array.from({length:48},(_,i)=>({frame:i+1,minimumHeight:0,soleHeights:[0,0]}))},
      samples:Array.from({length:48},(_,i)=>({frame:i+1,supportGap:0,spineLeanRad:Math.PI/4,maxBoneLengthError:0}))};
    expect(()=>validatePrevisReport(f.report,f.spec,f.sources)).toThrow("真实坐卧");
    Object.assign(model,{postureContact:contact});
    expect(validatePrevisReport(f.report,f.spec,f.sources).models?.[0].postureContact).toEqual(contact);
    for (const patch of [{sha256:"b".repeat(64)},{sourceJobId:"m3d_another"},{actorId:"another"},{frames:47},{mode:"rise_to_sit"},{meshValidated:true}]) {
      Object.assign(model,{postureContact:{...contact,...patch}});
      expect(()=>validatePrevisReport(f.report,f.spec,f.sources)).toThrow();
    }
    const wrong=structuredClone(contact);wrong.samples[24].spineLeanRad=0;
    Object.assign(model,{postureContact:wrong});
    expect(()=>validatePrevisReport(f.report,f.spec,f.sources)).toThrow("真实坐卧姿态");
    Object.assign(model,{postureContact:contact});
    Reflect.deleteProperty(f.spec.actors[0],"humanPosture");
    expect(()=>validatePrevisReport(f.report,f.spec,f.sources)).toThrow("未配置坐卧");
  });

  it("接触脚底测量保留真实逐帧数据，拒绝穿地、悬空、乱序和伪造最低点", () => {
    const f = modelFixture();
    f.spec.actors[0].actions = [{kind:"cough",startSec:.5,endSec:2}];
    const measurement = {footVertices:[3,3],meshMeasured:true,samples:Array.from({length:36},(_,i)=>({frame:i+13,minimumHeight:0,soleHeights:[0,0]}))};
    const contact = {frames:36,meshValidated:false,normalSpeedValidated:false,meshMeasurement:measurement,handMeasurement:measuredHand(36,13,.5,2,f.report.models[0].targetHeight)};
    Object.assign(f.report.models[0],{coughContact:contact});
    expect(validatePrevisReport(f.report,f.spec,f.sources).models?.[0].coughContact?.meshMeasurement).toEqual(measurement);
    for (const patch of [{frame:12},{minimumHeight:-.01},{minimumHeight:.01},{soleHeights:[0,.04]}]) {
      const changed=structuredClone(measurement);
      Object.assign(changed.samples[0],patch);
      Object.assign(f.report.models[0],{coughContact:{...contact,meshMeasurement:changed}});
      expect(()=>validatePrevisReport(f.report,f.spec,f.sources)).toThrow();
    }
    Object.assign(f.report.models[0],{coughContact:{...contact,meshMeasurement:{...measurement,samples:measurement.samples.slice(1)}}});
    expect(()=>validatePrevisReport(f.report,f.spec,f.sources)).toThrow("网格测量");
  });

  it("落脚修正必须匹配实际动作帧窗，超差及虚报网格通过拒收", () => {
    const f = modelFixture();
    Object.assign(f.report.models[0], {sitContact:{frames:48,maxAnkleResidual:.001,meshValidated:false,normalSpeedValidated:false,meshMeasurement:measuredFeet(48)}});
    expect(() => validatePrevisReport(f.report,f.spec,f.sources)).toThrow("动作帧窗");
    f.spec.actors[0].actions = [{kind:"sit",startSec:0,endSec:2}];
    expect(validatePrevisReport(f.report,f.spec,f.sources).models?.[0].sitContact?.frames).toBe(48);
    for (const patch of [{frames:47},{maxAnkleResidual:.006},{meshValidated:true},{normalSpeedValidated:true}]) {
      const original = structuredClone((f.report.models[0] as any).sitContact);
      Object.assign((f.report.models[0] as any).sitContact,patch);
      expect(() => validatePrevisReport(f.report,f.spec,f.sources)).toThrow();
      Object.assign(f.report.models[0],{sitContact:original});
    }
    Reflect.deleteProperty(f.report.models[0],"sitContact");
    expect(() => validatePrevisReport(f.report,f.spec,f.sources)).toThrow("动作帧窗");
  });
  it("掩口手部回执不能虚报保持量、身高公差或收手", () => {
    const f=modelFixture();f.spec.actors[0].actions=[{kind:"cough",startSec:.5,endSec:2}];
    const contact={frames:36,meshValidated:false,normalSpeedValidated:false,meshMeasurement:measuredFeet(36,13),
      handMeasurement:measuredHand(36,13,.5,2,f.report.models[0].targetHeight)};
    Object.assign(f.report.models[0],{coughContact:contact});
    expect(()=>validatePrevisReport(f.report,f.spec,f.sources)).not.toThrow();
    for (const patch of [{hold:1},{scale:10},{handWristGap:1},{recoveryError:1},{frame:14}]) {
      const altered=structuredClone(contact);Object.assign(altered.handMeasurement.samples[0],patch);
      Object.assign(f.report.models[0],{coughContact:altered});
      expect(()=>validatePrevisReport(f.report,f.spec,f.sources)).toThrow("掩口手部");
    }
    const altered=structuredClone(contact);
    altered.handMeasurement.samples.find(row=>row.hold>.99)!.handTargetGap=1;
    Object.assign(f.report.models[0],{coughContact:altered});
    expect(()=>validatePrevisReport(f.report,f.spec,f.sources)).toThrow("掩口手部");
  });

  it("掩口修正仅匹配真实人体掩口窗，缺失或截短不能收作成功", () => {
    const f = modelFixture();
    f.spec.actors[0].actions = [{kind:"cough",startSec:.5,endSec:2}];
    expect(() => validatePrevisReport(f.report,f.spec,f.sources)).toThrow("动作帧窗");
    Object.assign(f.report.models[0],{coughContact:{frames:36,meshValidated:false,normalSpeedValidated:false,meshMeasurement:measuredFeet(36,13),handMeasurement:measuredHand(36,13,.5,2,f.report.models[0].targetHeight)}});
    expect(validatePrevisReport(f.report,f.spec,f.sources).models?.[0].coughContact?.frames).toBe(36);
    Object.assign((f.report.models[0] as any).coughContact,{frames:35});
    expect(() => validatePrevisReport(f.report,f.spec,f.sources)).toThrow("动作帧窗");
  });

  it("四足报告保存真实前后肢映射，缺失或把后腿当前腿时拒收", () => {
    const f = modelFixture();
    f.spec.actors[0].shape = "horse";
    f.spec.actors[0].riggedModel!.rigKind = "quadruped";
    const report = structuredClone(f.report);
    Object.assign(report.models[0], { sourceBoneMap: { ...PREVIS_QUADRUPED_SOURCE_BONES } });
    expect(validatePrevisReport(report, f.spec, f.sources).models?.[0].sourceBoneMap).toEqual(PREVIS_QUADRUPED_SOURCE_BONES);
    Reflect.deleteProperty(report.models[0], "sourceBoneMap");
    expect(() => validatePrevisReport(report, f.spec, f.sources)).toThrow("驱动映射");
    Object.assign(report.models[0], { sourceBoneMap: { ...PREVIS_QUADRUPED_SOURCE_BONES, forearm1: "lower_leg2" } });
    expect(() => validatePrevisReport(report, f.spec, f.sources)).toThrow("驱动映射");
  });
  it("人体新版驱动回执仍接受自身骨序，旧报告无新增字段仍兼容", () => {
    const f = modelFixture();
    expect(validatePrevisReport(f.report, f.spec, f.sources).models).toHaveLength(1);
    Object.assign(f.report.models[0], { sourceBoneMap: Object.fromEntries(PREVIS_BODY_BONES.map(name => [name, name])) });
    expect(validatePrevisReport(f.report, f.spec, f.sources).models).toHaveLength(1);
  });
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
