import { useLocation, Link } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function PaymentMethod() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const packageId = params.get("package") || "";

  const [selectedMethod, setSelectedMethod] = useState<"stripe" | "wechat" | "alipay" | null>(null);

  // Fetch payment packages
  const { data: packages } = trpc.payment.getPaymentPackages.useQuery();
  const createQRCodePayment = trpc.payment.createQRCodePayment.useMutation();

  const currentPackage = packages?.find((pkg: any) => pkg.id === packageId);

  const handleSelectMethod = async (method: "stripe" | "wechat" | "alipay") => {
    setSelectedMethod(method);

    if (method === "stripe") {
      navigate(`/payment-stripe?package=${packageId}`);
    } else {
      try {
        const result = await createQRCodePayment.mutateAsync({
          packageType: packageId as any,
          paymentMethod: method,
        });

        const searchParams = new URLSearchParams({
          orderId: result.orderId,
          transactionId: result.transactionId.toString(),
          qrCodeUrl: result.qrCodeUrl,
          amount: result.packageInfo.price.toString(),
          currency: result.packageInfo.currency,
          paymentMethod: result.paymentMethod,
          recipientName: result.recipientName,
          packageName: result.packageInfo.name,
        });
        navigate(`/payment-qrcode?${searchParams.toString()}`);
      } catch (error: any) {
        toast(error.message || "创建订单失败");
      }
    }
  };

  if (!currentPackage) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="flex-1 items-center justify-center p-8">
          <span className="text-muted-foreground">套餐不存在或正在加载...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-md mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">选择支付方式</h1>
        <p className="text-muted-foreground mb-8">
          套餐：{(currentPackage as any).name} - ¥{(currentPackage as any).price}
        </p>

        <div className="space-y-4">
          <button
            onClick={() => handleSelectMethod("stripe")}
            className={`w-full p-4 rounded-xl border transition-colors ${
              selectedMethod === "stripe" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">💳</span>
              <div className="text-left">
                <p className="font-semibold">Stripe 信用卡</p>
                <p className="text-sm text-muted-foreground">Visa / Mastercard / AmEx</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => handleSelectMethod("wechat")}
            className={`w-full p-4 rounded-xl border transition-colors ${
              selectedMethod === "wechat" ? "border-green-500 bg-green-500/10" : "border-border hover:border-green-500/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">💬</span>
              <div className="text-left">
                <p className="font-semibold">微信支付</p>
                <p className="text-sm text-muted-foreground">扫码支付</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => handleSelectMethod("alipay")}
            className={`w-full p-4 rounded-xl border transition-colors ${
              selectedMethod === "alipay" ? "border-blue-500 bg-blue-500/10" : "border-border hover:border-blue-500/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔵</span>
              <div className="text-left">
                <p className="font-semibold">支付宝</p>
                <p className="text-sm text-muted-foreground">扫码支付</p>
              </div>
            </div>
          </button>
        </div>

        <Link href="/pricing">
          <button className="mt-6 w-full text-center text-muted-foreground hover:text-foreground transition-colors">
            返回定价页面
          </button>
        </Link>
      </div>
    </div>
  );
}
