import { useLocation, Link } from "wouter";
import {
  User,
  ThumbsUp,
  Star,
  Award,
  Trophy,
  Lock,
  CheckCircle,
  PlusCircle,
  Users,
  XCircle,
  Loader2,
  UserPlus,
  BadgeHelp,
  Crown
} from "lucide-react";
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

const BETA_LEVELS = [
  { name: "Starter", minReferrals: 0, color: "text-gray-400", icon: <User className="h-4 w-4" /> },
  { name: "Advocate", minReferrals: 3, color: "text-blue-400", icon: <ThumbsUp className="h-4 w-4" /> },
  { name: "Ambassador", minReferrals: 10, color: "text-green-500", icon: <Star className="h-4 w-4" /> },
  { name: "Champion", minReferrals: 25, color: "text-orange-400", icon: <Award className="h-4 w-4" /> },
  { name: "Legend", minReferrals: 50, color: "text-red-500", icon: <Crown className="h-4 w-4" /> },
];

function getBetaLevel(referralCount: number) {
  for (let i = BETA_LEVELS.length - 1; i >= 0; i--) {
    if (referralCount >= BETA_LEVELS[i].minReferrals) return BETA_LEVELS[i];
  }
  return BETA_LEVELS[0];
}

type TabType = "manage" | "leaderboard";

