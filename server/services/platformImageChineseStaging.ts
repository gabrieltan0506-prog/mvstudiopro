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
  extractChineseVisualBrief: (raw: string, log?: string[]) => Promise<string>;
  flowLog: string[];
  maxChars: number;
  /**
   * 中文直送主路径默认 **不** 再跑 GPT 5.4 `extractChineseVisualBrief`（可省一轮 LLM）。
   * 显式 `true`，或 env `PLATFORM_COVER_EXTRACT_VISUAL_BRIEF=1` 时强制提炼。
   * 未强制时：合并语境超过 `PLATFORM_COVER_EXTRACT_AUTO_CHARS`（默认 4200）才自动提炼。
   */
  enableVisualBriefExtract?: boolean;
}): Promise<{ blob: string; provenance: Record<string, unknown> }> {
  const strategist = String(opts.strategistCombinedBlock || "").trim();
  const baseContextZh = String(opts.baseContextZh || "").trim();
  const briefSource = String(opts.briefSource || "").trim();
  const mergedGuess = [strategist, baseContextZh, briefSource].filter(Boolean).join("\n\n");
  const envForceExtract = ["1", "true", "yes", "on"].includes(
    String(process.env.PLATFORM_COVER_EXTRACT_VISUAL_BRIEF || "")
      .trim()
      .toLowerCase(),
  );
  const autoChars = (() => {
    const raw = Number(process.env.PLATFORM_COVER_EXTRACT_AUTO_CHARS);
    if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
    return 4200;
  })();
  const autoExtract = autoChars > 0 && mergedGuess.length >= autoChars;
  const shouldExtract = opts.enableVisualBriefExtract === true || envForceExtract || autoExtract;
  let extracted = "";
  if (shouldExtract && (strategist || mergedGuess)) {
    try {
      if (autoExtract && !envForceExtract && opts.enableVisualBriefExtract !== true) {
        opts.flowLog.push(
          `${platformFlowLogTimestamp()}  [chineseStaging·cover] 语境过长（${mergedGuess.length}≥${autoChars}）→ 自动 extractChineseVisualBrief`,
        );
      }
      extracted = (
        await opts.extractChineseVisualBrief(strategist || mergedGuess, opts.flowLog)
      ).trim();
    } catch {
      extracted = "";
    }
  } else if (strategist || baseContextZh) {
    opts.flowLog.push(
      `${platformFlowLogTimestamp()}  [chineseStaging·cover] 跳过 GPT 提炼 · 改用无模型语境聚焦（防满屏；超长自动提炼阈值=${autoChars}）`,
    );
  }
  let blob = [extracted, baseContextZh].filter(Boolean).join("\n\n").trim();
  if (!blob) blob = strategist;
  if (!blob) blob = briefSource;
  // 未走 GPT 提炼时：确定性聚焦，保道具行、压长论述
  if (!extracted) {
    blob = focusCoverChineseContextForDirectSend(blob, Math.min(opts.maxChars, COVER_DIRECT_CONTEXT_MAX_CHARS));
  } else if (blob.length > opts.maxChars) {
    blob = blob.slice(0, opts.maxChars);
  }
  return {
    blob,
    provenance: {
      strategistChars: strategist.length,
      extractedChars: extracted.length,
      baseContextChars: baseContextZh.length,
      visualBriefSkipped: !shouldExtract,
      visualBriefAuto: Boolean(autoExtract && shouldExtract && !envForceExtract),
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
