/**
 * 3D 片场视角图「采用到哪一镜」（0916）。
 *
 * 导出视角图时已把来源写进 `ref.stageFrame`（世界任务号/world_id/场景图版本/机位/演员/集段）。
 * 但「存了来源」不等于「采用到某一镜」——Codex 终审原话。这一份补的就是采用这一段：
 *   1. 采用关系：把视角图钉到具体 shotId（`ap_shot_e{集}_s{段}_t{序}`，稳定身份，重排不变）
 *   2. 失效判定：世界、演员、集段与本镜当前状态不一致 → 标过期，出站前拒绝，不静默用旧图
 *   3. 同源消费：出站时按 shotId 取采用图，不靠中文标签猜
 *
 * 纯函数，无 DOM 无网络；UI、存稿回读与出站清单共用这一份口径。
 */
import type { ManhuaStageFrameBinding } from "./manhuaWorld3d.js";

/** 一次采用：把某张视角图钉到某一镜 */
export type ManhuaStageFrameAdoption = {
  /** 稳定镜头身份；与 manhuaActionPlan 的 shotId 同一口径 */
  shotId: string;
  adoptedAt: number;
};

export const MANHUA_STAGE_FRAME_ADOPTION_MAX = 8;

export function normalizeManhuaStageFrameAdoptions(raw: unknown): ManhuaStageFrameAdoption[] {
  if (!Array.isArray(raw)) return [];
  const out: ManhuaStageFrameAdoption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const shotId = String((item as { shotId?: unknown })?.shotId || "").trim().slice(0, 120);
    if (!shotId || seen.has(shotId)) continue;
    seen.add(shotId);
    const at = Number((item as { adoptedAt?: unknown })?.adoptedAt);
    out.push({ shotId, adoptedAt: Number.isFinite(at) ? at : 0 });
    if (out.length >= MANHUA_STAGE_FRAME_ADOPTION_MAX) break;
  }
  return out;
}

/** 本镜当前状态：采用是否仍然有效，按这份上下文判 */
export type ManhuaShotStageContext = {
  shotId: string;
  episode?: number;
  segmentIndex?: number;
  /** 本镜当前预期演员（人物 ref.id），顺序无关 */
  actorIds?: readonly string[];
  /**
   * 场景图版本 → 该场景**当前**的世界任务号。
   * 不能只传「本段的世界任务号」：一部剧有多个场景，取错一个就会把好图判成失效、或把旧图放过去。
   * 这里按导出时记下的 worldSourceVersion 反查同一张场景图现在的世界，才是精确比较。
   */
  currentWorldTaskIdBySourceVersion?: Readonly<Record<string, string>>;
};

export type ManhuaStageFrameStaleCode = "world_changed" | "actors_changed" | "shot_moved";

export type ManhuaStageFrameAdoptionState = {
  adopted: boolean;
  /** 采用且未失效才可进出站 */
  usable: boolean;
  staleCode?: ManhuaStageFrameStaleCode;
  reasonZh?: string;
};

type StageFrameRefLike = {
  id: string;
  url?: string;
  labelZh?: string;
  stageFrame?: ManhuaStageFrameBinding;
  stageFrameAdoptions?: ManhuaStageFrameAdoption[];
};

function sameActorSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((v, i) => v === right[i]);
}

/**
 * 判一张图对某一镜的采用状态。
 * 没绑定或没采用 → adopted=false；采用了但世界/演员/集段对不上 → usable=false 并给中文原因。
 */
export function evaluateManhuaStageFrameAdoption(ref: StageFrameRefLike, ctx: ManhuaShotStageContext): ManhuaStageFrameAdoptionState {
  const binding = ref.stageFrame;
  const adopted = (ref.stageFrameAdoptions || []).some((a) => a.shotId === ctx.shotId);
  if (!binding || !adopted) return { adopted: false, usable: false };
  const worldMap = ctx.currentWorldTaskIdBySourceVersion;
  if (worldMap) {
    const current = worldMap[binding.worldSourceVersion];
    if (!current) {
      return { adopted: true, usable: false, staleCode: "world_changed", reasonZh: "这张视角图所属的场景参考图已换版本或已不在资产里，请在当前场景的世界里重新导出" };
    }
    if (current !== binding.worldTaskId) {
      return { adopted: true, usable: false, staleCode: "world_changed", reasonZh: "这个场景的 3D 世界已经重建过，这张视角图是旧世界导出的，请重新导出" };
    }
  }
  if (ctx.actorIds && !sameActorSet(binding.actorIds, ctx.actorIds)) {
    return { adopted: true, usable: false, staleCode: "actors_changed", reasonZh: "本镜的人物名单已变化，这张视角图里的人物与当前不一致，请重新导出" };
  }
  const epMismatch = ctx.episode && binding.episode && binding.episode !== ctx.episode;
  const segMismatch = ctx.segmentIndex && binding.segmentIndex && binding.segmentIndex !== ctx.segmentIndex;
  if (epMismatch || segMismatch) {
    return { adopted: true, usable: false, staleCode: "shot_moved", reasonZh: "这张视角图是别的集或段导出的，本镜不能直接用" };
  }
  return { adopted: true, usable: true };
}

