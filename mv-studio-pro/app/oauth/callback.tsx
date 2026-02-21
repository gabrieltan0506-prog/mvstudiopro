import { ThemedView } from "@/components/themed-view";
import { ErrorBoundary } from "@/components/error-boundary";
import * as Api from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState, useRef } from "react";
import { ActivityIndicator, Text, View, StyleSheet, TouchableOpacity, Platform, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

const ERROR_MESSAGES: Record<string, { title: string; desc: string; canRetry: boolean }> = {
  oauth_failed: {
    title: "OAuth 验证失败",
    desc: "Google 帐号验证过程中出现问题，请稍后重试。如果问题持续，请尝试清除浏览器缓存后再试。",
    canRetry: true,
  },
  invalid_redirect: {
    title: "Sandbox 域名已变更",
    desc: "检测到您使用了旧的登录链接。Sandbox 重启后域名会改变，请返回登录页面重新发起 Google 登录。",
    canRetry: true,
  },
  missing_params: {
    title: "参数缺失",
    desc: "登录验证所需的参数不完整，请返回登录页面重新尝试。",
    canRetry: true,
  },
  token_exchange_failed: {
    title: "Token 交换失败",
    desc: "无法完成登录验证，服务器可能暂时不可用。请稍后再试。",
    canRetry: true,
  },
  network_error: {
    title: "网络连接问题",
    desc: "无法连接到服务器，请检查您的网络连接后重试。",
    canRetry: true,
  },
  default: {
    title: "登录失败",
    desc: "登录过程中出现未预期的错误，请稍后再试。",
    canRetry: true,
  },
};

function getErrorInfo(errorCode: string | null, errorMessage: string | null) {
  if (errorCode && ERROR_MESSAGES[errorCode]) {
    return ERROR_MESSAGES[errorCode];
  }
  if (errorMessage?.includes("network") || errorMessage?.includes("fetch")) {
    return ERROR_MESSAGES.network_error;
  }
  if (errorMessage?.includes("Missing code or state")) {
    return ERROR_MESSAGES.missing_params;
  }
  return {
    ...ERROR_MESSAGES.default,
    desc: errorMessage || ERROR_MESSAGES.default.desc,
  };
}

function PulsingDot() {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [anim]);
  return <Animated.View style={[styles.pulsingDot, { opacity: anim }]} />;
}

