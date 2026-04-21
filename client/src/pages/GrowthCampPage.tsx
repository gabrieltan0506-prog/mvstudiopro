import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { JOB_PROGRESS_MESSAGES, createJob, getJob } from "@/lib/jobs";
import { trpc } from "@/lib/trpc";
import { UsageQuotaBanner } from "@/components/UsageQuotaBanner";
import { StudentUpgradePrompt } from "@/components/StudentUpgradePrompt";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { QuotaExhaustedModal } from "@/components/QuotaExhaustedModal";
import { saveGrowthHandoff } from "@/lib/growthHandoff";
import type {
  GrowthAuthorAnalysis,
  GrowthBusinessInsight,
  GrowthCampModel,
  GrowthHandoff,
  GrowthHotWordMatch,
  GrowthPlanStep,
  GrowthPlatformRecommendation,
  GrowthPushActivity,
  GrowthReferenceExample,
  GrowthSnapshot,
} from "@shared/growth";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CircleDollarSign,
  Compass,
  Download,
  FileUp,
  Film,
  LayoutDashboard,
  LineChart as LineChartIcon,
  Loader2,
  Music2,
  Orbit,
  Play,
  Rocket,
  ScanSearch,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  User,
  Workflow,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

type AnalysisResult = {
  composition: number;
  color: number;
  lighting: number;
  impact: number;
  viralPotential: number;
  explosiveIndex?: number;
  platformScores?: {
    xiaohongshu?: number;
    douyin?: number;
    bilibili?: number;
    kuaishou?: number;
  };
  realityCheck?: string;
  reverseEngineering?: {
    hookStrategy?: string;
    emotionalArc?: string;
    commercialLogic?: string;
  };
  premiumContent?: {
    summary?: string;
    strategy?: string;
    topics?: Array<{
      title: string;
      formatType?: "VIDEO" | "IMAGE_TEXT";
      businessInsight?: string;
      contentBrief: string;
      directorExecution?: {
        storyboard?: string[];
        lighting?: string;
        blocking?: string;
        emotionalTension?: string;
      };
    }>;
    explosiveTopicAnalysis?: string;
    musicAndExpressionAnalysis?: string;
    personalizedGrowthDirection?: string;
    actionableTopics?: Array<{
      title: string;
      formatType?: "VIDEO" | "IMAGE_TEXT";
      businessInsight?: string;
      contentBrief: string;
      directorExecution?: {
        storyboard?: string[];
        lighting?: string;
        blocking?: string;
        emotionalTension?: string;
      };
    }>;
  };
  growthStrategy?: {
    gapAnalysis?: string;
    commercialMatrix?: string;
  };
  remixExecution?: {
    hookLibrary?: string[];
    emotionalPacing?: string;
    visualPaletteAndScript?: string;
    productMatrix?: string;
    shootingGuidance?: string;
    businessInsight?: {
      video?: string;
      imageText?: string;
      monetizationLogic?: string;
    };
    shootingBlueprint?: {
      storyboard?: string[];
      lighting?: string;
      blocking?: string;
      shotSize?: string;
      emotionalTension?: string;
      cameraPerformance?: string;
    };
    imageTextNoteGuide?: {
      coverSetup?: string;
      titleOptions?: string[];
      structuredBody?: string;
    };
    xiaohongshuLayout?: string;
  };
  visualSummary?: string;
  openingFrameAssessment?: string;
  sceneConsistency?: string;
  languageExpression?: string;
  emotionalExpression?: string;
  cameraEmotionTension?: string;
  bgmAnalysis?: string;
  musicRecommendation?: string;
  sunoPrompt?: string;
  trustSignals?: string[];
  visualRisks?: string[];
  keyFrames?: Array<{
    timestamp: string;
    whatShows: string;
    commercialUse: string;
    issue: string;
    fix: string;
  }>;
  strengths: string[];
  improvements: string[];
  platforms: string[];
  summary: string;
  titleSuggestions?: string[];
  creatorCenterSignals?: string[];
  timestampSuggestions?: Array<{
    timestamp: string;
    issue: string;
    fix: string;
    opportunity?: string;
  }>;
  weakFrameReferences?: Array<{
    timestamp: string;
    reason: string;
    fix: string;
  }>;
  commercialAngles?: Array<{
    title: string;
    scenario: string;
    whyItFits: string;
    brands: string[];
    execution: string;
    hook: string;
    veoPrompt?: string;
  }>;
  followUpPrompt?: string;
};

type ShootingBlueprintView = {
  storyboard: string[];
  lighting: string;
  blocking: string;
  shotSize: string;
  emotionalTension: string;
  cameraPerformance: string;
};

function normalizeShootingBlueprint(
  value: unknown,
  fallback = "",
): ShootingBlueprintView {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const blueprint = value as Partial<ShootingBlueprintView>;
    return {
      storyboard: Array.isArray(blueprint.storyboard) ? blueprint.storyboard.filter(Boolean) : [],
      lighting: blueprint.lighting || "",
      blocking: blueprint.blocking || "",
      shotSize: blueprint.shotSize || "",
      emotionalTension: blueprint.emotionalTension || "",
      cameraPerformance: blueprint.cameraPerformance || "",
    };
  }
  const text = typeof value === "string" ? value : fallback;
  return {
    storyboard: text ? [text] : [],
    lighting: "",
    blocking: "",
    shotSize: "",
    emotionalTension: "",
    cameraPerformance: "",
  };
}

type PremiumTopic = NonNullable<NonNullable<AnalysisResult["premiumContent"]>["topics"]>[number];

