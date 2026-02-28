"use client";

import { useLocation, Link } from "wouter";
import { useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { User, ThumbsUp, Star, Trophy, Flame, Lock, Hourglass, ArrowLeft, Copy, Check, Share2, Link as LinkIcon, CheckCircle, Loader2 } from "lucide-react";

// Beta Tester levels
const BETA_LEVELS = [
  { name: "Starter", minReferrals: 0, color: "#9B9691", icon: User, desc: "内测新手" },
  { name: "Advocate", minReferrals: 3, color: "#64D2FF", icon: ThumbsUp, desc: "积极推广者" },
  { name: "Ambassador", minReferrals: 10, color: "#30D158", icon: Star, desc: "品牌大使" },
  { name: "Champion", minReferrals: 25, color: "#FF9F0A", icon: Trophy, desc: "冠军推广者" },
  { name: "Legend", minReferrals: 50, color: "#FF375F", icon: Flame, desc: "传奇推广者" },
];

function getBetaLevel(referralCount: number) {
  for (let i = BETA_LEVELS.length - 1; i >= 0; i--) {
    if (referralCount >= BETA_LEVELS[i].minReferrals) return BETA_LEVELS[i];
  }
  return BETA_LEVELS[0];
}

function getNextLevel(referralCount: number) {
  for (let i = 0; i < BETA_LEVELS.length; i++) {
    if (referralCount < BETA_LEVELS[i].minReferrals) return BETA_LEVELS[i];
  }
  return null;
}

export default function InvitePage() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading: authLoading } = useAuth();

  const [copied, setCopied] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);

  // tRPC queries
  const statusQuery = trpc.beta.myStatus.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
  });
  const leaderboardQuery = trpc.beta.leaderboard.useQuery({ limit: 10 }, {
    enabled: isAuthenticated && !authLoading,
  });

  const myStatus = statusQuery.data;
  const currentLevel = useMemo(() => getBetaLevel(myStatus?.referralCount ?? 0), [myStatus?.referralCount]);
  const nextLevel = useMemo(() => getNextLevel(myStatus?.referralCount ?? 0), [myStatus?.referralCount]);

  const inviteUrl = useMemo(() => {
    if (!myStatus?.inviteCode) return "";
    if (typeof window !== "undefined") {
      return `${window.location.origin}/login?invite=${myStatus.inviteCode}`;
    }
    return `https://mvstudio.com/login?invite=${myStatus.inviteCode}`;
  }, [myStatus?.inviteCode]);

  const handleCopy = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("已复制到剪贴板！");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
      toast.error("复制失败");
    }
  }, []);

  const handleShare = useCallback(async () => {
    if (!myStatus?.inviteCode) return;
    const message = `🎬 我正在使用 MV Studio Pro — 一站式视频创作平台！\n\n使用我的邀请码 ${myStatus.inviteCode} 加入内测，我们双方各获得 10 Credits 奖励！\n\n立即加入：${inviteUrl}`;

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "MV Studio Pro 邀请", text: message });
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 3000);
      } catch (err) {
        // User cancelled
      }
    } else {
      // Fallback: copy to clipboard
      handleCopy(inviteUrl);
    }
  }, [myStatus?.inviteCode, inviteUrl, handleCopy]);

  // Auth guard
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Lock className="h-12 w-12 text-gray-500" />
          <h2 className="text-xl font-bold text-text">请先登录以查看邀请信息</h2>
          <Link href="/login">
            <button className="bg-primary text-white font-semibold px-7 py-3 rounded-lg mt-2">前往登录</button>
          </Link>
      </div>
    );
  }

  if (!myStatus) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Hourglass className="h-12 w-12 text-gray-500" />
          <h2 className="text-xl font-bold text-text">尚未加入内测</h2>
          <p className="text-sm text-gray-400">您目前不是内测用户，请联系管理员获取内测资格</p>
          <button onClick={() => window.history.back()} className="bg-primary text-white font-semibold px-7 py-3 rounded-lg mt-2">返回</button>
      </div>
    );
  }

  const progressToNext = nextLevel
    ? ((myStatus?.referralCount ?? 0) - currentLevel.minReferrals) / (nextLevel.minReferrals - currentLevel.minReferrals)
    : 1;

  const Icon = currentLevel.icon;

  return (
    <div className="min-h-screen bg-background">
      <div className="overflow-y-auto flex-grow">
        <div className="max-w-lg mx-auto px-4 pb-10 w-full">
          {/* Header */}
          <div className="flex items-center justify-between py-4">
            <button onClick={() => window.history.back()} className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center">
              <ArrowLeft className="h-5 w-5 text-text" />
            </button>
            <h1 className="text-xl font-bold text-text">邀请朋友</h1>
            <div className="w-10" />
          </div>

          {/* Status Card */}
          <div className="bg-[rgba(30,20,40,0.6)] rounded-2xl p-6 flex flex-col items-center border border-white/5 mb-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: `${currentLevel.color}20` }}>
              <Icon className="h-7 w-7" style={{ color: currentLevel.color }} />
            </div>
            <p className="text-2xl font-extrabold mb-1" style={{ color: currentLevel.color }}>{currentLevel.name}</p>
            <p className="text-sm text-gray-400 mb-4">{currentLevel.desc}</p>

            {/* Progress to next level */}
            {nextLevel && (
              <div className="w-full mb-5">
                <div className="w-full h-1.5 bg-white/10 rounded-full mb-2 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(progressToNext * 100, 100)}%`, backgroundColor: currentLevel.color }} />
                </div>
                <p className="text-xs text-gray-500 text-center">
                  还需邀请 {nextLevel.minReferrals - (myStatus?.referralCount ?? 0)} 人升级为{" "}
                  <span style={{ color: nextLevel.color, fontWeight: "700" }}>{nextLevel.name}</span>
                </p>
              </div>
            )}

            {/* Stats */}
            <div className="flex items-center w-full">
              <div className="flex-1 text-center">
                <p className="text-2xl font-extrabold text-text">{myStatus?.referralCount ?? 0}</p>
                <p className="text-xs text-gray-500 mt-0.5">已邀请</p>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="flex-1 text-center">
                <p className="text-2xl font-extrabold text-text">{myStatus?.remaining ?? 0}</p>
                <p className="text-xs text-gray-500 mt-0.5">剩余配额</p>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="flex-1 text-center">
                <p className="text-2xl font-extrabold text-text">{myStatus?.totalQuota ?? 0}</p>
                <p className="text-xs text-gray-500 mt-0.5">总配额</p>
              </div>
            </div>
          </div>

          {/* Invite Code Card */}
          <div className="bg-[rgba(30,20,40,0.6)] rounded-2xl p-6 flex flex-col items-center border border-white/5 mb-4">
            <p className="text-base font-semibold text-gray-400 mb-3">我的邀请码</p>
            <button onClick={() => handleCopy(myStatus?.inviteCode ?? '---')} className="flex items-center gap-3 bg-[rgba(255,107,107,0.08)] border-2 border-dashed border-[rgba(255,107,107,0.2)] rounded-2xl px-6 py-4 mb-2">
              <span className="text-3xl font-extrabold text-primary tracking-widest">{myStatus?.inviteCode ?? "---"}</span>
              {copied ? <Check className="h-5 w-5 text-green-500" /> : <Copy className="h-5 w-5 text-primary" />}
            </button>
            
            <p className="text-sm text-gray-400 text-center leading-relaxed mb-5">
              每邀请一位朋友加入内测，你和朋友各获得 <span className="text-primary font-bold">10 次</span> 额外配额
            </p>

            {/* Share2 Buttons */}
            <div className="flex gap-2.5 w-full">
              <button onClick={handleShare} className="flex-1 flex items-center justify-center gap-2 bg-primary py-3.5 rounded-2xl font-semibold text-white">
                <Share2 className="h-5 w-5" />
                <span>分享给朋友</span>
              </button>
              <button onClick={() => handleCopy(inviteUrl)} className="flex-1 flex items-center justify-center gap-2 bg-primary/10 py-3.5 rounded-2xl border border-primary/20 font-semibold text-primary">
                <LinkIcon className="h-5 w-5" />
                <span>复制链接</span>
              </button>
            </div>

            {shareSuccess && (
              <div className="flex items-center gap-2 bg-green-500/10 rounded-lg px-3.5 py-2.5 mt-3 w-full">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <p className="flex-1 text-xs text-green-500 leading-snug">分享成功！等朋友使用邀请码后，你们都会获得额外配额</p>
              </div>
            )}
          </div>

          {/* Level Roadmap */}
          <div className="bg-[rgba(30,20,40,0.6)] rounded-2xl p-5 border border-white/5 mb-4">
            <h3 className="text-lg font-bold text-text mb-4">Beta Tester 等级</h3>
            <div className="space-y-1.5">
            {BETA_LEVELS.map((level) => {
              const isCurrentLevel = level.name === currentLevel.name;
              const isAchieved = (myStatus?.referralCount ?? 0) >= level.minReferrals;
              const LevelIcon = level.icon;
              return (
                <div key={level.name} className={`flex items-center gap-3 p-3 rounded-lg ${isCurrentLevel ? 'bg-white/5 border border-white/10' : ''}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center`} style={{ backgroundColor: isAchieved ? `${level.color}20` : 'rgba(255,255,255,0.04)' }}>
                    <LevelIcon className="h-4.5 w-4.5" style={{ color: isAchieved ? level.color : '#3A3530' }} />
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold`} style={{ color: isAchieved ? level.color : '#6B6560' }}>{level.name}</p>
                    <p className="text-xs text-gray-600">{level.desc}</p>
                  </div>
                  <p className="text-xs font-medium" style={{ color: isAchieved ? level.color : '#4A4540' }}>
                    {level.minReferrals === 0 ? "起始" : `${level.minReferrals}+ 邀请`}
                  </p>
                  {isCurrentLevel && (
                    <div className="px-2 py-0.5 rounded-md" style={{ backgroundColor: level.color }}>
                      <span className="text-xs font-bold text-white">目前</span>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </div>

          {/* Mini Leaderboard */}
          <div className="bg-[rgba(30,20,40,0.6)] rounded-2xl p-5 border border-white/5 mb-4">
            <h3 className="text-lg font-bold text-text mb-3.5">邀请排行榜 TOP 10</h3>

            {leaderboardQuery.isPending ? (
              <div className="flex justify-center py-5">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : leaderboardQuery.data && leaderboardQuery.data.length > 0 ? (
              <div className="space-y-1.5">
                {leaderboardQuery.data.map((entry: any, index: number) => {
                  const level = getBetaLevel(entry.referralCount);
                  return (
                    <div key={entry.id} className="flex items-center gap-2.5 py-2.5 px-2 rounded-lg">
                      <div className="w-7 text-center">
                        {index < 3 ? (
                          <Trophy
                            className="h-4.5 w-4.5 mx-auto"
                            style={{ color: index === 0 ? "#FFD700" : index === 1 ? "#C0C0C0" : "#CD7F32" }}
                          />
                        ) : (
                          <span className="text-sm font-bold text-gray-500">{index + 1}</span>
                        )}
                      </div>
                      <p className="flex-1 text-sm text-text truncate">{entry.email || "匿名"}</p>
                      <div className="px-2 py-0.5 rounded-md" style={{ backgroundColor: `${level.color}15` }}>
                        <span className="text-xs font-semibold" style={{ color: level.color }}>{level.name}</span>
                      </div>
                      <p className="text-base font-bold text-primary w-8 text-right">{entry.referralCount}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-5">暂无排行数据</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
