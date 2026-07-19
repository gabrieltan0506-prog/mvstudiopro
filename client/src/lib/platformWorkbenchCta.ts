/**
 * Platform 双模式 · 各模式唯一主 CTA 状态表（点数来自 plans / helpers，禁止写死）。
 * 视觉只有一个 CTA，但 handler / confirm / 计费路径必须按模式隔离。
 */

import {
  CREDIT_COSTS,
  platformCustomMattingTotalCredits,
  type PlatformMattingBatchCount,
} from "@shared/plans";
import { platformTopicShortlistTotalCredits } from "@shared/platformTopicShortlist";
import type { PlatformCreateStepId, PlatformWorkbenchMode } from "./platformWorkbenchMode";

export type PlatformCtaConfirmKind =
  | "none"
  | "trend_standalone"
  | "fullcase_stage2"
  | "topic_shortlist"
  | "custom_copy"
  | "custom_topic"
  | "custom_matting"
  | "html_ppt";

export type PlatformPrimaryCtaState = {
  mode: PlatformWorkbenchMode;
  label: string;
  credits: number;
  creditsLabel: string;
  disabled: boolean;
  disabledReason?: string;
  busy: boolean;
  confirmKind: PlatformCtaConfirmKind;
  /** 文档/调试用：对应既有 handler 名 */
  handlerKey:
    | "handleTrendStandaloneAnalyze"
    | "handleAnalyze"
    | "generateTopicShortlist"
    | "customMattingGenerate"
    | "panelLocal"
    | "noop";
};

type CreateCtaInput = {
  createStep: PlatformCreateStepId;
  focusPrompt: string;
  topicShortlistCount: number;
  isAuthenticated: boolean;
  shortlistPending: boolean;
  fullcaseBusy: boolean;
  customNoteBusy: boolean;
  hasTopicResults: boolean;
};

type TrendCtaInput = {
  selectedPlatformCount: number;
  isAuthenticated: boolean;
  busy: boolean;
};

type ToolsCtaInput = {
  toolsTab: "htmlPpt" | "matting" | "assets";
  isAuthenticated: boolean;
  mattingPrompt: string;
  mattingCount: PlatformMattingBatchCount;
  mattingBusy: boolean;
  customNoteBusy: boolean;
  customTopicBusy: boolean;
  assetBusy: boolean;
};

export function buildCreatePrimaryCta(input: CreateCtaInput): PlatformPrimaryCtaState {
  const shortlistPrice = platformTopicShortlistTotalCredits({
    count: input.topicShortlistCount,
    baseCredits: CREDIT_COSTS.platformTopicShortlist,
    extraPerTopic: CREDIT_COSTS.platformTopicShortlistExtra,
  });
  const stage2Credits = CREDIT_COSTS.platformStage2Copywriting;

  if (input.createStep === "topics" || input.createStep === "persona" || input.createStep === "skills") {
    const disabled =
      !input.isAuthenticated || !input.focusPrompt.trim() || input.shortlistPending;
    return {
      mode: "create",
      label: input.shortlistPending
        ? "选题生成中…"
        : `生成 ${shortlistPrice.count} 条选题 · 预计 ${shortlistPrice.total} 点`,
      credits: shortlistPrice.total,
      creditsLabel: `${shortlistPrice.total} 点`,
      disabled,
      disabledReason: !input.isAuthenticated
        ? "请先登录后再生成选题"
        : !input.focusPrompt.trim()
          ? "请先填写人物背景"
          : input.shortlistPending
            ? "正在生成选题，请稍候"
            : undefined,
      busy: input.shortlistPending,
      confirmKind: "topic_shortlist",
      handlerKey: "generateTopicShortlist",
    };
  }

  if (input.createStep === "copy" || input.createStep === "output") {
    return {
      mode: "create",
      label: input.fullcaseBusy
        ? "全案生成中…"
        : `生成选题与文案 · 预计 ${stage2Credits} 点`,
      credits: stage2Credits,
      creditsLabel: `${stage2Credits} 点`,
      disabled: !input.isAuthenticated || !input.focusPrompt.trim() || input.fullcaseBusy,
      disabledReason: !input.isAuthenticated
        ? "请先登录"
        : !input.focusPrompt.trim()
          ? "请先填写人物背景"
          : input.fullcaseBusy
            ? "全案任务进行中"
            : undefined,
      busy: input.fullcaseBusy,
      confirmKind: "fullcase_stage2",
      handlerKey: "handleAnalyze",
    };
  }

  // result
  return {
    mode: "create",
    label: input.hasTopicResults ? "查看结果 / 继续扩写" : `生成 ${shortlistPrice.count} 条选题 · 预计 ${shortlistPrice.total} 点`,
    credits: shortlistPrice.total,
    creditsLabel: `${shortlistPrice.total} 点`,
    disabled: !input.isAuthenticated || (!input.hasTopicResults && !input.focusPrompt.trim()),
    disabledReason: !input.isAuthenticated
      ? "请先登录"
      : !input.focusPrompt.trim()
        ? "请先填写人物背景"
        : undefined,
    busy: input.shortlistPending || input.customNoteBusy,
    confirmKind: input.hasTopicResults ? "none" : "topic_shortlist",
    handlerKey: input.hasTopicResults ? "noop" : "generateTopicShortlist",
  };
}

