/**
 * 漫剧动作计划：一镜之内「谁、对谁、什么时候、打到哪」的**唯一权威状态**。
 *
 * 为什么要立这个模块（0915 施工方案 A）：
 * 现在同一件事散在三套互不相通的身份体系里——
 *   1. `shared/manhuaShotIR.ts`：镜头靠数组下标 `index` 当身份，无稳定 ID、无版本；
 *      台词的说话人只有中文名字符串（`ShotDialogue.speakerZh`）。
 *   2. `shared/manhuaDirectorBoardOverlay.ts`：有稳定 ID（routeId/entityId/landingId）
 *      与 `sourceRevision` 版本，但只描述画面上的线，不描述「谁打谁、打中没有」。
 *   3. `shared/manhuaPrevis.ts`：白模 spec 自带 actorId/interaction id，
 *      与资产 canon 之间只有一个弱引用 `assetRef?: string`，改名换人就断。
 * 三份副本可以各自被改，于是导演板改了目标、白模还按旧的打、提示词写第三种说法。
 *
 * 本模块只做一件事：**把身份和时间收成一份，别人从这里读**。
 * 它自己不渲染、不出站、不调用任何供应商，是纯数据 + 纯校验。
 *
 * 明确不做的事：
 * - 不替代白模能力限制。出水最多 3 人 8 秒、禁叠双人接触/持械/带骨，
 *   持剑只支持待机与格挡——这些仍在 `shared/manhuaPrevis.ts` 的 superRefine 里，
 *   本模块的适配器只负责**提前把不可能的组合说清楚**，不删限制冒充支持。
 * - 不宣称四人带骨船战可渲染。跨镜共享身份 ≠ 单镜能力扩展。
 */

import { z } from "zod";

/** 当前计划格式版本；破坏性改动必须升版并写迁移，不许原地改语义 */
export const MANHUA_ACTION_PLAN_FORMAT = "mv-manhua-action-plan-v1" as const;

/** 24fps 是全链既有契约（render-manhua-previs.py / overlay / previs 均按此对齐） */
export const MANHUA_ACTION_PLAN_FPS = 24 as const;

/**
 * 在场状态。**画外不等于删除**——伏兵甲被打下船不在画面里，
 * 但他还在这场戏里、下一镜可能回来；离场才是真的走了。
 * 少了这个区分，模型会在下一镜自行决定把人变没或凭空变回来。
 */
export const manhuaActorPresenceSchema = z.enum([
  /** 在画面里 */
  "onstage",
  /** 在这场戏里但此镜不入画（去向必须写在 whereaboutsZh） */
  "offstage",
  /** 已离开这场戏（死亡/撤退/被带走） */
  "exited",
]);
export type ManhuaActorPresence = z.infer<typeof manhuaActorPresenceSchema>;

/**
 * 编排确认态。**旧草稿没有的数据不能默认补成已审通过**——
 * 那等于把「没人看过」伪装成「已确认」，是同一类假成功。
 */
export const manhuaPlanConfirmSchema = z.enum([
  /** 还没编排过：不是「没问题」，是「没人写」 */
  "unplanned",
  /** 编排了但没人确认 */
  "draft",
  /** 人工确认过 */
  "confirmed",
]);
export type ManhuaPlanConfirm = z.infer<typeof manhuaPlanConfirmSchema>;

/** 动作阶段。与 B 批的节奏编辑 UI 同名，避免两处各叫各的 */
export const manhuaActionPhaseKindSchema = z.enum([
  /** 起手 */
  "windup",
  /** 爆发 */
  "burst",
  /** 接触 */
  "contact",
  /** 卸力 */
  "recover",
  /** 反击 */
  "counter",
]);
export type ManhuaActionPhaseKind = z.infer<typeof manhuaActionPhaseKindSchema>;

/** 动作结果。「打到没有」必须是数据，不是让模型看提示词自由发挥 */
export const manhuaActionOutcomeSchema = z.enum([
  /** 命中 */
  "hit",
  /** 被格挡 */
  "blocked",
  /** 被闪避 */
  "evaded",
  /** 尚未编排结果 */
  "unplanned",
]);
export type ManhuaActionOutcome = z.infer<typeof manhuaActionOutcomeSchema>;

