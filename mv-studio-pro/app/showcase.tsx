import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Text,
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Linking,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import * as Haptics from "expo-haptics";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWeb = Platform.OS === "web";

// ─── 平台信息 ──────────────────────────────────
const PLATFORM_INFO: Record<string, { name: string; color: string; icon: string }> = {
  douyin: { name: "抖音", color: "#FE2C55", icon: "play-circle-filled" },
  weixin_channels: { name: "视频号", color: "#FA9D3B", icon: "ondemand-video" },
  xiaohongshu: { name: "小红书", color: "#FF2442", icon: "bookmark" },
  bilibili: { name: "B站", color: "#00A1D6", icon: "smart-display" },
};

// ─── 排序选项 ──────────────────────────────────
type SortOption = "score" | "recent" | "popular";
const SORT_OPTIONS: { id: SortOption; label: string; icon: string }[] = [
  { id: "score", label: "最高分", icon: "trending-up" },
  { id: "popular", label: "最热门", icon: "favorite" },
  { id: "recent", label: "最新", icon: "schedule" },
];

// ─── 分数等级 ──────────────────────────────────
function getScoreTier(score: number): { label: string; color: string; bg: string } {
  if (score >= 95) return { label: "传奇爆款", color: "#FFD60A", bg: "rgba(255,214,10,0.15)" };
  if (score >= 90) return { label: "超级爆款", color: "#FF6B35", bg: "rgba(255,107,53,0.15)" };
  return { label: "爆款", color: "#30D158", bg: "rgba(48,209,88,0.15)" };
}

// ─── 展厅顶部 Hero ─────────────────────────────
function ShowcaseHero() {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.heroContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.heroGradient}>
        <View style={styles.heroIconRow}>
          <MaterialIcons name="local-fire-department" size={28} color="#FF6B35" />
          <MaterialIcons name="emoji-events" size={28} color="#FFD60A" />
          <MaterialIcons name="star" size={28} color="#FF6B6B" />
        </View>
        <Text style={styles.heroTitle}>爆款展厅</Text>
        <Text style={styles.heroSubtitle}>
          汇聚平台 90 分以上的顶级爆款视频{"\n"}
          发现优秀创作者，汲取爆款灵感
        </Text>
        <View style={styles.heroStats}>
          <View style={styles.heroStatItem}>
            <MaterialIcons name="verified" size={16} color="#30D158" />
            <Text style={styles.heroStatText}>AI 认证评分</Text>
          </View>
          <View style={styles.heroStatDot} />
          <View style={styles.heroStatItem}>
            <MaterialIcons name="shield" size={16} color="#64D2FF" />
            <Text style={styles.heroStatText}>实名认证创作者</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// ─── 评论项 ──────────────────────────────────
