import React from "react";
import { ArrowLeft, ChevronDown, HelpCircle, Sparkles, TrendingUp, Wrench } from "lucide-react";
import type { PlatformWorkbenchMode } from "@/lib/platformWorkbenchMode";

type ToolsKey = "htmlPpt" | "matting" | "assets";

type Props = {
  mode: PlatformWorkbenchMode;
  onModeChange: (mode: PlatformWorkbenchMode) => void;
  onToolsPick?: (tool: ToolsKey) => void;
  creditsLabel?: string;
  showHelp?: boolean;
  onHelp?: () => void;
  toolsOpen?: boolean;
  onToolsOpenChange?: (open: boolean) => void;
};

const MODE_ITEMS: Array<{
  id: Exclude<PlatformWorkbenchMode, "tools">;
  label: string;
  icon: React.ReactNode;
  accent: string;
}> = [
  {
    id: "create",
    label: "内容创作",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    accent: "from-[#ff4fb8]/30 to-[#7d73ff]/20 border-[#ff4fb8]/40 text-[#ff9fe0]",
  },
  {
    id: "trend",
    label: "平台趋势",
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    accent: "from-[#49e6ff]/25 to-[#6a5cff]/20 border-[#49e6ff]/40 text-[#8cefff]",
  },
];

const TOOL_ITEMS: Array<{ id: ToolsKey; label: string }> = [
  { id: "htmlPpt", label: "动效 PPT" },
  { id: "matting", label: "自定义抠像" },
  { id: "assets", label: "素材分析" },
];

export function PlatformModeShell({
  mode,
  onModeChange,
  onToolsPick,
  creditsLabel,
  showHelp = true,
  onHelp,
  toolsOpen = false,
  onToolsOpenChange,
}: Props) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="rounded-full border border-white/10 bg-white/5 p-2 transition hover:bg-white/10"
            aria-label="返回"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight text-white sm:text-base">平台工作台</div>
            <p className="hidden text-[11px] text-[#c9c0e6]/55 sm:block">生成选题与文案 · 趋势分析 · 更多工具</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {creditsLabel ? (
            <span className="rounded-full border border-[#fbbf24]/35 bg-[rgba(251,191,36,0.1)] px-3 py-1.5 text-[11px] font-semibold tabular-nums text-[#fef08a]">
              {creditsLabel}
            </span>
          ) : null}
          {showHelp ? (
            <button
              type="button"
              onClick={onHelp}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-[#c9c0e6]/80 hover:bg-white/10"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              帮助
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-xl border border-white/10 bg-black/40 p-1"
          role="tablist"
          aria-label="工作台模式"
        >
          {MODE_ITEMS.map((item) => {
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onModeChange(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition ${
                  active
                    ? `border bg-gradient-to-br ${item.accent} shadow-sm`
                    : "border border-transparent text-[#c9c0e6]/70 hover:text-white"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <button
            type="button"
            aria-expanded={toolsOpen}
            onClick={() => onToolsOpenChange?.(!toolsOpen)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition ${
              mode === "tools"
                ? "border-[#34d399]/40 bg-[rgba(52,211,153,0.12)] text-[#6ee7b7]"
                : "border-white/10 bg-black/35 text-[#c9c0e6]/80 hover:text-white"
            }`}
          >
            <Wrench className="h-3.5 w-3.5" />
            更多工具
            <ChevronDown className={`h-3.5 w-3.5 transition ${toolsOpen ? "rotate-180" : ""}`} />
          </button>
          {toolsOpen ? (
            <div className="absolute left-0 z-40 mt-1.5 min-w-[11rem] overflow-hidden rounded-xl border border-white/12 bg-[#120a28] py-1 shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
              {TOOL_ITEMS.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className="block w-full px-3.5 py-2.5 text-left text-[13px] text-[#e8e2f8] hover:bg-white/8"
                  onClick={() => {
                    onToolsPick?.(tool.id);
                    onToolsOpenChange?.(false);
                  }}
                >
                  {tool.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
