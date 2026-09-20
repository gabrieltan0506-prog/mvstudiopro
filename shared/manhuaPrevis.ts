/** 动作白模配置：只有数据，没有用户 Python／命令／任意素材 URL。 */
import { z } from "zod";
import { manhuaShotTimeMapSchema, validateManhuaShotTimeMap } from "./manhuaActionPlanTiming";
import { previsPlaybackDuration, previsPresentationGuideSpec } from "./manhuaPrevisPlayback";
import {
  previsEffectsSchema,
  previsEffectsDraftSchema,
  validatePrevisEffects,
} from "./manhuaPrevisEffects";
import { previsRiggedModelSchema } from "./manhuaPrevisRig";

const point = z.tuple([
  z.number().finite().min(-12).max(12),
  z.number().finite().min(-12).max(12),
]);
export const previsInteractionSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum(["strike_recoil", "strike_guard", "sword_guard"]),
    actorId: z.string().min(1).max(100),
    targetActorId: z.string().min(1).max(100),
    startSec: z.number().finite().min(0).max(30),
    contactSec: z.number().finite().min(0).max(30),
    endSec: z.number().finite().positive().max(30),
  })
  .strict();
export type PrevisInteraction = z.infer<typeof previsInteractionSchema>;
/** 出水预演使用独立几何浪，不承诺物理流体效果。 */
export const previsWaterEventSchema = z
  .object({
    actorId: z.string().min(1).max(100),
    crossSec: z.number().finite().min(0.5).max(30),
    riseSec: z.number().finite().min(0.5).max(3),
    height: z.number().finite().min(0.5).max(5),
    waveRadius: z.number().finite().min(0.4).max(2.5),
    waveHeight: z.number().finite().min(0.3).max(3),
    waveDurationSec: z.number().finite().min(0.5).max(4),
  })
  .strict();
export const previsWaterEmergenceSchema = z
  .object({
    mode: z.enum(["simultaneous", "staggered"]),
    events: z.array(previsWaterEventSchema).min(1).max(3),
  })
  .strict();
export type PrevisWaterEmergence = z.infer<typeof previsWaterEmergenceSchema>;
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
  // 0917 PR-E：文戏六类。打戏之外的段落此前只能站着，绑骨的价值兑现不出来。
  walk: "走位（摆臂步态）",
  turn: "转身到指定朝向",
  look: "看向目标",
  sit: "坐下",
  gesture_point: "抬手指向",
  bow: "俯身行礼",
} as const;
/** 需要额外参数的动作：转身要目标朝向，看向要目标。 */
export const PREVIS_ACTION_KINDS = [
  "idle",
  "strike",
  "guard",
  "recoil",
  "walk",
  "turn",
  "look",
  "sit",
  "gesture_point",
  "bow",
] as const;
export type PrevisActionKind = (typeof PREVIS_ACTION_KINDS)[number];
/** 打戏四类：四足角色与持剑白模只许这几类，扩库不放宽旧门禁。 */
export const PREVIS_COMBAT_ACTION_KINDS = ["idle", "strike", "guard", "recoil"] as const;
export const PREVIS_LOOK_AT_CAMERA = "camera" as const;
/** 归一到 (-180, 180]：转身 180 度显示成 180，不是 -180。朝向的唯一归一入口。 */
export function normalizeFacingDeg(deg: number): number {
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}
/**
 * 0917 PR-E：换动作类型时把只属于旧类型的参数丢掉、把新类型必需的参数补上。
 * 不这么做会留下「转身没有目标朝向」或「出拳还挂着注视目标」这种提交必被 schema 拒的脏配置。
 */
export function previsActionForKind<T extends { kind: string; facingDeg?: number; lookAtId?: string }>(
  action: T,
  kind: PrevisActionKind,
  context: { actorFacingDeg: number; otherActorIds: readonly string[] },
): T {
  const next = { ...action, kind } as T;
  delete (next as { facingDeg?: number }).facingDeg;
  delete (next as { lookAtId?: string }).lookAtId;
  // 默认转向背面；归一走 normalizeFacingDeg 这一个入口，不再各处手写取模
  if (kind === "turn")
    (next as { facingDeg?: number }).facingDeg = normalizeFacingDeg(context.actorFacingDeg + 180);
  if (kind === "look")
    (next as { lookAtId?: string }).lookAtId = context.otherActorIds[0] ?? PREVIS_LOOK_AT_CAMERA;
  return next;
}