/** 归一化画面坐标，与导演板 overlay 同口径（左上 0,0 右下 1,1） */
export const manhuaPlanPointSchema = z
  .object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) })
  .strict();
export type ManhuaPlanPoint = z.infer<typeof manhuaPlanPointSchema>;

const idSchema = z.string().trim().min(1).max(120);

/**
 * 角色档案：一场戏里的稳定身份。
 * `canonAnchorId` 指向 `shared/manhuaWriterAssetCanon.ts` 的 `wa_char_*`；
 * 有它才能让导演板 entityId、白模 assetRef、提示词人名三边对上同一个人。
 */
export const manhuaPlanActorSchema = z
  .object({
    /** 场内稳定 ID（ap_actor_*），改名不变 */
    actorId: idSchema,
    nameZh: z.string().trim().min(1).max(80),
    /** 资产 canon 锚点 wa_char_*；没有则此人未入资产表，白模只能按描述走 */
    canonAnchorId: idSchema.optional(),
  })
  .strict();
export type ManhuaPlanActor = z.infer<typeof manhuaPlanActorSchema>;

/**
 * 逐镜角色状态。四个人每镜都要有一条，**即使画外**——
 * 「另两人现在在哪」不写下来，下一镜就没法接。
 */
export const manhuaPlanActorStateSchema = z
  .object({
    actorId: idSchema,
    presence: manhuaActorPresenceSchema,
    /** 画面位置；画外/离场时允许缺省 */
    at: manhuaPlanPointSchema.optional(),
    /** 朝向角度（度，±180，与 previsActorSchema.facingDeg 同口径） */
    facingDeg: z.number().finite().min(-180).max(180).optional(),
    /** 手持道具的 canon 锚点 wa_prop_* */
    heldPropIds: z.array(idSchema).max(8).default([]),
    /** 此镜的动作目标（另一个 actorId）；无目标则缺省 */
    targetActorId: idSchema.optional(),
    /** 画外/离场时的去向，一句中文。presence 非 onstage 时必填 */
    whereaboutsZh: z.string().trim().max(200).optional(),
  })
  .strict();
export type ManhuaPlanActorState = z.infer<typeof manhuaPlanActorStateSchema>;

/** 动作阶段区间。镜头本地时间（秒），不是全片时间 */
export const manhuaActionPhaseSchema = z
  .object({
    kind: manhuaActionPhaseKindSchema,
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().min(0),
  })
  .strict();
export type ManhuaActionPhase = z.infer<typeof manhuaActionPhaseSchema>;

/**
 * 动作事件：谁对谁、分几个阶段、打到哪、结果如何。
 * 目标切换是一个事件，不是让模型自行猜测——伏兵登船后
 * 男→甲、女→乙这种换对手，必须是两条带明确 targetActorId 的事件。
 */
export const manhuaActionEventSchema = z
  .object({
    /** 事件稳定 ID（ap_evt_*） */
    eventId: idSchema,
    /** 攻击方 */
    actorId: idSchema,
    /** 承受方；单人动作（如登船）允许缺省 */
    targetActorId: idSchema.optional(),
    /** 阶段序列，按时间递增；至少一段 */
    phases: z.array(manhuaActionPhaseSchema).min(1).max(12),
    /** 接触/落点的画面位置 */
    contactAt: manhuaPlanPointSchema.optional(),
    /**
     * 引用导演板 overlay 的 landingId。
     * 有它才能让「白模里打到的那个点」和「导演板上画的那个点」是同一个点。
     */
    landingRefId: idSchema.optional(),
    outcome: manhuaActionOutcomeSchema.default("unplanned"),
    /** 慢动作区间（镜头本地秒）；默认常速，慢动作只作用选定区间 */
    slowMotion: z
      .object({
        startSec: z.number().finite().min(0),
        endSec: z.number().finite().min(0),
        /** 播放速率倍数，0.1–1；1 等于常速 */
        rate: z.number().finite().min(0.1).max(1),
      })
      .strict()
      .optional(),
    noteZh: z.string().trim().max(400).optional(),
  })
  .strict();
