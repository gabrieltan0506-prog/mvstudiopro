
import { useState, useRef } from "react";
import { useLocation, Link } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Lock, ArrowLeft, Image as ImageIcon, Camera, X, Loader2, Info } from "lucide-react";

const PACKAGE_OPTIONS = [
  { value: "basic", label: "基础版", price: "¥86/4次" },
  { value: "pro", label: "专业版", price: "¥108/2次" },
  { value: "enterprise", label: "企业版", price: "¥143/月" },
];

const PAYMENT_METHODS = [
  { value: "wechat", label: "微信支付" },
  { value: "alipay", label: "支付宝" },
  { value: "bank_transfer", label: "银行转帐" },
];

export default function SubmitPaymentPage() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [packageType, setPackageType] = useState("basic");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("wechat");
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submitPaymentMutation = trpc.paymentSubmission.submit.useMutation();
  const uploadScreenshotMutation = trpc.paymentSubmission.uploadScreenshot.useMutation();

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF] flex flex-col items-center justify-center p-5">
        <Lock size={64} className="text-white/30" />
        <h1 className="text-2xl font-semibold mt-4 mb-2 text-white">请先登录</h1>
        <p className="text-base text-white/50 mb-6">您需要登录才能提交付款截屏</p>
        <Link href="/login">
          <button className="bg-blue-600 text-white px-8 py-3 rounded-xl text-base font-semibold hover:bg-blue-700 transition-colors">
            前往登录
          </button>
        </Link>
      </div>
    );
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setScreenshotUri(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!amount || !screenshotUri) {
      toast.error("数据不完整", { description: "请填写付款金额并上传付款截屏" });
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("金额错误", { description: "请输入有效的付款金额" });
      return;
    }

    setIsSubmitting(true);

    try {
      // The screenshotUri is already a base64 data URL from FileReader
      const base64Data = screenshotUri.split(",")[1];
      const mimeType = screenshotUri.match(/data:(.*);base64,/)?.[1] || "image/jpeg";

      const uploadResult = await uploadScreenshotMutation.mutateAsync({
        imageBase64: base64Data,
        mimeType,
      });

      await submitPaymentMutation.mutateAsync({
        packageType,
        amount: amountNum.toString(),
        paymentMethod,
        screenshotUrl: uploadResult.url,
      });

      toast.success("提交成功", {
        description: "您的付款截屏已提交，管理员将在 24 小时内审核。审核通过后，您的帐号将自动开通对应的套餐权限。",
        onAutoClose: () => window.history.back(),
      });

    } catch (error) {
      console.error("提交付款失败:", error);
      toast.error("提交失败", { description: "提交付款截屏时发生错误，请稍后再试" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="overflow-y-auto p-5 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => window.history.back()} className="p-2">
            <ArrowLeft size={24} className="text-white" />
          </button>
          <h1 className="text-xl font-semibold text-white">提交付款截屏</h1>
          <div className="w-10" />
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-base font-semibold text-white">选择套餐</p>
            <div className="grid grid-cols-3 gap-3">
              {PACKAGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={`flex flex-col items-center p-4 rounded-xl border-2 transition-colors ${packageType === option.value ? 'border-blue-600 bg-blue-600/20' : 'border-white/10'}`}
                  onClick={() => setPackageType(option.value)}
                >
                  <span className="text-base font-semibold text-white">{option.label}</span>
                  <span className="text-sm text-white/50 mt-1">{option.price}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label htmlFor="amount" className="text-base font-semibold text-white">付款金额 (CNY)</label>
            <input
              id="amount"
              type="number"
              className="w-full h-12 bg-black/20 border border-white/10 rounded-xl px-4 text-white text-base placeholder:text-white/30 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="请输入付款金额"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <p className="text-base font-semibold text-white">付款方式</p>
            <div className="grid grid-cols-3 gap-3">
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method.value}
                  className={`h-12 rounded-xl border-2 transition-colors ${paymentMethod === method.value ? 'border-blue-600 bg-blue-600/20' : 'border-white/10'}`}
                  onClick={() => setPaymentMethod(method.value)}
                >
                  <span className="text-sm font-medium text-white">{method.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-base font-semibold text-white">付款截屏</p>
            {screenshotUri ? (
              <div className="relative rounded-xl overflow-hidden">
                <img src={screenshotUri} alt="付款截屏预览" className="w-full h-auto max-h-80 object-contain" />
                <button
                  className="absolute top-3 right-3 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center hover:bg-red-700"
                  onClick={() => {
                    setScreenshotUri(null);
                    if(fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  <X size={20} className="text-white" />
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                  id="screenshot-upload"
                />
                <label
                  htmlFor="screenshot-upload"
                  className="w-full flex flex-col items-center justify-center gap-2 p-8 rounded-xl border-2 border-dashed border-white/20 cursor-pointer hover:bg-white/5 transition-colors"
                >
                  <ImageIcon size={32} className="text-blue-500" />
                  <span className="text-sm font-medium text-white">点击上传或拖拽图片</span>
                </label>
              </div>
            )}
          </div>

          <button
            className="w-full h-14 bg-blue-600 rounded-xl flex items-center justify-center text-lg font-semibold text-white hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader2 className="animate-spin" /> : "提交审核"}
          </button>

          <div className="flex items-start gap-3 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10">
            <Info size={20} className="text-yellow-400 mt-0.5 shrink-0" />
            <p className="flex-1 text-sm text-white/80 leading-relaxed">
              提交后，管理员将在 24 小时内审核您的付款。审核通过后，系统将自动开通对应的套餐权限。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
