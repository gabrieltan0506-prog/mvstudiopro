import { useState, useMemo } from "react";
import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Flame, Trophy, Star, BadgeCheck, Shield, User, X, Video, PlayCircle, Clapperboard,
  Bookmark, TrendingUp, Heart, Clock, Sparkles, MessageCircle,
  Upload, Send, Loader2
} from "lucide-react";

/* ── Platform info ── */
const PLATFORM_INFO: Record<string, { name: string; color: string; icon: React.ElementType }> = {
  douyin: { name: "抖音", color: "#FE2C55", icon: PlayCircle },
  weixin_channels: { name: "视频号", color: "#FA9D3B", icon: Clapperboard },
  xiaohongshu: { name: "小红书", color: "#FF2442", icon: Bookmark },
  bilibili: { name: "B站", color: "#00A1D6", icon: PlayCircle },
};

/* ── Sort options ── */
type SortOption = "score" | "recent" | "popular";
const SORT_OPTIONS: { id: SortOption; label: string; icon: React.ElementType }[] = [
  { id: "score", label: "最高分", icon: TrendingUp },
  { id: "popular", label: "最热门", icon: Heart },
  { id: "recent", label: "最新", icon: Clock },
];

/* ── Score tier ── */
function getScoreTier(score: number) {
  if (score >= 95) return { label: "传奇爆款", color: "text-yellow-400", bg: "bg-yellow-400/15" };
  if (score >= 90) return { label: "超级爆款", color: "text-orange-400", bg: "bg-orange-400/15" };
  return { label: "爆款", color: "text-green-400", bg: "bg-green-400/15" };
}

/* ── Star Rating Component ── */
function StarRating({
  rating,
  onRate,
  size = 20,
  interactive = false,
}: {
  rating: number;
  onRate?: (r: number) => void;
  size?: number;
  interactive?: boolean;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          disabled={!interactive}
          className={`transition-colors ${interactive ? "cursor-pointer hover:scale-110" : "cursor-default"}`}
          onMouseEnter={() => interactive && setHover(star)}
          onMouseLeave={() => interactive && setHover(0)}
          onClick={() => interactive && onRate?.(star)}
        >
          <Star
            size={size}
            className={
              star <= (hover || rating)
                ? "text-yellow-400 fill-yellow-400"
                : "text-gray-600"
            }
          />
        </button>
      ))}
    </div>
  );
}

