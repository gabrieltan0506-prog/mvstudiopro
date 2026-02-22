import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Star, StarHalf, MessageSquare, Pencil, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface MvReviewSectionProps {
  mvId: string;
  mvTitle: string;
}

interface Review {
  id: number;
  mvId: string;
  nickname: string;
  rating: number;
  comment: string;
  createdAt: string | Date;
}

function StarRating({
  rating,
  onRate,
  size = 24,
  interactive = false,
  color = "#FBBF24",
}: {
  rating: number;
  onRate?: (r: number) => void;
  size?: number;
  interactive?: boolean;
  color?: string;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          disabled={!interactive}
          onClick={() => onRate?.(star)}
          className={interactive ? "p-1" : ""}
        >
          <Star
            size={size}
            color={color}
            fill={star <= rating ? color : " "}
            className={`${star <= rating ? '' : 'opacity-40'}`}
          />
        </button>
      ))}
    </div>
  );
}

function formatDate(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return d.toLocaleDateString("zh-TW", { year: "numeric", month: "short", day: "numeric" });
}

export function MvReviewSection({ mvId, mvTitle }: MvReviewSectionProps) {
  const [nickname, setNickname] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [localReviews, setLocalReviews] = useState<Review[]>([]);

  const reviewsQuery = trpc.mvReviews.list.useQuery(
    { mvId, limit: 20 },
    { enabled: true }
  );
  const statsQuery = trpc.mvReviews.stats.useQuery(
    { mvId },
    { enabled: true }
  );
  const submitMutation = trpc.mvReviews.submit.useMutation();

  const allReviews = [...localReviews, ...(reviewsQuery.data ?? [])];
  const avgRating = statsQuery.data?.avgRating ?? 0;
  const totalReviews = (statsQuery.data?.totalReviews ?? 0) + localReviews.length;

  const handleSubmit = useCallback(async () => {
    if (!nickname.trim()) {
      toast.error("请输入暱称");
      return;
    }
    if (rating === 0) {
      toast.error("请选择评分");
      return;
    }
    if (!comment.trim()) {
      toast.error("请输入评论内容");
      return;
    }

    setSubmitting(true);
    try {
      await submitMutation.mutateAsync({
        mvId,
        nickname: nickname.trim(),
        rating,
        comment: comment.trim(),
      });
      toast.success("评论已提交");

      setLocalReviews((prev) => [
        {
          id: Date.now(),
          mvId,
          nickname: nickname.trim(),
          rating,
          comment: comment.trim(),
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);

      setNickname("");
      setRating(0);
      setComment("");
      setShowForm(false);

      await reviewsQuery.refetch();
      await statsQuery.refetch();
      setLocalReviews([]);
    } catch (err) {
      toast.error("提交失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  }, [nickname, rating, comment, mvId, submitMutation, reviewsQuery, statsQuery]);

  const renderReviewItem = (review: Review) => (
    <div
      key={review.id}
      className="bg-[#1C1C1E] border border-[#3A3A3C] rounded-xl p-4"
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-primary font-bold text-base">
              {review.nickname.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <p className="text-[#F7F4EF] font-semibold text-sm">{review.nickname}</p>
            <p className="text-[#8E8E93] text-xs mt-0.5">
              {formatDate(review.createdAt)}
            </p>
          </div>
        </div>
        <StarRating rating={review.rating} size={16} />
      </div>
      <p className="text-[#F7F4EF] text-sm leading-relaxed tracking-wide">{review.comment}</p>
    </div>
  );

  return (
    <div className="pt-4 border-t border-[#3A3A3C] mt-2">
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <MessageSquare size={20} className="text-primary" />
          <h3 className="text-[#F7F4EF] text-base font-bold tracking-tight">评论与评分</h3>
        </div>
        {totalReviews > 0 && (
          <div className="flex items-center gap-1.5">
            <StarRating rating={Math.round(avgRating)} size={14} />
            <span className="text-[#F7F4EF] font-bold text-sm">{avgRating.toFixed(1)}</span>
            <span className="text-[#8E8E93] text-xs">({totalReviews})</span>
          </div>
        )}
      </div>

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-primary/50 bg-primary/10 mb-3.5"
        >
          <Pencil size={18} className="text-primary" />
          <span className="text-primary font-semibold text-sm">撰写评论</span>
        </button>
      ) : (
        <div className="bg-[#1C1C1E] border border-[#3A3A3C] rounded-2xl p-4 mb-3.5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-[#F7F4EF] font-semibold text-base flex-1">为「{mvTitle}」撰写评论</h4>
            <button onClick={() => setShowForm(false)}>
              <X size={22} className="text-[#8E8E93]" />
            </button>
          </div>

          <div className="mb-3.5">
            <label className="text-[#8E8E93] text-sm font-semibold mb-2 block">评分</label>
            <StarRating rating={rating} onRate={setRating} size={32} interactive />
          </div>

          <div className="mb-3.5">
            <label className="text-[#8E8E93] text-sm font-semibold mb-2 block">暱称</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="输入你的暱称"
              className="w-full bg-[#0A0A0C] border border-[#3A3A3C] rounded-lg px-3.5 py-2.5 text-[#F7F4EF] text-base placeholder:text-[#8E8E93]/50"
              maxLength={100}
            />
          </div>

          <div className="mb-3.5">
            <label className="text-[#8E8E93] text-sm font-semibold mb-2 block">评论</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="分享你对这支视频的看法..."
              className="w-full bg-[#0A0A0C] border border-[#3A3A3C] rounded-lg px-3.5 py-2.5 text-[#F7F4EF] text-base min-h-[100px] placeholder:text-[#8E8E93]/50"
              rows={4}
              maxLength={2000}
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full bg-primary py-3.5 rounded-xl text-white text-base font-bold disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 size={20} className="animate-spin mx-auto" />
            ) : (
              "提交评论"
            )}
          </button>
        </div>
      )}

      {reviewsQuery.isPending && allReviews.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-5">
          <Loader2 size={16} className="animate-spin text-primary" />
          <span className="text-[#8E8E93] text-sm">加载评论中...</span>
        </div>
      ) : allReviews.length === 0 ? (
        <div className="text-center py-6">
          <MessageSquare size={32} className="mx-auto text-[#8E8E93]/40" />
          <p className="text-[#8E8E93] text-sm mt-2">还没有评论，成为第一个评论者吧！</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {allReviews.map((review) => renderReviewItem(review as Review))}
        </div>
      )}
    </div>
  );
}
