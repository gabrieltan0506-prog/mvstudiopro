import { Text, View, TouchableOpacity, StyleSheet, Platform, Dimensions, ScrollView, ActivityIndicator, Share } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import * as Clipboard from "expo-clipboard";

const isWeb = Platform.OS === "web";
const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Beta Tester levels
const BETA_LEVELS = [
  { name: "Starter", minReferrals: 0, color: "#9B9691", icon: "person" as const, desc: "内测新手" },
  { name: "Advocate", minReferrals: 3, color: "#64D2FF", icon: "thumb-up" as const, desc: "积极推广者" },
  { name: "Ambassador", minReferrals: 10, color: "#30D158", icon: "star" as const, desc: "品牌大使" },
  { name: "Champion", minReferrals: 25, color: "#FF9F0A", icon: "emoji-events" as const, desc: "冠军推广者" },
  { name: "Legend", minReferrals: 50, color: "#FF375F", icon: "whatshot" as const, desc: "传奇推广者" },
];

function getBetaLevel(referralCount: number) {
  for (let i = BETA_LEVELS.length - 1; i >= 0; i--) {
    if (referralCount >= BETA_LEVELS[i].minReferrals) return BETA_LEVELS[i];
  }
  return BETA_LEVELS[0];
}

function getNextLevel(referralCount: number) {
  for (let i = 0; i < BETA_LEVELS.length; i++) {
    if (referralCount < BETA_LEVELS[i].minReferrals) return BETA_LEVELS[i];
  }
  return null;
}

