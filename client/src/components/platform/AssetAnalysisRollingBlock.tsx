import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { GrowthAnalysisScores } from "@shared/growth";
import { buildRollingSections, type AssetAnalysisRollingSection } from "@/lib/assetAnalysisRolling";

type AssetAnalysisRollingBlockProps = {
  title: string;
  badge?: string;
  partialAnalysis?: Partial<GrowthAnalysisScores>;
  stageLabel?: string;
  isComplete?: boolean;
  contextHint?: string;
  className?: string;
};

function SectionBody({ section }: { section: AssetAnalysisRollingSection }) {
  if (section.kind === "scores") {
    return (
      <div className="flex flex-wrap gap-2">
        {section.content.split(" · ").map((chip) => (
          <span
            key={chip}
            className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-[#c9c0e6]/85"
          >
            {chip}
          </span>
        ))}
      </div>
    );
  }
  if (section.kind === "list") {
    return (
      <ul className="space-y-1.5 text-sm leading-7 text-white/88">
        {section.content.split("\n").filter(Boolean).map((line, i) => (
          <li key={`${section.id}-${i}`} className="whitespace-pre-wrap">
            {section.id === "titleSuggestions" || section.id === "strengths" ? `· ${line}` : line}
          </li>
        ))}
      </ul>
    );
  }
  return <p className="text-sm leading-7 text-white/88 whitespace-pre-wrap">{section.content}</p>;
}

export default function AssetAnalysisRollingBlock({
  title,
  badge,
  partialAnalysis,
  stageLabel,
  isComplete = false,
  contextHint,
  className = "",
}: AssetAnalysisRollingBlockProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const sections = useMemo(() => buildRollingSections(partialAnalysis), [partialAnalysis]);

  useEffect(() => {
    setRevealedCount(0);
  }, [title]);

  useEffect(() => {
    if (sections.length <= revealedCount) return;
    const timer = window.setTimeout(() => {
      setRevealedCount((c) => Math.min(c + 1, sections.length));
    }, isComplete ? 120 : 380);
    return () => window.clearTimeout(timer);
  }, [sections.length, revealedCount, isComplete]);

  useEffect(() => {
    if (revealedCount === 0) return;
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [revealedCount, stageLabel]);

  const visibleSections = sections.slice(0, revealedCount);
  const showContextHint = !visibleSections.length && contextHint;

  return (
    <div
      className={`rounded-xl border border-[#49e6ff]/25 bg-[rgba(73,230,255,0.06)] overflow-hidden ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/8 px-4 py-3">
        <span className="text-sm font-semibold text-white">{title}</span>
        {badge ? (
          <span className="rounded-full border border-[#8cefff]/30 bg-[#8cefff]/10 px-2 py-0.5 text-[10px] text-[#8cefff]">
            {badge}
          </span>
        ) : null}
      </div>

      <div
        ref={feedRef}
        className="max-h-[min(420px,52vh)] overflow-y-auto overscroll-contain px-4 py-3 space-y-3 scroll-smooth"
      >
        {showContextHint ? (
          <pre className="whitespace-pre-wrap text-xs leading-relaxed text-[#c9c0e6]/75 font-sans">
            {contextHint}
          </pre>
        ) : null}

        <AnimatePresence initial={false}>
          {visibleSections.map((section) => (
            <motion.div
              key={section.id}
              initial={{ opacity: 0, y: 14, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="overflow-hidden rounded-lg border border-white/8 bg-black/20 px-3 py-2.5"
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6ee7b7]/75 mb-1.5">
                {section.label}
              </div>
              <SectionBody section={section} />
            </motion.div>
          ))}
        </AnimatePresence>

        {!isComplete ? (
          <div className="flex items-center gap-2 py-2 text-xs text-[#8cefff]/80">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span>{stageLabel || "正在逐段生成解读…"}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
