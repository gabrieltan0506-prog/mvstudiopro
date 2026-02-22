// @ts-nocheck

import { useState, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Plus, Video, Hourglass, CheckCircle2, XCircle, Clock, Lock, Library, Upload, Star } from "lucide-react";

// ─── 平台名称映射 ──────────────────────────────
const PLATFORM_NAMES: Record<string, string> = {
  douyin: "抖音",
  weixin_channels: "视频号",
  xiaohongshu: "小红书",
  bilibili: "B站",
};

const PLATFORM_COLORS: Record<string, string> = {
  douyin: "#FE2C55",
  weixin_channels: "#FA9D3B",
  xiaohongshu: "#FF2442",
  bilibili: "#00A1D6",
};

// ─── 评分颜色 ──────────────────────────────────
function getScoreColor(score: number | null): string {
  if (!score) return "#9BA1A6";
  if (score >= 90) return "#FFD60A";
  if (score >= 80) return "#30D158";
  if (score >= 60) return "#64D2FF";
  return "#9BA1A6";
}

function getScoreLabel(score: number | null): string {
  if (!score) return "待评分";
  if (score >= 90) return "超级爆款";
  if (score >= 80) return "爆款";
  if (score >= 60) return "优秀";
  if (score >= 40) return "良好";
  return "普通";
}

function getStatusInfo(status: string): { label: string; color: string; icon: React.ElementType } {
  switch (status) {
    case "analyzing":
      return { label: "分析中", color: "#64D2FF", icon: Hourglass };
    case "scored":
      return { label: "已评分", color: "#30D158", icon: CheckCircle2 };
    case "rejected":
      return { label: "已拒绝", color: "#FF453A", icon: XCircle };
    case "manual_review":
      return { label: "人工复审", color: "#FF9F0A", icon: Clock };
    default:
      return { label: "待处理", color: "#9BA1A6", icon: Clock };
  }
}

function getCreditsReward(score: number | null): { amount: number; label: string } {
  if (!score) return { amount: 0, label: "—" };
  if (score >= 90) return { amount: 80, label: "+80 Credits" };
  if (score >= 80) return { amount: 30, label: "+30 Credits" };
  return { amount: 0, label: "未达标" };
}