export default function InviteScreen() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuth();

  const [copied, setCopied] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);

  // tRPC queries
  const statusQuery = trpc.beta.myStatus.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
  });
  const leaderboardQuery = trpc.beta.leaderboard.useQuery({ limit: 10 }, {
    enabled: isAuthenticated && !authLoading,
  });

  const myStatus = statusQuery.data;
  const currentLevel = useMemo(() => getBetaLevel(myStatus?.referralCount ?? 0), [myStatus?.referralCount]);
  const nextLevel = useMemo(() => getNextLevel(myStatus?.referralCount ?? 0), [myStatus?.referralCount]);

  const inviteUrl = useMemo(() => {
    if (!myStatus?.inviteCode) return "";
    // Use current origin on web, or fallback
    if (isWeb && typeof window !== "undefined") {
      return `${window.location.origin}/login?invite=${myStatus.inviteCode}`;
    }
    return `https://mvstudio.com/login?invite=${myStatus.inviteCode}`;
  }, [myStatus?.inviteCode]);

  const handleCopyCode = useCallback(async () => {
    if (!myStatus?.inviteCode) return;
    try {
      if (isWeb && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(myStatus.inviteCode);
      } else {
        await Clipboard.setStringAsync(myStatus.inviteCode);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }, [myStatus?.inviteCode]);

  const handleCopyLink = useCallback(async () => {
    if (!inviteUrl) return;
    try {
      if (isWeb && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(inviteUrl);
      } else {
        await Clipboard.setStringAsync(inviteUrl);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }, [inviteUrl]);

  const handleShare = useCallback(async () => {
    if (!myStatus?.inviteCode) return;
    const message = `🎬 我正在使用 MV Studio Pro — 一站式视频创作平台！\n\n使用我的邀请码 ${myStatus.inviteCode} 加入内测，我们双方各获得 10 次免费功能配额！\n\n立即加入：${inviteUrl}`;

    if (isWeb && typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "MV Studio Pro 邀请", text: message });
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 3000);
      } catch (err) {
        // User cancelled
      }
    } else if (!isWeb) {
      try {
        await Share.share({ message });
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 3000);
      } catch (err) {
        console.error("Share failed:", err);
      }
    } else {
      // Fallback: copy to clipboard
      handleCopyLink();
    }
  }, [myStatus?.inviteCode, inviteUrl, handleCopyLink]);

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

  if (!isAuthenticated) {
    return (
      <ScreenContainer className="p-6">
        <View style={styles.centerContainer}>
          <MaterialIcons name="lock" size={48} color="#9B9691" />
          <Text style={styles.noAccessText}>请先登录以查看邀请信息</Text>
          <TouchableOpacity style={styles.loginBtn} onPress={() => router.push("/login")}>
            <Text style={styles.loginBtnText}>前往登录</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  if (!myStatus) {
    return (
      <ScreenContainer className="p-6">
        <View style={styles.centerContainer}>
          <MaterialIcons name="hourglass-empty" size={48} color="#9B9691" />
          <Text style={styles.noAccessTitle}>尚未加入内测</Text>
          <Text style={styles.noAccessText}>您目前不是内测用户，请联系管理员获取内测资格</Text>
          <TouchableOpacity style={styles.loginBtn} onPress={() => router.back()}>
            <Text style={styles.loginBtnText}>返回</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  const progressToNext = nextLevel
    ? ((myStatus?.referralCount ?? 0) - currentLevel.minReferrals) / (nextLevel.minReferrals - currentLevel.minReferrals)
    : 1;

  return (
    <ScreenContainer edges={isWeb ? [] : ["top", "left", "right"]} containerClassName="bg-background">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBackBtn} onPress={() => router.back()} activeOpacity={0.7}>
              <MaterialIcons name="arrow-back" size={22} color="#F7F4EF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>邀请朋友</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Status Card */}
          <View style={styles.statusCard}>
            <View style={[styles.statusBadge, { backgroundColor: currentLevel.color + "20" }]}>
              <MaterialIcons name={currentLevel.icon} size={28} color={currentLevel.color} />
            </View>
            <Text style={[styles.statusLevel, { color: currentLevel.color }]}>{currentLevel.name}</Text>
            <Text style={styles.statusDesc}>{currentLevel.desc}</Text>

            {/* Progress to next level */}
            {nextLevel && (
              <View style={styles.progressSection}>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${Math.min(progressToNext * 100, 100)}%`, backgroundColor: currentLevel.color }]} />
                </View>
                <Text style={styles.progressText}>
                  还需邀请 {nextLevel.minReferrals - (myStatus?.referralCount ?? 0)} 人升级为{" "}
                  <Text style={{ color: nextLevel.color, fontWeight: "700" }}>{nextLevel.name}</Text>
                </Text>
              </View>
            )}

            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{myStatus?.referralCount ?? 0}</Text>
                <Text style={styles.statLabel}>已邀请</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{myStatus?.remaining ?? 0}</Text>
                <Text style={styles.statLabel}>剩余配额</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{myStatus?.totalQuota ?? 0}</Text>
                <Text style={styles.statLabel}>总配额</Text>
              </View>
            </View>
          </View>

          {/* Invite Code Card */}
          <View style={styles.inviteCodeCard}>
            <Text style={styles.inviteCodeTitle}>我的邀请码</Text>
            <TouchableOpacity style={styles.inviteCodeBox} onPress={handleCopyCode} activeOpacity={0.7}>
              <Text style={styles.inviteCodeText}>{myStatus?.inviteCode ?? "---"}</Text>
              <MaterialIcons name={copied ? "check" : "content-copy"} size={20} color={copied ? "#30D158" : "#FF6B6B"} />
            </TouchableOpacity>
            {copied && <Text style={styles.copiedText}>已拷贝到剪贴板！</Text>}

            <Text style={styles.inviteCodeDesc}>
              每邀请一位朋友加入内测，你和朋友各获得 <Text style={{ color: "#FF6B6B", fontWeight: "700" }}>10 次</Text> 额外配额
            </Text>

            {/* Share Buttons */}
            <View style={styles.shareButtons}>
              <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.8}>
                <MaterialIcons name="share" size={20} color="#FFFFFF" />
                <Text style={styles.shareBtnText}>分享给朋友</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.copyLinkBtn} onPress={handleCopyLink} activeOpacity={0.8}>
                <MaterialIcons name="link" size={20} color="#FF6B6B" />
                <Text style={styles.copyLinkBtnText}>拷贝链接</Text>
              </TouchableOpacity>
            </View>

            {shareSuccess && (
              <View style={styles.shareSuccessBanner}>
                <MaterialIcons name="check-circle" size={16} color="#30D158" />
                <Text style={styles.shareSuccessText}>分享成功！等朋友使用邀请码后，你们都会获得额外配额</Text>
              </View>
            )}
          </View>

          {/* Level Roadmap */}
          <View style={styles.roadmapCard}>
            <Text style={styles.roadmapTitle}>Beta Tester 等级</Text>
            {BETA_LEVELS.map((level, index) => {
              const isCurrentLevel = level.name === currentLevel.name;
              const isAchieved = (myStatus?.referralCount ?? 0) >= level.minReferrals;
              return (
                <View key={level.name} style={[styles.roadmapItem, isCurrentLevel && styles.roadmapItemCurrent]}>
                  <View style={[styles.roadmapBadge, { backgroundColor: isAchieved ? level.color + "20" : "rgba(255,255,255,0.04)" }]}>
                    <MaterialIcons
                      name={level.icon}
                      size={18}
                      color={isAchieved ? level.color : "#3A3530"}
                    />
                  </View>
                  <View style={styles.roadmapInfo}>
                    <Text style={[styles.roadmapName, isAchieved && { color: level.color }]}>{level.name}</Text>
                    <Text style={styles.roadmapDesc}>{level.desc}</Text>
                  </View>
                  <Text style={[styles.roadmapReq, isAchieved && { color: level.color }]}>
                    {level.minReferrals === 0 ? "起始" : `${level.minReferrals}+ 邀请`}
                  </Text>
                  {isCurrentLevel && (
                    <View style={[styles.currentBadge, { backgroundColor: level.color }]}>
                      <Text style={styles.currentBadgeText}>目前</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Mini Leaderboard */}
          <View style={styles.leaderboardCard}>
            <View style={styles.leaderboardHeader}>
              <Text style={styles.leaderboardTitle}>邀请排行榜 TOP 10</Text>
            </View>

            {leaderboardQuery.isLoading ? (
              <ActivityIndicator size="small" color="#FF6B6B" style={{ marginVertical: 20 }} />
            ) : leaderboardQuery.data && leaderboardQuery.data.length > 0 ? (
              <View style={styles.leaderboardList}>
                {leaderboardQuery.data.map((entry: any, index: number) => {
                  const level = getBetaLevel(entry.referralCount);
                  return (
                    <View key={entry.id} style={styles.leaderboardRow}>
                      <View style={styles.leaderboardRank}>
                        {index < 3 ? (
                          <MaterialIcons
                            name="emoji-events"
                            size={18}
                            color={index === 0 ? "#FFD700" : index === 1 ? "#C0C0C0" : "#CD7F32"}
                          />
                        ) : (
                          <Text style={styles.leaderboardRankText}>{index + 1}</Text>
                        )}
                      </View>
                      <Text style={styles.leaderboardName} numberOfLines={1}>{entry.email || "匿名"}</Text>
                      <View style={[styles.levelBadgeSmall, { backgroundColor: level.color + "15" }]}>
                        <Text style={[styles.levelBadgeText, { color: level.color }]}>{level.name}</Text>
                      </View>
                      <Text style={styles.leaderboardCount}>{entry.referralCount}</Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.emptyText}>暂无排行数据</Text>
            )}
          </View>
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
    maxWidth: 500,
    alignSelf: "center",
    width: "100%",
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  noAccessTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#F7F4EF",
  },
  noAccessText: {
    fontSize: 14,
    color: "#9B9691",
    textAlign: "center",
    lineHeight: 20,
  },
  loginBtn: {
    backgroundColor: "#FF6B6B",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  loginBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
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

  /* Status Card */
  statusCard: {
    backgroundColor: "rgba(30,20,40,0.6)",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    marginBottom: 16,
  },
  statusBadge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  statusLevel: {
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 4,
  },
  statusDesc: {
    fontSize: 14,
    color: "#9B9691",
    marginBottom: 16,
  },
  progressSection: {
    width: "100%",
    marginBottom: 20,
  },
  progressBar: {
    width: "100%",
    height: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 3,
    marginBottom: 8,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: "#6B6560",
    textAlign: "center",
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "800",
    color: "#F7F4EF",
  },
  statLabel: {
    fontSize: 12,
    color: "#6B6560",
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  /* Invite Code Card */
  inviteCodeCard: {
    backgroundColor: "rgba(30,20,40,0.6)",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    marginBottom: 16,
  },
  inviteCodeTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#9B9691",
    marginBottom: 12,
  },
  inviteCodeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,107,107,0.08)",
    borderWidth: 1.5,
    borderColor: "rgba(255,107,107,0.2)",
    borderRadius: 14,
    borderStyle: "dashed",
    paddingHorizontal: 24,
    paddingVertical: 16,
    marginBottom: 8,
  },
  inviteCodeText: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FF6B6B",
    letterSpacing: 4,
  },
  copiedText: {
    fontSize: 13,
    color: "#30D158",
    marginBottom: 8,
  },
  inviteCodeDesc: {
    fontSize: 13,
    color: "#9B9691",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  shareButtons: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  shareBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FF6B6B",
    paddingVertical: 14,
    borderRadius: 14,
  },
  shareBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  copyLinkBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,107,107,0.1)",
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,107,107,0.2)",
  },
  copyLinkBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FF6B6B",
  },
  shareSuccessBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(48,209,88,0.1)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
    width: "100%",
  },
  shareSuccessText: {
    flex: 1,
    fontSize: 12,
    color: "#30D158",
    lineHeight: 18,
  },

  /* Roadmap */
  roadmapCard: {
    backgroundColor: "rgba(30,20,40,0.6)",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    marginBottom: 16,
  },
  roadmapTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#F7F4EF",
    marginBottom: 16,
  },
  roadmapItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
  },
  roadmapItemCurrent: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  roadmapBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  roadmapInfo: {
    flex: 1,
  },
  roadmapName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6B6560",
  },
  roadmapDesc: {
    fontSize: 12,
    color: "#4A4540",
  },
  roadmapReq: {
    fontSize: 12,
    color: "#4A4540",
    fontWeight: "500",
  },
  currentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  currentBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  /* Leaderboard */
  leaderboardCard: {
    backgroundColor: "rgba(30,20,40,0.6)",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    marginBottom: 16,
  },
  leaderboardHeader: {
    marginBottom: 14,
  },
  leaderboardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#F7F4EF",
  },
  leaderboardList: {
    gap: 6,
  },
  leaderboardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  leaderboardRank: {
    width: 28,
    alignItems: "center",
  },
  leaderboardRankText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#6B6560",
  },
  leaderboardName: {
    flex: 1,
    fontSize: 14,
    color: "#F7F4EF",
  },
  levelBadgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  levelBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  leaderboardCount: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FF6B6B",
    minWidth: 30,
    textAlign: "right",
  },
  emptyText: {
    fontSize: 14,
    color: "#6B6560",
    textAlign: "center",
    paddingVertical: 20,
  },
});
