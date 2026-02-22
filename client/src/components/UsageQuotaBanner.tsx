import { Infinity, AlertCircle, Info, Loader2 } from "lucide-react";
import { useLocation } from "wouter";

export interface UsageQuotaBannerProps {
  /**
   * Feature type for usage tracking
   */
  featureType: "avatar" | "analysis" | "storyboard";
  /**
   * Current usage count (how many times used)
   */
  currentCount: number;
  /**
   * Free tier limit (how many times free). -1 means unlimited (admin/subscriber).
   */
  freeLimit: number;
  /**
   * Loading state
   */
  loading?: boolean;
}

/**
 * Usage Quota Banner Component
 *
 * Displays remaining free usage quota at the top of paid feature pages.
 * When limit is -1 (admin or subscriber), shows "无限使用" badge instead.
 */
export function UsageQuotaBanner({
  featureType,
  currentCount,
  freeLimit,
  loading = false,
}: UsageQuotaBannerProps) {
  const [, navigate] = useLocation();

  const featureNames = {
    avatar: "虚拟偶像生成",
    analysis: "视频 PK 评分",
    storyboard: "智能脚本与分镜生成",
  };

  if (loading) {
    return (
      <div className="mx-4 mt-4 p-4 bg-[#1C1C1E] rounded-2xl border border-[#38383A] flex flex-row items-center">
        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        <p className="ml-3 text-[#8E8E93] text-sm">加载使用额度...</p>
      </div>
    );
  }

  // --- Admin or subscriber: Unlimited usage ---
  if (freeLimit === -1) {
    return (
      <div className="mx-4 mt-4 p-4 rounded-2xl border flex flex-row items-center justify-between bg-green-500/10 border-green-500/25">
        <div className="flex flex-row items-center flex-1">
          <Infinity className="h-6 w-6 text-green-500" />
          <div className="ml-3 flex-1">
            <p className="text-green-500 font-bold text-base">无限使用</p>
            <p className="text-green-500/80 text-sm mt-0.5">
              {featureNames[featureType]} · 不限次数 · 不扣 Credits
            </p>
          </div>
        </div>
        <div className="bg-green-500/15 px-3 py-1.5 rounded-full">
          <span className="text-green-500 font-bold text-xs">VIP</span>
        </div>
      </div>
    );
  }

  // --- Regular user: Display free quota ---
  const remaining = Math.max(0, freeLimit - currentCount);
  const isExhausted = remaining === 0;

  return (
    <div
      className={`mx-4 mt-4 p-4 rounded-2xl border flex flex-row items-center justify-between ${
        isExhausted
          ? "bg-red-500/10 border-red-500/30"
          : "bg-blue-500/10 border-blue-500/30"
      }`}
    >
      <div className="flex flex-row items-center flex-1">
        {isExhausted ? (
          <AlertCircle className="h-6 w-6 text-red-500" />
        ) : (
          <Info className="h-6 w-6 text-blue-500" />
        )}
        <div className="ml-3 flex-1">
          {isExhausted ? (
            <>
              <p className="text-red-500 font-semibold text-base">入門版額度已用完</p>
              <p className="text-red-500/80 text-sm mt-0.5">
                已使用 {currentCount}/{freeLimit} 次{featureNames[featureType]}（入門版免費額度）
              </p>
            </>
          ) : (
            <>
              <p className="text-blue-500 font-semibold text-base">
                剩餘 {remaining} 次免費生成
              </p>
              <p className="text-blue-500/80 text-sm mt-0.5">
                已使用 {currentCount}/{freeLimit} 次{featureNames[featureType]}
              </p>
            </>
          )}
        </div>
      </div>

      <button
        onClick={() => navigate("/pricing")}
        className={`px-4 py-2 rounded-full opacity-90 ${
          isExhausted ? "bg-red-500" : "bg-blue-500"
        }`}
      >
        <span className="text-white font-semibold text-sm">
          {isExhausted ? "立即购买" : "查看方案"}
        </span>
      </button>
    </div>
  );
}
