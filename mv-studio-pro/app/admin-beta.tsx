import { Text, View, TouchableOpacity, StyleSheet, Platform, Dimensions, ScrollView, TextInput, FlatList, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";

const isWeb = Platform.OS === "web";
const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Beta Tester levels
const BETA_LEVELS = [
  { name: "Starter", minReferrals: 0, color: "#9B9691", icon: "person" as const },
  { name: "Advocate", minReferrals: 3, color: "#64D2FF", icon: "thumb-up" as const },
  { name: "Ambassador", minReferrals: 10, color: "#30D158", icon: "star" as const },
  { name: "Champion", minReferrals: 25, color: "#FF9F0A", icon: "emoji-events" as const },
  { name: "Legend", minReferrals: 50, color: "#FF375F", icon: "whatshot" as const },
];

function getBetaLevel(referralCount: number) {
  for (let i = BETA_LEVELS.length - 1; i >= 0; i--) {
    if (referralCount >= BETA_LEVELS[i].minReferrals) return BETA_LEVELS[i];
  }
  return BETA_LEVELS[0];
}

type TabType = "manage" | "leaderboard";

export default function AdminBetaScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>("manage");
  const [grantEmail, setGrantEmail] = useState("");
  const [grantQuota, setGrantQuota] = useState("20");
  const [isGranting, setIsGranting] = useState(false);
  const [grantSuccess, setGrantSuccess] = useState("");
  const [grantError, setGrantError] = useState("");

  // tRPC queries
  const betaUsersQuery = trpc.beta.listBetaUsers.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading && user?.role === "admin",
  });
  const leaderboardQuery = trpc.beta.leaderboard.useQuery({ limit: 20 }, {
    enabled: isAuthenticated && !authLoading,
  });

  // tRPC mutations
  const grantMutation = trpc.beta.grantQuota.useMutation();
  const revokeMutation = trpc.beta.revokeQuota.useMutation();
  const lookupMutation = trpc.beta.lookupUserByEmail.useMutation();

  const handleGrant = useCallback(async () => {
    setGrantError("");
    setGrantSuccess("");
    if (!grantEmail.trim()) {
      setGrantError("请输入 Email 地址");
      return;
    }
    const quota = parseInt(grantQuota, 10);
    if (isNaN(quota) || quota <= 0) {
      setGrantError("请输入有效的配额数量");
      return;
    }
    setIsGranting(true);
    try {
      // First look up user by email, then grant quota
      const lookupResult = await lookupMutation.mutateAsync({ email: grantEmail.trim() });
      const result = await grantMutation.mutateAsync({
        userId: lookupResult.userId,
        totalQuota: quota,
      });
      setGrantSuccess(result.message);
      setGrantEmail("");
      betaUsersQuery.refetch();
      setTimeout(() => setGrantSuccess(""), 3000);
    } catch (err: any) {
      setGrantError(err.message || "授予配额失败");
    } finally {
      setIsGranting(false);
    }
  }, [grantEmail, grantQuota, grantMutation, lookupMutation, betaUsersQuery]);

  const handleRevoke = useCallback(async (userId: number, userName: string) => {
    const doRevoke = async () => {
      try {
        await revokeMutation.mutateAsync({ userId });
        betaUsersQuery.refetch();
      } catch (err: any) {
        if (isWeb) alert("撤销失败: " + (err.message || "未知错误"));
      }
    };

    if (isWeb) {
      if (confirm(`确定要撤销 ${userName} 的内测资格吗？`)) {
        await doRevoke();
      }
    } else {
      Alert.alert("确认撤销", `确定要撤销 ${userName} 的内测资格吗？`, [
        { text: "取消", style: "cancel" },
        { text: "确认撤销", style: "destructive", onPress: doRevoke },
      ]);
    }
  }, [revokeMutation, betaUsersQuery]);

  // Auth guard
  if (authLoading) {
    return (
      <ScreenContainer className="p-6">
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#FF6B6B" />
        </View>
      </ScreenContainer>
    );
  }

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <ScreenContainer className="p-6">
        <View style={styles.centerContainer}>
          <MaterialIcons name="lock" size={48} color="#9B9691" />
          <Text style={styles.noAccessText}>仅管理员可访问此页面</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>返回</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  const renderManageTab = () => (
    <View style={styles.tabContent}>
      {/* Grant Quota Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>授予内测配额</Text>
        <Text style={styles.sectionDesc}>输入用户 Email 和配额数量，授予内测资格</Text>

        <TextInput
          style={styles.input}
          placeholder="用户 Email 地址"
          placeholderTextColor="#6B6560"
          value={grantEmail}
          onChangeText={setGrantEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <View style={styles.quotaRow}>
          <Text style={styles.quotaLabel}>配额次数：</Text>
          {["20", "40", "100"].map((q) => (
            <TouchableOpacity
              key={q}
              style={[styles.quotaChip, grantQuota === q && styles.quotaChipActive]}
              onPress={() => setGrantQuota(q)}
              activeOpacity={0.7}
            >
              <Text style={[styles.quotaChipText, grantQuota === q && styles.quotaChipTextActive]}>
                {q} 次
              </Text>
            </TouchableOpacity>
          ))}
          <TextInput
            style={styles.quotaInput}
            placeholder="自订"
            placeholderTextColor="#6B6560"
            value={!["20", "40", "100"].includes(grantQuota) ? grantQuota : ""}
            onChangeText={(text) => setGrantQuota(text.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            onFocus={() => { if (["20", "40", "100"].includes(grantQuota)) setGrantQuota(""); }}
          />
        </View>

        {grantSuccess ? (
          <View style={styles.successBanner}>
            <MaterialIcons name="check-circle" size={16} color="#30D158" />
            <Text style={styles.successText}>{grantSuccess}</Text>
          </View>
        ) : null}

        {grantError ? <Text style={styles.errorText}>{grantError}</Text> : null}

        <TouchableOpacity
          style={[styles.grantBtn, isGranting && styles.grantBtnLoading]}
          onPress={handleGrant}
          activeOpacity={0.8}
          disabled={isGranting}
        >
          {isGranting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <MaterialIcons name="person-add" size={20} color="#FFFFFF" />
              <Text style={styles.grantBtnText}>授予内测资格</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Beta Users List */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>内测用户列表</Text>
          <Text style={styles.sectionCount}>
            {betaUsersQuery.data?.length ?? 0} 人
          </Text>
        </View>

        {betaUsersQuery.isLoading ? (
          <ActivityIndicator size="small" color="#FF6B6B" style={{ marginTop: 20 }} />
        ) : betaUsersQuery.data && betaUsersQuery.data.length > 0 ? (
          <View style={styles.userList}>
            {betaUsersQuery.data.map((betaUser: any) => {
              const level = getBetaLevel(betaUser.referralCount || 0);
              return (
                <View key={betaUser.id} style={styles.userCard}>
                  <View style={styles.userCardLeft}>
                    <View style={[styles.levelBadge, { backgroundColor: level.color + "20" }]}>
                      <MaterialIcons name={level.icon} size={16} color={level.color} />
                    </View>
                    <View style={styles.userInfo}>
                      <Text style={styles.userName}>{betaUser.email || betaUser.phone || "未知"}</Text>
                      <View style={styles.userMeta}>
                        <Text style={[styles.levelText, { color: level.color }]}>{level.name}</Text>
                        <Text style={styles.userMetaText}>
                          配额: {betaUser.usedQuota}/{betaUser.totalQuota}
                        </Text>
                        <Text style={styles.userMetaText}>
                          邀请: {betaUser.referralCount || 0}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.revokeBtn}
                    onPress={() => handleRevoke(betaUser.userId, betaUser.email || betaUser.phone || "用户")}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="remove-circle-outline" size={20} color="#FF375F" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <MaterialIcons name="group-add" size={40} color="#3A3530" />
            <Text style={styles.emptyText}>尚无内测用户</Text>
          </View>
        )}
      </View>
    </View>
  );

  const renderLeaderboardTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>邀请排行榜</Text>
        <Text style={styles.sectionDesc}>邀请最多朋友的内测用户排名</Text>

        {/* Level Legend */}
        <View style={styles.levelLegend}>
          {BETA_LEVELS.map((level) => (
            <View key={level.name} style={styles.levelLegendItem}>
              <View style={[styles.levelDot, { backgroundColor: level.color }]} />
              <Text style={styles.levelLegendText}>{level.name}</Text>
              <Text style={styles.levelLegendReq}>{level.minReferrals}+</Text>
            </View>
          ))}
        </View>

        {leaderboardQuery.isLoading ? (
          <ActivityIndicator size="small" color="#FF6B6B" style={{ marginTop: 20 }} />
        ) : leaderboardQuery.data && leaderboardQuery.data.length > 0 ? (
          <View style={styles.leaderboardList}>
            {leaderboardQuery.data.map((entry: any, index: number) => {
              const level = getBetaLevel(entry.referralCount);
              const isTop3 = index < 3;
              return (
                <View key={entry.id} style={[styles.leaderboardCard, isTop3 && styles.leaderboardCardTop]}>
                  <View style={styles.rankBadge}>
                    {isTop3 ? (
                      <MaterialIcons
                        name="emoji-events"
                        size={22}
                        color={index === 0 ? "#FFD700" : index === 1 ? "#C0C0C0" : "#CD7F32"}
                      />
                    ) : (
                      <Text style={styles.rankNumber}>{index + 1}</Text>
                    )}
                  </View>
                  <View style={styles.leaderboardInfo}>
                    <Text style={styles.leaderboardName}>{entry.email || "匿名用户"}</Text>
                    <View style={styles.leaderboardMeta}>
                      <View style={[styles.levelBadgeSmall, { backgroundColor: level.color + "20" }]}>
                        <MaterialIcons name={level.icon} size={12} color={level.color} />
                        <Text style={[styles.levelBadgeText, { color: level.color }]}>{level.name}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.referralCount}>
                    <Text style={styles.referralNumber}>{entry.referralCount}</Text>
                    <Text style={styles.referralLabel}>邀请</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <MaterialIcons name="leaderboard" size={40} color="#3A3530" />
            <Text style={styles.emptyText}>暂无排行数据</Text>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <ScreenContainer edges={isWeb ? [] : ["top", "left", "right"]} containerClassName="bg-background">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBackBtn} onPress={() => router.back()} activeOpacity={0.7}>
              <MaterialIcons name="arrow-back" size={22} color="#F7F4EF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>内测管理</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Tab Bar */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tab, activeTab === "manage" && styles.tabActive]}
              onPress={() => setActiveTab("manage")}
              activeOpacity={0.7}
            >
              <MaterialIcons name="admin-panel-settings" size={18} color={activeTab === "manage" ? "#FF6B6B" : "#6B6560"} />
              <Text style={[styles.tabText, activeTab === "manage" && styles.tabTextActive]}>用户管理</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === "leaderboard" && styles.tabActive]}
              onPress={() => setActiveTab("leaderboard")}
              activeOpacity={0.7}
            >
              <MaterialIcons name="leaderboard" size={18} color={activeTab === "leaderboard" ? "#FF6B6B" : "#6B6560"} />
              <Text style={[styles.tabText, activeTab === "leaderboard" && styles.tabTextActive]}>排行榜</Text>
            </TouchableOpacity>
          </View>

          {activeTab === "manage" ? renderManageTab() : renderLeaderboardTab()}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 40,
    maxWidth: 600,
    alignSelf: "center",
    width: "100%",
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  noAccessText: {
    fontSize: 16,
    color: "#9B9691",
  },
  backBtn: {
    backgroundColor: "rgba(255,107,107,0.15)",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  backBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FF6B6B",
  },

  /* Header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#F7F4EF",
  },

  /* Tab Bar */
  tabBar: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  tabActive: {
    backgroundColor: "rgba(255,107,107,0.12)",
  },
  tabText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#6B6560",
  },
  tabTextActive: {
    color: "#FF6B6B",
  },

  /* Tab Content */
  tabContent: {
    gap: 24,
  },

  /* Section */
  section: {
    backgroundColor: "rgba(30,20,40,0.6)",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#F7F4EF",
    marginBottom: 6,
  },
  sectionDesc: {
    fontSize: 13,
    color: "#9B9691",
    marginBottom: 16,
    lineHeight: 18,
  },
  sectionCount: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FF6B6B",
    backgroundColor: "rgba(255,107,107,0.1)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },

  /* Input */
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: "#F7F4EF",
    marginBottom: 12,
  },

  /* Quota Row */
  quotaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  quotaLabel: {
    fontSize: 14,
    color: "#9B9691",
    fontWeight: "500",
  },
  quotaChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  quotaChipActive: {
    backgroundColor: "rgba(255,107,107,0.15)",
    borderColor: "#FF6B6B",
  },
  quotaChipText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#9B9691",
  },
  quotaChipTextActive: {
    color: "#FF6B6B",
  },
  quotaInput: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: "#F7F4EF",
    width: 70,
    textAlign: "center",
  },

  /* Success / Error */
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(48,209,88,0.1)",
    borderWidth: 1,
    borderColor: "rgba(48,209,88,0.25)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  successText: {
    flex: 1,
    fontSize: 13,
    color: "#30D158",
    lineHeight: 18,
  },
  errorText: {
    fontSize: 13,
    color: "#FF6B6B",
    marginBottom: 12,
    textAlign: "center",
  },

  /* Grant Button */
  grantBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FF6B6B",
    paddingVertical: 14,
    borderRadius: 14,
  },
  grantBtnLoading: {
    opacity: 0.6,
  },
  grantBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  /* User List */
  userList: {
    gap: 10,
    marginTop: 12,
  },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  userCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  levelBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#F7F4EF",
    marginBottom: 4,
  },
  userMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  levelText: {
    fontSize: 12,
    fontWeight: "600",
  },
  userMetaText: {
    fontSize: 12,
    color: "#6B6560",
  },
  revokeBtn: {
    padding: 8,
  },

  /* Empty State */
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: "#6B6560",
  },

  /* Leaderboard */
  levelLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 12,
  },
  levelLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  levelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  levelLegendText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9B9691",
  },
  levelLegendReq: {
    fontSize: 11,
    color: "#6B6560",
  },

  leaderboardList: {
    gap: 8,
  },
  leaderboardCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    gap: 12,
  },
  leaderboardCardTop: {
    borderColor: "rgba(255,107,107,0.15)",
    backgroundColor: "rgba(255,107,107,0.04)",
  },
  rankBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  rankNumber: {
    fontSize: 16,
    fontWeight: "700",
    color: "#6B6560",
  },
  leaderboardInfo: {
    flex: 1,
  },
  leaderboardName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#F7F4EF",
    marginBottom: 4,
  },
  leaderboardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  levelBadgeSmall: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  levelBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  referralCount: {
    alignItems: "center",
  },
  referralNumber: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FF6B6B",
  },
  referralLabel: {
    fontSize: 11,
    color: "#6B6560",
  },
});
