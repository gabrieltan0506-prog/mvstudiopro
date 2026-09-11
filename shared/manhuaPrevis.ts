/** 动作白模配置：只有数据，没有用户 Python／命令／任意素材 URL。 */
import { z } from "zod";

const point = z.tuple([
  z.number().finite().min(-12).max(12),
  z.number().finite().min(-12).max(12),
]);
export const PREVIS_ACTION_LABELS = {
  idle: "待机",
  strike: "蓄力出手",
  guard: "抬臂保护",
  recoil: "受惊后缩",
} as const;
export const previsActorSchema = z
  .object({
    id: z.string().min(1).max(100),
    nameZh: z.string().trim().min(1).max(80),
    /** 仅标明对应的项目角色；不声称为无骨骼 GLB 自动蒙皮。 */
    assetRef: z.string().max(160).optional(),
    shape: z.enum(["human", "horse"]),
    start: point,
    end: point,
    moveStartSec: z.number().finite().min(0).max(30),
    moveEndSec: z.number().finite().positive().max(30),
    facingDeg: z.number().finite().min(-180).max(180),
    actions: z
      .array(
        z
          .object({
            kind: z.enum(["idle", "strike", "guard", "recoil"]),
            startSec: z.number().finite().min(0).max(30),
            endSec: z.number().finite().positive().max(30),
          })
          .strict()
      )
      .max(12),
  })
  .strict();
const cameraPoint = z.tuple([
  z.number().finite().min(-30).max(30),
  z.number().finite().min(-30).max(30),
  z.number().finite().min(0.2).max(15),
]);
const manhuaPrevisSpecBaseSchema = z
  .object({
    version: z.literal(1),
    durationSec: z.number().int().min(2).max(30),
    aspect: z.enum(["16:9", "9:16"]),
    actors: z.array(previsActorSchema).min(1).max(6),
    cameras: z
      .array(
        z
          .object({
            startSec: z.number().finite().min(0).max(30),
            endSec: z.number().finite().positive().max(30),
            position: cameraPoint,
            target: cameraPoint,
            lens: z.number().int().min(18).max(65),
          })
          .strict()
      )
      .min(1)
      .max(8),
  })
  .strict();
// 草稿允许编辑中的空名称、零值或暂未闭合的时间轴；提交仍使用下方完整生产门禁。
// 否则用户清空输入框的那一步就会导致本机规范化/云备份抛错。
const draftNumber = z.number().finite().min(-10000).max(10000);
const draftPoint = z.tuple([draftNumber, draftNumber]);
const draftCameraPoint = z.tuple([draftNumber, draftNumber, draftNumber]);
export const manhuaPrevisDraftSchema = manhuaPrevisSpecBaseSchema.extend({
  durationSec: draftNumber,
  actors: z
    .array(
      previsActorSchema.extend({
        nameZh: z.string().max(80),
        start: draftPoint,
        end: draftPoint,
        moveStartSec: draftNumber,
        moveEndSec: draftNumber,
        facingDeg: draftNumber,
        actions: z
          .array(
            z
              .object({
                kind: z.enum(["idle", "strike", "guard", "recoil"]),
                startSec: draftNumber,
                endSec: draftNumber,
              })
              .strict()
          )
          .max(12),
      })
    )
    .max(6),
  cameras: z
    .array(
      z
        .object({
          startSec: draftNumber,
          endSec: draftNumber,
          position: draftCameraPoint,
          target: draftCameraPoint,
          lens: draftNumber,
        })
        .strict()
    )
    .max(8),
});
export const manhuaPrevisSpecSchema = manhuaPrevisSpecBaseSchema.superRefine(
  (spec, ctx) => {
    if (new Set(spec.actors.map(a => a.id)).size !== spec.actors.length)
      ctx.addIssue({ code: "custom", message: "角色编号不能重复" });
    spec.actors.forEach((actor, i) => {
      if (
        actor.moveEndSec > spec.durationSec ||
        actor.moveStartSec >= actor.moveEndSec
      )
        ctx.addIssue({
          code: "custom",
          message: "移动区间须在片长内且结束晚于开始",
          path: ["actors", i],
        });
      // 动作库只承诺人体关节；非人角色先提供站位和可见步态，不错误套人类动作。
      if (actor.shape === "horse" && actor.actions.some(a => a.kind !== "idle"))
        ctx.addIssue({
          code: "custom",
          message: "四足角色暂只支持站位与行走",
          path: ["actors", i, "actions"],
        });
      actor.actions.forEach((action, j) => {
        if (
          action.endSec > spec.durationSec ||
          action.endSec - action.startSec < 0.5
        )
          ctx.addIssue({
            code: "custom",
            message: "动作须在片长内且至少半秒",
            path: ["actors", i, "actions", j],
          });
        if (j && action.startSec < actor.actions[j - 1].endSec)
          ctx.addIssue({
            code: "custom",
            message: "同一角色动作按时间排列且不能重叠",
            path: ["actors", i, "actions", j],
          });
      });
      const distance = Math.hypot(
        actor.end[0] - actor.start[0],
        actor.end[1] - actor.start[1]
      );
      if (distance / (actor.moveEndSec - actor.moveStartSec) > 1.2)
        ctx.addIssue({
          code: "custom",
          message: "白模行走速度过快，请延长移动时间或缩短路线",
          path: ["actors", i],
        });
    });
    spec.cameras.forEach((camera, i) => {
      if (Math.round(camera.endSec * 24) <= Math.round(camera.startSec * 24))
        ctx.addIssue({
          code: "custom",
          message: "每个机位至少需要一个实际视频帧，请延长镜头区间",
          path: ["cameras", i],
        });
      const expected = i === 0 ? 0 : spec.cameras[i - 1].endSec;
      if (
        Math.abs(camera.startSec - expected) > 1e-6 ||
        camera.endSec <= camera.startSec ||
        camera.endSec > spec.durationSec
      )
        ctx.addIssue({
          code: "custom",
          message: "机位时间段须连续覆盖全片",
          path: ["cameras", i],
        });
      if (
        Math.hypot(...camera.position.map((n, j) => n - camera.target[j])) < 0.5
      )
        ctx.addIssue({
          code: "custom",
          message: "机位与目标不能重合",
          path: ["cameras", i],
        });
    });
    if (spec.cameras.at(-1)?.endSec !== spec.durationSec)
      ctx.addIssue({
        code: "custom",
        message: "最后机位须覆盖到片尾",
        path: ["cameras"],
      });
  }
);
export type ManhuaPrevisSpec = z.infer<typeof manhuaPrevisSpecSchema>;
export const manhuaPrevisRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    scopeId: z.string().uuid(),
    clipId: z.string().min(1).max(160),
    spec: manhuaPrevisSpecSchema,
  })
  .strict();
