import React, { useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import type { GrowthAnalysisScores, GrowthSnapshot } from "@shared/growth";
import {
  ArrowLeft,
  Bot,
  CalendarRange,
  ChevronRight,
  Loader2,
  MessageSquareText,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

const WINDOW_OPTIONS = [
  { days: 15 as const, label: "15天", description: "看短期波动、热点与即时机会" },
  { days: 30 as const, label: "30天", description: "看平台主流结构与相对稳定方向" },
  { days: 45 as const, label: "45天", description: "看更长窗口的沉淀与长期可做性" },
] as const;

const EMPTY_ANALYSIS: GrowthAnalysisScores = {
  composition: 0,
  color: 0,
  lighting: 0,
  impact: 0,
  viralPotential: 0,
  visualSummary: "",
  openingFrameAssessment: "",
  sceneConsistency: "",
  languageExpression: "",
  emotionalExpression: "",
  cameraEmotionTension: "",
  bgmAnalysis: "",
  musicRecommendation: "",
  sunoPrompt: "",
  trustSignals: [],
  visualRisks: [],
  keyFrames: [],
  strengths: [],
  improvements: [],
  platforms: [],
  summary: "",
  titleSuggestions: [],
  creatorCenterSignals: [],
  timestampSuggestions: [],
  weakFrameReferences: [],
  commercialAngles: [],
  followUpPrompt: "",
};

type AskResult = {
  title: string;
  answer: string;
  encouragement: string;
  nextQuestions: string[];
};

type PlatformDashboard = {
  headline: string;
  subheadline: string;
  topSignals: Array<{ title: string; detail: string; badge?: string }>;
  platformMenu: Array<{ platform: string; label: string; trend: string; lane: string; whyNow: string; nextMove: string }>;
  hotTopics: Array<{ title: string; whyHot: string; howToUse: string }>;
  actionCards: Array<{ title: string; detail: string }>;
  conversationStarters: string[];
};

function extractFocusKeywords(value: string) {
  return Array.from(
    new Set((String(value || "").match(/[\u4e00-\u9fa5A-Za-z]{2,}/g) || []).slice(0, 6)),
  );
}

function getRelativeBar(value: number, max: number) {
  if (!max || max <= 0) return 0;
  return Math.max(8, Math.round((value / max) * 100));
}

export default function PlatformPage() {
  const { isAuthenticated, loading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: getLoginUrl() });
  const [selectedWindowDays, setSelectedWindowDays] = useState<15 | 30 | 45>(15);
  const [focusPrompt, setFocusPrompt] = useState("");
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AskResult | null>(null);

  const growthSnapshotQuery = trpc.mvAnalysis.getGrowthSnapshot.useQuery(
    {
      context: focusPrompt || undefined,
      modelName: "gemini-2.5-pro",
      requestedPlatforms: ["douyin", "xiaohongshu", "bilibili", "kuaishou"],
      analysis: EMPTY_ANALYSIS,
      windowDays: selectedWindowDays,
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

  const askPlatformFollowUpMutation = trpc.mvAnalysis.askPlatformFollowUp.useMutation({
    onSuccess: (result) => {
      setAskResult(result.result);
    },
    onError: (error) => {
      toast.error(error.message || "平台追问失败");
    },
  });

  const snapshot = growthSnapshotQuery.data?.snapshot as GrowthSnapshot | undefined;
  const platformDashboard = growthSnapshotQuery.data?.platformDashboard as PlatformDashboard | null | undefined;

  const primaryPlatforms = useMemo(() => snapshot?.platformSnapshots.slice(0, 4) ?? [], [snapshot]);
  const maxFit = Math.max(...primaryPlatforms.map((item) => item.audienceFitScore), 100);
  const maxMomentum = Math.max(...primaryPlatforms.map((item) => item.momentumScore), 100);
  const topTopics = useMemo(
    () =>
      platformDashboard?.hotTopics.length
        ? platformDashboard.hotTopics
        : (snapshot?.topicLibrary.slice(0, 9).map((item) => ({
            title: item.title,
            whyHot: item.rationale,
            howToUse: item.executionHint,
          })) ?? []),
    [platformDashboard, snapshot],
  );
  const recommendedPlatforms = useMemo(() => snapshot?.platformRecommendations.slice(0, 4) ?? [], [snapshot]);
  const actionSteps = useMemo(
    () =>
      platformDashboard?.actionCards.length
        ? platformDashboard.actionCards.map((item, index) => ({ day: index + 1, title: item.title, action: item.detail }))
        : (snapshot?.growthPlan.slice(0, 4) ?? []),
    [platformDashboard, snapshot],
  );
  const keyInsights = useMemo(
    () =>
      platformDashboard?.topSignals.length
        ? platformDashboard.topSignals.map((item) => ({ title: item.title, detail: item.detail }))
        : (snapshot?.businessInsights.slice(0, 4) ?? []),
    [platformDashboard, snapshot],
  );
  const recommendationHighlights = useMemo(
    () =>
      platformDashboard?.platformMenu.length
        ? platformDashboard.platformMenu.slice(0, 3).map((item, index) => ({
            id: `${item.platform}-${index}`,
            title: item.label,
            summary: item.lane,
            action: `${item.trend} ${item.nextMove}`,
          }))
        : recommendedPlatforms.slice(0, 3).map((item, index) => ({
            id: `${item.name}-${index}`,
            title: item.name,
            summary: index === 0 ? "现在先拿反馈" : index === 1 ? "第二站补量" : "后续扩展位",
            action: item.action,
          })),
    [platformDashboard, recommendedPlatforms],
  );
  const focusKeywords = useMemo(() => extractFocusKeywords(focusPrompt), [focusPrompt]);
  const personalizedSubject = useMemo(() => {
    if (focusKeywords.length) return focusKeywords.join(" / ");
    return topTopics[0]?.title || platformDashboard?.headline || "当前内容方向";
  }, [focusKeywords, platformDashboard, topTopics]);
  const recommendationHeadline = useMemo(() => {
    if (platformDashboard?.headline) return platformDashboard.headline;
    const topPlatform = recommendedPlatforms[0]?.name || "当前优先平台";
    return `围绕 ${personalizedSubject}，先把 ${topPlatform} 做透`;
  }, [personalizedSubject, platformDashboard, recommendedPlatforms]);
  const hotQuestionSuggestions = useMemo(() => {
    const platformLead = recommendedPlatforms[0]?.name || "小红书";
    const topicLead = topTopics[0]?.title || personalizedSubject;
    if (platformDashboard?.conversationStarters.length) return platformDashboard.conversationStarters.slice(0, 4);
    return [
      `如果我先发${platformLead}，围绕“${topicLead}”应该先做哪三个选题？`,
      `在${selectedWindowDays}天维度里，现在哪个平台最值得优先押注？`,
      `如果我只做图文，不做视频，围绕“${personalizedSubject}”应该怎么切入？`,
      `结合这轮趋势，${personalizedSubject} 最容易做成哪种商业承接？`,
    ];
  }, [personalizedSubject, platformDashboard, recommendedPlatforms, selectedWindowDays, topTopics]);

  const handleAnalyze = async () => {
    setAskResult(null);
    const result = await growthSnapshotQuery.refetch();
    if (!result.data?.snapshot) {
      toast.error("平台分析暂时没有返回结果");
      return;
    }
    setHasAnalyzed(true);
    toast.success(`已生成 ${selectedWindowDays} 天平台分析`);
  };

  const handleAsk = async (nextQuestion?: string) => {
    const finalQuestion = String(nextQuestion || question).trim();
    if (!snapshot) {
      toast.error("请先完成平台分析");
      return;
    }
    if (!finalQuestion) {
      toast.error("先输入一个你想进一步了解的问题");
      return;
    }
    setQuestion(finalQuestion);
    await askPlatformFollowUpMutation.mutateAsync({
      question: finalQuestion,
      context: focusPrompt || undefined,
      windowDays: selectedWindowDays,
      snapshot,
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0620] text-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#49e6ff]" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#080618_0%,#13092e_48%,#090715_100%)] px-6 text-white">
        <div className="max-w-lg rounded-[28px] border border-[#2b1f52] bg-[#100926]/95 p-8 text-center shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
          <div className="text-sm uppercase tracking-[0.24em] text-[#8cefff]">Platform Intelligence</div>
          <div className="mt-4 text-3xl font-black">需要先登录</div>
          <p className="mt-4 text-sm leading-7 text-[#c8bfe7]">
            平台分析页不会再显示黑屏。当前会自动跳转登录；如果浏览器拦截了跳转，这里也会明确提示，而不是整页空白。
          </p>
          <a
            href={getLoginUrl()}
            className="mt-6 inline-flex items-center justify-center rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(73,230,255,0.18)] transition hover:brightness-110"
          >
            去登录
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(44,16,88,0.45),transparent_28%),radial-gradient(circle_at_top_right,rgba(31,67,132,0.28),transparent_22%),linear-gradient(180deg,#080618_0%,#13092e_48%,#090715_100%)] text-[#f4efff]">
      <div className="mx-auto max-w-[1480px] px-4 py-8 md:px-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="rounded-full border border-white/10 bg-white/5 p-2 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="rounded-full border border-[#49e6ff]/20 bg-[rgba(73,230,255,0.08)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#8cefff]">
            Platform Intelligence
          </div>
        </div>

        <section className="rounded-[28px] border border-[#2b1f52] bg-[#100926]/95 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)] md:p-8">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="max-w-4xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#362561] bg-[#170d35] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[#aa95dc]">
                  <TrendingUp className="h-3.5 w-3.5" />
                  平台数据分析
                </div>
                <h1 className="mt-4 text-4xl font-black leading-[0.96] text-white md:text-[68px]">
                  按时间维度拆开看
                  <span className="mt-3 block bg-[linear-gradient(135deg,#49e6ff,#b25cff,#ff5ab8)] bg-clip-text text-transparent">
                    {personalizedSubject} 的平台机会
                  </span>
                </h1>
                <p className="mt-5 max-w-3xl text-sm leading-8 text-[#c8bfe7] md:text-base">
                  {platformDashboard?.subheadline || "这里不上传素材，不做二创。只看 15 天、30 天、45 天这三种时间维度下，和你当前关注方向最相关的平台趋势、结构判断和商业机会，再给你一个可继续追问的平台顾问。"}
                </p>
              </div>

              <div className="rounded-2xl border border-[#2f2260] bg-[#130b31] px-4 py-3 text-sm leading-7 text-[#d7d0ef]">
                <div className="font-semibold text-[#8cefff]">分析模型</div>
                <div className="mt-1">Gemini 2.5 Pro</div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
              <div className="rounded-[24px] border border-[#2a1c55] bg-[#12092b] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#f4efff]">
                  <CalendarRange className="h-4 w-4 text-[#49e6ff]" />
                  选择时间维度
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {WINDOW_OPTIONS.map((item) => {
                    const active = item.days === selectedWindowDays;
                    return (
                      <button
                        key={item.days}
                        type="button"
                        onClick={() => setSelectedWindowDays(item.days)}
                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                          active
                            ? "border-[#49e6ff]/40 bg-[rgba(73,230,255,0.12)] shadow-[0_0_0_1px_rgba(73,230,255,0.12)]"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <div className={`text-lg font-bold ${active ? "text-[#8cefff]" : "text-white"}`}>{item.label}</div>
                        <div className="mt-1 text-sm leading-6 text-[#b7add8]">{item.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#2a1c55] bg-[#12092b] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#f4efff]">
                  <Sparkles className="h-4 w-4 text-[#ffdd44]" />
                  本轮想聚焦什么
                </div>
                <textarea
                  value={focusPrompt}
                  onChange={(event) => setFocusPrompt(event.target.value)}
                  placeholder="可选：例如我更想知道小红书适不适合先做，或这轮该优先做图文还是视频。"
                  className="mt-4 min-h-[120px] w-full rounded-2xl border border-white/10 bg-[#0c061e] px-4 py-3 text-sm leading-7 text-white outline-none transition focus:border-[#49e6ff]/35"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleAnalyze()}
                disabled={growthSnapshotQuery.isFetching}
                className="inline-flex items-center gap-2 rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(73,230,255,0.18)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {growthSnapshotQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                开始进行平台分析
              </button>
              {hasAnalyzed ? (
                <div className="rounded-full border border-[#2f2260] bg-[#130b31] px-4 py-2 text-sm text-[#d7d0ef]">
                  当前窗口：近 {selectedWindowDays} 天
                </div>
              ) : null}
              {growthSnapshotQuery.data?.debug ? (
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-[#aa95dc]">
                  route: {String(growthSnapshotQuery.data.debug.route || "-")} / source: {String(growthSnapshotQuery.data.source || "-")}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {snapshot ? (
          <section className="mt-8 space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[24px] border border-[#2a1c55] bg-[#100926] p-5">
                <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">当前结论</div>
                <div className="mt-3 text-xl font-bold text-white">{snapshot.overview.summary}</div>
                <div className="mt-3 text-sm leading-7 text-[#bdb4dc]">{snapshot.overview.trendNarrative}</div>
              </div>
              <div className="rounded-[24px] border border-[#2a1c55] bg-[#100926] p-5">
                <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">优先动作</div>
                <div className="mt-3 text-xl font-bold text-white">{recommendationHeadline}</div>
                <div className="mt-3 text-sm leading-7 text-[#bdb4dc]">{snapshot.dataAnalystSummary.recommendationReason}</div>
              </div>
              <div className="rounded-[24px] border border-[#2a1c55] bg-[#100926] p-5">
                <div className="text-xs uppercase tracking-[0.16em] text-[#ff7fd5]">实时热点</div>
                <div className="mt-3 text-xl font-bold text-white">{snapshot.analysisTracks.liveHotTopic}</div>
                <div className="mt-3 text-sm leading-7 text-[#bdb4dc]">{snapshot.analysisTracks.hotTopicTimeliness}</div>
              </div>
              <div className="rounded-[24px] border border-[#2a1c55] bg-[#100926] p-5">
                <div className="text-xs uppercase tracking-[0.16em] text-[#6fffb0]">下一步</div>
                <div className="mt-3 text-xl font-bold text-white">{snapshot.dataAnalystSummary.recommendation}</div>
                <div className="mt-3 text-sm leading-7 text-[#bdb4dc]">{snapshot.overview.nextCollectionPlan}</div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-[24px] border border-[#2a1c55] bg-[#100926] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <TrendingUp className="h-4 w-4 text-[#49e6ff]" />
                  平台适配度排行
                </div>
                <div className="mt-4 space-y-4">
                  {primaryPlatforms.map((item) => (
                    <div key={`fit-${item.platform}`}>
                      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                        <div className="font-semibold text-white">{item.displayName}</div>
                        <div className="text-[#8cefff]">{item.audienceFitScore} / 100</div>
                      </div>
                      <div className="h-3 rounded-full bg-[#1a103d]">
                        <div
                          className="h-3 rounded-full bg-[linear-gradient(90deg,#2ef0ff,#7f67ff,#ff4fb8)]"
                          style={{ width: `${getRelativeBar(item.audienceFitScore, maxFit)}%` }}
                        />
                      </div>
                      <div className="mt-2 text-xs leading-6 text-[#b7add8]">{item.summary}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#2a1c55] bg-[#100926] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <TrendingUp className="h-4 w-4 text-[#ffdd44]" />
                  平台动量与竞争强度
                </div>
                <div className="mt-4 space-y-4">
                  {primaryPlatforms.map((item) => (
                    <div key={`momentum-${item.platform}`}>
                      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                        <div className="font-semibold text-white">{item.displayName}</div>
                        <div className="text-[#ffe27b]">动量 {item.momentumScore}</div>
                      </div>
                      <div className="h-3 rounded-full bg-[#1a103d]">
                        <div
                          className="h-3 rounded-full bg-[linear-gradient(90deg,#ffdd44,#ff9944,#ff4fb8)]"
                          style={{ width: `${getRelativeBar(item.momentumScore, maxMomentum)}%` }}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#b7add8]">
                        <span className="rounded-full border border-[#3a2b6a] bg-[#170d35] px-2 py-1">竞争：{item.competitionLevel}</span>
                        <span className="rounded-full border border-[#3a2b6a] bg-[#170d35] px-2 py-1">互动率中位数：{item.last30d.engagementRateMedian}</span>
                        <span className="rounded-full border border-[#3a2b6a] bg-[#170d35] px-2 py-1">样本：{item.last30d.sampleSizeLabel}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
              <div className="rounded-[24px] border border-[#2a1c55] bg-[#100926] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Sparkles className="h-4 w-4 text-[#ff4fb8]" />
                  热点主题与切入角度
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {topTopics.map((item, index) => (
                    <div key={`${item.title}-${index}`} className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                      <div className="text-sm font-semibold text-white">{item.title}</div>
                      <div className="mt-3 text-sm leading-7 text-[#c8bfe7]">{item.whyHot}</div>
                      <div className="mt-3 text-sm leading-7 text-[#8cefff]">{item.howToUse}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#2a1c55] bg-[#100926] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <ChevronRight className="h-4 w-4 text-[#6fffb0]" />
                  当前建议怎么做
                </div>
                <div className="mt-4 space-y-3">
                  {recommendationHighlights.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-white">{item.title}</div>
                        <div className="rounded-full border border-[#3a2b6a] bg-[#170d35] px-2 py-1 text-[11px] text-[#8cefff]">
                          {item.summary}
                        </div>
                      </div>
                      <div className="mt-3 text-sm leading-7 text-[#8cefff]">{item.action}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[24px] border border-[#2a1c55] bg-[#100926] p-5">
                <div className="text-sm font-semibold text-white">现在就能执行的动作清单</div>
                <div className="mt-4 space-y-3">
                  {actionSteps.map((item) => (
                    <div key={`step-${item.day}-${item.title}`} className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-white">{item.title}</div>
                        <div className="text-xs text-[#8cefff]">第 {item.day} 天</div>
                      </div>
                      <div className="mt-2 text-sm leading-7 text-[#c8bfe7]">{item.action}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#2a1c55] bg-[#100926] p-5">
                <div className="text-sm font-semibold text-white">判断依据提炼</div>
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">Live</div>
                    <div className="mt-2 text-sm leading-7 text-[#d7d0ef]">{snapshot.analysisTracks.liveSummary}</div>
                  </div>
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#ff7fd5]">Historical</div>
                    <div className="mt-2 text-sm leading-7 text-[#d7d0ef]">{snapshot.analysisTracks.historicalSummary}</div>
                  </div>
                  {keyInsights.map((item) => (
                    <div key={`insight-${item.title}`} className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                      <div className="text-sm font-semibold text-white">{item.title}</div>
                      <div className="mt-2 text-sm leading-7 text-[#c8bfe7]">{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-[#2a1c55] bg-[#100926] p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <MessageSquareText className="h-4 w-4 text-[#49e6ff]" />
                    你还想了解什么？
                  </div>
                  <p className="mt-2 max-w-3xl text-sm leading-7 text-[#c8bfe7]">
                    这里会再调用 Gemini 2.5 Pro，基于当前 {selectedWindowDays} 天窗口和你此刻最关心的“{personalizedSubject}”继续回答。回答会保持专业判断，也会给你一句真诚的鼓励，帮你把方向走稳。
                  </p>
                </div>
                <div className="rounded-2xl border border-[#2f2260] bg-[#130b31] px-4 py-3 text-xs text-[#aa95dc]">
                  当前时间维度：近 {selectedWindowDays} 天
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {hotQuestionSuggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setQuestion(item);
                      void handleAsk(item);
                    }}
                    className="rounded-full border border-[#3a2b6a] bg-[#140b31] px-3 py-2 text-sm text-[#d7d0ef] transition hover:border-[#49e6ff]/25 hover:bg-[rgba(73,230,255,0.08)]"
                  >
                    {item}
                  </button>
                ))}
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="例如：如果我现在先做小红书，应该先做图文还是视频？为什么？"
                  className="min-h-[128px] w-full rounded-2xl border border-white/10 bg-[#0c061e] px-4 py-3 text-sm leading-7 text-white outline-none transition focus:border-[#49e6ff]/35"
                />
                <button
                  type="button"
                  onClick={() => void handleAsk()}
                  disabled={askPlatformFollowUpMutation.isPending}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#14d6ff,#5f6bff)] px-5 py-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {askPlatformFollowUpMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                  继续追问
                </button>
              </div>

              {askResult ? (
                <div className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-5">
                    <div className="text-lg font-bold text-white">{askResult.title}</div>
                    <div className="mt-3 text-sm leading-8 text-[#d7d0ef] whitespace-pre-wrap">{askResult.answer}</div>
                  </div>
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-5">
                      <div className="text-sm font-semibold text-[#8cefff]">给你的鼓励</div>
                      <div className="mt-3 text-sm leading-7 text-[#d7d0ef]">{askResult.encouragement}</div>
                    </div>
                    <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-5">
                      <div className="text-sm font-semibold text-[#ffdd44]">你还可以继续问</div>
                      <div className="mt-3 space-y-2">
                        {askResult.nextQuestions.map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => {
                              setQuestion(item);
                              void handleAsk(item);
                            }}
                            className="block w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm text-[#d7d0ef] transition hover:bg-white/10"
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
