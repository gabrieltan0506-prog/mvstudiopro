import { ScrollView, Text, View, TouchableOpacity, ActivityIndicator, Linking, StyleSheet } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useRouter } from "expo-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

type BillingInterval = "monthly" | "yearly";

export default function PricingScreen() {
  const router = useRouter();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  const { data: planData, isLoading: plansLoading } = trpc.stripe.getPlans.useQuery();
  const { data: subData, isLoading: subLoading } = trpc.stripe.getSubscription.useQuery(undefined, {
    retry: false,
  });

  const checkoutMutation = trpc.stripe.createCheckoutSession.useMutation();
  const creditPackMutation = trpc.stripe.createCreditPackCheckout.useMutation();
  const portalMutation = trpc.stripe.getPortalUrl.useMutation();
  const { data: invoicesData } = trpc.stripe.getInvoices.useQuery(undefined, { retry: false });

  const handleOpenPortal = async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await portalMutation.mutateAsync();
      if (result.url) {
        if (Platform.OS === "web") {
          window.open(result.url, "_blank");
        } else {
          await Linking.openURL(result.url);
        }
      }
    } catch (err: any) {
      alert(err.message || "无法打开订阅管理页面");
    }
  };

  const handleSubscribe = async (plan: "pro" | "enterprise") => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoadingPlan(plan);
    try {
      const result = await checkoutMutation.mutateAsync({ plan, interval });
      if (result.url) {
        if (Platform.OS === "web") {
          window.open(result.url, "_blank");
        } else {
          await Linking.openURL(result.url);
        }
      }
    } catch (err: any) {
      alert(err.message || "无法创建付款页面");
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleBuyCreditPack = async (packId: "small" | "medium" | "large") => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoadingPlan(packId);
    try {
      const result = await creditPackMutation.mutateAsync({ packId });
      if (result.url) {
        if (Platform.OS === "web") {
          window.open(result.url, "_blank");
        } else {
          await Linking.openURL(result.url);
        }
      }
    } catch (err: any) {
      alert(err.message || "无法创建付款页面");
    } finally {
      setLoadingPlan(null);
    }
  };

  const currentPlan = subData?.plan ?? "free";

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>选择方案</Text>
          <Text style={styles.headerSubtitle}>解锁 AI 创作的全部潜力</Text>
        </View>

        {/* Credits Balance (if logged in) */}
        {subData && (
          <TouchableOpacity
            onPress={() => router.push("/credits-dashboard" as any)}
            style={styles.creditsBar}
          >
            <View style={styles.creditsBarLeft}>
              <MaterialIcons name="toll" size={20} color="#FF6B35" />
              <Text style={styles.creditsBarText}>Credits 余额</Text>
            </View>
            <View style={styles.creditsBarRight}>
              <Text style={styles.creditsBarAmount}>{subData.credits.balance}</Text>
              <MaterialIcons name="chevron-right" size={20} color="#9BA1A6" />
            </View>
          </TouchableOpacity>
        )}

        {/* Billing Toggle */}
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            onPress={() => setInterval("monthly")}
            style={[styles.toggleBtn, interval === "monthly" && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleText, interval === "monthly" && styles.toggleTextActive]}>月付</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setInterval("yearly")}
            style={[styles.toggleBtn, interval === "yearly" && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleText, interval === "yearly" && styles.toggleTextActive]}>年付</Text>
            <View style={styles.saveBadge}>
              <Text style={styles.saveBadgeText}>省 20%</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Plan Cards */}
        <View style={styles.plansContainer}>
          {/* Free Plan */}
          <View style={[styles.planCard, currentPlan === "free" && styles.planCardCurrent]}>
            {currentPlan === "free" && (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>当前方案</Text>
              </View>
            )}
            <Text style={styles.planName}>免费版</Text>
            <Text style={styles.planPrice}>¥0</Text>
            <Text style={styles.planPriceUnit}>/月</Text>
            <View style={styles.planFeatures}>
              <FeatureRow text="视频 PK 评分（前 2 次免费）" />
              <FeatureRow text="偶像生成（前 3 次免费）" />
              <FeatureRow text="分镜脚本（第 1 次免费）" />
              <FeatureRow text="视频展厅浏览" />
            </View>
          </View>

          {/* Pro Plan */}
          <View style={[styles.planCard, styles.planCardPro, currentPlan === "pro" && styles.planCardCurrent]}>
            <View style={styles.popularBadge}>
              <Text style={styles.popularBadgeText}>最受欢迎</Text>
            </View>
            {currentPlan === "pro" && (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>当前方案</Text>
              </View>
            )}
            <Text style={[styles.planName, { color: "#fff" }]}>专业版</Text>
            {currentPlan === "free" && (
              <View style={styles.trialBadge}>
                <MaterialIcons name="card-giftcard" size={12} color="#fff" />
                <Text style={styles.trialBadgeText}>7 天免费试用</Text>
              </View>
            )}
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <Text style={[styles.planPrice, { color: "#fff" }]}>
                ${interval === "monthly" ? "29" : "23"}
              </Text>
              <Text style={[styles.planPriceUnit, { color: "rgba(255,255,255,0.7)" }]}>/月</Text>
            </View>
            {interval === "yearly" && (
              <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, marginTop: 2 }}>
                年付 ¥1036（省 ¥216）
              </Text>
            )}
            <View style={styles.planFeatures}>
              <FeatureRow text="无限视频 PK 评分" light />
              <FeatureRow text="无限虚拟偶像生成" light />
              <FeatureRow text="无限分镜脚本生成" light />
              <FeatureRow text="偶像图片转 3D" light />
              <FeatureRow text="视频生成" light />
              <FeatureRow text="PDF 报告导出" light />
              <FeatureRow text="每月 500 Credits" light />
              <FeatureRow text="优先处理队列" light />
            </View>
            <TouchableOpacity
              onPress={() => handleSubscribe("pro")}
              disabled={currentPlan === "pro" || loadingPlan === "pro"}
              style={[styles.subscribeBtn, currentPlan === "pro" && { opacity: 0.5 }]}
            >
              {loadingPlan === "pro" ? (
                <ActivityIndicator color="#0A0A0B" />
              ) : (
                <Text style={styles.subscribeBtnText}>
                  {currentPlan === "pro" ? "已订阅" : currentPlan === "free" ? "免费试用 7 天" : "立即升级"}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Enterprise Plan */}
          <View style={[styles.planCard, currentPlan === "enterprise" && styles.planCardCurrent]}>
            {currentPlan === "enterprise" && (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>当前方案</Text>
              </View>
            )}
            <Text style={styles.planName}>企业版</Text>
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <Text style={styles.planPrice}>${interval === "monthly" ? "99" : "79"}</Text>
              <Text style={styles.planPriceUnit}>/月</Text>
            </View>
            {interval === "yearly" && (
              <Text style={{ color: "#9BA1A6", fontSize: 13, marginTop: 2 }}>
                年付 ¥3437（省 ¥859）
              </Text>
            )}
            <View style={styles.planFeatures}>
              <FeatureRow text="所有专业版功能" />
              <FeatureRow text="API 访问" />
              <FeatureRow text="白标授权" />
              <FeatureRow text="专属客服" />
              <FeatureRow text="团队席位" />
              <FeatureRow text="每月 2000 Credits" />
              <FeatureRow text="发票付款" />
            </View>
            <TouchableOpacity
              onPress={() => handleSubscribe("enterprise")}
              disabled={currentPlan === "enterprise" || loadingPlan === "enterprise"}
              style={[styles.subscribeBtnOutline, currentPlan === "enterprise" && { opacity: 0.5 }]}
            >
              {loadingPlan === "enterprise" ? (
                <ActivityIndicator color="#FF6B35" />
              ) : (
                <Text style={styles.subscribeBtnOutlineText}>
                  {currentPlan === "enterprise" ? "已订阅" : "联系销售"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Credits Packs Section */}
        <View style={styles.creditPacksSection}>
          <Text style={styles.sectionTitle}>Credits 加值包</Text>
          <Text style={styles.sectionSubtitle}>需要更多 Credits？随时加值，永不过期</Text>

          <View style={styles.creditPacksRow}>
            {/* Small Pack */}
            <TouchableOpacity
              onPress={() => handleBuyCreditPack("small")}
              disabled={loadingPlan === "small"}
              style={styles.creditPackCard}
            >
              <MaterialIcons name="bolt" size={32} color="#FF6B35" />
              <Text style={styles.creditPackAmount}>100</Text>
              <Text style={styles.creditPackLabel}>Credits</Text>
              <Text style={styles.creditPackPrice}>¥68</Text>
              {loadingPlan === "small" ? (
                <ActivityIndicator color="#FF6B35" style={{ marginTop: 8 }} />
              ) : (
                <Text style={styles.creditPackBuy}>购买</Text>
              )}
            </TouchableOpacity>

            {/* Medium Pack */}
            <TouchableOpacity
              onPress={() => handleBuyCreditPack("medium")}
              disabled={loadingPlan === "medium"}
              style={[styles.creditPackCard, styles.creditPackCardPopular]}
            >
              <View style={styles.bestValueBadge}>
                <Text style={styles.bestValueText}>热门</Text>
              </View>
              <MaterialIcons name="flash-on" size={32} color="#FF6B35" />
              <Text style={styles.creditPackAmount}>250</Text>
              <Text style={styles.creditPackLabel}>Credits</Text>
              <Text style={styles.creditPackPrice}>¥168</Text>
              <Text style={styles.creditPackSave}>省 4%</Text>
              {loadingPlan === "medium" ? (
                <ActivityIndicator color="#FF6B35" style={{ marginTop: 8 }} />
              ) : (
                <Text style={styles.creditPackBuy}>购买</Text>
              )}
            </TouchableOpacity>

            {/* Large Pack */}
            <TouchableOpacity
              onPress={() => handleBuyCreditPack("large")}
              disabled={loadingPlan === "large"}
              style={styles.creditPackCard}
            >
              <View style={[styles.bestValueBadge, { backgroundColor: "#22C55E" }]}>
                <Text style={styles.bestValueText}>最超值</Text>
              </View>
              <MaterialIcons name="local-fire-department" size={32} color="#FF6B35" />
              <Text style={styles.creditPackAmount}>500</Text>
              <Text style={styles.creditPackLabel}>Credits</Text>
              <Text style={styles.creditPackPrice}>¥328</Text>
              <Text style={styles.creditPackSave}>省 6.3%</Text>
              {loadingPlan === "large" ? (
                <ActivityIndicator color="#FF6B35" style={{ marginTop: 8 }} />
              ) : (
                <Text style={styles.creditPackBuy}>购买</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Credits Cost Table */}
        <View style={styles.costTableSection}>
          <Text style={styles.sectionTitle}>Credits 消耗说明</Text>
          <View style={styles.costTable}>
            <CostRow icon="analytics" label="视频 PK 评分" cost={8} />
            <CostRow icon="face" label="虚拟偶像生成" cost={3} />
            <CostRow icon="view-in-ar" label="偶像转 3D" cost={10} badge="PRO" />
            <CostRow icon="movie-creation" label="分镜脚本生成" cost={15} />
            <CostRow icon="videocam" label="视频生成" cost={25} />
          </View>
        </View>

        {/* Student Discount */}
        <TouchableOpacity
          onPress={() => router.push("/student-verification" as any)}
          style={styles.studentBanner}
        >
          <Text style={styles.studentBannerTitle}>🎓 学生优惠</Text>
          <Text style={styles.studentBannerDesc}>验证学生身份，享受超值订阅优惠（一年版含视频生成 2 次/月）</Text>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
            <View>
              <Text style={styles.studentPrice}>¥138</Text>
              <Text style={styles.studentPriceUnit}>半年</Text>
            </View>
            <View>
              <Text style={styles.studentPrice}>¥268</Text>
              <Text style={styles.studentPriceUnit}>一年</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Subscription Management */}
        {subData?.subscription && subData.plan !== "free" && (
          <View style={styles.managementSection}>
            <Text style={styles.sectionTitle}>订阅管理</Text>
            <View style={styles.managementCard}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: "#ECEDEE", fontSize: 16, fontWeight: "600" }}>
                  {subData.planConfig.nameCn}
                </Text>
                {subData.subscription.cancelAtPeriodEnd && (
                  <View style={{ backgroundColor: "#F59E0B33", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                    <Text style={{ color: "#F59E0B", fontSize: 12 }}>即将取消</Text>
                  </View>
                )}
              </View>
              {subData.subscription.currentPeriodEnd && (
                <Text style={{ color: "#9BA1A6", fontSize: 13, marginTop: 4 }}>
                  {subData.subscription.cancelAtPeriodEnd ? "到期日" : "下次续费"}：
                  {new Date(subData.subscription.currentPeriodEnd).toLocaleDateString("zh-TW")}
                </Text>
              )}

              {/* Stripe Customer Portal 入口 */}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <TouchableOpacity
                  onPress={handleOpenPortal}
                  disabled={portalMutation.isPending}
                  style={styles.portalBtn}
                >
                  <MaterialIcons name="settings" size={16} color="#FF6B35" />
                  <Text style={styles.portalBtnText}>
                    {portalMutation.isPending ? "加载中..." : "管理订阅"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push("/credits-dashboard" as any)}
                  style={styles.portalBtn}
                >
                  <MaterialIcons name="receipt-long" size={16} color="#FF6B35" />
                  <Text style={styles.portalBtnText}>帐单记录</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* 历史发票 */}
        {invoicesData && invoicesData.length > 0 && (
          <View style={styles.managementSection}>
            <Text style={styles.sectionTitle}>历史发票</Text>
            <View style={[styles.managementCard, { gap: 0 }]}>
              {invoicesData.slice(0, 5).map((inv: any, idx: number) => (
                <View key={inv.id || idx} style={[
                  styles.invoiceRow,
                  idx < Math.min(invoicesData.length, 5) - 1 && { borderBottomWidth: 1, borderBottomColor: "#2A2A2D" },
                ]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#ECEDEE", fontSize: 14 }}>
                      {inv.description || `发票 #${inv.stripeInvoiceId?.slice(-6) || idx + 1}`}
                    </Text>
                    <Text style={{ color: "#9BA1A6", fontSize: 12, marginTop: 2 }}>
                      {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString("zh-TW") : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: "#FF6B35", fontSize: 14, fontWeight: "600" }}>
                      ${((inv.amountPaid ?? 0) / 100).toFixed(2)}
                    </Text>
                    <View style={[
                      styles.invoiceStatusBadge,
                      { backgroundColor: inv.status === "paid" ? "#22C55E22" : "#F59E0B22" },
                    ]}>
                      <Text style={[
                        styles.invoiceStatusText,
                        { color: inv.status === "paid" ? "#22C55E" : "#F59E0B" },
                      ]}>
                        {inv.status === "paid" ? "已付款" : inv.status === "open" ? "待付款" : inv.status}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function FeatureRow({ text, light }: { text: string; light?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
      <MaterialIcons name="check-circle" size={16} color={light ? "#4ADE80" : "#22C55E"} />
      <Text style={{ color: light ? "rgba(255,255,255,0.9)" : "#ECEDEE", fontSize: 14, marginLeft: 8 }}>
        {text}
      </Text>
    </View>
  );
}

function CostRow({ icon, label, cost, badge }: { icon: string; label: string; cost: number; badge?: string }) {
  return (
    <View style={styles.costRow}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <MaterialIcons name={icon as any} size={20} color="#FF6B35" />
        <Text style={{ color: "#ECEDEE", fontSize: 14 }}>{label}</Text>
        {badge && (
          <View style={{ backgroundColor: "#FF6B35", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
            <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={{ color: "#FF6B35", fontSize: 14, fontWeight: "600" }}>{cost} Credits</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 16 },
  headerTitle: { fontSize: 28, fontWeight: "800", color: "#ECEDEE" },
  headerSubtitle: { fontSize: 15, color: "#9BA1A6", marginTop: 4 },

  creditsBar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginHorizontal: 24, marginBottom: 16, backgroundColor: "#1A1A1D",
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#2A2A2D",
  },
  creditsBarLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  creditsBarText: { color: "#ECEDEE", fontSize: 14 },
  creditsBarRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  creditsBarAmount: { color: "#FF6B35", fontSize: 18, fontWeight: "700" },

  toggleContainer: {
    flexDirection: "row", marginHorizontal: 24, marginBottom: 20,
    backgroundColor: "#1A1A1D", borderRadius: 10, padding: 3,
  },
  toggleBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  toggleBtnActive: { backgroundColor: "#FF6B35" },
  toggleText: { color: "#9BA1A6", fontSize: 14, fontWeight: "600" },
  toggleTextActive: { color: "#fff" },
  saveBadge: { backgroundColor: "#22C55E", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  saveBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },

  plansContainer: { paddingHorizontal: 24, gap: 16 },
  planCard: {
    backgroundColor: "#1A1A1D", borderRadius: 16, padding: 24,
    borderWidth: 1, borderColor: "#2A2A2D",
  },
  planCardPro: {
    backgroundColor: "#FF6B35", borderColor: "#FF6B35",
  },
  planCardCurrent: { borderColor: "#FF6B35", borderWidth: 2 },
  currentBadge: {
    position: "absolute", top: 12, right: 12,
    backgroundColor: "#FF6B3533", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  currentBadgeText: { color: "#FF6B35", fontSize: 11, fontWeight: "600" },
  popularBadge: {
    position: "absolute", top: -10, left: 20,
    backgroundColor: "#0A0A0B", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4,
  },
  popularBadgeText: { color: "#FF6B35", fontSize: 11, fontWeight: "700" },
  planName: { fontSize: 20, fontWeight: "700", color: "#ECEDEE", marginBottom: 8 },
  planPrice: { fontSize: 36, fontWeight: "800", color: "#ECEDEE" },
  planPriceUnit: { fontSize: 14, color: "#9BA1A6", marginLeft: 2 },
  planFeatures: { marginTop: 16 },

  subscribeBtn: {
    backgroundColor: "#fff", borderRadius: 10, paddingVertical: 14, marginTop: 20, alignItems: "center",
  },
  subscribeBtnText: { color: "#0A0A0B", fontSize: 16, fontWeight: "700" },
  subscribeBtnOutline: {
    borderWidth: 2, borderColor: "#FF6B35", borderRadius: 10, paddingVertical: 14, marginTop: 20, alignItems: "center",
  },
  subscribeBtnOutlineText: { color: "#FF6B35", fontSize: 16, fontWeight: "700" },

  creditPacksSection: { paddingHorizontal: 24, marginTop: 32 },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: "#ECEDEE", marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, color: "#9BA1A6", marginBottom: 16 },
  creditPacksRow: { flexDirection: "row", gap: 12 },
  creditPackCard: {
    flex: 1, backgroundColor: "#1A1A1D", borderRadius: 16, padding: 20,
    alignItems: "center", borderWidth: 1, borderColor: "#2A2A2D",
  },
  creditPackCardPopular: { borderColor: "#FF6B35" },
  creditPackAmount: { fontSize: 28, fontWeight: "800", color: "#ECEDEE", marginTop: 8 },
  creditPackLabel: { fontSize: 13, color: "#9BA1A6" },
  creditPackPrice: { fontSize: 18, fontWeight: "700", color: "#FF6B35", marginTop: 8 },
  creditPackSave: { fontSize: 11, color: "#22C55E", fontWeight: "600", marginTop: 2 },
  creditPackBuy: { color: "#FF6B35", fontSize: 14, fontWeight: "600", marginTop: 10 },
  bestValueBadge: {
    position: "absolute", top: -8, right: 12,
    backgroundColor: "#FF6B35", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  bestValueText: { color: "#fff", fontSize: 10, fontWeight: "700" },

  costTableSection: { paddingHorizontal: 24, marginTop: 32 },
  costTable: {
    backgroundColor: "#1A1A1D", borderRadius: 12, overflow: "hidden",
    borderWidth: 1, borderColor: "#2A2A2D", marginTop: 12,
  },
  costRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#2A2A2D",
  },

  studentBanner: {
    marginHorizontal: 24, marginTop: 32, backgroundColor: "#1A1A1D",
    borderRadius: 16, padding: 20, borderWidth: 1, borderColor: "#FF6B3555",
  },
  studentBannerTitle: { fontSize: 18, fontWeight: "700", color: "#ECEDEE" },
  studentBannerDesc: { fontSize: 13, color: "#9BA1A6", marginTop: 4 },
  studentPrice: { fontSize: 22, fontWeight: "800", color: "#FF6B35" },
  studentPriceUnit: { fontSize: 12, color: "#9BA1A6" },

  managementSection: { paddingHorizontal: 24, marginTop: 32 },
  managementCard: {
    backgroundColor: "#1A1A1D", borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: "#2A2A2D", marginTop: 12,
  },

  trialBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start", marginBottom: 4,
  },
  trialBadgeText: { color: "#fff", fontSize: 11, fontWeight: "600" },

  portalBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#FF6B3515", borderRadius: 8, paddingVertical: 10,
    borderWidth: 1, borderColor: "#FF6B3533",
  },
  portalBtnText: { color: "#FF6B35", fontSize: 13, fontWeight: "600" },

  invoiceRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 12,
  },
  invoiceStatusBadge: {
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2,
  },
  invoiceStatusText: { fontSize: 11, fontWeight: "600" },
});