export function buildTrendPrimaryCta(input: TrendCtaInput): PlatformPrimaryCtaState {
  const credits = CREDIT_COSTS.platformTrend;
  const disabled =
    !input.isAuthenticated || input.selectedPlatformCount !== 1 || input.busy;
  return {
    mode: "trend",
    label: input.busy ? "趋势分析中…" : `开始趋势分析 · 预计 ${credits} 点`,
    credits,
    creditsLabel: `${credits} 点/次`,
    disabled,
    disabledReason: !input.isAuthenticated
      ? "请先登录后再分析"
      : input.selectedPlatformCount !== 1
        ? "请单选一个分析平台"
        : input.busy
          ? "分析进行中，请稍候"
          : undefined,
    busy: input.busy,
    confirmKind: "trend_standalone",
    handlerKey: "handleTrendStandaloneAnalyze",
  };
}

export function buildToolsPrimaryCta(input: ToolsCtaInput): PlatformPrimaryCtaState {
  if (input.toolsTab === "matting") {
    const credits = platformCustomMattingTotalCredits(input.mattingCount);
    const busy = input.mattingBusy;
    const disabled = !input.isAuthenticated || !input.mattingPrompt.trim() || busy;
    return {
      mode: "tools",
      label: busy ? "抠像生成中…" : `开始抠像 · 预计 ${credits} 点`,
      credits,
      creditsLabel: `${credits} 点`,
      disabled,
      disabledReason: !input.isAuthenticated
        ? "请先登录"
        : !input.mattingPrompt.trim()
          ? "请先填写主体描述"
          : busy
            ? "生成中"
            : undefined,
      busy,
      confirmKind: "custom_matting",
      handlerKey: "customMattingGenerate",
    };
  }

  // PPT / 素材：无页级扣费 CTA，仅引导面板内唯一步骤按钮（禁止落入 create/trend handler）
  if (input.toolsTab === "assets") {
    return {
      mode: "tools",
      label: input.assetBusy ? "面板分析中…" : "请在下方面板内操作",
      credits: 0,
      creditsLabel: "面板内计价",
      disabled: !input.isAuthenticated,
      disabledReason: !input.isAuthenticated ? "请先登录" : undefined,
      busy: input.assetBusy,
      confirmKind: "none",
      handlerKey: "panelLocal",
    };
  }

  return {
    mode: "tools",
    label: "请在下方面板内操作",
    credits: 0,
    creditsLabel: "面板内计价",
    disabled: !input.isAuthenticated,
    disabledReason: !input.isAuthenticated ? "请先登录" : undefined,
    busy: false,
    confirmKind: "html_ppt",
    handlerKey: "panelLocal",
  };
}

/** 供文档与测试：汇总三模式 CTA 字段 */
export function describePlatformCtaMatrix(): Array<{
  mode: PlatformWorkbenchMode;
  labelExample: string;
  creditsSource: string;
  confirmKind: PlatformCtaConfirmKind;
  handlerKey: string;
}> {
  return [
    {
      mode: "create",
      labelExample: "生成 N 条选题 · 预计 X 点 / 生成选题与文案 · 预计 Y 点",
      creditsSource: "CREDIT_COSTS.platformTopicShortlist(+Extra) / platformStage2Copywriting",
      confirmKind: "topic_shortlist",
      handlerKey: "generateTopicShortlist | handleAnalyze",
    },
    {
      mode: "trend",
      labelExample: "开始趋势分析 · 预计 X 点",
      creditsSource: "CREDIT_COSTS.platformTrend",
      confirmKind: "trend_standalone",
      handlerKey: "handleTrendStandaloneAnalyze",
    },
    {
      mode: "tools",
      labelExample: "开始抠像 / 素材分析 / 动效 PPT（面板内）",
      creditsSource: "platformCustomMattingTotalCredits / 面板内 htmlPpt·assets helpers",
      confirmKind: "custom_matting",
      handlerKey: "customMattingGenerate | panel-local",
    },
  ];
}
