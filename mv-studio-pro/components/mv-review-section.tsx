import { useState, useCallback, useEffect } from "react";
import {
  Text,
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  FlatList,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

const hapticImpact = (style: Haptics.ImpactFeedbackStyle) => {
  if (Platform.OS !== "web") {
    Haptics.impactAsync(style);
  }
};

const hapticNotification = (type: Haptics.NotificationFeedbackType) => {
  if (Platform.OS !== "web") {
    Haptics.notificationAsync(type);
  }
};

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
  color,
}: {
  rating: number;
  onRate?: (r: number) => void;
  size?: number;
  interactive?: boolean;
  color: string;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <TouchableOpacity
          key={star}
          disabled={!interactive}
          onPress={() => {
            if (onRate) {
              hapticImpact(Haptics.ImpactFeedbackStyle.Light);
              onRate(star);
            }
          }}
          style={interactive ? { padding: 4 } : undefined}
          activeOpacity={interactive ? 0.7 : 1}
        >
          <MaterialIcons
            name={star <= rating ? "star" : "star-border"}
            size={size}
            color={star <= rating ? color : `${color}40`}
          />
        </TouchableOpacity>
      ))}
    </View>
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
  const colors = useColors();
  const [nickname, setNickname] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [localReviews, setLocalReviews] = useState<Review[]>([]);

  // Fetch reviews from API
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
      if (Platform.OS === "web") {
        alert("请输入暱称");
      }
      return;
    }
    if (rating === 0) {
      if (Platform.OS === "web") {
        alert("请选择评分");
      }
      return;
    }
    if (!comment.trim()) {
      if (Platform.OS === "web") {
        alert("请输入评论内容");
      }
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
      hapticNotification(Haptics.NotificationFeedbackType.Success);

      // Add to local reviews for instant display
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

      // Reset form
      setNickname("");
      setRating(0);
      setComment("");
      setShowForm(false);

      // Refetch - clear local reviews once server data is refreshed
      await reviewsQuery.refetch();
      await statsQuery.refetch();
      setLocalReviews([]);
    } catch (err) {
      hapticNotification(Haptics.NotificationFeedbackType.Error);
      if (Platform.OS === "web") {
        alert("提交失败，请稍后再试");
      }
    } finally {
      setSubmitting(false);
    }
  }, [nickname, rating, comment, mvId, submitMutation, reviewsQuery, statsQuery]);

  const renderReviewItem = (review: Review) => (
    <View
      key={review.id}
      style={[styles.reviewItem, { backgroundColor: `${colors.surface}`, borderColor: colors.border }]}
    >
      <View style={styles.reviewHeader}>
        <View style={styles.reviewUser}>
          <View style={[styles.avatar, { backgroundColor: `${colors.primary}30` }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>
              {review.nickname.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={[styles.reviewNickname, { color: colors.foreground }]}>
              {review.nickname}
            </Text>
            <Text style={[styles.reviewDate, { color: colors.muted }]}>
              {formatDate(review.createdAt)}
            </Text>
          </View>
        </View>
        <StarRating rating={review.rating} size={16} color="#FBBF24" />
      </View>
      <Text style={[styles.reviewComment, { color: colors.foreground }]}>
        {review.comment}
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { borderTopColor: colors.border }]}>
      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <MaterialIcons name="rate-review" size={20} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            评论与评分
          </Text>
        </View>
        {totalReviews > 0 && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <StarRating rating={Math.round(avgRating)} size={14} color="#FBBF24" />
            <Text style={[styles.avgRatingText, { color: colors.foreground }]}>
              {avgRating.toFixed(1)}
            </Text>
            <Text style={[styles.totalReviewsText, { color: colors.muted }]}>
              ({totalReviews})
            </Text>
          </View>
        )}
      </View>

      {/* Write Review Button / Form */}
      {!showForm ? (
        <TouchableOpacity
          onPress={() => {
            hapticImpact(Haptics.ImpactFeedbackStyle.Light);
            setShowForm(true);
          }}
          style={[styles.writeBtn, { backgroundColor: `${colors.primary}15`, borderColor: `${colors.primary}40` }]}
          activeOpacity={0.8}
        >
          <MaterialIcons name="edit" size={18} color={colors.primary} />
          <Text style={[styles.writeBtnText, { color: colors.primary }]}>
            撰写评论
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.formContainer, { backgroundColor: `${colors.surface}`, borderColor: colors.border }]}>
          <View style={styles.formHeader}>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>
              为「{mvTitle}」撰写评论
            </Text>
            <TouchableOpacity
              onPress={() => {
                setShowForm(false);
                setRating(0);
                setNickname("");
                setComment("");
              }}
            >
              <MaterialIcons name="close" size={22} color={colors.muted} />
            </TouchableOpacity>
          </View>

          {/* Rating */}
          <View style={styles.formField}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>评分</Text>
            <StarRating
              rating={rating}
              onRate={setRating}
              size={32}
              interactive
              color="#FBBF24"
            />
          </View>

          {/* Nickname */}
          <View style={styles.formField}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>暱称</Text>
            <TextInput
              value={nickname}
              onChangeText={setNickname}
              placeholder="输入你的暱称"
              placeholderTextColor={`${colors.muted}80`}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  backgroundColor: `${colors.background}`,
                  borderColor: colors.border,
                },
              ]}
              maxLength={100}
              returnKeyType="next"
            />
          </View>

          {/* Comment */}
          <View style={styles.formField}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>评论</Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="分享你对这支视频的看法..."
              placeholderTextColor={`${colors.muted}80`}
              style={[
                styles.textArea,
                {
                  color: colors.foreground,
                  backgroundColor: `${colors.background}`,
                  borderColor: colors.border,
                },
              ]}
              multiline
              numberOfLines={4}
              maxLength={2000}
              textAlignVertical="top"
            />
          </View>

          {/* Submit */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting}
            style={[
              styles.submitBtn,
              { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 },
            ]}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>提交评论</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Reviews List */}
      {reviewsQuery.isLoading && allReviews.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>加载评论中...</Text>
        </View>
      ) : allReviews.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="chat-bubble-outline" size={32} color={`${colors.muted}60`} />
          <Text style={[styles.emptyText, { color: colors.muted }]}>
            还没有评论，成为第一个评论者吧！
          </Text>
        </View>
      ) : (
        <View style={styles.reviewsList}>
          {allReviews.map((review) => renderReviewItem(review as Review))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 16,
    borderTopWidth: 0.5,
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  avgRatingText: {
    fontSize: 14,
    fontWeight: "700",
  },
  totalReviewsText: {
    fontSize: 12,
  },
  writeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    marginBottom: 14,
  },
  writeBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  formContainer: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
  },
  formHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  formTitle: {
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  formField: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 100,
  },
  submitBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 4,
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 20,
  },
  loadingText: {
    fontSize: 13,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
  },
  reviewsList: {
    gap: 10,
  },
  reviewItem: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  reviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  reviewUser: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "700",
  },
  reviewNickname: {
    fontSize: 14,
    fontWeight: "600",
  },
  reviewDate: {
    fontSize: 11,
    marginTop: 2,
  },
  reviewComment: {
    fontSize: 14,
    lineHeight: 22,
    letterSpacing: 0.1,
  },
});