/**
 * 「这个角色在 [startSec, endSec) 里是不是真的在走」——走位判据的唯一实现。
 * 0917 二轮审查：这条判据原先写了两遍（schema 里一遍、草案编译里一遍），而且两遍都只认
 * 起止站位；有 motionRoute 的角色在 schema 里被整条跳过，于是一条原地不动的轨迹照样能挂上
 * walk，白模还是原地摆臂——PR 想堵的洞从另一扇门又开了。收口成一个函数，两处都引用。
 */
export function previsActorTravelsDuring(
  actor: {
    start: readonly number[];
    end: readonly number[];
    moveStartSec: number;
    moveEndSec: number;
    motionRoute?: readonly { timeSec: number; position: readonly number[] }[] | null;
  },
  startSec: number,
  endSec: number,
): boolean {
  const route = actor.motionRoute;
  if (route?.length)
    // 轨迹角色：动作窗口里至少要跨过一段位置真的变了的节点区间
    return route.some(
      (node, k) =>
        k > 0 &&
        node.position.some((v, m) => v !== route[k - 1].position[m]) &&
        startSec < node.timeSec &&
        endSec > route[k - 1].timeSec,
    );
  // 站位角色：起止站位不同，且动作窗口与位移区间有交集
  return (
    actor.start.some((v, k) => v !== actor.end[k]) &&
    startSec < actor.moveEndSec &&
    endSec > actor.moveStartSec
  );
}

export const previsMotionRouteNodeSchema = z
  .object({
    timeSec: z.number().finite().min(0).max(30),
    position: point,
    facingDeg: z.number().finite().min(-180).max(180),
  })
  .strict();
