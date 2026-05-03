
import { useState, useRef, ChangeEvent } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Camera, Copy } from "lucide-react";

// Helper to parse search params, similar to useLocalSearchParams
const useSearchParams = () => {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  return Object.fromEntries(searchParams.entries()) as {
    orderId: string;
    transactionId: string;
    qrCodeUrl: string;
    amount: string;
    currency: string;
    paymentMethod: string;
    recipientName: string;
    packageName: string;
  };
};

export default function PaymentQRCode() {
  const [, navigate] = useLocation();
  const params = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const submitScreenshotMutation = trpc.payment.submitPaymentScreenshot.useMutation();

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = (e.target?.result as string).split(",")[1];
        setScreenshot(base64);
        setScreenshotPreview(URL.createObjectURL(file));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!screenshot) {
      toast.warning("请先上传支付截屏");
      return;
    }

    setIsUploading(true);

    try {
      const result = await submitScreenshotMutation.mutateAsync({
        orderId: params.orderId,
        screenshotBase64: screenshot,
      });

      if (result.success) {
        toast.success(result.message, {
          onAutoClose: () => navigate("/", { replace: true }),
        });
      } else {
        toast.error(result.message, {
          description: result.verification?.requiresManualReview
            ? "您的提交将进入人工审核流程。"
            : "请检查您的截屏或稍后重试。",
          onAutoClose: () => {
            if (result.verification?.requiresManualReview) {
              navigate("/", { replace: true });
            } else {
              setScreenshot(null);
              setScreenshotPreview(null);
            }
          },
        });
      }
    } catch (error: any) {
      toast.error(error.message || "提交失败，请稍后再试");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyOrderId = async () => {
    await navigator.clipboard.writeText(params.orderId);
    toast.success("订单号已复制到剪贴板");
  };

  const paymentMethodName = params.paymentMethod === "wechat" ? "微信支付" : "支付宝";
  const qrCodePath = `/payment/${params.paymentMethod}-qr.jpg`;

  return (
    <div className="min-h-dvh bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="overflow-y-auto pb-10">
        <div className="px-6 pt-8 pb-6">
          <button onClick={() => window.history.back()} className="mb-4 text-blue-400 text-base">
            ← 返回
          </button>
          <h1 className="text-3xl font-bold text-[#F7F4EF] mb-2">{paymentMethodName}</h1>
          <p className="text-base text-gray-400">请使用{paymentMethodName}扫码支付</p>
        </div>

        <div className="mx-6 mb-6 bg-[#1C1C1E] rounded-2xl p-6 border border-white/10">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm text-gray-400">套餐名称</span>
            <span className="text-base font-semibold text-[#F7F4EF]">{params.packageName}</span>
          </div>
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm text-gray-400">支付金额</span>
            <span className="text-2xl font-bold text-blue-400">
              ${params.amount} {params.currency}
            </span>
          </div>
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm text-gray-400">收款人</span>
            <span className="text-base font-semibold text-[#F7F4EF]">{params.recipientName}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">订单号</span>
            <button onClick={handleCopyOrderId} className="flex items-center space-x-2 text-blue-400">
              <span className="text-xs font-mono text-[#F7F4EF]">{params.orderId}</span>
              <Copy className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center mb-6">
          <div className="bg-white p-2 rounded-2xl shadow-lg">
            <img src={qrCodePath} alt={`${paymentMethodName} QR Code`} className="w-72 h-72 object-contain" />
          </div>
          <p className="text-sm text-gray-400 mt-4 text-center px-6">
            请使用{paymentMethodName} App 扫描上方二维码完成支付
          </p>
        </div>

        <div className="mx-6 mb-6 bg-blue-500/10 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-[#F7F4EF] mb-3">📝 支付步骤</h2>
          <div className="space-y-3">
            <div className="flex"><span className="text-blue-400 font-bold mr-2">1.</span><p className="text-sm text-[#F7F4EF] flex-1">使用{paymentMethodName} App 扫描上方二维码</p></div>
            <div className="flex"><span className="text-blue-400 font-bold mr-2">2.</span><p className="text-sm text-[#F7F4EF] flex-1">确认金额为 ${params.amount} {params.currency}，收款人为「{params.recipientName}」</p></div>
            <div className="flex"><span className="text-blue-400 font-bold mr-2">3.</span><p className="text-sm text-[#F7F4EF] flex-1">完成支付后，截屏支付成功页面（需包含订单号、金额、时间）</p></div>
            <div className="flex"><span className="text-blue-400 font-bold mr-2">4.</span><p className="text-sm text-[#F7F4EF] flex-1">上传支付截屏，AI 将自动审核并开通功能</p></div>
          </div>
        </div>

        <div className="mx-6 mb-6">
          <h2 className="text-lg font-bold text-[#F7F4EF] mb-3">📸 上传支付截屏</h2>
          <input type="file" accept="image/png, image/jpeg" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
          {screenshotPreview ? (
            <div className="bg-[#1C1C1E] rounded-2xl p-4 border border-white/10 mb-4">
              <img src={screenshotPreview} alt="Screenshot preview" className="w-full h-auto max-h-80 object-contain rounded-lg" />
              <button onClick={() => { setScreenshot(null); setScreenshotPreview(null); if(fileInputRef.current) fileInputRef.current.value = ''; }} className="mt-4 w-full bg-red-500/10 rounded-full py-2 text-center text-red-400 font-semibold">
                重新选择
              </button>
            </div>
          ) : (
            <button onClick={() => fileInputRef.current?.click()} className="w-full bg-[#1C1C1E] rounded-2xl p-8 border-2 border-dashed border-white/20 flex flex-col items-center justify-center">
              <Camera className="h-12 w-12 text-gray-500 mb-3" />
              <span className="text-base font-semibold text-[#F7F4EF] mb-2">点击上传截屏</span>
              <span className="text-sm text-gray-400 text-center">支持 JPG、PNG 格式<br/>请确保截屏清晰完整</span>
            </button>
          )}

          <button onClick={handleSubmit} disabled={!screenshot || isUploading} className="w-full rounded-full py-4 text-lg font-semibold transition-colors disabled:bg-gray-600 disabled:text-gray-400 bg-blue-500 text-white">
            {isUploading ? (
              <div className="flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span>AI 审核中...</span>
              </div>
            ) : (
              <span>{screenshot ? "提交审核" : "请先上传截屏"}</span>
            )}
          </button>
        </div>

        <div className="mx-6 bg-[#1C1C1E] rounded-2xl p-6 border border-white/10">
          <h2 className="text-lg font-bold text-[#F7F4EF] mb-3">🤖 AI 自动审核</h2>
          <div className="space-y-2">
            <div className="flex items-center"><span className="text-green-500 mr-2">✓</span><p className="text-sm text-gray-400">自动识别订单号和金额</p></div>
            <div className="flex items-center"><span className="text-green-500 mr-2">✓</span><p className="text-sm text-gray-400">验证支付时间和收款人</p></div>
            <div className="flex items-center"><span className="text-green-500 mr-2">✓</span><p className="text-sm text-gray-400">通常 1 分钟内完成审核</p></div>
            <div className="flex items-center"><span className="text-yellow-500 mr-2">⚠</span><p className="text-sm text-gray-400">如 AI 无法确定，将转人工审核（1-2 小时）</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}
