/** 渲染与恢复共用的真实报告门禁，不能以存证哈希代替动作验收。 */
import { z } from "zod";
import {
  previsCreatureSchema,
  type ManhuaPrevisRequest,
} from "../../shared/manhuaPrevis";
import { PREVIS_BODY_BONES } from "../../shared/manhuaPrevisRig";

const point = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const previsReportSchema = z
  .object({
    frames: z.number().int().min(48).max(720),
    fps: z.literal(24),
    actors: z
      .array(
        z
          .object({
            id: z.string().min(1),
            nameZh: z.string().min(1),
            bones: z.number().int().min(12),
            contactError: z.number().finite().nonnegative().max(0.005),
            stanceDrift: z.number().finite().nonnegative().max(0.005),
            offscreenFrames: z.array(z.number().int().min(1).max(720)).max(720),
          })
          .passthrough()
      )
      .min(1)
      .max(6),
    warnings: z.array(z.string()),
    portraitFraming: z.enum(["tight", "auto", "landscape"]).optional(),
    models: z
      .array(
        z
          .object({
            actorId: z.string().min(1),
            sourceJobId: z.string().regex(/^m3d_[a-zA-Z0-9_.-]{1,150}$/),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z
              .number()
              .int()
              .min(20)
              .max(64 * 1024 * 1024),
            vertices: z.number().int().min(1).max(250000),
            meshVertices: z.number().int().min(1).max(250000),
            accessorComponents: z.number().int().min(1).max(8000000),
            instanceComponents: z.number().int().min(1).max(8000000),
            instanceIndices: z.number().int().min(1).max(1500000),
            imagePixels: z.number().int().min(0).max(33554432),
            meshes: z.number().int().min(1).max(64),
            jointNames: z.array(z.string()).min(16).max(256),
            morphNames: z.array(z.string()).max(4096),
            mappedBones: z.literal(16),
            boneMap: z.record(
              z.enum(PREVIS_BODY_BONES),
              z.string().min(1).max(128)
            ),
            forwardAxis: z.enum(["+X", "-X", "+Y", "-Y"]),
            targetHeight: z.number().finite().min(0.5).max(3),
            weightedVertices: z.number().int().min(1).max(250000),
            retargetFrames: z.number().int().min(48).max(720),
            retargetMode: z.literal(
              "rest-corrected-rotation-preserve-target-lengths"
            ),
            contactValidated: z.literal(false),
            boundaryZh: z.string().min(1),
            offscreenFrames: z.array(z.number().int().min(1).max(720)).max(720),
            performance: z
              .object({
                frames: z.number().int().min(48).max(720),
                eyeBones: z.tuple([z.string().min(1), z.string().min(1)]),
                expressions: z.tuple([
                  z.literal("calm"),
                  z.literal("tense"),
                  z.literal("surprised"),
                ]),
                cueCount: z.number().int().min(1).max(24),
                qualityAccepted: z.literal(false),
              })
              .strict()
              .optional(),
          })
          .strict()
      )
      .max(6)
      .optional(),
    creatures: z
      .array(
        z
          .object({
            ownerId: z.string().min(1),
            preset: z.literal("four_tail_black_wings"),
            tailCount: z.literal(4),
            wingCount: z.literal(2),
            tailBones: z.literal(12),
            wingBones: z.literal(6),
            meshObjects: z.literal(36),
            transform: previsCreatureSchema,
            stages: z
              .array(
                z
                  .object({
                    frame: z.number().int().min(1).max(720),
                    timeSec: z.number().finite().nonnegative(),
                    progress: z.number().finite().min(0).max(1),
                    visibleFraction: z.number().finite().min(0).max(1),
                  })
                  .strict()
              )
              .min(48)
              .max(720),
            offscreenFrames: z.array(z.number().int().min(1).max(720)).max(720),
            boundaryZh: z.string().min(1),
          })
          .strict()
      )
      .max(6)
      .optional(),
    interactions: z
      .array(
        z
          .object({
            id: z.string().min(1),
            kind: z.enum(["strike_recoil", "strike_guard"]),
            actorId: z.string().min(1),
            targetActorId: z.string().min(1),
            contactFrame: z.number().int().min(1).max(720),
            contactError: z.number().finite().nonnegative().max(0.005),
            actualPoint: point,
            targetPoint: point,
          })
          .strict()
      )
      .max(24)
      .optional(),
  })
  .passthrough();

export type PrevisRenderReport = z.infer<typeof previsReportSchema>;