/**
 * shotId 是否属于这一集这一段。
 * shotId 形如 `ap_shot_e{集}_s{段}_t{镜序}`（manhuaActionPlanShotId），镜序由分镜决定、不是固定 1..3，
 * 所以出站侧不能自己枚举镜序去找采用图——枚举错了采用就永远命中不了。按集段前缀匹配。
 */
export function isManhuaShotIdOfSegment(shotId: string, episode: number, segmentIndex: number): boolean {
  return String(shotId || "").startsWith(`ap_shot_e${episode}_s${segmentIndex}_t`);
}

/**
 * 本段（不限具体哪一镜）已采用且未失效的视角图。
 * 出站按段取：一张图采用到本段任一镜，就该进本段的参考清单。
 */
export function listManhuaUsableStageFramesForSegment<T extends StageFrameRefLike>(
  refs: readonly T[],
  ctx: Omit<ManhuaShotStageContext, "shotId"> & { episode: number; segmentIndex: number },
): T[] {
  const out: T[] = [];
  for (const ref of refs) {
    const shotIds = (ref.stageFrameAdoptions || []).map((a) => a.shotId).filter((id) => isManhuaShotIdOfSegment(id, ctx.episode, ctx.segmentIndex));
    if (!shotIds.length) continue;
    if (shotIds.some((shotId) => evaluateManhuaStageFrameAdoption(ref, { ...ctx, shotId }).usable)) out.push(ref);
  }
  return out;
}

/** 本镜可用的采用图（按采用时间新到旧）；出站清单只吃这一份 */
export function listManhuaUsableStageFrames<T extends StageFrameRefLike>(refs: readonly T[], ctx: ManhuaShotStageContext): T[] {
  return refs
    .filter((r) => evaluateManhuaStageFrameAdoption(r, ctx).usable)
    .sort((a, b) => {
      const at = (a.stageFrameAdoptions || []).find((x) => x.shotId === ctx.shotId)?.adoptedAt || 0;
      const bt = (b.stageFrameAdoptions || []).find((x) => x.shotId === ctx.shotId)?.adoptedAt || 0;
      return bt - at;
    });
}

/** 本镜采用了但已失效的图（确认处要明说，不静默丢弃） */
export function listManhuaStaleStageFrames<T extends StageFrameRefLike>(refs: readonly T[], ctx: ManhuaShotStageContext): Array<{ ref: T; reasonZh: string; staleCode: ManhuaStageFrameStaleCode }> {
  const out: Array<{ ref: T; reasonZh: string; staleCode: ManhuaStageFrameStaleCode }> = [];
  for (const r of refs) {
    const s = evaluateManhuaStageFrameAdoption(r, ctx);
    if (s.adopted && !s.usable && s.staleCode) out.push({ ref: r, reasonZh: s.reasonZh || "", staleCode: s.staleCode });
  }
  return out;
}

/** 采用 / 取消采用（纯函数，返回新的采用列表） */
export function toggleManhuaStageFrameAdoption(current: readonly ManhuaStageFrameAdoption[] | undefined, shotId: string, now: number): ManhuaStageFrameAdoption[] {
  const list = normalizeManhuaStageFrameAdoptions(current);
  const hit = list.some((a) => a.shotId === shotId);
  if (hit) return list.filter((a) => a.shotId !== shotId);
  return [...list, { shotId, adoptedAt: now }].slice(-MANHUA_STAGE_FRAME_ADOPTION_MAX);
}

/** 面向创作者的来源说明；世界任务与场景版本仅留在 stageFrame 中供失效判定。 */
export function formatManhuaStageFrameSourceZh(ref: StageFrameRefLike, labelOfActor?: (id: string) => string): string {
  const b = ref.stageFrame;
  if (!b) return "";
  const cam = b.viewLabelZh || b.cameraKind;
  const actors = b.actorIds.map((id) => {
    const label = labelOfActor?.(id);
    return label && label !== id ? label : "未命名人物";
  }).join("、");
  const shot = b.episode && b.segmentIndex ? `第${b.episode}集段${String(b.segmentIndex).padStart(2, "0")}` : "";
  return [shot, `${cam}机位`, actors ? `人物 ${actors}` : "", "场景视角图"].filter(Boolean).join(" · ");
}

/** 出站必须报告已采用但失效的引用，不能当成未采用静默删除。 */
export function requireManhuaStageFramesForSegment<T extends StageFrameRefLike>(refs: readonly T[], ctx: Omit<ManhuaShotStageContext, "shotId"> & {episode:number;segmentIndex:number}): T[] {
  for (const ref of refs) for (const adoption of ref.stageFrameAdoptions || []) {
    if (!isManhuaShotIdOfSegment(adoption.shotId, ctx.episode, ctx.segmentIndex)) continue;
    const state = evaluateManhuaStageFrameAdoption(ref, {...ctx,shotId:adoption.shotId});
    if (!state.usable) throw new Error(`已采用的片场视角图「${ref.labelZh || "视角图"}」失效：${state.reasonZh || "来源绑定缺失"}；请取消采用或重新导出，本次未提交。`);
  }
  return listManhuaUsableStageFramesForSegment(refs,ctx);
}
