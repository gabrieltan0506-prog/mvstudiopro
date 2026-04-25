import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2, CheckCircle, Coins, ChevronRight,
  Bolt, Zap, Flame, BarChart3, Smile,
} from "lucide-react";
import { CREDIT_TO_CNY } from "@shared/plans";
import { nanoid } from "nanoid";

type BillingInterval = "monthly" | "quarterly" | "yearly";
type PackId = "trial199" | "small" | "medium" | "large" | "mega";

const PACK_ORDER: PackId[] = ["trial199", "small", "medium", "large", "mega"];

// 定价基准：1 cr ≈ ¥0.65，每次完整分析约 50 cr
const PACK_META: Record<PackId, {
  credits: number; basePrice: number;
  icon: React.ReactNode; label: string;
  popular?: boolean; best?: boolean; trial?: boolean;
  hint?: string;
}> = {
  trial199: { credits: 60,  basePrice: 39,   icon: <Smile     size={28} className="text-emerald-400" />, label: "体验包",  trial: true, hint: "约可完成 1 次完整分析" },
  small:    { credits: 160, basePrice: 99,   icon: <Bolt      size={28} className="text-[#FF6B35]" />,   label: "基础包",  hint: "约可完成 3 次分析" },
  medium:   { credits: 360, basePrice: 218,  icon: <Zap       size={28} className="text-[#FF6B35]" />,   label: "进阶包",  popular: true, hint: "约可完成 7 次分析" },
  large:    { credits: 700, basePrice: 418,  icon: <Flame     size={28} className="text-[#FF6B35]" />,   label: "专业包",  best: true, hint: "约可完成 14 次分析" },
  mega:     { credits: 1500, basePrice: 868, icon: <BarChart3 size={28} className="text-[#FF6B35]" />,  label: "旗舰包",  hint: "约可完成 30 次分析" },
};

function calcPrice(packId: PackId, cycle: BillingInterval) {
  const m = PACK_META[packId];
  if (packId === "trial199") return { price: m.basePrice, credits: m.credits, discountText: "约 ¥0.60/积分" };
  if (cycle === "quarterly") return { price: Math.round(m.basePrice * 3 * 0.9),  credits: m.credits * 3,  discountText: "季度九折" };
  if (cycle === "yearly")    return { price: Math.round(m.basePrice * 12 * 0.8), credits: m.credits * 12, discountText: "年度八折" };
  return { price: m.basePrice, credits: m.credits, discountText: "" };
}

