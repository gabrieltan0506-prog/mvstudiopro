/** 动作白模配置：只有数据，没有用户 Python／命令／任意素材 URL。 */
import { z } from "zod";
import { previsRiggedModelSchema } from "./manhuaPrevisRig";

const point = z.tuple([
  z.number().finite().min(-12).max(12),
  z.number().finite().min(-12).max(12),
]);
export const previsInteractionSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum(["strike_recoil", "strike_guard"]),
    actorId: z.string().min(1).max(100),
    targetActorId: z.string().min(1).max(100),
    startSec: z.number().finite().min(0).max(30),
    contactSec: z.number().finite().min(0).max(30),
    endSec: z.number().finite().positive().max(30),
  })
  .strict();
export type PrevisInteraction = z.infer<typeof previsInteractionSchema>;
export const previsCreatureSchema = z
  .object({
    preset: z.literal("four_tail_black_wings"),
    transformStartSec: z.number().finite().min(0).max(30),
    transformEndSec: z.number().finite().positive().max(30),
  })
  .strict();
export const previsScriptSourceSchema = z
  .object({
    compilerVersion: z.literal(1),
    shots: z
      .array(
        z
          .object({
            index: z.number().int().positive(),
            durationSec: z.number().finite().positive(),
            actionZh: z.string().max(20000),
          })
          .strict()
      )
      .min(1)
      .max(120),
    unmappedShotIndices: z.array(z.number().int().positive()).max(120),
  })
  .strict();
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
    creature: previsCreatureSchema.optional(),
    riggedModel: previsRiggedModelSchema.optional(),
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
    interactions: z.array(previsInteractionSchema).max(24).optional(),
    scriptSource: previsScriptSourceSchema.optional(),
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
  interactions: z
    .array(
      previsInteractionSchema.extend({
        startSec: draftNumber,
        contactSec: draftNumber,
        endSec: draftNumber,
      })
    )
    .max(24)
    .optional(),
  actors: z
    .array(
      previsActorSchema.extend({
        nameZh: z.string().max(80),
        start: draftPoint,
        end: draftPoint,
        moveStartSec: draftNumber,
        moveEndSec: draftNumber,
        facingDeg: draftNumber,
        creature: previsCreatureSchema
          .extend({
            transformStartSec: draftNumber,
            transformEndSec: draftNumber,
          })
          .optional(),
        riggedModel: previsRiggedModelSchema
          .extend({ targetHeight: draftNumber })
          .optional(),
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
/**
 * 单作业渲染预算（0911 实测定的能力边界，不是拍脑袋的数字）。
 *
 * 成本近似为「帧数 × 角色数」：白模用 Blender WORKBENCH 逐帧出 PNG，
 * 每帧代价随场景里的角色数近似线性增长。
 *
 * 实测锚点（隔离机 2 核 8GB、Blender 3.4.1，与生产同源）：
 * · 六角色 30 秒 = 720 帧 × 6 = 4320 单位 → 构建 75 秒、渲染 506 秒后触发 600 秒生产时限，
 *   没有产出完整视频（验收判失败，见五项验收-0911/Linux高负载与扣退费验收报告）。
 * · 单角色 5 秒 = 120 帧 × 1 = 120 单位 → 含 13 个云对象上传读回共 190 秒，完整交付。
 *
 * 按 4320 单位耗时 506 秒折算约 0.117 秒/单位；600 秒预算里要留出场景构建与编码上传，
 * 渲染可用约 420 秒，即约 3600 单位。再留 25% 余量定 2700。
 *
 * 这条边界是**事前拒绝**，不是把超时调长冒充性能达标：超出就当场说清楚，
 * 不让用户等满十分钟再拿到一个空结果。性能改进后按新实测调这个数字。
 */
export const PREVIS_RENDER_UNIT_BUDGET = 2700;

/** 该 spec 的渲染成本单位：帧数 × 角色数 */
export function previsRenderCostUnits(spec: {
  durationSec: number;
  actors: unknown[];
}): number {
  return Math.round(spec.durationSec * 24 * spec.actors.length);
}

/** 同角色数下、预算内允许的最长片长（秒），至少 2 秒 */
export function previsMaxDurationSec(
  actorCount: number,
  budget = PREVIS_RENDER_UNIT_BUDGET
): number {
  const count = Math.max(1, Math.floor(actorCount));
  return Math.max(2, Math.floor(budget / (24 * count)));
}

/** 超预算时给一句能照做的中文；在预算内返回 null */
export function previsCapacityIssueZh(
  spec: { durationSec: number; actors: unknown[] },
  budget = PREVIS_RENDER_UNIT_BUDGET
): string | null {
  const units = previsRenderCostUnits(spec);
  if (units <= budget) return null;
  const actorCount = spec.actors.length;
  const maxSec = previsMaxDurationSec(actorCount, budget);
  const maxActors = Math.max(1, Math.floor(budget / (24 * spec.durationSec)));
  return (
    `超出单次白模渲染能力：${actorCount} 个角色 × ${spec.durationSec} 秒，` +
    `约 ${units} 单位，上限 ${budget} 单位。` +
    `同样 ${actorCount} 个角色最多 ${maxSec} 秒；` +
    (maxActors >= 1
      ? `${spec.durationSec} 秒最多 ${maxActors} 个角色。`
      : "请缩短片长。") +
    "请拆成多段分别预演。"
  );
}

export const manhuaPrevisSpecSchema = manhuaPrevisSpecBaseSchema.superRefine(
  (spec, ctx) => {
    // 能力边界先判：超预算的作业会在 600 秒生产时限里烧满十分钟还交不出视频（0911 实测）
    const capacityIssue = previsCapacityIssueZh(spec);
    if (capacityIssue) ctx.addIssue({ code: "custom", message: capacityIssue });
    if (new Set(spec.actors.map(a => a.id)).size !== spec.actors.length)
      ctx.addIssue({ code: "custom", message: "角色编号不能重复" });
    spec.actors.forEach((actor, i) => {
      if (
        actor.creature &&
        (actor.shape !== "horse" ||
          actor.creature.transformEndSec > (spec.durationSec * 24 - 1) / 24 ||
          actor.creature.transformEndSec - actor.creature.transformStartSec <
            0.5)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "四尾黑翼显形只用于四足角色，区间须在片长内且至少半秒",
          path: ["actors", i, "creature"],
        });
      }
      if (actor.riggedModel && (actor.shape !== "human" || !actor.assetRef))
        ctx.addIssue({
          code: "custom",
          message: "带骨角色须绑定项目人物并使用人体动作",
          path: ["actors", i, "riggedModel"],
        });
      const cues = actor.riggedModel?.performance?.cues ?? [];
      cues.forEach((cue, j) => {
        if (
          cue.endSec > spec.durationSec ||
          cue.endSec - cue.startSec < 0.5 ||
          (j > 0 && cue.startSec < cues[j - 1].endSec)
        )
          ctx.addIssue({
            code: "custom",
            message: "表演须在片长内、每段至少半秒且顺序不重叠",
            path: ["actors", i, "riggedModel", "performance", "cues", j],
          });
      });
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
    const interactions = spec.interactions ?? [];
    if (
      new Set(interactions.map(event => event.id)).size !== interactions.length
    )
      ctx.addIssue({
        code: "custom",
        message: "双人事件编号不能重复",
        path: ["interactions"],
      });
    interactions.forEach((event, index) => {
      const path = ["interactions", index];
      const actor = spec.actors.find(a => a.id === event.actorId);
      const target = spec.actors.find(a => a.id === event.targetActorId);
      if (
        !actor ||
        !target ||
        actor === target ||
        actor.shape !== "human" ||
        target.shape !== "human"
      )
        ctx.addIssue({
          code: "custom",
          message: "双人互动必须绑定两个不同的现有人体角色",
          path,
        });
      if (actor?.riggedModel || target?.riggedModel)
        ctx.addIssue({
          code: "custom",
          message:
            "当前角色重定向尚未校正双人接触，不能用白模接触结果代替角色验收",
          path,
        });
      // 接触点在实际视频帧上；片尾duration秒对应下一帧，不能作为命中帧。
      if (
        event.endSec > spec.durationSec ||
        event.contactSec >= spec.durationSec ||
        event.contactSec - event.startSec < 0.25 ||
        event.endSec - event.contactSec < 0.25 ||
        [event.startSec, event.contactSec, event.endSec].some(
          t => Math.abs(t * 24 - Math.round(t * 24)) > 1e-6
        )
      )
        ctx.addIssue({
          code: "custom",
          message:
            "互动秒位须对齐24帧，接触前后各留至少四分之一秒且覆盖在片长内",
          path,
        });
      for (const participant of [actor, target]) {
        if (
          participant?.actions.some(
            action =>
              action.startSec < event.endSec && action.endSec > event.startSec
          )
        )
          ctx.addIssue({
            code: "custom",
            message: "双人事件期间不能叠加该角色的独立动作",
            path,
          });
      }
      if (
        interactions
          .slice(0, index)
          .some(
            previous =>
              [previous.actorId, previous.targetActorId].some(
                id => id === event.actorId || id === event.targetActorId
              ) &&
              previous.startSec < event.endSec &&
              previous.endSec > event.startSec
          )
      )
        ctx.addIssue({
          code: "custom",
          message: "同一角色的双人互动时间不能重叠",
          path,
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
    specHistory: z
      .array(
        z
          .object({
            spec: manhuaPrevisDraftSchema,
            createdAt: z.string(),
            reasonZh: z.string(),
          })
          .strict()
      )
      .optional(),
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
    ...(spec.interactions ?? []).map(event => {
      const actor = spec.actors.find(a => a.id === event.actorId)!;
      const target = spec.actors.find(a => a.id === event.targetActorId)!;
      return `${event.startSec}—${event.endSec}秒，${actor.nameZh}向${target.nameZh}出手，${event.contactSec}秒${event.kind === "strike_guard" ? "双手接触格挡" : "触及胸前后受方后缩"}；双方按同一事件时序，不拆成无关动作。`;
    }),
    ...spec.actors
      .filter(actor => actor.creature)
      .map(
        actor =>
          `${actor.nameZh}在${actor.creature!.transformStartSec}—${actor.creature!.transformEndSec}秒由同一四足身体显现四条尾与一对黑翼；保持角色身份，尾翼按参考展开。`
      ),
    ...spec.actors
      .filter(actor => actor.riggedModel)
      .flatMap(actor => [
        `${actor.nameZh}（${actor.assetRef}）使用本人角色模型${actor.riggedModel!.sourceJobId}提供身体姿态；角色身份仍以项目绑定人物为准，不继承测试网格或改变服装。模型接地和双人接触不能按源白模误差推定通过。`,
        ...(actor.riggedModel!.performance?.cues ?? []).map(
          cue =>
            `${actor.nameZh}在${cue.startSec}—${cue.endSec}秒：视线朝参考世界目标（${cue.gazeTarget.join("，")}）；头部左右${cue.headYawDeg}度、俯仰${cue.headPitchDeg}度，按参考方向读取；呼吸幅度${cue.breathAmplitude}、每秒${cue.breathHz}周期；${({ calm: "平静", tense: "紧张", surprised: "惊讶" } as const)[cue.expression]}表情强度${cue.intensity}。仅跟随参考中实际可见变化，不凭参数额外夸张表情。`
        ),
      ]),
  ].join("\n");
}
