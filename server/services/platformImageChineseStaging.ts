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

export async function buildCoverChineseBlobForStaging(opts: {
  strategistCombinedBlock: string;
  baseContextZh: string;
  briefSource: string;
  extractChineseVisualBrief: (raw: string, log?: string[]) => Promise<string>;
  flowLog: string[];
  maxChars: number;
  /**
   * 中文直送主路径默认 **不** 再跑 GPT 5.4 `extractChineseVisualBrief`（可省一轮 LLM）。
   * 显式 `true`，或 env `PLATFORM_COVER_EXTRACT_VISUAL_BRIEF=1` 时才提炼。
   */
  enableVisualBriefExtract?: boolean;
}): Promise<{ blob: string; provenance: Record<string, unknown> }> {
  const strategist = String(opts.strategistCombinedBlock || "").trim();
  const envForceExtract = ["1", "true", "yes", "on"].includes(
    String(process.env.PLATFORM_COVER_EXTRACT_VISUAL_BRIEF || "")
      .trim()
      .toLowerCase(),
  );
  const shouldExtract = opts.enableVisualBriefExtract === true || envForceExtract;
  let extracted = "";
  if (shouldExtract && strategist) {
    try {
      extracted = (await opts.extractChineseVisualBrief(strategist, opts.flowLog)).trim();
    } catch {
      extracted = "";
    }
  } else if (strategist) {
    opts.flowLog.push(
      `${platformFlowLogTimestamp()}  [chineseStaging·cover] 跳过 extractChineseVisualBrief（中文直送默认；设 PLATFORM_COVER_EXTRACT_VISUAL_BRIEF=1 可开）`,
    );
  }
  let blob = [extracted, String(opts.baseContextZh || "").trim()].filter(Boolean).join("\n\n").trim();
  if (!blob) blob = strategist;
  if (!blob) blob = String(opts.briefSource || "").trim();
  if (blob.length > opts.maxChars) blob = blob.slice(0, opts.maxChars);
  return {
    blob,
    provenance: {
      strategistChars: strategist.length,
      extractedChars: extracted.length,
      baseContextChars: String(opts.baseContextZh || "").trim().length,
      visualBriefSkipped: !shouldExtract,
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
