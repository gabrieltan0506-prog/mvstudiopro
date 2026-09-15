/**
 * 漫剧动作计划：一份计划之内「谁、对谁、什么时候、打到哪、结果如何」的**唯一权威状态**。
 *
 * 为什么要立这个模块（0915 施工方案 A）：
 * 同一件事现在散在三套互不相通的身份体系里——
 *   1. `shared/manhuaShotIR.ts`：镜头身份＝数组下标 `index`，无稳定 ID、无版本；
 *   2. `shared/manhuaDirectorBoardOverlay.ts`：有稳定 ID 与 `sourceRevision`，
 *      但只描述画面上的线，不描述「谁打谁、打中没有」；
 *   3. `shared/manhuaPrevis.ts`：白模 spec 自带 id，与资产 canon 只有弱引用 `assetRef`。
 * 三份副本各自可改，于是导演板改了目标、白模还按旧的打、提示词写第三种说法。
 *
 * ── 本版按 0915「七项决定」重写，相对首版的实质变化 ──
 * 1. 不再强迫每镜重填全员：`initialStates` + 逐镜 `changes`，确认/执行时才编译全员快照；
 *    新增 `not_entered`，不拿 `exited` 冒充「还没上场」。
 * 2. `confirm` 默认仍是 `unplanned`，但只在**历史数据缺字段**时补默认，
 *    不重置已持久化且版本有效的确认；草稿阶段缺项只给 issue，确认/执行才硬拦。
 * 3. 版本在**消费边界**拒绝，编辑入口自动 seal；摘要用递归规范键序的稳定内容摘要，
 *    数组次序有语义故保留；审批记录（`approvedRevision`）放在摘要之外。
 * 4. 落点不再是裸字符串：`{ overlayRef, landingId, sourceRevision }` 三元组，
 *    真正的存在性/归属/坐标空间校验由 `manhuaActionPlanBindings` 用绑定上下文做。
 * 5. 事件只标「希望慢看」，真正变速统一到镜头 `timeMap`（见 manhuaActionPlanTiming）。
 * 6. 不复制相机曲线，只存 `cameraBinding` 指向现有来源 + 版本 + 时间口径。
 * 7. 不新建 scene 层：顶层是 `actionPlanId`，`episodeIndex` 是归属；
 *    装箱用镜头范围→执行段范围的 range binding，不撒谎的一对一。
 *
 * 明确不做：不替代白模能力限制（出水≤3人8秒、禁叠双人接触/持械/带骨，
 * 持剑只支持待机与格挡等仍在 `shared/manhuaPrevis.ts` 的 superRefine 里）。
 * **12 人是计划容量，不代表渲染器支持 12 人。**
 */

import { z } from "zod";
import {
  manhuaShotTimeMapSchema,
  manhuaTimeBasisSchema,
  validateManhuaShotTimeMap,
} from "./manhuaActionPlanTiming";

/** 当前格式版本；破坏性改动必须升版并写迁移，不许原地改语义 */
export const MANHUA_ACTION_PLAN_FORMAT = "mv-manhua-action-plan-v1" as const;

const idSchema = z.string().trim().min(1).max(120);

/* ────────────────────────── 空间：屏幕 ≠ 世界 ────────────────────────── */

/**
 * 决定附则「空间」：单个二维归一化点无法还原高度、深度或出水/登船轨迹。
 * 屏幕点与世界点必须分开；没有深度依据就标 `unresolved`，**不猜后假装锁定**。
 */
