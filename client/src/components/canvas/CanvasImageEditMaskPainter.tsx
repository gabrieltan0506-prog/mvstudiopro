import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Paintbrush, Trash2, Upload } from "lucide-react";

type Props = {
  /** 底图（要微调的那张） */
  baseImageUrl: string;
  /** 遮罩上传中 */
  uploading?: boolean;
  /** 导出遮罩 PNG Blob 后由父组件上传并写入 editMaskUrl */
  onExportMask: (blob: Blob) => void | Promise<void>;
  onClearMaskUrl?: () => void;
  hasSavedMask?: boolean;
};

/**
 * 画笔遮罩：用户涂抹的区域 = 希望被改掉的区域。
 * 导出 PNG：涂抹处 alpha=0（透明=可改），未涂抹处不透明白（保留）。
 */
export function CanvasImageEditMaskPainter({
  baseImageUrl,
  uploading,
  onExportMask,
  onClearMaskUrl,
  hasSavedMask,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [brush, setBrush] = useState(28);
  const [mode, setMode] = useState<"paint" | "erase">("paint");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const syncSize = useCallback(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth || 768;
      const h = img.naturalHeight || 1024;
      for (const c of [canvasRef.current, overlayRef.current]) {
        if (!c) continue;
        c.width = w;
        c.height = h;
      }
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
      }
      const octx = overlayRef.current?.getContext("2d");
      if (octx) {
        octx.clearRect(0, 0, w, h);
      }
      setReady(true);
    };
    img.onerror = () => setReady(false);
    img.src = baseImageUrl;
  }, [baseImageUrl]);

  useEffect(() => {
    setReady(false);
    syncSize();
  }, [syncSize]);

  const paintAt = (clientX: number, clientY: number) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * overlay.width;
    const y = ((clientY - rect.top) / rect.height) * overlay.height;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.save();
    if (mode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(244,63,94,0.45)";
    }
    ctx.beginPath();
    ctx.arc(x, y, brush, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const exportMask = async () => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    setBusy(true);
    try {
      const w = overlay.width;
      const h = overlay.height;
      const src = overlay.getContext("2d")?.getImageData(0, 0, w, h);
      if (!src) return;
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const octx = out.getContext("2d");
      if (!octx) return;
      const dst = octx.createImageData(w, h);
      for (let i = 0; i < src.data.length; i += 4) {
        const a = src.data[i + 3];
        // 有涂抹（半透明红）→ 透明可改；无涂抹 → 不透明白保留
        if (a > 8) {
          dst.data[i] = 0;
          dst.data[i + 1] = 0;
          dst.data[i + 2] = 0;
          dst.data[i + 3] = 0;
        } else {
          dst.data[i] = 255;
          dst.data[i + 1] = 255;
          dst.data[i + 2] = 255;
          dst.data[i + 3] = 255;
        }
      }
      octx.putImageData(dst, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("遮罩导出失败");
      await onExportMask(blob);
    } finally {
      setBusy(false);
    }
  };

  const clearOverlay = () => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
    onClearMaskUrl?.();
  };

  return (
    <div className="space-y-2 rounded-lg border border-rose-400/25 bg-black/40 p-2">
      <div className="text-[10px] leading-5 text-rose-50/90">
        <span className="font-semibold text-rose-100">局部微调（画笔）</span>
        ：在要改的地方涂抹（粉红区域）。例：只改丝带颜色、只改背景杂物。涂完点「保存遮罩」再跑生成。
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${
            mode === "paint"
              ? "border-rose-400/50 bg-rose-500/25 text-rose-50"
              : "border-white/10 text-white/60"
          }`}
          onClick={() => setMode("paint")}
        >
          <Paintbrush className="h-3 w-3" />
          涂抹要改的区域
        </button>
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${
            mode === "erase"
              ? "border-sky-400/50 bg-sky-500/20 text-sky-50"
              : "border-white/10 text-white/60"
          }`}
          onClick={() => setMode("erase")}
        >
          <Eraser className="h-3 w-3" />
          擦除笔迹
        </button>
        <label className="ml-auto flex items-center gap-1 text-[10px] text-white/50">
          笔刷
          <input
            type="range"
            min={8}
            max={64}
            value={brush}
            onChange={(e) => setBrush(Number(e.target.value))}
            className="w-20"
          />
        </label>
      </div>
      {/* 固定 9:16 画板高度，避免 canvas h-full 在无明确高度父级上塌成横缝 */}
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[min(100%,20rem)] overflow-hidden rounded-md border border-white/10 bg-black/60">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />
        <canvas
          ref={overlayRef}
          className="absolute inset-0 z-10 h-full w-full cursor-crosshair touch-none object-contain"
          onPointerDown={(e) => {
            drawing.current = true;
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            paintAt(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            paintAt(e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            drawing.current = false;
          }}
          onPointerLeave={() => {
            drawing.current = false;
          }}
        />
        {!ready ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 text-[10px] text-white/50">
            载入底图…
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!ready || busy || uploading}
          onClick={() => void exportMask()}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-50 disabled:opacity-40"
        >
          <Upload className="h-3 w-3" />
          {uploading || busy ? "保存中…" : "保存遮罩"}
        </button>
        <button
          type="button"
          onClick={clearOverlay}
          className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/65"
        >
          <Trash2 className="h-3 w-3" />
          清空笔迹
        </button>
        {hasSavedMask ? (
          <span className="self-center text-[10px] text-emerald-200/90">已保存遮罩 · 跑生成时只改涂抹区</span>
        ) : (
          <span className="self-center text-[10px] text-white/40">未保存遮罩时＝整图按文字改</span>
        )}
      </div>
    </div>
  );
}
