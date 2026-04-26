import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  imageUpscaleCreditRangeHint,
  type ImageUpscaleBaseCreditKey,
} from "@shared/plans";
import { Loader2 } from "lucide-react";

export type ImageUpscaleBarProps = {
  imageUrl: string | null | undefined;
  baseCreditKey: ImageUpscaleBaseCreditKey;
  className?: string;
  style?: React.CSSProperties;
  compact?: boolean;
  /** newImageUrl: 放大后图片 URL；factor: "2×" 或 "4×" */
  onUpscaled?: (newImageUrl: string, factor?: string) => void;
};

export function ImageUpscaleBar({
  imageUrl,
  baseCreditKey,
  className,
  style,
  compact,
  onUpscaled,
}: ImageUpscaleBarProps) {
  const utils = trpc.useUtils();
  // 用 state 精确追踪是哪个按钮在转圈，与 mutation 的 isPending 完全解耦
  const [activeFactor, setActiveFactor] = useState<"x2" | "x4" | null>(null);
  const activeFactorRef = useRef<"x2" | "x4" | null>(null);

  const mut = trpc.vertexImage.upscale.useMutation({
    onSuccess: async (data) => {
      const label = activeFactorRef.current === "x2" ? "2×" : "4×";
      if (data.success && data.imageUrl) {
        toast.success(`高清放大完成（${label}）`);
        onUpscaled?.(data.imageUrl, label);
        await utils.stripe.getSubscription.invalidate().catch(() => undefined);
      } else {
        toast.error(String((data as { error?: string }).error || "放大失败"));
      }
      setActiveFactor(null);
      activeFactorRef.current = null;
    },
    onError: (e) => {
      toast.error(e.message || "放大失败");
      setActiveFactor(null);
      activeFactorRef.current = null;
    },
  });

  const url = String(imageUrl || "").trim();
  if (!url) return null;

  const r2 = imageUpscaleCreditRangeHint("x2");
  const r4 = imageUpscaleCreditRangeHint("x4");

  const btnBase =
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 transition hover:bg-white/10 disabled:opacity-45";

  function handleClick(factor: "x2" | "x4") {
    if (activeFactor) return;
    const label = factor === "x2" ? "2×" : "4×";
    const confirmed = window.confirm(
      `放大（${label}）后将直接替换原图，无法还原。\n请先右键保存原图，再继续。\n\n确定放大吗？`
    );
    if (!confirmed) return;
    activeFactorRef.current = factor;
    setActiveFactor(factor);
    mut.mutate({ imageUrl: url, upscaleFactor: factor, baseCreditKey });
  }

  return (
    <div
      className={className}
      style={{
        marginTop: compact ? 0 : 8,
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
        ...style,
      }}
    >
      <span style={{ fontSize: 12, opacity: 0.72, fontWeight: 700 }}>放大</span>
      <button
        type="button"
        className={btnBase}
        disabled={!!activeFactor}
        onClick={() => handleClick("x2")}
      >
        {activeFactor === "x2" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        2×
      </button>
      <button
        type="button"
        className={btnBase}
        disabled={!!activeFactor}
        onClick={() => handleClick("x4")}
      >
        {activeFactor === "x4" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        4×
      </button>
      <span style={{ fontSize: 11, opacity: 0.55, width: "100%", flexBasis: "100%" }}>
        单次约 {r2.min}～{r2.max} / {r4.min}～{r4.max} 积分（2× / 4×，视原图计费基准）
      </span>
    </div>
  );
}