export function validatePrevisReport(
  raw: unknown,
  spec: ManhuaPrevisRequest["spec"],
  modelManifests?: Array<{
    actorId: string;
    sha256: string;
    sourceJobId: string;
    bytes: number;
  }>
): PrevisRenderReport {
  const report = previsReportSchema.parse(raw);
  if (
    report.frames !== spec.durationSec * 24 ||
    report.actors.length !== spec.actors.length
  )
    throw new Error("白模帧数或角色数量不一致");
  report.actors.forEach((actor, index) => {
    if (
      actor.id !== spec.actors[index].id ||
      actor.nameZh !== spec.actors[index].nameZh ||
      actor.offscreenFrames.some(frame => frame > report.frames)
    )
      throw new Error("白模关节检查未通过");
  });
  const expectedCreatures = spec.actors.filter(actor => actor.creature);
  const expectedModels = spec.actors.filter(actor => actor.riggedModel);
  const models = report.models ?? [];
  if (
    models.length !== expectedModels.length ||
    new Set(models.map(model => model.actorId)).size !== models.length ||
    (modelManifests &&
      (modelManifests.length !== models.length ||
        new Set(modelManifests.map(model => model.actorId)).size !==
          models.length))
  )
    throw new Error("带骨角色报告缺失或重复");
  for (const actor of expectedModels) {
    const model = models.find(value => value.actorId === actor.id),
      config = actor.riggedModel!;
    if (
      !model ||
      actor.shape !== "human" ||
      model.sourceJobId !== config.sourceJobId ||
      model.forwardAxis !== config.forwardAxis ||
      model.targetHeight !== config.targetHeight ||
      model.retargetFrames !== report.frames ||
      model.offscreenFrames.some(frame => frame > report.frames) ||
      new Set(model.offscreenFrames).size !== model.offscreenFrames.length
    )
      throw new Error("带骨角色报告与配置不一致");
    const mapped = Object.values(model.boneMap);
    if (
      new Set(mapped).size !== PREVIS_BODY_BONES.length ||
      mapped.some(name => !model.jointNames.includes(name)) ||
      Object.entries(config.boneMap ?? {}).some(
        ([semantic, name]) =>
          model.boneMap[semantic as (typeof PREVIS_BODY_BONES)[number]] !== name
      )
    )
      throw new Error("带骨角色实际骨骼映射与来源或配置不一致");
    if (modelManifests) {
      const source = modelManifests.find(value => value.actorId === actor.id);
      if (
        !source ||
        source.sha256 !== model.sha256 ||
        source.bytes !== model.bytes ||
        source.sourceJobId !== model.sourceJobId
      )
        throw new Error("带骨角色报告与下载存证不一致");
    }
    if (config.performance) {
      const performance = model.performance;
      const eyes = config.performance.controller.eyeBones;
      if (
        !performance ||
        performance.frames !== report.frames ||
        performance.cueCount !== config.performance.cues.length ||
        performance.eyeBones[0] !== eyes.left ||
        performance.eyeBones[1] !== eyes.right
      )
        throw new Error("角色表演报告缺失或与配置不一致");
    } else if (model.performance) throw new Error("角色报告含未配置表演");
  }
  const creatures = report.creatures ?? [];
  if (
    creatures.length !== expectedCreatures.length ||
    new Set(creatures.map(creature => creature.ownerId)).size !==
      creatures.length
  )
    throw new Error("白模尾翼报告缺失或重复");
  for (const actor of expectedCreatures) {
    const creature = creatures.find(value => value.ownerId === actor.id);
    const config = actor.creature!;
    if (
      !creature ||
      actor.shape !== "horse" ||
      creature.transform.preset !== config.preset ||
      creature.transform.transformStartSec !== config.transformStartSec ||
      creature.transform.transformEndSec !== config.transformEndSec ||
      creature.stages.length !== report.frames ||
      creature.offscreenFrames.some(frame => frame > report.frames) ||
      new Set(creature.offscreenFrames).size !== creature.offscreenFrames.length
    )
      throw new Error("白模尾翼报告与配置不一致");
    creature.stages.forEach((stage, index) => {
      const time = index / 24;
      const phase = Math.max(
        0,
        Math.min(
          1,
          (time - config.transformStartSec) /
            (config.transformEndSec - config.transformStartSec)
        )
      );
      const progress = phase * phase * (3 - 2 * phase);
      if (
        stage.frame !== index + 1 ||
        Math.abs(stage.timeSec - time) > 1e-7 ||
        Math.abs(stage.progress - progress) > 1e-7 ||
        stage.visibleFraction !== (progress > 0 ? 1 : 0)
      )
        throw new Error("白模尾翼逐帧展开报告不一致");
    });
    if (creature.stages.at(-1)?.progress !== 1)
      throw new Error("白模尾翼未完整展开");
  }
  const expected = spec.interactions ?? [];
  const measured = report.interactions ?? [];
  if (
    expected.length !== measured.length ||
    new Set(measured.map(event => event.id)).size !== measured.length
  )
    throw new Error("白模双人交互报告缺失或重复");
  for (const event of expected) {
    const actual = measured.find(value => value.id === event.id);
    if (
      !actual ||
      actual.kind !== event.kind ||
      actual.actorId !== event.actorId ||
      actual.targetActorId !== event.targetActorId ||
      actual.contactFrame !== Math.floor(event.contactSec * 24 + 0.5) + 1 ||
      actual.contactFrame > report.frames
    )
      throw new Error("白模双人交互报告与动作不一致");
    const distance = Math.hypot(
      ...actual.actualPoint.map(
        (value, index) => value - actual.targetPoint[index]
      )
    );
    if (
      !Number.isFinite(distance) ||
      distance > 0.005 ||
      Math.abs(distance - actual.contactError) > 1e-7
    )
      throw new Error("白模双人交互接触检查未通过");
  }
  return report;
}
