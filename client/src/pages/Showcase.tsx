// @ts-nocheck
import { useState, useCallback, useMemo } from "react";
import { useLocation, Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { 
  Flame, Trophy, Star, BadgeCheck, Shield, User, X, Video, PlayCircle, Clapperboard, 
  Bookmark, Youtube, TrendingUp, Heart, Clock, Sparkles, MessageCircle, ArrowLeft, 
  Upload, Library, Send, Link as LinkIcon, Loader2 
} from "lucide-react";

// ─── 平台信息 ──────────────────────────────────
const PLATFORM_INFO: Record<string, { name: string; color: string; icon: React.ElementType }> = {
  douyin: { name: "抖音", color: "#FE2C55", icon: PlayCircle },
  weixin_channels: { name: "视频号", color: "#FA9D3B", icon: Clapperboard },
  xiaohongshu: { name: "小红书", color: "#FF2442", icon: Bookmark },
  bilibili: { name: "B站", color: "#00A1D6", icon: Youtube },
};

// ─── 排序选项 ──────────────────────────────────
type SortOption = "score" | "recent" | "popular";
const SORT_OPTIONS: { id: SortOption; label: string; icon: React.ElementType }[] = [
  { id: "score", label: "最高分", icon: TrendingUp },
  { id: "popular", label: "最热门", icon: Heart },
  { id: "recent", label: "最新", icon: Clock },
];

// ─── 分数等级 ──────────────────────────────────
function getScoreTier(score: number): { label: string; color: string; bg: string } {
  if (score >= 95) return { label: "传奇爆款", color: "text-[#FFD60A]", bg: "bg-[#FFD60A]/15" };
  if (score >= 90) return { label: "超级爆款", color: "text-[#FF6B35]", bg: "bg-[#FF6B35]/15" };
  return { label: "爆款", color: "text-[#30D158]", bg: "bg-[#30D158]/15" };
}

// ─── 展厅顶部 Hero ─────────────────────────────
function ShowcaseHero() {
  return (
    <div className="mb-8 animate-fade-in-up">
      <div className="bg-[#1C1C1E] rounded-2xl p-6 text-center border border-white/10">
        <div className="flex justify-center items-center gap-4 mb-4">
          <Flame className="text-[#FF6B35]" size={28} />
          <Trophy className="text-[#FFD60A]" size={28} />
          <Star className="text-[#FF6B6B]" size={28} />
        </div>
        <h1 className="text-3xl font-black text-[#F7F4EF] tracking-wide">爆款展厅</h1>
        <p className="text-sm text-gray-400 mt-2 leading-relaxed">
          汇聚平台 90 分以上的顶级爆款视频<br />
          发现优秀创作者，汲取爆款灵感
        </p>
        <div className="flex justify-center items-center gap-3 mt-4 text-xs text-gray-400">
          <div className="flex items-center gap-1">
            <BadgeCheck className="text-[#30D158]" size={16} />
            <span>AI 认证评分</span>
          </div>
          <div className="w-1 h-1 rounded-full bg-gray-600" />
          <div className="flex items-center gap-1">
            <Shield className="text-[#64D2FF]" size={16} />
            <span>实名认证创作者</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 评论项 ──────────────────────────────────
function CommentItem({ comment, onDelete, isOwner }: { comment: any; onDelete: (id: number) => void; isOwner: boolean }) {
  return (
    <div className="flex gap-3 py-3 border-b border-white/10">
      <div className="w-8 h-8 rounded-full bg-[#2C2C2E] flex items-center justify-center shrink-0">
        <User size={18} className="text-gray-400" />
      </div>
      <div className="flex-1">
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold text-[#F7F4EF]">{comment.userName || "匿名用户"}</span>
          <span className="text-xs text-gray-500">
            {new Date(comment.createdAt).toLocaleDateString("zh-TW")}
          </span>
        </div>
        <p className="text-sm text-[#F7F4EF] mt-1">{comment.content}</p>
      </div>
      {isOwner && (
        <button onClick={() => onDelete(comment.id)} className="p-1 hover:bg-white/10 rounded-full">
          <X size={14} className="text-gray-400" />
        </button>
      )}
    </div>
  );
}

// ─── 视频卡片 ──────────────────────
function ShowcaseCard({
  video,
  index,
  isLiked,
  isFavorited,
  onToggleLike,
  onToggleFavorite,
  onOpenComments,
}: {
  video: any;
  index: number;
  isLiked: boolean;
  isFavorited: boolean;
  onToggleLike: (videoId: number) => void;
  onToggleFavorite: (videoId: number) => void;
  onOpenComments: (videoId: number) => void;
}) {
  const tier = getScoreTier(video.viralScore || 0);

  return (
    <div className="bg-[#1C1C1E] rounded-lg overflow-hidden border border-white/10 animate-fade-in-up transition-transform duration-300 hover:-translate-y-1">
      <div className="relative h-52 w-full">
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-[#2C2C2E] flex items-center justify-center">
            <Video size={40} className="text-gray-500" />
          </div>
        )}
        {index < 3 && (
          <div className={`absolute top-3 left-3 w-8 h-8 rounded-full flex items-center justify-center font-bold text-black ${index === 0 ? "bg-[#FFD60A]" : index === 1 ? "bg-[#C0C0C0]" : "bg-[#CD7F32]"}`}>
            #{index + 1}
          </div>
        )}
        <div className={`absolute top-3 right-3 w-12 h-12 rounded-full flex items-center justify-center font-black text-lg text-black ${tier.bg.replace("bg-","").replace("/15","")}`}>
          {video.viralScore}
        </div>
        <div className={`absolute bottom-3 left-3 flex items-center gap-1 px-2 py-1 rounded-full ${tier.bg}`}>
          <Flame size={12} className={tier.color} />
          <span className={`text-xs font-bold ${tier.color}`}>{tier.label}</span>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <h3 className="text-lg font-bold text-[#F7F4EF] line-clamp-2 h-[56px]">{video.title}</h3>

        {video.creatorName && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <User size={14} />
            <span>{video.creatorName}</span>
            {video.isVerified && <BadgeCheck size={14} className="text-[#30D158]" />}
          </div>
        )}

        {video.platformLinks && video.platformLinks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {video.platformLinks.map((link: any, idx: number) => {
              const Info = PLATFORM_INFO[link.platform] || { name: link.platform, color: "#999", icon: LinkIcon };
              return (
                <a
                  key={idx}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold"
                  style={{ backgroundColor: `${Info.color}1A`, color: Info.color }}
                >
                  <Info.icon size={14} />
                  <span>{Info.name}</span>
                </a>
              );
            })}
          </div>
        )}

        {video.aiSummary && (
          <div className="flex items-start gap-2 bg-[#C77DBA]/10 p-2.5 rounded-lg">
            <Sparkles size={14} className="text-[#C77DBA] shrink-0 mt-0.5" />
            <p className="text-xs text-[#C77DBA] line-clamp-3">{video.aiSummary}</p>
          </div>
        )}

        <div className="pt-3 border-t border-white/10 flex items-center gap-2">
          <button onClick={() => onToggleLike(video.id)} className="flex items-center gap-1.5 text-gray-400 hover:text-[#FF453A] transition-colors">
            <Heart size={20} className={isLiked ? "text-[#FF453A] fill-current" : ""} />
            <span className={`text-xs font-semibold ${isLiked ? "text-[#FF453A]" : ""}`}>
              {video.likeCount || 0}
            </span>
          </button>

          <button onClick={() => onOpenComments(video.id)} className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors">
            <MessageCircle size={18} />
            <span className="text-xs font-semibold">评论</span>
          </button>

          <button onClick={() => onToggleFavorite(video.id)} className="flex items-center gap-1.5 text-gray-400 hover:text-[#FFD60A] transition-colors">
            <Bookmark size={20} className={isFavorited ? "text-[#FFD60A] fill-current" : ""} />
            <span className={`text-xs font-semibold ${isFavorited ? "text-[#FFD60A]" : ""}`}>
              {isFavorited ? "已收藏" : "收藏"}
            </span>
          </button>

          <div className="ml-auto flex items-center gap-1 bg-[#FFD60A]/15 px-2 py-1 rounded-md">
            <Star size={14} className="text-[#FFD60A]" />
            <span className="text-xs font-bold text-[#FFD60A]">+{video.creditsRewarded || 80}</span>
          </div>
        </div>

        <p className="text-xs text-gray-500 pt-2">{new Date(video.createdAt).toLocaleDateString("zh-TW")}</p>
      </div>
    </div>
  );
}

// ─── 主页面 ──────────────────────────────────
export default function Showcase() {
  const navigate = useLocation();
  const { user, isAuthenticated } = useAuth();
  const [sortBy, setSortBy] = useState<SortOption>("score");
  const [commentVideoId, setCommentVideoId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");

  const showcaseQuery = trpc.showcase.getAll.useQuery(
    { limit: 50, offset: 0 },
    { refetchOnMount: true }
  );

  const videos = showcaseQuery.data?.videos || [];
  const videoIds = useMemo(() => videos.map((v: any) => v.id), [videos]);

  const interactionsQuery = trpc.showcase.getUserInteractions.useQuery(
    { videoIds },
    { enabled: isAuthenticated && videoIds.length > 0 }
  );

  const likedIds = new Set(interactionsQuery.data?.likes || []);
  const favoritedIds = new Set(interactionsQuery.data?.favorites || []);

  const commentsQuery = trpc.showcase.getComments.useQuery(
    { videoId: commentVideoId!, limit: 50, offset: 0 },
    { enabled: commentVideoId != null }
  );

  const utils = trpc.useUtils();
  const likeMutation = trpc.showcase.toggleLike.useMutation({
    onSuccess: () => {
      utils.showcase.list.invalidate();
      utils.showcase.getUserInteractions.invalidate();
    },
  });

  const favoriteMutation = trpc.showcase.toggleFavorite.useMutation({
    onSuccess: () => utils.showcase.getUserInteractions.invalidate(),
  });

  const addCommentMutation = trpc.showcase.addComment.useMutation({
    onSuccess: () => {
      setCommentText("");
      utils.showcase.getComments.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteCommentMutation = trpc.showcase.deleteComment.useMutation({
    onSuccess: () => utils.showcase.getComments.invalidate(),
  });

  const handleToggleLike = (videoId: number) => {
    if (!isAuthenticated) return toast.error("请先登录后再点赞");
    likeMutation.mutate({ videoId });
  };

  const handleToggleFavorite = (videoId: number) => {
    if (!isAuthenticated) return toast.error("请先登录后再收藏");
    favoriteMutation.mutate({ videoId });
  };

  const handleOpenComments = (videoId: number) => setCommentVideoId(videoId);

  const handleSubmitComment = () => {
    if (!isAuthenticated) return toast.error("请先登录后再评论");
    if (!commentText.trim() || commentVideoId == null) return;
    addCommentMutation.mutate({ videoId: commentVideoId, content: commentText.trim() });
  };

  const handleDeleteComment = (commentId: number) => {
    if (window.confirm("确定删除此评论？")) {
      deleteCommentMutation.mutate({ commentId });
    }
  };

  const sortedVideos = useMemo(() => [...videos].sort((a: any, b: any) => {
    if (sortBy === "score") return (b.viralScore || 0) - (a.viralScore || 0);
    if (sortBy === "popular") return (b.likeCount || 0) - (a.likeCount || 0);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }), [videos, sortBy]);

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <header className="sticky top-0 z-20 flex items-center justify-between p-4 bg-[#0A0A0C]/80 backdrop-blur-sm border-b border-white/10">
        <button onClick={() => window.history.back()} className="w-10 h-10 rounded-full bg-[#1C1C1E] flex items-center justify-center">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-lg font-bold">爆款展厅</h2>
        <Link href="/video-submit">
          <a className="flex items-center gap-1 bg-[#FF6B35]/15 text-[#FF6B35] px-3 py-2 rounded-lg text-sm font-semibold hover:bg-[#FF6B35]/25 transition-colors">
            <Upload size={16} />
            <span>投稿</span>
          </a>
        </Link>
      </header>

      <main className="p-4">
        {showcaseQuery.isPending ? (
          <div className="flex flex-col items-center justify-center pt-20 gap-3">
            <Loader2 className="animate-spin text-[#FF6B35]" size={48} />
            <p className="text-gray-400">加载展厅中...</p>
          </div>
        ) : sortedVideos.length > 0 ? (
          <>
            <ShowcaseHero />
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-gray-400">共 {videos.length} 个爆款视频</p>
              <div className="flex items-center gap-2">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setSortBy(opt.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${sortBy === opt.id ? "bg-[#FF6B35]/15 text-[#FF6B35]" : "bg-[#1C1C1E] text-gray-400 hover:bg-white/5"}`}>
                    <opt.icon size={14} />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedVideos.map((video, index) => (
                <ShowcaseCard
                  key={video.id}
                  video={video}
                  index={index}
                  isLiked={likedIds.has(video.id)}
                  isFavorited={favoritedIds.has(video.id)}
                  onToggleLike={handleToggleLike}
                  onToggleFavorite={handleToggleFavorite}
                  onOpenComments={handleOpenComments}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-center py-20 gap-4">
            <Library size={64} className="text-gray-700" />
            <h3 className="text-xl font-bold">展厅暂无内容</h3>
            <p className="text-gray-400 max-w-xs">
              目前还没有 90 分以上的爆款视频, 成为第一个入选展厅的创作者吧！
            </p>
            <Link href="/video-submit">
              <a className="flex items-center gap-2 bg-[#FF6B35] text-white px-6 py-3 rounded-lg font-semibold mt-4 hover:bg-opacity-90 transition-opacity">
                <Upload size={20} />
                <span>提交我的视频</span>
              </a>
            </Link>
          </div>
        )}
      </main>

      {/* 评论 Modal */}
      {commentVideoId != null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-fade-in" onClick={() => setCommentVideoId(null)}>
          <div className="bg-[#1C1C1E] w-full max-w-2xl h-[70%] rounded-t-2xl flex flex-col animate-slide-in-up" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between p-4 border-b border-white/10">
              <h3 className="font-bold text-lg">评论 ({commentsQuery.data?.total || 0})</h3>
              <button onClick={() => setCommentVideoId(null)} className="p-1 rounded-full hover:bg-white/10">
                <X size={24} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
              {commentsQuery.isPending ? (
                <div className="flex justify-center pt-10"><Loader2 className="animate-spin text-[#FF6B35]" /></div>
              ) : commentsQuery.data?.comments && commentsQuery.data.comments.length > 0 ? (
                <div className="space-y-2">
                  {commentsQuery.data.comments.map(comment => (
                    <CommentItem key={comment.id} comment={comment} onDelete={handleDeleteComment} isOwner={comment.userId === user?.id} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-gray-500">
                  <MessageCircle size={40} className="mx-auto mb-2" />
                  <p>暂无评论，来说两句吧</p>
                </div>
              )}
            </div>

            <footer className="p-4 border-t border-white/10">
              <div className="flex items-end gap-2">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="写下你的评论..."
                  className="flex-1 bg-[#2C2C2E] rounded-lg px-4 py-2 text-sm text-[#F7F4EF] placeholder-gray-500 border border-white/10 focus:ring-2 focus:ring-[#FF6B35] focus:border- outline-none resize-none max-h-24"
                  rows={1}
                />
                <button
                  onClick={handleSubmitComment}
                  disabled={!commentText.trim() || addCommentMutation.isPending}
                  className="w-10 h-10 flex items-center justify-center bg-[#FF6B35] rounded-full shrink-0 disabled:opacity-50 transition-opacity"
                >
                  {addCommentMutation.isPending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
