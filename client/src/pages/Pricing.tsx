import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2, CheckCircle, Coins, ChevronRight,
  Bolt, Zap, Flame, BarChart3, Smile, Box, Film, Video,
  TrendingUp, Workflow, X, QrCode,
} from "lucide-react";

type BillingInterval = "monthly" | "quarterly" | "yearly";
type PackId = "trial199" | "small" | "medium" | "large" | "mega";
type PayMethod = "wechat" | "alipay";

const PACK_ORDER: PackId[] = ["trial199", "small", "medium", "large", "mega"];

const PACK_META: Record<PackId, { credits: number; basePrice: number; icon: React.ReactNode; label: string; popular?: boolean; best?: boolean; trial?: boolean }> = {
  trial199: { credits: 33, basePrice: 19.9, icon: <Smile className="h-7 w-7 text-emerald-400" />, label: "试用包", trial: true },
  small:  { credits: 50,  basePrice: 35,  icon: <Bolt className="h-7 w-7 text-[#FF6B35]" />, label: "入门包" },
  medium: { credits: 100, basePrice: 68,  icon: <Zap  className="h-7 w-7 text-[#FF6B35]" />, label: "高端包", popular: true },
  large:  { credits: 250, basePrice: 168, icon: <Flame className="h-7 w-7 text-[#FF6B35]" />, label: "超值包", best: true },
  mega:   { credits: 500, basePrice: 328, icon: <BarChart3 className="h-7 w-7 text-[#FF6B35]" />, label: "专业包" },
};

function calcPrice(packId: PackId, cycle: BillingInterval): { price: number; credits: number; discountText: string } {
  const m = PACK_META[packId];
  if (packId === "trial199") {
    return { price: m.basePrice, credits: m.credits, discountText: "约 ¥0.6/积分" };
  }
  if (cycle === "quarterly") return { price: Math.round(m.basePrice * 3 * 0.9), credits: m.credits * 3, discountText: "季度九折" };
  if (cycle === "yearly")    return { price: Math.round(m.basePrice * 12 * 0.8), credits: m.credits * 12, discountText: "年度八折" };
  return { price: m.basePrice, credits: m.credits, discountText: "" };
}

interface PaymentModalProps {
  packId: PackId;
  method: PayMethod;
  cycle: BillingInterval;
  onClose: () => void;
}