export const manhuaScreenPointSchema = z
  .object({
    space: z.literal("screen"),
    /** 归一化画面坐标，左上 (0,0) 右下 (1,1)，与导演板 overlay 同口径 */
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict();

/** 世界坐标必须写清单位与轴向，不能靠默认 */
export const manhuaWorldPointSchema = z
  .object({
    space: z.literal("world"),
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
    unit: z.literal("m"),
    /** previs 场景轴向；换轴向必须显式，不默认 */
    axis: z.enum(["z_up", "y_up"]),
  })
  .strict();

/** 只有屏幕点、缺深度依据时用它——诚实标注好过编一个 z */
export const manhuaUnresolvedPointSchema = z
  .object({
    space: z.literal("unresolved"),
    /** 已知的屏幕投影（若有） */
    screen: manhuaScreenPointSchema.optional(),
    /** 为什么还原不了，一句中文 */
    reasonZh: z.string().trim().min(1).max(200),
  })
  .strict();

export const manhuaSpatialPointSchema = z.discriminatedUnion("space", [
  manhuaScreenPointSchema,
  manhuaWorldPointSchema,
  manhuaUnresolvedPointSchema,
]);
export type ManhuaSpatialPoint = z.infer<typeof manhuaSpatialPointSchema>;
export type ManhuaScreenPoint = z.infer<typeof manhuaScreenPointSchema>;
export type ManhuaWorldPoint = z.infer<typeof manhuaWorldPointSchema>;

/**
 * 朝向：必须注明参照轴，不能因为都是 ±180 就宣称与 previs 同口径。
 * `screen_deg` 是画面内朝向；`world_yaw_deg` 是场景绕竖轴偏航。
 */
export const manhuaFacingSchema = z
  .object({
    basis: z.enum(["screen_deg", "world_yaw_deg"]),
    deg: z.number().finite().min(-180).max(180),
  })
  .strict();
export type ManhuaFacing = z.infer<typeof manhuaFacingSchema>;

/* ────────────────────────── 在场状态 ────────────────────────── */

/**
 * 决定一：必须能表达「还没上场」。
 * 拿 `exited` 冒充 `not_entered` 会让「他走了」和「他还没来」变成同一件事，
 * 下游据此判断去向就会错。
 */
export const manhuaActorPresenceSchema = z.enum([
  /** 还没上场（本场戏尚未登场） */
  "not_entered",
  /** 在画面里 */
  "onstage",
  /** 在这场戏里但此镜不入画（去向必须写明） */
  "offstage",
  /** 已离开这场戏 */
  "exited",
]);
export type ManhuaActorPresence = z.infer<typeof manhuaActorPresenceSchema>;

/* ────────────────────────── 确认态 ────────────────────────── */

/**
 * 决定二：默认 `unplanned` 保留，但只在历史数据缺字段时补默认，
 * **不重置已持久化且版本有效的确认**。
 * 另：动作编排确认与真实白模/成片审片、付费出站确认是三件事，别混。
 */
export const manhuaPlanConfirmSchema = z.enum(["unplanned", "draft", "confirmed"]);
export type ManhuaPlanConfirm = z.infer<typeof manhuaPlanConfirmSchema>;

/* ────────────────────────── 事件：判别式 kind ────────────────────────── */

/**
 * 决定附则「动作语义」：只有 hit/blocked/evaded 不足以描述出水、登船、停手。
 * 改成判别式 union——每种 kind 有自己的结果类型与目标必填规则。
 * **先支持现有动作，不把所有枚举当已能渲染**（能力矩阵另列）。
 */
export const manhuaActionEventKindSchema = z.enum([
  /** 攻击：必须有目标 */
  "attack",
  /** 闪避：必须有威胁来源 */
  "evade",
  /** 出水：现有白模能力（≤3人8秒且禁叠持械/带骨） */
  "emerge",
  /** 落地/登船：必须绑落点与落地表面 */
  "land",
  /** 脱离接触/停手 */
  "disengage",
  /** 观察/注视：只表达关注，不产生受力 */
  "observe",
]);
export type ManhuaActionEventKind = z.infer<typeof manhuaActionEventKindSchema>;

/** 动作阶段区间，**源时间**口径（不是成片呈现时间） */
export const manhuaActionPhaseSchema = z
  .object({
    kind: z.enum(["windup", "burst", "contact", "recover", "counter"]),
    sourceStartSec: z.number().finite().min(0),
    sourceEndSec: z.number().finite().min(0),
  })
  .strict();
export type ManhuaActionPhase = z.infer<typeof manhuaActionPhaseSchema>;

/**
 * 落点绑定：**不是裸字符串**（决定四）。
 * 带上 overlay 引用与其版本，才能核「这个落点还在不在、属不属于这一镜、改了没有」。
 */
export const manhuaLandingBindingSchema = z
  .object({
    /** 导演板 overlay 的定位引用（集/段/镜） */
    overlayRef: z
      .object({
        episodeIndex: z.number().int().positive(),
        segmentIndex: z.number().int().positive(),
        shotIndex: z.number().int().positive(),
      })
      .strict(),
    landingId: idSchema,
    /** 绑定时 overlay 的 sourceRevision；对不上说明落点已被改过 */
    sourceRevision: z.string().trim().min(1).max(160),
    /**
     * 落地表面的**稳定引用**（如 surf_deck_main）。
     * 比对一致性只认它；中文名只用于展示——
     * 靠中文名比对会把「甲板」「主甲板」当成两个东西，也挡不住改名。
     */
    surfaceRef: idSchema.optional(),
    /** 落地表面展示名（甲板/水面/地面…） */
    surfaceZh: z.string().trim().max(80).optional(),
  })
  .strict();
export type ManhuaLandingBinding = z.infer<typeof manhuaLandingBindingSchema>;

/** 持物绑定：**数组里有 id 不能证明剑握在手上**（决定附则），要有手/插槽 */
export const manhuaHeldPropSchema = z
  .object({
    /** 资产 canon 的 wa_prop_* */
    propAnchorId: idSchema,
    /** 握持部位；unknown 表示还没绑定，不假装已绑 */
    socket: z.enum(["right_hand", "left_hand", "both_hands", "back", "waist", "unknown"]),
  })
  .strict();
export type ManhuaHeldProp = z.infer<typeof manhuaHeldPropSchema>;

const baseEventFields = {
  eventId: idSchema,
  /** 发起方 */
  actorId: idSchema,
  phases: z.array(manhuaActionPhaseSchema).min(1).max(12),
  /**
   * 「希望慢看」的意向标记（决定五）。
   * **这里只表达意图，不带播放倍率**——真正变速统一落在镜头 timeMap 上，
   * 否则会出现攻击方慢放、被打的人常速这种物理上不存在的画面。
   */
  slowMotionIntent: z.boolean().default(false),
  noteZh: z.string().trim().max(400).optional(),
};

/** 攻击：目标必填，结果三态 */
const attackEventSchema = z
  .object({
    ...baseEventFields,
    kind: z.literal("attack"),
    targetActorId: idSchema,
    contactAt: manhuaSpatialPointSchema.optional(),
    landing: manhuaLandingBindingSchema.optional(),
    outcome: z.enum(["hit", "blocked", "evaded", "unplanned"]).default("unplanned"),
  })
  .strict();

/** 闪避：威胁来源必填 */
const evadeEventSchema = z
  .object({
    ...baseEventFields,
    kind: z.literal("evade"),
    /** 躲谁 */
    threatActorId: idSchema,
    outcome: z.enum(["evaded", "partial", "failed", "unplanned"]).default("unplanned"),
  })
  .strict();

/** 出水：现有白模能力，落点可选，无目标 */
const emergeEventSchema = z
  .object({
    ...baseEventFields,
    kind: z.literal("emerge"),
    landing: manhuaLandingBindingSchema.optional(),
    outcome: z.enum(["emerged", "unplanned"]).default("unplanned"),
  })
  .strict();

/** 落地/登船：**必须绑落点**，结果里有 landed，不再永远 unplanned */
const landEventSchema = z
  .object({
    ...baseEventFields,
    kind: z.literal("land"),
    landing: manhuaLandingBindingSchema,
    outcome: z.enum(["landed", "missed", "unplanned"]).default("unplanned"),
  })
  .strict();

/** 脱离接触/停手 */
const disengageEventSchema = z
  .object({
    ...baseEventFields,
    kind: z.literal("disengage"),
    fromActorId: idSchema.optional(),
    outcome: z.enum(["disengaged", "unplanned"]).default("unplanned"),
  })
  .strict();

/** 观察：只表达关注，不产生受力 */
const observeEventSchema = z
  .object({
    ...baseEventFields,
    kind: z.literal("observe"),
    subjectActorId: idSchema.optional(),
    outcome: z.literal("observed").default("observed"),
  })
  .strict();

export const manhuaActionEventSchema = z.discriminatedUnion("kind", [
  attackEventSchema,
  evadeEventSchema,
  emergeEventSchema,
  landEventSchema,
  disengageEventSchema,
  observeEventSchema,
]);
export type ManhuaActionEvent = z.infer<typeof manhuaActionEventSchema>;

/* ────────────────────────── 角色与状态 ────────────────────────── */

/** 角色：只放**本场具名参与者**，不放全剧角色（决定一） */
export const manhuaPlanActorSchema = z
  .object({
    actorId: idSchema,
    nameZh: z.string().trim().min(1).max(80),
    /** 资产 canon 锚点 wa_char_*；三边对齐的钥匙 */
    canonAnchorId: idSchema.optional(),
  })
  .strict();
export type ManhuaPlanActor = z.infer<typeof manhuaPlanActorSchema>;

/**
 * 角色状态。
 *
 * `targetActorId` 在这里**只表示当前关注对象**（决定附则）——
 * 真正的攻防以 event 为准。两处都能独立改会冲突，所以这里的语义被收窄了。
 */
export const manhuaPlanActorStateSchema = z
  .object({
    presence: manhuaActorPresenceSchema,
    at: manhuaSpatialPointSchema.optional(),
    facing: manhuaFacingSchema.optional(),
    heldProps: z.array(manhuaHeldPropSchema).max(8).default([]),
    /** 当前关注对象（不是攻防判定依据） */
    focusActorId: idSchema.optional(),
    /** presence 非 onstage 时必填：人去哪了 */
    whereaboutsZh: z.string().trim().max(200).optional(),
  })
  .strict();
export type ManhuaPlanActorState = z.infer<typeof manhuaPlanActorStateSchema>;

/**
 * 逐镜状态变更（决定一：编辑只填变化，不强迫全员重填）。
 *
 * ⚠️ `next` 不能直接用 `manhuaPlanActorStateSchema.partial()`：
 * `heldProps` 带 `.default([])`，partial 之后 zod 解析仍会往没写的 `next` 里
 * 塞一个空数组——于是「没改持物」被写成「改成空手」，
 * 而且 seal 侧（未解析）与校验侧（已解析）算出的摘要会不一致。
 * 这里显式重列为全可选、无默认值的形状。
 */
export const manhuaPlanActorChangeSchema = z
  .object({
    actorId: idSchema,
    /** 本镜要改成什么；未列字段视为沿用上一镜 */
    next: z
      .object({
        presence: manhuaActorPresenceSchema.optional(),
        /**
         * 可清空字段的三态（0915 收口）：
         *   省略      = 沿用上一镜
         *   给值      = 改成这个值
         *   显式 null = **解除/清空**
         * 以前只有「省略」和「给值」，正常输入根本表达不出「解除关注对象」，
         * 空串又会被 schema 拒。null 只存在于 patch 层，
         * 编译出来的完整状态里不会出现 null。
         */
        at: manhuaSpatialPointSchema.nullable().optional(),
        facing: manhuaFacingSchema.nullable().optional(),
        /** 持物清空仍用 []，不引回 .default([]) 那个老毛病 */
        heldProps: z.array(manhuaHeldPropSchema).max(8).optional(),
        focusActorId: idSchema.nullable().optional(),
        whereaboutsZh: z.string().trim().max(200).nullable().optional(),
      })
      .strict(),
  })
  .strict();
export type ManhuaPlanActorChange = z.infer<typeof manhuaPlanActorChangeSchema>;

/* ────────────────────────── 相机绑定 ────────────────────────── */

/**
 * 决定六：不复制相机曲线，只存**可验证的绑定**。
 * 注意 overlay.cameraPath 只有 points 没有秒数——不能把它当已带时间的轨迹，
 * 所以这里要求显式写清来源与时间口径，解析成带时间采样是适配器的事。
 */
export const manhuaCameraBindingSchema = z
  .object({
    source: z.enum(["shot_ir", "overlay_camera_path", "previs_cameras"]),
    /** 来源侧的镜头/记录 ID */
    sourceShotRef: z.string().trim().min(1).max(160),
    /** 来源版本；对不上说明相机已被改过 */
    sourceRevision: z.string().trim().min(1).max(160),
    /** 相机跟源时间还是呈现时间，**必须显式**（决定五） */
    timeBasis: manhuaTimeBasisSchema,
    /** 是否已解析成带时间采样；false 表示只有空间点、时间待定 */
    timedSamplesResolved: z.boolean().default(false),
  })
  .strict();
export type ManhuaCameraBinding = z.infer<typeof manhuaCameraBindingSchema>;

/* ────────────────────────── 镜头 ────────────────────────── */

/** 对接现有 episode/segment/shotIndex 的来源绑定（决定七：镜头索引只定位旧数据） */
export const manhuaShotSourceBindingSchema = z
  .object({
    episodeIndex: z.number().int().positive(),
    segmentIndex: z.number().int().positive().optional(),
    /** 源侧镜头下标；**重排后更新映射，不改 shotId** */
    sourceShotIndex: z.number().int().positive().optional(),
    sourceRevision: z.string().trim().max(160).optional(),
  })
  .strict();

export const manhuaPlanShotSchema = z
  .object({
    /** 稳定身份。**不用数组下标**；重排只改 displayIndex 与来源映射 */
    shotId: idSchema,
    displayIndex: z.number().int().positive(),
    sourceBinding: manhuaShotSourceBindingSchema.optional(),
    /** 时间映射：源时长 + 变速区间；呈现时长由它算出，不另存 */
    timeMap: manhuaShotTimeMapSchema,
    confirm: manhuaPlanConfirmSchema.default("unplanned"),
    /** 本镜相对上一镜的状态变化；首镜由 initialStates 提供基线 */
    actorChanges: z.array(manhuaPlanActorChangeSchema).max(24).default([]),
    events: z.array(manhuaActionEventSchema).max(24).default([]),
    camera: manhuaCameraBindingSchema.optional(),
  })
  .strict();
export type ManhuaPlanShot = z.infer<typeof manhuaPlanShotSchema>;

/**
 * 装箱映射（决定七）：一镜可能跨多个执行片段，一个执行片段也可能含多镜。
 * 用**范围**表达，禁止撒谎的一对一。未装箱时整个数组为空。
 */
export const manhuaExecutionRangeSchema = z
  .object({
    executionSegmentId: idSchema,
    /** 本执行段覆盖的镜头 ID（按顺序） */
    shotIds: z.array(idSchema).min(1).max(120),
    /** 首镜在本执行段内的起始偏移（呈现时间，秒） */
    startOffsetSec: z.number().finite().min(0).default(0),
  })
  .strict();
export type ManhuaExecutionRange = z.infer<typeof manhuaExecutionRangeSchema>;

/* ────────────────────────── 计划 ────────────────────────── */

/**
 * 审批记录（决定三）：放在内容摘要**之外**。
 * 否则「确认」这个字段本身会改变被确认的内容，摘要永远对不上。
 */
export const manhuaPlanApprovalSchema = z
  .object({
    /** 被批准的那一版内容摘要 */
    approvedRevision: z.string().trim().min(1).max(160),
    approvedAtIso: z.string().trim().min(1).max(40),
    approvedByZh: z.string().trim().max(80).optional(),
  })
  .strict();
export type ManhuaPlanApproval = z.infer<typeof manhuaPlanApprovalSchema>;

export const manhuaActionPlanSchema = z
  .object({
    format: z.literal(MANHUA_ACTION_PLAN_FORMAT),
    /** 稳定计划身份（决定七：不叫 sceneId，不新建 scene 层） */
    actionPlanId: idSchema,
    /** 归属集号 */
    episodeIndex: z.number().int().positive(),
    /** 内容摘要；由 manhuaActionPlanRevision 算出，编辑入口自动 seal */
    planRevision: z.string().trim().min(1).max(160),
    actors: z.array(manhuaPlanActorSchema).min(1).max(12),
    /** 首镜基线状态：actorId → 状态 */
    initialStates: z.record(idSchema, manhuaPlanActorStateSchema).default({}),
    shots: z.array(manhuaPlanShotSchema).min(1).max(120),
    /** 装箱范围映射；未装箱为空 */
    executionRanges: z.array(manhuaExecutionRangeSchema).max(120).default([]),
    /** 审批记录，不进内容摘要 */
    approval: manhuaPlanApprovalSchema.optional(),
    /** 将来真有叙事场次再用；现在不硬塞 */
    narrativeSceneRef: idSchema.optional(),
  })
  .strict();
export type ManhuaActionPlan = z.infer<typeof manhuaActionPlanSchema>;

/* ────────────────────────── 内容摘要 ────────────────────────── */

/**
 * 递归规范化键序（决定三）。
 * **数组次序保留**——镜头顺序、阶段顺序都有语义，排序会抹掉真实变化。
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      if (src[key] === undefined) continue;
      out[key] = canonicalize(src[key]);
    }
    return out;
  }
  return value;
}

/**
 * 128 位内容摘要：四条独立的 32 位 FNV-1a，各用不同种子与盐并行跑，拼成 32 位十六进制。
 *
 * 为什么不用仓里现成的 `stableRevision`：那是单条 32 位滚动哈希
 * （`manhuaDirectorBoardOverlayCompile.ts:518`），0915 决定三明说它只适合
 * 轻量变化提示。这里加宽到 128 位降低碰撞面。
 *
 * 为什么不用 BigInt：本仓 tsconfig target 低于 ES2020，BigInt 字面量不可用
 * （实测 TS2737）。四路 32 位在 JS 数字安全范围内用 Math.imul 跑，等效加宽且可移植。
 *
 * ⚠️ 它仍是**内容摘要，不是密码学签名**。付费授权凭证必须另走服务端，
 * 不能拿这个串当授权证明。
 */
const DIGEST_SEEDS = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b] as const;
const DIGEST_SALTS = ["", "\u0001", "\u0002", "\u0003"] as const;

function fnv1a32(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function contentDigest128(text: string): string {
  let out = "";
  for (let lane = 0; lane < 4; lane += 1) {
    // 加盐让四路不退化成同一个函数：同样的输入在各路走不同轨迹
    const value = fnv1a32(`${DIGEST_SALTS[lane]}${text}${DIGEST_SALTS[lane]}`, DIGEST_SEEDS[lane]!);
    out += value.toString(16).padStart(8, "0");
  }
  return out;
}

/** 进入摘要的内容：**审批记录与摘要本身除外**（决定三） */
type ManhuaActionPlanDigestInput = Omit<ManhuaActionPlan, "format" | "planRevision" | "approval">;

export function manhuaActionPlanRevision(input: ManhuaActionPlanDigestInput): string {
  const text = JSON.stringify(canonicalize(input));
  return `apr1_${contentDigest128(text)}`;
}

/**
 * 取出参与摘要的那几个字段。
 *
 * **必须显式挑字段，不能直接展开入参**：调用方按惯例会写
 * `sealManhuaActionPlan({ ...plan, shots })`，那样 `format` 与旧 `planRevision`
 * 会混进摘要，算出来的值与消费端校验（只用这几个字段）永远对不上——
 * 表现为「刚 seal 完就报 revision_mismatch」。
 */
function pickManhuaActionPlanDigestInput(
  input: ManhuaActionPlanDigestInput,
): ManhuaActionPlanDigestInput {
  return {
    actionPlanId: input.actionPlanId,
    episodeIndex: input.episodeIndex,
    actors: input.actors,
    initialStates: input.initialStates,
    shots: input.shots,
    executionRanges: input.executionRanges,
    ...(input.narrativeSceneRef ? { narrativeSceneRef: input.narrativeSceneRef } : {}),
  };
}

/**
 * 编辑入口用：规范化 → 重算摘要 → 封口。所有合法编辑都应经过它，用户不必手点重算。
 *
 * **必须先过一遍 zod 再算摘要**：schema 上的 `.default()` 会在解析时补字段，
 * 若 seal 用未解析的原始对象算、消费端用解析后的对象算，两边形状不同，
 * 摘要必然对不上（表现为「刚存完就说版本不符」）。
 * 解析失败时抛错——与其发出一份摘要与内容不符的计划，不如当场炸。
 */
export function sealManhuaActionPlan(
  input: ManhuaActionPlanDigestInput & {
    approval?: ManhuaPlanApproval;
    /** 允许调用方直接展开一份既有计划；这两个字段会被忽略并重算 */
    format?: typeof MANHUA_ACTION_PLAN_FORMAT;
    planRevision?: string;
  },
): ManhuaActionPlan {
  const draft = {
    format: MANHUA_ACTION_PLAN_FORMAT,
    ...pickManhuaActionPlanDigestInput(input),
    // 占位：先过 schema 拿到规范化形状，再用规范化内容算真正的摘要
    planRevision: "apr1_pending",
    ...(input.approval ? { approval: input.approval } : {}),
  };
  const normalized = manhuaActionPlanSchema.parse(draft);
  const content = pickManhuaActionPlanDigestInput(normalized);
  return { ...normalized, planRevision: manhuaActionPlanRevision(content) };
}

/** 审批是否仍然有效：内容变了，旧审批自动失效 */
export function isManhuaPlanApprovalCurrent(plan: ManhuaActionPlan): boolean {
  return Boolean(plan.approval && plan.approval.approvedRevision === plan.planRevision);
}

/* ────────────────────────── 快照编译 ────────────────────────── */

/**
 * 编译某镜的**全员快照**（决定一）。
 *
 * 编辑时只填变化，但确认/执行时必须能拿到每镜全员状态。
 * 只有**显式继承**才沿用上一镜——未在 initialStates 出现且从未变更过的角色
 * 会落到 `not_entered`，而不是凭空推断成在场。
 */
/**
 * 把 patch 层的一个可清空字段落到完整状态上。
 * `null` 是**显式清空**（把键删掉），`undefined` 是沿用上一镜。
 * 完整状态里不留 null——消费方不必到处判空值还是没写。
 */
function applyPatchField<K extends "at" | "facing" | "focusActorId" | "whereaboutsZh">(
  state: ManhuaPlanActorState,
  key: K,
  patched: ManhuaPlanActorState[K] | null | undefined,
): void {
  if (patched === undefined) return;
  if (patched === null) {
    delete state[key];
    return;
  }
  state[key] = patched;
}

export function compileManhuaShotSnapshot(
  plan: ManhuaActionPlan,
  shotId: string,
): Record<string, ManhuaPlanActorState> | null {
  const index = plan.shots.findIndex((s) => s.shotId === shotId);
  if (index < 0) return null;

  const snapshot: Record<string, ManhuaPlanActorState> = {};
  for (const actor of plan.actors) {
    const initial = plan.initialStates[actor.actorId];
    snapshot[actor.actorId] = initial
      ? { ...initial, heldProps: initial.heldProps ?? [] }
      : { presence: "not_entered", heldProps: [] };
  }

  for (let i = 0; i <= index; i += 1) {
    for (const change of plan.shots[i]!.actorChanges) {
      const prev = snapshot[change.actorId];
      if (!prev) continue; // 悬空 actorId 由校验报错，这里不造人
      const next: ManhuaPlanActorState = {
        ...prev,
        heldProps: change.next.heldProps ?? prev.heldProps,
      };
      if (change.next.presence !== undefined) next.presence = change.next.presence;
      // 下面四个是可清空字段：null 删除、undefined 继承、有值覆盖
      applyPatchField(next, "at", change.next.at);
      applyPatchField(next, "facing", change.next.facing);
      applyPatchField(next, "focusActorId", change.next.focusActorId);
      applyPatchField(next, "whereaboutsZh", change.next.whereaboutsZh);
      snapshot[change.actorId] = next;
    }
  }
  return snapshot;
}

/* ────────────────────────── 校验 ────────────────────────── */

/** 校验口径：草稿宽、执行严（决定一/二） */
export type ManhuaActionPlanCheckMode =
  /** 编辑中：缺项只报 issue，不拦 */
  | "draft"
  /** 确认或送执行前：缺项硬拦 */
  | "execution";

export type ManhuaActionPlanIssueCode =
  | "duplicate_actor_id"
  | "duplicate_shot_id"
  | "duplicate_event_id"
  | "dangling_actor_ref"
  | "dangling_target_ref"
  | "self_target"
  | "missing_actor_state"
  | "offstage_without_whereabouts"
  | "onstage_without_position"
  | "not_entered_with_action"
  /** 交互双方之一当前不在场（未入场/已离场），不能参与这次交锋 */
  | "event_participant_unavailable"
  | "phase_out_of_order"
  | "phase_out_of_shot"
  | "timemap_invalid"
  | "land_without_surface"
  | "held_prop_socket_unknown"
  | "execution_range_dangling_shot"
  | "execution_range_duplicate_shot"
  | "revision_mismatch"
  | "approval_stale";

export type ManhuaActionPlanIssue = {
  code: ManhuaActionPlanIssueCode;
  messageZh: string;
  /** 严重度：draft 模式下 warning 不拦，execution 模式下一律拦 */
  severity: "error" | "warning";
  shotId?: string;
  eventId?: string;
  actorId?: string;
};

export function validateManhuaActionPlan(
  plan: ManhuaActionPlan,
  mode: ManhuaActionPlanCheckMode = "draft",
): ManhuaActionPlanIssue[] {
  const issues: ManhuaActionPlanIssue[] = [];
  const push = (i: ManhuaActionPlanIssue) => issues.push(i);
  /** 草稿期可缺、执行期必须有的项 */
  const gate = (): "error" | "warning" => (mode === "execution" ? "error" : "warning");

  const actorIds = new Set<string>();

  /** 对**有效状态**（初始 + 继承 + 本镜修正）做的检查，change 层不重复报 */
  const checkEffectiveActorState = (
    actorId: string,
    st: ManhuaPlanActorState,
    shotId: string,
    displayIndex: number,
  ): void => {
    if (st.focusActorId && !actorIds.has(st.focusActorId)) {
      push({
        code: "dangling_target_ref",
        severity: "error",
        messageZh: `第 ${displayIndex} 镜的关注对象不存在：${st.focusActorId}`,
        shotId,
        actorId,
      });
    }
    if (st.focusActorId && st.focusActorId === actorId) {
      push({
        code: "self_target",
        severity: "error",
        messageZh: `第 ${displayIndex} 镜有角色把自己当关注对象`,
        shotId,
        actorId,
      });
    }
    for (const hp of st.heldProps ?? []) {
      if (hp.socket === "unknown") {
        push({
          code: "held_prop_socket_unknown",
          severity: gate(),
          messageZh: `第 ${displayIndex} 镜「${actorId}」持有 ${hp.propAnchorId} 但没绑定握持部位——有 id 不等于握在手上`,
          shotId,
          actorId,
        });
      }
    }
  };
  for (const a of plan.actors) {
    if (actorIds.has(a.actorId)) {
      push({
        code: "duplicate_actor_id",
        severity: "error",
        messageZh: `角色 ID 重复：${a.actorId}`,
        actorId: a.actorId,
      });
    }
    actorIds.add(a.actorId);
  }

  for (const [actorId] of Object.entries(plan.initialStates)) {
    if (!actorIds.has(actorId)) {
      push({
        code: "dangling_actor_ref",
        severity: "error",
        messageZh: `初始状态里有不存在的角色：${actorId}`,
        actorId,
      });
    }
  }

  const shotIds = new Set<string>();
  const eventIds = new Set<string>();

  for (const shot of plan.shots) {
    if (shotIds.has(shot.shotId)) {
      push({
        code: "duplicate_shot_id",
        severity: "error",
        messageZh: `镜头 ID 重复：${shot.shotId}`,
        shotId: shot.shotId,
      });
    }
    shotIds.add(shot.shotId);

    // ── 时间映射自洽
    for (const ti of validateManhuaShotTimeMap(shot.timeMap)) {
      push({
        code: "timemap_invalid",
        severity: "error",
        messageZh: `第 ${shot.displayIndex} 镜时间映射：${ti.messageZh}`,
        shotId: shot.shotId,
      });
    }

    for (const change of shot.actorChanges) {
      if (!actorIds.has(change.actorId)) {
        push({
          code: "dangling_actor_ref",
          severity: "error",
          messageZh: `第 ${shot.displayIndex} 镜改到了不存在的角色：${change.actorId}`,
          shotId: shot.shotId,
          actorId: change.actorId,
        });
      }
    }

    // ── 全员快照（执行期硬拦缺项）
    const snapshot = compileManhuaShotSnapshot(plan, shot.shotId);
    if (snapshot) {
      /**
       * 校验的是**编译出来的有效状态**，不是 actorChanges。
       * 只看 change.next 会漏掉 initialStates 与继承结果——
       * 初始就写了 socket:"unknown" 的持物，执行期照样放行（0915 终审必修1）。
       */
      for (const actor of plan.actors) {
        const st = snapshot[actor.actorId]!;
        checkEffectiveActorState(actor.actorId, st, shot.shotId, shot.displayIndex);
        if (st.presence === "not_entered" && shot.events.some((e) => e.actorId === actor.actorId)) {
          push({
            code: "not_entered_with_action",
            severity: "error",
            messageZh: `第 ${shot.displayIndex} 镜「${actor.nameZh}」还没上场却有动作事件`,
            shotId: shot.shotId,
            actorId: actor.actorId,
          });
        }
        if (st.presence === "onstage" && !st.at) {
          push({
            code: "onstage_without_position",
            severity: gate(),
            messageZh: `第 ${shot.displayIndex} 镜「${actor.nameZh}」在画面里却没有位置`,
            shotId: shot.shotId,
            actorId: actor.actorId,
          });
        }
        if ((st.presence === "offstage" || st.presence === "exited") && !st.whereaboutsZh) {
          push({
            code: "offstage_without_whereabouts",
            severity: gate(),
            messageZh: `第 ${shot.displayIndex} 镜「${actor.nameZh}」不在画面里却没写去向——下一镜接不上`,
            shotId: shot.shotId,
            actorId: actor.actorId,
          });
        }
      }
    }

    // ── 事件
    for (const ev of shot.events) {
      if (eventIds.has(ev.eventId)) {
        push({
          code: "duplicate_event_id",
          severity: "error",
          messageZh: `动作事件 ID 重复：${ev.eventId}`,
          shotId: shot.shotId,
          eventId: ev.eventId,
        });
      }
      eventIds.add(ev.eventId);

      if (!actorIds.has(ev.actorId)) {
        push({
          code: "dangling_actor_ref",
          severity: "error",
          messageZh: `动作事件的发起角色不存在：${ev.actorId}`,
          shotId: shot.shotId,
          eventId: ev.eventId,
          actorId: ev.actorId,
        });
      }

      const related =
        ev.kind === "attack"
          ? ev.targetActorId
          : ev.kind === "evade"
            ? ev.threatActorId
            : ev.kind === "disengage"
              ? ev.fromActorId
              : ev.kind === "observe"
                ? ev.subjectActorId
                : undefined;
      if (related && !actorIds.has(related)) {
        push({
          code: "dangling_target_ref",
          severity: "error",
          messageZh: `动作事件指向一个不存在的角色：${related}`,
          shotId: shot.shotId,
          eventId: ev.eventId,
        });
      }
      if (related && related === ev.actorId) {
        push({
          code: "self_target",
          severity: "error",
          messageZh: `动作事件的发起方与对象是同一人`,
          shotId: shot.shotId,
          eventId: ev.eventId,
        });
      }

      // 展示名不是执行依据：有稳定 surfaceRef 就不该被这一层拦住。
      // 表面**身份**是否对得上，由 manhuaActionPlanBindings 对着解析上下文核，
      // 这里只管「这一层有没有写过表面」。
      /**
       * 交互双方都必须在场（0915 终审必修2）。
       * 旧实现只看发起者，攻击目标只要在 actors 表里就放行——
       * 于是可以攻击一个还没上场的人。
       *
       * 口径：
       *   not_entered / exited → 不能参与物理交互；
       *   offstage 仍可（画外交锋，去向合同另管），不强制所有人同框；
       *   observe 的对象不在场未必非法，不盲封；
       *   disengage 是「脱离接触」，语义上本来就可能对方已走，单独放过。
       */
      const snapshotForEvent = compileManhuaShotSnapshot(plan, shot.shotId);
      const parties: string[] =
        ev.kind === "attack"
          ? [ev.actorId, ev.targetActorId]
          : ev.kind === "evade"
            ? [ev.actorId, ev.threatActorId]
            : [];
      for (const id of parties) {
        const pst = snapshotForEvent?.[id];
        // 角色压根不存在仍走 dangling_*，不用「不可达」把测试蒙绿
        if (!pst) continue;
        if (pst.presence === "not_entered" || pst.presence === "exited") {
          push({
            code: "event_participant_unavailable",
            severity: "error",
            messageZh:
              `第 ${shot.displayIndex} 镜：交互角色 ${id} 当前` +
              `${pst.presence === "not_entered" ? "尚未入场" : "已离场"}，不能参与本次交锋`,
            shotId: shot.shotId,
            eventId: ev.eventId,
            actorId: id,
          });
        }
      }

      if (ev.kind === "land" && !ev.landing.surfaceRef && !ev.landing.surfaceZh) {
        push({
          code: "land_without_surface",
          severity: gate(),
          messageZh: `登船/落地事件没写落地表面（甲板/水面/地面）`,
          shotId: shot.shotId,
          eventId: ev.eventId,
        });
      }

      let prevEnd = -Infinity;
      for (const ph of ev.phases) {
        if (ph.sourceEndSec < ph.sourceStartSec) {
          push({
            code: "phase_out_of_order",
            severity: "error",
            messageZh: `阶段「${ph.kind}」结束早于开始`,
            shotId: shot.shotId,
            eventId: ev.eventId,
          });
        }
        if (ph.sourceStartSec < prevEnd) {
          push({
            code: "phase_out_of_order",
            severity: "error",
            messageZh: `阶段「${ph.kind}」与上一阶段重叠`,
            shotId: shot.shotId,
            eventId: ev.eventId,
          });
        }
        if (ph.sourceStartSec < 0 || ph.sourceEndSec > shot.timeMap.sourceDurationSec) {
          push({
            code: "phase_out_of_shot",
            severity: "error",
            messageZh: `阶段「${ph.kind}」超出本镜源时长 ${shot.timeMap.sourceDurationSec} 秒`,
            shotId: shot.shotId,
            eventId: ev.eventId,
          });
        }
        prevEnd = ph.sourceEndSec;
      }
    }
  }

  // ── 装箱范围
  const seenInRanges = new Set<string>();
  for (const range of plan.executionRanges) {
    for (const sid of range.shotIds) {
      if (!shotIds.has(sid)) {
        push({
          code: "execution_range_dangling_shot",
          severity: "error",
          messageZh: `执行段 ${range.executionSegmentId} 引用了不存在的镜头：${sid}`,
        });
      }
      if (seenInRanges.has(sid)) {
        push({
          code: "execution_range_duplicate_shot",
          severity: "error",
          messageZh: `镜头 ${sid} 被分到了多个执行段`,
          shotId: sid,
        });
      }
      seenInRanges.add(sid);
    }
  }

  // ── 版本与审批
  // 与 seal 共用同一个挑字段函数：两处各写一遍必然漂移
  const expected = manhuaActionPlanRevision(pickManhuaActionPlanDigestInput(plan));
  if (expected !== plan.planRevision) {
    push({
      code: "revision_mismatch",
      severity: "error",
      messageZh: `计划摘要与内容不符：内容算出 ${expected}，计划上写的是 ${plan.planRevision}`,
    });
  }
  if (plan.approval && plan.approval.approvedRevision !== plan.planRevision) {
    push({
      code: "approval_stale",
      severity: gate(),
      messageZh: `审批记录对应的是旧版本（${plan.approval.approvedRevision}），内容已变更，需重新确认`,
    });
  }

  return issues;
}

/** 解析 + 校验。失败不返回半个可用计划 */
export type ManhuaActionPlanParseResult =
  | { ok: true; plan: ManhuaActionPlan; warnings: ManhuaActionPlanIssue[] }
  | { ok: false; issues: ManhuaActionPlanIssue[] };

export function parseManhuaActionPlan(
  raw: unknown,
  mode: ManhuaActionPlanCheckMode = "draft",
): ManhuaActionPlanParseResult {
  const parsed = manhuaActionPlanSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: "dangling_actor_ref" as const,
        severity: "error" as const,
        messageZh: `计划结构不合法：${i.path.join(".") || "(根)"} ${i.message}`,
      })),
    };
  }
  const found = validateManhuaActionPlan(parsed.data, mode);
  const errors = found.filter((i) => i.severity === "error");
  if (errors.length) return { ok: false, issues: found };
  return { ok: true, plan: parsed.data, warnings: found };
}

/** 跨镜取某角色的关注对象变化，用于「对手切换是数据不是猜测」的验收 */
export function traceManhuaPlanFocus(
  plan: ManhuaActionPlan,
  actorId: string,
): Array<{ shotId: string; displayIndex: number; focusActorId: string | null }> {
  return plan.shots.map((shot) => {
    const snap = compileManhuaShotSnapshot(plan, shot.shotId);
    return {
      shotId: shot.shotId,
      displayIndex: shot.displayIndex,
      focusActorId: snap?.[actorId]?.focusActorId ?? null,
    };
  });
}