export type ManhuaActionEvent = z.infer<typeof manhuaActionEventSchema>;

/**
 * 一个镜头的权威状态。
 *
 * **场次权威状态与模型执行片段分开**：这里描述「这一镜戏里发生什么」，
 * 一个执行片段（送给供应商的那一次生成）可能含多镜，
 * 一个镜头也可能因供应商最小生成单位被迫拆开。
 * 所以这里存镜头本地时间 + 段内偏移，两者都留。
 */
export const manhuaPlanShotSchema = z
  .object({
    /** 镜头稳定 ID（ap_shot_*）。**不用数组下标当身份** */
    shotId: idSchema,
    /** 供人看的序号；只用于显示与排序，改序不改身份 */
    displayIndex: z.number().int().positive(),
    /** 镜头时长（秒） */
    durationSec: z.number().finite().positive().max(30),
    /** 本镜在所属执行片段内的起始偏移（秒）。摄影机与角色共用镜头本地时间 */
    segmentOffsetSec: z.number().finite().min(0).default(0),
    /** 所属执行片段 ID；未装箱时缺省 */
    executionSegmentId: idSchema.optional(),
    confirm: manhuaPlanConfirmSchema.default("unplanned"),
    actorStates: z.array(manhuaPlanActorStateSchema).max(12).default([]),
    events: z.array(manhuaActionEventSchema).max(24).default([]),
  })
  .strict();
export type ManhuaPlanShot = z.infer<typeof manhuaPlanShotSchema>;

/**
 * 场次动作计划。一场戏（scene）的全部镜头与角色。
 *
 * `planRevision` 与导演板 overlay 的 `sourceRevision` 是同一类东西：
 * 内容指纹，用来判断「白模/提示词/出站请求是不是按这一版算的」。
 * 它由 `manhuaActionPlanRevision()` 从内容算出，不手填。
 */
export const manhuaActionPlanSchema = z
  .object({
    format: z.literal(MANHUA_ACTION_PLAN_FORMAT),
    /** 场次稳定 ID（ap_scene_*） */
    sceneId: idSchema,
    episodeIndex: z.number().int().positive(),
    /** 内容指纹；消费方存下它即可追溯「按哪一版算的」 */
    planRevision: z.string().trim().min(1).max(160),
    actors: z.array(manhuaPlanActorSchema).min(1).max(12),
    shots: z.array(manhuaPlanShotSchema).min(1).max(120),
  })
  .strict();
export type ManhuaActionPlan = z.infer<typeof manhuaActionPlanSchema>;

/** 稳定指纹：与 overlay 的 stableRevision 同法，内容变则变 */
export function manhuaActionPlanRevision(
  input: Pick<ManhuaActionPlan, "sceneId" | "episodeIndex" | "actors" | "shots">,
): string {
  const canonical = JSON.stringify({
    sceneId: input.sceneId,
    episodeIndex: input.episodeIndex,
    actors: [...input.actors].sort((a, b) => a.actorId.localeCompare(b.actorId)),
    shots: [...input.shots].sort((a, b) => a.shotId.localeCompare(b.shotId)),
  });
  let h = 0;
  for (let i = 0; i < canonical.length; i += 1) h = (h * 33 + canonical.charCodeAt(i)) >>> 0;
  return `apr_${h.toString(36)}_${canonical.length.toString(36)}`;
}

/** 校验失败原因。**有 code 才能测「拒对了没有」**，只给中文串没法断言 */
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
  | "phase_out_of_order"
  | "phase_out_of_shot"
  | "slow_motion_out_of_shot"
  | "revision_mismatch";

export type ManhuaActionPlanIssue = {
  code: ManhuaActionPlanIssueCode;
  messageZh: string;
  /** 定位用：哪个镜头/事件/角色出的问题 */
  shotId?: string;
  eventId?: string;
  actorId?: string;
};

