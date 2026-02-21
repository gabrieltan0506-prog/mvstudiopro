import React, { useState, useEffect } from "react";
import { Text, View, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useRouter, useLocalSearchParams } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const { session_id, plan } = useLocalSearchParams<{ session_id?: string; plan?: string }>();
  const { user } = useAuth();

  const [welcomeMsg, setWelcomeMsg] = useState<string | null>(null);
  const [loadingWelcome, setLoadingWelcome] = useState(false);

  const welcomeMutation = trpc.welcomeMessage.generate.useMutation();

  // Auto-generate welcome message when plan is provided (subscription success)
  useEffect(() => {
    if (plan && user) {
      generateWelcome();
    }
  }, [plan, user]);

  const generateWelcome = async () => {
    if (!plan) return;
    setLoadingWelcome(true);
    try {
      const planNameMap: Record<string, string> = {
        pro: "专业版",
        enterprise: "企业版",
      };
      const result = await welcomeMutation.mutateAsync({
        planName: planNameMap[plan as string] || plan as string,
        userName: user?.name || undefined,
      });
      setWelcomeMsg(result.message);
    } catch (err) {
      console.error("Failed to generate welcome message:", err);
    } finally {
      setLoadingWelcome(false);
    }
  };

  const isSubscription = !!plan;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.container}>
          {/* Success Icon */}
          <View style={styles.iconCircle}>
            <MaterialIcons name="check-circle" size={64} color="#22C55E" />
          </View>

          <Text style={styles.title}>
            {isSubscription ? "欢迎加入！" : "付款成功！"}
          </Text>
          <Text style={styles.subtitle}>
            {isSubscription
              ? `您已成功升级为${plan === "enterprise" ? "企业版" : "专业版"}会员`
              : "您的付款已成功处理。Credits 将在几秒内到帐。"}
          </Text>

          {/* Welcome Message Section (only for subscriptions) */}
          {isSubscription && (
            <View style={styles.welcomeSection}>
              {loadingWelcome ? (
                <View style={styles.welcomeLoading}>
                  <ActivityIndicator size="small" color="#FF6B35" />
                  <Text style={styles.welcomeLoadingText}>正在为您生成专属欢迎语...</Text>
                </View>
              ) : welcomeMsg ? (
                <View style={styles.welcomeCard}>
                  <View style={styles.welcomeCardHeader}>
                    <MaterialIcons name="auto-awesome" size={18} color="#FFD60A" />
                    <Text style={styles.welcomeCardTitle}>来自 AI 助手的欢迎</Text>
                  </View>
                  <Text style={styles.welcomeText}>{welcomeMsg}</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* Plan Benefits (for subscriptions) */}
          {isSubscription && (
            <View style={styles.benefitsCard}>
              <Text style={styles.benefitsTitle}>
                {plan === "enterprise" ? "企业版" : "专业版"}专属权益
              </Text>
              <View style={styles.benefitsList}>
                <BenefitRow icon="all-inclusive" text="无限视频 PK 评分 & 偶像生成" />
                <BenefitRow icon="view-in-ar" text="偶像图片转 3D" />
                <BenefitRow icon="movie-creation" text="无限分镜脚本生成" />
                <BenefitRow icon="toll" text={`每月 ${plan === "enterprise" ? "2000" : "500"} Credits`} />
                {plan === "enterprise" && (
                  <>
                    <BenefitRow icon="group" text="团队席位管理" />
                    <BenefitRow icon="api" text="API 访问 & 白标授权" />
                  </>
                )}
              </View>
            </View>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            {isSubscription ? (
              <>
                <TouchableOpacity
                  onPress={() => router.push("/" as any)}
                  style={styles.primaryBtn}
                >
                  <MaterialIcons name="rocket-launch" size={20} color="#fff" />
                  <Text style={styles.primaryBtnText}>开始创作</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push("/credits-dashboard" as any)}
                  style={styles.secondaryBtn}
                >
                  <Text style={styles.secondaryBtnText}>查看 Credits 余额</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  onPress={() => router.push("/credits-dashboard" as any)}
                  style={styles.primaryBtn}
                >
                  <Text style={styles.primaryBtnText}>查看 Credits</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push("/" as any)}
                  style={styles.secondaryBtn}
                >
                  <Text style={styles.secondaryBtnText}>返回首页</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function BenefitRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.benefitRow}>
      <MaterialIcons name={icon as any} size={18} color="#22C55E" />
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1 },
  container: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32, paddingVertical: 40 },
  iconCircle: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: "#22C55E22", justifyContent: "center", alignItems: "center", marginBottom: 24,
  },
  title: { fontSize: 28, fontWeight: "800", color: "#ECEDEE", marginBottom: 8 },
  subtitle: { fontSize: 15, color: "#9BA1A6", textAlign: "center", lineHeight: 22 },

  // Welcome Message
  welcomeSection: { width: "100%", marginTop: 24 },
  welcomeLoading: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 20,
  },
  welcomeLoadingText: { color: "#9BA1A6", fontSize: 14 },
  welcomeCard: {
    backgroundColor: "#1A1A1D", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "rgba(255,214,10,0.2)", gap: 12,
  },
  welcomeCardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  welcomeCardTitle: { fontSize: 14, fontWeight: "600", color: "#FFD60A" },
  welcomeText: { fontSize: 15, color: "#ECEDEE", lineHeight: 24 },

  // Benefits
  benefitsCard: {
    width: "100%", marginTop: 20,
    backgroundColor: "#1A1A1D", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "#2A2A2D",
  },
  benefitsTitle: { fontSize: 16, fontWeight: "700", color: "#ECEDEE", marginBottom: 12 },
  benefitsList: { gap: 10 },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  benefitText: { fontSize: 14, color: "#ECEDEE" },

  // Actions
  actions: { marginTop: 32, width: "100%", gap: 12 },
  primaryBtn: {
    backgroundColor: "#FF6B35", borderRadius: 12, paddingVertical: 16,
    alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryBtn: {
    borderWidth: 1, borderColor: "#2A2A2D", borderRadius: 12, paddingVertical: 16, alignItems: "center",
  },
  secondaryBtnText: { color: "#9BA1A6", fontSize: 16, fontWeight: "600" },
});
