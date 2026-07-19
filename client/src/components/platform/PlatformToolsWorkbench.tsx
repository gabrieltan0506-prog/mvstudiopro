import React from "react";
import { Presentation, Scissors, Video } from "lucide-react";

export type PlatformToolsTab = "htmlPpt" | "matting" | "assets";

type Props = {
  activeTab: PlatformToolsTab;
  onTabChange: (tab: PlatformToolsTab) => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
};

const TABS: Array<{ id: PlatformToolsTab; label: string; icon: React.ReactNode }> = [
  { id: "htmlPpt", label: "动效 PPT", icon: <Presentation className="h-3.5 w-3.5" /> },
  { id: "matting", label: "自定义抠像", icon: <Scissors className="h-3.5 w-3.5" /> },
  { id: "assets", label: "素材分析", icon: <Video className="h-3.5 w-3.5" /> },
];

/** 更多工具：动效 PPT / 抠像 / 素材分析 */
export function PlatformToolsWorkbench({
  activeTab,
  onTabChange,
  disabled,
  children,
  className = "",
}: Props) {
  return (
    <div className={`mx-auto max-w-[1600px] space-y-4 ${className}`}>
      <div className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-xl border border-white/10 bg-black/35 p-1">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              disabled={disabled}
              onClick={() => onTabChange(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition disabled:opacity-50 ${
                active
                  ? "bg-[linear-gradient(135deg,#34d399,#059669)] text-white shadow-sm"
                  : "text-[#c9c0e6]/70 hover:text-white"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