/**
 * 全量校验。**只报问题不改数据**——静默修复等于把错藏起来。
 *
 * 覆盖方案第一批验收点名的三类拒绝：悬空目标 ID、重复 ID、非法时间。
 */
export function validateManhuaActionPlan(plan: ManhuaActionPlan): ManhuaActionPlanIssue[] {
  const issues: ManhuaActionPlanIssue[] = [];
  const push = (i: ManhuaActionPlanIssue) => issues.push(i);

  // ── 身份唯一性
  const actorIds = new Set<string>();
  for (const a of plan.actors) {
    if (actorIds.has(a.actorId)) {
      push({
        code: "duplicate_actor_id",
        messageZh: `角色 ID 重复：${a.actorId}`,
        actorId: a.actorId,
      });
    }
    actorIds.add(a.actorId);
  }

  const shotIds = new Set<string>();
  const eventIds = new Set<string>();
  for (const shot of plan.shots) {
    if (shotIds.has(shot.shotId)) {
      push({ code: "duplicate_shot_id", messageZh: `镜头 ID 重复：${shot.shotId}`, shotId: shot.shotId });
    }
    shotIds.add(shot.shotId);

    // ── 每镜必须给出全部角色的状态（画外也要有）
    const stated = new Set(shot.actorStates.map((s) => s.actorId));
    for (const a of plan.actors) {
      if (!stated.has(a.actorId)) {
        push({
          code: "missing_actor_state",
          messageZh: `第 ${shot.displayIndex} 镜缺少「${a.nameZh}」的状态：画外也要写去向，不能当他不存在`,
          shotId: shot.shotId,
          actorId: a.actorId,
        });
      }
    }

    for (const st of shot.actorStates) {
      if (!actorIds.has(st.actorId)) {
        push({
          code: "dangling_actor_ref",
          messageZh: `第 ${shot.displayIndex} 镜引用了不存在的角色：${st.actorId}`,
          shotId: shot.shotId,
          actorId: st.actorId,
        });
      }
      if (st.targetActorId && !actorIds.has(st.targetActorId)) {
        push({
          code: "dangling_target_ref",
          messageZh: `第 ${shot.displayIndex} 镜的目标角色不存在：${st.targetActorId}`,
          shotId: shot.shotId,
          actorId: st.actorId,
        });
      }
      if (st.targetActorId && st.targetActorId === st.actorId) {
        push({
          code: "self_target",
          messageZh: `第 ${shot.displayIndex} 镜的角色把自己当成目标`,
          shotId: shot.shotId,
          actorId: st.actorId,
        });
      }
      if (st.presence !== "onstage" && !st.whereaboutsZh) {
        push({
          code: "offstage_without_whereabouts",
          messageZh: `第 ${shot.displayIndex} 镜有人不在画面里却没写去向——下一镜接不上`,
          shotId: shot.shotId,
          actorId: st.actorId,
        });
      }
      if (st.presence === "onstage" && !st.at) {
        push({
          code: "onstage_without_position",
          messageZh: `第 ${shot.displayIndex} 镜有人在画面里却没有位置`,
          shotId: shot.shotId,
          actorId: st.actorId,
        });
      }
    }

    // ── 事件：身份、目标、时间
    for (const ev of shot.events) {
      if (eventIds.has(ev.eventId)) {
        push({
          code: "duplicate_event_id",
          messageZh: `动作事件 ID 重复：${ev.eventId}`,
          shotId: shot.shotId,
          eventId: ev.eventId,
        });
      }
      eventIds.add(ev.eventId);

      if (!actorIds.has(ev.actorId)) {
        push({
          code: "dangling_actor_ref",
          messageZh: `动作事件的发起角色不存在：${ev.actorId}`,
          shotId: shot.shotId,
          eventId: ev.eventId,
          actorId: ev.actorId,
        });
      }
      if (ev.targetActorId && !actorIds.has(ev.targetActorId)) {
        push({
          code: "dangling_target_ref",
          messageZh: `动作事件打向一个不存在的角色：${ev.targetActorId}`,
          shotId: shot.shotId,
          eventId: ev.eventId,
        });
      }
      if (ev.targetActorId && ev.targetActorId === ev.actorId) {
        push({
          code: "self_target",
          messageZh: `动作事件的攻击者与目标是同一人`,
          shotId: shot.shotId,
          eventId: ev.eventId,
        });
      }

      let prevEnd = -Infinity;
      for (const ph of ev.phases) {
        if (ph.endSec < ph.startSec) {
          push({
            code: "phase_out_of_order",
            messageZh: `阶段「${ph.kind}」结束早于开始`,
            shotId: shot.shotId,
            eventId: ev.eventId,
          });
        }
        if (ph.startSec < prevEnd) {
          push({
            code: "phase_out_of_order",
            messageZh: `阶段「${ph.kind}」与上一阶段重叠`,
            shotId: shot.shotId,
            eventId: ev.eventId,
          });
        }
        if (ph.startSec < 0 || ph.endSec > shot.durationSec) {
          push({
            code: "phase_out_of_shot",
            messageZh: `阶段「${ph.kind}」超出本镜 ${shot.durationSec} 秒的范围`,
            shotId: shot.shotId,
            eventId: ev.eventId,
          });
        }
        prevEnd = ph.endSec;
      }

      if (ev.slowMotion) {
        const sm = ev.slowMotion;
        if (sm.endSec <= sm.startSec || sm.startSec < 0 || sm.endSec > shot.durationSec) {
          push({
            code: "slow_motion_out_of_shot",
            messageZh: `慢动作区间超出本镜范围或首尾颠倒`,
            shotId: shot.shotId,
            eventId: ev.eventId,
          });
        }
      }
    }
  }

  // ── 指纹一致性：内容改了却带着旧 revision，消费方会以为还是那一版
  const expected = manhuaActionPlanRevision(plan);
  if (expected !== plan.planRevision) {
    push({
      code: "revision_mismatch",
      messageZh: `计划版本号与内容不符：内容算出 ${expected}，计划上写的是 ${plan.planRevision}`,
    });
  }

  return issues;
}

