/**
 * 平台生圖：英文化前將中文編導素材暫入 Neon `jobs.output.chineseStaging`（running 進度），
 * 結案時由 {@link omitChineseStagingFromJobOutput} 剝離，避免長中文落庫成品。
 */
import { patchJobRunningProgress } from "../jobs/repository.js";
import { platformFlowLogTimestamp } from "../utils/platformFlowLogTimestamp.js";

export type CoverChineseStagingSnapshot = {
  kind: "cover";
  topicHookZh: string;
  optimizedChineseBlob: string;
  provenance?: Record<string, unknown>;
  updatedAt: string;
};

export type CompositeChineseStagingSnapshot = {
  kind: "composite_sheet";
  compositeKind: string;
  compositeTaskZh: string;
  scriptContextChars: number;
  updatedAt: string;
};

export type PlatformImageChineseStaging = CoverChineseStagingSnapshot | CompositeChineseStagingSnapshot;

export function omitChineseStagingFromJobOutput<T extends Record<string, unknown>>(output: T): T {
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const next = { ...output } as Record<string, unknown>;
  delete next.chineseStaging;
  return next as T;
}

/** 封面直送语境默认上限：比全文 SCRIPT_SLICE 更短，避免长文冲淡主视觉。 */
export const COVER_DIRECT_CONTEXT_MAX_CHARS = 1800;

/**
 * 封面中文直送：无 LLM 的语境聚焦——优先保留身份/道具/场景行，压掉长论述，降低「满屏堆信息」。
 */
export function focusCoverChineseContextForDirectSend(
  raw: string,
  maxChars: number = COVER_DIRECT_CONTEXT_MAX_CHARS,
): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;

  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const priorityRe =
    /身份|人设|人物|服装|衣着|道具|物件|场景|环境|光|色|封面|主标|副标|锚点|模特|脸|发型|手持|书桌|典籍|耳机|节拍|旅行|运动|艺术/;
  const prefer: string[] = [];
  const rest: string[] = [];
  for (const line of lines) {
    if (priorityRe.test(line) || line.length <= 48) prefer.push(line);
    else rest.push(line);
  }
  const ordered = [...prefer, ...rest];
  let out = "";
  for (const line of ordered) {
    const next = out ? `${out}\n${line}` : line;
    if (next.length > maxChars) {
      if (!out) return line.slice(0, maxChars);
      break;
    }
    out = next;
  }
  return out || text.slice(0, maxChars);
}

export async function buildCoverChineseBlobForStaging(opts: {
  strategistCombinedBlock: string;
  baseContextZh: string;
  briefSource: string;
  /** @deprecated 中文直送已取消 GPT 5.4 骨架提炼；保留参数仅兼容旧调用方 */
  extractChineseVisualBrief?: (raw: string, log?: string[]) => Promise<string>;
  flowLog: string[];
  maxChars: number;
  /** @deprecated 已忽略：封面中文直送永不跑 extractChineseVisualBrief */
  enableVisualBriefExtract?: boolean;
}): Promise<{ blob: string; provenance: Record<string, unknown> }> {
  void opts.extractChineseVisualBrief;
  void opts.enableVisualBriefExtract;
  const strategist = String(opts.strategistCombinedBlock || "").trim();
  const baseContextZh = String(opts.baseContextZh || "").trim();
  const briefSource = String(opts.briefSource || "").trim();
  let blob = [strategist, baseContextZh].filter(Boolean).join("\n\n").trim();
  if (!blob) blob = briefSource;
  opts.flowLog.push(
    `${platformFlowLogTimestamp()}  [chineseStaging·cover] 中文直送 · 无 GPT 5.4 骨架提炼 · 确定性语境聚焦（防满屏）`,
  );
  blob = focusCoverChineseContextForDirectSend(blob, Math.min(opts.maxChars, COVER_DIRECT_CONTEXT_MAX_CHARS));
  return {
    blob,
    provenance: {
      strategistChars: strategist.length,
      extractedChars: 0,
      baseContextChars: baseContextZh.length,
      visualBriefSkipped: true,
      visualBriefAuto: false,
      focusedChars: blob.length,
    },
  };
}

export function finalizeCoverChineseStagingForTranslation(opts: {
  topicHookZh: string;
  optimizedChineseBlob: string;
  provenance: Record<string, unknown>;
  maxBlobChars: number;
}): CoverChineseStagingSnapshot {
  let blob = String(opts.optimizedChineseBlob || "").trim();
  if (blob.length > opts.maxBlobChars) blob = blob.slice(0, opts.maxBlobChars);
  return {
    kind: "cover",
    topicHookZh: String(opts.topicHookZh || "").trim(),
    optimizedChineseBlob: blob,
    provenance: opts.provenance,
    updatedAt: new Date().toISOString(),
  };
}

export function appendStagingCoverToFlowLog(flowLog: string[], staging: CoverChineseStagingSnapshot): void {
  flowLog.push(
    `${platformFlowLogTimestamp()}  [chineseStaging·cover] topic≈${staging.topicHookZh.length}字 · blob≈${staging.optimizedChineseBlob.length}字`,
  );
}

export async function persistCoverChineseStagingToRunningJob(
  jobId: string | null | undefined,
  staging: CoverChineseStagingSnapshot,
): Promise<void> {
  const id = String(jobId ?? "").trim();
  if (id.length < 8) return;
  await patchJobRunningProgress(id, { chineseStaging: staging });
}

export function logSheetChineseStagingBeforeTranslate(
  flowLog: string[] | undefined,
  kind: string,
  scriptContextChars: number,
  taskChars: number,
): void {
  if (!flowLog) return;
  flowLog.push(
    `${platformFlowLogTimestamp()}  [chineseStaging·2×4] 英文化前 · kind=${kind} · script≈${scriptContextChars}字 · task≈${taskChars}字`,
  );
}

export async function persistSheetChineseStagingToRunningJob(
  jobId: string | null | undefined,
  payload: Omit<CompositeChineseStagingSnapshot, "kind" | "updatedAt">,
): Promise<void> {
  const id = String(jobId ?? "").trim();
  if (id.length < 8) return;
  const snap: CompositeChineseStagingSnapshot = {
    kind: "composite_sheet",
    compositeKind: payload.compositeKind,
    compositeTaskZh: payload.compositeTaskZh,
    scriptContextChars: payload.scriptContextChars,
    updatedAt: new Date().toISOString(),
  };
  await patchJobRunningProgress(id, { chineseStaging: snap });
}