/** 最短角差；正反180度都固定沿正向旋转。 */
export function previsShortestAngleDeg(from: number, to: number): number {
  const delta = (((to - from) % 360) + 360) % 360;
  return delta > 180 ? delta - 360 : delta;
}
export const previsActorSchema = z
  .object({
    id: z.string().min(1).max(100),
    nameZh: z.string().trim().min(1).max(80),
    /** 角色在白模中的身份色；旧稿缺省时按身份分配。 */
    colorIndex: z.number().int().min(0).max(5).optional(),
    /** 仅标明对应的项目角色；不声称为无骨骼 GLB 自动蒙皮。 */
    assetRef: z.string().max(160).optional(),
    weapon: z.literal("practice_sword").optional(),
    motionRoute: z.array(previsMotionRouteNodeSchema).min(2).max(12).optional(),
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
            kind: z.enum(PREVIS_ACTION_KINDS),
            startSec: z.number().finite().min(0).max(30),
            endSec: z.number().finite().positive().max(30),
            /** kind="turn" 的目标朝向；其它动作不接受。 */
            facingDeg: z.number().finite().min(-180).max(180).optional(),
            /** kind="look" 的注视目标：同场角色 id 或 "camera"；其它动作不接受。 */
            lookAtId: z.string().min(1).max(100).optional(),
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
    /** 人物、接触、特效和相机统一按源时间变速；不是独立摄影机的子弹时间。 */
    timeMap: manhuaShotTimeMapSchema.optional(),
    actors: z.array(previsActorSchema).min(1).max(6),
    interactions: z.array(previsInteractionSchema).max(24).optional(),
    scriptSource: previsScriptSourceSchema.optional(),
    waterEmergence: previsWaterEmergenceSchema.optional(),
    effects: previsEffectsSchema.optional(),
    exportLayers: z.literal(true).optional(),
    cameras: z
      .array(
        z
          .object({
            startSec: z.number().finite().min(0).max(30),
            endSec: z.number().finite().positive().max(30),
            position: cameraPoint,
            target: cameraPoint,
            endPosition: cameraPoint.optional(),
            endTarget: cameraPoint.optional(),
            /** 围绕当前注视点的水平环绕角度；不改变人物动作速度。 */
            orbitDeg: z.number().finite().min(-180).max(180).optional(),
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
  effects: previsEffectsDraftSchema.optional(),
  waterEmergence: previsWaterEmergenceSchema
    .extend({
      events: z
        .array(
          previsWaterEventSchema.extend({
            crossSec: draftNumber,
            riseSec: draftNumber,
            height: draftNumber,
            waveRadius: draftNumber,
            waveHeight: draftNumber,
            waveDurationSec: draftNumber,
          })
        )
        .max(6),
    })
    .optional(),
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
        motionRoute: z
          .array(
            previsMotionRouteNodeSchema.extend({
              timeSec: draftNumber,
              position: draftPoint,
              facingDeg: draftNumber,
            })
          )
          .max(12)
          .optional(),
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
                kind: z.enum(PREVIS_ACTION_KINDS),
                startSec: draftNumber,
                endSec: draftNumber,
                facingDeg: draftNumber.optional(),
                lookAtId: z.string().min(1).max(100).optional(),
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
          endPosition: draftCameraPoint.optional(),
          endTarget: draftCameraPoint.optional(),
          orbitDeg: draftNumber.optional(),
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
/** 出水预演硬限：人数与秒数。拆镜器（manhuaActionPlanSplit）从这里读，不重抄数字。 */
export const PREVIS_WATER_MAX_ACTORS = 3;
export const PREVIS_WATER_MAX_SEC = 8;
/** 预算换算用的采样帧率（与 previsRenderCostUnits 一致） */
export const PREVIS_BUDGET_FPS = 24;

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
    validatePrevisEffects(spec, ctx);
    if (spec.timeMap) {
      for (const issue of validateManhuaShotTimeMap(spec.timeMap)) ctx.addIssue({code:"custom",path:["timeMap"],message:issue.messageZh});
      if (Math.abs(spec.timeMap.sourceDurationSec-spec.durationSec)>1e-6) ctx.addIssue({code:"custom",path:["timeMap"],message:"变速源时长与动作配置不一致，请重新设置快慢节奏"});
      const duration=previsPlaybackDuration(spec);
      if (duration<2 || duration>30) ctx.addIssue({code:"custom",path:["timeMap"],message:"变速后的白模须在2—30秒内"});
      if (spec.exportLayers) ctx.addIssue({code:"custom",path:["timeMap"],message:"变速视频与源时间分层不能一起导出，请关闭分层或恢复常速"});
    }
    if (spec.exportLayers && (spec.durationSec > 8 || spec.actors.length > 3))
      ctx.addIssue({ code: "custom", message: "分层输出限3人8秒以内" });
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
        // 0917 PR-E：参数只属于需要它的动作，避免「填了没用」的假配置。
        if (action.kind === "turn" && !Number.isFinite(action.facingDeg as number))
          ctx.addIssue({
            code: "custom",
            message: "转身必须给目标朝向",
            path: ["actors", i, "actions", j, "facingDeg"],
          });
        if (action.kind !== "turn" && action.facingDeg !== undefined)
          ctx.addIssue({
            code: "custom",
            message: "只有转身能设目标朝向",
            path: ["actors", i, "actions", j, "facingDeg"],
          });
        if (action.kind === "look") {
          const target = String(action.lookAtId || "");
          const known =
            target === PREVIS_LOOK_AT_CAMERA ||
            spec.actors.some(other => other.id === target && other.id !== actor.id);
          if (!known)
            ctx.addIssue({
              code: "custom",
              message: "看向目标须是同场的其他角色或镜头",
              path: ["actors", i, "actions", j, "lookAtId"],
            });
        } else if (action.lookAtId !== undefined)
          ctx.addIssue({
            code: "custom",
            message: "只有看向能设注视目标",
            path: ["actors", i, "actions", j, "lookAtId"],
          });
        // 0917 审查：走位只负责「摆臂步态」，位移来自站位/轨迹。角色原地不动、
        // 或动作窗口压根不在位移区间内时，白模会原地摆臂假装在走——那是白模撒谎。
        if (
          action.kind === "walk" &&
          !previsActorTravelsDuring(actor, action.startSec, action.endSec)
        )
          ctx.addIssue({
            code: "custom",
            message:
              "走位动作必须落在角色实际位移区间内；原地不动请改用其它动作或先设好起止站位",
            path: ["actors", i, "actions", j],
          });
        // 0917 三轮审查实测（server/scripts/test_previs_drama_rigged.py）：
        // retarget_from_source 只烘「相对各自静止姿态的旋转增量」。棍人的静止姿态腿本来就
        // 屈着 31.3°（站位 IK 的结果），真模的静止姿态腿是直的，于是坐下只传过去 28.3° 的
        // 增量——腿够不着地，脚直接扎进地板：1.7 米模型 −21.4 厘米、2.55 米模型 −32.2 厘米，
        // 与身高成正比，不是夹具特例。走位实测只有 +2.0 厘米抬脚残差，不受影响。
        // 落脚校正上线之前，宁可拒绝提交，也不渲一个脚在地里的片子。
        if (action.kind === "sit" && actor.riggedModel)
          ctx.addIssue({
            code: "custom",
            message:
              "带骨角色暂不支持坐下：真模静止是直腿、棍人静止屈腿 31.3°，重定向只传旋转增量，实测脚会穿地（1.70 米角色约 21 厘米，2.55 米约 32 厘米）。待重定向补偿静止姿态差后开放（PR-F）。现在可以：把这一镜换成不带骨的棍人角色，或改用站立类动作；带骨角色的站位、看向、转身、行礼都不受影响。",
            path: ["actors", i, "actions", j],
          });
        // 转身与运动轨迹是两套朝向真源，同时给会互相覆盖，先拒绝。
        if (action.kind === "turn" && actor.motionRoute?.length)
          ctx.addIssue({
            code: "custom",
            message: "已设运动轨迹的角色不能再用转身动作；朝向请写进轨迹节点",
            path: ["actors", i, "actions", j],
          });
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
      if (actor.motionRoute) {
        const route = actor.motionRoute;
        const issue = (message: string) =>
          ctx.addIssue({
            code: "custom",
            message,
            path: ["actors", i, "motionRoute"],
          });
        if (spec.waterEmergence || actor.riggedModel || actor.creature)
          issue("分段路线暂不能与出水、绑定模型或显形混用");
        const first = route[0],
          last = route.at(-1)!;
        if (
          !first ||
          !last ||
          first.timeSec !== 0 ||
          Math.abs(last.timeSec - (spec.durationSec * 24 - 1) / 24) > 1e-8 ||
          first.position.some((v, k) => v !== actor.start[k]) ||
          last.position.some((v, k) => v !== actor.end[k]) ||
          first.facingDeg !== actor.facingDeg
        )
          issue(
            "路线首节点须为0秒并对应起点和初始朝向，末节点须对应最后一帧和终点"
          );
        route.forEach((node, j) => {
          if (
            Math.abs(node.timeSec * 24 - Math.round(node.timeSec * 24)) > 1e-6
          )
            issue("路线秒位须对齐24帧");
          if (!j) return;
          const previous = route[j - 1],
            dt = node.timeSec - previous.timeSec;
          if (dt < 0.25 - 1e-8) issue("路线节点须严格递增且至少间隔四分之一秒");
          if (
            dt > 0 &&
            (1.5 *
              Math.hypot(
                ...node.position.map((v, k) => v - previous.position[k])
              )) /
              dt >
              1.2 + 1e-8
          )
            issue("分段路线峰值速度不能超过每秒1.2米，请延长区间或缩短路线");
          if (
            dt > 0 &&
            (1.5 *
              Math.abs(
                previsShortestAngleDeg(previous.facingDeg, node.facingDeg)
              )) /
              dt >
              120 + 1e-8
          )
            issue("转向峰值速度不能超过每秒120度，请延长区间");
        });
      }
      const distance = Math.hypot(
        actor.end[0] - actor.start[0],
        actor.end[1] - actor.start[1]
      );
      if (
        !actor.motionRoute &&
        distance / (actor.moveEndSec - actor.moveStartSec) > 1.2
      )
        ctx.addIssue({
          code: "custom",
          message: "白模行走速度过快，请延长移动时间或缩短路线",
          path: ["actors", i],
        });
    });
    spec.actors.forEach((actor, i) => {
      if (
        actor.weapon &&
        (actor.shape !== "human" ||
          actor.riggedModel ||
          actor.actions.some(a => a.kind !== "idle"))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "练习剑仅支持人体白模待机与持剑格挡，不能叠加徒手动作或绑定模型",
          path: ["actors", i, "weapon"],
        });
    });
    const water = spec.waterEmergence;
    if (water) {
      const issue = (message: string, index?: number) =>
        ctx.addIssue({
          code: "custom",
          message,
          path:
            index === undefined
              ? ["waterEmergence"]
              : ["waterEmergence", "events", index],
        });
      if (spec.actors.length > PREVIS_WATER_MAX_ACTORS || spec.durationSec > PREVIS_WATER_MAX_SEC)
        issue(`当前出水预演最多${PREVIS_WATER_MAX_ACTORS}人、${PREVIS_WATER_MAX_SEC}秒，请缩短片长或减少角色`);
      const ids = new Set(water.events.map(e => e.actorId));
      if (
        ids.size !== water.events.length ||
        water.events.length !== spec.actors.length ||
        spec.actors.some(a => !ids.has(a.id))
      )
        issue("每个现有角色必须且只能绑定一条出水事件");
      if (spec.interactions?.length) issue("出水预演暂不能叠加双人接触事件");
      spec.actors.forEach(actor => {
        if (
          actor.shape !== "human" ||
          actor.weapon ||
          actor.creature ||
          actor.riggedModel ||
          actor.actions.some(a => a.kind !== "idle") ||
          actor.start.some((v, i) => v !== actor.end[i])
        )
          issue(
            "出水预演仅支持固定平面站位的人体白模，不能叠加持械、绑定模型、显形或独立动作"
          );
      });
      const lastSec = (spec.durationSec * 24 - 1) / 24;
      water.events.forEach((event, i) => {
        if (
          [event.crossSec, event.riseSec, event.waveDurationSec].some(
            t => Math.abs(t * 24 - Math.round(t * 24)) > 1e-6
          )
        )
          issue("出水、上升及浪花时长须对齐24帧", i);
        if (
          event.crossSec + event.riseSec > lastSec + 1e-8 ||
          event.crossSec + event.waveDurationSec > lastSec + 1e-8
        )
          issue("上升与浪花结束须落在最后一个实际视频帧内", i);
        for (const previous of water.events.slice(0, i)) {
          const frameGap = Math.abs(
            Math.round(event.crossSec * 24) - Math.round(previous.crossSec * 24)
          );
          if (water.mode === "simultaneous" ? frameGap !== 0 : frameGap < 1)
            issue(
              water.mode === "simultaneous"
                ? "同时出水的角色须在同一帧破水"
                : "错峰出水的角色须至少间隔一帧",
              i
            );
          const actor = spec.actors.find(a => a.id === event.actorId);
          const other = spec.actors.find(a => a.id === previous.actorId);
          const separation = event.waveRadius + previous.waveRadius + 0.1;
          if (
            actor &&
            other &&
            actor.start.every(
              (v, axis) => Math.abs(v - other.start[axis]) + 1e-8 < separation
            )
          )
            issue("独立浪花范围过近，请拉开角色站位或缩小浪花半径", i);
        }
      });
    }
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
      if (
        event.kind === "sword_guard"
          ? !actor?.weapon || !target?.weapon
          : actor?.weapon || target?.weapon
      )
        ctx.addIssue({
          code: "custom",
          message: "持剑格挡须双方装备练习剑；持剑角色不能使用徒手接触事件",
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
      if (camera.orbitDeg !== undefined) {
        if (camera.endPosition || camera.endTarget) ctx.addIssue({ code: "custom", message: "环绕与直线终点不能同时使用", path: ["cameras", i] });
        const radius = Math.hypot(camera.position[0] - camera.target[0], camera.position[1] - camera.target[1]);
        if (radius < 0.5 || Math.abs(camera.target[0]) + radius > 30 || Math.abs(camera.target[1]) + radius > 30)
          ctx.addIssue({ code: "custom", message: "环绕半径须至少半米，环绕范围须留在舞台内", path: ["cameras", i] });
      }
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
      const delta = camera.position.map((n, j) => n - camera.target[j]);
      const travel = delta.map((n, j) => (camera.endPosition ?? camera.position)[j] - (camera.endTarget ?? camera.target)[j] - n);
      const travelSquared = travel.reduce((sum, n) => sum + n * n, 0);
      const closest = travelSquared ? Math.max(0, Math.min(1, -delta.reduce((sum, n, j) => sum + n * travel[j], 0) / travelSquared)) : 0;
      if (Math.hypot(...delta.map((n, j) => n + closest * travel[j])) < 0.5)
        ctx.addIssue({
          code: "custom",
          message: "机位与目标不能重合，运动途中也须保持至少半米距离",
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
    /** PR-6 节奏档：用户手改的风格档（缺省 = 按段意图/导演包自动） */
    cameraStyle: z.enum(["hard", "slow_orbit", "handheld"]).optional(),
    /** PR-6：套用草案时带来的每镜运镜句与节奏说明；采用白模时逐镜追加进运动指引 */
    draftCameraPromptZh: z.array(z.string().max(400)).max(8).optional(),
    draftTempoZh: z.string().max(400).optional(),
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
  if (spec.timeMap) return "白模已按统一时间表变速；以下秒位均为成片呈现时间，直接跟随参考，不重复变速。\n" + formatPrevisMotionGuide(previsPresentationGuideSpec(spec));
  return [
    "参考中的关节姿态、落脚、蓄力—出手—回收及保护反应按对应秒位读取；不继承白模外形。",
    ...spec.cameras.filter(c => c.orbitDeg).map(c => `${c.startSec}—${c.endSec}秒围绕（${c.target.join("，")}）水平环绕${c.orbitDeg}度，保持半径和高度；人物速度不由环绕改变。`),
    ...spec.cameras.filter(c => c.endPosition || c.endTarget).map(c =>
      `${c.startSec}—${c.endSec}秒相机从（${c.position.join("，")}）连续移动到（${(c.endPosition ?? c.position).join("，")}），看向从（${c.target.join("，")}）到（${(c.endTarget ?? c.target).join("，")}）；平滑起停，切镜时不跨镜连移。`
    ),
    ...spec.actors.map(
      (a, index) =>
        `白模角色${index + 1}对应${a.nameZh}${a.assetRef ? `（${a.assetRef}）` : ""}：${spec.waterEmergence ? "按下方出水时间与竖直轨迹" : a.actions.length ? a.actions.map(x => `${x.startSec}—${x.endSec}秒${PREVIS_ACTION_LABELS[x.kind]}`).join("；") : "按参考站位和步态"}。`
    ),
    ...spec.actors
      .filter(a => a.motionRoute)
      .map(
        a =>
          `${a.nameZh}分段路线：${a.motionRoute!.map(node => `${node.timeSec}秒位置（${node.position.join("，")}），朝向${node.facingDeg}度`).join("；")}。节点间平滑移动与短弧转向；相差180度固定正向旋转。路线不代表自动避碰，需按实际预演检查人物及武器穿插。`
      ),
    ...(spec.effects ?? []).map(
      e =>
        `${e.startSec}—${e.startSec + e.durationSec}秒，${e.kind === "explosion" ? "爆点闪光与烟团" : "烟团"}位于（${e.origin.join("，")}），横向缩放${e.radius}倍、纵向缩放${e.height}倍（不是最大包络尺寸），烟团水平漂移（${e.wind.join("，")}）米。跟随参考中可见事件与遮挡；几何预演不表示已完成物理破坏。`
    ),
    ...(spec.waterEmergence
      ? [
          `出水节奏：${spec.waterEmergence.mode === "simultaneous" ? "同时冲出" : "错峰冲出"}。水面高度为0；镜头以整体气势为主，不要求看清每个人。每人独立冲击浪，保持世界空间及画面投影分离，不互相遮挡或汇合。`,
          ...spec.waterEmergence.events.map(event => {
            const actor = spec.actors.find(a => a.id === event.actorId)!;
            return `${actor.nameZh}：${event.crossSec}秒头部首先破水，随后${event.riseSec}秒竖直上升，${event.crossSec + event.riseSec}秒根节点达到水面上${event.height}米；独立浪花${event.crossSec}—${event.crossSec + event.waveDurationSec}秒，最大半径${event.waveRadius}米、高${event.waveHeight}米。`;
          }),
          "本地几何浪花仅约束时序、运动方向与独立分离，不代表真实水质或最终流体效果。",
        ]
      : []),
    ...spec.actors
      .filter(a => a.weapon)
      .map(
        a =>
          `${a.nameZh}右手持剑，手柄随手腕，参考只约束动作与比例，武器外观按该角色道具参考。`
      ),
    ...(spec.interactions ?? []).map(event => {
      const actor = spec.actors.find(a => a.id === event.actorId)!;
      const target = spec.actors.find(a => a.id === event.targetActorId)!;
      return `${event.startSec}—${event.endSec}秒，${actor.nameZh}向${target.nameZh}出手，${event.contactSec}秒${event.kind === "sword_guard" ? "双方右手持剑，剑刃交叉格挡；接触后受方卸力、双方回收至持剑准备姿态" : event.kind === "strike_guard" ? "双手接触格挡" : "触及胸前后受方后缩"}；双方按同一事件时序，不拆成无关动作。`;
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
