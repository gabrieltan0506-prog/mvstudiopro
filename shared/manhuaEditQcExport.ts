/**
 * 剪辑阶段 · 质检摘要 / 返工判定 / 可导出勾选（对接成片坞软拦）。
 */

import {
  manhuaClipQualityAllowsAssemble,
  type ManhuaClipQualityKey,
  type ManhuaClipQualityReport,
} from "./manhuaClipQuality.js";

export const MANHUA_EDIT_QC_ROWS: ReadonlyArray<readonly [ManhuaClipQualityKey, string]> = [
  ["CHARACTER_MATCH", "角色"],
  ["SCENE_MATCH", "场景"],
  ["PLOT_MATCH", "剧情"],
  ["CAMERA_MOTION", "运镜"],
  ["LIGHTING", "灯光"],
  ["DURATION_OK", "时长"],
] as const;

export type ManhuaEditShotMedia = {
  shotIndex: number;
  clipBlockId?: string;
  keyartBlockId?: string;
  outputUrl?: string | null;
  quality?: Pick<
    ManhuaClipQualityReport,
    "status" | "userAcceptedDespiteQc" | "checks" | "summary" | "attempts" | "failedKeys"
  > | null;
};

export type ManhuaEditShotQcRow = ManhuaEditShotMedia & {
  /** passed | failed | pending | missing */
  gate: "passed" | "failed" | "accepted" | "pending" | "missing";
  allowsExport: boolean;
  needsRework: boolean;
};

export function classifyManhuaEditShotQc(m: ManhuaEditShotMedia): ManhuaEditShotQcRow {
  const url = String(m.outputUrl || "").trim();
  if (!url) {
    return {
      ...m,
      gate: "missing",
      allowsExport: false,
      needsRework: true,
    };
  }
  const q = m.quality;
  if (!q || q.status === "pending") {
    return {
      ...m,
      gate: "pending",
      allowsExport: false,
      needsRework: false,
    };
  }
  if (q.status === "passed") {
    return {
      ...m,
      gate: "passed",
      allowsExport: true,
      needsRework: false,
    };
  }
  if (q.userAcceptedDespiteQc) {
    return {
      ...m,
      gate: "accepted",
      allowsExport: manhuaClipQualityAllowsAssemble({ outputUrl: url, quality: q }),
      needsRework: false,
    };
  }
  return {
    ...m,
    gate: "failed",
    allowsExport: false,
    needsRework: true,
  };
}

export function buildManhuaEditShotQcBoard(
  medias: ManhuaEditShotMedia[],
): ManhuaEditShotQcRow[] {
  return medias.map(classifyManhuaEditShotQc);
}

export function summarizeManhuaEditQcBoard(rows: ManhuaEditShotQcRow[]): {
  total: number;
  passed: number;
  failed: number;
  accepted: number;
  missing: number;
  exportable: number;
  reworkIndexes: number[];
} {
  const reworkIndexes: number[] = [];
  let passed = 0;
  let failed = 0;
  let accepted = 0;
  let missing = 0;
  let exportable = 0;
  for (const r of rows) {
    if (r.gate === "passed") passed += 1;
    else if (r.gate === "failed") failed += 1;
    else if (r.gate === "accepted") accepted += 1;
    else if (r.gate === "missing") missing += 1;
    if (r.allowsExport) exportable += 1;
    if (r.needsRework) reworkIndexes.push(r.shotIndex);
  }
  return {
    total: rows.length,
    passed,
    failed,
    accepted,
    missing,
    exportable,
    reworkIndexes,
  };
}

/** 建议返工静帧：质检摘要点名文字/设定卡等问题 */
export function manhuaEditQcSuggestsReworkStill(summary?: string | null): boolean {
  return /文字|设定卡|姓名条|字幕|重出静帧/.test(String(summary || ""));
}

export function manhuaEditExportableClipIds(rows: ManhuaEditShotQcRow[]): string[] {
  return rows
    .filter((r) => r.allowsExport && r.clipBlockId)
    .map((r) => r.clipBlockId!);
}