function CommentItem({ comment, onDelete, isOwner }: { comment: any; onDelete: (id: number) => void; isOwner: boolean }) {
  return (
    <View style={styles.commentItem}>
      <View style={styles.commentAvatar}>
        <MaterialIcons name="person" size={18} color="#9BA1A6" />
      </View>
      <View style={styles.commentBody}>
        <View style={styles.commentHeader}>
          <Text style={styles.commentAuthor}>{comment.userName || "匿名用户"}</Text>
          <Text style={styles.commentDate}>
            {new Date(comment.createdAt).toLocaleDateString("zh-TW")}
          </Text>
        </View>
        <Text style={styles.commentContent}>{comment.content}</Text>
      </View>
      {isOwner && (
        <TouchableOpacity onPress={() => onDelete(comment.id)} style={styles.commentDeleteBtn} activeOpacity={0.7}>
          <MaterialIcons name="close" size={14} color="#666" />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── 视频卡片（含交互功能）──────────────────────
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
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const likeScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      delay: index * 80,
      useNativeDriver: true,
    }).start();
  }, []);

  const openLink = (url: string) => {
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      Linking.openURL(url);
    }
  };

  const handleLike = () => {
    // 点赞动画
    Animated.sequence([
      Animated.timing(likeScale, { toValue: 1.3, duration: 100, useNativeDriver: true }),
      Animated.timing(likeScale, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onToggleLike(video.id);
  };

  return (
    <Animated.View style={[styles.card, { opacity: fadeAnim }]}>
      {/* 缩略图 */}
      <View style={styles.cardImageWrap}>
        {video.thumbnailUrl ? (
          <Image source={{ uri: video.thumbnailUrl }} style={styles.cardImage} contentFit="cover" />
        ) : (
          <View style={styles.cardImagePlaceholder}>
            <MaterialIcons name="videocam" size={40} color="#444" />
          </View>
        )}
        {/* 排名徽章 */}
        {index < 3 && (
          <View style={[styles.rankBadge, { backgroundColor: index === 0 ? "#FFD60A" : index === 1 ? "#C0C0C0" : "#CD7F32" }]}>
            <Text style={styles.rankText}>#{index + 1}</Text>
          </View>
        )}
        {/* 分数 */}
        <View style={[styles.scoreBadge, { backgroundColor: tier.color }]}>
          <Text style={styles.scoreText}>{video.viralScore}</Text>
        </View>
        {/* 等级标签 */}
        <View style={[styles.tierTag, { backgroundColor: tier.bg }]}>
          <MaterialIcons name="local-fire-department" size={12} color={tier.color} />
          <Text style={[styles.tierText, { color: tier.color }]}>{tier.label}</Text>
        </View>
      </View>

      {/* 内容 */}
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{video.title}</Text>

        {/* 创作者 */}
        {video.creatorName && (
          <View style={styles.creatorRow}>
            <MaterialIcons name="person" size={14} color="#9BA1A6" />
            <Text style={styles.creatorName}>{video.creatorName}</Text>
            {video.isVerified && (
              <MaterialIcons name="verified" size={14} color="#30D158" />
            )}
          </View>
        )}

        {/* 平台链接 */}
        {video.platformLinks && video.platformLinks.length > 0 && (
          <View style={styles.platformRow}>
            {video.platformLinks.map((link: any, idx: number) => {
              const info = PLATFORM_INFO[link.platform] || { name: link.platform, color: "#999", icon: "link" };
              return (
                <TouchableOpacity
                  key={idx}
                  style={[styles.platformBtn, { backgroundColor: info.color + "18" }]}
                  onPress={() => link.url && openLink(link.url)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name={info.icon as any} size={14} color={info.color} />
                  <Text style={[styles.platformBtnText, { color: info.color }]}>{info.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* AI 分析摘要 */}
        {video.aiSummary && (
          <View style={styles.summaryBox}>
            <MaterialIcons name="auto-awesome" size={14} color="#C77DBA" />
            <Text style={styles.summaryText} numberOfLines={3}>{video.aiSummary}</Text>
          </View>
        )}

        {/* ─── 交互按钮行 ─── */}
        <View style={styles.interactionRow}>
          {/* 点赞 */}
          <TouchableOpacity onPress={handleLike} style={styles.interactionBtn} activeOpacity={0.7}>
            <Animated.View style={{ transform: [{ scale: likeScale }] }}>
              <MaterialIcons
                name={isLiked ? "favorite" : "favorite-border"}
                size={22}
                color={isLiked ? "#FF453A" : "#9BA1A6"}
              />
            </Animated.View>
            <Text style={[styles.interactionCount, isLiked && { color: "#FF453A" }]}>
              {video.likeCount || 0}
            </Text>
          </TouchableOpacity>

          {/* 评论 */}
          <TouchableOpacity onPress={() => onOpenComments(video.id)} style={styles.interactionBtn} activeOpacity={0.7}>
            <MaterialIcons name="chat-bubble-outline" size={20} color="#9BA1A6" />
            <Text style={styles.interactionCount}>评论</Text>
          </TouchableOpacity>

          {/* 收藏 */}
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onToggleFavorite(video.id);
            }}
            style={styles.interactionBtn}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name={isFavorited ? "bookmark" : "bookmark-border"}
              size={22}
              color={isFavorited ? "#FFD60A" : "#9BA1A6"}
            />
            <Text style={[styles.interactionCount, isFavorited && { color: "#FFD60A" }]}>
              {isFavorited ? "已收藏" : "收藏"}
            </Text>
          </TouchableOpacity>

          {/* 奖励标签 */}
          <View style={styles.rewardTag}>
            <MaterialIcons name="stars" size={14} color="#FFD60A" />
            <Text style={styles.rewardText}>+{video.creditsRewarded || 80}</Text>
          </View>
        </View>

        {/* 底部日期 */}
        <Text style={styles.dateText}>
          {new Date(video.createdAt).toLocaleDateString("zh-TW")}
        </Text>
      </View>
    </Animated.View>
  );
}

// ─── 主页面 ──────────────────────────────────
export default function ShowcaseScreen() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [sortBy, setSortBy] = useState<SortOption>("score");
  const [refreshing, setRefreshing] = useState(false);
  const [commentVideoId, setCommentVideoId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");

  const showcaseQuery = trpc.videoSubmission.getShowcaseVideos.useQuery(
    { limit: 50, offset: 0 },
    { refetchOnMount: true }
  );

  const videos = showcaseQuery.data?.videos || [];
  const videoIds = useMemo(() => videos.map((v: any) => v.id), [videos]);

  // 获取用户交互状态
  const interactionsQuery = trpc.showcase.getUserInteractions.useQuery(
    { videoIds },
    { enabled: isAuthenticated && videoIds.length > 0 }
  );

  const likedIds = new Set(interactionsQuery.data?.likes || []);
  const favoritedIds = new Set(interactionsQuery.data?.favorites || []);

  // 评论查找
  const commentsQuery = trpc.showcase.getComments.useQuery(
    { videoId: commentVideoId!, limit: 50, offset: 0 },
    { enabled: commentVideoId != null }
  );

  // Mutations
  const likeMutation = trpc.showcase.toggleLike.useMutation({
    onSuccess: () => {
      showcaseQuery.refetch();
      interactionsQuery.refetch();
    },
  });

  const favoriteMutation = trpc.showcase.toggleFavorite.useMutation({
    onSuccess: () => interactionsQuery.refetch(),
  });

  const addCommentMutation = trpc.showcase.addComment.useMutation({
    onSuccess: () => {
      setCommentText("");
      commentsQuery.refetch();
    },
    onError: (err) => {
      if (Platform.OS === "web") alert(err.message);
      else Alert.alert("错误", err.message);
    },
  });

  const deleteCommentMutation = trpc.showcase.deleteComment.useMutation({
    onSuccess: () => commentsQuery.refetch(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await showcaseQuery.refetch();
    await interactionsQuery.refetch();
    setRefreshing(false);
  }, [showcaseQuery, interactionsQuery]);

  const handleToggleLike = (videoId: number) => {
    if (!isAuthenticated) {
      if (Platform.OS === "web") alert("请先登录");
      else Alert.alert("提示", "请先登录后再点赞");
      return;
    }
    likeMutation.mutate({ videoId });
  };

  const handleToggleFavorite = (videoId: number) => {
    if (!isAuthenticated) {
      if (Platform.OS === "web") alert("请先登录");
      else Alert.alert("提示", "请先登录后再收藏");
      return;
    }
    favoriteMutation.mutate({ videoId });
  };

  const handleOpenComments = (videoId: number) => {
    setCommentVideoId(videoId);
  };

  const handleSubmitComment = () => {
    if (!isAuthenticated) {
      if (Platform.OS === "web") alert("请先登录");
      else Alert.alert("提示", "请先登录后再评论");
      return;
    }
    if (!commentText.trim()) return;
    if (commentVideoId == null) return;
    addCommentMutation.mutate({ videoId: commentVideoId, content: commentText.trim() });
  };

  const handleDeleteComment = (commentId: number) => {
    if (Platform.OS === "web") {
      if (confirm("确定删除此评论？")) deleteCommentMutation.mutate({ commentId });
    } else {
      Alert.alert("确认", "确定删除此评论？", [
        { text: "取消", style: "cancel" },
        { text: "删除", style: "destructive", onPress: () => deleteCommentMutation.mutate({ commentId }) },
      ]);
    }
  };

  // 排序
  const sortedVideos = [...videos].sort((a: any, b: any) => {
    if (sortBy === "score") return (b.viralScore || 0) - (a.viralScore || 0);
    if (sortBy === "popular") return (b.likeCount || 0) - (a.likeCount || 0);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const isLoading = showcaseQuery.isLoading;

  return (
    <ScreenContainer>
      {/* 顶部导航 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={24} color="#ECEDEE" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>爆款展厅</Text>
        <TouchableOpacity
          onPress={() => router.push("/video-submit" as any)}
          style={styles.submitEntryBtn}
          activeOpacity={0.7}
        >
          <MaterialIcons name="upload" size={18} color="#FF6B35" />
          <Text style={styles.submitEntryText}>投稿</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF6B35" />
          <Text style={styles.loadingText}>加载展厅中...</Text>
        </View>
      ) : (
        <FlatList
          data={sortedVideos}
          keyExtractor={(item) => String(item.id)}
          ListHeaderComponent={
            <>
              <ShowcaseHero />
              {/* 排序选项 */}
              <View style={styles.sortRow}>
                <Text style={styles.sortLabel}>共 {videos.length} 个爆款视频</Text>
                <View style={styles.sortBtns}>
                  {SORT_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.id}
                      style={[styles.sortBtn, sortBy === opt.id && styles.sortBtnActive]}
                      onPress={() => setSortBy(opt.id)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons
                        name={opt.icon as any}
                        size={14}
                        color={sortBy === opt.id ? "#FF6B35" : "#9BA1A6"}
                      />
                      <Text style={[styles.sortBtnText, sortBy === opt.id && styles.sortBtnTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </>
          }
          renderItem={({ item, index }) => (
            <ShowcaseCard
              video={item}
              index={index}
              isLiked={likedIds.has(item.id)}
              isFavorited={favoritedIds.has(item.id)}
              onToggleLike={handleToggleLike}
              onToggleFavorite={handleToggleFavorite}
              onOpenComments={handleOpenComments}
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B35" />
          }
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialIcons name="video-library" size={64} color="#333" />
              <Text style={styles.emptyTitle}>展厅暂无内容</Text>
              <Text style={styles.emptyDesc}>
                目前还没有 90 分以上的爆款视频{"\n"}
                成为第一个入选展厅的创作者吧！
              </Text>
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => router.push("/video-submit" as any)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="upload" size={20} color="#FFF" />
                <Text style={styles.emptyBtnText}>提交我的视频</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* ─── 评论 Modal ─── */}
      <Modal
        visible={commentVideoId != null}
        transparent
        animationType="slide"
        onRequestClose={() => setCommentVideoId(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.commentModalOverlay}
        >
          <View style={styles.commentModalContent}>
            {/* 标题 */}
            <View style={styles.commentModalHeader}>
              <Text style={styles.commentModalTitle}>
                评论 ({commentsQuery.data?.total || 0})
              </Text>
              <TouchableOpacity onPress={() => setCommentVideoId(null)} activeOpacity={0.7}>
                <MaterialIcons name="close" size={24} color="#ECEDEE" />
              </TouchableOpacity>
            </View>

            {/* 评论列表 */}
            {commentsQuery.isLoading ? (
              <View style={styles.commentLoading}>
                <ActivityIndicator size="small" color="#FF6B35" />
              </View>
            ) : (
              <FlatList
                data={commentsQuery.data?.comments || []}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => (
                  <CommentItem
                    comment={item}
                    onDelete={handleDeleteComment}
                    isOwner={item.userId === user?.id}
                  />
                )}
                style={styles.commentList}
                contentContainerStyle={{ paddingBottom: 16 }}
                ListEmptyComponent={
                  <View style={styles.commentEmpty}>
                    <MaterialIcons name="chat-bubble-outline" size={40} color="#333" />
                    <Text style={styles.commentEmptyText}>暂无评论，来说两句吧</Text>
                  </View>
                }
              />
            )}

            {/* 输入框 */}
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                value={commentText}
                onChangeText={setCommentText}
                placeholder="写下你的评论..."
                placeholderTextColor="#555"
                maxLength={500}
                multiline
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[styles.commentSendBtn, !commentText.trim() && { opacity: 0.4 }]}
                onPress={handleSubmitComment}
                disabled={!commentText.trim() || addCommentMutation.isPending}
                activeOpacity={0.7}
              >
                {addCommentMutation.isPending ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <MaterialIcons name="send" size={20} color="#FFF" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

// ─── 样式 ──────────────────────────────────────
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#2C2C2E" },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1C1C1E", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#ECEDEE" },
  submitEntryBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,107,53,0.15)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  submitEntryText: { fontSize: 14, fontWeight: "600", color: "#FF6B35" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: "#9BA1A6", fontSize: 14 },
  // Hero
  heroContainer: { marginBottom: 16 },
  heroGradient: { backgroundColor: "#1C1C1E", borderRadius: 20, padding: 24, alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#2C2C2E" },
  heroIconRow: { flexDirection: "row", gap: 12, marginBottom: 4 },
  heroTitle: { fontSize: 28, fontWeight: "900", color: "#ECEDEE", letterSpacing: 1 },
  heroSubtitle: { fontSize: 14, color: "#9BA1A6", textAlign: "center", lineHeight: 22 },
  heroStats: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  heroStatItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  heroStatText: { fontSize: 12, color: "#9BA1A6" },
  heroStatDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#555" },
  // Sort
  sortRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  sortLabel: { fontSize: 14, fontWeight: "600", color: "#9BA1A6" },
  sortBtns: { flexDirection: "row", gap: 8 },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#1C1C1E" },
  sortBtnActive: { backgroundColor: "rgba(255,107,53,0.15)" },
  sortBtnText: { fontSize: 12, fontWeight: "600", color: "#9BA1A6" },
  sortBtnTextActive: { color: "#FF6B35" },
  // Card
  card: { backgroundColor: "#1C1C1E", borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: "#2C2C2E" },
  cardImageWrap: { width: "100%", height: 200, position: "relative" },
  cardImage: { width: "100%", height: "100%" },
  cardImagePlaceholder: { width: "100%", height: "100%", backgroundColor: "#2C2C2E", alignItems: "center", justifyContent: "center" },
  rankBadge: { position: "absolute", top: 12, left: 12, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rankText: { fontSize: 13, fontWeight: "900", color: "#000" },
  scoreBadge: { position: "absolute", top: 12, right: 12, width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  scoreText: { fontSize: 18, fontWeight: "900", color: "#000" },
  tierTag: { position: "absolute", bottom: 12, left: 12, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  tierText: { fontSize: 12, fontWeight: "700" },
  cardBody: { padding: 16, gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: "700", color: "#ECEDEE", lineHeight: 24 },
  creatorRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  creatorName: { fontSize: 13, color: "#9BA1A6", fontWeight: "500" },
  platformRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  platformBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  platformBtnText: { fontSize: 12, fontWeight: "600" },
  summaryBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "rgba(199,125,186,0.08)", padding: 10, borderRadius: 10 },
  summaryText: { flex: 1, fontSize: 12, color: "#C77DBA", lineHeight: 18 },
  // Interaction row
  interactionRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: "#2C2C2E" },
  interactionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  interactionCount: { fontSize: 12, color: "#9BA1A6", fontWeight: "600" },
  rewardTag: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,214,10,0.12)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginLeft: "auto" },
  rewardText: { fontSize: 12, fontWeight: "700", color: "#FFD60A" },
  dateText: { fontSize: 12, color: "#666" },
  // Empty
  emptyContainer: { alignItems: "center", justifyContent: "center", paddingVertical: 60, paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: "#ECEDEE", marginTop: 8 },
  emptyDesc: { fontSize: 14, color: "#9BA1A6", textAlign: "center", lineHeight: 22 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FF6B35", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  emptyBtnText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  listContent: { padding: 16, paddingBottom: 100 },
  // Comment Modal
  commentModalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  commentModalContent: { backgroundColor: "#1C1C1E", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "70%", minHeight: 300 },
  commentModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#2C2C2E" },
  commentModalTitle: { fontSize: 17, fontWeight: "700", color: "#ECEDEE" },
  commentLoading: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  commentList: { flex: 1, paddingHorizontal: 16 },
  commentEmpty: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 8 },
  commentEmptyText: { fontSize: 14, color: "#666" },
  commentItem: { flexDirection: "row", gap: 10, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#2C2C2E" },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#2C2C2E", alignItems: "center", justifyContent: "center" },
  commentBody: { flex: 1, gap: 4 },
  commentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  commentAuthor: { fontSize: 13, fontWeight: "600", color: "#ECEDEE" },
  commentDate: { fontSize: 11, color: "#666" },
  commentContent: { fontSize: 14, color: "#ECEDEE", lineHeight: 20 },
  commentDeleteBtn: { padding: 4 },
  commentInputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 0.5, borderTopColor: "#2C2C2E" },
  commentInput: { flex: 1, backgroundColor: "#2C2C2E", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: "#ECEDEE", maxHeight: 80, borderWidth: 0.5, borderColor: "#3A3A3C" },
  commentSendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#FF6B35", alignItems: "center", justifyContent: "center" },
});
