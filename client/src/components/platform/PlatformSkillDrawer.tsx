import React from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

/** 移动端 Skill / 高级模板抽屉 */
export function PlatformSkillDrawer({ open, onClose, title = "Skill 与模板", children }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] md:hidden">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[78vh] overflow-y-auto rounded-t-2xl border border-white/10 bg-[#100826] p-4 shadow-[0_-16px_48px_rgba(0,0,0,0.5)]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-bold text-white">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-1.5 text-[#c9c0e6]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
