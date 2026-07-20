/**
 * 自研静帧路径标注：锚点 JSON → 分阶段运镜句。
 * 支持红轨（人物）/ 蓝轨（镜头）双轨迹。
 */

import { getActionCameraRecipeById } from "./manhuaActionCameraRecipeBank.js";
import {
  getPathCameraRecipeById,
  type ManhuaPathCameraPhase,
  type ManhuaPathCameraRecipe,
} from "./manhuaPathCameraRecipeBank.js";

export const PATH_ANNOTATE_ANCHOR_MIN = 3;
export const PATH_ANNOTATE_ANCHOR_MAX = 8;

export type ManhuaPathTrackRole = "subject" | "camera";

export type ManhuaPathAnchor = {
  /** 1-based index */
  index: number;
  /** 归一化 x（相对画面宽） */
  x: number;
  /** 归一化 y（相对画面高） */
  y: number;
  focusZh: string;
  cameraEn: string;
  subjectActionEn: string;
  durationHintSec: number;
  /** 红=人物动作轨，蓝=镜头轨；缺省按 subject */
  trackRole?: ManhuaPathTrackRole;
};

/** 稠密笔迹（画线显示）；anchors 为编译用抽稀点 */
export type ManhuaPathStroke = {
  trackRole: ManhuaPathTrackRole;
  points: Array<{ x: number; y: number }>;
};

export type ManhuaPathAnnotation = {
  version: 1;
  imageUrl?: string;
  recipeId?: string | null;
  /** 动作运镜配方 id（FPV / 打斗 / 双轨） */
  actionRecipeId?: string | null;
  anchors: ManhuaPathAnchor[];
  /** 红/蓝轨流畅笔迹（每轨最多保留一条最新笔迹） */
  strokes?: ManhuaPathStroke[];
  notesZh?: string;
};

export const PATH_STROKE_POINT_MAX = 96;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function parseTrackRole(raw: unknown): ManhuaPathTrackRole {
  return raw === "camera" ? "camera" : "subject";
}

/** 稠密笔迹归一化（显示用；可少于编译锚点下限） */
export function normalizeStrokePoints(
  points: unknown,
  opts?: { max?: number; minDist?: number },
): Array<{ x: number; y: number }> {
  const max = opts?.max ?? PATH_STROKE_POINT_MAX;
  const minDist = opts?.minDist ?? 0.012;
  const raw = Array.isArray(points) ? points : [];
  const out: Array<{ x: number; y: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const x = clamp01(Number(p.x));
    const y = clamp01(Number(p.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.hypot(x - prev.x, y - prev.y) < minDist) continue;
    out.push({ x, y });
    if (out.length >= max) break;
  }
  return out;
}

export function normalizePathAnnotation(raw: unknown): ManhuaPathAnnotation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const anchorsRaw = Array.isArray(o.anchors) ? o.anchors : [];
  const anchors: ManhuaPathAnchor[] = [];
  for (let i = 0; i < anchorsRaw.length && anchors.length < PATH_ANNOTATE_ANCHOR_MAX; i++) {
    const a = anchorsRaw[i] as Record<string, unknown>;
    if (!a || typeof a !== "object") continue;
    anchors.push({
      index: anchors.length + 1,
      x: clamp01(Number(a.x)),
      y: clamp01(Number(a.y)),
      focusZh: String(a.focusZh || "").trim().slice(0, 40) || `落点${anchors.length + 1}`,
      cameraEn: String(a.cameraEn || "").trim().slice(0, 120) || "镜头沿蓝色路径缓缓跟进",
      subjectActionEn:
        String(a.subjectActionEn || "").trim().slice(0, 120) || "人物沿红色路径自然微动",
      durationHintSec: Math.max(1, Math.min(6, Math.round(Number(a.durationHintSec) || 2))),
      trackRole: parseTrackRole(a.trackRole),
    });
  }
  if (anchors.length < PATH_ANNOTATE_ANCHOR_MIN) return null;

  const strokesRaw = Array.isArray(o.strokes) ? o.strokes : [];
  const strokes: ManhuaPathStroke[] = [];
  for (const s of strokesRaw) {
    if (!s || typeof s !== "object") continue;
    const row = s as Record<string, unknown>;
    const trackRole = parseTrackRole(row.trackRole);
    const points = normalizeStrokePoints(row.points);
    if (points.length < 2) continue;
    // 每轨只留一条
    const without = strokes.filter((x) => x.trackRole !== trackRole);
    without.push({ trackRole, points });
    strokes.length = 0;
    strokes.push(...without);
  }

  return {
    version: 1,
    imageUrl: o.imageUrl ? String(o.imageUrl).slice(0, 2000) : undefined,
    recipeId: o.recipeId != null ? String(o.recipeId) : null,
    actionRecipeId: o.actionRecipeId != null ? String(o.actionRecipeId) : null,
    anchors,
    strokes: strokes.length ? strokes : undefined,
    notesZh: o.notesZh ? String(o.notesZh).slice(0, 500) : undefined,
  };
}