// ─── 视频卡片组件 ──────────────────────────────
function VideoCard({ video, onClick }: { video: any; onClick: () => void }) {
  const status = getStatusInfo(video.status);
  const StatusIcon = status.icon;
  const reward = getCreditsReward(video.viralScore);
  const scoreColor = getScoreColor(video.viralScore);

  return (
    <button
      className="bg-[#1C1C1E] rounded-2xl overflow-hidden text-left w-full transition-transform transform hover:scale-[1.02]"
      onClick={onClick}
    >
      {/* 缩略图 */}
      <div className="w-full h-44 relative">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            className="w-full h-full object-cover"
            alt={video.title}
          />
        ) : (
          <div className="w-full h-full bg-[#2C2C2E] flex items-center justify-center">
            <Video size={32} className="text-gray-500" />
          </div>
        )}
        {/* 评分徽章 */}
        {video.viralScore !== null && (
          <div
            className="absolute top-3 right-3 w-11 h-11 rounded-full flex items-center justify-center"
            style={{ backgroundColor: scoreColor }}
          >
            <span className="text-base font-extrabold text-black">{video.viralScore}</span>
          </div>
        )}
        {/* 状态标签 */}
        <div
          className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1 rounded-lg"
          style={{ backgroundColor: status.color + "20" }}
        >
          <StatusIcon size={12} style={{ color: status.color }} />
          <span className="text-xs font-semibold" style={{ color: status.color }}>{status.label}</span>
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-3.5 space-y-2">
        <p className="text-base font-bold text-[#ECEDEE] truncate">{video.title}</p>

        {/* 平台标签 */}
        {video.platformLinks && video.platformLinks.length > 0 && (
          <div className="flex flex-row flex-wrap gap-1.5">
            {video.platformLinks.map((link: any, idx: number) => (
              <div
                key={idx}
                className="px-2 py-0.5 rounded-md"
                style={{ backgroundColor: (PLATFORM_COLORS[link.platform] || "#555") + "20" }}
              >
                <span
                  className="text-xs font-semibold"
                  style={{ color: PLATFORM_COLORS[link.platform] || "#999" }}
                >
                  {PLATFORM_NAMES[link.platform] || link.platform}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 底部信息 */}
        <div className="flex flex-row items-center justify-between">
          {/* 评分 */}
          <div className="flex flex-row items-center gap-1.5">
            {video.viralScore !== null ? (
              <>
                <span className="text-sm font-semibold" style={{ color: scoreColor }}>
                  {getScoreLabel(video.viralScore)}
                </span>
                <span className="text-gray-600 text-xs">·</span>
              </>
            ) : null}
            <span className="text-xs text-[#9BA1A6]">
              {new Date(video.createdAt).toLocaleDateString("zh-TW")}
            </span>
          </div>

          {/* Credits 奖励 */}
          {reward.amount > 0 ? (
            <div className="flex flex-row items-center gap-1 bg-yellow-500/15 px-2 py-1 rounded-lg">
              <Star size={14} className="text-yellow-400" />
              <span className="text-xs font-bold text-yellow-400">{reward.label}</span>
            </div>
          ) : video.status === "scored" && reward.amount === 0 ? (
            <span className="text-xs text-[#9BA1A6]">{reward.label}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

// ─── 统计卡片 ──────────────────────────────────
function StatsCard({ videos }: { videos: any[] }) {
  const totalVideos = videos.length;
  const scoredVideos = videos.filter((v) => v.viralScore !== null);
  const avgScore =
    scoredVideos.length > 0
      ? Math.round(scoredVideos.reduce((s, v) => s + (v.viralScore || 0), 0) / scoredVideos.length)
      : 0;
  const totalCredits = videos.reduce((s, v) => {
    const r = getCreditsReward(v.viralScore);
    return s + r.amount;
  }, 0);
  const viralCount = videos.filter((v) => (v.viralScore || 0) >= 80).length;

  return (
    <div className="flex flex-row bg-[#1C1C1E] rounded-2xl p-4 mb-4 items-center">
      <div className="flex-1 flex flex-col items-center gap-1">
        <span className="text-2xl font-extrabold text-[#ECEDEE]">{totalVideos}</span>
        <span className="text-xs text-[#9BA1A6]">已提交</span>
      </div>
      <div className="w-px h-8 bg-[#2C2C2E]" />
      <div className="flex-1 flex flex-col items-center gap-1">
        <span className="text-2xl font-extrabold text-green-500">{viralCount}</span>
        <span className="text-xs text-[#9BA1A6]">爆款</span>
      </div>
      <div className="w-px h-8 bg-[#2C2C2E]" />
      <div className="flex-1 flex flex-col items-center gap-1">
        <span className="text-2xl font-extrabold text-sky-400">{avgScore}</span>
        <span className="text-xs text-[#9BA1A6]">平均分</span>
      </div>
      <div className="w-px h-8 bg-[#2C2C2E]" />
      <div className="flex-1 flex flex-col items-center gap-1">
        <span className="text-2xl font-extrabold text-yellow-400">{totalCredits}</span>
        <span className="text-xs text-[#9BA1A6]">Credits</span>
      </div>
    </div>
  );
}

// ─── 主页面 ──────────────────────────────────
export default function MyVideosPage() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const videosQuery = trpc.mvAnalysis.getMySubmissions.useQuery(
    { limit: 50, offset: 0 },
    { enabled: isAuthenticated && !authLoading }
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await videosQuery.refetch();
    setRefreshing(false);
  }, [videosQuery]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] flex items-center justify-center">
        <Loader2 size={32} className="text-orange-500 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] flex flex-col items-center justify-center p-6 gap-3">
        <Lock size={48} className="text-gray-600" />
        <h2 className="text-lg font-bold text-[#ECEDEE] mt-2">请先登录</h2>
        <p className="text-sm text-[#9BA1A6]">登录后即可查看您的视频提交记录</p>
        <button
          className="bg-orange-500 text-white font-semibold px-6 py-3 rounded-xl mt-2"
          onClick={() => navigate("/login")}
        >
          前往登录
        </button>
      </div>
    );
  }

  const videos = videosQuery.data || [];
  const isLoading = videosQuery.isPending;

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      {/* 顶部导航 */}
      <header className="flex items-center justify-between p-4 border-b border-white/10 sticky top-0 bg-[#0A0A0C]/80 backdrop-blur-sm z-10">
        <button
          onClick={() => window.history.back()}
          className="w-10 h-10 rounded-full bg-[#1C1C1E] flex items-center justify-center"
        >
          <ArrowLeft size={24} className="text-[#ECEDEE]" />
        </button>
        <h1 className="text-lg font-bold">我的视频</h1>
        <button
          onClick={() => navigate("/video-submit")}
          className="w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center"
        >
          <Plus size={24} className="text-orange-500" />
        </button>
      </header>

      <main className="p-4">
        {isLoading && !refreshing ? (
          <div className="flex flex-col items-center justify-center pt-20 gap-3">
            <Loader2 size={32} className="text-orange-500 animate-spin" />
            <p className="text-[#9BA1A6] text-sm">加载中...</p>
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-20 gap-3 text-center px-8">
            <Library size={64} className="text-gray-700" />
            <h2 className="text-lg font-bold text-[#ECEDEE] mt-2">还没有提交视频</h2>
            <p className="text-sm text-[#9BA1A6] leading-relaxed">
              上传您在抖音、视频号、小红书、B站发布的爆款视频<br />
              AI 自动评分，80 分以上可获得 Credits 奖励
            </p>
            <button
              className="flex items-center gap-2 bg-orange-500 text-white font-semibold px-6 py-3 rounded-xl mt-2"
              onClick={() => navigate("/video-submit")}
            >
              <Upload size={20} />
              <span>提交视频</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <StatsCard videos={videos} />
            {videos.map((video: any) => (
              <VideoCard
                key={video.id}
                video={video}
                onClick={() => {
                  // TODO: Navigate to detail page
                  toast.info(`Clicked video: ${video.title}`);
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