export type ManhuaPrevisRequest = z.infer<typeof manhuaPrevisRequestSchema>;

export const manhuaPrevisStudioSchema = z
  .object({
    version: z.literal(1),
    scopeId: z.string().uuid(),
    spec: manhuaPrevisDraftSchema,
    /** 请求先落草稿再提交；断网刷新只查询同编号，不自动下新任务。 */
    pending: manhuaPrevisRequestSchema.optional(),
    selectedJobId: z.string().max(100).optional(),
    referenceHistory: z.array(
      z
        .object({
          url: z.string(),
          gcsUri: z.string().optional(),
          fileName: z.string().optional(),
          durationSec: z.number().optional(),
          updatedAt: z.string(),
          motionGuideZh: z.string().optional(),
        })
        .strict()
    ),
    history: z.array(
      z
        .object({
          jobId: z.string().max(100),
          requestId: z.string().uuid(),
          gcsUri: z.string().max(2048),
          url: z.string().max(8192),
          durationSec: z.number().positive().max(30),
          createdAt: z.string().max(100),
          spec: manhuaPrevisSpecSchema,
        })
        .strict()
    ),
  })
  .strict();
export type ManhuaPrevisStudio = z.infer<typeof manhuaPrevisStudioSchema>;

export function createManhuaPrevisStudio(
  durationSec = 10,
  scopeId = crypto.randomUUID()
): ManhuaPrevisStudio {
  const duration = Math.max(2, Math.min(30, Math.round(durationSec)));
  return {
    version: 1,
    scopeId,
    history: [],
    referenceHistory: [],
    spec: {
      version: 1,
      durationSec: duration,
      aspect: "16:9",
      actors: [
        {
          id: "actor-1",
          nameZh: "角色 1",
          shape: "human",
          start: [-1, 0],
          end: [-1, 0],
          moveStartSec: 0,
          moveEndSec: duration,
          facingDeg: 0,
          actions: [],
        },
      ],
      cameras: [
        {
          startSec: 0,
          endSec: duration,
          position: [0, -8, 3],
          target: [0, 0, 1],
          lens: 35,
        },
      ],
    },
  };
}

/** 配置改动不清历史；生成与采用分离，旧稿没有此字段时不改变既有行为。 */
export function previsSpecKey(spec: ManhuaPrevisSpec): string {
  return JSON.stringify(spec);
}

export function formatPrevisMotionGuide(spec: ManhuaPrevisSpec): string {
  return [
    "参考中的关节姿态、落脚、蓄力—出手—回收及保护反应按对应秒位读取；不继承白模外形。",
    ...spec.actors.map(
      (a, index) =>
        `白模角色${index + 1}对应${a.nameZh}${a.assetRef ? `（${a.assetRef}）` : ""}：${a.actions.length ? a.actions.map(x => `${x.startSec}—${x.endSec}秒${PREVIS_ACTION_LABELS[x.kind]}`).join("；") : "按参考站位和步态"}。`
    ),
  ].join("\n");
}
