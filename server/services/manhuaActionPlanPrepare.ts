/**
 * 动作计划执行准备（PR-2 服务端）：
 *   schema → 版本/审批核对 → 全员快照 → 绑定证据（execution 口径）→ 能力上限拆镜 → 音频范围 → 统一执行包。
 *
 * 老实口径：
 *   - `approvalCurrent` 只是一个事实字段，**不是**总执行门禁（0915 复审点名）；能不能执行由
 *     bindings execution 口径 + 拆镜器 issues 决定。
 *   - 每一层失败都带 stage 与原始 issues 回去，不把空数组当绿灯。
 *   - 相机/落点/角色共用**源时间**；呈现时间只经镜头 timeMap 换算，不另存第四份时间。
 *   - 音频范围按呈现时间核（观众听到的那条轴），超出镜头呈现时长即拦，不悄悄让音频漂移。
 *
 * 纯函数、无 IO；调用方（任务入口）负责取 plan 与上下文。
 */
import {
  compileManhuaShotSnapshot,
  isManhuaPlanApprovalCurrent,
  parseManhuaActionPlan,
  type ManhuaActionEvent,
  type ManhuaActionPlan,
  type ManhuaActionPlanIssue,
  type ManhuaCameraBinding,
  type ManhuaPlanActorState,
} from "@shared/manhuaActionPlan";
import {
  hasBlockingManhuaBindingIssues,
  manhuaActionPlanBindingContextSchema,
  validateManhuaActionPlanBindings,
  type ManhuaActionPlanBindingContext,
  type ManhuaBindingIssue,
  type ManhuaResolvedCameraSource,
  type ManhuaResolvedLanding,
} from "@shared/manhuaActionPlanBindings";
import {
  defaultManhuaPrevisCapability,
  splitManhuaActionPlanForPrevis,
  type ManhuaExecutableShot,
  type ManhuaPrevisCapability,
  type ManhuaSplitIssue,
} from "@shared/manhuaActionPlanSplit";
import { manhuaPresentationDurationSec, type ManhuaShotTimeMap } from "@shared/manhuaActionPlanTiming";

/** 音频线索：对白/音效/BGM 逐句锁秒；basis 固定呈现时间（观众听到的轴） */
export type ManhuaAudioCue = {
  cueId: string;
  shotId: string;
  kind: "dialogue" | "sfx" | "bgm";
  startSec: number;
  endSec: number;
};

export type ManhuaAudioRangeIssue = {
  code: "audio_cue_out_of_shot" | "audio_cue_shot_missing" | "audio_cue_invalid_range";
  cueId: string;
  shotId: string;
  messageZh: string;
};

export type ManhuaPreparedShot = {
  executableShotId: string;
  sourceShotId: string;
  kind: ManhuaExecutableShot["kind"];
  /** 源时间区间；相机/事件/效果都跟它 */
  sourceSpan: { startSec: number; endSec: number };
  timeMap: ManhuaShotTimeMap;
  /** 整镜呈现时长（由 timeMap 算出，不另存） */
  presentationDurationSec: number;
  /** 全员快照：画外的人也在，去向可追 */
  actors: Record<string, ManhuaPlanActorState>;
  onstageActorIds: string[];
  offstage: ManhuaExecutableShot["offstage"];
  events: ManhuaActionEvent[];
  /** 计划声明的相机绑定 + 上下文里对应的已解析来源（都可能缺，缺就是缺） */
  camera?: ManhuaCameraBinding;
  resolvedCamera?: ManhuaResolvedCameraSource;
  /** 本镜事件引用到的落点解析结果 */
  landings: ManhuaResolvedLanding[];
};

export type ManhuaPreparedActionExecution = {
  actionPlanId: string;
  episodeIndex: number;
  planRevision: string;
  /** 绑定上下文摘要：落点/相机来源任何一处变了，这个值就变 */
  bindingRevision: string;
  approvalCurrent: boolean;
  capability: ManhuaPrevisCapability;
  shots: ManhuaPreparedShot[];
  /** 非阻断提示（draft 级 warning、拆镜提示） */
  warningsZh: string[];
};

export type ManhuaPrepareStage = "schema" | "plan" | "bindings" | "capability" | "audio";

export type ManhuaPrepareFailure = {
  ok: false;
  stage: ManhuaPrepareStage;
  planIssues: ManhuaActionPlanIssue[];
  bindingIssues: ManhuaBindingIssue[];
  splitIssues: ManhuaSplitIssue[];
  audioIssues: ManhuaAudioRangeIssue[];
  messageZh: string;
};