function renderPremiumTopicCards(
  topics: PremiumTopic[] | undefined,
  replaceTermsFn: (s: string) => string,
) {
  if (!topics?.length) return null;
  return (
    <div className="mt-5 grid gap-6">
      {topics.map((topic, i) => {
        const formatType = topic.formatType === "IMAGE_TEXT" ? "IMAGE_TEXT" : "VIDEO";
        const directorExecution = topic.directorExecution || {};
        const storyboard = Array.isArray(directorExecution.storyboard)
          ? directorExecution.storyboard.filter(Boolean)
          : [];
        return (
          <div key={`${topic.title}-${i}`} className="rounded-2xl border border-white/10 bg-black/20 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-white">{replaceTermsFn(topic.title)}</div>
                <div className="mt-2 text-sm leading-7 text-white/78">{replaceTermsFn(topic.contentBrief)}</div>
              </div>
              <div className="shrink-0 rounded-full border border-[#f5b7ff]/20 bg-[#f5b7ff]/10 px-3 py-1 text-xs font-semibold text-[#f5b7ff]">
                {formatType === "IMAGE_TEXT" ? "📝 精致优质图文笔记" : "🎥 视频拍摄"}
              </div>
            </div>
            {topic.businessInsight ? (
              <div className="mt-4 rounded-xl border-l-4 border-emerald-500 bg-emerald-500/10 p-5">
                <h5 className="mb-2 font-bold text-emerald-400">💎 商业深度洞察</h5>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                  {topic.businessInsight}
                </p>
              </div>
            ) : null}
            {(storyboard.length || directorExecution.lighting || directorExecution.blocking || directorExecution.emotionalTension) ? (
              <div className="mt-4 rounded-xl bg-[#15c8ff]/10 p-5">
                <h5 className="mb-4 font-bold text-[#15c8ff]">🎬 导演级执行蓝图</h5>
                <div className="mb-4 grid gap-4 text-sm text-gray-300 md:grid-cols-3">
                  {directorExecution.lighting ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <strong>灯光：</strong>{replaceTermsFn(directorExecution.lighting)}
                    </div>
                  ) : null}
                  {directorExecution.blocking ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <strong>走位：</strong>{replaceTermsFn(directorExecution.blocking)}
                    </div>
                  ) : null}
                  {directorExecution.emotionalTension ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <strong>情绪：</strong>{replaceTermsFn(directorExecution.emotionalTension)}
                    </div>
                  ) : null}
                </div>
                {storyboard.length ? (
                  <ol className="list-inside list-decimal space-y-2 text-sm text-gray-300">
                    {storyboard.map((shot, sIdx) => (
                      <li key={sIdx}>{replaceTermsFn(shot)}</li>
                    ))}
                  </ol>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

type UploadStage = "idle" | "reading" | "uploading" | "analyzing" | "done" | "error";
type InputKind = "document" | "video";
type DebugInfo = Record<string, unknown> | null;
type MusicProvider = "suno" | "udio";
type MusicGenerationStatus = "idle" | "generating" | "polling" | "success" | "error";
type GeneratedMusicSong = {
  id: string;
  title: string;
  audioUrl?: string;
  streamUrl?: string;
  imageUrl?: string;
  duration?: number;
  tags?: string;
};

type VideoPipelineDebug = {
  mode?: "direct" | "job";
  selectedFile?: {
    name?: string;
    size?: number;
    mimeType?: string;
  };
  upload?: {
    status?: "idle" | "started" | "done" | "failed";
    progress?: number;
    url?: string;
    key?: string;
    gcsUri?: string;
    strategy?: "signed-url" | "legacy-upload";
    signedUrlError?: string;
    error?: string;
  };
  dispatch?: {
    status?: "idle" | "started" | "done" | "failed";
    modelName?: string;
    route?: "mvAnalysis.analyzeVideo" | "growth_analyze_video";
    error?: string;
  };
  job?: {
    jobId?: string;
    status?: string;
    pollCount?: number;
    error?: string;
  };
  analysis?: {
    status?: "idle" | "started" | "done" | "failed";
    provider?: string;
    model?: string;
    fallback?: boolean;
    failureStage?: string;
    failureReason?: string;
    transcriptChars?: number;
    videoDuration?: number;
    error?: string;
  };
};

type CommercialTrack = {
  name: string;
  fit: number;
  reason: string;
  nextStep: string;
};

type ExecutionBriefRow = {
  label: string;
  content: string;
};

type DashboardMetric = {
  id: string;
  label: string;
  value: string;
  note: string;
  tone: string;
};

type DashboardPanel = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  detail: string;
  action: string;
  accent: string;
  glow: string;
};

type InsightTableRow = {
  label: string;
  insight: string;
  action: string;
  highlight?: string;
};

type ProcessingStepCard = {
  id: string;
  label: string;
  detail: string;
  status: "done" | "active" | "pending";
};

function revealText(text: string, elapsedTime: number, seed = 0, speed = 22) {
  const normalized = String(text || "");
  if (!normalized) return "";
  const visibleCount = Math.max(1, Math.min(normalized.length, Math.floor(elapsedTime * speed) - seed));
  return normalized.slice(0, visibleCount);
}

type TrendTableRow = {
  platform: string;
  topic: string;
  reason: string;
  action: string;
  highlight?: string;
};

type PlatformCompareRow = {
  metric: string;
  primaryValue: string;
  compareValue: string;
  verdict: string;
};

type ReferenceExampleCard = GrowthReferenceExample;
type PersonalizedDirectionCard = {
  title: string;
  scenario: string;
  why: string;
  action: string;
  badge: string;
};

const SUPERVISOR_ACCESS_KEY = "mvs-supervisor-access";
const FULL_PLATFORM_ORDER = ["douyin", "kuaishou", "bilibili", "xiaohongshu"] as const;
const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B站",
  kuaishou: "快手",
  toutiao: "头条",
};
const COLLECTED_PLATFORM_LABELS = ["抖音", "小红书", "B站", "快手", "头条"] as const;
const CORE_PLATFORM_LABELS = ["抖音", "小红书", "B站", "快手"] as const;

const PLATFORM_REFERENCE_SUMMARY: Record<(typeof CORE_PLATFORM_LABELS)[number], string> = {
  抖音: "抖音更偏短视频结果前置、动作演示、强钩子口播和同城到店承接，适合把同一主题压缩成 15 到 45 秒的高反差内容。",
  小红书: "小红书更适合图文笔记 + 视频双轨表达，重点不是硬成交，而是先拿收藏、搜索、评论，再承接咨询和私信。",
  "B站": "B站更适合中长视频、案例复盘、方法拆解和系列化更新，能把专业信任和长期搜索流量做起来。",
  快手: "快手更适合真实口播、生活场景、同城服务和直播联动，讲法要更直给、更生活化、更强调真实体验。",
};

const PLATFORM_REFERENCE_TRACKS: Record<(typeof CORE_PLATFORM_LABELS)[number], string[]> = {
  抖音: ["结果前置", "动作演示", "同城门店", "体验课承接"],
  小红书: ["产后修复", "肩颈调理", "女性体态", "收藏型种草"],
  "B站": ["方法拆解", "案例复盘", "长视频问答", "系列化教程"],
  快手: ["宝妈日常", "真实体验", "直播联动", "同城服务"],
};

const PLATFORM_SUPPORT_ACTIVITY_FALLBACK: Record<(typeof CORE_PLATFORM_LABELS)[number], string[]> = {
  抖音: ["中视频伙伴计划"],
  小红书: ["小红书电商与买手成长扶持", "小红书商家 / 主理人 / 服务商成长扶持"],
  "B站": ["创作激励", "任务中心征稿"],
  快手: ["快手光合计划与创作者成长扶持", "快手直播与短直联动扶持"],
};

const PLATFORM_SUPPORT_SIGNAL_FALLBACK: Record<(typeof CORE_PLATFORM_LABELS)[number], string> = {
  抖音: "优先走结果前置和动作演示，适合用短视频先验证停留、评论和门店转化。",
  小红书: "优先走图文收藏和搜索承接，再把跑通的主题拆成短视频版本。",
  "B站": "优先走方法拆解和复盘长视频，先建立信任，再延展成系列内容。",
  快手: "优先走真实口播和生活场景表达，适合同城服务与直播联动放大。",
};

const PLATFORM_GRAPHIC_ANALYSIS_PROFILE: Record<(typeof CORE_PLATFORM_LABELS)[number], {
  contentForm: string;
  noteType: string;
  valueMode: string;
  structure: string[];
  why: string;
}> = {
  抖音: {
    contentForm: "短视频主发，图文只做转化承接页",
    noteType: "结果前置型转化图文",
    valueMode: "先拿停留、评论和同城咨询，再承接到店或体验课",
    structure: [
      "封面只写一个结果句或价格反差，不写长说明。",
      "第 1 屏直接讲最痛的问题或最大结果，别先讲背景。",
      "第 2 到 3 屏放动作前后对比、局部特写或服务步骤。",
      "第 4 屏只讲一个可信证据，例如学员反馈、门店场景或价格锚点。",
      "最后 1 屏只留一个动作，引导评论词、私信词或预约。",
    ],
    why: "抖音更吃结果、动作和反差，图文不是拿来深读，而是拿来承接短视频种下来的强意图流量。",
  },
  小红书: {
    contentForm: "图文和视频双轨并行，但图文优先验证",
    noteType: "搜索承接型种草图文",
    valueMode: "先拿收藏、搜索和评论，再承接私信、咨询或体验课",
    structure: [
      "封面写一个可收藏的问题或结果，例如肩颈、产后、体态这类高搜索词。",
      "第 1 屏讲谁最需要和为什么会出现这个问题。",
      "第 2 到 4 屏用图示、动作、前后对比或误区解释拉高收藏价值。",
      "第 5 屏补信任证据，例如专业身份、真实反馈、门店环境或价格结构。",
      "最后 1 屏只保留一个动作，优先是评论关键词、收藏后私信或咨询入口。",
    ],
    why: "小红书的图文承担的是搜索和收藏资产，不是像抖音那样直接硬成交，所以笔记必须写得更完整、更可保存。",
  },
  "B站": {
    contentForm: "中长视频主发，图文负责方法拆解和系列目录",
    noteType: "信任建立型方法图文",
    valueMode: "先积累专业信任、系列更新和搜索长尾，再做服务或课程承接",
    structure: [
      "封面先写方法结论或常见误区，明确这是给谁看的。",
      "第 1 屏先给结果，再交代本期会拆哪 3 个点。",
      "第 2 到 4 屏讲方法逻辑、误区和案例，不要只放金句。",
      "第 5 屏补一条可执行清单，让用户觉得这篇值得反复看。",
      "最后 1 屏引导去看长视频、合集或下一篇系列内容。",
    ],
    why: "B站用户愿意花时间理解方法和案例，所以图文要承担目录、知识索引和系列承接，而不是只做种草。",
  },
  快手: {
    contentForm: "短视频和直播联动主发，图文负责同城服务补充",
    noteType: "生活场景型服务图文",
    valueMode: "先吃同城和真实表达，再承接直播、到店、私聊或社群复访",
    structure: [
      "封面用最直白的话讲值不值、适不适合，不写抽象标题。",
      "第 1 屏讲真实生活场景和用户为什么现在就需要。",
      "第 2 到 3 屏放真实体验、门店氛围或家人/学员反馈。",
      "第 4 屏讲最省事的做法，避免专业术语太重。",
      "最后 1 屏引导直播、同城咨询或私聊，不要塞多个动作。",
    ],
    why: "快手更吃真实、生活化和同城关系，图文是视频和直播之外的补充承接，不是做精致排版竞赛。",
  },
};

const PLATFORM_DEBUG_DESCRIPTIONS: Record<string, string> = {
  douyin: "短视频主阵地，优先看热点和爆发趋势。",
  xiaohongshu: "种草与搜索场景，优先看内容沉淀和转化线索。",
  bilibili: "中长视频社区，优先看深度内容和长期沉淀。",
  kuaishou: "高频更新场景，优先看稳定增量和直播相关表现。",
  toutiao: "资讯分发场景，适合单独看补齐情况和历史恢复状态。",
};

function getPlatformLabel(platform?: string) {
  const key = String(platform || "").trim();
  return PLATFORM_LABELS[key] || key || "-";
}

function getPlatformDescription(platform?: string) {
  const key = String(platform || "").trim();
  return PLATFORM_DEBUG_DESCRIPTIONS[key] || "平台说明暂未配置。";
}

function isCollectedPlatformLabel(label?: string) {
  return COLLECTED_PLATFORM_LABELS.includes(String(label || "").trim() as (typeof COLLECTED_PLATFORM_LABELS)[number]);
}

function isCorePlatformLabel(label?: string) {
  return CORE_PLATFORM_LABELS.includes(String(label || "").trim() as (typeof CORE_PLATFORM_LABELS)[number]);
}

function formatPlatformList(platforms: unknown) {
  return Array.isArray(platforms)
    ? platforms.map((platform) => getPlatformLabel(String(platform))).join("、") || "-"
    : "-";
}

function formatTruthSource(source?: string) {
  if (source === "platform-current") return "平台真值档";
  if (source === "derived-platforms") return "平台派生档";
  if (source === "current-json") return "单一 current.json";
  return String(source || "-");
}

function formatShanghaiDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}-${map.hour}:${map.minute}:${map.second}`;
}

function hasSupervisorAccess() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("supervisor") === "1") {
    localStorage.setItem(SUPERVISOR_ACCESS_KEY, "1");
    return true;
  }
  return localStorage.getItem(SUPERVISOR_ACCESS_KEY) === "1";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event.target?.result || ""));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

async function uploadFileWithProgress(file: File, onProgress: (percent: number) => void) {
  return new Promise<{ url?: string; key?: string }>((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload", true);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.max(1, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      onProgress(percent);
    };

    xhr.onerror = () => reject(new Error("视频上传失败，请检查网络后重试"));
    xhr.onabort = () => reject(new Error("视频上传已中断"));
    xhr.onload = () => {
      const raw = xhr.responseText || "";
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(raw || `视频上传失败 (${xhr.status})`));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error(raw.startsWith("<!DOCTYPE") ? "上传接口返回了页面内容，不是 JSON。" : "上传完成但返回格式异常。"));
      }
    };

    xhr.send(formData);
  });
}

async function uploadFileToSignedUrl(params: {
  file: File;
  uploadUrl: string;
  headers?: Record<string, string>;
  onProgress: (percent: number) => void;
}) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", params.uploadUrl, true);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.max(1, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      params.onProgress(percent);
    };

    xhr.onerror = () => reject(new Error("GCS 直传失败，请检查网络后重试"));
    xhr.onabort = () => reject(new Error("GCS 直传已中断"));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(xhr.responseText || `GCS 直传失败 (${xhr.status})`));
        return;
      }
      resolve();
    };

    xhr.setRequestHeader("Content-Type", params.file.type || "application/octet-stream");
    for (const [key, value] of Object.entries(params.headers || {})) {
      if (!value) continue;
      xhr.setRequestHeader(key, value);
    }
    xhr.send(params.file);
  });
}

async function extractVideoPreview(file: File) {
  return new Promise<string>((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      URL.revokeObjectURL(url);
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const done = (value: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    video.onerror = () => fail("视频读取失败，请重试");
    video.onloadedmetadata = () => {
      const targetTime = Math.min(
        Math.max(video.duration * 0.2, 0.15),
        Math.max(0.15, video.duration - 0.15),
      );
      if (!Number.isFinite(video.duration) || video.videoWidth <= 0 || video.videoHeight <= 0) {
        fail("视频元数据读取失败，请重试");
        return;
      }
      if (targetTime <= 0.16) {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          fail("视频封面生成失败，请重试");
          return;
        }
        ctx.drawImage(video, 0, 0);
        done(canvas.toDataURL("image/jpeg", 0.9));
        return;
      }
      video.currentTime = targetTime;
    };

    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        fail("视频封面生成失败，请重试");
        return;
      }
      ctx.drawImage(video, 0, 0);
      done(canvas.toDataURL("image/jpeg", 0.9));
    };

    video.load();
  });
}

function getScoreTone(score: number) {
  if (score >= 80) return { label: "强", color: "text-emerald-300", chip: "border-emerald-300/20 bg-emerald-400/10 text-emerald-200" };
  if (score >= 65) return { label: "可放大", color: "text-amber-200", chip: "border-amber-300/20 bg-amber-400/10 text-amber-100" };
  return { label: "需重构", color: "text-rose-200", chip: "border-rose-300/20 bg-rose-400/10 text-rose-100" };
}

function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`;
  return `${Math.round(value)}`;
}

function isPanelLinked(activePanel: string, panelId: string) {
  return (PANEL_SECTION_LINKS[activePanel] || [activePanel]).includes(panelId);
}

function compactText(text: string, maxLength = 72) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function inferGraphicGoal(platformNames: string[]) {
  const text = platformNames.join(" ");
  if (/小红书/.test(text)) return "图文首发更适合种草与搜索承接，重点不是硬卖，而是让用户先收藏、转发、私信。";
  if (/抖音|头条|快手/.test(text)) return "图文更适合做转化预热，重点是把适合谁、解决什么、为什么值得马上行动写清楚。";
  if (/B站/.test(text)) return "图文更适合做方法拆解与信任补充，让用户先看懂你的专业判断，再决定是否继续看视频。";
  return "图文更适合先把人群、痛点、动作和结果讲透，再承接后续咨询或私信。";
}

function inferVideoGoal(platformNames: string[]) {
  const text = platformNames.join(" ");
  if (/抖音|快手|头条/.test(text)) return "视频首发更适合直接转化，前 2 秒必须先给最扎心的问题、结果或价格反差。";
  if (/小红书/.test(text)) return "视频首发更适合放大共鸣与信任，画面要明显优于图文，不能只是长口播。";
  if (/B站/.test(text)) return "视频首发更适合做完整讲解与信任建立，要把方法、误区和结果讲成一个完整结构。";
  return "视频首发更适合用镜头、动作和结果对比建立信任，再承接后续行动。";
}

function buildGraphicNoteDetail(
  platformNames: string[],
  graphicPlan?: string,
  openingHook?: string,
) {
  const names = platformNames.join("、");
  const isXhs = platformNames.includes("小红书");
  const isVideoPlatform = platformNames.some((item) => /抖音|快手|头条/.test(item));
  const noteType = isXhs ? "搜索承接型种草图文" : isVideoPlatform ? "转化承接型图文" : "信任建立型图文";
  const reason = isXhs
    ? "这类内容更适合先让用户收藏、搜索和私信，所以图文不是简单复述视频，而是把痛点、动作、前后对比和门店承接讲透。"
    : isVideoPlatform
      ? "这类图文更适合作为短视频后的承接页，重点是把价格、适合谁、解决什么问题和真实对比写得足够直白。"
      : "这类图文更适合承接解释和信任建立，让用户在看完视频后进一步理解专业判断。";
  const structure = graphicPlan || "第一页只写最痛的问题或最直接的结果，第二页写谁最需要，第三到四页给动作和前后对比，第五页给证据，第六页只留一个行动。";
  return {
    noteType,
    reason,
    structure,
    pages: [
      `第 1 页：封面只放一句狠话，优先写“${openingHook || "最痛的问题 + 最直接结果"}”，让用户 1 秒内知道这是一篇结果型笔记。`,
      "第 2 页：写清楚最适合的人群和痛点，例如久坐上班族、产后妈妈、体态焦虑人群，别写成泛人群安慰。",
      "第 3 页：放最典型的痛点场景，最好是练前与练后、调整前与调整后的明显反差图或局部体态图。",
      "第 4 页：给一个可执行动作或方法，但只讲最关键的 1 到 2 个动作，不要把整套课一次讲完，避免信息过载。",
      "第 5 页：补充价格反差、门店环境、专业身份、真实反馈、案例截图这类信任证据，让用户觉得不是空口承诺。",
      "第 6 页：只保留一个行动，引导私信、预约、评论关键词或到店咨询，不要同时出现多个转化入口。",
    ],
    footer: `优先平台：${names || "小红书、抖音"}。文案口径必须围绕“痛点、结果、证据、动作”四件事，不要写成空泛介绍。`,
  };
}

function buildVideoStoryboard(
  openingHook?: string,
  videoPlan?: string,
  storyboardPrompt?: string,
  keyFrames?: Array<{ timestamp: string; whatShows: string; issue: string; fix: string }>,
) {
  const frames = keyFrames?.slice(0, 3) ?? [];
  return [
    {
      time: "00:00-00:02",
      title: "开场钩子",
      detail: `画面先给最痛的身体状态或最强结果对比，字幕直接打出“${openingHook || "最扎心的问题或最直接结果"}”。镜头建议用近景或局部特写，不要先给远景站桩口播；人物动作最好是扶肩、摸肚、转身受限这类一眼能看懂的问题姿势。`,
    },
    {
      time: "00:02-00:06",
      title: "痛点放大",
      detail: frames[0]
        ? `切到 ${replaceTerms(frames[0].whatShows)}，同时配一句用户会立刻对号入座的话，例如“你是不是一坐久就肩颈发紧、肚子也收不回去？”字幕和口播同步，别只靠口播。改法：${replaceTerms(frames[0].fix)}。`
        : "切到最典型的痛点动作或局部特写，强化“为什么你会不舒服、为什么要继续看”，字幕里直接点人群与症状。",
    },
    {
      time: "00:06-00:12",
      title: "动作与方法",
      detail: frames[1]
        ? `展示主讲人示范动作或讲解时的手势变化，镜头要交替给正面、侧面、局部特写三种视角；字幕只写“动作名称 + 为什么有效”，别写大段解释。改法：${replaceTerms(frames[1].fix)}。`
        : "展示 1 到 2 个最关键动作或调整方法，镜头交替给正面、侧面和局部动作，字幕点出“适合谁、为什么有效”。",
    },
    {
      time: "00:12-00:18",
      title: "结果与行动",
      detail: frames[2]
        ? `结尾用 ${replaceTerms(frames[2].whatShows)} 做结果收束，再打价格、体验课或预约动作。字幕只留一个动作句，例如“评论关键词领取方案”或“到店体验 147 元”。改法：${replaceTerms(frames[2].fix)}。`
        : `结尾只收一个动作：放价格反差、体验课、预约方式或评论关键词。${videoPlan || "不要在结尾同时塞多个动作。"}${storyboardPrompt ? ` 分镜补充：${storyboardPrompt}` : ""}`,
    },
  ];
}

function normalizeText(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function mapAnalysisError(error: unknown) {
  const message = replaceTerms(String((error as any)?.message || ""));
  if (message.includes("Unexpected end of JSON input") || message.includes("Failed to fetch") || message.includes("502")) {
    return "视频预处理失败，请重试或更换文件。";
  }
  if (message.includes("frame") || message.includes("抽取")) {
    return "关键帧提取失败，已跳过视频深度分析，请重试或更换文件。";
  }
  return message || "分析失败，请稍后再试";
}

function replaceTerms(text: string) {
  return String(text || "")
    .replace(/Call to Action/gi, "行动引导")
    .replace(/call-to-action/gi, "行动引导")
    .replace(/\bHook\b/gi, "开场钩子")
    .replace(/\bOffer\b/gi, "承接方案")
    .replace(/\bPlaybook\b/gi, "执行打法")
    .replace(/\bBrief\b/gi, "简报")
    .replace(/关于(.+?)的音频/g, "关于$1的视频片段")
    .replace(/提取音频/g, "截取视频片段")
    .replace(/音频中/g, "视频里")
    .replace(/音频内/g, "视频里")
    .replace(/音频优先粗筛|第一阶段音频粗筛结论|音频粗筛|音频分析|音频提取|音频结论|音轨证据|音轨/g, "视频分析")
    .replace(/转写摘录/g, "视频分析提炼")
    .replace(/无音轨，转入视觉优先保守判断/g, "未提取到清晰语音信号，已转入保守视频判断")
    .replace(/未检测到可靠音轨证据，需要更多依靠视觉结构判断/g, "未检测到足够清晰的语音线索，当前更多依靠视频画面结构判断")
    .replace(/\bCTA\b/g, "行动引导")
    .replace(/live sample/gi, "实时样本")
    .replace(/hybrid/gi, "混合")
    .replace(/fallback/gi, "补位");
}

function normalizeAnalysisScale(result: AnalysisResult): AnalysisResult {
  const numericValues = [
    result.composition,
    result.color,
    result.lighting,
    result.impact,
    result.viralPotential,
  ];
  const shouldUpscale = numericValues.every((value) => value >= 0 && value <= 5);
  if (!shouldUpscale) return result;
  return {
    ...result,
    composition: Math.round(result.composition * 20),
    color: Math.round(result.color * 20),
    lighting: Math.round(result.lighting * 20),
    impact: Math.round(result.impact * 20),
    viralPotential: Math.round(result.viralPotential * 20),
  };
}

function buildDashboardMetrics(
  scoreItems: { label: string; value: number }[],
  highConfidenceTracks: CommercialTrack[],
  platformRecommendations: GrowthPlatformRecommendation[],
): DashboardMetric[] {
  const averageScore = scoreItems.length
    ? Math.round(scoreItems.reduce((sum, item) => sum + item.value, 0) / scoreItems.length)
    : 0;

  return [
    {
      id: "readiness",
      label: "当前能不能卖",
      value: `${averageScore}%`,
      note: "只回答一个问题：这条内容现在离“能带来成交”还有多远。",
      tone: "from-[#ff8a3d]/30 via-[#ff8a3d]/10 to-transparent",
    },
    {
      id: "monetization",
      label: "先跑哪条路",
      value: highConfidenceTracks[0]?.name || "待判断",
      note: "只保留当前真的值得先跑的主方向，不把低相关路线硬塞给你。",
      tone: "from-[#f5b7ff]/30 via-[#f5b7ff]/10 to-transparent",
    },
    {
      id: "positioning",
      label: "当前内容状态",
      value: averageScore >= 80 ? "可放大" : averageScore >= 65 ? "可优化" : "需重构",
      note: "先判断当前内容该直接放大、重剪，还是需要先重写定位与钩子。",
      tone: "from-[#9df6c0]/30 via-[#9df6c0]/10 to-transparent",
    },
    {
      id: "platforms",
      label: "先发平台",
      value: platformRecommendations[0]?.name || "待生成",
      note: "首发平台优先用于验证第一版表达，后续再做多平台拆分和分发。",
      tone: "from-[#90c4ff]/30 via-[#90c4ff]/10 to-transparent",
    },
  ];
}

function buildScoreDistributionData(scoreItems: { label: string; value: number }[]) {
  return scoreItems.map((item) => ({
    name: item.label,
    value: item.value,
  }));
}

function getScorePanelId(label: string) {
  if (/结构|叙事/.test(label)) return "positioning";
  if (/包装|色彩|光线/.test(label)) return "content";
  if (/钩子|节奏|冲击/.test(label)) return "platforms";
  return "monetization";
}

function buildPositioningRows(
  analysis: AnalysisResult,
  context: string,
  tracks: CommercialTrack[],
): InsightTableRow[] {
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单|健身器材|体育用品|运动器材|器械/.test(context);
  const audience = normalizeText(context || analysis.summary || "当前没有明确写出受众与成交目标，建议后续补全。");
  const bestTrack = tracks.find((track) => track.fit >= 60);
  const primaryDirection = bestTrack?.name || "先不主打变现";
  const roleHint = (/AIGC|开发者|平台|工具|工作流|自动化/.test(`${analysis.summary}\n${context}`)
      ? "结果导向的案例型顾问内容"
      : "先给结果、再给做法的解决方案内容");
  return [
    {
      label: "🎯 受众痛点",
      insight: audience,
      action: commerceDriven
        ? "把开头改成“这套器材适合谁、解决什么训练问题、为什么值得买”三连句，不再先拍氛围或人物状态。"
        : "先只解决一个最痛的问题，不要一条内容同时解释太多层。",
      highlight: "先锁一个痛点",
    },
    {
      label: "🧭 内容角色",
      insight: roleHint,
      action: commerceDriven
        ? "角色不是“拍得很专业的人”，而是“帮用户快速完成购买判断的人”。标题、字幕和脚本都要围绕这个角色写。"
        : "先写清角色，再统一标题和脚本。",
      highlight: "先定角色",
    },
    {
      label: "💼 当前重点",
      insight: primaryDirection === "先不主打变现" ? "先把入口做成熟。" : `先主攻「${primaryDirection}」。`,
      action: commerceDriven
        ? "只留一个成交动作，统一导向商品页、橱窗或私聊，不要一条内容同时挂多个承接方式。"
        : "只留一个承接动作。",
      highlight: "只留一个主方向",
    },
  ];
}

function buildContentAnalysisRows(analysis: AnalysisResult, context = ""): InsightTableRow[] {
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单/.test(context);
  const sportsCommerce = /健身器材|体育用品|运动器材|器械|哑铃|跑步机|壶铃|拉力器|护具|球拍/.test(context);
  return [
    {
      label: "✅ 当前优势",
      insight: analysis.strengths[0] || "素材真实、有可延展基础。",
      action: sportsCommerce
        ? "把真实训练画面固定成信任证据：字幕直接点出训练场景、适用人群和器材差异，不要只让用户看运动氛围。"
        : analysis.strengths[1] || "把优势固定成标题或封面。",
      highlight: "先固定优势",
    },
    {
      label: "⚠️ 优先优化点",
      insight: analysis.improvements[0] || "开头抓力不足，信息进入过慢。",
      action: sportsCommerce
        ? "前 2 到 3 秒直接说“适合哪类训练人群 + 解决什么问题 + 一个最关键差异”，不要先展示运动漫镜头。"
        : analysis.improvements[1] || "先重写前 2 到 3 秒。",
      highlight: "先修停留",
    },
    {
      label: "🧩 表达问题",
      insight: analysis.improvements[2] || "信息顺序和视觉重点不够集中。",
      action: sportsCommerce
        ? "表达顺序改成“适合谁 -> 训练场景 -> 核心差异 -> 为什么值得买 -> 一个动作”。这样用户才知道该不该继续看。"
        : commerceDriven ? "先讲适合谁、值不值买、为什么值得看，再补细节。" : "先给一句结论，再补细节。",
    },
    {
      label: "🚀 建议方向",
      insight: analysis.summary || "当前内容有基础，但结构和承接不够。",
      action: sportsCommerce
        ? "按“训练场景 -> 适用人群 -> 核心利益点 -> 信任证据 -> 成交动作”重写，目标是让用户能立刻判断值不值得买。"
        : commerceDriven ? "按“适用场景 -> 核心利益点 -> 信任证据 -> 一个动作”重写。" : "按“痛点 -> 做法 -> 动作”重写。",
      highlight: "方案要短、能执行",
    },
  ];
}

function buildTrendRows(
  growthSnapshot: GrowthSnapshot | null,
  _context: string,
  _platforms: GrowthPlatformRecommendation[],
): TrendTableRow[] {
  return [];
}

function buildPlatformRecommendationRows(
  recommendations: GrowthPlatformRecommendation[],
  growthSnapshot: GrowthSnapshot | null,
): InsightTableRow[] {
  return recommendations.map((platform) => {
    const snapshot = growthSnapshot?.platformSnapshots.find((item) => item.displayName === platform.name);
    return {
      label: platform.name,
      insight: platform.reason,
      action: platform.action,
      highlight: snapshot?.watchouts?.[0] ? `避免：${normalizeText(snapshot.watchouts[0])}` : undefined,
    };
  });
}

function buildPlatformCompareRows(
  growthSnapshot: GrowthSnapshot | null,
  recommendations: GrowthPlatformRecommendation[],
  comparePlatformName: string,
): PlatformCompareRow[] {
  const primaryName = recommendations[0]?.name || "";
  if (!FULL_PLATFORM_ORDER.map((platform) => PLATFORM_LABELS[platform]).includes(primaryName)) return [];
  if (!FULL_PLATFORM_ORDER.map((platform) => PLATFORM_LABELS[platform]).includes(comparePlatformName)) return [];
  const primary = growthSnapshot?.platformSnapshots.find((item) => item.displayName === primaryName);
  const compare = growthSnapshot?.platformSnapshots.find((item) => item.displayName === comparePlatformName);
  if (!primary || !compare) return [];

  const rows = [
    {
      metric: "受众匹配",
      primaryValue: `${primary.audienceFitScore}`,
      compareValue: `${compare.audienceFitScore}`,
      verdict: primary.audienceFitScore >= compare.audienceFitScore ? `${primary.displayName} 更适合先发` : `${compare.displayName} 更适合先发`,
    },
    {
      metric: "平台动能",
      primaryValue: `${primary.momentumScore}`,
      compareValue: `${compare.momentumScore}`,
      verdict: primary.momentumScore >= compare.momentumScore ? `${primary.displayName} 更容易借势` : `${compare.displayName} 当前更有势能`,
    },
    {
      metric: "互动中位",
      primaryValue: formatPercent(primary.last30d.engagementRateMedian),
      compareValue: formatPercent(compare.last30d.engagementRateMedian),
      verdict: primary.last30d.engagementRateMedian >= compare.last30d.engagementRateMedian ? `${primary.displayName} 更值得先测互动` : `${compare.displayName} 更值得先测互动`,
    },
    {
      metric: "平均播放",
      primaryValue: formatCompactNumber(primary.last30d.avgViews),
      compareValue: formatCompactNumber(compare.last30d.avgViews),
      verdict: primary.last30d.avgViews >= compare.last30d.avgViews ? `${primary.displayName} 更适合做放大版` : `${compare.displayName} 更适合做放大版`,
    },
  ];
  return rows;
}

function buildBusinessTrackRows(tracks: CommercialTrack[], context: string): InsightTableRow[] {
  const viableTracks = tracks.filter((track) => track.fit >= 45).slice(0, 3);
  if (!viableTracks.length) {
    return [{
      label: "当前阶段",
      insight: "这条内容现在还不适合直接讲品牌合作、带货或社群。先把入口、角色、案例表达和结尾动作跑通。",
      action: "先用 7 天计划把小红书首发版本做出来，验证收藏、停留、评论关键词，再决定后续承接方式。",
      highlight: "中长期商业化先放后面，短期先把内容入口做成熟。",
    }];
  }
  return viableTracks.map((track, index) => ({
    label: `${track.name} ${track.fit}%`,
    insight: replaceTerms(track.reason),
    action: replaceTerms(track.nextStep),
    highlight: index === 0
      ? "先验证一个最短可成交动作。"
      : undefined,
  }));
}

function buildExecutionBriefRows(analysis: AnalysisResult, context: string): ExecutionBriefRow[] {
  const normalized = `${analysis.summary}\n${context}`;
  const isMedicalSports = /医生|医学|慢性病|健康管理|网球|比赛|运动损伤|康复/.test(normalized);
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单/.test(normalized);
  if (isMedicalSports) {
    return [
      {
        label: "🔥 先锁主题",
        content: "先只做一个主题：运动损伤、慢病管理或医生视角解读，不要三条线一起讲。",
      },
      {
        label: "✨ 现有亮点",
        content: "比赛画面真实、专业身份可信，天然有“专业视角看热点”的差异感，适合先做专家型内容入口。",
      },
      {
        label: "🛠 立刻改法",
        content: "开头直接抛一个风险或误区，补字幕和慢放标注，把关键动作解释清楚，不要只放比赛画面。",
      },
      {
        label: "💰 承接方式",
        content: "先承接咨询、评估、专题课或健康管理服务，不先同时讲品牌、社群和多个变现方向。",
      },
    ];
  }

  if (commerceDriven) {
    return [
      {
        label: "🔥 先做什么",
        content: "先把这条视频改成“适合谁 + 解决什么 + 为什么值得买/值得问”的成交版，不再讲泛介绍。",
      },
      {
        label: "✨ 现有亮点",
        content: analysis.strengths[0] || "素材本身有真实场景和产品感，适合往结果展示和利益点表达方向改。",
      },
      {
        label: "🛠 立刻改法",
        content: "重写前三秒：先讲用户场景和结果；中段只留 2 到 3 个利益点；补一个信任证据；结尾把动作统一到橱窗、私聊或咨询。",
      },
      {
        label: "💰 商业延展",
        content: "先把单品或主服务跑通，再扩到商品页、橱窗组合、案例页和咨询承接，不要一开始同时做知识付费和社群。",
      },
    ];
  }

  return [
    {
      label: "🔥 先做什么",
      content: `先把这条内容改成“一个结果 + 一个痛点 + 一个动作”的版本，优先修：${analysis.improvements[0] || "结果前置"}。`,
    },
      {
        label: "✨ 现有亮点",
        content: analysis.strengths[0] || analysis.summary || "视觉上已经有亮点，但表达和承接还不够完整。",
    },
    {
      label: "🛠 立刻改法",
      content: `把开头前三秒改成结论前置，结尾补一个明确动作；中段只保留服务于主结论的画面和字幕。`,
    },
    {
      label: "💰 商业延展",
      content: "先跑出收藏、停留或咨询，再把同主题拆成图文、分镜脚本和视频版本，不要一开始同时写多个变现方向。",
    },
  ];
}

function buildPersonalizedDirectionCards(
  growthSnapshot: GrowthSnapshot | null,
  fallbackAngles: NonNullable<AnalysisResult["commercialAngles"]>,
) {
  const personalized = growthSnapshot?.dashboardConsole?.personalizedRecommendations || [];
  if (personalized.length) {
    return personalized.slice(0, 4).map((item, index) => ({
      title: item.title,
      scenario: item.audience,
      why: `${item.why} ${item.evidence}`.trim(),
      action: item.action,
      badge: index === 0 ? "主方向" : "可扩展",
    }));
  }

  return fallbackAngles.slice(0, 4).map((item, index) => ({
    title: item.title,
    scenario: item.scenario,
    why: item.whyItFits,
    action: item.execution,
    badge: index === 0 ? "备选方向" : "次选方向",
  }));
}

function buildProcessingSteps(inputKind: InputKind | null, uploadStage: UploadStage, uploadProgress: number, elapsedTime: number): ProcessingStepCard[] {
  const isVideo = inputKind === "video";
  const analyzingPhase = Math.floor(elapsedTime / 4);
  const currentAnalyzeStep = isVideo ? Math.min(3, analyzingPhase) : Math.min(2, analyzingPhase);

  if (uploadStage === "uploading") {
    return [
      {
        id: "prepare",
        label: isVideo ? "校验视频文件" : "校验文档内容",
        detail: isVideo ? "正在确认视频格式、时长与上传可用性。" : "正在确认文档格式、大小与可解析性。",
        status: uploadProgress >= 8 ? "done" : "active",
      },
      {
        id: "transfer",
        label: "上传到分析队列",
        detail: isVideo ? "正在把原始文件送入分析入口，并持续同步字节进度。" : "正在整理文档内容并送入模型分析入口。",
        status: uploadProgress >= 8 ? "active" : "pending",
      },
      {
        id: "handoff",
        label: "创建分析任务",
        detail: "文件就绪后会立即创建任务，开始进入模型工作流。",
        status: uploadProgress >= 96 ? "active" : "pending",
      },
    ];
  }

  if (uploadStage === "analyzing") {
    const videoSteps: ProcessingStepCard[] = [
      {
        id: "decode",
        label: "解读素材结构",
        detail: "正在拆解视频节奏、主线信息和可承接的商业入口。",
        status: currentAnalyzeStep > 0 ? "done" : "active",
      },
      {
        id: "multimodal",
        label: "多模态理解",
        detail: "正在结合画面、字幕、口播与上下文，判断素材真正适合服务谁。",
        status: currentAnalyzeStep === 1 ? "active" : currentAnalyzeStep > 1 ? "done" : "pending",
      },
      {
        id: "bridge",
        label: "商业桥接判断",
        detail: "正在把这条素材桥接回你的业务，而不是套默认模板。",
        status: currentAnalyzeStep === 2 ? "active" : currentAnalyzeStep > 2 ? "done" : "pending",
      },
      {
        id: "report",
        label: "生成最终报告",
        detail: "正在收束平台建议、执行版本和个性化增长方向。",
        status: currentAnalyzeStep >= 3 ? "active" : "pending",
      },
    ];

    const documentSteps: ProcessingStepCard[] = [
      {
        id: "extract",
        label: "抽取关键信息",
        detail: "正在读取文档中的核心观点、结构与可成交线索。",
        status: currentAnalyzeStep > 0 ? "done" : "active",
      },
      {
        id: "reason",
        label: "判断可执行方向",
        detail: "正在判断内容定位、平台优先级与商业承接动作。",
        status: currentAnalyzeStep === 1 ? "active" : currentAnalyzeStep > 1 ? "done" : "pending",
      },
      {
        id: "assemble",
        label: "拼装成长报告",
        detail: "正在输出可直接拿去改稿、发布和验证的结果。",
        status: currentAnalyzeStep >= 2 ? "active" : "pending",
      },
    ];

    return isVideo ? videoSteps : documentSteps;
  }

  return [];
}

function buildCommercialTracks(
  analysis: AnalysisResult,
  context: string,
  growthSnapshot: GrowthSnapshot | null,
): CommercialTrack[] {
  const text = context.trim();
  const xiaohongshuFit = growthSnapshot?.platformSnapshots.find((item) => item.platform === "xiaohongshu")?.audienceFitScore || 0;
  const bilibiliFit = growthSnapshot?.platformSnapshots.find((item) => item.platform === "bilibili")?.audienceFitScore || 0;
  const douyinFit = growthSnapshot?.platformSnapshots.find((item) => item.platform === "douyin")?.audienceFitScore || 0;
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单/.test(text);
  const educationDriven = /课程|教学|知识|教程|陪跑|训练营/.test(text);

  return [
    {
      name: "品牌合作",
      fit: Math.min(96, Math.round((analysis.color + analysis.composition + xiaohongshuFit) / 3 + (/品牌|招商|案例|客户|服务/.test(text) ? 6 : 0))),
      reason: /美妆|穿搭|形象|妆|护肤|造型/.test(text)
        ? "只有当你能把审美表达直接翻译成“适合什么场景、解决什么问题、能给品牌带来什么结果”时，品牌合作才成立。"
        : "品牌合作只适合那些表达统一、案例清楚、服务说明完整的内容，不适合泛泛谈曝光。",
      nextStep: /美妆|穿搭|形象|妆|护肤|造型/.test(text)
        ? "先补一版“场景问题 -> 解决方案 -> 可合作品类”的案例页，聚焦运动美妆、防晒、功能护肤、服饰与配件。"
        : "补一版案例导向标题和服务说明，让合作方能快速理解你擅长的商业结果。",
    },
    {
      name: "电商带货",
      fit: Math.min(96, Math.round((analysis.impact + analysis.viralPotential + douyinFit) / 3 + (commerceDriven ? 16 : 0))),
      reason: "冲击力和节奏更适合做转化型表达，但产品利益点和行动引导需要足够直接。",
      nextStep: "把前三秒改成结果或利益点前置，并把行动指令明确到橱窗、评论区或私域入口。",
    },
    {
      name: "知识付费",
      fit: Math.min(96, Math.round((analysis.composition + analysis.viralPotential + bilibiliFit) / 3 + (educationDriven ? 10 : -22) - (commerceDriven ? 18 : 0))),
      reason: "适合把内容拆成方法、结构、案例复盘，再沉淀成课程、模板或陪跑服务。",
      nextStep: "把当前内容整理成“结果 + 三步方法 + 常见误区”的结构，形成可复用的方法论入口。",
    },
    {
      name: "社群会员",
      fit: Math.min(96, Math.round((analysis.color + analysis.lighting + xiaohongshuFit) / 3 + 4 - (commerceDriven ? 12 : 0))),
      reason: "社群不是默认答案，只有当你能稳定更新同主题内容、持续交付群内价值时，才值得做会员或长期社群。",
      nextStep: "先验证是否存在固定主题、固定更新节奏和固定权益，再决定要不要把社群作为主承接方式。",
    },
  ].sort((a, b) => b.fit - a.fit);
}

function buildCreationAssistBrief(
  analysis: AnalysisResult,
  context: string,
  platforms: GrowthPlatformRecommendation[],
  tracks: CommercialTrack[],
) {
  const primaryTrack = tracks[0]?.name || "品牌合作";
  const primaryPlatform = platforms[0]?.name || "抖音";
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单/.test(context);
  return [
    `内容目标：把当前素材升级成更适合 ${primaryPlatform} 分发、并服务于「${primaryTrack}」转化的内容版本。`,
    `核心分析：${analysis.summary}`,
    commerceDriven
      ? "开场建议：前 2-3 秒先讲“适合谁、解决什么、为什么值得买”，不要从产品介绍开始。"
      : "开场建议：前 2-3 秒先给结果、反差或利益点，不要从铺垫开始。",
    commerceDriven
      ? "商业动作：结尾只保留一个成交动作，统一导向橱窗、评论区关键词或私聊入口。"
      : "商业动作：结尾必须补行动引导，把观众导向案例咨询、服务介绍、商品入口或私域承接。",
    context.trim() ? `业务背景：${context.trim()}` : "业务背景：未填写，建议补充目标受众与转化目标。",
  ].join("\n");
}

function buildDashboardPanels(
  dashboardMetrics: DashboardMetric[],
  positioningRows: InsightTableRow[],
  contentAnalysisRows: InsightTableRow[],
  platformRecommendationRows: InsightTableRow[],
  businessInsights: GrowthBusinessInsight[],
  growthPlan: GrowthPlanStep[],
  commercialTracks: CommercialTrack[],
): DashboardPanel[] {
  const maturity = dashboardMetrics.find((item) => item.id === "readiness");
  const role = dashboardMetrics.find((item) => item.id === "positioning");
  const platform = dashboardMetrics.find((item) => item.id === "platforms");
  const monetization = dashboardMetrics.find((item) => item.id === "monetization");
  const topTrack = commercialTracks[0];
  const dayOne = growthPlan[0];

  return [
    {
      id: "readiness",
      eyebrow: maturity?.label || "总体准备度",
      title: maturity?.value || "待生成",
      summary: maturity?.note || "先看整体成熟度，再决定先修哪里。",
      detail: `先判断这条内容是“能直接放大”，还是“要先重写一版”。${role?.value ? ` 当前判断：${role.value}。` : ""}`,
      action: dayOne?.action || "先把单一卖点和开头 3 秒收紧，再进入平台验证。",
      accent: "text-[#ffcf92]",
      glow: "from-[#ff8a3d]/30 via-[#ffcf92]/12 to-transparent",
    },
    {
      id: "positioning",
      eyebrow: "内容定位",
      title: positioningRows[0]?.insight || "先定受众",
      summary: positioningRows[1]?.insight || "先定内容角色，再定平台和脚本。",
      detail: `${positioningRows[0]?.action || ""} ${positioningRows[1]?.action || ""}`.trim(),
      action: positioningRows[2]?.action || "先做一版首发验证稿，再拆成多平台版本。",
      accent: "text-[#9df6c0]",
      glow: "from-[#15ff9b]/20 via-[#9df6c0]/10 to-transparent",
    },
    {
      id: "content",
      eyebrow: "内容分析",
      title: contentAnalysisRows[0]?.insight || "先找可复用优势",
      summary: contentAnalysisRows[1]?.insight || "先修最影响停留的问题。",
      detail: `${contentAnalysisRows[2]?.insight || ""} ${contentAnalysisRows[3]?.action || ""}`.trim(),
      action: contentAnalysisRows[1]?.action || "先重写开头和信息顺序。",
      accent: "text-[#ffb37f]",
      glow: "from-[#ff8a3d]/25 via-[#ffb37f]/10 to-transparent",
    },
    {
      id: "platforms",
      eyebrow: "平台打法",
      title: platformRecommendationRows[0]?.label || "待生成",
      summary: platformRecommendationRows[0]?.insight || "先给首发顺序，再告诉用户每个平台怎么发。",
      detail: platformRecommendationRows.slice(0, 3).map((item) => `${item.label}：${item.action}`).join(" "),
      action: "图文先跑验证，视频再做扩量。平台不是单选题，而是按同一主题拆不同版本。",
      accent: "text-[#90c4ff]",
      glow: "from-[#2684ff]/24 via-[#90c4ff]/12 to-transparent",
    },
    {
      id: "monetization",
      eyebrow: "商业洞察",
      title: topTrack ? `${topTrack.name} ${topTrack.fit}%` : "暂不主打变现",
      summary: businessInsights[0]?.detail || "先把内容入口讲清楚，再谈商业承接。",
      detail: businessInsights.slice(1, 4).map((item) => `${item.title}：${item.detail}`).join(" "),
      action: topTrack?.nextStep || "先补一版案例或服务说明，再决定主承接方式。",
      accent: "text-[#f5b7ff]",
      glow: "from-[#f5b7ff]/24 via-[#ff8cf0]/10 to-transparent",
    },
    {
      id: "execution",
      eyebrow: "7天执行",
      title: dayOne?.title || "先跑第一轮结果",
      summary: dayOne?.action || "先做一版能验证结果的首发稿。",
      detail: growthPlan.slice(1, 4).map((item) => `第 ${item.day} 天 ${item.title}：${item.action}`).join(" "),
      action: "先把短期结果做出来，再把同主题延展到分镜、视频和商业承接。",
      accent: "text-[#d7ff7f]",
      glow: "from-[#8effb1]/18 via-[#d7ff7f]/10 to-transparent",
    },
  ];
}

const PANEL_SCROLL_TARGETS: Record<string, string> = {
  readiness: "execution",
  positioning: "positioning",
  content: "content",
  platforms: "platforms",
  monetization: "monetization",
  execution: "execution",
};

const PANEL_SECTION_LINKS: Record<string, string[]> = {
  readiness: ["positioning", "content", "monetization", "execution"],
  positioning: ["positioning", "content"],
  content: ["content", "execution", "monetization"],
  platforms: ["platforms"],
  monetization: ["monetization", "execution"],
  execution: ["execution", "content"],
};

function PlatformTrendEntryPanel() {
  const [, setLocation] = useLocation();

  return (
    <div className="mb-8 flex justify-end">
      <button
        type="button"
        onClick={() => setLocation('/platform')}
        className="inline-flex items-center justify-center gap-2 rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_32px_rgba(73,230,255,0.15)] transition hover:brightness-110"
      >
        <TrendingUp className="h-4 w-4" />
        平台趋势数据分析
      </button>
    </div>
  );
}

export default function MVAnalysisPage() {
  const stripInternalJargon = (value: string) => String(value || "")
    .replace(/Call to Action/gi, "行动引导")
    .replace(/call-to-action/gi, "行动引导")
    .replace(/\bHook\b/gi, "开场钩子")
    .replace(/\bOffer\b/gi, "承接方案")
    .replace(/\bPlaybook\b/gi, "执行打法")
    .replace(/\bBrief\b/gi, "简报")
    .replace(/关于(.+?)的音频/g, "关于$1的视频片段")
    .replace(/提取音频/g, "截取视频片段")
    .replace(/音频中/g, "视频里")
    .replace(/音频内/g, "视频里")
    .replace(/音频优先粗筛|第一阶段音频粗筛结论|音频粗筛|音频分析|音频提取|音频结论|音轨证据|音轨/g, "视频分析")
    .replace(/转写摘录/g, "视频分析提炼")
    .replace(/\bCTA\b/g, "行动引导")
    .replace(/知识付费|社群会员|模板包|软件分销|咨询|课程|工作流案例|前后效率对比|模板|实操演示|后台分析过程|漏斗|中位数|均值|内部排序/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const [, navigate] = useLocation();
  const isPlatformPage = false;
  const [supervisorAccess, setSupervisorAccess] = useState(() => hasSupervisorAccess());
  const { isAuthenticated, loading, user } = useAuth({ autoFetch: !supervisorAccess });

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inputKind, setInputKind] = useState<InputKind | null>(null);
  const [fileMimeType, setFileMimeType] = useState("");
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const queryClient = useQueryClient();
  const [estimatedTime, setEstimatedTime] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisMode, setAnalysisMode] = useState<"GROWTH" | "REMIX">("GROWTH");
  const isRemixMode = analysisMode === "REMIX";
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);
  const [quotaModalInfo, setQuotaModalInfo] = useState<{ isTrial?: boolean; planName?: string }>({});
  const [analysisTranscript, setAnalysisTranscript] = useState("");
  const [analyzedVideoUrl, setAnalyzedVideoUrl] = useState("");
  const [debugMode, setDebugMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return hasSupervisorAccess() && new URLSearchParams(window.location.search).get("debug") === "1";
  });
  const [debugInfo, setDebugInfo] = useState<DebugInfo>(null);
  const [activeDashboardPanel, setActiveDashboardPanel] = useState("readiness");
  const [selectedComparePlatform, setSelectedComparePlatform] = useState("");
  const [selectedTrendPlatform, setSelectedTrendPlatform] = useState("all");
  const [selectedBusinessTrack, setSelectedBusinessTrack] = useState("");
  const [selectedFunnelSegment, setSelectedFunnelSegment] = useState("");
  const [activityCarouselIndex, setActivityCarouselIndex] = useState(0);
  const [musicPromptDraft, setMusicPromptDraft] = useState("");
  const [musicProvider, setMusicProvider] = useState<MusicProvider>("suno");
  const [musicStatus, setMusicStatus] = useState<MusicGenerationStatus>("idle");
  const [musicTaskId, setMusicTaskId] = useState("");
  const [musicProgressMessage, setMusicProgressMessage] = useState("");
  const [musicError, setMusicError] = useState("");
  const [musicSongs, setMusicSongs] = useState<GeneratedMusicSong[]>([]);
  const [playingMusicUrl, setPlayingMusicUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const musicPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(typeof Audio !== "undefined" ? new Audio() : null);
  const startTimeRef = useRef(0);
  const sectionRefs = useRef<Partial<Record<string, HTMLDivElement | null>>>({});

  const analyzeDocumentMutation = trpc.mvAnalysis.analyzeDocument.useMutation();
  const analyzeVideoMutation = trpc.mvAnalysis.analyzeVideo.useMutation();
  const getVideoUploadSignedUrlMutation = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const refreshGrowthMutation = trpc.mvAnalysis.refreshGrowthTrends.useMutation();
  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading && !supervisorAccess,
    refetchOnMount: true,
  });
  const hasPaidGrowthAccess = Boolean(
    supervisorAccess ||
      (usageStatsQuery.data as any)?.isAdmin ||
      usageStatsQuery.data?.hasSubscription,
  );
  const growthSnapshotQuery = trpc.mvAnalysis.getGrowthSnapshot.useQuery(
    {
      context: context || undefined,
      modelName: "gemini-2.5-pro",
      requestedPlatforms: [...FULL_PLATFORM_ORDER],
      analysis: analysis || {
        composition: 0,
        color: 0,
        lighting: 0,
        impact: 0,
        viralPotential: 0,
        strengths: [],
        improvements: [],
        platforms: [],
        summary: "",
        explosiveIndex: 0,
        platformScores: { xiaohongshu: 0, douyin: 0, bilibili: 0, kuaishou: 0 },
        realityCheck: "",
        reverseEngineering: {
          hookStrategy: "",
          emotionalArc: "",
          commercialLogic: "",
        },
        premiumContent: {
          summary: "",
          topics: [],
        },
        growthStrategy: { gapAnalysis: "", commercialMatrix: "" },
        remixExecution: {
          hookLibrary: [],
          emotionalPacing: "",
          visualPaletteAndScript: "",
          productMatrix: "",
          shootingGuidance: "",
          businessInsight: {
            video: "",
            imageText: "",
            monetizationLogic: "",
          },
          shootingBlueprint: {
            storyboard: [],
            lighting: "",
            blocking: "",
            shotSize: "",
            emotionalTension: "",
            cameraPerformance: "",
          },
          imageTextNoteGuide: {
            coverSetup: "",
            titleOptions: [],
            structuredBody: "",
          },
          xiaohongshuLayout: "",
        },
      },
    },
    {
      enabled: false,
      staleTime: 300_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: false,
    },
  );
  const growthSystemStatusQuery = trpc.mvAnalysis.getGrowthSystemStatus.useQuery(undefined, {
    enabled: supervisorAccess || uploadStage === "analyzing",
    staleTime: 30_000,
    refetchInterval: (supervisorAccess && debugMode) || uploadStage === "analyzing" ? 10_000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const setGrowthRuntimeModeMutation = trpc.mvAnalysis.setGrowthRuntimeMode.useMutation({
    onSuccess: async () => {
      await growthSystemStatusQuery.refetch();
      toast.success("运行模式已切换");
    },
    onError: (error) => {
      toast.error(error.message || "运行模式切换失败");
    },
  });
  const setGrowthBurstControlMutation = trpc.mvAnalysis.setGrowthBurstControl.useMutation({
    onSuccess: async () => {
      await growthSystemStatusQuery.refetch();
      toast.success("burst 模式已切换");
    },
    onError: (error) => {
      toast.error(error.message || "burst 模式切换失败");
    },
  });
  const growthAnomalies = growthSystemStatusQuery.data?.anomalies || [];
  const growthHealthState = growthAnomalies.length ? "异常" : "正常";
  const hasCriticalGrowthAnomaly = growthAnomalies.some((item) => item?.level === "critical");
  const rotatingPlatformActivities = useMemo(() => {
    const rows = (growthSystemStatusQuery.data?.currentSupportActivities || []) as Array<{
      platform?: string;
      platformLabel?: string;
      summary?: string;
      hotTopic?: string;
      supportActivities?: string[];
    }>;
    return rows
      .filter((item) => isCollectedPlatformLabel(item.platformLabel))
      .map((item) => ({
        platform: item.platform || "",
        platformLabel: item.platformLabel || getPlatformLabel(item.platform),
        summary: replaceTerms(String(item.summary || "")),
        hotTopic: replaceTerms(String(item.hotTopic || "")),
        supportActivities: (item.supportActivities || []).map((entry) => replaceTerms(String(entry))),
      }));
  }, [growthSystemStatusQuery.data]);
  const activeCarouselActivity = rotatingPlatformActivities.length
    ? rotatingPlatformActivities[activityCarouselIndex % rotatingPlatformActivities.length]
    : null;

  const trySetBurstControl = useCallback((payload: {
    burst: "auto" | "manual" | "off";
    platforms: Array<"douyin" | "xiaohongshu" | "bilibili" | "kuaishou" | "toutiao">;
  }) => {
    if (payload.burst !== "off" && hasCriticalGrowthAnomaly) {
      toast.error("当前系统状态异常，不建议执行 burst。请先恢复健康度。");
      return;
    }
    setGrowthBurstControlMutation.mutate(payload);
  }, [hasCriticalGrowthAnomaly, setGrowthBurstControlMutation]);

  useEffect(() => {
    setSupervisorAccess(hasSupervisorAccess());
  }, []);

  useEffect(() => {
    if (!loading && !isAuthenticated && !supervisorAccess) navigate("/login");
  }, [loading, isAuthenticated, supervisorAccess, navigate]);

  useEffect(() => {
    if (uploadStage !== "analyzing" || rotatingPlatformActivities.length <= 1) {
      setActivityCarouselIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setActivityCarouselIndex((prev) => (prev + 1) % rotatingPlatformActivities.length);
    }, 10_000);
    return () => clearInterval(timer);
  }, [uploadStage, rotatingPlatformActivities]);

  useEffect(() => {
    if (uploadStage === "uploading" || uploadStage === "analyzing") {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [uploadStage]);

  useEffect(() => {
    if (!analysis?.sunoPrompt?.trim()) return;
    setMusicPromptDraft((prev) => (prev.trim() ? prev : analysis.sunoPrompt || ""));
  }, [analysis?.sunoPrompt]);

  useEffect(() => {
    return () => {
      if (musicPollingRef.current) {
        clearInterval(musicPollingRef.current);
        musicPollingRef.current = null;
      }
      if (musicAudioRef.current) {
        musicAudioRef.current.pause();
        musicAudioRef.current.src = "";
      }
    };
  }, []);

  const handleSelectFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target?.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith("video/");
    const isDocument =
      file.type === "application/pdf" ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      /\.pdf$/i.test(file.name) ||
      /\.docx$/i.test(file.name);

    if (!isVideo && !isDocument) {
      setError("请上传图文档案（Word、PDF）或 MP4 视频文件");
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);
    setFileMimeType(file.type || "");
    setSelectedFile(file);
    setInputKind(isVideo ? "video" : "document");
    setUploadStage("reading");
    setUploadProgress(0);
    setError(null);
    setAnalysis(null);
    setDebugInfo(null);
    setPreviewUrl(null);

    const sizeMB = file.size / (1024 * 1024);
    setEstimatedTime(Math.max(10, Math.round(sizeMB * 2 + 15)));

    void (async () => {
      try {
        if (isDocument) {
          const dataUrl = await readFileAsDataUrl(file);
          setFileBase64(dataUrl.split(",")[1] || "");
          setUploadStage("idle");
          setUploadProgress(100);
          return;
        }

        setFileBase64(null);

        const preview = await extractVideoPreview(file);
        setPreviewUrl(preview);
        setUploadStage("idle");
        setUploadProgress(100);
      } catch (fileError: any) {
        setError(fileError.message || "文件读取失败");
        setUploadStage("error");
      }
    })();
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!inputKind) return;

    if (!supervisorAccess) {
      try {
        const accessCheck = await checkAccessMutation.mutateAsync({ featureType: "analysis" });
        if (!accessCheck.allowed) {
          setQuotaModalInfo({
            isTrial: (accessCheck as any).isTrial,
            planName: (accessCheck as any).planName,
          });
          setQuotaModalVisible(true);
          return;
        }
      } catch (accessError: any) {
        toast.error(accessError.message || "无法检查使用权限");
        return;
      }
    }

    setUploadStage("uploading");
    setUploadProgress(0);
    setError(null);
    setElapsedTime(0);
    setEstimatedTime(Math.max(12, Math.round(fileSize / (1024 * 1024) * 1.5 + 12)));
    setDebugInfo((prev) => ({
      ...(prev || {}),
      inputKind,
      fileName,
      mimeType: fileMimeType || null,
      fileSize,
      videoPipeline: inputKind === "video" ? {
        selectedFile: {
          name: selectedFile?.name || fileName || "",
          size: selectedFile?.size || fileSize || 0,
          mimeType: fileMimeType || selectedFile?.type || "",
        },
        upload: { status: "started", progress: 0 },
        dispatch: { status: "idle" },
        analysis: { status: "idle" },
      } satisfies VideoPipelineDebug : undefined,
    }));

    try {
      const result = inputKind === "document"
          ? await analyzeDocumentMutation.mutateAsync({
              fileBase64: fileBase64 || "",
              mimeType: fileMimeType || "application/octet-stream",
              fileName,
              context: context || undefined,
              modelName: "gemini-2.5-pro",
            })
          : await (async () => {
              if (!selectedFile) {
                throw new Error("请先选择视频文件");
              }
              let signed;
              try {
                signed = await getVideoUploadSignedUrlMutation.mutateAsync({
                  fileName: selectedFile.name || fileName || "video.mp4",
                  mimeType: fileMimeType || selectedFile.type || "video/mp4",
                });
              } catch (signedUrlError: any) {
                setDebugInfo((prev) => ({
                  ...(prev || {}),
                  videoPipeline: {
                    ...(((prev as any)?.videoPipeline || {}) as VideoPipelineDebug),
                    upload: {
                      ...((((prev as any)?.videoPipeline?.upload || {}) as VideoPipelineDebug["upload"])),
                      status: "failed",
                      strategy: "signed-url",
                      signedUrlError: String(signedUrlError?.message || signedUrlError || "signed_url_request_failed"),
                    },
                  },
                }));
                throw signedUrlError;
              }
              try {
                await uploadFileToSignedUrl({
                  file: selectedFile,
                  uploadUrl: signed.uploadUrl,
                  headers: signed.requiredHeaders,
                  onProgress: (percent) => {
                    const mappedPercent = Math.min(55, Math.max(3, Math.round(percent * 0.55)));
                    setUploadProgress(mappedPercent);
                    setDebugInfo((prev) => ({
                      ...(prev || {}),
                      videoPipeline: {
                        ...(((prev as any)?.videoPipeline || {}) as VideoPipelineDebug),
                        upload: {
                          ...((((prev as any)?.videoPipeline?.upload || {}) as VideoPipelineDebug["upload"])),
                          status: "started",
                          progress: mappedPercent,
                          strategy: "signed-url",
                        },
                      },
                    }));
                  },
                });
              } catch (uploadError: any) {
                setDebugInfo((prev) => ({
                  ...(prev || {}),
                  videoPipeline: {
                    ...(((prev as any)?.videoPipeline || {}) as VideoPipelineDebug),
                    upload: {
                      ...((((prev as any)?.videoPipeline?.upload || {}) as VideoPipelineDebug["upload"])),
                      status: "failed",
                      strategy: "signed-url",
                      error: String(uploadError?.message || uploadError || "signed_url_upload_failed"),
                    },
                  },
                }));
                throw uploadError;
              }
              const uploaded: { url?: string; key?: string; gcsUri?: string; strategy: "signed-url" | "legacy-upload" } = {
                gcsUri: signed.gcsUri,
                strategy: "signed-url" as const,
              };
              if (!uploaded?.gcsUri) {
                throw new Error("视频上传完成但未返回地址");
              }
              setDebugInfo((prev) => ({
                ...(prev || {}),
                videoPipeline: {
                  ...(((prev as any)?.videoPipeline || {}) as VideoPipelineDebug),
                  upload: {
                    status: "done",
                    progress: 100,
                    url: uploaded.url,
                    key: uploaded.key,
                    gcsUri: uploaded.gcsUri,
                    strategy: uploaded.strategy,
                  },
                },
              }));

              setUploadStage("analyzing");
              setUploadProgress(60);

              setDebugInfo((prev) => ({
                ...(prev || {}),
                videoPipeline: {
                  ...(((prev as any)?.videoPipeline || {}) as VideoPipelineDebug),
                  mode: "job",
                  dispatch: {
                    status: "started",
                    modelName: "gemini-2.5-pro",
                    route: "growth_analyze_video",
                  },
                },
              }));
              const { jobId } = await createJob({
                type: "video",
                userId: "",
                input: {
                  action: "growth_analyze_video",
                  params: {
                    gcsUri: uploaded.gcsUri,
                    fileUrl: uploaded.url,
                    fileKey: uploaded.key,
                    mimeType: fileMimeType || "video/mp4",
                    fileName,
                    context: context || undefined,
                    modelName: "gemini-2.5-pro",
                    mode: analysisMode,
                  },
                },
              });
              setDebugInfo((prev) => ({
                ...(prev || {}),
                videoPipeline: {
                  ...(((prev as any)?.videoPipeline || {}) as VideoPipelineDebug),
                  dispatch: {
                    status: "done",
                    modelName: "gemini-2.5-pro",
                    route: "growth_analyze_video",
                  },
                  job: {
                    jobId,
                    status: "queued",
                    pollCount: 0,
                  },
                  analysis: {
                    status: "started",
                  },
                },
              }));

              const startedAt = Date.now();
              let pollCount = 0;
              let transientFetchFailures = 0;
              let consecutiveFetchFailures = 0;
              const maxTransientFetchFailures = 24;
              const maxConsecutiveFetchFailures = 6;
              while (Date.now() - startedAt < 12 * 60_000) {
                try {
                  const job = await getJob(jobId);
                  pollCount += 1;
                  transientFetchFailures = 0;
                  consecutiveFetchFailures = 0;
                  setDebugInfo((prev) => ({
                    ...(prev || {}),
                    videoPipeline: {
                      ...(((prev as any)?.videoPipeline || {}) as VideoPipelineDebug),
                      job: {
                        jobId,
                        status: String(job.status || "unknown"),
                        pollCount,
                        error: job.status === "failed" ? String(job.error || "") : undefined,
                      },
                      analysis: {
                        ...((((prev as any)?.videoPipeline?.analysis || {}) as VideoPipelineDebug["analysis"])),
                        transientPollError: undefined,
                      },
                    },
                  }));
                  if (job.status === "succeeded") {
                    return {
                      success: true,
                      analysis: job.output?.analysis,
                      videoUrl: job.output?.videoUrl,
                      transcript: job.output?.transcript,
                      videoDuration: job.output?.videoDuration,
                      debug: job.output?.debug,
                    };
                  }
                  if (job.status === "failed") {
                    throw new Error(String(job.error || "视频分析失败"));
                  }
                } catch (pollError: any) {
                  transientFetchFailures += 1;
                  consecutiveFetchFailures += 1;
                  const pollMessage = String(pollError?.message || pollError || "job_poll_failed");
                  setDebugInfo((prev) => ({
                    ...(prev || {}),
                    videoPipeline: {
                      ...(((prev as any)?.videoPipeline || {}) as VideoPipelineDebug),
                      job: {
                        ...((((prev as any)?.videoPipeline?.job || {}) as VideoPipelineDebug["job"])),
                        jobId,
                        status: "polling_error",
                        pollCount,
                        error: pollMessage,
                      },
                      analysis: {
                        ...((((prev as any)?.videoPipeline?.analysis || {}) as VideoPipelineDebug["analysis"])),
                        transientPollError: pollMessage,
                      },
                    },
                  }));
                  if (
                    consecutiveFetchFailures >= maxConsecutiveFetchFailures ||
                    transientFetchFailures >= maxTransientFetchFailures
                  ) {
                    throw new Error(`轮询任务状态失败：${pollMessage}`);
                  }
                }
                await new Promise((resolve) => setTimeout(resolve, 2500));
                setUploadProgress((value) => Math.min(95, Math.max(value + 3, 65)));
              }

              throw new Error("视频分析超时，请稍后重试");
            })();
      const normalizedAnalysis = normalizeAnalysisScale(result.analysis);
      const nextTranscript = String((result as any).transcript || "");
      const nextVideoUrl = String((result as any).videoUrl || "");
      setAnalysis(normalizedAnalysis);
      setAnalysisTranscript(nextTranscript);
      setAnalyzedVideoUrl(nextVideoUrl);
      setDebugInfo((prev) => ({
        ...(prev || {}),
        inputKind,
        fileName,
        mimeType: fileMimeType || null,
        fileSize,
        videoPipeline: inputKind === "video" ? {
          ...(((prev as any)?.videoPipeline || {}) as VideoPipelineDebug),
          analysis: {
            status: "done",
            provider: String((result as any).debug?.provider || ""),
            model: String((result as any).debug?.model || ""),
            fallback: Boolean((result as any).debug?.fallback),
            failureStage: String((result as any).debug?.failureStage || ""),
            failureReason: String((result as any).debug?.failureReason || ""),
            transcriptChars: Number((result as any).debug?.transcriptChars || 0),
            videoDuration: Number((result as any).debug?.videoDuration || 0),
          },
        } satisfies VideoPipelineDebug : undefined,
        ...((result as any).debug || {}),
      }));
      setUploadProgress(100);
      setUploadStage("done");
      if (!supervisorAccess) {
        usageStatsQuery.refetch();
      }
    } catch (analysisError: any) {
      setDebugInfo((prev) => ({
        ...(prev || {}),
        inputKind,
        fileName,
        mimeType: fileMimeType || null,
        fileSize,
        videoPipeline: inputKind === "video" ? {
          ...(((prev as any)?.videoPipeline || {}) as VideoPipelineDebug),
          upload: {
            ...((((prev as any)?.videoPipeline?.upload || {}) as VideoPipelineDebug["upload"])),
            status: (((prev as any)?.videoPipeline?.upload?.status as string) || "started") === "done" ? "done" : "failed",
            error: (((prev as any)?.videoPipeline?.upload?.status as string) || "idle") === "done" ? undefined : String(analysisError?.message || analysisError || ""),
          },
          dispatch: {
            ...((((prev as any)?.videoPipeline?.dispatch || {}) as VideoPipelineDebug["dispatch"])),
            status: (((prev as any)?.videoPipeline?.dispatch?.status as string) || "idle") === "done" ? "done" : ((((prev as any)?.videoPipeline?.dispatch?.status as string) || "idle") === "started" ? "failed" : ((prev as any)?.videoPipeline?.dispatch?.status as any) || "idle"),
            error: (((prev as any)?.videoPipeline?.dispatch?.status as string) || "idle") === "started" ? String(analysisError?.message || analysisError || "") : (((prev as any)?.videoPipeline?.dispatch?.error as string) || undefined),
          },
          analysis: {
            ...((((prev as any)?.videoPipeline?.analysis || {}) as VideoPipelineDebug["analysis"])),
            status: "failed",
            error: String(analysisError?.message || analysisError || ""),
          },
        } satisfies VideoPipelineDebug : undefined,
      }));
      setError(mapAnalysisError(analysisError));
      setUploadStage("error");
    } finally {
      // no-op
    }
  }, [fileBase64, selectedFile, inputKind, supervisorAccess, checkAccessMutation, fileSize, analyzeDocumentMutation, getVideoUploadSignedUrlMutation, fileMimeType, fileName, context, usageStatsQuery]);

  const handleReset = useCallback(() => {
    setPreviewUrl(null);
    setFileBase64(null);
    setSelectedFile(null);
    setInputKind(null);
    setFileMimeType("");
    setAnalysis(null);
    setError(null);
    setContext("");
    setAnalysisTranscript("");
    setAnalyzedVideoUrl("");
    setDebugInfo(null);
    setUploadStage("idle");
    setUploadProgress(0);
    setElapsedTime(0);
    setFileName("");
    setFileSize(0);
    setMusicPromptDraft("");
    setMusicStatus("idle");
    setMusicTaskId("");
    setMusicProgressMessage("");
    setMusicError("");
    setMusicSongs([]);
    setPlayingMusicUrl(null);
    if (musicPollingRef.current) {
      clearInterval(musicPollingRef.current);
      musicPollingRef.current = null;
    }
    if (musicAudioRef.current) {
      musicAudioRef.current.pause();
      musicAudioRef.current.src = "";
    }
    // Invalidate stale growth snapshot cache so next analysis always fetches fresh data
    queryClient.removeQueries({ queryKey: [["mvAnalysis", "getGrowthSnapshot"]] });
  }, [queryClient]);

  const handleRefreshGrowth = useCallback(async () => {
    try {
      await refreshGrowthMutation.mutateAsync({
        platforms: [...FULL_PLATFORM_ORDER],
      });
      await growthSnapshotQuery.refetch();
      toast.success("趋势数据已刷新");
    } catch (refreshError: any) {
      toast.error(refreshError.message || "趋势数据刷新失败");
    }
  }, [refreshGrowthMutation, growthSnapshotQuery]);

  const handlePlayGeneratedMusic = useCallback((url: string) => {
    const audio = musicAudioRef.current;
    if (!audio || !url) return;
    if (playingMusicUrl === url) {
      audio.pause();
      setPlayingMusicUrl(null);
      return;
    }
    audio.src = url;
    void audio.play().then(() => {
      setPlayingMusicUrl(url);
      audio.onended = () => setPlayingMusicUrl(null);
    }).catch(() => {
      setPlayingMusicUrl(null);
      toast.error("音频播放失败");
    });
  }, [playingMusicUrl]);

  const startMusicPolling = useCallback((jobId: string) => {
    if (musicPollingRef.current) {
      clearInterval(musicPollingRef.current);
      musicPollingRef.current = null;
    }
    setMusicStatus("polling");
    setMusicProgressMessage("正在提交音乐任务...");
    let attempts = 0;
    const maxAttempts = 120;
    let transientFetchFailures = 0;
    let consecutiveFetchFailures = 0;
    const maxTransientFetchFailures = 24;
    const maxConsecutiveFetchFailures = 6;
    musicPollingRef.current = setInterval(async () => {
      attempts += 1;
      if (attempts > maxAttempts) {
        if (musicPollingRef.current) {
          clearInterval(musicPollingRef.current);
          musicPollingRef.current = null;
        }
        setMusicStatus("error");
        setMusicError("音乐生成超时，请稍后重试。");
        return;
      }
      try {
        const data = await getJob(jobId);
        transientFetchFailures = 0;
        consecutiveFetchFailures = 0;
        const messageIndex = Math.floor(attempts / 2) % JOB_PROGRESS_MESSAGES.audio.length;
        setMusicProgressMessage(JOB_PROGRESS_MESSAGES.audio[messageIndex]);
        if (data.status === "succeeded") {
          if (musicPollingRef.current) {
            clearInterval(musicPollingRef.current);
            musicPollingRef.current = null;
          }
          const output = (data.output || {}) as any;
          setMusicSongs(Array.isArray(output.songs) ? output.songs : []);
          setMusicStatus("success");
          setMusicError("");
          toast.success("BGM 生成成功");
        } else if (data.status === "failed") {
          if (musicPollingRef.current) {
            clearInterval(musicPollingRef.current);
            musicPollingRef.current = null;
          }
          setMusicStatus("error");
          setMusicError(String(data.error || "音乐生成失败"));
        }
      } catch (pollError: any) {
        transientFetchFailures += 1;
        consecutiveFetchFailures += 1;
        const pollMessage = String(pollError?.message || pollError || "music_job_poll_failed");
        setMusicProgressMessage(`任务轮询重试中：${pollMessage}`);
        if (
          consecutiveFetchFailures >= maxConsecutiveFetchFailures ||
          transientFetchFailures >= maxTransientFetchFailures
        ) {
          if (musicPollingRef.current) {
            clearInterval(musicPollingRef.current);
            musicPollingRef.current = null;
          }
          setMusicStatus("error");
          setMusicError(`音乐任务轮询失败：${pollMessage}`);
        }
      }
    }, 1800);
  }, []);

  const handleGenerateMusic = useCallback(async () => {
    const prompt = String(musicPromptDraft || analysis?.sunoPrompt || "").trim();
    if (!prompt) {
      toast.error("当前没有可用的 Music Prompt");
      return;
    }
    if (!user?.id && !supervisorAccess) {
      toast.error("登录状态已失效，请重新登录后再试。");
      return;
    }
    setMusicStatus("generating");
    setMusicError("");
    setMusicSongs([]);
    setPlayingMusicUrl(null);
    setMusicProgressMessage("正在提交音乐任务...");
    try {
      const resolvedJobUserId = user?.id ? String(user.id) : "";
      const { jobId } = await createJob({
        type: "audio",
        userId: resolvedJobUserId,
        input: {
          action: "suno_music",
          params: {
            mode: "bgm",
            model: musicProvider,
            title: `${fileName || "creator-growth-camp"}-bgm`,
            prompt,
            customStyle: prompt,
            mood: analysis?.musicRecommendation || analysis?.bgmAnalysis || prompt || undefined,
          },
        },
      });
      setMusicTaskId(jobId);
      startMusicPolling(jobId);
    } catch (musicJobError: any) {
      setMusicStatus("error");
      setMusicError(musicJobError?.message || "音乐任务提交失败");
      toast.error(musicJobError?.message || "音乐任务提交失败");
    }
  }, [analysis?.bgmAnalysis, analysis?.musicRecommendation, analysis?.sunoPrompt, fileName, musicPromptDraft, musicProvider, startMusicPolling, supervisorAccess, user]);

  const handleStoreHandoff = useCallback((handoff: GrowthHandoff | null, successMessage = "分析结果已同步到创作画布") => {
    if (!handoff) return;
    saveGrowthHandoff(handoff);
    toast.success(successMessage);
  }, []);

  const scoreItems = useMemo(() => {
    if (!analysis) return [];
    if (inputKind === "document") {
      return [
        { label: "结构质量", value: analysis.composition },
        { label: "包装潜力", value: analysis.color },
        { label: "信息清晰", value: analysis.lighting },
        { label: "表达钩子", value: analysis.impact },
        { label: "商业承接力", value: analysis.viralPotential },
      ];
    }
    if (inputKind === "video") {
      return [
        { label: "叙事结构", value: analysis.composition },
        { label: "视觉包装", value: analysis.color },
        { label: "信息清晰", value: analysis.lighting },
        { label: "节奏冲击", value: analysis.impact },
        { label: "商业承接力", value: analysis.viralPotential },
      ];
    }
    return [
      { label: "构图结构", value: analysis.composition },
      { label: "色彩识别", value: analysis.color },
      { label: "光线氛围", value: analysis.lighting },
      { label: "冲击强度", value: analysis.impact },
      { label: "商业承接力", value: analysis.viralPotential },
    ];
  }, [analysis, inputKind]);

  const isProcessing = uploadStage === "uploading" || uploadStage === "analyzing";
  const remainingTime = isProcessing ? Math.max(1, estimatedTime - elapsedTime) : 0;
  const processingStatusMessage = uploadStage === "uploading"
    ? inputKind === "video"
      ? `正在上传视频 ${Math.max(1, uploadProgress)}%`
      : "正在整理文档并创建分析任务..."
    : elapsedTime >= estimatedTime
      ? "正在整理最终报告，请稍候..."
      : `正在生成诊断中，预计还需 ${remainingTime} 秒。`;
  const processingSteps = useMemo(
    () => buildProcessingSteps(inputKind, uploadStage, uploadProgress, elapsedTime),
    [inputKind, uploadStage, uploadProgress, elapsedTime],
  );
  const activeProcessingStep = processingSteps.find((item) => item.status === "active") || processingSteps[processingSteps.length - 1] || null;
  const processingDetailMessages = useMemo(() => {
    if (!processingSteps.length) return [];
    const activeIndex = processingSteps.findIndex((item) => item.status === "active");
    const current = activeIndex >= 0 ? activeIndex : processingSteps.length - 1;
    const messages = [
      processingSteps[Math.max(0, current - 1)]?.detail,
      processingSteps[current]?.detail,
      processingSteps[Math.min(processingSteps.length - 1, current + 1)]?.detail,
    ].filter(Boolean) as string[];
    return Array.from(new Set(messages));
  }, [processingSteps]);
  const animatedProcessingSteps = useMemo(
    () => processingSteps.map((step, index) => ({
      ...step,
      animatedLabel: step.status === "done" ? step.label : revealText(step.label, elapsedTime, index * 10, 10),
      animatedDetail: step.status === "done" ? step.detail : revealText(step.detail, elapsedTime, index * 16, 18),
    })),
    [processingSteps, elapsedTime],
  );

  const growthSnapshot: GrowthSnapshot | null = growthSnapshotQuery.data?.snapshot ?? null;
  const growthSnapshotDebug = growthSnapshotQuery.data?.debug ?? null;
  const analysisTracks = growthSnapshot?.analysisTracks ?? null;
  const dashboardConsole = growthSnapshot?.dashboardConsole ?? null;
  const platformRecommendations = growthSnapshot?.platformRecommendations ?? [];
  const businessInsights: GrowthBusinessInsight[] = growthSnapshot?.businessInsights ?? [];
  const growthPlan: GrowthPlanStep[] = growthSnapshot?.growthPlan ?? [];
  const commercialTracks = useMemo(
    () => growthSnapshot?.monetizationTracks ?? [],
    [growthSnapshot],
  );
  const creationAssist = growthSnapshot?.creationAssist ?? null;
  const growthHandoff = growthSnapshot?.growthHandoff ?? null;
  const positioningRows = useMemo(
    () => analysis ? buildPositioningRows(analysis, context, commercialTracks) : [],
    [analysis, context, commercialTracks],
  );
  const contentAnalysisRows = useMemo(
    () => analysis ? buildContentAnalysisRows(analysis, context) : [],
    [analysis, context],
  );
  const trendRows = useMemo(
    () => buildTrendRows(growthSnapshot, context, platformRecommendations),
    [growthSnapshot, context, platformRecommendations],
  );
  const platformRecommendationRows = useMemo(
    () => buildPlatformRecommendationRows(platformRecommendations, growthSnapshot),
    [platformRecommendations, growthSnapshot],
  );
  const referenceExamples = useMemo<ReferenceExampleCard[]>(
    () => growthSnapshot?.dashboardConsole?.referenceExamples || [],
    [growthSnapshot],
  );
  const highConfidenceTracks = useMemo(
    () => commercialTracks.filter((track) => track.fit >= 80),
    [commercialTracks],
  );
  const businessTrackRows = useMemo(
    () => buildBusinessTrackRows(highConfidenceTracks.length ? highConfidenceTracks : commercialTracks, context),
    [highConfidenceTracks, commercialTracks, context],
  );
  const executionBriefRows = useMemo(
    () => analysis ? buildExecutionBriefRows(analysis, context) : [],
    [analysis, context],
  );
  const dashboardMetrics = useMemo(
    () => buildDashboardMetrics(scoreItems, highConfidenceTracks, platformRecommendations),
    [scoreItems, highConfidenceTracks, platformRecommendations],
  );
  const dashboardPanels = useMemo(
    () => buildDashboardPanels(
      dashboardMetrics,
      positioningRows,
      contentAnalysisRows,
      platformRecommendationRows,
      businessInsights,
      growthPlan,
      commercialTracks,
    ),
    [dashboardMetrics, positioningRows, contentAnalysisRows, platformRecommendationRows, businessInsights, growthPlan, commercialTracks],
  );
  const scoreDistributionData = useMemo(
    () => buildScoreDistributionData(scoreItems),
    [scoreItems],
  );
  const dashboardScoreAverage = useMemo(
    () => scoreItems.length ? Math.round(scoreItems.reduce((sum, item) => sum + item.value, 0) / scoreItems.length) : 0,
    [scoreItems],
  );
  const dashboardDonutData = useMemo(
    () => scoreItems.map((item, index) => ({
      name: item.label,
      value: Math.max(1, item.value),
      fill: ["#7CFFB2", "#8AB8FF", "#FFD68E", "#FF9BC5", "#CFA5FF"][index % 5],
      panelId: getScorePanelId(item.label),
    })),
    [scoreItems],
  );
  const businessFunnelSteps = useMemo(() => {
    const primary = commercialTracks[0];
    const secondary = commercialTracks[1];
    return [
      {
        label: "看懂问题",
        value: Math.max(28, dashboardScoreAverage),
        detail: positioningRows[0]?.action || "先说用户现在卡在哪里。",
      },
      {
        label: "建立信任",
        value: Math.max(22, Math.round((commercialTracks[0]?.fit || dashboardScoreAverage) * 0.82)),
        detail: contentAnalysisRows[0]?.action || "先让用户愿意继续看和收藏。",
      },
      {
        label: "承接动作",
        value: Math.max(16, primary?.fit || 18),
        detail: primary?.nextStep || "先只保留一个主承接动作。",
      },
      {
        label: "放大成交",
        value: Math.max(10, secondary?.fit || Math.round((primary?.fit || 0) * 0.72)),
        detail: businessTrackRows[0]?.action || "跑出转化后再考虑投流和放大。",
      },
    ];
  }, [commercialTracks, businessTrackRows, positioningRows, contentAnalysisRows, dashboardScoreAverage]);
  const conversionFunnels = dashboardConsole?.conversionFunnels ?? [];
  const activeConversionFunnel = useMemo(
    () => conversionFunnels.find((item) => item.id === selectedFunnelSegment) || conversionFunnels[0] || null,
    [conversionFunnels, selectedFunnelSegment],
  );
  const dataEvidenceNotes = useMemo(
    () => (growthSnapshot?.status?.notes || []).filter((note) => /平台数据证据|抖音创作者中心证据|数据证据/i.test(note)),
    [growthSnapshot],
  );
  const platformDashboardCards = useMemo(
    () => platformRecommendationRows.slice(0, 4).map((row) => ({
      ...row,
      panelId: "platforms",
    })),
    [platformRecommendationRows],
  );
  const comparePlatformOptions = useMemo(
    () => platformRecommendations.map((item) => item.name).filter(Boolean),
    [platformRecommendations],
  );
  const filteredTrendRows = useMemo(
    () => selectedTrendPlatform === "all"
      ? trendRows
      : trendRows.filter((row) => row.platform === selectedTrendPlatform),
    [trendRows, selectedTrendPlatform],
  );
  const platformCompareRows = useMemo(
    () => buildPlatformCompareRows(growthSnapshot, platformRecommendations, selectedComparePlatform),
    [growthSnapshot, platformRecommendations, selectedComparePlatform],
  );
  const focusedBusinessTrack = useMemo(
    () => commercialTracks.find((item) => item.name === selectedBusinessTrack) || commercialTracks[0] || null,
    [commercialTracks, selectedBusinessTrack],
  );
  const primaryPlatformRecommendation = platformRecommendations[0] ?? null;
  const secondaryPlatformRecommendations = platformRecommendations.slice(1, 3);
  const visibleBusinessInsights = useMemo(
    () => businessInsights
      .filter((item) => item.detail.trim())
      .slice(0, 4),
    [businessInsights],
  );
  const visibleGrowthPlan = useMemo(
    () => growthPlan.slice(0, 3),
    [growthPlan],
  );
  const visibleAssetExtensions = useMemo(
    () => creationAssist?.assetExtensions.slice(0, 3) ?? [],
    [creationAssist],
  );
  const directCommercialAngles = useMemo(
    () => analysis?.commercialAngles?.slice(0, 4) ?? [],
    [analysis],
  );
  const personalizedDirectionCards = useMemo(
    () => buildPersonalizedDirectionCards(growthSnapshot, directCommercialAngles),
    [growthSnapshot, directCommercialAngles],
  );
  const primaryCommercialAngle = directCommercialAngles[0] ?? null;
  const directTitleSuggestions = useMemo(
    () => analysis?.titleSuggestions?.slice(0, 3) ?? [],
    [analysis],
  );
  const titleExecutionCards = useMemo(
    () => growthSnapshot?.titleExecutions ?? [],
    [growthSnapshot],
  );
  const assetAdaptation = growthSnapshot?.decisionFramework?.assetAdaptation ?? null;
  const visualKeyFrames = useMemo(
    () => analysis?.keyFrames?.slice(0, 4) ?? [],
    [analysis],
  );
  const platformActivityCards = useMemo(
    () => (growthSnapshot?.platformActivities ?? []).filter((item) => isCollectedPlatformLabel(item.platformLabel)),
    [growthSnapshot],
  );
  const topRecommendedPlatforms = useMemo(
    () => {
      if (platformRecommendations.length) {
        return platformRecommendations
          .filter((item) => isCollectedPlatformLabel(item.name))
          .map((item) => ({
          recommendation: item,
          activity: platformActivityCards.find((activity) => activity.platformLabel === item.name) || null,
          }))
          .sort((left, right) => {
            const leftCore = isCorePlatformLabel(left.recommendation.name) ? 0 : 1;
            const rightCore = isCorePlatformLabel(right.recommendation.name) ? 0 : 1;
            return leftCore - rightCore;
          })
          .slice(0, 4);
      }

      return platformActivityCards
        .filter((activity) => isCollectedPlatformLabel(activity.platformLabel))
        .sort((left, right) => {
          const leftCore = isCorePlatformLabel(left.platformLabel) ? 0 : 1;
          const rightCore = isCorePlatformLabel(right.platformLabel) ? 0 : 1;
          return leftCore - rightCore;
        })
        .slice(0, 4)
        .map((activity) => ({
        recommendation: {
          name: activity.platformLabel,
          reason: activity.summary,
          action: activity.optimizationPlan || activity.recommendedFormat,
          playbook: activity.contentAngle,
          topicIdeas: [],
        },
        activity,
      }));
    },
    [platformRecommendations, platformActivityCards],
  );
  const monetizationStrategyCards = useMemo(
    () => growthSnapshot?.monetizationStrategies ?? [],
    [growthSnapshot],
  );
  const dataLibrarySections = useMemo(
    () => growthSnapshot?.dataLibraryStructure ?? [],
    [growthSnapshot],
  );
  const recommendedPlatformNames = useMemo(
    () => (growthSnapshot?.growthHandoff?.recommendedPlatforms?.map((platform) => getPlatformLabel(platform)) ?? []).filter(isCollectedPlatformLabel),
    [growthSnapshot],
  );
  const visibleTopicLibrary = useMemo(
    () => growthSnapshot?.topicLibrary.slice(0, 6) ?? [],
    [growthSnapshot],
  );
  const topPlatformSnapshots = useMemo(
    () => (growthSnapshot?.platformSnapshots ?? []).filter((item) => isCollectedPlatformLabel(item.displayName)).slice(0, 5),
    [growthSnapshot],
  );
  const fallbackPlatformLabels = useMemo(() => {
    return ["抖音", "小红书", "B站", "快手"];
  }, []);
  const firstScreenGraphicPlan = useMemo(
    () => buildGraphicNoteDetail(
      recommendedPlatformNames,
      titleExecutionCards[0]?.graphicPlan,
      assetAdaptation?.firstHook || titleExecutionCards[0]?.openingHook,
    ),
    [recommendedPlatformNames, titleExecutionCards, assetAdaptation],
  );
  const firstScreenStoryboard = useMemo(
    () => buildVideoStoryboard(
      assetAdaptation?.firstHook || titleExecutionCards[0]?.openingHook,
      titleExecutionCards[0]?.videoPlan,
      growthHandoff?.storyboardPrompt,
      visualKeyFrames,
    ),
    [assetAdaptation, titleExecutionCards, growthHandoff, visualKeyFrames],
  );
  const topPlatformReferenceCards = useMemo(() => {
    return fallbackPlatformLabels.map((name) => {
      const recommendation = topRecommendedPlatforms.find((item) => item.recommendation.name === name)?.recommendation || null;
      const activity = platformActivityCards.find((item) => item.platformLabel === name) || null;
      const snapshot = topPlatformSnapshots.find((item) => item.displayName === name) || null;
      const relatedExamples = referenceExamples
        .filter((example) => example.platformLabel === name)
        .slice(0, 3)
        .map((example) => `${replaceTerms(example.account)}：${replaceTerms(example.title)}`);
      return {
        name,
        reason: recommendation?.reason || activity?.summary || snapshot?.summary || PLATFORM_REFERENCE_SUMMARY[name as keyof typeof PLATFORM_REFERENCE_SUMMARY],
        supportActivities: (activity?.supportActivities?.length ? activity.supportActivities : PLATFORM_SUPPORT_ACTIVITY_FALLBACK[name as keyof typeof PLATFORM_SUPPORT_ACTIVITY_FALLBACK]).slice(0, 3),
        potentialTrack: activity?.potentialTrack || activity?.suggestedTopics?.slice(0, 3).join(" / ") || snapshot?.sampleTopics?.slice(0, 3).join(" / ") || PLATFORM_REFERENCE_TRACKS[name as keyof typeof PLATFORM_REFERENCE_TRACKS].join(" / "),
        supportSignal: activity?.supportSignal || snapshot?.watchouts?.[0] ? `当前要注意：${replaceTerms(snapshot?.watchouts?.[0] || activity?.supportSignal || "")}` : PLATFORM_SUPPORT_SIGNAL_FALLBACK[name as keyof typeof PLATFORM_SUPPORT_SIGNAL_FALLBACK],
        relatedExamples,
      };
    });
  }, [fallbackPlatformLabels, topRecommendedPlatforms, platformActivityCards, topPlatformSnapshots, referenceExamples]);
  const topPlatformDataReferences = useMemo(() => {
    return fallbackPlatformLabels.map((title) => {
      const activity = platformActivityCards.find((item) => item.platformLabel === title) || null;
      const snapshot = topPlatformSnapshots.find((item) => item.displayName === title) || null;
      return {
        title,
        summary: activity?.summary || snapshot?.summary || PLATFORM_REFERENCE_SUMMARY[title as keyof typeof PLATFORM_REFERENCE_SUMMARY],
        topics: (
          activity?.hotTopics?.length ? activity.hotTopics.slice(0, 3)
            : activity?.suggestedTopics?.length ? activity.suggestedTopics.slice(0, 3)
            : snapshot?.sampleTopics?.length ? snapshot.sampleTopics.slice(0, 3)
            : visibleTopicLibrary
              .filter((item) => item.platformLabel === title || getPlatformLabel(item.platform) === title)
              .slice(0, 3)
              .map((item) => item.title)
        ).concat(PLATFORM_REFERENCE_TRACKS[title as keyof typeof PLATFORM_REFERENCE_TRACKS]).slice(0, 3),
        supportActivities: (activity?.supportActivities?.length ? activity.supportActivities : PLATFORM_SUPPORT_ACTIVITY_FALLBACK[title as keyof typeof PLATFORM_SUPPORT_ACTIVITY_FALLBACK]).slice(0, 3),
      };
    });
  }, [platformActivityCards, topPlatformSnapshots, fallbackPlatformLabels, visibleTopicLibrary]);
  const platformGraphicAnalysisCards = useMemo(() => {
    return fallbackPlatformLabels.map((label) => {
      const profile = PLATFORM_GRAPHIC_ANALYSIS_PROFILE[label as keyof typeof PLATFORM_GRAPHIC_ANALYSIS_PROFILE];
      const snapshot = topPlatformSnapshots.find((item) => item.displayName === label) || null;
      const activity = platformActivityCards.find((item) => item.platformLabel === label) || null;
      const recommendation = topRecommendedPlatforms.find((item) => item.recommendation.name === label)?.recommendation || null;
      const examples = referenceExamples
        .filter((item) => item.platformLabel === label)
        .slice(0, 3);
      const topics = (
        activity?.hotTopics?.length ? activity.hotTopics
          : activity?.suggestedTopics?.length ? activity.suggestedTopics
          : snapshot?.sampleTopics?.length ? snapshot.sampleTopics
          : visibleTopicLibrary.filter((item) => item.platformLabel === label || getPlatformLabel(item.platform) === label).map((item) => item.title)
      ).slice(0, 4);
      return {
        label,
        profile,
        summary: snapshot?.summary || activity?.summary || recommendation?.reason || PLATFORM_REFERENCE_SUMMARY[label as keyof typeof PLATFORM_REFERENCE_SUMMARY],
        recommendation: recommendation?.action || activity?.optimizationPlan || "",
        topics,
        supportActivities: (activity?.supportActivities?.length ? activity.supportActivities : PLATFORM_SUPPORT_ACTIVITY_FALLBACK[label as keyof typeof PLATFORM_SUPPORT_ACTIVITY_FALLBACK]).slice(0, 3),
        supportSignal: activity?.supportSignal || PLATFORM_SUPPORT_SIGNAL_FALLBACK[label as keyof typeof PLATFORM_SUPPORT_SIGNAL_FALLBACK],
        examples,
      };
    });
  }, [fallbackPlatformLabels, topPlatformSnapshots, platformActivityCards, topRecommendedPlatforms, referenceExamples, visibleTopicLibrary]);
  const referenceExamplesByPlatform = useMemo(() => {
    const grouped = new Map<string, ReferenceExampleCard[]>();
    referenceExamples.forEach((item) => {
      const key = item.platformLabel || getPlatformLabel(item.platform);
      if (!isCollectedPlatformLabel(key)) return;
      const current = grouped.get(key) || [];
      if (current.length < 3) current.push(item);
      grouped.set(key, current);
    });
    return Array.from(grouped.entries())
      .sort((left, right) => {
        const leftCore = isCorePlatformLabel(left[0]) ? 0 : 1;
        const rightCore = isCorePlatformLabel(right[0]) ? 0 : 1;
        return leftCore - rightCore;
      })
      .slice(0, 5);
  }, [referenceExamples]);
  const authorAnalysis: GrowthAuthorAnalysis | null = (growthSnapshot as any)?.authorAnalysis ?? null;
  const showPremiumReport = hasPaidGrowthAccess;
  const hotWordMatches: GrowthHotWordMatch[] = authorAnalysis?.hotWordMatches ?? [];
  const pushActivityMatches: GrowthPushActivity[] = authorAnalysis?.pushActivityMatches ?? [];
  const douyinIndexStatus = authorAnalysis?.douyinIndexStatus ?? null;
  const shouldHideGraphicBoard = isProcessing && inputKind === "video";
  const handleDownloadGraphicBoard = useCallback(() => {
    const cards = platformGraphicAnalysisCards.filter((item) => item.summary || item.topics.length || item.examples.length);
    if (!cards.length) {
      toast.error("当前没有可下载的图文分析内容");
      return;
    }
    const html = cards.map((item) => `
      <section style="background:#ffffff;border:1px solid #ffd0c0;border-radius:18px;padding:18px 20px;margin-bottom:16px;box-shadow:0 2px 16px rgba(255,80,60,.10)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
          <div style="font-size:22px;font-weight:900;color:#2d1a0e">${item.label}</div>
          <div style="font-size:12px;color:#ff2442;font-weight:700">平台图文分析</div>
        </div>
        <div style="margin-top:10px;font-size:14px;line-height:1.8;color:#6b4634">${replaceTerms(item.summary)}</div>
        <div style="margin-top:12px;padding:12px;border-radius:12px;background:#fff8f5;border-left:4px solid #ff6633">
          <div style="font-size:13px;font-weight:800;color:#ff2442">平台适合形式</div>
          <div style="margin-top:6px;font-size:13px;line-height:1.8;color:#2d1a0e">${replaceTerms(item.profile.contentForm)}</div>
          <div style="margin-top:6px;font-size:13px;line-height:1.8;color:#2d1a0e">图文类型：${replaceTerms(item.profile.noteType)}</div>
          <div style="margin-top:6px;font-size:13px;line-height:1.8;color:#2d1a0e">商业价值：${replaceTerms(item.profile.valueMode)}</div>
        </div>
        <div style="margin-top:12px">
          <div style="font-size:13px;font-weight:800;color:#ff2442">图文结构</div>
          ${item.profile.structure.map((row) => `<div style="margin-top:6px;font-size:13px;line-height:1.8;color:#6b4634">• ${replaceTerms(row)}</div>`).join("")}
        </div>
        ${item.topics.length ? `<div style="margin-top:12px;font-size:13px;line-height:1.8;color:#2d1a0e"><b>相关赛道：</b>${item.topics.map((entry) => replaceTerms(entry)).join(" / ")}</div>` : ""}
        ${item.supportActivities.length ? `<div style="margin-top:10px;font-size:13px;line-height:1.8;color:#2d1a0e"><b>当前有效扶持活动：</b>${item.supportActivities.map((entry) => replaceTerms(entry)).join(" / ")}</div>` : ""}
        ${item.examples.length ? `<div style="margin-top:10px"><div style="font-size:13px;font-weight:800;color:#ff2442">参考案例</div>${item.examples.map((entry) => `<div style="margin-top:6px;font-size:13px;line-height:1.8;color:#6b4634">• ${replaceTerms(entry.account)}：${replaceTerms(entry.title)}</div>`).join("")}</div>` : ""}
      </section>
    `).join("");
    const printWin = window.open("", "_blank", "width=1280,height=900");
    if (!printWin) {
      toast.error("请允许弹出窗口后再试");
      return;
    }
    printWin.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>平台图文分析</title><style>body{background:#fff5f0;margin:0;padding:24px;font-family:\"PingFang SC\",\"Microsoft YaHei\",sans-serif;color:#2d1a0e}@media print{body{-webkit-print-color-adjust:exact;color-adjust:exact}}</style></head><body>${html}</body></html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); }, 600);
  }, [platformGraphicAnalysisCards]);
  const getSectionCardClass = useCallback(
    (panelId: string, accent: string) => isPanelLinked(activeDashboardPanel, panelId)
      ? `relative overflow-hidden rounded-[28px] border ${accent} bg-[#122039] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_18px_40px_rgba(7,14,26,0.32)]`
      : "rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6",
    [activeDashboardPanel],
  );

  useEffect(() => {
    if (!dashboardPanels.length) return;
    if (!dashboardPanels.some((item) => item.id === activeDashboardPanel)) {
      setActiveDashboardPanel(dashboardPanels[0].id);
    }
  }, [dashboardPanels, activeDashboardPanel]);

  useEffect(() => {
    if (!comparePlatformOptions.length) return;
    if (!selectedComparePlatform || !comparePlatformOptions.includes(selectedComparePlatform)) {
      setSelectedComparePlatform(comparePlatformOptions[1] || comparePlatformOptions[0] || "");
    }
  }, [comparePlatformOptions, selectedComparePlatform]);

  useEffect(() => {
    if (!commercialTracks.length) return;
    if (!selectedBusinessTrack || !commercialTracks.some((item) => item.name === selectedBusinessTrack)) {
      setSelectedBusinessTrack(commercialTracks[0]?.name || "");
    }
  }, [commercialTracks, selectedBusinessTrack]);

  useEffect(() => {
    if (!conversionFunnels.length) return;
    if (!selectedFunnelSegment || !conversionFunnels.some((item) => item.id === selectedFunnelSegment)) {
      setSelectedFunnelSegment(conversionFunnels[0]?.id || "");
    }
  }, [conversionFunnels, selectedFunnelSegment]);

  const activateDashboardPanel = useCallback((panelId: string) => {
    setActiveDashboardPanel(panelId);
    if (panelId === "platforms" && comparePlatformOptions.length) {
      setSelectedComparePlatform(comparePlatformOptions[1] || comparePlatformOptions[0] || "");
    }
    if (panelId === "monetization" && commercialTracks.length) {
      setSelectedBusinessTrack(commercialTracks[0]?.name || "");
    }
    if (panelId === "positioning" || panelId === "content") {
      setSelectedTrendPlatform("all");
    }
    const target = sectionRefs.current[PANEL_SCROLL_TARGETS[panelId] || panelId];
    if (target) {
      requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        const withinViewport = rect.top >= 80 && rect.top <= window.innerHeight * 0.55;
        if (!withinViewport) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
  }, [commercialTracks, comparePlatformOptions]);

  const activePanelDetail = dashboardPanels.find((item) => item.id === activeDashboardPanel) || dashboardPanels[0];

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#08111f] text-[#f7f4ef]">
        <Loader2 className="h-8 w-8 animate-spin text-[#ff8a3d]" />
        <span className="mt-4 text-white/60">检查登录状态...</span>
      </div>
    );
  }

  if (!isAuthenticated && !supervisorAccess) return null;

  return (
    <div className="min-h-screen bg-[#08111f] text-[#f7f4ef]">
      <div className="mx-auto max-w-[1760px] px-4 py-8">
        <UsageQuotaBanner
          featureType="analysis"
          currentCount={usageStatsQuery.data?.features.analysis.currentCount ?? 0}
          freeLimit={usageStatsQuery.data?.features.analysis.limit ?? 2}
          loading={usageStatsQuery.isPending}
        />
        <TrialCountdownBanner
          isTrial={(usageStatsQuery.data as any)?.isTrial}
          trialEndDate={(usageStatsQuery.data as any)?.trialEndDate}
          trialExpired={(usageStatsQuery.data as any)?.trialExpired}
        />
        {usageStatsQuery.data?.studentPlan ? (
          <StudentUpgradePrompt
            studentPlan={usageStatsQuery.data.studentPlan}
            usageData={usageStatsQuery.data.features}
            isTrial={(usageStatsQuery.data as any).isTrial}
            trialEndDate={(usageStatsQuery.data as any).trialEndDate}
          />
        ) : null}

          <div className="mb-8 flex items-center justify-between">
          <button onClick={() => window.history.back()} className="rounded-full border border-white/10 bg-white/5 p-2 transition hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {supervisorAccess ? (
              <>
                <button
                  type="button"
                  onClick={() => setDebugMode((prev) => !prev)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/75 transition hover:bg-white/10"
                >
                  {debugMode ? "Debug ON" : "Debug OFF"}
                </button>
                <div className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200">
                  Supervisor Mode
                </div>
              </>
            ) : null}
            <div className="rounded-full border border-[#ff8a3d]/30 bg-[#ff8a3d]/10 px-3 py-1 text-sm text-[#ffb37f]">
              Creator Growth Camp
            </div>
          </div>
        </div>

        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,138,61,0.2),transparent_28%),radial-gradient(circle_at_top_right,rgba(38,132,255,0.15),transparent_24%),linear-gradient(180deg,#101d31_0%,#08111f_72%)] p-6 md:p-10">
          <div className="space-y-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/55">
                <Sparkles className="h-3.5 w-3.5" />
                {isPlatformPage ? "平台数据分析" : "创作商业成长营"}
              </div>
              <h1 className="mt-4 max-w-5xl text-4xl font-black leading-[0.96] text-white md:text-[86px]">
                {isPlatformPage ? (
                  <>
                    <span className="block whitespace-nowrap">把平台趋势、数据库证据与</span>
                    <span className="mt-3 inline-block rounded-[24px] border border-[#90c4ff]/45 bg-[#90c4ff]/8 px-5 py-2 text-[#e9f5ff] shadow-[0_0_0_1px_rgba(144,196,255,0.12)]">
                      发布判断
                    </span>
                    <span className="ml-2 inline-block text-white/90">拆开看清楚。</span>
                  </>
                ) : (
                  <>
                    <span className="block whitespace-nowrap">让你的图文与视频创意，发挥它们的</span>
                    <span className="mt-3 inline-block rounded-[24px] border border-[#ffcf92]/45 bg-[#ffcf92]/8 px-5 py-2 text-[#fff6e7] shadow-[0_0_0_1px_rgba(255,207,146,0.12)]">
                      商业价值
                    </span>
                    <span className="ml-2 inline-block text-white/90">。</span>
                  </>
                )}
              </h1>
              <p className="mt-5 max-w-4xl text-base leading-8 text-white/70">
                {isPlatformPage
                  ? "专门看平台推荐、平台数据参考、扶持信号和数据库证据，不把二创流程混进来。"
                  : "直接指出内容卡在哪里、该先修什么、先发哪里，以及怎么把流量接到可成交的商业动作。"}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                {isPlatformPage ? (
                  <>
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">平台推荐</div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">数据库证据</div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">扶持信号</div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">发平台判断</div>
                    <a href="/creator-growth-camp" className="rounded-2xl border border-[#ffcf92]/25 bg-[rgba(255,207,146,0.08)] px-4 py-3 text-sm text-[#fff0d4] transition hover:bg-[rgba(255,207,146,0.12)]">返回成长营全页</a>
                  </>
                ) : (
                  <>
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">内容分析</div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">趋势洞察</div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">商业洞察</div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">推荐平台</div>
                    <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">7 天增长规划</div>
                    <a href="/creator-growth-camp/platform" className="rounded-2xl border border-[#90c4ff]/25 bg-[rgba(144,196,255,0.08)] px-4 py-3 text-sm text-[#c7e3ff] transition hover:bg-[rgba(144,196,255,0.12)]">进入平台分析页</a>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/20 p-5 backdrop-blur-sm">
              <div className="mb-5 rounded-[22px] border border-white/10 bg-white/[0.04] p-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { value: "GROWTH" as const, label: "商业成长营", desc: "保留全局分析，强化商业路径与增长判断" },
                    { value: "REMIX" as const, label: "爆款拆解二创", desc: "聚焦钩子、情绪曲线、分镜和复刻执行" },
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setAnalysisMode(item.value)}
                      className={`rounded-[18px] px-4 py-3 text-left transition ${
                        analysisMode === item.value
                          ? "border border-[#ffcf92]/30 bg-[#ff8a3d]/18 text-white shadow-[0_0_28px_rgba(255,138,61,0.12)]"
                          : "border border-transparent bg-black/10 text-white/58 hover:bg-white/6"
                      }`}
                    >
                      <div className="text-sm font-bold">{item.label}</div>
                      <div className="mt-1 text-xs leading-5 text-white/55">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              {!selectedFile ? (
                <button
                  onClick={handleSelectFile}
                  className="flex min-h-[320px] w-full flex-col items-center justify-center rounded-[24px] border border-dashed border-white/15 bg-white/5 px-6 text-center transition hover:bg-white/10"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ff8a3d] text-black">
                    <Upload className="h-7 w-7" />
                  </div>
                  <div className="mt-5 text-2xl font-bold">
                    {isPlatformPage ? "上传图文档案或视频素材，专看平台判断" : "上传图文档案或视频素材"}
                  </div>
                  <p className="mt-3 max-w-md text-sm leading-7 text-white/60">
                    {isPlatformPage
                      ? "支持 Word、PDF、MP4。上传后聚焦输出平台推荐、平台数据参考和扶持判断，不把二创模块一起展开。"
                      : "支持 Word、PDF、MP4。上传后会直接帮你找出内容卖点、转化缺口与可放大的商业方向，让分析结果值得你采用。"}
                  </p>
                </button>
              ) : (
                <div className="space-y-4">
                  {previewUrl ? (
                    <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/30">
                      <img src={previewUrl} alt="Selected" className="max-h-[360px] w-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[24px] border border-white/10 bg-black/30 px-6 text-center">
                      {inputKind === "document" ? <FileUp className="h-12 w-12 text-[#ffb37f]" /> : <Film className="h-12 w-12 text-[#ffb37f]" />}
                      <div className="mt-4 text-xl font-bold text-white">
                        {inputKind === "document" ? "文档已就绪" : "视频文件已就绪"}
                      </div>
                      <p className="mt-2 text-sm leading-7 text-white/60">
                        {inputKind === "document"
                          ? "会先提取内容，再输出定位、平台与商业建议。"
                          : "会先抽帧与理解节奏，再输出可直接执行的分析报告。"}
                      </p>
                    </div>
                  )}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <FileUp className="h-4 w-4 text-[#ffb37f]" />
                        {fileName || "未命名文件"}
                      </span>
                      <span>{(fileSize / (1024 * 1024)).toFixed(1)} MB</span>
                    </div>
                    <div className="mt-4 h-2 rounded-full bg-white/10">
                      <div className="h-2 rounded-full bg-[#ff8a3d]" style={{ width: `${uploadProgress}%` }} />
                    </div>
                    {isProcessing ? (
                      <div className="mt-3 space-y-3 text-xs text-white/55">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-white/78">{processingStatusMessage}</div>
                          <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/60">
                            {uploadProgress}%
                          </div>
                        </div>
                        {activeProcessingStep ? (
                          <div className="rounded-xl border border-[#ff8a3d]/20 bg-[#ff8a3d]/8 px-3 py-2.5 text-white/75">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-[#ffcf92]">当前步骤</div>
                            <div className="mt-1 text-sm font-semibold text-white">{activeProcessingStep.label}</div>
                            <div className="mt-1 leading-6 text-white/68">{activeProcessingStep.detail}</div>
                          </div>
                        ) : null}
                        {animatedProcessingSteps.length ? (
                          <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
                            <div className="grid gap-2 md:grid-cols-3">
                              {animatedProcessingSteps.map((step) => (
                                <div
                                  key={step.id}
                                  className={`rounded-xl border px-3 py-2.5 ${
                                    step.status === "done"
                                      ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-50 shadow-[0_0_0_1px_rgba(110,231,183,0.12),0_0_24px_rgba(52,211,153,0.16)]"
                                      : step.status === "active"
                                        ? "animate-pulse border-[#ff8a3d]/35 bg-[rgba(255,138,61,0.14)] text-white shadow-[0_0_0_1px_rgba(255,138,61,0.1),0_0_24px_rgba(255,138,61,0.14)]"
                                        : "animate-pulse border-white/12 bg-[rgba(255,255,255,0.05)] text-white/60"
                                  }`}
                                >
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                                    {step.status === "done" ? "已完成" : step.status === "active" ? "进行中" : "等待中"}
                                  </div>
                                  <div className="mt-1 text-sm font-semibold">{step.animatedLabel || "…"}</div>
                                  <div className={`mt-1 text-xs leading-5 ${
                                    step.status === "done"
                                      ? "text-emerald-100/80"
                                      : step.status === "active"
                                        ? "text-white/82"
                                        : "text-white/55"
                                  }`}>
                                    {step.animatedDetail || "…"}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="rounded-xl border border-[#90c4ff]/18 bg-[rgba(144,196,255,0.07)] px-4 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-[11px] uppercase tracking-[0.16em] text-[#90c4ff]">平台当下活动</div>
                                {activeCarouselActivity ? (
                                  <div className="rounded-full border border-white/10 bg-black/15 px-2 py-1 text-[11px] text-white/60">
                                    每 10 秒轮播
                                  </div>
                                ) : null}
                              </div>
                              {activeCarouselActivity ? (
                                <div className="mt-3 space-y-3">
                                  <div>
                                    <div className="text-base font-bold text-white">{activeCarouselActivity.platformLabel}</div>
                                    <div className="mt-1 text-sm leading-6 text-white/72">{activeCarouselActivity.summary}</div>
                                  </div>
                                  {activeCarouselActivity.hotTopic ? (
                                    <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm leading-6 text-white/78">
                                      <span className="mr-2 inline-flex rounded-full border border-[#ffcf92]/20 bg-[#ffcf92]/10 px-2 py-0.5 text-[11px] text-[#ffd08f]">即时热题</span>
                                      {activeCarouselActivity.hotTopic}
                                    </div>
                                  ) : null}
                                  <div className="space-y-2 text-sm leading-6 text-white/78">
                                    {activeCarouselActivity.supportActivities.slice(0, 2).map((entry) => (
                                      <div key={`${activeCarouselActivity.platformLabel}-${entry}`} className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                                        {entry}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-3 text-sm leading-6 text-white/55">
                                  正在拉取当前有公开活动的平台信息，分析过程中会自动轮播展示。
                                </div>
                              )}
                            </div>
                          </div>
                        ) : null}
                        {processingDetailMessages.length ? (
                          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">模型正在做的事</div>
                            <div className="mt-2 space-y-2">
                              {processingDetailMessages.map((message, index) => (
                                <div key={`${index}-${message}`} className="flex items-start gap-2 text-white/65">
                                  <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-[#ff8a3d]" />
                                  <span className="leading-6">{message}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,application/pdf,video/mp4"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="mt-5">
                <label className="mb-2 block text-sm font-semibold text-white/80">
                  业务背景 / 商业目标
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={4}
                  placeholder="例如：我是形象穿搭美妆博主，想知道这支素材能承接什么商业价值，以及该先发哪个平台。"
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/30"
                />
              </div>

              <div className="mt-5">
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={handleAnalyze}
                  disabled={(!selectedFile && !fileBase64) || isProcessing}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#ff8a3d] px-5 py-3 font-bold text-black transition hover:bg-[#ff9c5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  开始进行商业分析
                </button>
                <button
                  onClick={handleReset}
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white/80 transition hover:bg-white/10"
                >
                  重置
                </button>
              </div>

              {error ? <div className="mt-4 text-sm text-rose-300">{error}</div> : null}
            </div>
          </div>
            </section>

        {!analysis ? (
          <section className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                <div className="flex items-center gap-3 text-[#ffb37f]">
                  <Compass className="h-5 w-5" />
                  <span className="font-semibold">趋势洞察</span>
                </div>
              </div>
            <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
              <div className="flex items-center gap-3 text-[#90c4ff]">
                <BriefcaseBusiness className="h-5 w-5" />
                <span className="font-semibold">商业洞察</span>
              </div>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
              <div className="flex items-center gap-3 text-[#9df6c0]">
                <Send className="h-5 w-5" />
                <span className="font-semibold">推荐平台</span>
              </div>
            </div>
          </section>
        ) : null}

        {debugMode ? (
          <section className="mt-8 space-y-6">
            <div className="rounded-[24px] border border-cyan-300/20 bg-cyan-400/10 p-5">
                <div className="text-sm font-semibold text-cyan-100">Debug 面板</div>
                <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${
                  growthAnomalies.length
                    ? "border-red-300/40 bg-red-500/15 text-red-100"
                    : "border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
                }`}>
                  系统状态：{growthHealthState}
                </div>
                {growthAnomalies.length ? (
                  <div className="mt-3 space-y-2 rounded-2xl border border-red-300/20 bg-red-500/10 p-4 text-sm text-red-50">
                    {growthAnomalies.map((item, index) => (
                      <div key={`growth-anomaly-${index}`} className="leading-6">
                        <span className="font-semibold">{String(item.title || "异常")}</span>
                        <span>：{String(item.message || "-")}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 grid gap-2 text-sm text-white/75 md:grid-cols-2">
                  <div>输入类型：{String(debugInfo?.inputKind || inputKind || "-")}</div>
                  <div>路由：{String(debugInfo?.route || "-")}</div>
                  <div>服务提供方：{String(debugInfo?.provider || "-")}</div>
                  <div>模型：{String(debugInfo?.model || "-")}</div>
                  <div>当前选择模型：{"gemini-2.5-pro"}</div>
                  <div>降级补位：{String(debugInfo?.fallback ?? "-")}</div>
                  <div>趋势数据来源：{String(growthSnapshot?.status.source || "-")}</div>
                  <div>真值口径：{formatTruthSource(growthSystemStatusQuery.data?.truthStore?.source)}</div>
                  <div>真值更新时间：{formatShanghaiDateTime(String(growthSystemStatusQuery.data?.truthStore?.updatedAt || ""))}</div>
                  <div>真值当前总量：{String(growthSystemStatusQuery.data?.truthStore?.currentItems ?? "-")}</div>
                  <div>真值历史总量：{String(growthSystemStatusQuery.data?.truthStore?.archivedItems ?? "-")}</div>
                  <div className={growthSystemStatusQuery.data?.storage?.lowSpace ? "font-semibold text-red-300 animate-pulse" : ""}>
                    剩余空间：{growthSystemStatusQuery.data?.storage ? `${String(growthSystemStatusQuery.data.storage.freeMb)} MB` : "-"}
                  </div>
                  <div>已用空间：{growthSystemStatusQuery.data?.storage ? `${String(growthSystemStatusQuery.data.storage.usedMb)} / ${String(growthSystemStatusQuery.data.storage.totalMb)} MB` : "-"}</div>
                  <div>服务健康度：{String(growthSystemStatusQuery.data?.serviceHealth?.label || (growthAnomalies.length ? "critical" : "passing"))}</div>
                  <div>健康检查时间：{formatShanghaiDateTime(String(growthSystemStatusQuery.data?.serviceHealth?.checkedAt || ""))}</div>
                  <div>运行模式：{String(growthSystemStatusQuery.data?.runtimeControl?.mode || "auto")}</div>
                  <div>模式更新时间：{formatShanghaiDateTime(String(growthSystemStatusQuery.data?.runtimeControl?.updatedAt || ""))}</div>
                  <div>文件类型：{String(debugInfo?.mimeType || fileMimeType || "-")}</div>
                  <div>文件名：{String(debugInfo?.fileName || fileName || "-")}</div>
                  <div>邮件配置可用：{String(growthSystemStatusQuery.data?.smtp?.configured ?? "-")}</div>
                  <div>邮件接收人：{String(growthSystemStatusQuery.data?.targetEmail || "-")}</div>
                  <div>邮件发送人：{String(growthSystemStatusQuery.data?.smtp?.from || "-")}</div>
                  <div>缺失配置：{Array.isArray(growthSystemStatusQuery.data?.smtp?.missing) ? growthSystemStatusQuery.data?.smtp?.missing.join(", ") || "-" : "-"}</div>
                  {debugInfo?.extractionMethod ? <div>提取方式：{String(debugInfo.extractionMethod)}</div> : null}
                  {debugInfo?.videoDuration ? <div>视频时长秒数：{String(debugInfo.videoDuration)}</div> : null}
                  {debugInfo?.transcriptChars ? <div>转录字数：{String(debugInfo.transcriptChars)}</div> : null}
                  {debugInfo?.failureStage ? <div>失败阶段：{String(debugInfo.failureStage)}</div> : null}
                  {debugInfo?.failureReason ? <div>失败原因：{String(debugInfo.failureReason)}</div> : null}
                </div>
                {(debugInfo?.videoPipeline || inputKind === "video") ? (
                  <div className="mt-4 rounded-2xl border border-cyan-200/15 bg-black/15 p-4 text-xs text-white/75">
                    <div className="text-xs uppercase tracking-[0.16em] text-cyan-100">视频链路 Debug</div>
                    <div className="mt-3 space-y-2 leading-6">
                      <div>1. 选择文件：{String((debugInfo as any)?.videoPipeline?.selectedFile?.name || fileName || "-")} / {String((debugInfo as any)?.videoPipeline?.selectedFile?.size || fileSize || "-")} bytes</div>
                      <div>2. 上传：{String((debugInfo as any)?.videoPipeline?.upload?.status || "idle")} / 进度 {String((debugInfo as any)?.videoPipeline?.upload?.progress ?? uploadProgress ?? "-")}%</div>
                      <div>3. 上传结果：GCS {String((debugInfo as any)?.videoPipeline?.upload?.gcsUri || "-")} / URL {String((debugInfo as any)?.videoPipeline?.upload?.url || "-")} / Key {String((debugInfo as any)?.videoPipeline?.upload?.key || "-")}</div>
                      <div>4. 派发模式：{String((debugInfo as any)?.videoPipeline?.mode || "job")} / 路由 {String((debugInfo as any)?.videoPipeline?.dispatch?.route || "-")} / 模型 {String((debugInfo as any)?.videoPipeline?.dispatch?.modelName || "-")}</div>
                      <div>5. 派发状态：{String((debugInfo as any)?.videoPipeline?.dispatch?.status || "idle")}</div>
                      <div>6. Job：ID {String((debugInfo as any)?.videoPipeline?.job?.jobId || "-")} / 状态 {String((debugInfo as any)?.videoPipeline?.job?.status || "-")} / 轮询 {String((debugInfo as any)?.videoPipeline?.job?.pollCount ?? "-")} 次</div>
                      <div>7. 分析：{String((debugInfo as any)?.videoPipeline?.analysis?.status || "idle")} / Provider {String((debugInfo as any)?.videoPipeline?.analysis?.provider || debugInfo?.provider || "-")} / Model {String((debugInfo as any)?.videoPipeline?.analysis?.model || debugInfo?.model || "-")}</div>
                      <div>8. Signed URL 申请失败：{String((debugInfo as any)?.videoPipeline?.upload?.signedUrlError || "-")}</div>
                      <div>9. 上传失败：{String((debugInfo as any)?.videoPipeline?.upload?.error || "-")}</div>
                      <div>10. 失败定位：阶段 {String((debugInfo as any)?.videoPipeline?.analysis?.failureStage || debugInfo?.failureStage || "-")} / 原因 {String((debugInfo as any)?.videoPipeline?.analysis?.failureReason || debugInfo?.failureReason || (debugInfo as any)?.videoPipeline?.analysis?.error || "-")}</div>
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 rounded-2xl border border-fuchsia-200/15 bg-black/15 p-4 text-xs text-white/75">
                  <div className="font-semibold text-fuchsia-100">运行控制</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      { mode: "auto", label: "自动" },
                      { mode: "live", label: "只跑 live" },
                      { mode: "backfill", label: "只跑回填" },
                    ].map((item) => {
                      const active = growthSystemStatusQuery.data?.runtimeControl?.mode === item.mode;
                      return (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() => setGrowthRuntimeModeMutation.mutate({ mode: item.mode as "auto" | "live" | "backfill" })}
                          disabled={setGrowthRuntimeModeMutation.isPending}
                          className={`rounded-full border px-3 py-1.5 transition ${
                            active
                              ? "border-fuchsia-300 bg-fuchsia-400/20 text-fuchsia-100"
                              : "border-white/15 bg-white/5 text-white/75 hover:border-fuchsia-200/30 hover:text-white"
                          } ${setGrowthRuntimeModeMutation.isPending ? "opacity-60" : ""}`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 font-semibold text-fuchsia-100">Burst 控制</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      { burst: "auto", label: "自动" },
                      { burst: "off", label: "全部关闭" },
                      { burst: "manual", label: "手动平台" },
                    ].map((item) => {
                      const active = growthSystemStatusQuery.data?.runtimeControl?.burst === item.burst;
                      return (
                        <button
                          key={item.burst}
                          type="button"
                          onClick={() => trySetBurstControl({
                            burst: item.burst as "auto" | "manual" | "off",
                            platforms: item.burst === "manual"
                              ? (((growthSystemStatusQuery.data?.runtimeControl?.burstPlatforms as Array<"douyin" | "xiaohongshu" | "bilibili" | "kuaishou" | "toutiao"> | undefined) || []))
                              : [],
                          })}
                          disabled={setGrowthBurstControlMutation.isPending}
                          className={`rounded-full border px-3 py-1.5 transition ${
                            active
                              ? "border-fuchsia-300 bg-fuchsia-400/20 text-fuchsia-100"
                              : "border-white/15 bg-white/5 text-white/75 hover:border-fuchsia-200/30 hover:text-white"
                          } ${setGrowthBurstControlMutation.isPending ? "opacity-60" : ""}`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["douyin", "kuaishou", "bilibili", "xiaohongshu", "toutiao"] as const).map((platform) => {
                      const selected = ((growthSystemStatusQuery.data?.runtimeControl?.burstPlatforms as string[] | undefined) || []).includes(platform);
                      const manual = growthSystemStatusQuery.data?.runtimeControl?.burst === "manual";
                      return (
                        <button
                          key={platform}
                          type="button"
                          onClick={() => {
                            const current = new Set(((growthSystemStatusQuery.data?.runtimeControl?.burstPlatforms as string[] | undefined) || []));
                            if (current.has(platform)) current.delete(platform);
                            else current.add(platform);
                            trySetBurstControl({
                              burst: "manual",
                              platforms: Array.from(current) as Array<"douyin" | "xiaohongshu" | "bilibili" | "kuaishou" | "toutiao">,
                            });
                          }}
                          disabled={setGrowthBurstControlMutation.isPending}
                          className={`rounded-full border px-3 py-1.5 transition ${
                            manual && selected
                              ? "border-amber-300 bg-amber-400/20 text-amber-100"
                              : "border-white/15 bg-white/5 text-white/75 hover:border-amber-200/30 hover:text-white"
                          } ${setGrowthBurstControlMutation.isPending ? "opacity-60" : ""}`}
                        >
                          {getPlatformLabel(platform)}
                        </button>
                      );
                    })}
                  </div>
                  {hasCriticalGrowthAnomaly ? (
                    <div className="mt-3 text-xs font-semibold text-red-200">
                      当前系统状态异常，不建议开启 burst。
                    </div>
                  ) : null}
                </div>
                {growthSystemStatusQuery.data?.truthStore?.platforms?.length ? (
                  <div className="mt-4 space-y-2 rounded-2xl border border-sky-200/15 bg-black/15 p-4 text-xs text-white/72">
                    <div className="font-semibold text-sky-100">各平台真值拆分</div>
                    <div className="space-y-2">
                      {growthSystemStatusQuery.data.truthStore.platforms.map((item) => (
                        <div key={String(item.platform)} className="grid gap-1 md:grid-cols-2">
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} live 当前量：{String(item.currentItems || 0)}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} historical 历史量：{String(item.archivedItems || 0)}</div>
                          <div className="md:col-span-2">{String(item.platformLabel || getPlatformLabel(item.platform))} 说明：{String(item.platformDescription || getPlatformDescription(item.platform))}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {growthSnapshotDebug ? (
                  <div className="mt-4 space-y-2 rounded-2xl border border-emerald-200/15 bg-black/15 p-4 text-xs text-white/72">
                    <div className="font-semibold text-emerald-100">Growth Snapshot Debug</div>
                    <div className="grid gap-1 md:grid-cols-2">
                      <div>快照路由：{String(growthSnapshotDebug.route || "-")}</div>
                      <div>快照模型：{String(growthSnapshotDebug.modelName || "-")}</div>
                      <div>基础来源：{String(growthSnapshotDebug.baseSource || "-")}</div>
                      <div>最终来源：{String(growthSnapshotDebug.finalSource || "-")}</div>
                      <div>分析窗口天数：{String(growthSnapshotDebug.windowDays || "-")}</div>
                      <div>是否有实时样本：{String(growthSnapshotDebug.hasAnyLiveCollection ?? "-")}</div>
                      <div>是否应用个性化：{String(growthSnapshotDebug.personalizedApplied ?? "-")}</div>
                      <div>状态备注数：{String(growthSnapshotDebug.notesCount || 0)}</div>
                      <div>请求平台：{formatPlatformList(growthSnapshotDebug.requestedPlatforms)}</div>
                      <div>过期平台：{formatPlatformList(growthSnapshotDebug.stalePlatforms)}</div>
                      <div>趋势层数量：{String(growthSnapshotDebug.trendLayerCount || 0)}</div>
                      <div>选题库数量：{String(growthSnapshotDebug.topicLibraryCount || 0)}</div>
                      <div>平台快照数：{String(growthSnapshotDebug.platformSnapshotCount || 0)}</div>
                      <div>商业化轨道数：{String(growthSnapshotDebug.monetizationTrackCount || 0)}</div>
                      <div>平台建议数：{String(growthSnapshotDebug.recommendationCount || 0)}</div>
                      <div>商业洞察数：{String(growthSnapshotDebug.businessInsightCount || 0)}</div>
                      <div>增长步骤数：{String(growthSnapshotDebug.growthPlanCount || 0)}</div>
                      <div>资产扩展数：{String(growthSnapshotDebug.creationAssetExtensionCount || 0)}</div>
                    </div>
                    {growthSnapshot?.status?.notes?.length ? (
                      <div className="space-y-1 rounded-xl border border-emerald-200/15 bg-emerald-400/5 p-3 leading-6">
                        {growthSnapshot.status.notes.slice(0, 8).map((note, index) => (
                          <div key={`snapshot-note-${index}`}>{String(note)}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {growthSystemStatusQuery.data?.scheduler?.length && growthSystemStatusQuery.data?.runtimeControl?.mode !== "backfill" ? (
                  <div className="mt-4 space-y-2 rounded-2xl border border-cyan-200/15 bg-black/15 p-4 text-xs text-white/72">
                    <div className="font-semibold text-cyan-100">抓取调度状态</div>
                    <div className="rounded-xl border border-cyan-200/15 bg-cyan-400/5 p-3 leading-6">
                      <div>全部平台 live：统一每 30 分钟抓取一次</div>
                      <div>burst 控制：{String(growthSystemStatusQuery.data?.runtimeControl?.burst || "auto")}</div>
                      <div>burst 平台：{(((growthSystemStatusQuery.data?.runtimeControl?.burstPlatforms as string[] | undefined) || []).map((item) => getPlatformLabel(item)).join("、")) || "-"}</div>
                      <div>历史回填：仍按独立 backfill 节奏执行，不跟 live 共用频率</div>
                    </div>
                    {growthSystemStatusQuery.data.scheduler.map((item) => (
                      <div key={String(item.platform)} className="grid gap-1 md:grid-cols-2">
                        <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 最近成功：{formatShanghaiDateTime(String(item.lastSuccessAt || ""))}</div>
                        <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 下次执行：{formatShanghaiDateTime(String(item.nextRunAt || ""))}</div>
                        <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 失败次数：{String(item.failureCount ?? 0)}</div>
                        <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 爆发模式：{String(item.burstMode ?? false)}</div>
                        <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 最近抓取量：{String(item.lastCollectedCount ?? 0)}</div>
                        <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 爆发开始：{formatShanghaiDateTime(String(item.burstTriggeredAt || ""))}</div>
                        <div className="md:col-span-2">{String(item.platformLabel || getPlatformLabel(item.platform))} 说明：{String(item.platformDescription || getPlatformDescription(item.platform))}</div>
                        <div className="md:col-span-2">{String(item.platformLabel || getPlatformLabel(item.platform))} 错误：{String(item.lastError || "-")}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {[{
                  key: "live",
                  title: "近期回填进度",
                  data: growthSystemStatusQuery.data?.backfillLive,
                }, {
                  key: "history",
                  title: "历史回填进度",
                  data: growthSystemStatusQuery.data?.backfillHistory,
                }].map((section) => {
                  const sectionData = section.data;
                  return sectionData ? (
                  <div key={section.key} className="mt-4 space-y-2 rounded-2xl border border-amber-200/15 bg-black/15 p-4 text-xs text-white/72">
                    <div className="font-semibold text-amber-100">{section.title}</div>
                    <div className="grid gap-1 md:grid-cols-2">
                      <div>status: {String(sectionData.status || "-")}</div>
                      <div>active: {String(sectionData.active ?? false)}</div>
                      <div>window days: {String(sectionData.selectedWindowDays || "-")}</div>
                      <div>回填模式：{section.key === "history" ? "夜间 burst / 每 15 分钟" : "夜间 live 回填 / 每 15 分钟"}</div>
                      <div>开始时间：{formatShanghaiDateTime(String(sectionData.startedAt || ""))}</div>
                      <div>下一次回填：{formatShanghaiDateTime(String(sectionData.nextRunAt || ""))}</div>
                      <div>更新时间：{formatShanghaiDateTime(String(sectionData.updatedAt || ""))}</div>
                      <div>结束时间：{formatShanghaiDateTime(String(sectionData.finishedAt || ""))}</div>
                    </div>
                    <div className="rounded-xl border border-amber-200/15 bg-amber-400/5 p-3 leading-6">
                      {String(sectionData.note || "-")}
                    </div>
                    <div className="space-y-2">
                      {sectionData.platforms?.map((item) => (
                        <div key={`${section.key}-${String(item.platform)}`} className="grid gap-1 md:grid-cols-2">
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 状态：{String(item.status || "-")}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 历史量：{String(item.archivedTotal || 0)} / {String(item.target || 0)}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 开始回填：{formatShanghaiDateTime(String(item.startedAt || sectionData.startedAt || ""))}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 下次回填：{formatShanghaiDateTime(String(item.nextRunAt || sectionData.nextRunAt || ""))}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 当前量：{String(item.currentTotal || 0)}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 新增：{String(item.addedCount || 0)}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 合并：{String(item.mergedCount || 0)}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 平台停滞轮数：{String(item.plateauCount || 0)}</div>
                          <div className="md:col-span-2">{String(item.platformLabel || getPlatformLabel(item.platform))} 错误：{String(item.error || "-")}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null})}
              </div>
          </section>
        ) : null}

        {analysis ? (
          <section className="mt-8 space-y-6">
            {showPremiumReport ? (
              <div className="space-y-6">
                {showPremiumReport && (
                  <PlatformTrendEntryPanel />
                )}

                {(analysis.explosiveIndex || analysis.realityCheck || analysis.reverseEngineering || analysis.premiumContent?.topics?.length || analysis.growthStrategy || analysis.remixExecution) ? (
                  <>
                    <div className="grid gap-6 lg:grid-cols-[0.34fr_0.66fr]">
                      <div className="rounded-[28px] border border-[#ffb454]/25 bg-[#141d32] p-6">
                        <div className="text-xs uppercase tracking-[0.16em] text-[#ffcf92]">1-10分爆款指数</div>
                        <div className="mt-3 text-5xl font-black text-[#ffd08f]">{Math.max(0, Math.min(10, Math.round(Number(analysis.explosiveIndex || 0))))}</div>
                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-white/72">
                          {[
                            ["小红书", analysis.platformScores?.xiaohongshu],
                            ["抖音", analysis.platformScores?.douyin],
                            ["B站", analysis.platformScores?.bilibili],
                            ["快手", analysis.platformScores?.kuaishou],
                          ].map(([label, score]) => (
                            <div key={String(label)} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                              <div className="text-white/45">{label}</div>
                              <div className="mt-1 text-lg font-black text-[#ffd08f]">{Math.max(0, Math.min(10, Math.round(Number(score || 0))))}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-[28px] border border-[#ff7f7f]/20 bg-[#1a1726] p-6">
                        <div className="text-xs uppercase tracking-[0.16em] text-[#ffb3b3]">首席战略师点评</div>
                        <div className="mt-3 text-base leading-8 text-white">{replaceTerms(analysis.realityCheck || "当前还没有足够清晰的现实查验结论。")}</div>
                      </div>
                    </div>

                    {isRemixMode ? (
                      <div className="rounded-[28px] border border-[#f5b7ff]/20 bg-[#151425] p-6">
                        <div className="flex items-center gap-3 text-[#f5b7ff]">
                          <Sparkles className="h-5 w-5" />
                          <h2 className="text-2xl font-bold">实战爆款二创</h2>
                        </div>
                        {renderPremiumTopicCards(analysis.premiumContent?.topics, replaceTerms)}
                        {(analysis.premiumContent?.actionableTopics?.length ?? 0) > 0 ? (
                          <div className="mt-8">
                            <h3 className="mb-4 text-xl font-bold text-amber-400">🚀 现在就能执行的版本</h3>
                            {renderPremiumTopicCards(analysis.premiumContent?.actionableTopics as PremiumTopic[], replaceTerms)}
                          </div>
                        ) : null}
                        {analysis.premiumContent?.musicAndExpressionAnalysis ? (
                          <div className="mt-8 rounded-2xl border border-purple-500/30 bg-purple-500/10 p-6">
                            <h3 className="mb-4 text-lg font-bold text-purple-400">🎵 表达与配乐分析</h3>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                              {analysis.premiumContent.musicAndExpressionAnalysis}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                        <div className="flex items-center gap-3 text-[#ffcf92]">
                          <LayoutDashboard className="h-5 w-5" />
                          <h2 className="text-2xl font-bold">商业成长营</h2>
                        </div>
                        {analysis.premiumContent?.personalizedGrowthDirection ? (
                          <div className="mt-5 rounded-2xl border-l-4 border-emerald-500 bg-emerald-500/10 p-6">
                            <h3 className="mb-4 text-xl font-bold text-emerald-400">📈 个性化增长方向 (顶级顾问深度分析)</h3>
                            <div className="whitespace-pre-wrap leading-relaxed text-gray-200">
                              {analysis.premiumContent.personalizedGrowthDirection}
                            </div>
                          </div>
                        ) : null}
                        {analysis.premiumContent?.strategy ? (
                          <div className="mt-5 rounded-2xl border-l-4 border-amber-500 bg-amber-500/10 p-6">
                            <h3 className="mb-4 text-xl font-bold text-amber-400">💼 商业战略拆解</h3>
                            <div className="prose prose-invert max-w-none whitespace-pre-wrap text-gray-200">
                              {analysis.premiumContent.strategy}
                            </div>
                          </div>
                        ) : null}
                        {analysis.premiumContent?.explosiveTopicAnalysis ? (
                          <div className="mt-5 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-6">
                            <h3 className="mb-4 text-lg font-bold text-blue-400">🔥 爆款选题分析</h3>
                            <p className="whitespace-pre-wrap text-gray-300">
                              {analysis.premiumContent.explosiveTopicAnalysis}
                            </p>
                          </div>
                        ) : null}
                        {renderPremiumTopicCards(analysis.premiumContent?.topics, replaceTerms)}
                        {(analysis.premiumContent?.actionableTopics?.length ?? 0) > 0 ? (
                          <div className="mt-8">
                            <h3 className="mb-4 text-xl font-bold text-amber-400">🚀 现在就能执行的版本</h3>
                            {renderPremiumTopicCards(analysis.premiumContent?.actionableTopics as PremiumTopic[], replaceTerms)}
                          </div>
                        ) : null}
                        {analysis.premiumContent?.musicAndExpressionAnalysis ? (
                          <div className="mt-8 rounded-2xl border border-purple-500/30 bg-purple-500/10 p-6">
                            <h4 className="mb-4 text-lg font-bold text-purple-400">🎵 表达与配乐分析</h4>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                              {analysis.premiumContent.musicAndExpressionAnalysis}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </>
                ) : null}

                {/* === AUTHOR ANALYSIS: IDENTITY + COMMERCIAL VALUE === */}
                {authorAnalysis && (
                  <div className="mb-8 grid gap-6 md:grid-cols-2">
                    <div className="rounded-[28px] border border-[#ff8a3d]/20 bg-[#122039] p-8 shadow-[0_18px_40px_rgba(7,14,26,0.32)]">
                      <div className="mb-6 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#ffcf92]/20 to-[#ff8a3d]/10">
                            <User className="h-5 w-5 text-[#ffcf92]" />
                          </div>
                          <h3 className="text-xl font-bold text-[#f7f4ef]">作者身份深度画像</h3>
                        </div>
                        <span className="rounded-full border border-[#ff8a3d]/30 bg-[#ff8a3d]/10 px-3 py-1 text-sm font-medium text-[#ffcf92]">
                          {authorAnalysis.identity.tier}
                        </span>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <div className="mb-1 text-sm text-white/50">判定依据</div>
                          <p className="text-sm leading-relaxed text-[#f7f4ef]">{authorAnalysis.identity.tierReason}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4 rounded-xl bg-black/20 p-4">
                          <div>
                            <div className="mb-1 text-xs text-white/50">垂类定位</div>
                            <div className="font-medium text-[#ffcf92]">{authorAnalysis.identity.verticalCategory}</div>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-white/50">预估规模</div>
                            <div className="font-medium text-[#ffcf92]">{authorAnalysis.identity.estimatedFollowers}</div>
                          </div>
                        </div>
                        <div>
                          <div className="mb-2 text-sm text-white/50">内容标签</div>
                          <div className="flex flex-wrap gap-2">
                            {authorAnalysis.identity.identityTags.map((tag: string, tagIdx: number) => (
                              <span key={tagIdx} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70">{tag}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="mb-2 text-sm text-white/50">推荐变现路径</div>
                          <div className="flex flex-wrap gap-2">
                            {authorAnalysis.identity.monetizationPaths.map((p: string, pIdx: number) => (
                              <span key={pIdx} className="rounded-lg border border-[#ffcf92]/20 bg-[#ffcf92]/10 px-2.5 py-1 text-xs text-[#ffcf92]">{p}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-[#f5b7ff]/20 bg-[#122039] p-8 shadow-[0_18px_40px_rgba(7,14,26,0.32)]">
                      <div className="mb-6 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#f5b7ff]/20 to-[#ff8cf0]/10">
                            <CircleDollarSign className="h-5 w-5 text-[#f5b7ff]" />
                          </div>
                          <h3 className="text-xl font-bold text-[#f7f4ef]">商业变现潜力</h3>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white/50">转化指数</span>
                          <span className="text-lg font-bold text-[#f5b7ff]">{authorAnalysis.monetizationValue.ecommerceConversionScore}</span>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="rounded-xl bg-black/20 p-4">
                          <div className="mb-1 text-xs text-white/50">千次播放单价预判</div>
                          <div className="font-medium text-[#f5b7ff]">{authorAnalysis.monetizationValue.cpmEstimate}</div>
                          <div className="mt-1 text-xs text-white/50">{authorAnalysis.monetizationValue.cpmReason}</div>
                        </div>
                        <div>
                          <div className="mb-1 text-sm text-white/50">带货转化潜力</div>
                          <p className="text-sm leading-relaxed text-[#f7f4ef]">{authorAnalysis.monetizationValue.ecommerceConversionReason}</p>
                        </div>
                        <div>
                          <div className="mb-1 text-sm text-white/50">品牌合作匹配</div>
                          <p className="text-sm leading-relaxed text-[#f7f4ef]">{authorAnalysis.monetizationValue.brandMatchReason}</p>
                        </div>
                        <div>
                          <div className="mb-2 text-sm text-white/50">推荐变现路径</div>
                          <div className="space-y-2">
                            {authorAnalysis.monetizationValue.recommendedPaths.map((path: any, rpIdx: number) => (
                              <div key={rpIdx} className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
                                <span className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-xs text-white/80">{path.platform}</span>
                                <div>
                                  <div className="text-sm font-medium text-[#f7f4ef]">{path.path}</div>
                                  <div className="mt-1 text-xs text-white/60">{path.reason}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* === HOT WORDS & PUSH ACTIVITIES === */}
                {authorAnalysis && (hotWordMatches.length > 0 || pushActivityMatches.length > 0) && (
                  <div className="mb-8 grid gap-6 md:grid-cols-2">
                    <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-8">
                      <div className="mb-6 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#90c4ff]/20 to-[#2684ff]/10">
                            <TrendingUp className="h-5 w-5 text-[#90c4ff]" />
                          </div>
                          <h3 className="text-xl font-bold text-[#f7f4ef]">平台热词匹配</h3>
                        </div>
                        {douyinIndexStatus?.connected && (
                          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
                            实时连通
                          </span>
                        )}
                      </div>
                      <div className="space-y-3">
                        {hotWordMatches.slice(0, 4).map((match: any, hwIdx: number) => (
                          <div key={hwIdx} className="rounded-xl border border-white/5 bg-black/20 p-4">
                            <div className="mb-2 flex items-start justify-between">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded bg-[#90c4ff]/20 px-2 py-0.5 text-xs text-[#90c4ff]">{match.platformLabel}</span>
                                <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/70">{match.hotWordType}</span>
                                <span className="font-medium text-[#f7f4ef]">{match.hotWord}</span>
                              </div>
                              <span className="shrink-0 text-sm font-bold text-[#9df6c0]">{match.matchScore}分</span>
                            </div>
                            <div className="mb-1 text-xs text-white/60">{match.matchReason}</div>
                            {match.contentSuggestion && <div className="text-xs text-[#ffcf92]">{match.contentSuggestion}</div>}
                          </div>
                        ))}
                        {hotWordMatches.length === 0 && (
                          <div className="flex h-32 items-center justify-center rounded-xl border border-white/5 bg-black/20 text-sm text-white/40">
                            当前平台热词数据待同步
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-8">
                      <div className="mb-6 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#15ff9b]/20 to-[#9df6c0]/10">
                            <Rocket className="h-5 w-5 text-[#9df6c0]" />
                          </div>
                          <h3 className="text-xl font-bold text-[#f7f4ef]">官方推流活动推荐</h3>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {pushActivityMatches.length > 0 ? (
                          pushActivityMatches.slice(0, 4).map((activity: any, paIdx: number) => (
                            <div key={paIdx} className="rounded-xl border border-[#9df6c0]/10 bg-[#9df6c0]/5 p-4">
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/80">{activity.platformLabel}</span>
                                <span className="rounded bg-[#9df6c0]/20 px-2 py-0.5 text-xs text-[#9df6c0]">{activity.activityType}</span>
                                <span className="font-medium text-[#f7f4ef]">{activity.activityName}</span>
                                {activity.deadline && <span className="ml-auto text-xs text-white/50">{activity.deadline}</span>}
                              </div>
                              <p className="mb-2 text-xs leading-relaxed text-white/70">{activity.submissionSuggestion}</p>
                              <div className="text-xs text-white/50"><span className="text-[#f5b7ff]">匹配理由：</span>{activity.matchReason}</div>
                            </div>
                          ))
                        ) : (
                          <div className="flex h-32 items-center justify-center rounded-xl border border-white/5 bg-black/20 text-sm text-white/40">
                            当前无高匹配度的官方推流活动
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
        <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffcf92]">
                    <LayoutDashboard className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">{isRemixMode ? "实战爆款二创" : "本次个性化判断"}</h2>
                  </div>
                  <div className="mt-5 grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
                    <div className="rounded-[24px] border border-white/10 bg-black/15 p-5">
                      <div className="text-xs uppercase tracking-[0.18em] text-[#7ee7ff]">核心结论</div>
                      <div className="mt-2 text-2xl font-black text-white">
                        {primaryCommercialAngle?.title || dashboardConsole?.headline || primaryPlatformRecommendation?.name || "先产出一版可执行方案"}
                      </div>
                      <p className="mt-3 max-w-3xl text-sm leading-7 text-white/68">
                        {primaryCommercialAngle
                          ? stripInternalJargon(`${primaryCommercialAngle.scenario} ${primaryCommercialAngle.whyItFits}`)
                          : dashboardConsole?.summary || growthSnapshot?.overview.summary || analysis.summary}
                      </p>
                    </div>
                    <div className="grid gap-4">
                      <div className="rounded-[24px] border border-[#ffd08f]/20 bg-[linear-gradient(135deg,rgba(255,208,143,0.12),rgba(255,255,255,0.03))] p-5">
                        <div className="text-xs uppercase tracking-[0.18em] text-[#ffd08f]">马上先做</div>
                        <div className="mt-3 text-sm leading-7 text-white">
                          {stripInternalJargon(primaryCommercialAngle?.execution || growthHandoff?.brief || primaryPlatformRecommendation?.action || visibleBusinessInsights[0]?.detail || "先把首发版改成一个用户一看就懂的版本。")}
                        </div>
                      </div>
                      <div className="rounded-[24px] border border-[#f5b7ff]/20 bg-[linear-gradient(135deg,rgba(245,183,255,0.12),rgba(255,255,255,0.03))] p-5">
                        <div className="text-xs uppercase tracking-[0.18em] text-[#f5b7ff]">首发形式判断</div>
                        <div className="mt-3 text-sm leading-7 text-white/88">
                          {replaceTerms(assetAdaptation?.format || titleExecutionCards[0]?.presentationMode || "优先短视频首发，再补图文版本。")}
                        </div>
                        <div className="mt-2 text-sm leading-7 text-white/68">
                          {replaceTerms(assetAdaptation?.firstHook || titleExecutionCards[0]?.openingHook || "开头先抛一个最扎心的问题或最直接的结果。")}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[1.05fr_1.2fr]">
                <div className="rounded-[28px] border border-[#ff8a3d]/15 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffcf92]">
                    <Sparkles className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">基础内容诊断</h2>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/65">
                    免费版只提供素材本身的基础判断，包括五维度评分、当前优势和优先问题。优化方案、商业分析、平台建议和增长规划属于付费服务，不在免费版展示范围内。
                  </p>
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/68">
                    <div className="font-semibold text-white">当前可查看</div>
                    <div className="mt-2">1. 五维度成熟度</div>
                    <div>2. 内容优点</div>
                    <div>3. 优先问题</div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-400/10 p-4 text-sm leading-7 text-amber-50">
                    升级后可解锁：趋势洞察、平台优化方案、商业分析、推荐发布平台、7 天增长规划与创作执行简报。
                  </div>
                </div>
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-bold text-white">五维度成熟度</div>
                    <div className="text-xs text-white/45">满分 100</div>
                  </div>
                  <div className="mt-4 h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={scoreDistributionData} margin={{ top: 12, right: 8, left: -24, bottom: 8 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.04)" }}
                          contentStyle={{ background: "#0b1628", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, color: "#fff" }}
                        />
                        <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                          {scoreDistributionData.map((entry) => (
                            <Cell
                              key={entry.name}
                              fill={entry.value >= 80 ? "#8ef0b1" : entry.value >= 65 ? "#ffd08f" : "#ff9cab"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/60">
                    说明：以上 5 个维度是独立评分，满分均为 100 分，数值越高代表该维度越成熟，并不是综合总分。
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-6">
              {!showPremiumReport ? (
              <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                <div className="flex items-center gap-3 text-[#ffb37f]">
                  <Sparkles className="h-5 w-5" />
                  <h2 className="text-2xl font-bold">内容分析</h2>
                </div>
                <div className="mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-black/15">
                  <table className="w-full border-collapse text-sm leading-7 text-white/75">
                    <tbody>
                      {contentAnalysisRows.map((row) => (
                        <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                          <td className="w-32 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                          <td className="px-4 py-4 align-top whitespace-normal break-words">{row.insight}</td>
                          <td className="px-4 py-4 align-top whitespace-normal break-words text-white/65">{row.action}</td>
                          <td className="px-4 py-4 align-top whitespace-normal break-words text-[#ffd08f]">{row.highlight || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              ) : null}

              {showPremiumReport ? null : (
                <div className="rounded-[28px] border border-[#ff8a3d]/15 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffcf92]">
                    <BriefcaseBusiness className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">付费版可解锁内容</h2>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/65">
                    趋势判断、平台建议、商业承接和 7 天计划都属于付费版内容，不在免费版展示范围内。
                  </p>
                </div>
              )}

              {showPremiumReport ? (
                <div className="space-y-6">
                  <div ref={(node) => { sectionRefs.current.execution = node; }} className="rounded-[28px] border border-[#ffd08f]/25 bg-[#0f1a2c] p-6">
                    <div className="flex items-center gap-3 text-[#ffd08f]">
                      <Rocket className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">现在就能执行的版本</h2>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-white/60">
                      这里只保留首发版最重要的动作，方便你直接进入改稿和发布。
                    </p>
                    <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                      <div className="rounded-2xl border border-[#ffd08f]/20 bg-[linear-gradient(135deg,rgba(255,208,143,0.12),rgba(255,255,255,0.03))] p-5">
                        <div className="text-xs uppercase tracking-[0.18em] text-[#ffd08f]">首发版改法</div>
                        <div className="mt-3 text-base font-semibold leading-8 text-white">
                          {stripInternalJargon(primaryCommercialAngle?.execution || growthHandoff?.brief || creationAssist?.brief || primaryPlatformRecommendation?.action || visibleBusinessInsights[0]?.detail || "先把这条内容改成一个用户一看就懂、且愿意继续看的版本。")}
                        </div>
                        {primaryCommercialAngle?.hook ? (
                          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white/72">
                            开场钩子：{stripInternalJargon(primaryCommercialAngle.hook)}
                          </div>
                        ) : null}
                        {growthHandoff?.workflowPrompt ? (
                          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white/72">
                            {growthHandoff.workflowPrompt}
                          </div>
                        ) : null}
                      </div>
                      <div className="grid gap-4">
                        <a
                          href="/workflow-nodes?supervisor=1"
                          onClick={() => handleStoreHandoff(growthHandoff, "分析结果已同步到创作画布")}
                          className="block rounded-2xl border border-[#ff8a3d]/30 bg-[linear-gradient(135deg,rgba(255,138,61,0.2),rgba(255,255,255,0.04))] px-4 py-4 text-base font-bold text-[#ffd4b7] transition hover:bg-[#ff8a3d]/20"
                        >
                          进入创作画布，直接改首发脚本和镜头
                        </a>
                        {titleExecutionCards.length ? (
                          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-white">直接可用的标题与文案</div>
                              {recommendedPlatformNames.length ? (
                                <div className="text-xs text-white/55">推荐平台：{recommendedPlatformNames.join("、")}</div>
                              ) : null}
                            </div>
                            <div className="mt-3 space-y-3">
                              {titleExecutionCards.map((item, index) => (
                                <div key={`${index}-${item.title}`} className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm leading-7 text-white/76">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-[#9df6c0]">标题 {index + 1}</span>
                                    <span className="font-semibold text-white">{replaceTerms(item.title)}</span>
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/55">{item.presentationMode}</span>
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/55">{formatPlatformList(item.suitablePlatforms)}</span>
                                  </div>
                                  {item.openingHook ? (
                                    <div className="mt-2 text-white/70">开场句：{replaceTerms(item.openingHook)}</div>
                                  ) : null}
                                  <div className="mt-2 text-white/70">{replaceTerms(item.copywriting)}</div>
                                  {item.formatReason ? (
                                    <div className="mt-3 rounded-xl border border-[#8ab8ff]/20 bg-[#11233a] px-3 py-3 text-white/78">
                                      <div className="text-xs uppercase tracking-[0.16em] text-[#b9dbff]">为什么用这种呈现方式</div>
                                      <div className="mt-2">{replaceTerms(item.formatReason)}</div>
                                    </div>
                                  ) : null}
                                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                                      <div className="text-xs uppercase tracking-[0.16em] text-white/45">图文怎么做</div>
                                      <div className="mt-2 text-white/72">{replaceTerms(item.graphicPlan || "当前不建议先做图文首发。")}</div>
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                                      <div className="text-xs uppercase tracking-[0.16em] text-white/45">视频怎么拍</div>
                                      <div className="mt-2 text-white/72">{replaceTerms(item.videoPlan || "当前不建议先做视频首发。")}</div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : directTitleSuggestions.length ? (
                          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="text-sm font-semibold text-white">先从这几个标题开始</div>
                            <div className="mt-3 space-y-3">
                              {directTitleSuggestions.map((item: string, index: number) => (
                                <div key={`${index}-${item}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm leading-7 text-white/76">
                                  <span className="mr-2 font-semibold text-[#9df6c0]">标题 {index + 1}</span>
                                  <span className="font-semibold text-white">{stripInternalJargon(item)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : visibleGrowthPlan.length ? (
                          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="text-sm font-semibold text-white">接下来三步</div>
                            <div className="mt-3 space-y-3">
                              {visibleGrowthPlan.map((item) => (
                                <div key={item.day} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm leading-7 text-white/76">
                                  <span className="mr-2 font-semibold text-[#9df6c0]">第 {item.day} 步</span>
                                  <span className="font-semibold text-white">{item.title}</span>
                                  <div className="mt-1 text-white/70">{item.action}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {personalizedDirectionCards.length ? (
                    <div ref={(node) => { sectionRefs.current.platforms = node; }} className="rounded-[28px] border border-[#90c4ff]/25 bg-[#0f1a2c] p-6">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 text-[#90c4ff]">
                          <Send className="h-5 w-5" />
                          <h2 className="text-2xl font-bold">个性化增长方向</h2>
                        </div>
                        <div className="rounded-full border border-[#90c4ff]/20 bg-[#90c4ff]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#b9dbff]">
                          数据证据优先
                        </div>
                      </div>
                      {(assetAdaptation || titleExecutionCards[0]) ? (
                        <div className="mt-5 grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
                          <div className="rounded-2xl border border-[#f5b7ff]/18 bg-[rgba(245,183,255,0.06)] p-5">
                            <div className="text-xs uppercase tracking-[0.16em] text-[#f5b7ff]">首发形式与改法</div>
                            <div className="mt-3 text-lg font-bold text-white">{replaceTerms(assetAdaptation?.format || titleExecutionCards[0]?.presentationMode || "优先短视频首发")}</div>
                            <div className="mt-3 text-sm leading-7 text-white/78">
                              开头怎么改：{replaceTerms(assetAdaptation?.firstHook || titleExecutionCards[0]?.openingHook || "先把最扎心的问题、结果或价格反差扔到前 2 秒。")}
                            </div>
                            <div className="mt-2 text-sm leading-7 text-white/78">
                              结构怎么改：{replaceTerms(assetAdaptation?.structure || titleExecutionCards[0]?.copywriting || "按痛点、动作、证据、结果四段写，不要一上来长铺垫。")}
                            </div>
                            <div className="mt-2 text-sm leading-7 text-white/78">
                              结尾动作：{replaceTerms(assetAdaptation?.callToAction || "只保留一个行动引导，统一导向私信词、预约动作或评论词。")}
                            </div>
                          </div>
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                              <div className="text-xs uppercase tracking-[0.16em] text-white/45">图文怎么写</div>
                              <div className="mt-3 text-sm leading-7 text-white/78">
                                {replaceTerms(titleExecutionCards[0]?.graphicPlan || "第一页只写一个结果或痛点句，第二页写谁最需要，第三到四页给动作和前后对比，第五页给证据，第六页只留一个行动。")}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                              <div className="text-xs uppercase tracking-[0.16em] text-white/45">视频怎么拍</div>
                              <div className="mt-3 text-sm leading-7 text-white/78">
                                {replaceTerms(titleExecutionCards[0]?.videoPlan || "前 2 秒先抛问题或结果，中段只留痛点、动作、结果三个镜头，字幕同步点出人群和收益，结尾只留一个行动引导。")}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-5 grid gap-4 xl:grid-cols-2">
                        {personalizedDirectionCards.map((angle, index) => (
                          <div key={`${angle.title}-${index}`} className="rounded-2xl border border-white/10 bg-black/15 p-5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xl font-black text-white">{angle.title}</div>
                              <div className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/60">
                                {angle.badge}
                              </div>
                            </div>
                            <div className="mt-4 rounded-2xl border border-white/10 bg-[#111b2c] px-4 py-3 text-sm leading-7 text-white/78">
                              {stripInternalJargon(angle.scenario)}
                            </div>
                            <div className="mt-4 rounded-2xl border border-[#90c4ff]/20 bg-[#10233e] px-4 py-3">
                              <div className="text-xs uppercase tracking-[0.16em] text-[#b9dbff]">为什么这条方向对你成立</div>
                              <div className="mt-2 text-sm leading-7 text-white">{stripInternalJargon(angle.why)}</div>
                            </div>
                            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                              <div className="text-xs uppercase tracking-[0.16em] text-white/45">直接执行</div>
                              <div className="mt-2 text-sm leading-7 text-white/78">{stripInternalJargon(angle.action)}</div>
                            </div>
                            {titleExecutionCards[index] ? (
                              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                                <div className="rounded-2xl border border-white/10 bg-[#111b2c] px-4 py-3">
                                  <div className="text-xs uppercase tracking-[0.16em] text-white/45">更适合的呈现方式</div>
                                  <div className="mt-2 text-sm leading-7 text-white">{replaceTerms(titleExecutionCards[index].presentationMode || "短视频")}</div>
                                  <div className="mt-2 text-sm leading-7 text-white/72">{replaceTerms(titleExecutionCards[index].formatReason || "")}</div>
                                </div>
                                <div className="rounded-2xl border border-white/10 bg-[#111b2c] px-4 py-3">
                                  <div className="text-xs uppercase tracking-[0.16em] text-white/45">推荐先发平台</div>
                                  <div className="mt-2 text-sm leading-7 text-white">{formatPlatformList(titleExecutionCards[index].suitablePlatforms)}</div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {!isRemixMode && analysis && (analysis.visualSummary || visualKeyFrames.length) ? (
                    <div className="rounded-[28px] border border-[#8af0ff]/20 bg-[#0f1a2c] p-6">
                      <div className="flex items-center gap-3 text-[#8af0ff]">
                        <Film className="h-5 w-5" />
	                        <h2 className="text-2xl font-bold">商业深度洞察</h2>
                      </div>
                      <div className="mt-5 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                        <div className="space-y-4">
                          {analysis.visualSummary ? (
                            <div className="rounded-2xl border border-[#8af0ff]/20 bg-[#10233a] px-4 py-4">
                              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[#8af0ff]">
                                <Sparkles className="h-4 w-4" />
                                <span>视觉总判断</span>
                              </div>
                              <div className="mt-2 text-sm leading-7 text-white">{replaceTerms(analysis.visualSummary)}</div>
                            </div>
                          ) : null}
                          {analysis.openingFrameAssessment ? (
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm leading-7 text-white/78">
                              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-white/45">
                                <Target className="h-4 w-4" />
                                <span>开头画面判断</span>
                              </div>
                              <div className="mt-2">{replaceTerms(analysis.openingFrameAssessment)}</div>
                            </div>
                          ) : null}
                          {analysis.sceneConsistency ? (
                            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm leading-7 text-white/78">
                              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-white/45">
                                <LayoutDashboard className="h-4 w-4" />
                                <span>画面统一性</span>
                              </div>
                              <div className="mt-2">{replaceTerms(analysis.sceneConsistency)}</div>
                            </div>
                          ) : null}
                          {analysis.trustSignals?.length ? (
                            <div className="rounded-2xl border border-[#9df6c0]/15 bg-[rgba(157,246,192,0.06)] px-4 py-4">
                              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[#9df6c0]">
                                <Sparkles className="h-4 w-4" />
                                <span>可信画面信号</span>
                              </div>
                              <div className="mt-2 space-y-2 text-sm leading-7 text-white/78">
                                {analysis.trustSignals.slice(0, 3).map((item) => (
                                  <div key={item}>{replaceTerms(item)}</div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className="space-y-4">
                          {visualKeyFrames.map((frame) => (
                            <div key={`${frame.timestamp}-${frame.whatShows}`} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                              <div className="flex items-center gap-3">
                                <span className="rounded-full border border-[#8af0ff]/20 bg-[#8af0ff]/10 px-2 py-1 text-[11px] font-semibold text-[#8af0ff]">{frame.timestamp}</span>
                                <div className="text-sm font-semibold text-white">{replaceTerms(frame.whatShows)}</div>
                              </div>
                              <div className="mt-3 text-sm leading-7 text-white/72">
                                <span className="mr-2 inline-flex items-center rounded-full border border-[#8af0ff]/15 bg-[#8af0ff]/10 px-2 py-0.5 text-[11px] font-semibold text-[#8af0ff]">可怎么用</span>
                                {replaceTerms(frame.commercialUse)}
                              </div>
                              <div className="mt-2 text-sm leading-7 text-white/62">
                                <span className="mr-2 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/55">问题</span>
                                {replaceTerms(frame.issue)}
                              </div>
                              <div className="mt-3 rounded-xl border border-[#ffb454]/25 bg-[rgba(255,180,84,0.12)] px-3 py-3 text-sm leading-7 text-[#ffd08f] shadow-[0_0_0_1px_rgba(255,180,84,0.08)]">
                                <span className="mr-2 inline-flex items-center rounded-full border border-[#ffb454]/30 bg-[rgba(255,180,84,0.18)] px-2 py-0.5 text-[11px] font-semibold text-[#ffd08f]">改法</span>
                                {replaceTerms(frame.fix)}
                              </div>
                            </div>
                          ))}
                          {analysis.visualRisks?.length ? (
                            <div className="rounded-2xl border border-[#ff8a3d]/20 bg-[rgba(255,138,61,0.06)] px-4 py-4">
                              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[#ffb87d]">
                                <Target className="h-4 w-4" />
                                <span>视觉风险</span>
                              </div>
                              <div className="mt-2 space-y-2 text-sm leading-7 text-white/78">
                                {analysis.visualRisks.slice(0, 3).map((item) => (
                                  <div key={item}>{replaceTerms(item)}</div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {!isRemixMode && analysis && (analysis.languageExpression || analysis.emotionalExpression || analysis.cameraEmotionTension || analysis.bgmAnalysis || analysis.musicRecommendation || analysis.sunoPrompt) ? (
                    <div className="rounded-[28px] border border-[#f5b7ff]/20 bg-[#151425] p-6">
                      <div className="flex items-center gap-3 text-[#f5b7ff]">
                        <Orbit className="h-5 w-5" />
                        <h2 className="text-2xl font-bold">表达与配乐分析</h2>
                      </div>
                      <div className="mt-5 grid gap-4 xl:grid-cols-2">
                        {analysis.languageExpression ? (
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.16em] text-white/45">语言表达力</div>
                            <div className="mt-2 text-sm leading-7 text-white/78">{replaceTerms(analysis.languageExpression)}</div>
                          </div>
                        ) : null}
                        {analysis.emotionalExpression ? (
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.16em] text-white/45">情感表达方式</div>
                            <div className="mt-2 text-sm leading-7 text-white/78">{replaceTerms(analysis.emotionalExpression)}</div>
                          </div>
                        ) : null}
                        {analysis.cameraEmotionTension ? (
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.16em] text-white/45">镜头表现与情绪张力</div>
                            <div className="mt-2 text-sm leading-7 text-white/78">{replaceTerms(analysis.cameraEmotionTension)}</div>
                          </div>
                        ) : null}
                        {analysis.bgmAnalysis ? (
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.16em] text-white/45">BGM 分析</div>
                            <div className="mt-2 text-sm leading-7 text-white/78">{replaceTerms(analysis.bgmAnalysis)}</div>
                          </div>
                        ) : null}
                        {analysis.musicRecommendation ? (
                          <div className="rounded-2xl border border-[#ffd08f]/20 bg-[rgba(255,208,143,0.08)] px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.16em] text-[#ffd08f]">适合的配乐</div>
                            <div className="mt-2 text-sm leading-7 text-white/82">{replaceTerms(analysis.musicRecommendation)}</div>
                          </div>
                        ) : null}
                        {analysis.sunoPrompt ? (
                          <div className="rounded-2xl border border-[#90c4ff]/20 bg-[rgba(144,196,255,0.08)] px-4 py-4 xl:col-span-2">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="text-xs uppercase tracking-[0.16em] text-[#90c4ff]">Music Prompt</div>
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  value={musicProvider}
                                  onChange={(e) => setMusicProvider((e.target.value as MusicProvider) || "suno")}
                                  className="rounded-xl border border-white/15 bg-[#0b1020] px-3 py-2 text-xs text-white"
                                >
                                  <option value="suno">Suno</option>
                                  <option value="udio">Udio</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => void handleGenerateMusic()}
                                  disabled={musicStatus === "generating" || musicStatus === "polling"}
                                  className="inline-flex items-center gap-2 rounded-xl bg-[#90c4ff] px-3 py-2 text-xs font-semibold text-black transition hover:bg-[#a8d2ff] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {musicStatus === "generating" || musicStatus === "polling" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music2 className="h-3.5 w-3.5" />}
                                  生成 BGM
                                </button>
                              </div>
                            </div>
                            <textarea
                              value={musicPromptDraft}
                              onChange={(e) => setMusicPromptDraft(e.target.value)}
                              rows={4}
                              className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white/82"
                            />
                            {musicStatus === "generating" || musicStatus === "polling" ? (
                              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white/72">
                                {musicProgressMessage || "正在生成音乐..."}
                                {musicTaskId ? <span className="ml-2 text-white/45">Task ID: {musicTaskId}</span> : null}
                              </div>
                            ) : null}
                            {musicError ? (
                              <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
                                {musicError}
                              </div>
                            ) : null}
                            {musicSongs.length ? (
                              <div className="mt-4 space-y-3">
                                {musicSongs.map((song) => {
                                  const playableUrl = song.audioUrl || song.streamUrl || "";
                                  return (
                                    <div key={song.id} className="rounded-xl border border-white/10 bg-black/20 px-4 py-4">
                                      <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                          <div className="text-sm font-semibold text-white">{song.title || "生成结果"}</div>
                                          {song.tags ? <div className="mt-1 text-xs text-white/45">{song.tags}</div> : null}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {playableUrl ? (
                                            <button
                                              type="button"
                                              onClick={() => handlePlayGeneratedMusic(playableUrl)}
                                              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10"
                                            >
                                              <Play className="h-3.5 w-3.5" />
                                              {playingMusicUrl === playableUrl ? "暂停" : "播放"}
                                            </button>
                                          ) : null}
                                          {song.audioUrl ? (
                                            <a
                                              href={song.audioUrl}
                                              download={`${song.title || "bgm"}.mp3`}
                                              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10"
                                            >
                                              <Download className="h-3.5 w-3.5" />
                                              下载
                                            </a>
                                          ) : null}
                                        </div>
                                      </div>
                                      {playableUrl ? <audio key={playableUrl} className="mt-3 w-full" controls src={playableUrl} /> : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {topRecommendedPlatforms.length ? (
                    <div className="rounded-[28px] border border-[#ffd08f]/20 bg-[#0f1a2c] p-6">
                      <div className="flex items-center gap-3 text-[#ffd08f]">
                        <Send className="h-5 w-5" />
                        <h2 className="text-2xl font-bold">推荐发布平台</h2>
                      </div>
                      <div className="mt-5 grid gap-4 xl:grid-cols-3">
                        {topRecommendedPlatforms.map(({ recommendation, activity }) => (
                          <div key={recommendation.name} className="rounded-2xl border border-white/10 bg-black/15 p-5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xl font-black text-white">{recommendation.name}</div>
                              <div className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/60">
                                {activity?.activityLevel ? `活跃度 ${activity.activityLevel}` : "优先平台"}
                              </div>
                            </div>
                            <div className="mt-3 text-sm leading-7 text-white/78">{replaceTerms(recommendation.reason)}</div>
                            <div className="mt-4 rounded-2xl border border-[#8ab8ff]/20 bg-[#11233a] px-4 py-3 text-sm leading-7 text-white/78">
                              <div className="text-xs uppercase tracking-[0.16em] text-[#b9dbff]">怎么发更对</div>
                              <div className="mt-2">{replaceTerms(recommendation.action)}</div>
                              {recommendation.playbook ? (
                                <div className="mt-2 text-white/65">{replaceTerms(recommendation.playbook)}</div>
                              ) : null}
                            </div>
                            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white/78">
                              <div className="text-xs uppercase tracking-[0.16em] text-white/45">适合的赛道</div>
                              <div className="mt-2">{replaceTerms(activity?.potentialTrack || "优先走痛点解决、结果对比、专业信任建立这类高转化赛道。")}</div>
                            </div>
                            {activity?.supportActivities?.length ? (
                              <div className="mt-4 rounded-2xl border border-[#9df6c0]/15 bg-[rgba(157,246,192,0.06)] px-4 py-3 text-sm leading-7 text-white/78">
                                <div className="text-xs uppercase tracking-[0.16em] text-[#9df6c0]">当前有效扶持活动</div>
                                <div className="mt-2 space-y-2">
                                  {activity.supportActivities.map((entry) => (
                                    <div key={`${recommendation.name}-${entry}`}>{replaceTerms(entry)}</div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white/68">
                                <div className="text-xs uppercase tracking-[0.16em] text-white/45">当前有效扶持活动</div>
                                <div className="mt-2">当前未核验到适合长期写入报告的公开扶持活动，更适合优先吃平台自然分发与细分赛道流量。</div>
                              </div>
                            )}
                            {(() => {
                              const relatedExamples = referenceExamples
                                .filter((example) => example.platformLabel === recommendation.name)
                                .slice(0, 2);
                              return relatedExamples.length ? (
                                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                                  <div className="text-xs uppercase tracking-[0.16em] text-white/45">相关案例参考</div>
                                  <div className="mt-2 space-y-2 text-sm leading-7 text-white/78">
                                    {relatedExamples.map((entry) => (
                                      <div key={`${recommendation.name}-${entry.id}`}>
                                        <span className="font-semibold text-white">{replaceTerms(entry.account)}</span>
                                        <span className="text-white/62">：{replaceTerms(entry.title)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null;
                            })()}
                            {activity?.supportSignal ? (
                              <div className="mt-4 text-sm leading-7 text-white/68">扶持判断：{replaceTerms(activity.supportSignal)}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {platformActivityCards.length ? (
                    <div className="rounded-[28px] border border-[#8ab8ff]/20 bg-[#0f1a2c] p-6">
                      <div className="flex items-center gap-3 text-[#90c4ff]">
                        <Compass className="h-5 w-5" />
                        <h2 className="text-2xl font-bold">平台活动与呈现方式</h2>
                      </div>
                      <div className="mt-5 grid gap-4 xl:grid-cols-2">
                        {platformActivityCards.map((item) => {
                          const relatedExamples = referenceExamples
                            .filter((example) => example.platformLabel === item.platformLabel)
                            .slice(0, 2);
                          return (
                          <div key={item.platform} className="rounded-2xl border border-white/10 bg-black/15 p-5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xl font-black text-white">{item.platformLabel}</div>
                              <div className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/60">活跃度 {item.activityLevel}</div>
                            </div>
                            <div className="mt-3 text-sm leading-7 text-white/74">{replaceTerms(item.summary)}</div>
                            <div className="mt-4 rounded-2xl border border-[#8ab8ff]/20 bg-[#11233a] px-4 py-3 text-sm leading-7 text-white/78">
                              <div className="text-xs uppercase tracking-[0.16em] text-[#b9dbff]">更适合的呈现方式</div>
                              <div className="mt-2">{replaceTerms(item.recommendedFormat)}</div>
                              <div className="mt-2 text-white/65">{replaceTerms(item.contentAngle)}</div>
                            </div>
                            {item.hotTopics.length ? (
                              <div className="mt-4">
                                <div className="text-xs uppercase tracking-[0.16em] text-white/45">当前活跃主题</div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {item.hotTopics.map((topic) => (
                                    <span key={`${item.platform}-${topic}`} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/72">
                                      {replaceTerms(topic)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {item.suggestedTopics.length ? (
                              <div className="mt-4 text-sm leading-7 text-white/68">
                                推荐切题：{item.suggestedTopics.map((topic) => replaceTerms(topic)).join(" / ")}
                              </div>
                            ) : null}
                            {relatedExamples.length ? (
                              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                                <div className="text-xs uppercase tracking-[0.16em] text-white/45">相关账号参考</div>
                                <div className="mt-2 space-y-2 text-sm leading-7 text-white/78">
                                  {relatedExamples.map((example) => (
                                    <div key={example.id}>
                                      <span className="font-semibold text-white">{replaceTerms(example.account)}</span>
                                      <span className="text-white/62">：{replaceTerms(example.title)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {item.supportActivities.length ? (
                              <div className="mt-4 rounded-2xl border border-[#9df6c0]/15 bg-[rgba(157,246,192,0.06)] px-4 py-3">
                                <div className="text-xs uppercase tracking-[0.16em] text-[#9df6c0]">当前有效扶持活动</div>
                                <div className="mt-2 space-y-2 text-sm leading-7 text-white/78">
                                  {item.supportActivities.map((activity) => (
                                    <div key={`${item.platform}-activity-${activity}`}>{replaceTerms(activity)}</div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {item.supportSignal ? (
                              <div className="mt-4 text-sm leading-7 text-white/68">扶持判断：{replaceTerms(item.supportSignal)}</div>
                            ) : null}
                            {item.potentialTrack ? (
                              <div className="mt-2 text-sm leading-7 text-white/68">潜力赛道：{replaceTerms(item.potentialTrack)}</div>
                            ) : null}
                            {item.optimizationPlan ? (
                              <div className="mt-4 rounded-2xl border border-[#f5b7ff]/18 bg-[rgba(245,183,255,0.06)] px-4 py-3 text-sm leading-7 text-white/78">
                                <div className="text-xs uppercase tracking-[0.16em] text-[#f5b7ff]">更深层的优化方案</div>
                                <div className="mt-2">{replaceTerms(item.optimizationPlan)}</div>
                              </div>
                            ) : null}
                          </div>
                        )})}
                      </div>
                    </div>
                  ) : null}

                  {(referenceExamples.length || visibleTopicLibrary.length) ? (
                    <div className="rounded-[28px] border border-[#7ee7ff]/18 bg-[#0f1a2c] p-6">
                      <div className="flex items-center gap-3 text-[#7ee7ff]">
                        <ScanSearch className="h-5 w-5" />
                        <h2 className="text-2xl font-bold">参考案例与话题</h2>
                      </div>
                      <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                        <div className="space-y-4">
                          {referenceExamplesByPlatform.map(([platformLabel, items]) => (
                            <div key={platformLabel} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/60 inline-flex">
                                {platformLabel}
                              </div>
                              <div className="mt-3 space-y-3">
                                {items.map((item) => (
                                  <div key={item.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                                    <div className="text-base font-semibold text-white">{replaceTerms(item.account)}</div>
                                    <div className="mt-1 text-sm font-semibold leading-7 text-white">{replaceTerms(item.title)}</div>
                                    <div className="mt-1 text-sm leading-7 text-white/68">{replaceTerms(item.reason)}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="text-sm font-semibold text-white">可延展的话题库</div>
                          <div className="mt-3 space-y-3">
                            {visibleTopicLibrary.map((item) => (
                              <div key={item.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm leading-7 text-white/76">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="font-semibold text-white">{replaceTerms(item.title)}</span>
                                  <span className="text-xs text-[#9df6c0]">{item.confidence}%</span>
                                </div>
                                <div className="mt-1 text-white/65">{replaceTerms(item.rationale)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {monetizationStrategyCards.length ? (
                    <div className="rounded-[28px] border border-[#f5b7ff]/20 bg-[#0f1a2c] p-6">
                      <div className="flex items-center gap-3 text-[#f5b7ff]">
                        <CircleDollarSign className="h-5 w-5" />
                        <h2 className="text-2xl font-bold">推荐平台商业变现策略</h2>
                      </div>
                      <div className="mt-5 grid gap-4 xl:grid-cols-2">
                        {monetizationStrategyCards.map((item) => (
                          <div key={`${item.platform}-${item.primaryTrack}`} className="rounded-2xl border border-white/10 bg-black/15 p-5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xl font-black text-white">{item.platformLabel}</div>
                              <div className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/60">{stripInternalJargon(item.primaryTrack)}</div>
                            </div>
                            <div className="mt-4 rounded-2xl border border-[#f5b7ff]/20 bg-[rgba(245,183,255,0.08)] px-4 py-3">
                              <div className="text-xs uppercase tracking-[0.16em] text-[#f5b7ff]">怎么变现</div>
                              <div className="mt-2 text-sm leading-7 text-white">{replaceTerms(item.strategy)}</div>
                            </div>
                            <div className="mt-4 text-sm leading-7 text-white/72">适合承接：{replaceTerms(item.offerType)}</div>
                            <div className="mt-2 text-sm leading-7 text-white/72">行动引导：{replaceTerms(item.callToAction)}</div>
                            <div className="mt-2 text-sm leading-7 text-white/60">{replaceTerms(item.reason)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {dataLibrarySections.length ? (
                    <div className="rounded-[28px] border border-[#ffd08f]/20 bg-[#0f1a2c] p-6">
                      <div className="flex items-center gap-3 text-[#ffd08f]">
                        <Workflow className="h-5 w-5" />
                        <h2 className="text-2xl font-bold">数据分析库结构</h2>
                      </div>
                      <div className="mt-5 grid gap-4 xl:grid-cols-3">
                        {dataLibrarySections.map((item) => (
                          <div key={item.id} className="rounded-2xl border border-white/10 bg-black/15 p-5">
                            <div className="text-lg font-black text-white">{replaceTerms(item.title)}</div>
                            <div className="mt-3 text-sm leading-7 text-white/68">{replaceTerms(item.purpose)}</div>
                            <div className="mt-4 text-xs uppercase tracking-[0.16em] text-[#ffd08f]">数据来源</div>
                            <div className="mt-2 text-sm leading-7 text-white/72">{item.dataSources.map((source) => replaceTerms(source)).join(" / ")}</div>
                            <div className="mt-4 text-xs uppercase tracking-[0.16em] text-[#ffd08f]">关键字段</div>
                            <div className="mt-2 text-sm leading-7 text-white/72">{item.coreFields.map((field) => replaceTerms(field)).join(" / ")}</div>
                            <div className="mt-4 text-xs uppercase tracking-[0.16em] text-[#ffd08f]">输出板块</div>
                            <div className="mt-2 text-sm leading-7 text-white/72">{item.outputBoards.map((board) => replaceTerms(board)).join(" / ")}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <QuotaExhaustedModal
        isOpen={quotaModalVisible}
        onClose={() => setQuotaModalVisible(false)}
        featureType="analysis"
        isTrial={quotaModalInfo.isTrial}
        planName={quotaModalInfo.planName}
      />
    </div>
  );
}
