/**
 * 平台页「全案会话」作品包：写入「我的作品」，可回溯文案 / 分镜 / 追问 / 趋势 / 战略全景。
 */

import type { AdvancedAIReportData } from "./advancedAIReport";

export const PLATFORM_SESSION_BUNDLE_TYPE = "platform_session_bundle" as const;
export const PLATFORM_SESSION_BUNDLE_SCHEMA_VERSION = 1 as const;

export type PlatformSessionExecutionCardArtifact = {
  id?: string;
  title?: string;
  hook?: string;
  copywriting?: string;
  format?: string;
  detailedScript?: string;
  publishingAdvice?: string;
  suitablePlatforms?: string[];
  highlightKeywords?: string[];
  coverImageUrl?: string | null;
  storyboardImageUrl?: string | null;
  executionDetails?: {
    environmentAndWardrobe?: string;
    lightingAndCamera?: string;
    stepByStepScript?: string[];
  };
};

export type PlatformSessionDeepQaArtifact = {
  question?: string;
  answer?: string;
  askedAt?: string;
};

export type PlatformSessionBundleArtifact = {
  schemaVersion: typeof PLATFORM_SESSION_BUNDLE_SCHEMA_VERSION;
  capturedAt: string;
  windowDays?: number;
  /** Stage1 战略看板（可截断） */
  platformDashboard?: Record<string, unknown> | null;
  /** Stage2 专属文案 */
  platformContent?: {
    contentBlueprints?: unknown[];
    monetizationLanes?: unknown[];
  } | null;
  /** 平台趋势视觉报表 */
  visualReport?: Record<string, unknown> | null;
  /** 决策智库 / 个人战略全景 */
  decisionIntelReport?: AdvancedAIReportData | null;
  /** 执行区选题卡（含封面/分镜 URL） */
  executionCards?: PlatformSessionExecutionCardArtifact[];
  /** 深度追问 */
  deepQa?: PlatformSessionDeepQaArtifact | null;
  /** 自定义工作区优化稿 / 生成文案 */
  customCopy?: string | null;
  /** 自定义选题主人公说明 */
  customTopicProtagonist?: string | null;
  notes?: string;
};

export function isPlatformSessionBundleMetadata(meta: unknown): meta is {
  isPlatformSessionBundle: true;
  bundle: PlatformSessionBundleArtifact;
  summary?: string;
} {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  return m.isPlatformSessionBundle === true && m.bundle != null && typeof m.bundle === "object";
}

/** 生成列表摘要（≤1800 字） */
export function summarizePlatformSessionBundle(bundle: PlatformSessionBundleArtifact): string {
  const lines: string[] = [];
  lines.push("【平台全案作品包】");
  if (bundle.windowDays) lines.push(`窗口：近 ${bundle.windowDays} 天`);
  const dash = bundle.platformDashboard as { headline?: string; subheadline?: string } | null | undefined;
  if (dash?.headline) lines.push(`看板：${dash.headline}`);
  if (dash?.subheadline) lines.push(dash.subheadline);
  const bpCount = Array.isArray(bundle.platformContent?.contentBlueprints)
    ? bundle.platformContent!.contentBlueprints!.length
    : 0;
  if (bpCount) lines.push(`专属文案选题：${bpCount} 条`);
  const execCount = Array.isArray(bundle.executionCards) ? bundle.executionCards.length : 0;
  if (execCount) {
    lines.push(`执行卡：${execCount} 条`);
    for (const c of (bundle.executionCards || []).slice(0, 4)) {
      if (c?.title) lines.push(`· ${c.title}`);
    }
  }
  if (bundle.decisionIntelReport) lines.push("已含：个人战略全景（决策智库）");
  if (bundle.visualReport) lines.push("已含：平台趋势分析图");
  if (bundle.deepQa?.answer) lines.push("已含：深度追问答复");
  if (bundle.customCopy?.trim()) lines.push("已含：自定义生成文案");
  return lines.join("\n").slice(0, 1800);
}
