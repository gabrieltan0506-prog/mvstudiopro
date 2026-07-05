import { patchJobRunningProgress } from "../jobs/repository";
import type { GrowthAnalysisScores } from "../../shared/growth";

export type AssetAnalysisProgressPayload = {
  partialAnalysis?: Partial<GrowthAnalysisScores>;
  analysisStage?: string;
  analysisStageLabel?: string;
};

export type AssetAnalysisProgressReporter = {
  patch: (payload: AssetAnalysisProgressPayload) => Promise<void>;
};

export function createAssetAnalysisProgressReporter(
  jobId?: string,
): AssetAnalysisProgressReporter | undefined {
  if (!jobId) return undefined;
  return {
    patch: async (payload) => {
      await patchJobRunningProgress(jobId, payload);
    },
  };
}

type AudioScanLike = {
  contentSummary?: string;
  hookSummary?: string;
  audiencePromise?: string;
  commercialPotential?: number;
  creatorSignals?: string[];
  priorityMoments?: Array<{ timestamp: string; reason: string; action?: string }>;
  deepDiveBrief?: string;
  transcriptSummary?: string;
};

/** Stage 1 语音 scan 完成后，先推一版可读 partial 供前端滚动展示 */
export function buildPartialFromAudioScan(audio: AudioScanLike): Partial<GrowthAnalysisScores> {
  const partial: Partial<GrowthAnalysisScores> = {};
  const summary = String(audio.contentSummary || audio.transcriptSummary || "").trim();
  const hook = String(audio.hookSummary || "").trim();
  if (summary) partial.summary = summary;
  if (hook) partial.visualSummary = hook;
  if (audio.creatorSignals?.length) {
    partial.strengths = audio.creatorSignals.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 5);
  }
  if (audio.priorityMoments?.length) {
    partial.titleSuggestions = audio.priorityMoments
      .map((m) => `${m.timestamp} · ${String(m.reason || "").trim()}`.trim())
      .filter(Boolean)
      .slice(0, 6);
  }
  if (hook || audio.audiencePromise || audio.deepDiveBrief) {
    partial.reverseEngineering = {
      hookStrategy: hook,
      emotionalArc: String(audio.audiencePromise || "").trim(),
      commercialLogic: String(audio.deepDiveBrief || "").trim().slice(0, 400),
    };
  }
  if (typeof audio.commercialPotential === "number" && audio.commercialPotential > 0) {
    const score = Math.min(10, Math.max(1, Math.round(audio.commercialPotential / 10)));
    partial.impact = score;
    partial.viralPotential = score;
  }
  return partial;
}
