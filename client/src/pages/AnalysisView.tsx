import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ArrowLeft, FileText, BarChart2, Calendar, RefreshCw } from "lucide-react";
import { formatDateGMT8 } from "@/lib/utils";

const ANALYSIS_LABELS: Record<string, string> = {
  growth_camp: "成长营分析",
  platform: "平台趋势分析",
};

const ANALYSIS_COLORS: Record<string, { from: string; to: string; badge: string }> = {
  growth_camp: { from: "#4f1d96", to: "#0f172a", badge: "bg-violet-500/20 text-violet-300 border-violet-500/30" },
  platform: { from: "#0c3254", to: "#0f172a", badge: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" },
};

export default function AnalysisView() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth({ autoFetch: true, redirectOnUnauthenticated: true });

  const { data: item, isLoading, error } = trpc.creations.get.useQuery(
    { id },
    { enabled: !!id && isAuthenticated, retry: false }
  );

  if (authLoading || isLoading) {
    return (
      <div className="min-h-dvh bg-[#090915] flex items-center justify-center">
        <RefreshCw className="animate-spin text-purple-400 w-8 h-8" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="min-h-dvh bg-[#090915] flex flex-col items-center justify-center gap-4 text-white/50">
        <FileText className="w-12 h-12 opacity-30" />
        <p>找不到此分析记录</p>
        <button onClick={() => navigate("/my-works")} className="text-purple-400 text-sm underline">
          返回我的作品
        </button>
      </div>
    );
  }

  const meta = item.metadata as any ?? {};
  const analysisType: string = meta.analysisType ?? "growth_camp";
  const label = ANALYSIS_LABELS[analysisType] ?? "分析快照";
  const colors = ANALYSIS_COLORS[analysisType] ?? ANALYSIS_COLORS.growth_camp;
  const summary: string = meta.summary ?? "";
  const analysisDate: string = meta.analysisDate ?? item.createdAt;

  // Split summary into sections/paragraphs for display
  const sections = summary
    .split(/\n{2,}/)
    .map((s: string) => s.trim())
    .filter(Boolean);

  return (
    <div
      className="min-h-dvh"
      style={{ background: `linear-gradient(160deg, ${colors.from} 0%, ${colors.to} 40%, #090915 100%)` }}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-white/8 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4">
          <button
            onClick={() => navigate("/my-works")}
            className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition"
          >
            <ArrowLeft size={16} /> 我的作品
          </button>
          <span className="text-white/20">/</span>
          <span className="text-sm text-white/80 font-medium">{item.title ?? label}</span>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-5 py-10">
        {/* Title card */}
        <div className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className={`mb-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${colors.badge}`}>
            {analysisType === "platform" ? <BarChart2 size={12} /> : <FileText size={12} />}
            {label}
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">{item.title ?? label}</h1>
          <div className="flex items-center gap-2 text-sm text-white/40">
            <Calendar size={13} />
            {formatDateGMT8(analysisDate, { showTime: true })}
          </div>
          {item.quality && (
            <div className="mt-2 text-xs text-white/30">{item.quality}</div>
          )}
        </div>

        {/* Summary content */}
        {sections.length > 0 ? (
          <div className="space-y-4">
            {sections.map((section: string, i: number) => {
              const lines = section.split("\n");
              const isHeading = lines[0].startsWith("#") || lines[0].startsWith("**") || lines[0].length < 40;
              return (
                <div
                  key={i}
                  className="rounded-xl border border-white/8 bg-white/4 px-5 py-4"
                >
                  {isHeading && lines.length > 1 ? (
                    <>
                      <p className="mb-2 text-sm font-semibold text-purple-300">
                        {lines[0].replace(/^#+\s*|^\*\*|\*\*$/g, "")}
                      </p>
                      <p className="text-sm leading-7 text-white/70 whitespace-pre-wrap">
                        {lines.slice(1).join("\n")}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm leading-7 text-white/75 whitespace-pre-wrap">{section}</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/15 py-16 text-center text-white/30">
            <FileText className="mx-auto mb-3 opacity-30" size={32} />
            <p className="text-sm">此快照未保存分析摘要内容</p>
            <p className="mt-1 text-xs opacity-60">请重新下载 PDF 以生成新的快照记录</p>
          </div>
        )}

        {/* Re-analyze link */}
        <div className="mt-10 flex justify-center">
          <button
            onClick={() => navigate(analysisType === "platform" ? "/platform" : "/analysis")}
            className="inline-flex items-center gap-2 rounded-xl bg-purple-600/20 border border-purple-500/30 px-5 py-2.5 text-sm text-purple-300 hover:bg-purple-600/30 transition"
          >
            <RefreshCw size={14} />
            重新分析
          </button>
        </div>
      </div>
    </div>
  );
}