export default function OAuthCallback() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string;
    state?: string;
    error?: string;
    sessionToken?: string;
    user?: string;
  }>();
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Fade in animation on mount
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // Success countdown
  useEffect(() => {
    if (status !== "success") return;
    if (countdown <= 0) {
      router.replace("/(tabs)");
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [status, countdown, router]);

  useEffect(() => {
    const handleCallback = async () => {
      console.log("[OAuth] Callback handler triggered");
      console.log("[OAuth] Params received:", {
        code: params.code,
        state: params.state,
        error: params.error,
        sessionToken: params.sessionToken ? "present" : "missing",
        user: params.user ? "present" : "missing",
      });

      try {
        // Check if state parameter contains an old sandbox domain
        if (params.state) {
          try {
            const decodedState = typeof atob !== "undefined" 
              ? atob(params.state) 
              : Buffer.from(params.state, "base64").toString("utf-8");
            
            // Check if decoded state is a URL with a different domain
            if (decodedState.startsWith("http")) {
              const stateUrl = new URL(decodedState);
              const currentHost = typeof window !== "undefined" ? window.location.host : "";
              
              // If state URL points to a different host, it's likely an old sandbox domain
              if (currentHost && stateUrl.host !== currentHost && !currentHost.includes(stateUrl.host.split("-")[0])) {
                console.warn("[OAuth] Detected old sandbox domain in state:", stateUrl.host);
                console.warn("[OAuth] Current domain:", currentHost);
                setStatus("error");
                setErrorCode("invalid_redirect");
                setErrorMessage(
                  "检测到过期的登录链接。Sandbox 域名已变更，请返回登录页面重新登录。"
                );
                return;
              }
            }
          } catch (e) {
            // Ignore state decode errors, continue with normal flow
            console.log("[OAuth] Could not decode state parameter:", e);
          }
        }
        // Check for error param from server redirect (e.g., /login?error=oauth_failed)
        if (params.error) {
          console.error("[OAuth] Error parameter found:", params.error);
          setStatus("error");
          setErrorCode(params.error);
          setErrorMessage(params.error);
          return;
        }

        // Check for sessionToken in params first (web OAuth callback from server redirect)
        if (params.sessionToken) {
          console.log("[OAuth] Session token found in params (web callback)");
          await Auth.setSessionToken(params.sessionToken);

          // Decode and store user info if available
          if (params.user) {
            try {
              const userJson =
                typeof atob !== "undefined"
                  ? atob(params.user)
                  : Buffer.from(params.user, "base64").toString("utf-8");
              const userData = JSON.parse(userJson);
              const userInfo: Auth.User = {
                id: userData.id,
                openId: userData.openId,
                name: userData.name,
                email: userData.email,
                loginMethod: userData.loginMethod,
                lastSignedIn: new Date(userData.lastSignedIn || Date.now()),
              };
              await Auth.setUserInfo(userInfo);
              console.log("[OAuth] User info stored:", userInfo);
            } catch (err) {
              console.error("[OAuth] Failed to parse user data:", err);
            }
          }

          setStatus("success");
          console.log("[OAuth] Web authentication successful, redirecting to home...");
          return;
        }

        // Get URL from params or Linking
        let url: string | null = null;

        if (params.code || params.state || params.error) {
          console.log("[OAuth] Found params in route params");
          const urlParams = new URLSearchParams();
          if (params.code) urlParams.set("code", params.code);
          if (params.state) urlParams.set("state", params.state);
          if (params.error) urlParams.set("error", params.error);
          url = `?${urlParams.toString()}`;
        } else {
          console.log("[OAuth] No params found, checking Linking.getInitialURL()...");
          const initialUrl = await Linking.getInitialURL();
          if (initialUrl) {
            url = initialUrl;
          }
        }

        // Check for error
        const error =
          params.error || (url ? new URL(url, "http://dummy").searchParams.get("error") : null);
        if (error) {
          console.error("[OAuth] Error parameter found:", error);
          setStatus("error");
          setErrorCode(error);
          setErrorMessage(error);
          return;
        }

        // Check for code and state
        let code: string | null = null;
        let state: string | null = null;
        let sessionToken: string | null = null;

        if (params.code && params.state) {
          code = params.code;
          state = params.state;
        } else if (url) {
          try {
            const urlObj = new URL(url);
            code = urlObj.searchParams.get("code");
            state = urlObj.searchParams.get("state");
            sessionToken = urlObj.searchParams.get("sessionToken");
          } catch (e) {
            const match = url.match(/[?&](code|state|sessionToken)=([^&]+)/g);
            if (match) {
              match.forEach((param) => {
                const [key, value] = param.substring(1).split("=");
                if (key === "code") code = decodeURIComponent(value);
                if (key === "state") state = decodeURIComponent(value);
                if (key === "sessionToken") sessionToken = decodeURIComponent(value);
              });
            }
          }
        }

        // If we have sessionToken directly from URL, use it
        if (sessionToken) {
          await Auth.setSessionToken(sessionToken);
          setStatus("success");
          return;
        }

        // Otherwise, exchange code for session token
        if (!code || !state) {
          setStatus("error");
          setErrorCode("missing_params");
          setErrorMessage("Missing code or state parameter");
          return;
        }

        // Exchange code for session token
        const result = await Api.exchangeOAuthCode(code, state);

        if (result.sessionToken) {
          await Auth.setSessionToken(result.sessionToken);

          if (result.user) {
            const userInfo: Auth.User = {
              id: result.user.id,
              openId: result.user.openId,
              name: result.user.name,
              email: result.user.email,
              loginMethod: result.user.loginMethod,
              lastSignedIn: new Date(result.user.lastSignedIn || Date.now()),
            };
            await Auth.setUserInfo(userInfo);
          }

          setStatus("success");
        } else {
          setStatus("error");
          setErrorCode("token_exchange_failed");
          setErrorMessage("No session token received");
        }
      } catch (error) {
        console.error("[OAuth] Callback error:", error);
        setStatus("error");
        const msg = error instanceof Error ? error.message : "Failed to complete authentication";
        if (msg.includes("network") || msg.includes("fetch") || msg.includes("Failed to fetch")) {
          setErrorCode("network_error");
        } else {
          setErrorCode("default");
        }
        setErrorMessage(msg);
      }
    };

    handleCallback();
  }, [params.code, params.state, params.error, params.sessionToken, params.user, router]);

  const errorInfo = getErrorInfo(errorCode, errorMessage);

  const handleRetry = () => {
    router.replace("/login");
  };

  const handleGoHome = () => {
    router.replace("/(tabs)");
  };

  return (
    <ErrorBoundary>
      <SafeAreaView style={styles.container} edges={["top", "bottom", "left", "right"]}>
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          {/* Decorative orbs */}
          <View style={[styles.orb, styles.orb1]} />
          <View style={[styles.orb, styles.orb2]} />

          {status === "processing" && (
            <View style={styles.statusCard}>
              <View style={styles.loadingRing}>
                <ActivityIndicator size="large" color="#FF6B6B" />
              </View>
              <View style={styles.pulsingRow}>
                <PulsingDot />
                <PulsingDot />
                <PulsingDot />
              </View>
              <Text style={styles.processingTitle}>正在完成登录验证</Text>
              <Text style={styles.processingSubtext}>请稍候，正在安全地验证您的身份...</Text>
              <View style={styles.stepList}>
                <View style={styles.stepRow}>
                  <MaterialIcons name="check-circle" size={16} color="#4CAF50" />
                  <Text style={styles.stepText}>已连接 Google 帐号</Text>
                </View>
                <View style={styles.stepRow}>
                  <ActivityIndicator size="small" color="#FF6B6B" />
                  <Text style={styles.stepText}>正在验证身份...</Text>
                </View>
              </View>
            </View>
          )}

          {status === "success" && (
            <View style={styles.statusCard}>
              <View style={styles.successCircle}>
                <MaterialIcons name="check-circle" size={72} color="#4CAF50" />
              </View>
              <Text style={styles.successTitle}>登录成功！</Text>
              <Text style={styles.successSubtext}>欢迎回来，即将为您跳转到首页</Text>
              <View style={styles.countdownBadge}>
                <Text style={styles.countdownText}>{countdown} 秒后自动跳转</Text>
              </View>
              <TouchableOpacity style={styles.skipButton} onPress={handleGoHome} activeOpacity={0.7}>
                <Text style={styles.skipButtonText}>立即前往</Text>
                <MaterialIcons name="arrow-forward" size={16} color="#FF6B6B" />
              </TouchableOpacity>
            </View>
          )}

          {status === "error" && (
            <View style={styles.statusCard}>
              <View style={styles.errorCircle}>
                <MaterialIcons name="error-outline" size={72} color="#FF453A" />
              </View>
              <Text style={styles.errorTitle}>{errorInfo.title}</Text>
              <Text style={styles.errorDesc}>{errorInfo.desc}</Text>

              <View style={styles.errorActions}>
                {errorInfo.canRetry && (
                  <TouchableOpacity style={styles.retryButton} onPress={handleRetry} activeOpacity={0.8}>
                    <MaterialIcons name="refresh" size={20} color="#FFFFFF" />
                    <Text style={styles.retryButtonText}>重新登录</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.homeButton} onPress={handleGoHome} activeOpacity={0.8}>
                  <MaterialIcons name="home" size={20} color="#9B9691" />
                  <Text style={styles.homeButtonText}>返回首页</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.helpSection}>
                <MaterialIcons name="help-outline" size={16} color="#6B6560" />
                <Text style={styles.helpText}>
                  如果问题持续出现，请尝试：清除浏览器缓存、使用无痕模式、或联系客服支持
                </Text>
              </View>
            </View>
          )}
        </Animated.View>
      </SafeAreaView>
    </ErrorBoundary>
  );
}

const isWeb = Platform.OS === "web";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0D0F",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  orb: { position: "absolute", borderRadius: 999 },
  orb1: {
    width: 300, height: 300, top: -80, right: -60,
    backgroundColor: "rgba(255,107,107,0.06)",
  },
  orb2: {
    width: 250, height: 250, bottom: -40, left: -80,
    backgroundColor: "rgba(100,210,255,0.04)",
  },

  /* Status Card */
  statusCard: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    backgroundColor: "rgba(30,20,40,0.8)",
    borderRadius: 24,
    padding: 36,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    ...(isWeb ? { backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "0 8px 40px rgba(0,0,0,0.4)" } as any : {}),
  },

  /* Loading */
  loadingRing: {
    marginBottom: 20,
  },
  pulsingRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 24,
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF6B6B",
  },
  processingTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#F7F4EF",
    marginBottom: 8,
    textAlign: "center",
  },
  processingSubtext: {
    fontSize: 14,
    color: "#9B9691",
    textAlign: "center",
    marginBottom: 24,
  },
  stepList: {
    width: "100%",
    gap: 12,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepText: {
    fontSize: 14,
    color: "#C8C4BF",
  },

  /* Success */
  successCircle: {
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#4CAF50",
    marginBottom: 8,
    textAlign: "center",
  },
  successSubtext: {
    fontSize: 15,
    color: "#9B9691",
    textAlign: "center",
    marginBottom: 20,
  },
  countdownBadge: {
    backgroundColor: "rgba(76,175,80,0.12)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 16,
  },
  countdownText: {
    fontSize: 13,
    color: "#4CAF50",
    fontWeight: "600",
  },
  skipButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  skipButtonText: {
    fontSize: 14,
    color: "#FF6B6B",
    fontWeight: "600",
  },

  /* Error */
  errorCircle: {
    marginBottom: 20,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FF453A",
    marginBottom: 12,
    textAlign: "center",
  },
  errorDesc: {
    fontSize: 15,
    color: "#9B9691",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 28,
  },
  errorActions: {
    width: "100%",
    gap: 12,
    marginBottom: 24,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FF6B6B",
    paddingVertical: 16,
    borderRadius: 14,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  homeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  homeButtonText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#9B9691",
  },
  helpSection: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  helpText: {
    flex: 1,
    fontSize: 12,
    color: "#6B6560",
    lineHeight: 18,
  },
});