/* ── Comment Item ── */
function CommentItem({
  comment,
  onDelete,
  isOwner,
}: {
  comment: any;
  onDelete: (id: number) => void;
  isOwner: boolean;
}) {
  return (
    <div className="flex gap-3 py-3 border-b border-border/30 last:border-0">
      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
        <User size={16} className="text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold">{comment.userName || "匿名用户"}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(comment.createdAt).toLocaleDateString("zh-CN")}
          </span>
        </div>
        <p className="text-sm text-foreground/80 mt-1 break-words">{comment.content}</p>
      </div>
      {isOwner && (
        <button onClick={() => onDelete(comment.id)} className="p-1 hover:bg-muted rounded-full shrink-0">
          <X size={14} className="text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

/* ── Video Card ── */
function ShowcaseCard({
  video,
  index,
  isLiked,
  isFavorited,
  onToggleLike,
  onToggleFavorite,
  onOpenDetail,
}: {
  video: any;
  index: number;
  isLiked: boolean;
  isFavorited: boolean;
  onToggleLike: (videoId: number) => void;
  onToggleFavorite: (videoId: number) => void;
  onOpenDetail: (videoId: number) => void;
}) {
  const tier = getScoreTier(video.viralScore || 0);

  return (
    <Card className="overflow-hidden bg-card/60 border-border/40 hover:border-primary/30 transition-all group">
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden cursor-pointer" onClick={() => onOpenDetail(video.id)}>
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full bg-muted flex items-center justify-center">
            <Video size={40} className="text-muted-foreground" />
          </div>
        )}
        {/* Rank badge */}
        {index < 3 && (
          <div className={`absolute top-3 left-3 w-8 h-8 rounded-full flex items-center justify-center font-bold text-black text-sm ${index === 0 ? "bg-yellow-400" : index === 1 ? "bg-gray-300" : "bg-amber-600"}`}>
            #{index + 1}
          </div>
        )}
        {/* Score badge */}
        <div className={`absolute top-3 right-3 px-2.5 py-1 rounded-full ${tier.bg} backdrop-blur-sm`}>
          <span className={`text-sm font-black ${tier.color}`}>{video.viralScore}</span>
        </div>
        {/* Tier label */}
        <div className={`absolute bottom-3 left-3 flex items-center gap-1 px-2 py-1 rounded-full ${tier.bg} backdrop-blur-sm`}>
          <Flame size={12} className={tier.color} />
          <span className={`text-xs font-bold ${tier.color}`}>{tier.label}</span>
        </div>
      </div>

      <CardContent className="p-4 space-y-3">
        <h3 className="text-base font-bold line-clamp-2 min-h-[2.5rem] cursor-pointer hover:text-primary transition-colors" onClick={() => onOpenDetail(video.id)}>
          {video.title}
        </h3>

        {video.creatorName && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User size={14} />
            <span>{video.creatorName}</span>
            {video.isVerified && <BadgeCheck size={14} className="text-green-400" />}
          </div>
        )}

        {/* Platform links */}
        {video.platformLinks && video.platformLinks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {video.platformLinks.map((link: any, idx: number) => {
              const Info = PLATFORM_INFO[link.platform] || { name: link.platform, color: "#999", icon: PlayCircle };
              return (
                <a key={idx} href={link.url || link.videoLink} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
                  style={{ backgroundColor: `${Info.color}1A`, color: Info.color }}>
                  <Info.icon size={12} />
                  <span>{Info.name}</span>
                </a>
              );
            })}
          </div>
        )}

        {/* Average rating */}
        <div className="flex items-center gap-2">
          <StarRating rating={Math.round(Number(video.avgRating) || 0)} size={16} />
          <span className="text-sm text-muted-foreground">
            {video.avgRating ? `${video.avgRating}` : "暂无评分"}
            {video.ratingCount > 0 && ` (${video.ratingCount}人)`}
          </span>
        </div>

        {/* AI summary */}
        {video.aiSummary && (
          <div className="flex items-start gap-2 bg-purple-500/10 p-2.5 rounded-lg">
            <Sparkles size={14} className="text-purple-400 shrink-0 mt-0.5" />
            <p className="text-xs text-purple-300 line-clamp-2">{video.aiSummary}</p>
          </div>
        )}

        {/* Action bar */}
        <div className="pt-3 border-t border-border/30 flex items-center gap-3">
          <button onClick={() => onToggleLike(video.id)} className="flex items-center gap-1 text-muted-foreground hover:text-red-400 transition-colors">
            <Heart size={18} className={isLiked ? "text-red-400 fill-red-400" : ""} />
            <span className={`text-xs font-medium ${isLiked ? "text-red-400" : ""}`}>{video.likeCount || 0}</span>
          </button>

          <button onClick={() => onOpenDetail(video.id)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <MessageCircle size={16} />
            <span className="text-xs font-medium">评论</span>
          </button>

          <button onClick={() => onToggleFavorite(video.id)} className="flex items-center gap-1 text-muted-foreground hover:text-yellow-400 transition-colors">
            <Bookmark size={16} className={isFavorited ? "text-yellow-400 fill-yellow-400" : ""} />
            <span className={`text-xs font-medium ${isFavorited ? "text-yellow-400" : ""}`}>{isFavorited ? "已收藏" : "收藏"}</span>
          </button>

          <div className="ml-auto flex items-center gap-1 bg-yellow-400/15 px-2 py-1 rounded-md">
            <Star size={12} className="text-yellow-400" />
            <span className="text-xs font-bold text-yellow-400">+{video.creditsRewarded || 80}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Main Page ── */
export default function Showcase() {
  const { user, isAuthenticated } = useAuth();
  const [sortBy, setSortBy] = useState<SortOption>("score");
  const [detailVideoId, setDetailVideoId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");
  const [userRating, setUserRating] = useState<number>(0);

  // ─── Queries ───
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
    { videoId: detailVideoId!, limit: 50, offset: 0 },
    { enabled: detailVideoId != null }
  );

  const userRatingQuery = trpc.showcase.getUserRating.useQuery(
    { videoId: detailVideoId! },
    { enabled: detailVideoId != null && isAuthenticated }
  );

  // Set user rating when data loads
  const currentUserRating = userRatingQuery.data?.rating || 0;

  // ─── Mutations ───
  const utils = trpc.useUtils();

  const likeMutation = trpc.showcase.toggleLike.useMutation({
    onSuccess: () => {
      utils.showcase.getAll.invalidate();
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
      toast.success("评论已发布");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteCommentMutation = trpc.showcase.deleteComment.useMutation({
    onSuccess: () => {
      utils.showcase.getComments.invalidate();
      toast.success("评论已删除");
    },
  });

  const rateMutation = trpc.showcase.rateVideo.useMutation({
    onSuccess: (data: any) => {
      setUserRating(data.userRating);
      utils.showcase.getAll.invalidate();
      utils.showcase.getUserRating.invalidate();
      toast.success(`已评分 ${data.userRating} 星，当前平均 ${data.avgRating} 分`);
    },
    onError: () => toast.error("评分失败，请稍后重试"),
  });

  // ─── Handlers ───
  const handleToggleLike = (videoId: number) => {
    if (!isAuthenticated) return toast.error("请先登录后再点赞");
    likeMutation.mutate({ videoId });
  };

  const handleToggleFavorite = (videoId: number) => {
    if (!isAuthenticated) return toast.error("请先登录后再收藏");
    favoriteMutation.mutate({ videoId });
  };

  const handleSubmitComment = () => {
    if (!isAuthenticated) return toast.error("请先登录后再评论");
    if (!commentText.trim() || detailVideoId == null) return;
    addCommentMutation.mutate({ videoId: detailVideoId, content: commentText.trim() });
  };

  const handleDeleteComment = (commentId: number) => {
    if (window.confirm("确定删除此评论？")) {
      deleteCommentMutation.mutate({ commentId });
    }
  };

  const handleRate = (videoId: number, rating: number) => {
    if (!isAuthenticated) return toast.error("请先登录后再评分");
    rateMutation.mutate({ videoId, rating });
  };

  const sortedVideos = useMemo(() => [...videos].sort((a: any, b: any) => {
    if (sortBy === "score") return (b.viralScore || 0) - (a.viralScore || 0);
    if (sortBy === "popular") return (b.likeCount || 0) - (a.likeCount || 0);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }), [videos, sortBy]);

  const detailVideo = detailVideoId != null ? videos.find((v: any) => v.id === detailVideoId) : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      <main className="container pt-24 pb-16">
        {/* Hero */}
        <div className="mb-8 text-center">
          <div className="flex justify-center items-center gap-3 mb-4">
            <Flame className="text-orange-400" size={28} />
            <Trophy className="text-yellow-400" size={28} />
            <Star className="text-red-400" size={28} />
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-wide mb-3">爆款展厅</h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            汇聚平台 90 分以上的顶级爆款视频，评论互动、用户评分，发现优秀创作者
          </p>
          <div className="flex justify-center items-center gap-4 mt-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <BadgeCheck className="text-green-400" size={16} />
              <span>AI 认证评分</span>
            </div>
            <div className="w-1 h-1 rounded-full bg-muted-foreground/30" />
            <div className="flex items-center gap-1">
              <Shield className="text-blue-400" size={16} />
              <span>实名认证创作者</span>
            </div>
          </div>
        </div>

        {showcaseQuery.isPending ? (
          <div className="flex flex-col items-center justify-center pt-20 gap-3">
            <Loader2 className="animate-spin text-primary" size={48} />
            <p className="text-muted-foreground">加载展厅中...</p>
          </div>
        ) : sortedVideos.length > 0 ? (
          <>
            {/* Sort & count bar */}
            <div className="flex items-center justify-between mb-6">
              <p className="text-sm font-medium text-muted-foreground">共 {videos.length} 个爆款视频</p>
              <div className="flex items-center gap-2">
                {SORT_OPTIONS.map((opt) => (
                  <Button
                    key={opt.id}
                    variant={sortBy === opt.id ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setSortBy(opt.id)}
                  >
                    <opt.icon size={14} />
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Video grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sortedVideos.map((video: any, index: number) => (
                <ShowcaseCard
                  key={video.id}
                  video={video}
                  index={index}
                  isLiked={likedIds.has(video.id)}
                  isFavorited={favoritedIds.has(video.id)}
                  onToggleLike={handleToggleLike}
                  onToggleFavorite={handleToggleFavorite}
                  onOpenDetail={(id) => { setDetailVideoId(id); setUserRating(0); }}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-center py-20 gap-4">
            <Video size={64} className="text-muted-foreground/30" />
            <h3 className="text-xl font-bold">展厅暂无内容</h3>
            <p className="text-muted-foreground max-w-xs">
              目前还没有 90 分以上的爆款视频，成为第一个入选展厅的创作者吧！
            </p>
            <Link href="/video-submit">
              <Button className="gap-2 mt-2">
                <Upload size={18} />
                提交我的视频
              </Button>
            </Link>
          </div>
        )}
      </main>

      {/* ═══ Detail / Comment / Rating Modal ═══ */}
      {detailVideoId != null && detailVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setDetailVideoId(null)}>
          <div className="bg-card w-full max-w-2xl max-h-[85vh] rounded-2xl flex flex-col border border-border/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <header className="flex items-center justify-between p-5 border-b border-border/30">
              <div>
                <h3 className="font-bold text-lg">{detailVideo.title}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">{detailVideo.creatorName}</p>
              </div>
              <button onClick={() => setDetailVideoId(null)} className="p-2 rounded-full hover:bg-muted transition-colors">
                <X size={20} />
              </button>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Rating section */}
              <div className="bg-muted/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Star size={18} className="text-yellow-400" />
                    用户评分
                  </h4>
                  <div className="text-sm text-muted-foreground">
                    平均 {detailVideo.avgRating || "—"} 分 · {detailVideo.ratingCount || 0} 人评分
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground">你的评分：</span>
                  <StarRating
                    rating={userRating || currentUserRating}
                    onRate={(r) => handleRate(detailVideoId!, r)}
                    size={28}
                    interactive={isAuthenticated}
                  />
                  {!isAuthenticated && (
                    <span className="text-xs text-muted-foreground">登录后可评分</span>
                  )}
                </div>
              </div>

              {/* Comments section */}
              <div>
                <h4 className="font-semibold flex items-center gap-2 mb-4">
                  <MessageCircle size={18} />
                  评论 ({commentsQuery.data?.total || 0})
                </h4>

                {commentsQuery.isPending ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="animate-spin text-primary" />
                  </div>
                ) : commentsQuery.data?.comments && commentsQuery.data.comments.length > 0 ? (
                  <div className="space-y-0">
                    {commentsQuery.data.comments.map((comment: any) => (
                      <CommentItem
                        key={comment.id}
                        comment={comment}
                        onDelete={handleDeleteComment}
                        isOwner={comment.userId === user?.id}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <MessageCircle size={32} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">暂无评论，来说两句吧</p>
                  </div>
                )}
              </div>
            </div>

            {/* Comment input */}
            <footer className="p-4 border-t border-border/30">
              <div className="flex items-end gap-3">
                <Textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={isAuthenticated ? "写下你的评论..." : "登录后可发表评论"}
                  disabled={!isAuthenticated}
                  className="flex-1 min-h-[40px] max-h-24 resize-none bg-muted/50"
                  rows={1}
                />
                <Button
                  onClick={handleSubmitComment}
                  disabled={!commentText.trim() || addCommentMutation.isPending || !isAuthenticated}
                  size="icon"
                  className="shrink-0"
                >
                  {addCommentMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </Button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
