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
  /** 使用 Tailwind 时使用 */
  compact?: boolean;
  onUpscaled?: (newImageUrl: string) => void;
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
  const mut = trpc.vertexImage.upscale.useMutation({
    onSuccess: async (data) => {
      if (data.success && data.imageUrl) {
        toast.success("高清放大完成");
        onUpscaled?.(data.imageUrl);
        await utils.stripe.getSubscription.invalidate().catch(() => undefined);
      } else {
        toast.error(String((data as { error?: string }).error || "放大失败"));
      }
    },
    onError: (e) => toast.error(e.message || "放大失败"),
  });

  const url = String(imageUrl || "").trim();
  if (!url) return null;

  const r2 = imageUpscaleCreditRangeHint("x2");
  const r4 = imageUpscaleCreditRangeHint("x4");

  const btnBase =
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 transition hover:bg-white/10 disabled:opacity-45";

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
      <span style={{ fontSize: 12, opacity: 0.72, fontWeight: 700 }}>Upscale</span>
      <button
        type="button"
        className={btnBase}
        disabled={mut.isPending}
        onClick={() => mut.mutate({ imageUrl: url, upscaleFactor: "x2", baseCreditKey })}
      >
        {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        2×
      </button>
      <button
        type="button"
        className={btnBase}
        disabled={mut.isPending}
        onClick={() => mut.mutate({ imageUrl: url, upscaleFactor: "x4", baseCreditKey })}
      >
        {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        4×
      </button>
      <span style={{ fontSize: 11, opacity: 0.55, width: "100%", flexBasis: "100%" }}>
        单次约 {r2.min}～{r2.max} / {r4.min}～{r4.max} 积分（2× / 4×，视原图计费基准）
      </span>
    </div>
  );
}
