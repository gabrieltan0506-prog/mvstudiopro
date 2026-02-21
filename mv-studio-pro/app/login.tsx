import { Text, View, TouchableOpacity, StyleSheet, Platform, Dimensions, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { ErrorBoundary } from "@/components/error-boundary";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { startOAuthLogin } from "@/constants/oauth";
import { useAuth } from "@/hooks/use-auth";

const isWeb = Platform.OS === "web";
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWide = isWeb && SCREEN_WIDTH > 768;

type LoginMode = "otp" | "password" | "register" | "invite";

export default function LoginScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{ error?: string; invite?: string }>();
  const { refresh } = useAuth({ autoFetch: false });

  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>(searchParams.invite ? "invite" : "otp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [inviteCode, setInviteCode] = useState(searchParams.invite || "");
  const [error, setError] = useState(
    searchParams.error === "oauth_failed" 
      ? "Google 登录失败，请重试" 
      : searchParams.error === "invalid_redirect"
      ? "Sandbox 域名已变更，请重新发起 Google 登录"
      : ""
  );
  const [otpSent, setOtpSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [successMessage, setSuccessMessage] = useState("");

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // tRPC mutations
  const registerMutation = trpc.emailAuth.register.useMutation();
  const loginMutation = trpc.emailAuth.login.useMutation();
  const sendOtpMutation = trpc.emailOtp.sendCode.useMutation();
  const verifyOtpMutation = trpc.emailOtp.verifyAndLogin.useMutation();
  const redeemInviteMutation = trpc.beta.redeemInviteCode.useMutation();

  // Countdown timer for OTP resend
  useEffect(() => {
    if (countdown > 0) {
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [countdown > 0]);

  const handleGoogleLogin = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await startOAuthLogin();
    } catch (err) {
      console.error("[Login] Google login failed:", err);
      setError("Google 登录失败，请重试");
    } finally {
      setLoading(false);
    }
  }, []);

  // Send OTP
  const handleSendOtp = useCallback(async () => {
    setError("");
    if (!email) {
      setError("请输入 Email 地址");
      return;
    }
    setLoading(true);
    try {
      await sendOtpMutation.mutateAsync({ email });
      setOtpSent(true);
      setCountdown(60);
      setSuccessMessage("验证码已发送到您的邮箱");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err: any) {
      setError(err.message || "发送验证码失败");
    } finally {
      setLoading(false);
    }
  }, [email, sendOtpMutation]);

  // Verify OTP and login
  const handleVerifyOtp = useCallback(async () => {
    setError("");
    if (!otpCode || otpCode.length !== 6) {
      setError("请输入 6 位验证码");
      return;
    }
    setLoading(true);
    try {
      const result = await verifyOtpMutation.mutateAsync({ email, code: otpCode });
      if (result.success) {
        // Refresh auth state to pick up the new session cookie
        await refresh();
        router.back();
      }
    } catch (err: any) {
      setError(err.message || "验证失败");
    } finally {
      setLoading(false);
    }
  }, [email, otpCode, verifyOtpMutation, refresh, router]);

  // Password login
  const handlePasswordLogin = useCallback(async () => {
    setError("");
    if (!email || !password) {
      setError("请输入 Email 和密码");
      return;
    }
    setLoading(true);
    try {
      await loginMutation.mutateAsync({ email, password });
      await refresh();
      router.back();
    } catch (err: any) {
      setError(err.message || "登录失败");
    } finally {
      setLoading(false);
    }
  }, [email, password, loginMutation, refresh, router]);

  // Register
  const handleRegister = useCallback(async () => {
    setError("");
    if (!email || !password) {
      setError("请输入 Email 和密码");
      return;
    }
    if (!name) {
      setError("请输入姓名");
      return;
    }
    setLoading(true);
    try {
      await registerMutation.mutateAsync({ email, password, name });
      setSuccessMessage("注册成功！请登录");
      setMode("password");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err: any) {
      setError(err.message || "注册失败");
    } finally {
      setLoading(false);
    }
  }, [email, password, name, registerMutation]);

  // Redeem invite code
  const handleRedeemInvite = useCallback(async () => {
    setError("");
    if (!inviteCode) {
      setError("请输入邀请码");
      return;
    }
    setLoading(true);
    try {
      const result = await redeemInviteMutation.mutateAsync({ inviteCode });
      setSuccessMessage(result.message);
      setTimeout(() => {
        router.back();
      }, 2000);
    } catch (err: any) {
      setError(err.message || "邀请码兑换失败");
    } finally {
      setLoading(false);
    }
  }, [inviteCode, redeemInviteMutation, router]);

  const renderOtpForm = () => (
    <View style={styles.emailForm}>
      <TextInput
        style={styles.input}
        placeholder="Email 地址"
        placeholderTextColor="#6B6560"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        editable={!otpSent}
      />

      {otpSent && (
        <View style={styles.otpRow}>
          <TextInput
            style={[styles.input, styles.otpInput]}
            placeholder="6 位验证码"
            placeholderTextColor="#6B6560"
            value={otpCode}
            onChangeText={setOtpCode}
            keyboardType="number-pad"
            maxLength={6}
            returnKeyType="done"
            onSubmitEditing={handleVerifyOtp}
          />
          <TouchableOpacity
            style={[styles.resendBtn, countdown > 0 && styles.resendBtnDisabled]}
            onPress={handleSendOtp}
            disabled={countdown > 0 || loading}
            activeOpacity={0.7}
          >
            <Text style={styles.resendBtnText}>
              {countdown > 0 ? `${countdown}s` : "重发"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {successMessage ? (
        <View style={styles.successBanner}>
          <MaterialIcons name="check-circle" size={16} color="#30D158" />
          <Text style={styles.successText}>{successMessage}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryBtn, loading && styles.primaryBtnLoading]}
        onPress={otpSent ? handleVerifyOtp : handleSendOtp}
        activeOpacity={0.8}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.primaryBtnText}>
            {otpSent ? "验证并登录" : "发送验证码"}
          </Text>
        )}
      </TouchableOpacity>

      {otpSent && (
        <TouchableOpacity
          onPress={() => { setOtpSent(false); setOtpCode(""); setError(""); }}
          style={styles.changeEmailBtn}
        >
          <Text style={styles.switchModeText}>更换 Email 地址</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderPasswordForm = () => (
    <View style={styles.emailForm}>
      {mode === "register" && (
        <TextInput
          style={styles.input}
          placeholder="姓名"
          placeholderTextColor="#6B6560"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
      )}
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#6B6560"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="密码"
        placeholderTextColor="#6B6560"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        returnKeyType="done"
        onSubmitEditing={mode === "register" ? handleRegister : handlePasswordLogin}
      />

      {successMessage ? (
        <View style={styles.successBanner}>
          <MaterialIcons name="check-circle" size={16} color="#30D158" />
          <Text style={styles.successText}>{successMessage}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryBtn, loading && styles.primaryBtnLoading]}
        onPress={mode === "register" ? handleRegister : handlePasswordLogin}
        activeOpacity={0.8}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.primaryBtnText}>
            {mode === "register" ? "注册" : "登录"}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setMode(mode === "register" ? "password" : "register")}>
        <Text style={styles.switchModeText}>
          {mode === "register" ? "已有帐号？登录" : "还没有帐号？注册"}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderInviteForm = () => (
    <View style={styles.emailForm}>
      <View style={styles.inviteHeader}>
        <MaterialIcons name="card-giftcard" size={32} color="#FF6B6B" />
        <Text style={styles.inviteTitle}>兑换邀请码</Text>
        <Text style={styles.inviteDesc}>输入朋友的邀请码，双方各获得 10 次额外配额</Text>
      </View>

      <TextInput
        style={[styles.input, styles.inviteInput]}
        placeholder="输入 8 位邀请码"
        placeholderTextColor="#6B6560"
        value={inviteCode}
        onChangeText={(text) => setInviteCode(text.toUpperCase())}
        autoCapitalize="characters"
        maxLength={8}
        returnKeyType="done"
        onSubmitEditing={handleRedeemInvite}
      />

      {successMessage ? (
        <View style={styles.successBanner}>
          <MaterialIcons name="check-circle" size={16} color="#30D158" />
          <Text style={styles.successText}>{successMessage}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryBtn, loading && styles.primaryBtnLoading]}
        onPress={handleRedeemInvite}
        activeOpacity={0.8}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.primaryBtnText}>兑换邀请码</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <ErrorBoundary>
      <ScreenContainer edges={isWeb ? [] : ["top", "bottom", "left", "right"]} containerClassName="bg-background">
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <View style={styles.container}>
            {/* Back button */}
            <TouchableOpacity style={styles.skipBtn} onPress={() => router.back()} activeOpacity={0.7}>
              <MaterialIcons name="arrow-back" size={20} color="#9B9691" />
              <Text style={styles.skipText}>返回</Text>
            </TouchableOpacity>

            {/* Decorative orbs */}
            <View style={[styles.orb, styles.orb1]} />
            <View style={[styles.orb, styles.orb2]} />

            {/* Logo & Branding */}
            <View style={styles.brandSection}>
              <View style={styles.logoGlow}>
                <Image source={require("@/assets/images/icon.png")} style={styles.logo} contentFit="contain" />
              </View>
              <Text style={styles.appName}>MV Studio Pro</Text>
              <Text style={styles.appSlogan}>My Video, I am the team.</Text>
            </View>

            {/* Login Card */}
            <View style={styles.loginCard}>
              <Text style={styles.cardTitle}>欢迎使用</Text>
              <Text style={styles.cardDesc}>
                {mode === "invite"
                  ? "使用邀请码加入内测，获得额外功能配额"
                  : "使用 Google 或 Email 帐号登录，即可享受完整的视频创作功能"}
              </Text>

              {/* OAuth error banner */}
              {searchParams.error === "oauth_failed" && (
                <View style={styles.oauthErrorBanner}>
                  <MaterialIcons name="warning" size={18} color="#FF6B6B" />
                  <Text style={styles.oauthErrorText}>Google 登录验证失败，请重新尝试</Text>
                </View>
              )}

              {/* Mode Tabs */}
              {mode !== "invite" && (
                <View style={styles.modeTabs}>
                  <TouchableOpacity
                    style={[styles.modeTab, mode === "otp" && styles.modeTabActive]}
                    onPress={() => { setMode("otp"); setError(""); }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="email" size={16} color={mode === "otp" ? "#FF6B6B" : "#6B6560"} />
                    <Text style={[styles.modeTabText, mode === "otp" && styles.modeTabTextActive]}>验证码登录</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modeTab, (mode === "password" || mode === "register") && styles.modeTabActive]}
                    onPress={() => { setMode("password"); setError(""); }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="lock" size={16} color={(mode === "password" || mode === "register") ? "#FF6B6B" : "#6B6560"} />
                    <Text style={[styles.modeTabText, (mode === "password" || mode === "register") && styles.modeTabTextActive]}>密码登录</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Form Content */}
              {mode === "otp" && renderOtpForm()}
              {(mode === "password" || mode === "register") && renderPasswordForm()}
              {mode === "invite" && renderInviteForm()}

              {/* Divider */}
              {mode !== "invite" && (
                <>
                  <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>或</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  {/* Google Login Button */}
                  <TouchableOpacity
                    style={[styles.googleBtn, loading && styles.googleBtnLoading]}
                    onPress={handleGoogleLogin}
                    activeOpacity={0.8}
                    disabled={loading}
                  >
                    <View style={styles.googleIconWrap}>
                      <Image source={{ uri: "https://www.google.com/favicon.ico" }} style={styles.googleIcon} contentFit="contain" />
                    </View>
                    <Text style={styles.googleBtnText}>
                      {loading ? "连接中..." : "使用 Google 帐号登录"}
                    </Text>
                  </TouchableOpacity>

                  {/* Invite code entry */}
                  <TouchableOpacity
                    style={styles.inviteCodeBtn}
                    onPress={() => { setMode("invite"); setError(""); }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="card-giftcard" size={18} color="#FF6B6B" />
                    <Text style={styles.inviteCodeBtnText}>有邀请码？点此兑换</Text>
                  </TouchableOpacity>
                </>
              )}

              {mode === "invite" && (
                <TouchableOpacity
                  style={styles.backToLoginBtn}
                  onPress={() => { setMode("otp"); setError(""); setSuccessMessage(""); }}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="arrow-back" size={16} color="#9B9691" />
                  <Text style={styles.switchModeText}>返回登录</Text>
                </TouchableOpacity>
              )}

              {/* Features list */}
              {mode !== "invite" && (
                <View style={styles.featureList}>
                  <Text style={styles.featureTitle}>登录后可使用</Text>
                  {[
                    { icon: "graphic-eq" as const, text: "视频 PK 评分 — AI 深度解析爆款潜力" },
                    { icon: "groups" as const, text: "虚拟偶像工坊 — 生成多风格虚拟形象" },
                    { icon: "auto-fix-high" as const, text: "分镜转视频 — 将分镜脚本转化为视频" },
                    { icon: "campaign" as const, text: "多平台发布 — 一键跨平台发布" },
                  ].map((feat, i) => (
                    <View key={i} style={styles.featureRow}>
                      <MaterialIcons name={feat.icon} size={18} color="#FF6B6B" />
                      <Text style={styles.featureText}>{feat.text}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Terms */}
              <Text style={styles.termsText}>
                继续即表示您同意我们的
                <Text style={styles.termsLink}> 服务条款 </Text>
                和
                <Text style={styles.termsLink}> 隐私政策</Text>
              </Text>
            </View>
          </View>
        </ScrollView>
      </ScreenContainer>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, alignItems: "center",
    paddingHorizontal: 20, paddingTop: isWide ? 60 : 20, paddingBottom: 40,
    overflow: "hidden" as any,
  },
  orb: { position: "absolute", borderRadius: 999 },
  orb1: {
    width: 300, height: 300, top: -80, right: -60,
    backgroundColor: "rgba(255,107,107,0.08)",
  },
  orb2: {
    width: 250, height: 250, bottom: -40, left: -80,
    backgroundColor: "rgba(100,210,255,0.06)",
  },
  skipBtn: {
    position: "absolute", top: isWide ? 24 : 16, left: 20,
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
    zIndex: 10,
  },
  skipText: { fontSize: 14, color: "#9B9691", fontWeight: "500" },

  /* Branding */
  brandSection: { alignItems: "center", marginTop: isWide ? 40 : 60, marginBottom: 32 },
  logoGlow: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: "rgba(255,107,107,0.1)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 16,
    ...(isWeb ? { boxShadow: "0 0 40px rgba(255,107,107,0.15)" } as any : {}),
  },
  logo: { width: 56, height: 56, borderRadius: 16 },
  appName: { fontSize: 28, fontWeight: "800", color: "#F7F4EF", letterSpacing: -0.5 },
  appSlogan: { fontSize: 14, color: "#9B9691", marginTop: 6 },

  /* Login Card */
  loginCard: {
    width: "100%", maxWidth: 420,
    backgroundColor: "rgba(30,20,40,0.8)",
    borderRadius: 24, padding: isWide ? 36 : 28,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    ...(isWeb ? { backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "0 8px 40px rgba(0,0,0,0.4)" } as any : {}),
  },
  cardTitle: { fontSize: 24, fontWeight: "700", color: "#F7F4EF", textAlign: "center", marginBottom: 8 },
  cardDesc: { fontSize: 14, color: "#9B9691", textAlign: "center", marginBottom: 24, lineHeight: 22 },

  /* Mode Tabs */
  modeTabs: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
  },
  modeTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modeTabActive: {
    backgroundColor: "rgba(255,107,107,0.12)",
  },
  modeTabText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6B6560",
  },
  modeTabTextActive: {
    color: "#FF6B6B",
  },

  /* Email Form */
  emailForm: {
    marginBottom: 8,
  },
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
  otpRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 0,
  },
  otpInput: {
    flex: 1,
    letterSpacing: 6,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  resendBtn: {
    backgroundColor: "rgba(255,107,107,0.15)",
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  resendBtnDisabled: {
    opacity: 0.5,
  },
  resendBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FF6B6B",
  },
  changeEmailBtn: {
    marginTop: 8,
  },

  /* Success Banner */
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

  /* Primary Button */
  primaryBtn: {
    backgroundColor: "#FF6B6B",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  primaryBtnLoading: {
    opacity: 0.6,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  switchModeText: {
    fontSize: 14,
    color: "#9B9691",
    textAlign: "center",
  },

  /* Invite */
  inviteHeader: {
    alignItems: "center",
    gap: 8,
    marginBottom: 24,
  },
  inviteTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#F7F4EF",
  },
  inviteDesc: {
    fontSize: 14,
    color: "#9B9691",
    textAlign: "center",
    lineHeight: 20,
  },
  inviteInput: {
    letterSpacing: 4,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  inviteCodeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,107,107,0.2)",
    borderStyle: "dashed",
  },
  inviteCodeBtnText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#FF6B6B",
  },
  backToLoginBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    marginTop: 8,
  },

  /* Divider */
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  dividerText: {
    fontSize: 13,
    color: "#9B9691",
    marginHorizontal: 12,
  },

  /* Google Button */
  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 12, paddingVertical: 16, borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1, borderColor: "#E0E0E0",
    ...(isWeb ? { boxShadow: "0 2px 8px rgba(0,0,0,0.1)" } as any : { elevation: 2 }),
  },
  googleBtnLoading: { opacity: 0.6 },
  googleIconWrap: {
    width: 24, height: 24, borderRadius: 4,
    alignItems: "center", justifyContent: "center",
  },
  googleIcon: { width: 20, height: 20 },
  googleBtnText: { fontSize: 16, fontWeight: "600", color: "#333333" },

  /* Features */
  featureList: {
    marginTop: 24, paddingTop: 20,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
  },
  featureTitle: { fontSize: 14, fontWeight: "600", color: "#9B9691", marginBottom: 14 },
  featureRow: {
    flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12,
  },
  featureText: { fontSize: 14, color: "#F7F4EF", flex: 1, lineHeight: 20 },

  /* Terms */
  termsText: {
    fontSize: 12, color: "#6B6560", textAlign: "center", marginTop: 24, lineHeight: 18,
  },
  termsLink: { color: "#FF6B6B" },

  /* OAuth Error Banner */
  oauthErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,107,107,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,107,107,0.25)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
  },
  oauthErrorText: {
    flex: 1,
    fontSize: 14,
    color: "#FF6B6B",
    lineHeight: 20,
  },
});
