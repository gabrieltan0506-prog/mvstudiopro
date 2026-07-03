import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, BookOpen, Crown, Loader2, Radar, Search, Sparkles, Users } from "lucide-react";

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

function TabPanel({ tab }: { tab: ResearchHubTab }) {
  switch (tab) {
    case "research":
      return <ResearchPage />;
    case "god-view":
      return <GodViewPage />;
    case "competitor-radar":
      return <CompetitorRadarPage />;
    case "ip-matrix":
      return <PlatformIpMatrixPage />;
    case "vip-tracker":
      return <VipTrackerPage />;
    default:
      return <ResearchPage />;
  }
}

export default function ResearchHubPage() {
  const [location, setLocation] = useLocation();
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
          <div className="flex flex-1 flex-wrap gap-1.5 md:justify-end">
            {TABS.map(({ id, label, hint, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-left transition ${
                  tab === id
                    ? "bg-[linear-gradient(135deg,#fb923c,#ea580c)] text-white shadow-sm"
                    : "border border-white/10 bg-black/30 text-white/75 hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" />
                <span className="text-[12px] font-semibold leading-none">{label}</span>
                <span className="hidden text-[10px] opacity-70 sm:inline">{hint}</span>
              </button>
            ))}
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
        <TabPanel tab={tab} />
      </Suspense>
    </div>
  );
}