export default function Pricing() {
  const [interval, setInterval]     = useState<BillingInterval>("monthly");
  const [selected, setSelected]     = useState<PackId>("medium");
  const [note, setNote]             = useState("");
  const [submitted, setSubmitted]   = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data: subData } = trpc.stripe.getSubscription.useQuery(undefined, { retry: false });
  const credits = subData?.credits ?? { balance: 0 };

  const { price, credits: cr, discountText } = calcPrice(selected, interval);
  const meta = PACK_META[selected];

  const submitMutation = trpc.staticPay.submitConfirmation.useMutation();

  const handleConfirm = async (method: "wechat" | "alipay") => {
    setSubmitting(true);
    try {
      await submitMutation.mutateAsync({
        orderId: `PAY-${Date.now()}-${nanoid(6).toUpperCase()}`,
        packId: selected,
        method,
        amount: price,
        credits: cr,
        billingCycle: interval,
        transactionNote: note || undefined,
      });
      setSubmitted(true);
    } catch (err: any) {
      toast.error(err.message || "提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF] flex flex-col">
      {/* ── 顶部标题 ── */}
      <div className="px-6 pt-8 pb-3">
        <h1 className="text-3xl font-extrabold text-white">Credits 加值</h1>
        <p className="text-sm text-gray-400 mt-1">
          微信 / 支付宝扫码付款 · 约 ¥{CREDIT_TO_CNY.toFixed(2)}/积分 · 管理员 1-2 小时内审核到账
        </p>
      </div>

      {/* ── 余额快捷 ── */}
      {subData && (
        <Link href="/dashboard">
          <a className="flex justify-between items-center mx-6 mb-4 bg-[#1A1A1D] rounded-xl p-3.5 border border-white/10">
            <div className="flex items-center gap-2">
              <Coins size={16} className="text-[#FF6B35]" />
              <span className="text-sm text-white">当前余额</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-base font-bold text-[#FF6B35]">{credits.balance} Credits</span>
              <ChevronRight size={16} className="text-gray-500" />
            </div>
          </a>
        </Link>
      )}

      {/* ── 周期切换 ── */}
      <div className="flex mx-6 mb-5 bg-[#1A1A1D] rounded-lg p-1 gap-1">
        {(["monthly", "quarterly", "yearly"] as BillingInterval[]).map((cycle) => (
          <button
            key={cycle}
            onClick={() => { setInterval(cycle); setSubmitted(false); }}
            className={`flex-1 py-2 rounded-md text-sm font-bold transition-colors flex items-center justify-center gap-1 ${
              interval === cycle ? "bg-[#FF6B35] text-white" : "text-gray-400"
            }`}
          >
            {cycle === "monthly" ? "月付" : cycle === "quarterly" ? "季度" : "年付"}
            {cycle === "quarterly" && interval !== "quarterly" && (
              <span className="text-[9px] bg-orange-500/20 text-orange-400 rounded px-1">九折</span>
            )}
            {cycle === "yearly" && interval !== "yearly" && (
              <span className="text-[9px] bg-green-500/20 text-green-400 rounded px-1">八折</span>
            )}
          </button>
        ))}
      </div>

      {/* ── 主体：左侧套餐 + 右侧付款 ── */}
      <div className="flex-1 px-6 pb-12 flex flex-col lg:flex-row gap-5">

        {/* 左：套餐卡片 */}
        <div className="lg:w-[52%]">
          <div className="grid grid-cols-2 gap-3">
            {PACK_ORDER.map((packId) => {
              const m = PACK_META[packId];
              const { price: p, credits: c, discountText: dt } = calcPrice(packId, interval);
              const active = selected === packId;
              return (
                <button
                  key={packId}
                  onClick={() => { setSelected(packId); setSubmitted(false); }}
                  className={`relative flex flex-col items-center justify-center rounded-2xl text-center transition-all duration-150 border-2 ${
                    active
                      ? "border-[#FF6B35] bg-[#FF6B35]/10 scale-[1.02]"
                      : m.trial
                      ? "border-emerald-500/40 bg-[#1A1A1D] hover:border-emerald-400/60"
                      : "border-white/10 bg-[#1A1A1D] hover:border-[#FF6B35]/50"
                  }`}
                  style={{ aspectRatio: "1 / 1" }}
                >
                  {m.trial && (
                    <span className="absolute -top-3 bg-emerald-500 text-white text-[11px] font-bold rounded-full px-2.5 py-0.5">试用</span>
                  )}
                  {m.popular && (
                    <span className="absolute -top-3 bg-[#FF6B35] text-white text-[11px] font-bold rounded-full px-2.5 py-0.5">热门</span>
                  )}
                  {m.best && (
                    <span className="absolute -top-3 bg-green-500 text-white text-[11px] font-bold rounded-full px-2.5 py-0.5">最超值</span>
                  )}
                  {/* Credits 数字：11vw ≈ 每张卡宽度的 80% */}
                  <span
                    className="font-black text-white leading-none"
                    style={{ fontSize: "11vw" }}
                  >
                    {c}
                  </span>
                  <span
                    className="font-bold text-gray-400 leading-tight mt-0.5"
                    style={{ fontSize: "3vw" }}
                  >
                    Credits
                  </span>
                  {/* 价格：字缩小一半 */}
                  <span
                    className="font-extrabold text-white leading-none mt-2"
                    style={{ fontSize: "3.2vw" }}
                  >
                    ¥{Number.isInteger(p) ? p : p.toFixed(1)}
                  </span>
                  <span
                    className="font-medium mt-1"
                    style={{ fontSize: "1.8vw", color: dt ? "#4ade80" : "#6b7280" }}
                  >
                    {dt || m.label}
                  </span>
                  {m.hint && !dt && (
                    <span className="mt-0.5 text-gray-500" style={{ fontSize: "1.5vw" }}>
                      {m.hint}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 右：付款面板（QR 直接展示，无需点击） */}
        <div className="lg:w-[48%] lg:sticky lg:top-6 lg:self-start">
          {submitted ? (
            <div className="bg-[#1A1A1D] rounded-2xl border border-white/10 p-8 flex flex-col items-center text-center">
              <CheckCircle size={56} className="text-green-400 mb-4" />
              <p className="text-xl font-bold text-white mb-1">付款确认已提交</p>
              <p className="text-gray-400 text-sm mb-1">管理员将在 1-2 小时内审核充值</p>
              <p className="text-gray-400 text-sm font-semibold">上海德智熙人工智能科技有限公司</p>
              <p className="text-green-400 text-base font-bold mt-2">充值成功后 +{cr} Credits</p>
              <button
                onClick={() => setSubmitted(false)}
                className="mt-6 w-full bg-[#FF6B35] text-white py-3 rounded-xl font-bold text-base"
              >
                继续充值
              </button>
            </div>
          ) : (
            <div className="bg-[#1A1A1D] rounded-2xl border border-white/10 overflow-hidden">
              {/* 订单摘要 */}
              <div className="px-5 pt-5 pb-4 border-b border-white/8">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-base font-bold text-white">{meta.label}</span>
                  {discountText && (
                    <span className="text-xs text-green-400 bg-green-400/10 rounded-full px-2 py-0.5">{discountText}</span>
                  )}
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-gray-400 text-sm">到账积分</span>
                  <span className="text-xl font-extrabold text-[#FF6B35]">+{cr} Credits</span>
                </div>
                <div className="flex items-baseline justify-between mt-0.5">
                  <span className="text-gray-400 text-sm">应付金额</span>
                  <span className="text-3xl font-black text-white">¥{Number.isInteger(price) ? price : price.toFixed(1)}</span>
                </div>
              </div>

              {/* 双二维码：双列大图 240px */}
              <div className="px-5 py-4">
                <p className="text-sm text-gray-400 mb-3 text-center">扫码后点「我已付款」，1-2 小时到账</p>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* 微信 */}
                  <div className="flex flex-col items-center bg-[#0A0A0C] rounded-xl p-3 gap-2 border border-white/8">
                    <img
                      src="/assets/payment/wechat-collect.jpg"
                      alt="微信收款码"
                      style={{ width: "100%", aspectRatio: "1/1", objectFit: "contain", borderRadius: 8, background: "#fff" }}
                      onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
                    />
                    <span className="text-sm font-bold text-white">微信支付</span>
                    <button
                      disabled={submitting}
                      onClick={() => handleConfirm("wechat")}
                      className="w-full bg-[#07C160] text-white text-sm font-bold py-2.5 rounded-xl disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                      我已付款
                    </button>
                  </div>

                  {/* 支付宝 */}
                  <div className="flex flex-col items-center bg-[#0A0A0C] rounded-xl p-3 gap-2 border border-white/8">
                    <img
                      src="/assets/payment/alipay-collect.jpg"
                      alt="支付宝收款码"
                      style={{ width: "100%", aspectRatio: "1/1", objectFit: "contain", borderRadius: 8, background: "#fff" }}
                      onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
                    />
                    <span className="text-sm font-bold text-white">支付宝</span>
                    <button
                      disabled={submitting}
                      onClick={() => handleConfirm("alipay")}
                      className="w-full bg-[#1677FF] text-white text-sm font-bold py-2.5 rounded-xl disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                      我已付款
                    </button>
                  </div>
                </div>

                {/* 备注 */}
                <input
                  type="text"
                  placeholder="付款备注（可选，方便核对流水号）"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full bg-[#0A0A0C] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-[#FF6B35]/50"
                />
                <p className="text-center text-xs text-gray-500 mt-2">
                  上海德智熙人工智能科技有限公司 · 1-2 小时内到账
                </p>
              </div>
            </div>
          )}

          {/* 充值记录 */}
          <Link href="/dashboard">
            <a className="flex items-center justify-between mt-3 p-4 bg-[#1A1A1D] rounded-xl border border-white/10">
              <span className="text-sm text-gray-300">查看充值 & 消耗记录</span>
              <ChevronRight size={16} className="text-gray-500" />
            </a>
          </Link>
        </div>
      </div>
    </div>
  );
}
