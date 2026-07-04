import React from "react";
import type { GrowthAnalysisScores } from "@shared/growth";

type AssetAnalysisResultBlockProps = {
  analysis: GrowthAnalysisScores;
  title?: string;
  badge?: string;
  /** preview：评分与核心摘要；full：完整报告含拆解、选题与改法 */
  variant?: "preview" | "full";
  className?: string;
};

export default function AssetAnalysisResultBlock({
  analysis,
  title = "视觉分析结果",
  badge,
  variant = "full",
  className = "",
}: AssetAnalysisResultBlockProps) {
  const isPreview = variant === "preview";
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

      {analysis.summary ? (
        <p className="text-sm leading-7 text-white/90 whitespace-pre-wrap">{analysis.summary}</p>
      ) : null}

      {analysis.realityCheck ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">现实查验</div>
          <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">{analysis.realityCheck}</p>
        </div>
      ) : null}

      {analysis.visualSummary ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">画面摘要</div>
          <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">{analysis.visualSummary}</p>
        </div>
      ) : null}

      {isPreview && analysis.strengths?.length ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">优势（节选）</div>
          <ul className="list-disc pl-5 space-y-1 text-sm text-white/85">
            {analysis.strengths.slice(0, 2).map((item, i) => (
              <li key={`preview-strength-${i}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {isPreview ? (
        <p className="text-[11px] text-[#8cefff]/55">完整拆解、选题与改法将在分析结束后展示 ↓</p>
      ) : null}

      {!isPreview &&
      (analysis.reverseEngineering?.hookStrategy ||
      analysis.reverseEngineering?.emotionalArc ||
      analysis.reverseEngineering?.commercialLogic) ? (
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/15 p-4">
          <div className="text-[11px] font-semibold text-[#6ee7b7]/80">视觉拆解</div>
          {analysis.reverseEngineering.hookStrategy ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#c9c0e6]/50 mb-1">抓眼策略</div>
              <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">
                {analysis.reverseEngineering.hookStrategy}
              </p>
            </div>
          ) : null}
          {analysis.reverseEngineering.emotionalArc ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#c9c0e6]/50 mb-1">浏览情绪曲线</div>
              <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">
                {analysis.reverseEngineering.emotionalArc}
              </p>
            </div>
          ) : null}
          {analysis.reverseEngineering.commercialLogic ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#c9c0e6]/50 mb-1">商业承接</div>
              <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">
                {analysis.reverseEngineering.commercialLogic}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {!isPreview && analysis.premiumContent?.actionableTopics?.length ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-2">可执行选题</div>
          <div className="space-y-3">
            {analysis.premiumContent.actionableTopics.slice(0, 3).map((topic, i) => (
              <div key={`topic-${i}`} className="rounded-xl border border-white/10 bg-black/15 p-4">
                <div className="text-sm font-semibold text-[#fde047]/90">{topic.title || `选题 ${i + 1}`}</div>
                {topic.contentBrief ? (
                  <p className="mt-2 text-sm leading-7 text-white/85 whitespace-pre-wrap">{topic.contentBrief}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!isPreview && analysis.strengths?.length ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">优势</div>
          <ul className="list-disc pl-5 space-y-1 text-sm text-white/85">
            {analysis.strengths.map((item, i) => (
              <li key={`strength-${i}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!isPreview && analysis.improvements?.length ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">改进建议</div>
          <ul className="list-disc pl-5 space-y-1 text-sm text-white/85">
            {analysis.improvements.map((item, i) => (
              <li key={`improve-${i}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!isPreview && analysis.platforms?.length ? (
        <div className="text-xs text-[#8cefff]/80">推荐平台：{analysis.platforms.join(" · ")}</div>
      ) : null}

      {!isPreview && analysis.titleSuggestions?.length ? (
        <div>
          <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">标题建议</div>
          <ul className="space-y-1 text-sm text-[#fde047]/90">
            {analysis.titleSuggestions.slice(0, 5).map((t, i) => (
              <li key={`title-${i}`}>· {t}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
