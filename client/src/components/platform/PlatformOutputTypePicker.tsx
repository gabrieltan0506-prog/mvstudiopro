import React from "react";
import { FileText, Film, ImageIcon } from "lucide-react";
import type { PlatformOutputType } from "@/lib/platformWorkbenchMode";

type Props = {
  value: PlatformOutputType | null;
  onChange: (value: PlatformOutputType) => void;
  className?: string;
};

const OPTIONS: Array<{
  id: PlatformOutputType;
  label: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  {
    id: "single_page",
    label: "单页图文",
    hint: "知识卡 / 百科可视化版式",
    icon: <ImageIcon className="h-4 w-4" />,
  },
  {
    id: "storyboard_2x4",
    label: "2×4 分镜",
    hint: "编导分镜图，适合短视频",
    icon: <Film className="h-4 w-4" />,
  },
  {
    id: "optimize_article",
    label: "优化文章",
    hint: "深度改写后再出图",
    icon: <FileText className="h-4 w-4" />,
  },
];

export function PlatformOutputTypePicker({ value, onChange, className = "" }: Props) {
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="text-[12px] font-semibold text-white">输出形式</div>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={`rounded-xl border px-3 py-3 text-left transition ${
                active
                  ? "border-[#49e6ff]/45 bg-[rgba(73,230,255,0.12)] text-white"
                  : "border-white/10 bg-black/25 text-[#c9c0e6]/75 hover:border-white/20 hover:text-white"
              }`}
            >
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                {opt.icon}
                {opt.label}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-[#c9c0e6]/50">{opt.hint}</p>
            </button>
          );
        })}
      </div>
      {!value ? (
        <p className="text-[11px] text-[#c9c0e6]/45">先选一种输出形式，再展开对应配置。</p>
      ) : null}
    </div>
  );
}
