import { useRef, useState } from "react";
import { CheckCircle, Clock, Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

/**
 * 付款成功面板：拿到收款编号后，用户点一下就把手机相册里那张付款截图发上来。
 *
 * 截图对得上就当场到账，对不上留给人工，两种情况都能下载收据。
 * 压缩在浏览器里做——手机截图动辄 3–5MB，原图传上去慢且没必要。
 */

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

async function fileToCompressedBase64(file: File): Promise<{ base64: string; mimeType: "image/jpeg" }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持图片处理");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { base64: dataUrl.split(",")[1] ?? "", mimeType: "image/jpeg" };
}

type Receipt = {
  orderNo: string | null;
  companyName: string;
  amount: number;
  credits: number;
  method: string;
  settled: boolean;
  paidAt: Date | string | null;
};

/** 收据画成图再塞进 PDF：中文字体不用另外嵌，画布直接用系统字 */
function drawReceipt(r: Receipt): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const W = 1000;
  const H = 620;
  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#111111";
  ctx.font = "700 34px system-ui, -apple-system, 'PingFang SC', sans-serif";
  ctx.fillText(r.settled ? "收款收据" : "付款确认单", 60, 90);

  ctx.fillStyle = "#666666";
  ctx.font = "400 18px system-ui, -apple-system, 'PingFang SC', sans-serif";
  ctx.fillText(r.companyName, 60, 126);

  ctx.fillStyle = "#111111";
  ctx.font = "800 64px system-ui, -apple-system, 'PingFang SC', sans-serif";
  ctx.fillText(`¥${r.amount}`, 60, 216);

  ctx.strokeStyle = "#e5e5e5";
  ctx.beginPath();
  ctx.moveTo(60, 256);
  ctx.lineTo(W - 60, 256);
  ctx.stroke();

  const paidAt = r.paidAt ? new Date(r.paidAt) : new Date();
  const rows: Array<[string, string]> = [
    ["收款编号", r.orderNo ?? "-"],
    ["到账积分", `${r.credits} Credits`],
    ["支付方式", r.method],
    ["日期", paidAt.toLocaleString("zh-CN", { hour12: false })],
    ["状态", r.settled ? "已到账" : "核对中"],
  ];
  let y = 306;
  for (const [k, v] of rows) {
    ctx.fillStyle = "#888888";
    ctx.font = "400 20px system-ui, -apple-system, 'PingFang SC', sans-serif";
    ctx.fillText(k, 60, y);
    ctx.fillStyle = "#111111";
    ctx.font = "600 20px system-ui, -apple-system, 'PingFang SC', sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(v, W - 60, y);
    ctx.textAlign = "left";
    y += 52;
  }

  ctx.fillStyle = "#999999";
  ctx.font = "400 16px system-ui, -apple-system, 'PingFang SC', sans-serif";
  ctx.fillText("本收据由系统自动生成，如需发票请在站内联系客服。", 60, H - 48);
  return canvas;
}

async function downloadReceiptPdf(r: Receipt) {
  const canvas = drawReceipt(r);
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [1000, 620] });
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 1000, 620);
  pdf.save(`receipt-${r.orderNo ?? "mvstudio"}.pdf`);
}

export default function PaymentProofPanel(props: {
  orderNo: string;
  amount: number;
  credits: number;
  onRestart: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<"approved" | "review" | "rejected" | null>(null);
  const [credited, setCredited] = useState(0);

  const submitScreenshot = trpc.staticPay.submitScreenshot.useMutation();
  const receiptQuery = trpc.staticPay.receipt.useQuery(
    { orderNo: props.orderNo },
    { enabled: false, retry: false },
  );

  const pick = () => fileRef.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { base64, mimeType } = await fileToCompressedBase64(file);
      const res = await submitScreenshot.mutateAsync({ orderNo: props.orderNo, imageBase64: base64, mimeType });
      setVerdict(res.verdict);
      setCredited(res.credited);
      if (res.verdict === "approved") toast.success(res.message);
      else if (res.verdict === "rejected") toast.error(res.message);
      else toast.info(res.message);
    } catch (err: any) {
      toast.error(err?.message || "截图发送失败，请重试");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDownload = async () => {
    try {
      const data = receiptQuery.data ?? (await receiptQuery.refetch()).data;
      if (!data) throw new Error("收据暂时取不到");
      await downloadReceiptPdf(data as Receipt);
    } catch (err: any) {
      toast.error(err?.message || "收据下载失败，请稍后重试");
    }
  };

  const settled = verdict === "approved";

  return (
    <div className="bg-[#1A1A1D] rounded-2xl border border-white/10 p-8 flex flex-col items-center text-center">
      {settled ? (
        <CheckCircle size={56} className="text-green-400 mb-4" />
      ) : (
        <Clock size={56} className="text-[#FF6B35] mb-4" />
      )}
      <p className="text-xl font-bold text-white mb-1">
        {settled ? `已到账 ${credited} Credits` : "付款确认已提交"}
      </p>
      <p className="text-sm text-gray-400">上海德智熙人工智能科技有限公司</p>

      <div className="mt-4 w-full rounded-xl border border-white/10 bg-[#0A0A0C] px-4 py-3 text-left">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">收款编号</span>
          <span className="font-mono font-semibold text-white">{props.orderNo}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-gray-500">应付金额</span>
          <span className="font-semibold text-white">¥{props.amount}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-gray-500">到账积分</span>
          <span className="font-semibold text-[#FF6B35]">+{props.credits} Credits</span>
        </div>
      </div>

      {!settled && (
        <>
          <p className="mt-5 text-sm leading-relaxed text-gray-400">
            {verdict === "review"
              ? "截图已收到，我们正在核对，通常很快就到账。"
              : verdict === "rejected"
                ? "这张截图之前用过了，请选择本次付款的截图。"
                : "发送付款截图可立即到账；不发也可以，我们会人工核对。"}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <button
            onClick={pick}
            disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#FF6B35] py-3 text-base font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {busy ? "正在核对…" : verdict ? "重新发送付款截图" : "发送付款截图"}
          </button>
        </>
      )}

      <button
        onClick={handleDownload}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 py-3 text-sm font-semibold text-white/85 hover:border-white/30"
      >
        <Download size={15} />
        下载收据
      </button>

      <button onClick={props.onRestart} className="mt-4 text-sm text-gray-500 hover:text-gray-300">
        继续充值
      </button>
    </div>
  );
}
