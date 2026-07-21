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
  "DURATION_OK",
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
  /**
   * 用户显式「仍采用此片」后为 true。
   * 质检 failed 时默认不进成片坞；仅此项为 true 才可勾选合成。
   */
  userAcceptedDespiteQc?: boolean;
};

/** 成片是否允许进入成片坞 / 长片合成（软质检） */
export function manhuaClipQualityAllowsAssemble(opts: {
  outputUrl?: string | null;
  quality?: Pick<ManhuaClipQualityReport, "status" | "userAcceptedDespiteQc"> | null;
}): boolean {
  if (!String(opts.outputUrl || "").trim()) return false;
  const q = opts.quality;
  if (!q) return false;
  if (q.status === "passed") return true;
  if (q.status === "failed" && q.userAcceptedDespiteQc) return true;
  return false;
}

export type ManhuaClipQualityPromptOpts = {
  expectedContext?: string;
  /** 本镜目标时长（秒）；缺省按片段 2.5s */
  expectedDurationSec?: number;
  shotIndex?: number;
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
    if (key === "DURATION_OK") {
      // 兼容旧模型仍输出 DURATION_10S
      checks.DURATION_OK =
        /(?:^|\n)\s*DURATION_OK\s*=\s*YES\b/i.test(text) ||
        /(?:^|\n)\s*DURATION_10S\s*=\s*YES\b/i.test(text);
      continue;
    }
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

export function resolveManhuaClipQualityDurationSec(sec?: number): number {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return 2.5;
  return Math.max(1.5, Math.min(12, Math.round(n * 10) / 10));
}

export function buildManhuaClipQualityPrompt(
  expectedContextOrOpts: string | ManhuaClipQualityPromptOpts,
  maybeOpts?: ManhuaClipQualityPromptOpts,
): string {
  const opts: ManhuaClipQualityPromptOpts =
    typeof expectedContextOrOpts === "string"
      ? { ...(maybeOpts || {}), expectedContext: expectedContextOrOpts }
      : expectedContextOrOpts || {};
  const durationSec = resolveManhuaClipQualityDurationSec(opts.expectedDurationSec);
  const shotIndex =
    typeof opts.shotIndex === "number" && opts.shotIndex >= 1 ? Math.floor(opts.shotIndex) : undefined;
  const shotLabel = shotIndex != null ? `第 ${shotIndex} 镜片段` : "单镜片段";
  return [
    `你是严格的漫剧「${shotLabel}」智能质检员。输入顺序为：第1项本镜关键静帧，第2项本镜生成成片。`,
    "只评判本镜，不要因为未演完整集剧情而判失败。",
    "仅画面精美、接口成功或时长正确都不算通过；必须真实承接首镜中的人物身份、服装、场景，并演绎【本镜预期】中的关键事件/动作。",
    "检查完整短片的前中后段；运镜和灯光须有可读变化，但不能跳成无关人物或无关故事。",
    `时长口径：目标约 ${durationSec} 秒（允许 ±1.2 秒判 YES）。禁止用「整集必须 10 秒」否定本镜短片。`,
    "若首镜含大块可读文字、设定卡多格、姓名条、字幕条或标题排版：NO_UNRELATED_CONTENT=NO，SUMMARY 必须写明「首镜含违规文字，请重出静帧」。",
    opts.expectedContext?.trim()
      ? `【本镜预期】\n${opts.expectedContext.trim().slice(0, 5000)}`
      : "",
    "只输出以下八行，不要 Markdown 表格，不要解释：",
    "CHARACTER_MATCH=YES或NO",
    "SCENE_MATCH=YES或NO",
    "PLOT_MATCH=YES或NO（只看本镜事件是否出现，勿要求整集剧情）",
    "CAMERA_MOTION=YES或NO",
    "LIGHTING=YES或NO",
    "DURATION_OK=YES或NO",
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

/**
 * 历史：首镜带字会拦成片。静帧禁字已加固后不再用此闸门拦视频/进坞。
 * 保留函数以免旧调用方崩，恒为 false。
 */
export function isManhuaClipQualityKeyartTextFailure(
  _report: Pick<ManhuaClipQualityReport, "summary" | "raw" | "failedKeys">,
): boolean {
  return false;
}
