import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, BookOpen, Crown, Loader2, Radar, Search, Sparkles, Users } from "lucide-react";
import { ResearchHubEmbedProvider } from "@/lib/researchHubContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { hasSupervisorAccess } from "@/lib/supervisorAccess";
import {
  canOpenCompetitorResearch,
  COMPETITOR_RESEARCH_BETA_LABEL_ZH,
  COMPETITOR_RESEARCH_BETA_NOTE_ZH,
} from "@/lib/competitorResearchBeta";

const ResearchPage = lazy(() => import("./ResearchPage"));
const GodViewPage = lazy(() => import("./GodViewPage"));
const CompetitorRadarPage = lazy(() => import("./CompetitorRadarPage"));
const PlatformIpMatrixPage = lazy(() => import("./PlatformIpMatrixPage"));
const VipTrackerPage = lazy(() => import("./VipTrackerPage"));

export type ResearchHubTab =
  | "research"
  | "god-view"
  | "competitor-radar"
  | "ip-matrix"
  | "vip-tracker";

const TABS: {
  id: ResearchHubTab;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "research", label: "竞品调研", hint: "60 点/次", icon: Search },
  { id: "god-view", label: "战略智库", hint: "半月刊 · 订阅 · 私订", icon: Crown },
  { id: "competitor-radar", label: "赛道雷达", hint: "720 点", icon: Radar },
  { id: "ip-matrix", label: "IP 矩阵", hint: "多平台布局", icon: Sparkles },
  { id: "vip-tracker", label: "VIP 追踪", hint: "高价值客户", icon: Users },
];

function parseTab(search: string): ResearchHubTab {
  const raw = new URLSearchParams(search).get("tab");
  if (raw && TABS.some((t) => t.id === raw)) return raw as ResearchHubTab;
  return "research";
}

/** 竞品调研内测中的占位页：链接虽已隐藏，直接输 URL 也要挡住 */
function CompetitorResearchBetaNotice() {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 px-6 py-24 text-center">
      <span className="rounded-full bg-amber-400/15 px-3 py-1 text-[11px] font-bold text-amber-300">
        {COMPETITOR_RESEARCH_BETA_LABEL_ZH}
      </span>
      <h2 className="text-xl font-black text-white">竞品调研正在内测</h2>
      <p className="text-[13px] leading-relaxed text-white/55">{COMPETITOR_RESEARCH_BETA_NOTE_ZH}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Link
          href="/platform"
          className="rounded-xl bg-[linear-gradient(135deg,#fb923c,#ea580c)] px-4 py-2 text-[13px] font-bold text-white no-underline"
        >
          去平台创作
        </Link>
        <Link
          href="/research?tab=god-view"
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-[13px] font-semibold text-white/80 no-underline"
        >
          看战略智库
        </Link>
      </div>
    </div>
  );
}

function TabPanel({ tab, canResearch }: { tab: ResearchHubTab; canResearch: boolean }) {
  switch (tab) {
    case "research":
      return canResearch ? <ResearchPage /> : <CompetitorResearchBetaNotice />;
    case "god-view":
      return <GodViewPage />;
    case "competitor-radar":
      return <CompetitorRadarPage />;
    case "ip-matrix":
      return <PlatformIpMatrixPage />;
    case "vip-tracker":
      return <VipTrackerPage />;
    default:
      return canResearch ? <ResearchPage /> : <CompetitorResearchBetaNotice />;
  }
}

export default function ResearchHubPage() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const canResearch = canOpenCompetitorResearch(user?.role) || hasSupervisorAccess();
  const [tab, setTabState] = useState<ResearchHubTab>(() =>
    parseTab(typeof window !== "undefined" ? window.location.search : ""),
  );

  useEffect(() => {
    setTabState(parseTab(window.location.search));
  }, [location]);

  const setTab = useCallback(
    (next: ResearchHubTab) => {
      setLocation(next === "research" ? "/research" : `/research?tab=${next}`);
    },
    [setLocation],
  );

  return (
    <div className="min-h-dvh bg-transparent text-white">
      <div className="sticky top-0 z-40 border-b border-white/10 bg-[rgba(10,8,20,0.88)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[min(1920px,100%)] flex-wrap items-center gap-3 px-4 py-3 md:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            首页
          </Link>
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[#fb923c]" />
            <span className="text-sm font-black tracking-tight">竞品调研 Hub</span>
          </div>
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 md:justify-end md:overflow-visible [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map(({ id, label, hint, icon: Icon }) => {
              const beta = id === "research" && !canResearch;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  title={beta ? COMPETITOR_RESEARCH_BETA_NOTE_ZH : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-left transition ${
                    tab === id
                      ? "bg-[linear-gradient(135deg,#fb923c,#ea580c)] text-white shadow-sm"
                      : beta
                        ? "border border-white/10 bg-black/20 text-white/40"
                        : "border border-white/10 bg-black/30 text-white/75 hover:text-white"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" />
                  <span className="text-[12px] font-semibold leading-none">{label}</span>
                  <span className="hidden text-[10px] opacity-70 sm:inline">
                    {beta ? COMPETITOR_RESEARCH_BETA_LABEL_ZH : hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Suspense
        fallback={
          <div className="flex min-h-[50vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#fb923c]" />
          </div>
        }
      >
        <ResearchHubEmbedProvider>
          <TabPanel tab={tab} canResearch={canResearch} />
        </ResearchHubEmbedProvider>
      </Suspense>
    </div>
  );
}
