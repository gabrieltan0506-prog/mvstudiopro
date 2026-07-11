import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowLeft,
  FileText,
  BarChart2,
  Calendar,
  RefreshCw,
  Image as ImageIcon,
  Layers,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { formatDateGMT8 } from "@/lib/utils";
import { PlatformReportDashboard } from "@/components/PlatformReportDashboard";
import type { AdvancedAIReportData } from "@shared/advancedAIReport";
import {
  isPlatformSessionBundleMetadata,
  type PlatformSessionBundleArtifact,
  type PlatformSessionExecutionCardArtifact,
} from "@shared/platformSessionBundle";

const ANALYSIS_LABELS: Record<string, string> = {
  growth_camp: "成长营分析",
  platform: "平台趋势分析",
};

const ANALYSIS_COLORS: Record<string, { from: string; to: string; badge: string }> = {
  growth_camp: { from: "#4f1d96", to: "#0f172a", badge: "bg-violet-500/20 text-violet-300 border-violet-500/30" },
  platform: { from: "#0c3254", to: "#0f172a", badge: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" },
};

function parseMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

function ExecutionCardBlock({ card }: { card: PlatformSessionExecutionCardArtifact }) {
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <h3 className="text-base font-bold text-white">{card.title || "未命名选题"}</h3>
      {card.hook ? <p className="mt-1 text-sm text-cyan-200/80">{card.hook}</p> : null}
      {card.suitablePlatforms?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.suitablePlatforms.map((p) => (
            <span key={p} className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/55">
              {p}
            </span>
          ))}
        </div>
      ) : null}
      {(card.coverImageUrl || card.storyboardImageUrl) && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {card.coverImageUrl ? (
            <div>
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-white/45">
                <ImageIcon size={12} /> 封面
              </div>
              <img
                src={card.coverImageUrl}
                alt={`${card.title || "选题"}封面`}
                className="w-full rounded-lg border border-white/10 object-cover"
              />
            </div>
          ) : null}
          {card.storyboardImageUrl ? (
            <div>
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-white/45">
                <Layers size={12} /> 分镜图
              </div>
              <img
                src={card.storyboardImageUrl}
                alt={`${card.title || "选题"}分镜`}
                className="w-full rounded-lg border border-white/10 object-cover"
              />
            </div>
          ) : null}
        </div>
      )}
      {card.copywriting ? (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold text-purple-300/80">文案</div>
          <p className="whitespace-pre-wrap text-sm leading-7 text-white/75">{card.copywriting}</p>
        </div>
      ) : null}
      {card.detailedScript ? (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold text-emerald-300/80">详细脚本</div>
          <p className="whitespace-pre-wrap text-sm leading-7 text-white/70">{card.detailedScript}</p>
        </div>
      ) : null}
      {card.executionDetails?.stepByStepScript?.length ? (
        <ol className="mt-3 list-decimal space-y-1 pl-4 text-sm text-white/65">
          {card.executionDetails.stepByStepScript.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      ) : null}
      {card.publishingAdvice ? (
        <p className="mt-3 text-xs leading-6 text-amber-200/70">发布建议：{card.publishingAdvice}</p>
      ) : null}
    </article>
  );
}