export default function AdminBeta() {
  const [location, navigate] = useLocation();
  const { user, isAuthenticated, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>("manage");
  const [grantEmail, setGrantEmail] = useState("");
  const [grantQuota, setGrantQuota] = useState("20");
  const [isGranting, setIsGranting] = useState(false);
  const [grantSuccess, setGrantSuccess] = useState("");
  const [grantError, setGrantError] = useState("");

  const betaUsersQuery = trpc.beta.listBetaUsers.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading && user?.role === "admin",
  });
  const leaderboardQuery = trpc.beta.leaderboard.useQuery({ limit: 20 }, {
    enabled: isAuthenticated && !authLoading,
  });

  const grantMutation = trpc.beta.grantQuota.useMutation();
  const revokeMutation = trpc.beta.revokeQuota.useMutation();
  const lookupMutation = trpc.beta.lookupUserByEmail.useMutation();

  const handleGrant = useCallback(async () => {
    setGrantError("");
    setGrantSuccess("");
    if (!grantEmail.trim()) {
      setGrantError("请输入 Mail 地址");
      return;
    }
    const quota = parseInt(grantQuota, 10);
    if (isNaN(quota) || quota <= 0) {
      setGrantError("请输入有效的配额数量");
      return;
    }
    setIsGranting(true);
    try {
      const lookupResult = await lookupMutation.mutateAsync({ email: grantEmail.trim() });
      const result = await grantMutation.mutateAsync({
        userId: lookupResult.userId,
        totalQuota: quota,
      });
      setGrantSuccess(result.message);
      setGrantEmail("");
      betaUsersQuery.refetch();
      setTimeout(() => setGrantSuccess(""), 3000);
    } catch (err: any) {
      setGrantError(err.message || "授予配额失败");
    } finally {
      setIsGranting(false);
    }
  }, [grantEmail, grantQuota, grantMutation, lookupMutation, betaUsersQuery]);

  const handleRevoke = useCallback(async (userId: number, userName: string) => {
    if (window.confirm(`确定要撤销 ${userName} 的内测资格吗？`)) {
      try {
        await revokeMutation.mutateAsync({ userId });
        toast.success(`${userName} 的内测资格已撤销`);
        betaUsersQuery.refetch();
      } catch (err: any) {
        toast.error("撤销失败: " + (err.message || "未知错误"));
      }
    }
  }, [revokeMutation, betaUsersQuery]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-[#FF6B6B]" />
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-[#0A0A0C] flex flex-col items-center justify-center p-6 text-center">
        <Lock className="h-12 w-12 text-gray-500" />
        <p className="mt-4 text-lg font-semibold text-[#F7F4EF]">仅管理员可访问此页面</p>
        <button
          onClick={() => window.history.back()}
          className="mt-6 px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition-colors"
        >
          返回
        </button>
      </div>
    );
  }

  const renderManageTab = () => (
    <div className="space-y-8">
      <div className="bg-[#1C1C1E] p-6 rounded-lg border border-white/10">
        <h2 className="text-xl font-bold text-white">授予内测配额</h2>
        <p className="mt-1 text-sm text-gray-400">输入用户 Mail 和配额数量，授予内测资格</p>

        <input
          type="email"
          className="mt-4 w-full bg-[#0A0A0C] border border-white/10 rounded-md px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#FF6B6B]"
          placeholder="用户 Mail 地址"
          value={grantEmail}
          onChange={(e) => setGrantEmail(e.target.value)}
        />

        <div className="mt-4 flex items-center space-x-2">
          <span className="text-sm text-gray-300">配额次数：</span>
          {["20", "40", "100"].map((q) => (
            <button
              key={q}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                grantQuota === q
                  ? "bg-[#FF6B6B] text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
              onClick={() => setGrantQuota(q)}
            >
              {q} 次
            </button>
          ))}
          <input
            type="number"
            className="w-24 bg-[#0A0A0C] border border-white/10 rounded-md px-3 py-1 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#FF6B6B]"
            placeholder="自订"
            value={!["20", "40", "100"].includes(grantQuota) ? grantQuota : ""}
            onChange={(e) => setGrantQuota(e.target.value.replace(/[^0-9]/g, ""))}
            onFocus={() => { if (["20", "40", "100"].includes(grantQuota)) setGrantQuota(""); }}
          />
        </div>

        {grantSuccess && (
          <div className="mt-4 flex items-center space-x-2 text-green-500 bg-green-500/10 p-2 rounded-md">
            <CheckCircle className="h-4 w-4" />
            <span className="text-sm">{grantSuccess}</span>
          </div>
        )}

        {grantError && <p className="mt-2 text-sm text-red-500">{grantError}</p>}

        <button
          className="mt-6 w-full flex items-center justify-center space-x-2 px-4 py-2 bg-[#FF6B6B] text-white font-bold rounded-md hover:bg-red-600 transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
          onClick={handleGrant}
          disabled={isGranting}
        >
          {isGranting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <UserPlus className="h-5 w-5" />
              <span>授予内测资格</span>
            </>
          )}
        </button>
      </div>

      <div className="bg-[#1C1C1E] p-6 rounded-lg border border-white/10">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">内测用户列表</h2>
          <span className="text-sm font-medium text-gray-400">
            {betaUsersQuery.data?.length ?? 0} 人
          </span>
        </div>

        {betaUsersQuery.isPending ? (
          <div className="flex justify-center mt-6">
            <Loader2 className="h-8 w-8 animate-spin text-[#FF6B6B]" />
          </div>
        ) : betaUsersQuery.data && betaUsersQuery.data.length > 0 ? (
          <div className="mt-4 space-y-3">
            {betaUsersQuery.data.map((betaUser: any) => {
              const level = getBetaLevel(betaUser.referralCount || 0);
              return (
                <div key={betaUser.id} className="flex items-center justify-between bg-[#0A0A0C] p-3 rounded-md border border-white/10">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-full bg-opacity-20 ${level.color.replace('text-', 'bg-')}`}>
                      {level.icon}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{betaUser.email || betaUser.phone || "未知"}</p>
                      <div className="flex items-center space-x-3 text-xs text-gray-400 mt-1">
                        <span className={`${level.color} font-semibold`}>{level.name}</span>
                        <span>配额: {betaUser.usedQuota}/{betaUser.totalQuota}</span>
                        <span>邀请: {betaUser.referralCount || 0}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    className="p-2 text-red-500 hover:bg-red-500/10 rounded-full transition-colors"
                    onClick={() => handleRevoke(betaUser.userId, betaUser.email || betaUser.phone || "用户")}
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center justify-center text-center text-gray-500">
            <Users className="h-10 w-10" />
            <p className="mt-2 text-sm">尚无内测用户</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderLeaderboardTab = () => (
    <div className="bg-[#1C1C1E] p-6 rounded-lg border border-white/10">
      <h2 className="text-xl font-bold text-white">邀请排行榜</h2>
      <p className="mt-1 text-sm text-gray-400">邀请最多朋友的内测用户排名</p>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        {BETA_LEVELS.map((level) => (
          <div key={level.name} className="flex items-center space-x-1.5">
            <div className={`h-2.5 w-2.5 rounded-full ${level.color.replace('text-', 'bg-')}`} />
            <span className="text-gray-300">{level.name}</span>
            <span className="text-gray-500">{level.minReferrals}+</span>
          </div>
        ))}
      </div>

      {leaderboardQuery.isPending ? (
        <div className="flex justify-center mt-6">
          <Loader2 className="h-8 w-8 animate-spin text-[#FF6B6B]" />
        </div>
      ) : leaderboardQuery.data && leaderboardQuery.data.length > 0 ? (
        <div className="mt-6 space-y-2">
          {leaderboardQuery.data.map((entry: any, index: number) => {
            const level = getBetaLevel(entry.referralCount);
            return (
              <div key={entry.userId} className="flex items-center bg-[#0A0A0C] p-3 rounded-md border border-white/10">
                <span className="w-8 text-center font-bold text-lg text-gray-400">{index + 1}</span>
                <div className={`p-2 rounded-full bg-opacity-20 ${level.color.replace('text-', 'bg-')}`}>
                    {level.icon}
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm font-medium text-white">{entry.userName || "匿名用户"}</p>
                  <p className={`text-xs font-semibold ${level.color}`}>{level.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-base font-bold text-white">{entry.referralCount}</p>
                  <p className="text-xs text-gray-400">位邀请</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center justify-center text-center text-gray-500">
          <BadgeHelp className="h-10 w-10" />
          <p className="mt-2 text-sm">排行榜暂无数据</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF] p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">管理员面板</h1>
          <div className="flex items-center space-x-2 bg-[#1C1C1E] border border-white/10 rounded-lg p-1">
            <button
              onClick={() => setActiveTab("manage")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "manage" ? "bg-[#FF6B6B] text-white" : "text-gray-300 hover:bg-gray-700"
              }`}
            >
              用户管理
            </button>
            <button
              onClick={() => setActiveTab("leaderboard")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "leaderboard" ? "bg-[#FF6B6B] text-white" : "text-gray-300 hover:bg-gray-700"
              }`}
            >
              排行榜
            </button>
          </div>
        </header>

        <main>
          {activeTab === "manage" ? renderManageTab() : renderLeaderboardTab()}
        </main>
      </div>
    </div>
  );
}
