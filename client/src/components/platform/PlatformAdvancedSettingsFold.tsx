import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  title?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  badge?: string;
};

/** 高级设置默认折叠（如百科可视化版式） */
export function PlatformAdvancedSettingsFold({
  title = "高级设置",
  defaultOpen = false,
  children,
  className = "",
  badge,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-xl border border-white/8 bg-black/20 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-[12px] font-semibold text-[#c9c0e6]/80">
          {title}
          {badge ? (
            <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-[#c9c0e6]/50">
              {badge}
            </span>
          ) : null}
        </span>
        <ChevronDown className={`h-4 w-4 text-[#c9c0e6]/50 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="border-t border-white/6 px-3 py-3">{children}</div> : null}
    </div>
  );
}
