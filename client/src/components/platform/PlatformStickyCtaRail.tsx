import React from "react";
import { Loader2, Sparkles } from "lucide-react";

type Props = {
  title?: string;
  label: string;
  creditsLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
  onClick: () => void;
  /** 禁用态无法点到 button，由外层捕获「尝试操作」以记 cta_disabled */
  onDisabledAttempt?: () => void;
  secondary?: React.ReactNode;
  className?: string;
  /** desktop sticky rail vs mobile bottom bar style */
  variant?: "rail" | "bar";
};

export function PlatformStickyCtaRail({
  title = "下一步",
  label,
  creditsLabel,
  disabled,
  disabledReason,
  busy,
  onClick,
  onDisabledAttempt,
  secondary,
  className = "",
  variant = "rail",
}: Props) {
  const isBar = variant === "bar";
  const blocked = Boolean(disabled || busy);

  return (
    <aside
      className={`${
        isBar
          ? "fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#0a0618]/96 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden"
          : "sticky top-4 z-20 rounded-2xl border border-white/10 bg-[rgba(12,8,28,0.92)] p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-md"
      } ${className}`}
    >
      {!isBar ? (
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c9c0e6]/50">{title}</div>
      ) : null}
      {creditsLabel ? (
        <div className={`mb-2 text-[12px] font-semibold tabular-nums text-[#fef08a] ${isBar ? "text-center" : ""}`}>
          预计 {creditsLabel}
        </div>
      ) : null}
      <div
        role={blocked ? "button" : undefined}
        tabIndex={blocked ? 0 : undefined}
        onClick={() => {
          if (blocked) onDisabledAttempt?.();
        }}
        onKeyDown={(e) => {
          if (blocked && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onDisabledAttempt?.();
          }
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            if (blocked) {
              e.preventDefault();
              onDisabledAttempt?.();
              return;
            }
            onClick();
          }}
          disabled={blocked}
          title={disabled && disabledReason ? disabledReason : undefined}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#7d73ff]/35 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#7d73ff)] px-4 py-3 text-sm font-bold text-white shadow-[0_10px_32px_rgba(106,92,255,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {label}
        </button>
      </div>
      {disabled && disabledReason ? (
        <button
          type="button"
          className={`mt-2 w-full text-left text-[11px] leading-snug text-amber-200/85 underline-offset-2 hover:underline ${isBar ? "text-center" : ""}`}
          onClick={() => onDisabledAttempt?.()}
        >
          {disabledReason}
        </button>
      ) : null}
      {secondary ? <div className="mt-3">{secondary}</div> : null}
    </aside>
  );
}
