// @ts-nocheck

import { useState, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Lock, Video, User, Calendar, Info, Pencil, Flag, ArrowLeft, Inbox, CheckCircle, XCircle, ShieldAlert } from "lucide-react";

// ─── 状态标签颜色 ──────────────────────────────
const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending: { label: "待审核", className: "text-yellow-500 bg-yellow-500/10" },
  scoring: { label: "评分中", className: "text-blue-400 bg-blue-400/10" },
  scored: { label: "已评分", className: "text-green-500 bg-green-500/10" },
  failed: { label: "失败", className: "text-red-500 bg-red-500/10" },
};

const PLATFORM_NAMES: Record<string, string> = {
  douyin: "抖音",
  weixin_channels: "视频号",
  xiaohongshu: "小红书",
  bilibili: "B站",
};

type FilterStatus = "all" | "pending" | "scoring" | "scored" | "failed";

export default function AdminVideoReviewPage() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [selectedVideo, setSelectedVideo] = useState<any>(null);
  const [adjustScore, setAdjustScore] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [flagNotes, setFlagNotes] = useState("");
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [showFlagModal, setShowFlagModal] = useState(false);

  const videosQuery = trpc.mvReviews.adminGetAllVideos.useQuery(
    { status: filterStatus, limit: 50, offset: 0 },
    { enabled: isAuthenticated && user?.role === "admin" }
  );

  const adjustMutation = trpc.mvReviews.adminAdjustScore.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setShowScoreModal(false);
      setAdjustScore("");
      setAdjustNotes("");
      videosQuery.refetch();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const flagMutation = trpc.mvReviews.adminFlagVideo.useMutation({
    onSuccess: () => {
      toast.success("操作成功");
      setShowFlagModal(false);
      setFlagNotes("");
      videosQuery.refetch();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const onRefresh = useCallback(async () => {
    await videosQuery.refetch();
  }, [videosQuery]);

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF] flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <Lock size={64} className="text-red-500" />
          <h1 className="text-2xl font-bold">无权限访问</h1>
          <p className="text-gray-400">此页面仅限管理员使用</p>
          <button className="mt-4 px-6 py-2 bg-gray-800 border border-white/10 rounded-lg font-semibold hover:bg-gray-700 transition-colors" onClick={() => window.history.back()}>
            返回
          </button>
        </div>
      </div>
    );
  }

  const videos = videosQuery.data?.videos || [];
  const total = videosQuery.data?.total || 0;

  const FILTERS: { id: FilterStatus; label: string }[] = [
    { id: "all", label: `全部 (${total})` },
    { id: "pending", label: "待审核" },
    { id: "scoring", label: "评分中" },
    { id: "scored", label: "已评分" },
    { id: "failed", label: "失败" },
  ];

  const renderVideoCard = (item: any) => {
    const status = STATUS_MAP[item.scoreStatus] || STATUS_MAP.pending;
    return (
      <div key={item.id} className="bg-[#1C1C1E] border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
        {/* Top section: Thumbnail + Info */}
        <div className="flex gap-4 items-start">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} className="w-16 h-16 rounded-lg object-cover" alt="Video thumbnail" />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-[#2C2C2E] flex items-center justify-center">
              <Video size={24} className="text-gray-500" />
            </div>
          )}
          <div className="flex-1 flex flex-col gap-1">
            <p className="font-bold text-base text-[#F7F4EF] line-clamp-2">{item.title}</p>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <User size={12} />
              <span>{item.user?.name || item.user?.email || `用户 #${item.userId}`}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Calendar size={12} />
              <span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
            </div>
          </div>
          <div className={`px-2 py-1 rounded-md text-xs font-bold ${status.className}`}>
            {status.label}
          </div>
        </div>

        {/* Score Info */}
        {item.viralScore != null && (
          <div className="border-t border-white/10 pt-3 flex items-center gap-4">
            <div className="flex flex-col items-center justify-center w-16 h-16 rounded-full bg-[#2C2C2E]">
              <span className="text-2xl font-black text-[#F7F4EF]">{item.viralScore}</span>
              <span className="text-xs text-gray-400">分</span>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-4">
                 <div>
                    <p className="text-xs text-gray-400">Credits 奖励</p>
                    <p className={`font-bold text-sm ${item.creditsRewarded > 0 ? "text-green-500" : "text-gray-500"}`}>
                        {item.creditsRewarded > 0 ? `+${item.creditsRewarded}` : "无"}
                    </p>
                </div>
                <div>
                    <p className="text-xs text-gray-400">展示状态</p>
                    <p className={`font-bold text-sm ${item.showcaseStatus === "showcased" ? "text-orange-500" : "text-gray-500"}`}>
                        {item.showcaseStatus === "showcased" ? "展厅展示" : item.showcaseStatus === "rejected" ? "已拒绝" : "未展示"}
                    </p>
                </div>
            </div>
          </div>
        )}

        {/* Platform Links */}
        {item.platformLinks && item.platformLinks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {item.platformLinks.map((link: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2 bg-[#2C2C2E] px-2.5 py-1 rounded-md">
                <span className="text-xs font-semibold text-[#F7F4EF]">{PLATFORM_NAMES[link.platform] || link.platform}</span>
                {link.playCount != null && (
                  <span className="text-xs text-gray-400">播放 {(link.playCount / 10000).toFixed(1)}万</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Admin Notes */}
        {item.adminNotes && (
          <div className="bg-[#2C2C2E] p-2.5 rounded-lg flex items-start gap-2">
            <Info size={14} className="text-gray-400 mt-0.5" />
            <p className="text-sm text-gray-400 flex-1 line-clamp-2">{item.adminNotes}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-3 border-t border-white/10">
          <button
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-500/10 text-blue-400 font-semibold hover:bg-blue-500/20 transition-colors"
            onClick={() => {
              setSelectedVideo(item);
              setAdjustScore(String(item.viralScore || ""));
              setShowScoreModal(true);
            }}
          >
            <Pencil size={16} />
            <span>调整评分</span>
          </button>
          <button
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-yellow-500/10 text-yellow-500 font-semibold hover:bg-yellow-500/20 transition-colors"
            onClick={() => {
              setSelectedVideo(item);
              setShowFlagModal(true);
            }}
          >
            <Flag size={16} />
            <span>标记/处理</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between p-4 bg-[#0A0A0C]/80 backdrop-blur-md border-b border-white/10">
        <button onClick={() => window.history.back()} className="w-10 h-10 rounded-full bg-[#1C1C1E] flex items-center justify-center hover:bg-gray-700 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">视频审核面板</h1>
        <div className="w-10" />
      </header>

      <main className="p-4">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-[#1C1C1E] border border-white/10 rounded-xl p-3 text-center">
                <p className="text-2xl font-extrabold text-[#F7F4EF]">{total}</p>
                <p className="text-xs text-gray-400">总视频</p>
            </div>
            <div className="bg-[#1C1C1E] border border-white/10 rounded-xl p-3 text-center">
                <p className="text-2xl font-extrabold text-yellow-500">{videos.filter((v: any) => v.scoreStatus === "pending").length}</p>
                <p className="text-xs text-gray-400">待审核</p>
            </div>
            <div className="bg-[#1C1C1E] border border-white/10 rounded-xl p-3 text-center">
                <p className="text-2xl font-extrabold text-green-500">{videos.filter((v: any) => v.scoreStatus === "scored").length}</p>
                <p className="text-xs text-gray-400">已评分</p>
            </div>
            <div className="bg-[#1C1C1E] border border-white/10 rounded-xl p-3 text-center">
                <p className="text-2xl font-extrabold text-red-500">{videos.filter((v: any) => v.scoreStatus === "failed").length}</p>
                <p className="text-xs text-gray-400">失败</p>
            </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-4 no-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${filterStatus === f.id ? "bg-blue-400/15 text-blue-400" : "bg-[#1C1C1E] text-gray-400 hover:bg-gray-700"}`}
              onClick={() => setFilterStatus(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Video List */}
        {videosQuery.isPending ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center py-20">
            <Loader2 size={40} className="animate-spin text-blue-400" />
            <p className="text-gray-400">加载中...</p>
          </div>
        ) : videos.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 text-center py-20">
                <Inbox size={50} className="text-gray-600" />
                <p className="text-gray-500">暂无视频</p>
            </div>
        ) : (
          <div className="flex flex-col gap-3 pb-20">
            {videos.map(renderVideoCard)}
          </div>
        )}
      </main>

      {/* Score Modal */}
      {showScoreModal && selectedVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#1C1C1E] border border-white/10 rounded-2xl p-6 w-full max-w-md m-4 flex flex-col gap-4">
            <h2 className="text-lg font-bold">调整评分</h2>
            <p className="text-sm text-gray-400 line-clamp-1">{selectedVideo.title} (当前: {selectedVideo.viralScore ?? "未评分"})</p>
            
            <div>
                <label className="text-sm font-medium text-[#F7F4EF] mb-1 block">新评分 (0-100)</label>
                <input
                  type="number"
                  className="w-full bg-[#2C2C2E] border border-white/10 rounded-lg p-3 text-base text-[#F7F4EF] focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  value={adjustScore}
                  onChange={(e) => setAdjustScore(e.target.value)}
                  placeholder="输入新评分"
                  maxLength={3}
                />
            </div>

            <div>
                <label className="text-sm font-medium text-[#F7F4EF] mb-1 block">备注 (选填)</label>
                <textarea
                  className="w-full bg-[#2C2C2E] border border-white/10 rounded-lg p-3 text-base text-[#F7F4EF] focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  placeholder="调整原因"
                  rows={3}
                />
            </div>

            {adjustScore && (
              <div className="bg-green-500/10 p-3 rounded-lg">
                <p className="text-sm text-green-400 font-semibold">
                  评分 {adjustScore} 分 → Credits 奖励:{" "}
                  {Number(adjustScore) >= 90 ? "80" : Number(adjustScore) >= 80 ? "30" : "0"}
                </p>
              </div>
            )}

            <div className="flex gap-3 mt-2">
              <button
                className="flex-1 py-3 rounded-lg bg-[#2C2C2E] text-gray-300 font-semibold hover:bg-gray-700 transition-colors"
                onClick={() => setShowScoreModal(false)}
              >
                取消
              </button>
              <button
                className="flex-1 py-3 rounded-lg bg-blue-500 text-white font-bold hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                onClick={() => {
                  if (!adjustScore || isNaN(Number(adjustScore))) return;
                  adjustMutation.mutate({
                    videoId: selectedVideo.id,
                    newScore: Number(adjustScore),
                    notes: adjustNotes || undefined,
                  });
                }}
                disabled={adjustMutation.isPending}
              >
                {adjustMutation.isPending ? <Loader2 className="animate-spin" size={20} /> : "确认调整"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flag Modal */}
      {showFlagModal && selectedVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#1C1C1E] border border-white/10 rounded-2xl p-6 w-full max-w-md m-4 flex flex-col gap-4">
            <h2 className="text-lg font-bold">标记 / 处理视频</h2>
            <p className="text-sm text-gray-400 line-clamp-1">{selectedVideo.title}</p>

            <div>
                <label className="text-sm font-medium text-[#F7F4EF] mb-1 block">备注 (选填)</label>
                <textarea
                  className="w-full bg-[#2C2C2E] border border-white/10 rounded-lg p-3 text-base text-[#F7F4EF] focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  value={flagNotes}
                  onChange={(e) => setFlagNotes(e.target.value)}
                  placeholder="处理原因"
                  rows={3}
                />
            </div>

            <div className="flex flex-col gap-2">
                <button
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-yellow-500/10 text-yellow-500 font-semibold hover:bg-yellow-500/20 transition-colors"
                    onClick={() => flagMutation.mutate({ videoId: selectedVideo.id, action: "flag", notes: flagNotes || undefined })}
                >
                    <ShieldAlert size={18} />
                    <span>标记异常</span>
                </button>
                <button
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-green-500/10 text-green-500 font-semibold hover:bg-green-500/20 transition-colors"
                    onClick={() => flagMutation.mutate({ videoId: selectedVideo.id, action: "unflag", notes: flagNotes || undefined })}
                >
                    <CheckCircle size={18} />
                    <span>解除标记</span>
                </button>
                <button
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-red-500/10 text-red-500 font-semibold hover:bg-red-500/20 transition-colors"
                    onClick={() => flagMutation.mutate({ videoId: selectedVideo.id, action: "reject", notes: flagNotes || undefined })}
                >
                    <XCircle size={18} />
                    <span>拒绝展示</span>
                </button>
            </div>

            <button
              className="w-full mt-2 py-3 rounded-lg bg-[#2C2C2E] text-gray-300 font-semibold hover:bg-gray-700 transition-colors"
              onClick={() => setShowFlagModal(false)}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