/** 用新笔迹替换同轨笔迹 */
export function upsertStroke(
  existing: ManhuaPathStroke[] | undefined,
  trackRole: ManhuaPathTrackRole,
  points: Array<{ x: number; y: number }>,
): ManhuaPathStroke[] {
  const dense = normalizeStrokePoints(points);
  const rest = (existing || []).filter((s) => s.trackRole !== trackRole);
  if (dense.length < 2) return rest;
  return [...rest, { trackRole, points: dense }];
}

export function anchorsFromRecipe(
  recipe: ManhuaPathCameraRecipe,
  layout?: { startY?: number; endY?: number },
): ManhuaPathAnchor[] {
  const startY = layout?.startY ?? 0.85;
  const endY = layout?.endY ?? 0.18;
  const n = recipe.phases.length;
  return recipe.phases.map((p, i) => {
    const t = n <= 1 ? 0 : i / (n - 1);
    return {
      index: p.index,
      x: 0.5 + Math.sin(t * Math.PI) * 0.08,
      y: startY + (endY - startY) * t,
      focusZh: p.focusZh,
      cameraEn: p.cameraEn,
      subjectActionEn: p.subjectActionEn,
      durationHintSec: p.durationHintSec,
      trackRole: "subject" as const,
    };
  });
}

export function annotationFromRecipeId(
  recipeId: string,
  opts?: { imageUrl?: string },
): ManhuaPathAnnotation | null {
  const recipe = getPathCameraRecipeById(recipeId);
  if (!recipe) return null;
  return {
    version: 1,
    imageUrl: opts?.imageUrl,
    recipeId: recipe.id,
    anchors: anchorsFromRecipe(recipe),
  };
}

export function annotationToPhases(ann: ManhuaPathAnnotation): ManhuaPathCameraPhase[] {
  return ann.anchors.map((a) => ({
    index: a.index,
    focusZh: a.focusZh,
    cameraEn: a.cameraEn,
    subjectActionEn: a.subjectActionEn,
    durationHintSec: a.durationHintSec,
  }));
}

