/**
 * 自研静帧路径标注：锚点 JSON → 分阶段运镜句。
 * 不依赖第三方画布实现；坐标为归一化 0–1。
 */

import {
  compilePathCameraRecipeToMotionPrompt,
  getPathCameraRecipeById,
  type ManhuaPathCameraPhase,
  type ManhuaPathCameraRecipe,
} from "./manhuaPathCameraRecipeBank.js";

export const PATH_ANNOTATE_ANCHOR_MIN = 3;
export const PATH_ANNOTATE_ANCHOR_MAX = 8;

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
};

export type ManhuaPathAnnotation = {
  version: 1;
  imageUrl?: string;
  recipeId?: string | null;
  anchors: ManhuaPathAnchor[];
  notesZh?: string;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
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
      subjectActionEn: String(a.subjectActionEn || "").trim().slice(0, 120) || "subtle natural micro-motion",
      durationHintSec: Math.max(1, Math.min(6, Math.round(Number(a.durationHintSec) || 2))),
    });
  }
  if (anchors.length < PATH_ANNOTATE_ANCHOR_MIN) return null;
  return {
    version: 1,
    imageUrl: o.imageUrl ? String(o.imageUrl).slice(0, 2000) : undefined,
    recipeId: o.recipeId != null ? String(o.recipeId) : null,
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

/** 标注 JSON → Seedance 时段运镜句 */
export function compilePathAnnotationToMotionPrompt(ann: ManhuaPathAnnotation): string {
  const normalized = normalizePathAnnotation(ann);
  if (!normalized) {
    return "Slow cinematic push-in, subtle natural movement, soft atmospheric haze";
  }
  if (normalized.recipeId) {
    const recipe = getPathCameraRecipeById(normalized.recipeId);
    if (recipe && normalized.anchors.length === recipe.phases.length) {
      // 用户未改阶段文案时，直接用配方编译；改过则以锚点为准
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
    ...parts,
  ].join(" ");
}

export function formatPathAnnotationBrief(ann: ManhuaPathAnnotation): string {
  const n = normalizePathAnnotation(ann);
  if (!n) return "";
  const lines = n.anchors.map(
    (a) => `${a.index}. ${a.focusZh} @(${a.x.toFixed(2)},${a.y.toFixed(2)}) · ${a.durationHintSec}s`,
  );
  return [
    "【路径标注】",
    n.recipeId ? `配方：${n.recipeId}` : "自定义锚点",
    ...lines,
    n.notesZh ? `备注：${n.notesZh}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
