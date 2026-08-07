import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  imageUpscaleTotalCredits,
  type ImageUpscaleBaseCreditKey,
} from "@shared/plans";
import { Loader2 } from "lucide-react";
import {
  buildUpscaleConfirmation,
  detectImageBlurRisk,
} from "@/lib/imageBlurDetection";

type UpscaleFactor = "x2" | "x4";

export type ImageUpscaleBarProps = {
  imageUrl: string | null | undefined;
  baseCreditKey: ImageUpscaleBaseCreditKey;
  className?: string;
  style?: React.CSSProperties;
  compact?: boolean;
  /** newImageUrl: 放大后图片 URL；factor: "2×" | "4×" */
  onUpscaled?: (newImageUrl: string, factor?: string) => void;
};

const FACTOR_LABEL: Record<UpscaleFactor, string> = {
  x2: "2×",
  x4: "4×",
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
  const [activeFactor, setActiveFactor] = useState<UpscaleFactor | null>(null);
  const activeFactorRef = useRef<UpscaleFactor | null>(null);

  const mut = trpc.vertexImage.upscale.useMutation({
    onSuccess: async (data) => {
      const factor = activeFactorRef.current;
      const label = factor ? FACTOR_LABEL[factor] : "高清";
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

  const cost2 = imageUpscaleTotalCredits(baseCreditKey, "x2");
  const cost4 = imageUpscaleTotalCredits(baseCreditKey, "x4");

  const btnBase =
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 transition hover:bg-white/10 disabled:opacity-45";

  async function handleClick(factor: UpscaleFactor) {
    if (activeFactorRef.current) return;
    activeFactorRef.current = factor;
    setActiveFactor(factor);
    const label = FACTOR_LABEL[factor];
    const cost = factor === "x2" ? cost2 : cost4;
    const assessment = await detectImageBlurRisk(url);
    const confirmed = window.confirm(buildUpscaleConfirmation({
      factorLabel: label,
      credits: cost,
      assessment,
      replacesOriginal: true,
    }));
    if (!confirmed) {
      setActiveFactor(null);
      activeFactorRef.current = null;
      return;
    }
    mut.mutate({
      imageUrl: url,
      upscaleFactor: factor,
      baseCreditKey,
      qualityWarningAccepted: assessment.isLikelyBlurry,
      sourceBlurScore: assessment.score,
    });
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
      <span style={{ fontSize: 12, opacity: 0.72, fontWeight: 700 }}>高清放大</span>
      <button
        type="button"
        className={btnBase}
        disabled={!!activeFactor}
        onClick={() => void handleClick("x2")}
      >
        {activeFactor === "x2" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        2×
      </button>
      <button
        type="button"
        className={btnBase}
        disabled={!!activeFactor}
        onClick={() => void handleClick("x4")}
      >
        {activeFactor === "x4" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        4×
      </button>
      <span style={{ fontSize: 11, opacity: 0.55, width: "100%", flexBasis: "100%" }}>
        约 {cost2} 积分（2×）/ {cost4} 积分（4×）
      </span>
    </div>
  );
}
