import { useLocation, Link } from "wouter";
import { Timer, FlaskConical, X, CheckCircle, ArrowUpCircle, TrendingUp } from "lucide-react";

export interface StudentUpgradePromptProps {
  studentPlan?: string;
  usageData: Record<string, { currentCount: number; limit: number; remaining: number }>;
  isTrial?: boolean;
  trialEndDate?: string;
  visible?: boolean;
  onDismiss?: () => void;
  planName?: string;
  [key: string]: any;
}

/**
 * Student Upgrade Prompt Component
 *
 * Shows an upgrade card in two scenarios:
 * 1. Trial users: always show with trial countdown and upgrade CTA
 * 2. Half-year users: when approaching usage limits (>=70%)
 */
export function StudentUpgradePrompt({
  studentPlan,
  usageData,
  isTrial = false,
  trialEndDate,
  visible = true,
  onDismiss,
}: StudentUpgradePromptProps) {
  const [, navigate] = useLocation();

  if (!visible) return null;

  // ─── Trial User Prompt ──────────────────────────────────
  if (isTrial || studentPlan === "student_trial") {
    const endDate = trialEndDate ? new Date(trialEndDate) : null;
    const now = new Date();
    const hoursLeft = endDate ? Math.max(0, Math.round((endDate.getTime() - now.getTime()) / (1000 * 60 * 60))) : 0;
    const isExpiringSoon = hoursLeft <= 12;

    // Find used features for display
    const usedFeatures = Object.entries(usageData)
      .filter(([, data]) => data.limit > 0 && data.currentCount > 0)
      .map(([key, data]) => {
        const nameMap: Record<string, string> = {
          analysis: "视频 PK 评分",
          storyboard: "智能脚本与分镜",
          avatar: "虚拟偶像生成",
          idol3D: "偶像转 3D",
          videoGeneration: "视频生成",
        };
        return {
          name: nameMap[key] || key,
          used: data.currentCount,
          total: data.limit,
        };
      });

    return (
      <div
        className={`mx-4 mt-4 rounded-2xl p-5 border ${
          isExpiringSoon ? "bg-red-500/10 border-red-500/30" : "bg-primary/10 border-primary/30"
        }`}
      >
        {/* Header */}
        <div className="flex flex-row items-center justify-between mb-3">
          <div className="flex flex-row items-center flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center mr-2 ${
                isExpiringSoon ? "bg-red-500/20" : "bg-primary/20"
              }`}
            >
              {isExpiringSoon ? (
                <Timer size={18} className="text-red-500" />
              ) : (
                <FlaskConical size={18} className="text-primary" />
              )}
            </div>
            <div className="flex-1">
              <p className="text-foreground font-bold text-base">
                {isExpiringSoon ? "试用即将到期" : "免费试用中"}
              </p>
              <p className="text-muted-foreground text-xs">
                {hoursLeft > 0
                  ? `剩余 ${hoursLeft} 小时`
                  : "试用已到期"}
              </p>
            </div>
          </div>
          {onDismiss && (
            <button onClick={onDismiss}>
              <X size={18} className="text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Usage summary */}
        {usedFeatures.length > 0 && (
          <div className="mb-3">
            <p className="text-muted-foreground text-xs mb-1.5">已使用：</p>
            {usedFeatures.map((f, idx) => (
              <p key={idx} className="text-foreground text-xs mb-0.5">
                {f.name}：{f.used}/{f.total} 次
              </p>
            ))}
          </div>
        )}

        {/* Upgrade comparison */}
        <div className="p-3 rounded-xl bg-green-500/10">
          <p className="text-foreground font-semibold text-sm mb-2">
            升级订阅，解锁完整体验：
          </p>
          <div className="space-y-1.5">
            <div className="flex flex-row items-center">
              <CheckCircle size={14} className="text-green-500" />
              <p className="text-muted-foreground text-xs ml-1.5">
                半年版 $20：PK 评分 <span className="text-foreground font-semibold">5 次/月</span>、脚本 <span className="text-foreground font-semibold">3 次/月</span>
              </p>
            </div>
            <div className="flex flex-row items-center">
              <CheckCircle size={14} className="text-green-500" />
              <p className="text-muted-foreground text-xs ml-1.5">
                一年版 $38：PK 评分 <span className="text-foreground font-semibold">15 次/月</span> + 视频生成 <span className="text-foreground font-semibold">2 次/月</span>
              </p>
            </div>
            <div className="flex flex-row items-center">
              <CheckCircle size={14} className="text-green-500" />
              <p className="text-muted-foreground text-xs ml-1.5">
                一年版独享：3D 转换、口型同步、1080P 视频
              </p>
            </div>
          </div>
        </div>

        {/* CTA Button */}
        <Link href="/student-verification">
          <button className="mt-3 w-full rounded-xl py-3 flex flex-row items-center justify-center bg-primary">
            <ArrowUpCircle size={18} color="#fff" />
            <span className="text-white font-semibold ml-2">
              {hoursLeft > 0 ? "立即升级订阅" : "试用已到期，立即订阅"}
            </span>
          </button>
        </Link>
      </div>
    );
  }

  // ─── Half-Year User Prompt (approaching limits) ─────────
  if (studentPlan !== "student_6months") return null;

  // Check if any feature is approaching limit (>=70% used)
  const approachingLimit = Object.entries(usageData).some(([, data]) => {
    if (data.limit <= 0) return false;
    return data.currentCount / data.limit >= 0.7;
  });

  if (!approachingLimit) return null;

  const nearLimitFeatures = Object.entries(usageData)
    .filter(([, data]) => data.limit > 0 && data.currentCount / data.limit >= 0.7)
    .map(([key, data]) => {
      const nameMap: Record<string, string> = {
        analysis: "视频 PK 评分",
        storyboard: "智能脚本与分镜",
        avatar: "虚拟偶像生成",
        idol3D: "偶像转 3D",
        videoGeneration: "视频生成",
      };
      return {
        name: nameMap[key] || key,
        used: data.currentCount,
        total: data.limit,
        percent: Math.round((data.currentCount / data.limit) * 100),
      };
    });

  return (
    <div className="mx-4 mt-4 rounded-2xl p-5 border bg-yellow-500/10 border-yellow-500/30">
      {/* Header */}
      <div className="flex flex-row items-center justify-between mb-3">
        <div className="flex flex-row items-center">
          <div className="w-8 h-8 rounded-full flex items-center justify-center mr-2 bg-yellow-500/20">
            <TrendingUp size={18} className="text-yellow-500" />
          </div>
          <p className="text-foreground font-bold text-base">额度即将用完</p>
        </div>
        {onDismiss && (
          <button onClick={onDismiss}>
            <X size={18} className="text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Usage bars */}
      {nearLimitFeatures.map((feature, idx) => (
        <div key={idx} className="mb-2">
          <div className="flex flex-row items-center justify-between mb-1">
            <p className="text-foreground text-sm">{feature.name}</p>
            <p className="text-muted-foreground text-xs">
              {feature.used}/{feature.total} 次（{feature.percent}%）
            </p>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-border">
            <div
              className={`h-full rounded-full ${
                feature.percent >= 90 ? "bg-red-500" : "bg-yellow-500"
              }`}
              style={{ width: `${Math.min(feature.percent, 100)}%` }}
            />
          </div>
        </div>
      ))}

      {/* Upgrade comparison */}
      <div className="mt-3 p-3 rounded-xl bg-primary/10">
        <p className="text-foreground font-semibold text-sm mb-2">
          升级一年版 $38，享受更多额度：
        </p>
        <div className="space-y-1.5">
          <div className="flex flex-row items-center">
            <CheckCircle size={14} className="text-green-500" />
            <p className="text-muted-foreground text-xs ml-1.5">
              视频 PK 评分：5 次/月 → <span className="text-foreground font-semibold">15 次/月</span>
            </p>
          </div>
          <div className="flex flex-row items-center">
            <CheckCircle size={14} className="text-green-500" />
            <p className="text-muted-foreground text-xs ml-1.5">
              分镜脚本：3 次/月 → <span className="text-foreground font-semibold">8 次/月</span>
            </p>
          </div>
          <div className="flex flex-row items-center">
            <CheckCircle size={14} className="text-green-500" />
            <p className="text-muted-foreground text-xs ml-1.5">
              添加偶像转 3D（<span className="text-foreground font-semibold">3 次/月</span>）
            </p>
          </div>
          <div className="flex flex-row items-center">
            <CheckCircle size={14} className="text-green-500" />
            <p className="text-muted-foreground text-xs ml-1.5">
              添加口型同步（<span className="text-foreground font-semibold">5 次/月</span>）
            </p>
          </div>
          <div className="flex flex-row items-center">
            <CheckCircle size={14} className="text-green-500" />
            <p className="text-muted-foreground text-xs ml-1.5">
              添加视频生成（<span className="text-foreground font-semibold">2 次/月</span>）
            </p>
          </div>
        </div>
      </div>

      {/* CTA Button */}
      <Link href="/student-verification">
        <button className="mt-3 w-full rounded-xl py-3 flex flex-row items-center justify-center bg-primary">
          <ArrowUpCircle size={18} color="#fff" />
          <span className="text-white font-semibold ml-2">立即升级一年版</span>
        </button>
      </Link>
    </div>
  );
}
