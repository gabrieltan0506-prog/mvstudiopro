import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Dimensions,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";

const isWeb = Platform.OS === "web";
const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function RedeemScreen() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuth();

  const [code, setCode] = useState("");
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    quota?: number;
    klingLimit?: number;
    inviteCode?: string;
    message?: string;
  } | null>(null);
  const [error, setError] = useState("");

  const redeemMutation = trpc.beta.redeemBetaCode.useMutation();

  const handleRedeem = useCallback(async () => {
    setError("");
    setResult(null);
    const trimmed = code.trim();
    if (!trimmed) {
      setError("请输入内测码");
      return;
    }
    setIsRedeeming(true);
    try {
      const res = await redeemMutation.mutateAsync({ code: trimmed });
      setResult(res);
      setCode("");
    } catch (err: any) {
      setError(err.message || "兑换失败，请稍后重试");
    } finally {
      setIsRedeeming(false);
    }
  }, [code, redeemMutation]);

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
          <Text style={styles.noAccessText}>请先登录后再兑换内测码</Text>
          <TouchableOpacity style={styles.loginBtn} onPress={() => router.push("/login" as any)}>
            <Text style={styles.loginBtnText}>去登录</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity
                style={styles.headerBackBtn}
                onPress={() => router.back()}
                activeOpacity={0.7}
              >
                <MaterialIcons name="arrow-back" size={22} color="#F7F4EF" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>兑换内测码</Text>
              <View style={{ width: 40 }} />
            </View>

            {/* Hero Section */}
            <View style={styles.heroSection}>
              <View style={styles.heroIconWrap}>
                <MaterialIcons name="card-giftcard" size={48} color="#FF6B6B" />
              </View>
              <Text style={styles.heroTitle}>MV Studio Pro 内测</Text>
              <Text style={styles.heroDesc}>
                输入内测码即可解锁全部功能体验，每个码包含 20 次使用配额
              </Text>
            </View>

            {/* Input Section */}
            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>内测码</Text>
              <TextInput
                style={styles.codeInput}
                placeholder="例如：MV3A2F1B"
                placeholderTextColor="#6B6560"
                value={code}
                onChangeText={(text) => setCode(text.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                autoCapitalize="characters"
                maxLength={16}
                returnKeyType="done"
                onSubmitEditing={handleRedeem}
              />

              {error ? (
                <View style={styles.errorBanner}>
                  <MaterialIcons name="error-outline" size={16} color="#FF6B6B" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.redeemBtn, isRedeeming && styles.redeemBtnLoading]}
                onPress={handleRedeem}
                activeOpacity={0.8}
                disabled={isRedeeming}
              >
                {isRedeeming ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <MaterialIcons name="redeem" size={20} color="#FFFFFF" />
                    <Text style={styles.redeemBtnText}>兑换</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Success Result */}
            {result?.success && (
              <View style={styles.successCard}>
                <View style={styles.successIconWrap}>
                  <MaterialIcons name="check-circle" size={40} color="#30D158" />
                </View>
                <Text style={styles.successTitle}>兑换成功！</Text>
                <Text style={styles.successMessage}>{result.message}</Text>

                <View style={styles.quotaInfoRow}>
                  <View style={styles.quotaInfoItem}>
                    <Text style={styles.quotaInfoValue}>{result.quota}</Text>
                    <Text style={styles.quotaInfoLabel}>总配额</Text>
                  </View>
                  <View style={styles.quotaInfoDivider} />
                  <View style={styles.quotaInfoItem}>
                    <Text style={styles.quotaInfoValue}>{result.klingLimit}</Text>
                    <Text style={styles.quotaInfoLabel}>Kling 视频</Text>
                  </View>
                  <View style={styles.quotaInfoDivider} />
                  <View style={styles.quotaInfoItem}>
                    <Text style={styles.quotaInfoValue}>+10</Text>
                    <Text style={styles.quotaInfoLabel}>每邀请1人</Text>
                  </View>
                </View>

                {result.inviteCode && (
                  <View style={styles.inviteCodeBox}>
                    <Text style={styles.inviteCodeLabel}>你的邀请码</Text>
                    <Text style={styles.inviteCodeValue}>{result.inviteCode}</Text>
                    <Text style={styles.inviteCodeHint}>
                      分享给朋友，双方各获 +10 次配额
                    </Text>
                  </View>
                )}

                <View style={styles.successActions}>
                  <TouchableOpacity
                    style={styles.goInviteBtn}
                    onPress={() => router.push("/invite" as any)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="share" size={18} color="#FF6B6B" />
                    <Text style={styles.goInviteBtnText}>邀请朋友</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.goHomeBtn}
                    onPress={() => router.push("/" as any)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="home" size={18} color="#FFFFFF" />
                    <Text style={styles.goHomeBtnText}>开始体验</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Features Preview */}
            {!result?.success && (
              <View style={styles.featuresSection}>
                <Text style={styles.featuresSectionTitle}>内测可体验功能</Text>
                {[
                  { icon: "auto-awesome" as const, title: "智能分镜生成", desc: "AI 脚本 + 分镜图一键生成" },
                  { icon: "face" as const, title: "虚拟偶像 2D/3D", desc: "AI 生成偶像形象 + 3D 转换" },
                  { icon: "music-note" as const, title: "Suno 音乐生成", desc: "Custom / Simple 双模式创作" },
                  { icon: "videocam" as const, title: "Kling 视频生成", desc: "分镜转视频（限 1 次）" },
                  { icon: "view-in-ar" as const, title: "3D Studio", desc: "2D 转 3D 模型 + GLB 导出" },
                  { icon: "analytics" as const, title: "视频 PK 评分", desc: "AI 分析视频质量和表现力" },
                ].map((f, i) => (
                  <View key={i} style={styles.featureItem}>
                    <View style={styles.featureIconWrap}>
                      <MaterialIcons name={f.icon} size={22} color="#FF6B6B" />
                    </View>
                    <View style={styles.featureTextWrap}>
                      <Text style={styles.featureTitle}>{f.title}</Text>
                      <Text style={styles.featureDesc}>{f.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
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
  loginBtn: {
    backgroundColor: "rgba(255,107,107,0.15)",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  loginBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FF6B6B",
  },

  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 40,
    maxWidth: 480,
    alignSelf: "center",
    width: "100%",
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

  /* Hero */
  heroSection: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 12,
  },
  heroIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: "rgba(255,107,107,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#F7F4EF",
  },
  heroDesc: {
    fontSize: 14,
    color: "#9B9691",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 20,
  },

  /* Input */
  inputSection: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#C8C3BD",
    marginBottom: 2,
  },
  codeInput: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    fontWeight: "700",
    color: "#F7F4EF",
    textAlign: "center",
    letterSpacing: 3,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,107,107,0.1)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    fontSize: 13,
    color: "#FF6B6B",
    flex: 1,
  },
  redeemBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FF6B6B",
    borderRadius: 12,
    paddingVertical: 14,
  },
  redeemBtnLoading: {
    opacity: 0.7,
  },
  redeemBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  /* Success Card */
  successCard: {
    backgroundColor: "rgba(48,209,88,0.08)",
    borderRadius: 16,
    padding: 24,
    marginTop: 20,
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(48,209,88,0.2)",
  },
  successIconWrap: {
    marginBottom: 4,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#30D158",
  },
  successMessage: {
    fontSize: 14,
    color: "#C8C3BD",
    textAlign: "center",
    lineHeight: 20,
  },
  quotaInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    marginTop: 8,
    width: "100%",
  },
  quotaInfoItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  quotaInfoValue: {
    fontSize: 24,
    fontWeight: "800",
    color: "#F7F4EF",
  },
  quotaInfoLabel: {
    fontSize: 12,
    color: "#9B9691",
  },
  quotaInfoDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  inviteCodeBox: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 6,
    width: "100%",
    marginTop: 4,
  },
  inviteCodeLabel: {
    fontSize: 12,
    color: "#9B9691",
  },
  inviteCodeValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FF6B6B",
    letterSpacing: 2,
  },
  inviteCodeHint: {
    fontSize: 12,
    color: "#6B6560",
  },
  successActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
    width: "100%",
  },
  goInviteBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,107,107,0.12)",
    borderRadius: 12,
    paddingVertical: 12,
  },
  goInviteBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FF6B6B",
  },
  goHomeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FF6B6B",
    borderRadius: 12,
    paddingVertical: 12,
  },
  goHomeBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  /* Features */
  featuresSection: {
    marginTop: 24,
    gap: 12,
  },
  featuresSectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#C8C3BD",
    marginBottom: 4,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.04)",
  },
  featureIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(255,107,107,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  featureTextWrap: {
    flex: 1,
    gap: 2,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#F7F4EF",
  },
  featureDesc: {
    fontSize: 12,
    color: "#9B9691",
  },
});