function PaymentModal({ packId, method, cycle, onClose }: PaymentModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { price, credits, discountText } = calcPrice(packId, cycle);
  const meta = PACK_META[packId];

  const { data: payInfo } = trpc.staticPay.getPaymentInfo.useQuery({
    packId, method, billingCycle: cycle,
  });

  const submitMutation = trpc.staticPay.submitConfirmation.useMutation();

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await submitMutation.mutateAsync({
        orderId: payInfo?.orderId ?? `PAY-${Date.now()}`,
        packId, method,
        amount: price,
        credits,
        billingCycle: cycle,
        transactionNote: note || undefined,
      });
      setConfirmed(true);
    } catch (err: any) {
      toast.error(err.message || "提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center">
      <div className="bg-[#1A1A1D] rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-6 border border-white/10">
        {/* Header */}
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-lg font-bold text-white">
            {method === "wechat" ? "微信扫码付款" : "支付宝扫码付款"}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {confirmed ? (
          /* ── 已提交确认 ── */
          <div className="text-center py-4">
            <CheckCircle className="h-14 w-14 text-green-400 mx-auto mb-3" />
            <p className="text-white font-semibold text-lg mb-1">付款确认已提交</p>
            <p className="text-gray-400 text-sm mb-1">管理员将在 1-2 小时内审核</p>
            <p className="text-gray-400 text-sm font-bold">
              上海德智熙人工智能科技有限公司
            </p>
            <p className="text-green-400 text-sm mt-1">充值成功后将显示 +{credits} 积分</p>
            <button
              onClick={onClose}
              className="mt-5 w-full bg-[#FF6B35] text-white py-3 rounded-xl font-semibold"
            >
              知道了
            </button>
          </div>
        ) : (
          <>
            {/* Order summary */}
            <div className="bg-[#0A0A0C] rounded-xl p-4 mb-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400">{meta.label} ({meta.credits} cr{cycle !== "monthly" ? `×${cycle === "quarterly" ? 3 : 12}` : ""})</span>
                {discountText && (
                  <span className="text-green-400 text-xs bg-green-400/10 px-2 py-0.5 rounded-full">{discountText}</span>
                )}
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-gray-400 text-sm">应付金额</span>
                <span className="text-2xl font-extrabold text-white">¥{price}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-400 text-sm">到账积分</span>
                <span className="text-[#FF6B35] font-bold">+{credits} Credits</span>
              </div>
            </div>

            {/* QR Code image */}
            <div className="flex flex-col items-center bg-white rounded-xl p-4 mb-4">
              {payInfo?.qrImageUrl ? (
                <img
                  src={payInfo.qrImageUrl}
                  alt={method === "wechat" ? "微信收款码" : "支付宝收款码"}
                  className="w-44 h-44 object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="w-44 h-44 flex flex-col items-center justify-center text-gray-400">
                  <QrCode className="h-12 w-12 mb-2" />
                  <span className="text-xs text-center">收款码图片<br />即将上线</span>
                </div>
              )}
              <p className="text-gray-500 text-xs mt-2 text-center">
                {method === "wechat" ? "微信扫码付款" : "支付宝扫码付款"}<br />
                <span className="font-medium text-gray-700">上海德智熙人工智能科技有限公司</span>
              </p>
            </div>

            {/* Transaction note */}
            <div className="mb-4">
              <label className="text-xs text-gray-400 block mb-1">
                付款备注（可选，方便核对）
              </label>
              <input
                type="text"
                placeholder="例如：付款截图末4位流水号"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full bg-[#0A0A0C] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-[#FF6B35]/50"
              />
            </div>

            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="w-full bg-[#FF6B35] text-white py-3.5 rounded-xl font-bold text-base disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              我已完成付款
            </button>
            <p className="text-center text-xs text-gray-500 mt-2">
              点击后管理员将核实到账，通常 1-2 小时内充值
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function Pricing() {
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [payModal, setPayModal] = useState<{ packId: PackId; method: PayMethod } | null>(null);
  const [selectingMethod, setSelectingMethod] = useState<PackId | null>(null);

  const { data: subData } = trpc.stripe.getSubscription.useQuery(undefined, { retry: false });
  const credits = subData?.credits ?? { balance: 0 };

  const openMethodPicker = (packId: PackId) => setSelectingMethod(packId);
  const selectMethod = (method: PayMethod) => {
    if (selectingMethod) {
      setPayModal({ packId: selectingMethod, method });
      setSelectingMethod(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="overflow-y-auto pb-16">
        {/* Header */}
        <div className="px-6 pt-8 pb-4">
          <h1 className="text-3xl font-extrabold text-white">Credits 加值</h1>
          <p className="text-base text-gray-400 mt-1">微信 / 支付宝扫码；常规包约 ¥0.65–0.70/积分，¥19.9 试用包约 ¥0.60/积分</p>
        </div>

        {/* Credits Balance */}
        {subData && (
          <Link href="/dashboard">
            <a className="flex justify-between items-center mx-6 mb-4 bg-[#1A1A1D] rounded-xl p-4 border border-white/10 cursor-pointer">
              <div className="flex items-center gap-2">
                <Coins className="h-5 w-5 text-[#FF6B35]" />
                <span className="text-sm text-white">当前 Credits 余额</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-lg font-bold text-[#FF6B35]">{credits.balance}</span>
                <ChevronRight className="h-5 w-5 text-gray-500" />
              </div>
            </a>
          </Link>
        )}

        {/* Billing Toggle: monthly / quarterly / yearly */}
        <div className="flex mx-6 mb-5 bg-[#1A1A1D] rounded-lg p-1">
          {(["monthly", "quarterly", "yearly"] as BillingInterval[]).map((cycle) => (
            <button
              key={cycle}
              onClick={() => setInterval(cycle)}
              className={`flex-1 py-2 rounded-md flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors ${
                interval === cycle ? "bg-[#FF6B35] text-white" : "text-gray-400"
              }`}
            >
              {cycle === "monthly" ? "月付" : cycle === "quarterly" ? "季度" : "年付"}
              {cycle === "quarterly" && interval !== "quarterly" && (
                <span className="bg-orange-500/20 text-orange-400 text-[9px] font-bold rounded px-1">九折</span>
              )}
              {cycle === "yearly" && interval !== "yearly" && (
                <span className="bg-green-500/20 text-green-400 text-[9px] font-bold rounded px-1">八折</span>
              )}
            </button>
          ))}
        </div>

        {/* Credits Packs */}
        <div className="px-6 mb-8">
          <div className="grid grid-cols-2 gap-3">
            {PACK_ORDER.map((packId) => {
              const meta = PACK_META[packId];
              const { price, credits: cr, discountText } = calcPrice(packId, interval);
              return (
                <button
                  key={packId}
                  onClick={() => openMethodPicker(packId)}
                  className={`relative flex flex-col items-center justify-center bg-[#1A1A1D] rounded-xl p-4 text-center transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] border ${
                    meta.popular ? "border-2 border-[#FF6B35]" : meta.trial ? "border-2 border-emerald-500/50" : "border-white/10 hover:border-[#FF6B35]/50"
                  }`}
                >
                  {meta.trial && (
                    <div className="absolute -top-2.5 bg-emerald-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5">试用</div>
                  )}
                  {meta.popular && (
                    <div className="absolute -top-2.5 bg-[#FF6B35] text-white text-[10px] font-bold rounded-full px-2 py-0.5">热门</div>
                  )}
                  {meta.best && (
                    <div className="absolute -top-2.5 bg-green-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5">最超值</div>
                  )}
                  {meta.icon}
                  <span className="text-2xl font-extrabold text-white mt-2">{cr}</span>
                  <span className="text-xs text-gray-400">Credits</span>
                  <span className="text-lg font-bold text-white mt-2">¥{Number.isInteger(price) ? price : price.toFixed(1)}</span>
                  {discountText ? (
                    <span className="text-[10px] text-green-400 mt-0.5">{discountText}</span>
                  ) : (
                    <span className="text-[10px] text-gray-500 mt-0.5">{meta.label}</span>
                  )}
                  <span className="text-sm font-semibold text-[#FF6B35] mt-2">立即购买</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Feature costs for beta products */}
        <div className="px-6 mb-8">
          <h3 className="text-xl font-bold text-white mb-3">内测功能消耗说明</h3>
          <div className="bg-[#1A1A1D] border border-white/10 rounded-xl divide-y divide-white/10">
            <CostRow icon={<TrendingUp className="h-5 w-5 text-[#FF6B35]" />} label="成长营 GROWTH 分析" cost={40} approxRmb="≈¥28" badge="NEW" />
            <CostRow icon={<Film className="h-5 w-5 text-[#FF6B35]" />} label="成长营 REMIX 二创" cost={50} approxRmb="≈¥35" badge="NEW" />
            <CostRow icon={<BarChart3 className="h-5 w-5 text-[#FF6B35]" />} label="平台趋势分析" cost={30} approxRmb="≈¥21" badge="NEW" />
            <CostRow icon={<Workflow className="h-5 w-5 text-[#FF6B35]" />} label="节点工作流" cost={20} approxRmb="≈¥14" badge="NEW" />
            <CostRow icon={<BarChart3 className="h-5 w-5 text-gray-500" />} label="视频 PK 评分" cost={8} approxRmb="≈¥5.6" />
            <CostRow icon={<Smile className="h-5 w-5 text-gray-500" />} label="虚拟偶像生成" cost={3} approxRmb="≈¥2.1" />
            <CostRow icon={<Box className="h-5 w-5 text-gray-500" />} label="偶像转 3D" cost={10} approxRmb="≈¥7" />
            <CostRow icon={<Video className="h-5 w-5 text-gray-500" />} label="视频生成" cost={25} approxRmb="≈¥17.5" />
          </div>
        </div>

        {/* Payment history shortcut */}
        <Link href="/dashboard">
          <a className="flex items-center justify-between mx-6 mb-8 p-4 bg-[#1A1A1D] rounded-xl border border-white/10">
            <span className="text-sm text-gray-300">查看充值 & 消耗记录</span>
            <ChevronRight className="h-5 w-5 text-gray-500" />
          </a>
        </Link>
      </div>

      {/* Payment method picker */}
      {selectingMethod && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center">
          <div className="bg-[#1A1A1D] rounded-t-2xl w-full max-w-sm p-6 border border-white/10">
            <h3 className="text-lg font-bold text-white mb-4">选择付款方式</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => selectMethod("wechat")}
                className="flex flex-col items-center gap-2 bg-[#07C160]/10 border border-[#07C160]/30 rounded-xl p-4 hover:bg-[#07C160]/20 transition-colors"
              >
                <span className="text-3xl">💚</span>
                <span className="text-sm font-semibold text-white">微信支付</span>
              </button>
              <button
                onClick={() => selectMethod("alipay")}
                className="flex flex-col items-center gap-2 bg-[#1677FF]/10 border border-[#1677FF]/30 rounded-xl p-4 hover:bg-[#1677FF]/20 transition-colors"
              >
                <span className="text-3xl">💙</span>
                <span className="text-sm font-semibold text-white">支付宝</span>
              </button>
            </div>
            <button
              onClick={() => setSelectingMethod(null)}
              className="w-full mt-3 py-3 text-sm text-gray-400 hover:text-white"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Payment QR modal */}
      {payModal && (
        <PaymentModal
          packId={payModal.packId}
          method={payModal.method}
          cycle={interval}
          onClose={() => setPayModal(null)}
        />
      )}
    </div>
  );
}

function CostRow({
  icon, label, cost, approxRmb, badge,
}: {
  icon: React.ReactNode;
  label: string;
  cost: number;
  approxRmb?: string;
  badge?: string;
}) {
  return (
    <div className="flex justify-between items-center p-3.5">
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="text-sm text-gray-200">{label}</span>
        {badge && (
          <div className="bg-[#FF6B35] rounded text-white text-[9px] font-extrabold px-1.5 py-0.5">{badge}</div>
        )}
      </div>
      <div className="text-right">
        <span className="text-sm font-semibold text-[#FF6B35]">{cost} cr</span>
        {approxRmb && <span className="text-xs text-gray-500 ml-1">{approxRmb}</span>}
      </div>
    </div>
  );
}