export type ManhuaPrepareResult = { ok: true; execution: ManhuaPreparedActionExecution } | ManhuaPrepareFailure;

function fnv1a32(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 绑定上下文摘要：键序无关，落点/相机变一处就变 */
export function manhuaBindingRevision(context: ManhuaActionPlanBindingContext): string {
  const text = stableJson(context);
  const a = fnv1a32(text, 0x811c9dc5).toString(16).padStart(8, "0");
  const b = fnv1a32(`${text}#b`, 0x9747b28c).toString(16).padStart(8, "0");
  return `abr1_${a}${b}`;
}

export function checkManhuaAudioRanges(plan: ManhuaActionPlan, cues: ManhuaAudioCue[]): ManhuaAudioRangeIssue[] {
  const issues: ManhuaAudioRangeIssue[] = [];
  const byShot = new Map(plan.shots.map((s) => [s.shotId, s] as const));
  for (const cue of cues) {
    const shot = byShot.get(cue.shotId);
    if (!shot) {
      issues.push({
        code: "audio_cue_shot_missing",
        cueId: cue.cueId,
        shotId: cue.shotId,
        messageZh: `音频 ${cue.cueId} 指向不存在的镜头 ${cue.shotId}`,
      });
      continue;
    }
    const finite = Number.isFinite(cue.startSec) && Number.isFinite(cue.endSec);
    if (!finite || cue.startSec < 0 || cue.endSec <= cue.startSec) {
      issues.push({
        code: "audio_cue_invalid_range",
        cueId: cue.cueId,
        shotId: cue.shotId,
        messageZh: `音频 ${cue.cueId} 的区间 ${cue.startSec}~${cue.endSec}s 不合法`,
      });
      continue;
    }
    const presentation = manhuaPresentationDurationSec(shot.timeMap);
    if (cue.endSec > presentation + 1e-6) {
      issues.push({
        code: "audio_cue_out_of_shot",
        cueId: cue.cueId,
        shotId: cue.shotId,
        messageZh:
          `音频 ${cue.cueId}（${cue.kind}）结束于 ${cue.endSec.toFixed(2)}s，` +
          `超过镜头 ${cue.shotId} 呈现时长 ${presentation.toFixed(2)}s；时间映射改了就要重锁秒，不能让它漂`,
      });
    }
  }
  return issues;
}

const eventLandingIds = (events: ManhuaActionEvent[]): string[] => {
  const ids: string[] = [];
  for (const e of events) {
    const landing = (e as { landing?: { landingId?: string } }).landing;
    if (landing?.landingId) ids.push(landing.landingId);
  }
  return ids;
};

export function prepareManhuaActionExecution(input: {
  plan: unknown;
  context: unknown;
  capability?: ManhuaPrevisCapability;
  audioCues?: ManhuaAudioCue[];
}): ManhuaPrepareResult {
  const fail = (
    stage: ManhuaPrepareStage,
    messageZh: string,
    parts: Partial<Pick<ManhuaPrepareFailure, "planIssues" | "bindingIssues" | "splitIssues" | "audioIssues">> = {},
  ): ManhuaPrepareFailure => ({
    ok: false,
    stage,
    planIssues: parts.planIssues ?? [],
    bindingIssues: parts.bindingIssues ?? [],
    splitIssues: parts.splitIssues ?? [],
    audioIssues: parts.audioIssues ?? [],
    messageZh,
  });

  // 1. schema + 计划执行口径
  const parsed = parseManhuaActionPlan(input.plan, "execution");
  if (!parsed.ok) {
    const structural = parsed.issues.some((i) => i.messageZh.startsWith("计划结构不合法"));
    return fail(structural ? "schema" : "plan", "动作计划未达执行口径", { planIssues: parsed.issues });
  }
  const plan = parsed.plan;
  const warningsZh = parsed.warnings.map((w) => w.messageZh);

  // 1b. 与时间轴 readiness（manhuaActionPlanEditor.summarizeManhuaActionPlanReadiness）同口径：
  //     未确认镜头 / 空镜头在客户端会 executionBlocked，服务端不能比它松——
  //     否则「确认所见 = 实际提交」只在 UI 成立（1466 R1）。
  const gateIssues: ManhuaActionPlanIssue[] = [];
  for (const shot of plan.shots) {
    if (shot.confirm !== "confirmed") {
      gateIssues.push({ code: "shot_not_confirmed", severity: "error", shotId: shot.shotId, messageZh: `镜头 ${shot.shotId} 尚未确认，不能执行` });
    }
    if (!shot.events.length) {
      const snapshot = compileManhuaShotSnapshot(plan, shot.shotId) ?? {};
      if (!Object.values(snapshot).some((st) => st.presence === "onstage")) {
        gateIssues.push({ code: "shot_empty", severity: "error", shotId: shot.shotId, messageZh: `镜头 ${shot.shotId} 没有事件也没人在场，不能交白模` });
      }
    }
  }
  if (gateIssues.length) {
    return fail("plan", "有镜头未确认或为空，不能执行", { planIssues: gateIssues });
  }

  // 2. 绑定上下文形状
  const ctxParsed = manhuaActionPlanBindingContextSchema.safeParse(input.context);
  if (!ctxParsed.success) {
    const detail = ctxParsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("；");
    return fail("bindings", `绑定上下文结构不合法：${detail}`);
  }
  const context = ctxParsed.data;

  // 3. 绑定证据（execution：二维点、缺相机证据一律拦）
  const bindingIssues = validateManhuaActionPlanBindings(plan, context, "execution");
  if (hasBlockingManhuaBindingIssues(bindingIssues)) {
    return fail("bindings", "落点/相机证据不足，不能执行", { bindingIssues });
  }
  warningsZh.push(...bindingIssues.map((i) => i.messageZh));

  // 4. 能力上限拆镜（白模：出水 ≤3 人/8 秒独占、预算 24fps×人×秒）
  const capability = input.capability ?? defaultManhuaPrevisCapability();
  const split = splitManhuaActionPlanForPrevis(plan, capability);
  if (split.issues.length) {
    return fail("capability", "镜头超出白模能力上限，且无法在不丢人的前提下拆开", { splitIssues: split.issues });
  }

  // 5. 音频范围
  const audioIssues = checkManhuaAudioRanges(plan, input.audioCues ?? []);
  if (audioIssues.length) {
    return fail("audio", "对白/音效超出镜头呈现时长", { audioIssues });
  }

  // 6. 执行包
  const landingById = new Map(context.landings.map((l) => [l.landingId, l] as const));
  const cameraByKey = new Map(context.cameras.map((c) => [`${c.source} ${c.sourceShotRef}`, c] as const));
  const shots: ManhuaPreparedShot[] = [];
  for (const ex of split.shots) {
    const planShot = plan.shots.find((s) => s.shotId === ex.sourceShotId);
    const actors = compileManhuaShotSnapshot(plan, ex.sourceShotId);
    if (!planShot || !actors) {
      return fail("plan", `镜头 ${ex.sourceShotId} 快照不可用`, {
        planIssues: [
          {
            code: "dangling_actor_ref",
            severity: "error",
            messageZh: `镜头 ${ex.sourceShotId} 不在计划中`,
            shotId: ex.sourceShotId,
          } as ManhuaActionPlanIssue,
        ],
      });
    }
    const camera = planShot.camera;
    const resolvedCamera = camera ? cameraByKey.get(`${camera.source} ${camera.sourceShotRef}`) : undefined;
    const landings = eventLandingIds(ex.events)
      .map((id) => landingById.get(id))
      .filter((l): l is ManhuaResolvedLanding => Boolean(l));
    shots.push({
      executableShotId: ex.executableShotId,
      sourceShotId: ex.sourceShotId,
      kind: ex.kind,
      sourceSpan: ex.sourceSpan,
      timeMap: ex.timeMap,
      presentationDurationSec: manhuaPresentationDurationSec(ex.timeMap),
      actors,
      onstageActorIds: ex.onstageActorIds,
      offstage: ex.offstage,
      events: ex.events,
      ...(camera ? { camera } : {}),
      ...(resolvedCamera ? { resolvedCamera } : {}),
      landings,
    });
  }

  return {
    ok: true,
    execution: {
      actionPlanId: plan.actionPlanId,
      episodeIndex: plan.episodeIndex,
      planRevision: plan.planRevision,
      bindingRevision: manhuaBindingRevision(context),
      approvalCurrent: isManhuaPlanApprovalCurrent(plan),
      capability,
      shots,
      warningsZh,
    },
  };
}