/** 标注 JSON → 中文运镜说明（界面 + Seedance / I2V 同一套，可读可执行） */
export function compilePathAnnotationToMotionPromptZh(ann: ManhuaPathAnnotation): string {
  const normalized = normalizePathAnnotation(ann);
  if (!normalized) {
    return "缓慢电影感推进，主体微动自然，气氛柔和。";
  }

  const action = getActionCameraRecipeById(normalized.actionRecipeId);
  if (action?.trackMode === "fpv") {
    return `${action.craftSummaryZh} ${action.seedancePromptZh}`.trim();
  }

  const subjectAnchors = normalized.anchors.filter((a) => (a.trackRole || "subject") === "subject");
  const cameraAnchors = normalized.anchors.filter((a) => a.trackRole === "camera");
  const dual =
    action?.trackMode === "dual" ||
    (subjectAnchors.length >= 2 && cameraAnchors.length >= 2);

  if (dual) {
    const subjectBeats = (subjectAnchors.length ? subjectAnchors : normalized.anchors).map(
      (a) => a.focusZh || "人物沿红轨推进",
    );
    const cameraBeats = (cameraAnchors.length ? cameraAnchors : normalized.anchors).map(
      (a) => a.focusZh || "镜头沿蓝轨推进",
    );
    return [
      action ? `【动作】${action.nameZh}：${action.craftSummaryZh}` : "【动作】红蓝双轨",
      action?.seedancePromptZh || "人物沿红轨动作，镜头沿蓝轨调度；成片不显示轨迹参考线。",
      `人物节拍：${subjectBeats.join(" → ")}`,
      `镜头节拍：${cameraBeats.join(" → ")}`,
      "保持人物身份、场景连续与空间关系稳定，动作流畅。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (action?.trackMode === "single_action") {
    const parts = normalized.anchors.map((a) => {
      const t0 = normalized.anchors.slice(0, a.index - 1).reduce((s, x) => s + x.durationHintSec, 0);
      const t1 = t0 + a.durationHintSec;
      return `${t0}–${t1}秒：人物「${a.focusZh}」沿动作轨；镜头稳跟或轻跟。`;
    });
    return [
      `【动作】${action.nameZh}：${action.craftSummaryZh}`,
      action.seedancePromptZh,
      "成片不显示轨迹参考线。",
      ...parts,
    ].join("\n");
  }

  if (normalized.recipeId) {
    const recipe = getPathCameraRecipeById(normalized.recipeId);
    if (recipe) {
      const parts = recipe.phases.map((p) => {
        const t0 = recipe.phases.slice(0, p.index - 1).reduce((s, x) => s + x.durationHintSec, 0);
        const t1 = t0 + p.durationHintSec;
        return `${t0}–${t1}秒：镜头看向「${p.focusZh}」；主体配合微动。`;
      });
      return [
        `【路径】${recipe.nameZh}：${recipe.craftSummaryZh}`,
        `效果：${recipe.effectZh}`,
        "每镜一个主运镜；镜头运动与主体动作分开写。",
        ...parts,
      ].join("\n");
    }
  }

  const parts = normalized.anchors.map((a) => {
    const t0 = normalized.anchors.slice(0, a.index - 1).reduce((s, x) => s + x.durationHintSec, 0);
    const t1 = t0 + a.durationHintSec;
    const role = (a.trackRole || "subject") === "camera" ? "镜头" : "人物";
    return `${t0}–${t1}秒：${role}「${a.focusZh}」`;
  });
  return ["沿标注锚点推进一条主运镜。", "镜头与人物动作分开写；成片不显示轨迹参考线。", ...parts].join(
    "\n",
  );
}

/** 标注 JSON → Seedance / I2V 运镜句（中文；与 Zh 版同一实现） */
export function compilePathAnnotationToMotionPrompt(ann: ManhuaPathAnnotation): string {
  return compilePathAnnotationToMotionPromptZh(ann);
}

export function formatPathAnnotationBrief(ann: ManhuaPathAnnotation): string {
  const n = normalizePathAnnotation(ann);
  if (!n) return "";
  const lines = n.anchors.map((a) => {
    const role = (a.trackRole || "subject") === "camera" ? "蓝·镜" : "红·人";
    return `${a.index}.[${role}] ${a.focusZh} @(${a.x.toFixed(2)},${a.y.toFixed(2)}) · ${a.durationHintSec}s`;
  });
  return [
    "【路径标注】",
    n.actionRecipeId ? `动作配方：${n.actionRecipeId}` : "",
    n.recipeId ? `路径配方：${n.recipeId}` : "自定义锚点",
    ...lines,
    n.notesZh ? `备注：${n.notesZh}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 将连续笔迹采样为锚点（保留首尾，按最小间距 + 均匀抽稀）。
 * 用于红/蓝轨拖拽画线；上限 PATH_ANNOTATE_ANCHOR_MAX（单轨内再限半额以免双轨爆掉）。
 */
export function downsampleStrokeToAnchors(
  points: Array<{ x: number; y: number }>,
  trackRole: ManhuaPathTrackRole,
  opts?: { maxPoints?: number; minDist?: number },
): ManhuaPathAnchor[] {
  const maxPoints = Math.max(2, Math.min(PATH_ANNOTATE_ANCHOR_MAX, opts?.maxPoints ?? 5));
  const minDist = opts?.minDist ?? 0.035;
  const raw = (points || [])
    .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (raw.length < 2) return [];

  const spaced: Array<{ x: number; y: number }> = [raw[0]!];
  for (let i = 1; i < raw.length; i++) {
    const p = raw[i]!;
    const prev = spaced[spaced.length - 1]!;
    const d = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (d >= minDist) spaced.push(p);
  }
  const last = raw[raw.length - 1]!;
  const tail = spaced[spaced.length - 1]!;
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > 0.01) spaced.push(last);

  let picked = spaced;
  if (picked.length > maxPoints) {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < maxPoints; i++) {
      const t = maxPoints <= 1 ? 0 : i / (maxPoints - 1);
      const idx = Math.round(t * (picked.length - 1));
      out.push(picked[idx]!);
    }
    picked = out;
  }

  const first = picked[0]!;
  const end = picked[picked.length - 1]!;
  const dx = end.x - first.x;
  const dy = end.y - first.y;
  const dirZh =
    Math.abs(dx) >= Math.abs(dy)
      ? dx >= 0
        ? "自左向右"
        : "自右向左"
      : dy >= 0
        ? "自上向下"
        : "自下向上";

  return picked.map((p, i) => {
    const isFirst = i === 0;
    const isLast = i === picked.length - 1;
    const focusZh =
      trackRole === "camera"
        ? isFirst
          ? `镜头起点·${dirZh}`
          : isLast
            ? `镜头落点·${dirZh}`
            : `镜头途经${i + 1}·${dirZh}`
        : isFirst
          ? `人物起点·${dirZh}`
          : isLast
            ? `人物落点·${dirZh}`
            : `人物途经${i + 1}·${dirZh}`;
    return {
      index: i + 1,
      x: p.x,
      y: p.y,
      focusZh,
      cameraEn:
        trackRole === "camera" ? "镜头沿蓝色路径运动" : "镜头稳住或轻跟人物",
      subjectActionEn:
        trackRole === "subject" ? "人物沿红色路径运动" : "人物姿态保持可读",
      durationHintSec: 2,
      trackRole,
    };
  });
}

/** 用一轨新锚点替换同轨旧点，保留另一轨，再重编号 */
export function mergeTrackAnchors(
  existing: ManhuaPathAnchor[],
  nextTrack: ManhuaPathAnchor[],
  trackRole: ManhuaPathTrackRole,
): ManhuaPathAnchor[] {
  const other = existing.filter((a) => (a.trackRole || "subject") !== trackRole);
  const merged = [...other, ...nextTrack].slice(0, PATH_ANNOTATE_ANCHOR_MAX);
  return merged.map((a, i) => ({ ...a, index: i + 1 }));
}