/** 解析 + 校验一步到位。失败给 issues，**不返回半个可用计划** */
export type ManhuaActionPlanParseResult =
  | { ok: true; plan: ManhuaActionPlan }
  | { ok: false; issues: ManhuaActionPlanIssue[] };

export function parseManhuaActionPlan(raw: unknown): ManhuaActionPlanParseResult {
  const parsed = manhuaActionPlanSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: "dangling_actor_ref" as const,
        messageZh: `计划结构不合法：${i.path.join(".") || "(根)"} ${i.message}`,
      })),
    };
  }
  const issues = validateManhuaActionPlan(parsed.data);
  if (issues.length) return { ok: false, issues };
  return { ok: true, plan: parsed.data };
}

/** 按内容重算指纹后返回新计划——改完内容必须过这一道，否则版本对不上 */
export function sealManhuaActionPlan(
  input: Omit<ManhuaActionPlan, "format" | "planRevision">,
): ManhuaActionPlan {
  return {
    format: MANHUA_ACTION_PLAN_FORMAT,
    ...input,
    planRevision: manhuaActionPlanRevision(input),
  };
}

/** 取某镜某角色的状态；查不到返回 null（不造默认值冒充「在场」） */
export function findManhuaPlanActorState(
  shot: ManhuaPlanShot,
  actorId: string,
): ManhuaPlanActorState | null {
  return shot.actorStates.find((s) => s.actorId === actorId) ?? null;
}

/**
 * 跨镜取某角色的目标变化序列，用于「对手切换是事件不是猜测」的验收。
 * 返回按镜头顺序的 { shotId, targetActorId | null }。
 */
export function traceManhuaPlanTargets(
  plan: ManhuaActionPlan,
  actorId: string,
): Array<{ shotId: string; displayIndex: number; targetActorId: string | null }> {
  return plan.shots.map((shot) => ({
    shotId: shot.shotId,
    displayIndex: shot.displayIndex,
    targetActorId: findManhuaPlanActorState(shot, actorId)?.targetActorId ?? null,
  }));
}
