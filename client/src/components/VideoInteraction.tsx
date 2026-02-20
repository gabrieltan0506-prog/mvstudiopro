import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Heart,
  MessageCircle,
  Share2,
  Send,
  Trash2,
  ThumbsUp,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Reply,
} from "lucide-react";

interface VideoInteractionProps {
  videoUrl: string;
  title?: string;
  compact?: boolean;
}

export function VideoInteraction({ videoUrl, title, compact = false }: VideoInteractionProps) {
  const { user } = useAuth();
  // using sonner toast
  const [showComments, setShowComments] = useState(!compact);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Queries
  const commentsQuery = trpc.community.getComments.useQuery(
    { videoUrl },
    { enabled: showComments }
  );
  const likeStatusQuery = trpc.community.getVideoLikeStatus.useQuery(
    { videoUrl },
    { enabled: !!user }
  );

  const commentIds = useMemo(
    () => (commentsQuery.data || []).map((c) => c.id),
    [commentsQuery.data]
  );
  const commentLikesQuery = trpc.community.getUserCommentLikes.useQuery(
    { commentIds },
    { enabled: !!user && commentIds.length > 0 }
  );

  const utils = trpc.useUtils();

  // Mutations
  const addCommentMutation = trpc.community.addComment.useMutation({
    onSuccess: () => {
      setNewComment("");
      setReplyTo(null);
      utils.community.getComments.invalidate({ videoUrl });
      toast.success("评论已发布");
    },
    onError: (err) => {
      toast.error(err.message || "评论失败");
    },
  });

  const deleteCommentMutation = trpc.community.deleteComment.useMutation({
    onSuccess: () => {
      utils.community.getComments.invalidate({ videoUrl });
      toast.success("评论已删除");
    },
  });

  const toggleLikeMutation = trpc.community.toggleVideoLike.useMutation({
    onSuccess: () => {
      utils.community.getVideoLikeStatus.invalidate({ videoUrl });
    },
  });

  const toggleCommentLikeMutation = trpc.community.toggleCommentLike.useMutation({
    onSuccess: () => {
      utils.community.getComments.invalidate({ videoUrl });
      utils.community.getUserCommentLikes.invalidate({ commentIds });
    },
  });

  const handleAddComment = () => {
    if (!user) {
      window.location.href = getLoginUrl();
      return;
    }
    if (!newComment.trim()) return;
    addCommentMutation.mutate({
      videoUrl,
      content: newComment.trim(),
      parentId: replyTo?.id,
    });
  };

  const handleToggleLike = () => {
    if (!user) {
      window.location.href = getLoginUrl();
      return;
    }
    toggleLikeMutation.mutate({ videoUrl });
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/gallery?video=${encodeURIComponent(videoUrl)}`;
    const shareTitle = title || "MV Studio Pro 作品";

    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, url: shareUrl });
        return;
      } catch {
        // fallback to copy
      }
    }

    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success("分享链接已复制到剪贴板");
    setTimeout(() => setCopied(false), 2000);
  };

  const liked = likeStatusQuery.data?.liked ?? false;
  const totalLikes = likeStatusQuery.data?.totalLikes ?? 0;
  const comments = commentsQuery.data || [];
  const likedCommentIds = new Set(commentLikesQuery.data || []);

  // Separate top-level and replies
  const topComments = comments.filter((c) => !c.parentId);
  const replies = comments.filter((c) => c.parentId);

  const formatTime = (date: Date | string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    return d.toLocaleDateString("zh-CN");
  };

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleLike}
          className={`gap-2 ${liked ? "text-red-500 hover:text-red-400" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Heart className={`h-5 w-5 ${liked ? "fill-current" : ""}`} />
          <span>{totalLikes > 0 ? totalLikes : "点赞"}</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowComments(!showComments)}
          className="gap-2 text-muted-foreground hover:text-foreground"
        >
          <MessageCircle className="h-5 w-5" />
          <span>{comments.length > 0 ? comments.length : "评论"}</span>
          {showComments ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleShare}
          className="gap-2 text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="h-5 w-5 text-green-500" /> : <Share2 className="h-5 w-5" />}
          <span>{copied ? "已复制" : "分享"}</span>
        </Button>
      </div>

      {/* Comments Section */}
      {showComments && (
        <div className="space-y-4 border-t border-border/50 pt-4">
          {/* Comment Input */}
          <div className="space-y-2">
            {replyTo && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-md">
                <Reply className="h-3.5 w-3.5" />
                <span>回复 {replyTo.name}</span>
                <button
                  onClick={() => setReplyTo(null)}
                  className="ml-auto text-xs hover:text-foreground"
                >
                  取消
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder={user ? (replyTo ? `回复 ${replyTo.name}...` : "写下你的评论...") : "登录后即可评论"}
                className="min-h-[60px] max-h-[120px] resize-none bg-background/50 border-border/50 focus:border-orange-500/50"
                disabled={!user}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    handleAddComment();
                  }
                }}
              />
              <Button
                size="sm"
                onClick={handleAddComment}
                disabled={!newComment.trim() || addCommentMutation.isPending}
                className="self-end bg-orange-600 hover:bg-orange-700"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {user && (
              <p className="text-xs text-muted-foreground">按 Ctrl+Enter 快速发送</p>
            )}
          </div>

          {/* Comments List */}
          {commentsQuery.isLoading ? (
            <div className="text-center text-muted-foreground py-4">加载评论中...</div>
          ) : topComments.length === 0 ? (
            <div className="text-center text-muted-foreground py-6">
              <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">还没有评论，来抢沙发吧！</p>
            </div>
          ) : (
            <div className="space-y-3">
              {topComments.map((comment) => {
                const commentReplies = replies.filter((r) => r.parentId === comment.id);
                return (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    replies={commentReplies}
                    isLiked={likedCommentIds.has(comment.id)}
                    likedCommentIds={likedCommentIds}
                    currentUserId={user?.id}
                    onReply={(id, name) => setReplyTo({ id, name: name || "匿名用户" })}
                    onDelete={(id) => deleteCommentMutation.mutate({ commentId: id })}
                    onToggleLike={(id) => {
                      if (!user) {
                        window.location.href = getLoginUrl();
                        return;
                      }
                      toggleCommentLikeMutation.mutate({ commentId: id });
                    }}
                    formatTime={formatTime}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CommentItemProps {
  comment: {
    id: number;
    userId: number;
    userName: string | null;
    content: string;
    likesCount: number;
    createdAt: Date | string;
  };
  replies?: Array<{
    id: number;
    userId: number;
    userName: string | null;
    content: string;
    likesCount: number;
    createdAt: Date | string;
  }>;
  isLiked: boolean;
  likedCommentIds: Set<number>;
  currentUserId?: number;
  onReply: (id: number, name: string | null) => void;
  onDelete: (id: number) => void;
  onToggleLike: (id: number) => void;
  formatTime: (date: Date | string) => string;
}

function CommentItem({
  comment,
  replies = [],
  isLiked,
  likedCommentIds,
  currentUserId,
  onReply,
  onDelete,
  onToggleLike,
  formatTime,
}: CommentItemProps) {
  const [showReplies, setShowReplies] = useState(false);

  return (
    <div className="group">
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
          {(comment.userName || "匿")[0].toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {comment.userName || "匿名用户"}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatTime(comment.createdAt)}
            </span>
          </div>

          {/* Content */}
          <p className="text-sm text-foreground/90 mt-1 whitespace-pre-wrap break-words">
            {comment.content}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-3 mt-1.5">
            <button
              onClick={() => onToggleLike(comment.id)}
              className={`flex items-center gap-1 text-xs transition-colors ${
                isLiked ? "text-orange-500" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ThumbsUp className={`h-3.5 w-3.5 ${isLiked ? "fill-current" : ""}`} />
              {comment.likesCount > 0 && <span>{comment.likesCount}</span>}
            </button>

            <button
              onClick={() => onReply(comment.id, comment.userName)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Reply className="h-3.5 w-3.5" />
              回复
            </button>

            {currentUserId === comment.userId && (
              <button
                onClick={() => onDelete(comment.id)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </button>
            )}
          </div>

          {/* Replies */}
          {replies.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setShowReplies(!showReplies)}
                className="text-xs text-orange-500 hover:text-orange-400 flex items-center gap-1"
              >
                {showReplies ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {replies.length} 条回复
              </button>
              {showReplies && (
                <div className="mt-2 space-y-2 pl-2 border-l-2 border-border/30">
                  {replies.map((reply) => (
                    <div key={reply.id} className="group/reply flex gap-2">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                        {(reply.userName || "匿")[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{reply.userName || "匿名用户"}</span>
                          <span className="text-[10px] text-muted-foreground">{formatTime(reply.createdAt)}</span>
                        </div>
                        <p className="text-xs text-foreground/80 mt-0.5 whitespace-pre-wrap break-words">{reply.content}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <button
                            onClick={() => onToggleLike(reply.id)}
                            className={`flex items-center gap-1 text-[10px] transition-colors ${
                              likedCommentIds.has(reply.id) ? "text-orange-500" : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <ThumbsUp className={`h-3 w-3 ${likedCommentIds.has(reply.id) ? "fill-current" : ""}`} />
                            {reply.likesCount > 0 && <span>{reply.likesCount}</span>}
                          </button>
                          {currentUserId === reply.userId && (
                            <button
                              onClick={() => onDelete(reply.id)}
                              className="text-[10px] text-muted-foreground hover:text-red-500 opacity-0 group-hover/reply:opacity-100"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default VideoInteraction;
