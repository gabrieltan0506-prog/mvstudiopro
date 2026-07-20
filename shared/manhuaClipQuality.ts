/**
 * 漫剧成片智能质检。
 *
 * 工作流状态与失败落库语义参考 Jellyfish（Apache-2.0）的生成任务模式；
 * P0/P1 检查维度改编自 Arch-Dog/video-prompt-engineer（MIT）的 quality rubric。
 * 本实现已按本站「静帧→成片→成片坞」数据结构重写。
 */

export const MANHUA_CLIP_QUALITY_KEYS = [
  "CHARACTER_MATCH",
  "SCENE_MATCH",
  "PLOT_MATCH",
  "CAMERA_MOTION",
  "LIGHTING",
  "DURATION_10S",
  "NO_UNRELATED_CONTENT",
] as const;

export type ManhuaClipQualityKey = (typeof MANHUA_CLIP_QUALITY_KEYS)[number];
export type ManhuaClipQualityStatus = "pending" | "passed" | "failed";

export type ManhuaClipQualityReport = {
  status: ManhuaClipQualityStatus;
  checks: Record<ManhuaClipQualityKey, boolean>;
  failedKeys: ManhuaClipQualityKey[];
  summary: string;
  raw: string;
  attempts: number;
  sourceKeyartId?: string;
  sourceKeyartUrl?: string;
  reviewedAt: string;
};

export function emptyManhuaClipQualityChecks(): Record<ManhuaClipQualityKey, boolean> {
  return Object.fromEntries(MANHUA_CLIP_QUALITY_KEYS.map((key) => [key, false])) as Record<
    ManhuaClipQualityKey,
    boolean
  >;
}

export function parseManhuaClipQualityMarkdown(
  raw: string,
): Pick<ManhuaClipQualityReport, "status" | "checks" | "failedKeys" | "summary" | "raw"> {
  const text = String(raw || "").trim();
  const checks = emptyManhuaClipQualityChecks();
  for (const key of MANHUA_CLIP_QUALITY_KEYS) {
    checks[key] = new RegExp(`(?:^|\\n)\\s*${key}\\s*=\\s*YES\\b`, "i").test(text);
  }
  const failedKeys = MANHUA_CLIP_QUALITY_KEYS.filter((key) => !checks[key]);
  const summary = String(text.match(/(?:^|\n)\s*SUMMARY\s*=\s*(.+)$/im)?.[1] || "")
    .trim()
    .slice(0, 280);
  return {
    status: failedKeys.length === 0 ? "passed" : "failed",
    checks,
    failedKeys,
    summary: summary || (failedKeys.length ? `未通过：${failedKeys.join("、")}` : "全部通过"),
    raw: text,
  };
}

export function buildManhuaClipQualityPrompt(expectedContext: string): string {
  return [
    "你是严格的漫剧成片智能质检员。输入顺序为：第1项首镜关键静帧，第2项生成成片。",
    "仅画面精美、接口成功或时长正确都不算通过；必须真实承接首镜中的人物身份、服装、场景和剧情事件。",
    "检查完整视频的前中后段，运镜和灯光必须有可读变化但不能跳成无关人物或无关故事。",
    expectedContext.trim() ? `【预期剧情与分镜】\n${expectedContext.trim().slice(0, 5000)}` : "",
    "只输出以下八行，不要 Markdown 表格，不要解释：",
    "CHARACTER_MATCH=YES或NO",
    "SCENE_MATCH=YES或NO",
    "PLOT_MATCH=YES或NO",
    "CAMERA_MOTION=YES或NO",
    "LIGHTING=YES或NO",
    "DURATION_10S=YES或NO",
    "NO_UNRELATED_CONTENT=YES或NO",
    "SUMMARY=一句中文说明最关键的不合格原因；全部通过则写“全部通过”",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 质检链路/媒体拉取失败（非画面内容不合格） */
export function isManhuaClipQualityInfraFailure(
  report: Pick<ManhuaClipQualityReport, "summary" | "raw" | "failedKeys">,
): boolean {
  const summary = String(report.summary || "");
  const raw = String(report.raw || "");
  if (/暂不可用|质检服务/.test(summary)) return true;
  if (
    /quality_|empty_quality|missing_reference|missing_video|HTTP\s*[45]\d\d|Failed to fetch|fetch failed|TypeError/i.test(
      raw,
    )
  ) {
    return true;
  }
  // 全键失败且无模型 SUMMARY 原文时，多半是包装层兜底
  if (
    report.failedKeys.length >= MANHUA_CLIP_QUALITY_KEYS.length &&
    /暂不可用|quality_|HTTP|fetch/i.test(`${summary}\n${raw}`)
  ) {
    return true;
  }
  return false;
}