function PlatformSessionBundleView({
  bundle,
  title,
  analysisDate,
  quality,
}: {
  bundle: PlatformSessionBundleArtifact;
  title: string;
  analysisDate: string;
  quality?: string | null;
}) {
  const decision = bundle.decisionIntelReport as AdvancedAIReportData | null | undefined;
  const dash = bundle.platformDashboard as
    | { headline?: string; subheadline?: string; hotTopics?: Array<{ title?: string; topic?: string }> }
    | null
    | undefined;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      <div className="mb-8 rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-6">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-200">
          <Sparkles size={12} /> 平台全案作品包
        </div>
        <h1 className="mb-2 text-2xl font-bold text-white">{title}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-white/40">
          <span className="inline-flex items-center gap-1.5">
            <Calendar size={13} />
            {formatDateGMT8(analysisDate, { showTime: true })}
          </span>
          {bundle.windowDays ? <span>窗口：近 {bundle.windowDays} 天</span> : null}
          {quality ? <span>{quality}</span> : null}
        </div>
        {dash?.headline ? <p className="mt-3 text-sm font-medium text-white/80">{dash.headline}</p> : null}
        {dash?.subheadline ? <p className="mt-1 text-sm text-white/50">{dash.subheadline}</p> : null}
      </div>

      {decision ? (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-bold text-white">个人战略全景</h2>
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#0B0F19] p-2">
            <PlatformReportDashboard data={decision} />
          </div>
        </section>
      ) : null}

      {Array.isArray(bundle.executionCards) && bundle.executionCards.length > 0 ? (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-bold text-white">
            选题文案与分镜（{bundle.executionCards.length}）
          </h2>
          <div className="space-y-4">
            {bundle.executionCards.map((card, i) => (
              <ExecutionCardBlock key={card.id || `${card.title}-${i}`} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      {bundle.deepQa?.answer ? (
        <section className="mb-10 rounded-2xl border border-violet-500/25 bg-violet-500/5 p-5">
          <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-white">
            <MessageSquare size={18} /> 深度追问
          </h2>
          {bundle.deepQa.question ? (
            <p className="mb-2 text-sm font-semibold text-violet-200/90">Q：{bundle.deepQa.question}</p>
          ) : null}
          <p className="whitespace-pre-wrap text-sm leading-7 text-white/75">{bundle.deepQa.answer}</p>
        </section>
      ) : null}

      {bundle.customCopy?.trim() ? (
        <section className="mb-10 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
          <h2 className="mb-2 text-lg font-bold text-white">自定义生成文案</h2>
          {bundle.customTopicProtagonist ? (
            <p className="mb-2 text-xs text-amber-200/70">主人公：{bundle.customTopicProtagonist}</p>
          ) : null}
          <p className="whitespace-pre-wrap text-sm leading-7 text-white/75">{bundle.customCopy}</p>
        </section>
      ) : null}

      {dash?.hotTopics?.length ? (
        <section className="mb-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-3 text-lg font-bold text-white">平台趋势摘要</h2>
          <ul className="space-y-1.5 text-sm text-white/70">
            {dash.hotTopics.slice(0, 8).map((t, i) => (
              <li key={i}>· {t.title || t.topic || String(t)}</li>
            ))}
          </ul>
          {bundle.visualReport ? (
            <p className="mt-3 text-xs text-white/40">已保存完整趋势视觉报表数据（可在平台页重新导出图）。</p>
          ) : null}
        </section>
      ) : bundle.visualReport ? (
        <section className="mb-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-2 text-lg font-bold text-white">平台趋势分析</h2>
          <p className="text-sm text-white/55">本作品包已包含趋势视觉报表快照数据。</p>
        </section>
      ) : null}
    </div>
  );
}

export default function AnalysisView() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth({
    autoFetch: true,
    redirectOnUnauthenticated: true,
  });

  const { data: item, isLoading, error } = trpc.creations.get.useQuery(
    { id },
    { enabled: !!id && isAuthenticated, retry: false },
  );

  if (authLoading || isLoading) {
    return (
      <div className="min-h-dvh bg-transparent flex items-center justify-center">
        <RefreshCw className="animate-spin text-purple-400 w-8 h-8" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="min-h-dvh bg-transparent flex flex-col items-center justify-center gap-4 text-white/50">
        <FileText className="w-12 h-12 opacity-30" />
        <p>找不到此分析记录</p>
        <button onClick={() => navigate("/my-works")} className="text-purple-400 text-sm underline">
          返回我的作品
        </button>
      </div>
    );
  }

  const meta = parseMeta(item.metadata);
  const isBundle =
    item.type === "platform_session_bundle" || isPlatformSessionBundleMetadata(meta);
  const decisionReport =
    (meta.report as AdvancedAIReportData | undefined) ||
    (meta.decisionIntelReport as AdvancedAIReportData | undefined) ||
    null;
  const isDecisionOnly =
    !isBundle &&
    (item.type === "advanced_decision_report" || !!decisionReport) &&
    !!decisionReport;

  const analysisType: string = (meta.analysisType as string) ?? (isBundle ? "platform" : "growth_camp");
  const label = isBundle
    ? "平台全案作品包"
    : isDecisionOnly
      ? "个人战略全景"
      : ANALYSIS_LABELS[analysisType] ?? "分析快照";
  const colors = ANALYSIS_COLORS[analysisType] ?? ANALYSIS_COLORS.growth_camp;
  const summary: string = (meta.summary as string) ?? "";
  const analysisDate: string = (meta.analysisDate as string) ?? String(item.createdAt);

  const sections = summary
    .split(/\n{2,}/)
    .map((s: string) => s.trim())
    .filter(Boolean);

  return (
    <div
      className="min-h-dvh"
      style={{ background: `linear-gradient(160deg, ${colors.from} 0%, ${colors.to} 40%, #090915 100%)` }}
    >
      <div className="sticky top-0 z-10 border-b border-white/8 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4">
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

      {isBundle && isPlatformSessionBundleMetadata(meta) ? (
        <PlatformSessionBundleView
          bundle={meta.bundle}
          title={item.title ?? label}
          analysisDate={analysisDate}
          quality={item.quality}
        />
      ) : isDecisionOnly && decisionReport ? (
        <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-6">
            <div
              className={`mb-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${colors.badge}`}
            >
              <BarChart2 size={12} />
              {label}
            </div>
            <h1 className="mb-2 text-2xl font-bold text-white">{item.title ?? label}</h1>
            <div className="flex items-center gap-2 text-sm text-white/40">
              <Calendar size={13} />
              {formatDateGMT8(analysisDate, { showTime: true })}
            </div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#0B0F19] p-2">
            <PlatformReportDashboard data={decisionReport} />
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl px-5 py-10">
          <div className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-6">
            <div
              className={`mb-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${colors.badge}`}
            >
              {analysisType === "platform" ? <BarChart2 size={12} /> : <FileText size={12} />}
              {label}
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">{item.title ?? label}</h1>
            <div className="flex items-center gap-2 text-sm text-white/40">
              <Calendar size={13} />
              {formatDateGMT8(analysisDate, { showTime: true })}
            </div>
            {item.quality && <div className="mt-2 text-xs text-white/30">{item.quality}</div>}
          </div>

          {sections.length > 0 ? (
            <div className="space-y-4">
              {sections.map((section: string, i: number) => {
                const lines = section.split("\n");
                const isHeading =
                  lines[0].startsWith("#") || lines[0].startsWith("**") || lines[0].length < 40;
                return (
                  <div key={i} className="rounded-xl border border-white/8 bg-white/4 px-5 py-4">
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
      )}

      {(isBundle || isDecisionOnly) && (
        <div className="mx-auto max-w-6xl px-4 pb-12 text-center">
          <button
            onClick={() => navigate("/platform")}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-600/15 px-5 py-2.5 text-sm text-cyan-200 hover:bg-cyan-600/25 transition"
          >
            <RefreshCw size={14} />
            回到平台页继续创作
          </button>
        </div>
      )}
    </div>
  );
}
