import React, { useMemo } from "react";
import { coerceDisplayText, parseGrowthAnalysisScores, type GrowthAnalysisScores } from "@shared/growth";

type AssetAnalysisResultBlockProps = {
  analysis: GrowthAnalysisScores;
  title?: string;
  badge?: string;
  /** preview：评分与核心摘要；full：完整报告含拆解、选题与改法 */
  variant?: "preview" | "full";
  className?: string;
};

function textOrNull(value: unknown): string | null {
  const t = coerceDisplayText(value);
  return t.length > 0 ? t : null;
}

export default function AssetAnalysisResultBlock({
  analysis: rawAnalysis,
  title = "视觉分析结果",
  badge,
  variant = "full",
  className = "",
}: AssetAnalysisResultBlockProps) {
  const analysis = useMemo(() => parseGrowthAnalysisScores(rawAnalysis), [rawAnalysis]);
  const isPreview = variant === "preview";

  const hookStrategy = textOrNull(analysis.reverseEngineering?.hookStrategy);
  const emotionalArc = textOrNull(analysis.reverseEngineering?.emotionalArc);
  const commercialLogic = textOrNull(analysis.reverseEngineering?.commercialLogic);
  const hasVisualBreakdown = Boolean(hookStrategy || emotionalArc || commercialLogic);

  const strengths = (analysis.strengths || []).map((s) => textOrNull(s)).filter(Boolean) as string[];
  const improvements = (analysis.improvements || []).map((s) => textOrNull(s)).filter(Boolean) as string[];
  const bgmAnalysis = textOrNull(analysis.bgmAnalysis);
  const musicRecommendation = textOrNull(analysis.musicRecommendation);
  const summary = textOrNull(analysis.summary);
  const realityCheck = textOrNull(analysis.realityCheck);
  const visualSummary = textOrNull(analysis.visualSummary);
  const platforms = (analysis.platforms || []).map((p) => textOrNull(p)).filter(Boolean) as string[];
  const titleSuggestions = (analysis.titleSuggestions || []).map((t) => textOrNull(t)).filter(Boolean) as string[];

  return (
    <div className={`space-y-5 rounded-2xl border border-[#6ee7b7]/25 bg-[rgba(52,211,153,0.06)] p-5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-[#6ee7b7]/80">{title}</div>
        {badge ? (
          <span className="rounded-full border border-[#49e6ff]/30 bg-[#49e6ff]/10 px-2 py-0.5 text-[10px] font-medium text-[#8cefff]">
            {badge}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 text-[11px]">
        {[
          ["构图", analysis.composition],
          ["色彩", analysis.color],
          ["灯光", analysis.lighting],
          ["冲击", analysis.impact],
          ["传播", analysis.viralPotential],
        ].map(([label, score]) => (
          <span
            key={String(label)}
            className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[#c9c0e6]/80"
          >
            {label} {score}
          </span>
        ))}
      </div>

      {summary ? (
        <p className="text-sm leading-7 text-white/90 whitespace-pre-wrap">{summary}</p>
      ) : null}

      {realityCheck ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">现实查验</div>
          <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">{realityCheck}</p>
        </div>
      ) : null}

      {visualSummary ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">画面摘要</div>
          <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">{visualSummary}</p>
        </div>
      ) : null}

      {isPreview && strengths.length ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">优势（节选）</div>
          <ul className="list-disc pl-5 space-y-1 text-sm text-white/85">
            {strengths.slice(0, 2).map((item, i) => (
              <li key={`preview-strength-${i}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {isPreview ? (
        <p className="text-[11px] text-[#8cefff]/55">完整拆解、选题与改法将在分析结束后展示 ↓</p>
      ) : null}

      {!isPreview && hasVisualBreakdown ? (
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/15 p-4">
          <div className="text-[11px] font-semibold text-[#6ee7b7]/80">视觉拆解</div>
          {hookStrategy ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#c9c0e6]/50 mb-1">抓眼策略</div>
              <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">{hookStrategy}</p>
            </div>
          ) : null}
          {emotionalArc ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#c9c0e6]/50 mb-1">浏览情绪曲线</div>
              <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">{emotionalArc}</p>
            </div>
          ) : null}
          {commercialLogic ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#c9c0e6]/50 mb-1">商业承接</div>
              <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">{commercialLogic}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {!isPreview && bgmAnalysis ? (
        <div className="space-y-2 rounded-xl border border-[#8cefff]/20 bg-[rgba(140,239,255,0.06)] p-4">
          <div className="text-[11px] font-semibold text-[#8cefff]/85">BGM / 配乐分析</div>
          <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">{bgmAnalysis}</p>
          {musicRecommendation ? (
            <p className="text-sm leading-7 text-[#c9c0e6]/75 whitespace-pre-wrap">{musicRecommendation}</p>
          ) : null}
        </div>
      ) : null}

      {!isPreview && analysis.premiumContent?.actionableTopics?.length ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-2">可执行选题</div>
          <div className="space-y-3">
            {analysis.premiumContent.actionableTopics.slice(0, 3).map((topic, i) => {
              const topicTitle = textOrNull(topic.title);
              const brief = textOrNull(topic.contentBrief);
              if (!topicTitle && !brief) return null;
              return (
                <div key={`topic-${i}`} className="rounded-xl border border-white/10 bg-black/15 p-4">
                  {topicTitle ? (
                    <div className="text-sm font-semibold text-[#fde047]/90">{topicTitle}</div>
                  ) : null}
                  {brief ? (
                    <p className="mt-2 text-sm leading-7 text-white/85 whitespace-pre-wrap">{brief}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {!isPreview && strengths.length ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">优势</div>
          <ul className="list-disc pl-5 space-y-1 text-sm text-white/85">
            {strengths.map((item, i) => (
              <li key={`strength-${i}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!isPreview && improvements.length ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">改进建议</div>
          <ul className="list-disc pl-5 space-y-1 text-sm text-white/85">
            {improvements.map((item, i) => (
              <li key={`improve-${i}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!isPreview && platforms.length ? (
        <div className="text-xs text-[#8cefff]/80">推荐平台：{platforms.join(" · ")}</div>
      ) : null}

      {!isPreview && titleSuggestions.length ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">标题建议</div>
          <ul className="space-y-1 text-sm text-[#fde047]/90">
            {titleSuggestions.slice(0, 5).map((t, i) => (
              <li key={`title-${i}`}>· {t}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
