/**
 * 自研静帧路径标注：锚点 JSON → 分阶段运镜句。
 * 支持红轨（人物）/ 蓝轨（镜头）双轨迹。
 */

import {
  compileDualTrackMotionPrompt,
  getActionCameraRecipeById,
} from "./manhuaActionCameraRecipeBank.js";
import {
  compilePathCameraRecipeToMotionPrompt,
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

export type ManhuaPathAnnotation = {
  version: 1;
  imageUrl?: string;
  recipeId?: string | null;
  /** 动作运镜配方 id（FPV / 打斗 / 双轨） */
  actionRecipeId?: string | null;
  anchors: ManhuaPathAnchor[];
  notesZh?: string;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function parseTrackRole(raw: unknown): ManhuaPathTrackRole {
  return raw === "camera" ? "camera" : "subject";
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
      focusZh: String(a.focusZh || "").trim().slice(0, 40) || `点${anchors.length + 1}`,
      cameraEn: String(a.cameraEn || "").trim().slice(0, 120) || "slow motivated camera move",
      subjectActionEn:
        String(a.subjectActionEn || "").trim().slice(0, 120) || "subtle natural micro-motion",
      durationHintSec: Math.max(1, Math.min(6, Math.round(Number(a.durationHintSec) || 2))),
      trackRole: parseTrackRole(a.trackRole),
    });
  }
  if (anchors.length < PATH_ANNOTATE_ANCHOR_MIN) return null;
  return {
    version: 1,
    imageUrl: o.imageUrl ? String(o.imageUrl).slice(0, 2000) : undefined,
    recipeId: o.recipeId != null ? String(o.recipeId) : null,
    actionRecipeId: o.actionRecipeId != null ? String(o.actionRecipeId) : null,
    anchors,
    notesZh: o.notesZh ? String(o.notesZh).slice(0, 500) : undefined,
  };
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

/** 标注 JSON → Seedance 时段运镜句（支持双轨） */
export function compilePathAnnotationToMotionPrompt(ann: ManhuaPathAnnotation): string {
  const normalized = normalizePathAnnotation(ann);
  if (!normalized) {
    return "Slow cinematic push-in, subtle natural movement, soft atmospheric haze";
  }

  const action = getActionCameraRecipeById(normalized.actionRecipeId);
  if (action?.trackMode === "fpv") {
    return `${action.craftLockEn}. ${action.seedancePromptZh}`;
  }

  const subjectAnchors = normalized.anchors.filter((a) => (a.trackRole || "subject") === "subject");
  const cameraAnchors = normalized.anchors.filter((a) => a.trackRole === "camera");
  const dual =
    action?.trackMode === "dual" ||
    (subjectAnchors.length >= 2 && cameraAnchors.length >= 2);

  if (dual) {
    const subjectBeats = (subjectAnchors.length ? subjectAnchors : normalized.anchors).map(
      (a) => a.subjectActionEn,
    );
    const cameraBeats = (cameraAnchors.length ? cameraAnchors : normalized.anchors).map(
      (a) => a.cameraEn,
    );
    const dualEn = compileDualTrackMotionPrompt({ subjectBeats, cameraBeats });
    return action ? `${action.craftLockEn}. ${dualEn}` : dualEn;
  }

  if (action?.trackMode === "single_action") {
    const parts = normalized.anchors.map((a) => {
      const t0 = normalized.anchors.slice(0, a.index - 1).reduce((s, x) => s + x.durationHintSec, 0);
      const t1 = t0 + a.durationHintSec;
      return `${t0}-${t1}s: subject ${a.subjectActionEn} along action path; camera ${a.cameraEn}`;
    });
    return [
      action.craftLockEn,
      "Guide lines must not appear in final frames.",
      ...parts,
    ].join(" ");
  }

  if (normalized.recipeId) {
    const recipe = getPathCameraRecipeById(normalized.recipeId);
    if (recipe && normalized.anchors.length === recipe.phases.length) {
      const unchanged = normalized.anchors.every((a, i) => {
        const p = recipe.phases[i]!;
        return a.cameraEn === p.cameraEn && a.subjectActionEn === p.subjectActionEn;
      });
      if (unchanged) return compilePathCameraRecipeToMotionPrompt(recipe);
    }
  }

  const parts = normalized.anchors.map((a) => {
    const t0 = normalized.anchors.slice(0, a.index - 1).reduce((s, x) => s + x.durationHintSec, 0);
    const t1 = t0 + a.durationHintSec;
    return `${t0}-${t1}s: camera ${a.cameraEn}; subject ${a.subjectActionEn}`;
  });
  return [
    "One primary path move along annotated anchors.",
    "Separate camera from subject action. No stacked camera moves.",
    "Guide lines must not appear in final frames.",
    ...parts,
  ].join(" ");
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
  const maxPoints = Math.max(
    PATH_ANNOTATE_ANCHOR_MIN,
    Math.min(PATH_ANNOTATE_ANCHOR_MAX, opts?.maxPoints ?? 5),
  );
  const minDist = opts?.minDist ?? 0.045;
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

  return picked.map((p, i) => ({
    index: i + 1,
    x: p.x,
    y: p.y,
    focusZh: trackRole === "camera" ? `镜${i + 1}` : `动${i + 1}`,
    cameraEn:
      trackRole === "camera"
        ? "camera follows blue path"
        : "camera holds or soft follows subject",
    subjectActionEn:
      trackRole === "subject"
        ? "subject moves along red action path"
        : "subject holds readable stance",
    durationHintSec: 2,
    trackRole,
  }));
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
