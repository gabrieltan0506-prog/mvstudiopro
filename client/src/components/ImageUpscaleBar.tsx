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
  /** newImageUrl: 放大后图片 URL；factor: "2×" */
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
  const [activeFactor, setActiveFactor] = useState<"x2" | null>(null);
  const activeFactorRef = useRef<"x2" | null>(null);

  const mut = trpc.vertexImage.upscale.useMutation({
    onSuccess: async (data) => {
      if (data.success && data.imageUrl) {
        toast.success("高清放大完成（2×）");
        onUpscaled?.(data.imageUrl, "2×");
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

  const btnBase =
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 transition hover:bg-white/10 disabled:opacity-45";

  function handleClick() {
    if (activeFactor) return;
    const confirmed = window.confirm(
      "放大（2×）后将直接替换原图，无法还原。\n请先右键保存原图，再继续。\n\n确定放大吗？",
    );
    if (!confirmed) return;
    activeFactorRef.current = "x2";
    setActiveFactor("x2");
    mut.mutate({ imageUrl: url, upscaleFactor: "x2", baseCreditKey });
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
      <button type="button" className={btnBase} disabled={!!activeFactor} onClick={handleClick}>
        {activeFactor === "x2" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        2×
      </button>
      <span style={{ fontSize: 11, opacity: 0.55, width: "100%", flexBasis: "100%" }}>
        单次约 {r2.min}～{r2.max} 积分（2×，视原图计费基准）
      </span>
    </div>
  );
}
