import { useState, useCallback } from "react";
import {
  Text,
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Modal,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";

// ─── 状态标签颜色 ──────────────────────────────
const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "待审核", color: "#FF9F0A", bg: "rgba(255,159,10,0.15)" },
  scoring: { label: "评分中", color: "#5AC8FA", bg: "rgba(90,200,250,0.15)" },
  scored: { label: "已评分", color: "#30D158", bg: "rgba(48,209,88,0.15)" },
  failed: { label: "失败", color: "#FF453A", bg: "rgba(255,69,58,0.15)" },
};

const PLATFORM_NAMES: Record<string, string> = {
  douyin: "抖音",
  weixin_channels: "视频号",
  xiaohongshu: "小红书",
  bilibili: "B站",
};

type FilterStatus = "all" | "pending" | "scoring" | "scored" | "failed";

export default function AdminVideoReviewScreen() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<any>(null);
  const [adjustScore, setAdjustScore] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [flagNotes, setFlagNotes] = useState("");
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [showFlagModal, setShowFlagModal] = useState(false);

  const videosQuery = trpc.showcase.adminGetAllVideos.useQuery(
    { status: filterStatus, limit: 50, offset: 0 },
    { enabled: isAuthenticated && user?.role === "admin" }
  );

  const adjustMutation = trpc.showcase.adminAdjustScore.useMutation({
    onSuccess: (data) => {
      if (Platform.OS === "web") alert(data.message);
      else Alert.alert("成功", data.message);
      setShowScoreModal(false);
      setAdjustScore("");
      setAdjustNotes("");
      videosQuery.refetch();
    },
    onError: (err) => {
      if (Platform.OS === "web") alert(err.message);
      else Alert.alert("错误", err.message);
    },
  });

  const flagMutation = trpc.showcase.adminFlagVideo.useMutation({
    onSuccess: () => {
      if (Platform.OS === "web") alert("操作成功");
      else Alert.alert("成功", "操作成功");
      setShowFlagModal(false);
      setFlagNotes("");
      videosQuery.refetch();
    },
    onError: (err) => {
      if (Platform.OS === "web") alert(err.message);
      else Alert.alert("错误", err.message);
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await videosQuery.refetch();
    setRefreshing(false);
  }, [videosQuery]);

  // ─── 权限检查 ──────────────────────────────
  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <ScreenContainer className="p-6">
        <View style={styles.centerContainer}>
          <MaterialIcons name="lock" size={64} color="#FF453A" />
          <Text style={styles.errorTitle}>无权限访问</Text>
          <Text style={styles.errorDesc}>此页面仅限管理员使用</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
            <Text style={styles.backButtonText}>返回</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
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

  const renderVideoCard = ({ item }: { item: any }) => {
    const status = STATUS_MAP[item.scoreStatus] || STATUS_MAP.pending;
    return (
      <View style={styles.card}>
        {/* 顶部：缩略图 + 基本信息 */}
        <View style={styles.cardHeader}>
          {item.thumbnailUrl ? (
            <Image source={{ uri: item.thumbnailUrl }} style={styles.thumbnail} contentFit="cover" />
          ) : (
            <View style={styles.thumbnailPlaceholder}>
              <MaterialIcons name="videocam" size={24} color="#555" />
            </View>
          )}
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
            <View style={styles.metaRow}>
              <MaterialIcons name="person" size={12} color="#9BA1A6" />
              <Text style={styles.metaText}>{item.user?.name || item.user?.email || `用户 #${item.userId}`}</Text>
            </View>
            <View style={styles.metaRow}>
              <MaterialIcons name="schedule" size={12} color="#9BA1A6" />
              <Text style={styles.metaText}>{new Date(item.createdAt).toLocaleString("zh-TW")}</Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>

        {/* 评分信息 */}
        {item.viralScore != null && (
          <View style={styles.scoreRow}>
            <View style={styles.scoreCircle}>
              <Text style={styles.scoreValue}>{item.viralScore}</Text>
              <Text style={styles.scoreLabel}>分</Text>
            </View>
            <View style={styles.rewardInfo}>
              <Text style={styles.rewardLabel}>Credits 奖励</Text>
              <Text style={[styles.rewardValue, { color: item.creditsRewarded > 0 ? "#30D158" : "#9BA1A6" }]}>
                {item.creditsRewarded > 0 ? `+${item.creditsRewarded}` : "无"}
              </Text>
            </View>
            <View style={styles.rewardInfo}>
              <Text style={styles.rewardLabel}>展示状态</Text>
              <Text style={[styles.rewardValue, { color: item.showcaseStatus === "showcased" ? "#FF6B35" : "#9BA1A6" }]}>
                {item.showcaseStatus === "showcased" ? "展厅展示" : item.showcaseStatus === "rejected" ? "已拒绝" : "未展示"}
              </Text>
            </View>
          </View>
        )}

        {/* 平台链接 */}
        {item.platformLinks && item.platformLinks.length > 0 && (
          <View style={styles.platformRow}>
            {item.platformLinks.map((link: any, idx: number) => (
              <View key={idx} style={styles.platformTag}>
                <Text style={styles.platformTagText}>
                  {PLATFORM_NAMES[link.platform] || link.platform}
                </Text>
                {link.playCount != null && (
                  <Text style={styles.platformStat}>播放 {(link.playCount / 10000).toFixed(1)}万</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* 管理员备注 */}
        {item.adminNotes && (
          <View style={styles.notesBox}>
            <MaterialIcons name="notes" size={14} color="#9BA1A6" />
            <Text style={styles.notesText} numberOfLines={2}>{item.adminNotes}</Text>
          </View>
        )}

        {/* 操作按钮 */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnScore]}
            onPress={() => {
              setSelectedVideo(item);
              setAdjustScore(String(item.viralScore || ""));
              setShowScoreModal(true);
            }}
            activeOpacity={0.7}
          >
            <MaterialIcons name="edit" size={16} color="#5AC8FA" />
            <Text style={[styles.actionBtnText, { color: "#5AC8FA" }]}>调整评分</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnFlag]}
            onPress={() => {
              setSelectedVideo(item);
              setShowFlagModal(true);
            }}
            activeOpacity={0.7}
          >
            <MaterialIcons name="flag" size={16} color="#FF9F0A" />
            <Text style={[styles.actionBtnText, { color: "#FF9F0A" }]}>标记/处理</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer>
      {/* 顶部导航 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={24} color="#ECEDEE" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>视频审核面板</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 统计摘要 */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{total}</Text>
          <Text style={styles.statLabel}>总视频</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: "#FF9F0A" }]}>
            {videos.filter((v: any) => v.scoreStatus === "pending").length}
          </Text>
          <Text style={styles.statLabel}>待审核</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: "#30D158" }]}>
            {videos.filter((v: any) => v.scoreStatus === "scored").length}
          </Text>
          <Text style={styles.statLabel}>已评分</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: "#FF453A" }]}>
            {videos.filter((v: any) => v.scoreStatus === "failed").length}
          </Text>
          <Text style={styles.statLabel}>失败</Text>
        </View>
      </View>

      {/* 筛选器 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.filterBtn, filterStatus === f.id && styles.filterBtnActive]}
            onPress={() => setFilterStatus(f.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterBtnText, filterStatus === f.id && styles.filterBtnTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 视频列表 */}
      {videosQuery.isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#5AC8FA" />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderVideoCard}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#5AC8FA" />}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.centerContainer}>
              <MaterialIcons name="inbox" size={64} color="#333" />
              <Text style={styles.emptyText}>暂无视频</Text>
            </View>
          }
        />
      )}

      {/* 评分调整 Modal */}
      <Modal visible={showScoreModal} transparent animationType="fade" onRequestClose={() => setShowScoreModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>调整评分</Text>
            <Text style={styles.modalSubtitle}>
              {selectedVideo?.title} (当前: {selectedVideo?.viralScore ?? "未评分"})
            </Text>

            <Text style={styles.inputLabel}>新评分 (0-100)</Text>
            <TextInput
              style={styles.input}
              value={adjustScore}
              onChangeText={setAdjustScore}
              keyboardType="numeric"
              placeholder="输入新评分"
              placeholderTextColor="#555"
              maxLength={3}
            />

            <Text style={styles.inputLabel}>备注（选填）</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={adjustNotes}
              onChangeText={setAdjustNotes}
              placeholder="调整原因"
              placeholderTextColor="#555"
              multiline
              numberOfLines={3}
            />

            {/* 奖励预览 */}
            {adjustScore && (
              <View style={styles.rewardPreview}>
                <Text style={styles.rewardPreviewText}>
                  评分 {adjustScore} 分 → Credits 奖励:{" "}
                  {Number(adjustScore) >= 90 ? "80" : Number(adjustScore) >= 80 ? "30" : "0"}
                </Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowScoreModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, adjustMutation.isPending && { opacity: 0.5 }]}
                onPress={() => {
                  if (!adjustScore || isNaN(Number(adjustScore))) return;
                  adjustMutation.mutate({
                    videoId: selectedVideo.id,
                    newScore: Number(adjustScore),
                    notes: adjustNotes || undefined,
                  });
                }}
                disabled={adjustMutation.isPending}
                activeOpacity={0.7}
              >
                {adjustMutation.isPending ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>确认调整</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 标记/处理 Modal */}
      <Modal visible={showFlagModal} transparent animationType="fade" onRequestClose={() => setShowFlagModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>标记 / 处理视频</Text>
            <Text style={styles.modalSubtitle}>{selectedVideo?.title}</Text>

            <Text style={styles.inputLabel}>备注（选填）</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={flagNotes}
              onChangeText={setFlagNotes}
              placeholder="处理原因"
              placeholderTextColor="#555"
              multiline
              numberOfLines={3}
            />

            <View style={styles.flagActions}>
              <TouchableOpacity
                style={[styles.flagBtn, { backgroundColor: "rgba(255,159,10,0.15)" }]}
                onPress={() => flagMutation.mutate({ videoId: selectedVideo.id, action: "flag", notes: flagNotes || undefined })}
                activeOpacity={0.7}
              >
                <MaterialIcons name="flag" size={20} color="#FF9F0A" />
                <Text style={[styles.flagBtnText, { color: "#FF9F0A" }]}>标记异常</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.flagBtn, { backgroundColor: "rgba(48,209,88,0.15)" }]}
                onPress={() => flagMutation.mutate({ videoId: selectedVideo.id, action: "unflag", notes: flagNotes || undefined })}
                activeOpacity={0.7}
              >
                <MaterialIcons name="check-circle" size={20} color="#30D158" />
                <Text style={[styles.flagBtnText, { color: "#30D158" }]}>解除标记</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.flagBtn, { backgroundColor: "rgba(255,69,58,0.15)" }]}
                onPress={() => flagMutation.mutate({ videoId: selectedVideo.id, action: "reject", notes: flagNotes || undefined })}
                activeOpacity={0.7}
              >
                <MaterialIcons name="block" size={20} color="#FF453A" />
                <Text style={[styles.flagBtnText, { color: "#FF453A" }]}>拒绝展示</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setShowFlagModal(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.modalCancelText}>关闭</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#2C2C2E" },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1C1C1E", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#ECEDEE" },
  statsRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  statCard: { flex: 1, backgroundColor: "#1C1C1E", borderRadius: 12, padding: 12, alignItems: "center", gap: 4 },
  statValue: { fontSize: 22, fontWeight: "800", color: "#ECEDEE" },
  statLabel: { fontSize: 11, color: "#9BA1A6" },
  filterScroll: { maxHeight: 44, marginBottom: 8 },
  filterContent: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: "#1C1C1E" },
  filterBtnActive: { backgroundColor: "rgba(90,200,250,0.15)" },
  filterBtnText: { fontSize: 13, color: "#9BA1A6", fontWeight: "600" },
  filterBtnTextActive: { color: "#5AC8FA" },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  card: { backgroundColor: "#1C1C1E", borderRadius: 16, padding: 16, gap: 12, borderWidth: 0.5, borderColor: "#2C2C2E" },
  cardHeader: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  thumbnail: { width: 64, height: 64, borderRadius: 10 },
  thumbnailPlaceholder: { width: 64, height: 64, borderRadius: 10, backgroundColor: "#2C2C2E", alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#ECEDEE", lineHeight: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 11, color: "#9BA1A6" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: "700" },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: "#2C2C2E" },
  scoreCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#2C2C2E", alignItems: "center", justifyContent: "center" },
  scoreValue: { fontSize: 20, fontWeight: "900", color: "#ECEDEE" },
  scoreLabel: { fontSize: 10, color: "#9BA1A6" },
  rewardInfo: { gap: 2 },
  rewardLabel: { fontSize: 11, color: "#9BA1A6" },
  rewardValue: { fontSize: 14, fontWeight: "700" },
  platformRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  platformTag: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#2C2C2E", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  platformTagText: { fontSize: 11, color: "#ECEDEE", fontWeight: "600" },
  platformStat: { fontSize: 10, color: "#9BA1A6" },
  notesBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "#2C2C2E", padding: 10, borderRadius: 8 },
  notesText: { fontSize: 12, color: "#9BA1A6", flex: 1, lineHeight: 18 },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  actionBtnScore: { backgroundColor: "rgba(90,200,250,0.1)" },
  actionBtnFlag: { backgroundColor: "rgba(255,159,10,0.1)" },
  actionBtnText: { fontSize: 13, fontWeight: "600" },
  centerContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  errorTitle: { fontSize: 20, fontWeight: "700", color: "#ECEDEE" },
  errorDesc: { fontSize: 14, color: "#9BA1A6" },
  backButton: { backgroundColor: "#2C2C2E", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  backButtonText: { color: "#ECEDEE", fontSize: 14, fontWeight: "600" },
  loadingText: { color: "#9BA1A6", fontSize: 14 },
  emptyText: { color: "#9BA1A6", fontSize: 16 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalContent: { backgroundColor: "#1C1C1E", borderRadius: 20, padding: 24, width: "100%", maxWidth: 400, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#ECEDEE" },
  modalSubtitle: { fontSize: 13, color: "#9BA1A6", lineHeight: 18 },
  inputLabel: { fontSize: 13, fontWeight: "600", color: "#ECEDEE", marginTop: 4 },
  input: { backgroundColor: "#2C2C2E", borderRadius: 10, padding: 12, fontSize: 15, color: "#ECEDEE", borderWidth: 0.5, borderColor: "#3A3A3C" },
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  rewardPreview: { backgroundColor: "rgba(48,209,88,0.1)", padding: 10, borderRadius: 8 },
  rewardPreviewText: { fontSize: 13, color: "#30D158", fontWeight: "600" },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  modalCancelBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 10, backgroundColor: "#2C2C2E" },
  modalCancelText: { fontSize: 14, fontWeight: "600", color: "#9BA1A6" },
  modalConfirmBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 10, backgroundColor: "#5AC8FA" },
  modalConfirmText: { fontSize: 14, fontWeight: "700", color: "#FFF" },
  flagActions: { gap: 8, marginTop: 4 },
  flagBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 10 },
  flagBtnText: { fontSize: 14, fontWeight: "600" },
});
