import { useState, useCallback } from "react";
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
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWeb = Platform.OS === "web";
const isWide = isWeb && SCREEN_WIDTH > 768;

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

function getStatusInfo(status: string): { label: string; color: string; icon: string } {
  switch (status) {
    case "analyzing":
      return { label: "分析中", color: "#64D2FF", icon: "hourglass-top" };
    case "scored":
      return { label: "已评分", color: "#30D158", icon: "check-circle" };
    case "rejected":
      return { label: "已拒绝", color: "#FF453A", icon: "cancel" };
    case "manual_review":
      return { label: "人工复审", color: "#FF9F0A", icon: "pending" };
    default:
      return { label: "待处理", color: "#9BA1A6", icon: "schedule" };
  }
}

function getCreditsReward(score: number | null): { amount: number; label: string } {
  if (!score) return { amount: 0, label: "—" };
  if (score >= 90) return { amount: 80, label: "+80 Credits" };
  if (score >= 80) return { amount: 30, label: "+30 Credits" };
  return { amount: 0, label: "未达标" };
}

// ─── 视频卡片组件 ──────────────────────────────
function VideoCard({ video, onPress }: { video: any; onPress: () => void }) {
  const status = getStatusInfo(video.status);
  const reward = getCreditsReward(video.viralScore);
  const scoreColor = getScoreColor(video.viralScore);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* 缩略图 */}
      <View style={styles.cardImageContainer}>
        {video.thumbnailUrl ? (
          <Image
            source={{ uri: video.thumbnailUrl }}
            style={styles.cardImage}
            contentFit="cover"
          />
        ) : (
          <View style={styles.cardImagePlaceholder}>
            <MaterialIcons name="videocam" size={32} color="#555" />
          </View>
        )}
        {/* 评分徽章 */}
        {video.viralScore !== null && (
          <View style={[styles.scoreBadge, { backgroundColor: scoreColor }]}>
            <Text style={styles.scoreBadgeText}>{video.viralScore}</Text>
          </View>
        )}
        {/* 状态标签 */}
        <View style={[styles.statusTag, { backgroundColor: status.color + "20" }]}>
          <MaterialIcons name={status.icon as any} size={12} color={status.color} />
          <Text style={[styles.statusTagText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      {/* 内容区 */}
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={1}>{video.title}</Text>

        {/* 平台标签 */}
        {video.platformLinks && video.platformLinks.length > 0 && (
          <View style={styles.platformRow}>
            {video.platformLinks.map((link: any, idx: number) => (
              <View
                key={idx}
                style={[
                  styles.platformTag,
                  { backgroundColor: (PLATFORM_COLORS[link.platform] || "#555") + "20" },
                ]}
              >
                <Text
                  style={[
                    styles.platformTagText,
                    { color: PLATFORM_COLORS[link.platform] || "#999" },
                  ]}
                >
                  {PLATFORM_NAMES[link.platform] || link.platform}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* 底部信息 */}
        <View style={styles.cardFooter}>
          {/* 评分 */}
          <View style={styles.footerLeft}>
            {video.viralScore !== null ? (
              <>
                <Text style={[styles.scoreLabel, { color: scoreColor }]}>
                  {getScoreLabel(video.viralScore)}
                </Text>
                <Text style={styles.footerDot}>·</Text>
              </>
            ) : null}
            <Text style={styles.footerDate}>
              {new Date(video.createdAt).toLocaleDateString("zh-TW")}
            </Text>
          </View>

          {/* Credits 奖励 */}
          {reward.amount > 0 ? (
            <View style={styles.rewardBadge}>
              <MaterialIcons name="stars" size={14} color="#FFD60A" />
              <Text style={styles.rewardText}>{reward.label}</Text>
            </View>
          ) : video.status === "scored" && reward.amount === 0 ? (
            <Text style={styles.noRewardText}>{reward.label}</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
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
    <View style={styles.statsContainer}>
      <View style={styles.statItem}>
        <Text style={styles.statValue}>{totalVideos}</Text>
        <Text style={styles.statLabel}>已提交</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statItem}>
        <Text style={[styles.statValue, { color: "#30D158" }]}>{viralCount}</Text>
        <Text style={styles.statLabel}>爆款</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statItem}>
        <Text style={[styles.statValue, { color: "#64D2FF" }]}>{avgScore}</Text>
        <Text style={styles.statLabel}>平均分</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statItem}>
        <Text style={[styles.statValue, { color: "#FFD60A" }]}>{totalCredits}</Text>
        <Text style={styles.statLabel}>Credits</Text>
      </View>
    </View>
  );
}

// ─── 主页面 ──────────────────────────────────
export default function MyVideosScreen() {
  const router = useRouter();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const videosQuery = trpc.videoSubmission.getMyVideos.useQuery(
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
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B35" />
      </ScreenContainer>
    );
  }

  if (!isAuthenticated) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <MaterialIcons name="lock" size={48} color="#555" />
        <Text style={styles.emptyTitle}>请先登录</Text>
        <Text style={styles.emptyDesc}>登录后即可查看您的视频提交记录</Text>
        <TouchableOpacity
          style={styles.loginBtn}
          onPress={() => router.push("/login" as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.loginBtnText}>前往登录</Text>
        </TouchableOpacity>
      </ScreenContainer>
    );
  }

  const videos = videosQuery.data?.videos || [];
  const isLoading = videosQuery.isLoading;

  return (
    <ScreenContainer>
      {/* 顶部导航 */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <MaterialIcons name="arrow-back" size={24} color="#ECEDEE" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>我的视频</Text>
        <TouchableOpacity
          onPress={() => router.push("/video-submit" as any)}
          style={styles.addBtn}
          activeOpacity={0.7}
        >
          <MaterialIcons name="add" size={24} color="#FF6B35" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF6B35" />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      ) : videos.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="video-library" size={64} color="#333" />
          <Text style={styles.emptyTitle}>还没有提交视频</Text>
          <Text style={styles.emptyDesc}>
            上传您在抖音、视频号、小红书、B站发布的爆款视频{"\n"}
            AI 自动评分，80 分以上可获得 Credits 奖励
          </Text>
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={() => router.push("/video-submit" as any)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="upload" size={20} color="#FFF" />
            <Text style={styles.submitBtnText}>提交视频</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item) => String(item.id)}
          ListHeaderComponent={<StatsCard videos={videos} />}
          renderItem={({ item }) => (
            <VideoCard
              video={item}
              onPress={() => {
                // 可以导航到详情页，目前先用 Alert
              }}
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#FF6B35"
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </ScreenContainer>
  );
}

// ─── 样式 ──────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "#2C2C2E",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ECEDEE",
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,107,53,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    color: "#9BA1A6",
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ECEDEE",
    marginTop: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: "#9BA1A6",
    textAlign: "center",
    lineHeight: 22,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FF6B35",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  submitBtnText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  loginBtn: {
    backgroundColor: "#FF6B35",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  loginBtnText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  // ─── Stats ───
  statsContainer: {
    flexDirection: "row",
    backgroundColor: "#1C1C1E",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#ECEDEE",
  },
  statLabel: {
    fontSize: 12,
    color: "#9BA1A6",
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: "#2C2C2E",
  },
  // ─── Card ───
  card: {
    backgroundColor: "#1C1C1E",
    borderRadius: 16,
    overflow: "hidden",
  },
  cardImageContainer: {
    width: "100%",
    height: 180,
    position: "relative",
  },
  cardImage: {
    width: "100%",
    height: "100%",
  },
  cardImagePlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#2C2C2E",
    alignItems: "center",
    justifyContent: "center",
  },
  scoreBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreBadgeText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#000",
  },
  statusTag: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusTagText: {
    fontSize: 11,
    fontWeight: "600",
  },
  cardContent: {
    padding: 14,
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ECEDEE",
  },
  platformRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  platformTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  platformTagText: {
    fontSize: 11,
    fontWeight: "600",
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  footerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scoreLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  footerDot: {
    color: "#555",
    fontSize: 12,
  },
  footerDate: {
    fontSize: 12,
    color: "#9BA1A6",
  },
  rewardBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,214,10,0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rewardText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFD60A",
  },
  noRewardText: {
    fontSize: 12,
    color: "#9BA1A6",
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
});
