import { ScrollView, Text, View, TouchableOpacity, TextInput, Alert, ActivityIndicator } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useRouter } from "expo-router";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export default function PhoneVerificationScreen() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [countdown, setCountdown] = useState(0);

  const { data: phoneStatus, refetch } = trpc.phone.getPhoneStatus.useQuery();
  const sendCode = trpc.phone.sendVerificationCode.useMutation();
  const verifyCode = trpc.phone.verifyPhoneNumber.useMutation();

  useEffect(() => {
    if (phoneStatus?.verified) {
      Alert.alert("提示", "您的手机号码已验证", [
        {
          text: "确定",
          onPress: () => router.back(),
        },
      ]);
    }
  }, [phoneStatus]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendCode = async () => {
    if (!phoneNumber.trim()) {
      Alert.alert("提示", "请输入手机号码");
      return;
    }

    // Validate phone number format (E.164)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phoneNumber)) {
      Alert.alert("提示", "请输入有效的手机号码（例如：+8613812345678）");
      return;
    }

    try {
      await sendCode.mutateAsync({ phoneNumber });
      setStep("code");
      setCountdown(60);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert("成功", "验证码已发送到您的手机");
    } catch (error: any) {
      Alert.alert("错误", error.message || "发送验证码失败");
    }
  };

  const handleVerifyCode = async () => {
    if (!verificationCode.trim() || verificationCode.length !== 6) {
      Alert.alert("提示", "请输入 6 位验证码");
      return;
    }

    try {
      await verifyCode.mutateAsync({ code: verificationCode });
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert("验证成功", "手机号码已验证", [
        {
          text: "确定",
          onPress: () => {
            refetch();
            router.back();
          },
        },
      ]);
    } catch (error: any) {
      Alert.alert("错误", error.message || "验证失败");
    }
  };

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View className="px-6 pt-8 pb-6">
          <TouchableOpacity onPress={() => router.back()} className="mb-4">
            <Text className="text-primary text-base">← 返回</Text>
          </TouchableOpacity>
          <Text className="text-3xl font-bold text-foreground mb-2">手机号码验证</Text>
          <Text className="text-base text-muted">验证手机号码以防止滥用</Text>
        </View>

        {/* Why Verify */}
        <View className="mx-6 mb-6 bg-primary/10 rounded-2xl p-6">
          <Text className="text-lg font-bold text-foreground mb-3">🔒 为什么需要验证？</Text>
          <View className="gap-2">
            <View className="flex-row items-center">
              <Text className="text-primary mr-2">•</Text>
              <Text className="text-sm text-foreground flex-1">防止同一人注册多个帐号滥用免费额度</Text>
            </View>
            <View className="flex-row items-center">
              <Text className="text-primary mr-2">•</Text>
              <Text className="text-sm text-foreground flex-1">一个手机号只能注册一个帐号</Text>
            </View>
            <View className="flex-row items-center">
              <Text className="text-primary mr-2">•</Text>
              <Text className="text-sm text-foreground flex-1">保护您的帐号安全</Text>
            </View>
          </View>
        </View>

        {/* Phone Number Input */}
        {step === "phone" && (
          <View className="mx-6 mb-6">
            <Text className="text-base font-semibold text-foreground mb-3">输入手机号码</Text>
            <TextInput
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              placeholder="+8613812345678"
              placeholderTextColor="#9BA1A6"
              keyboardType="phone-pad"
              className="bg-surface border border-border rounded-xl px-4 py-4 text-foreground text-base mb-4"
            />
            <Text className="text-sm text-muted mb-4">
              请输入完整的国际格式手机号码（包含国家代码）
            </Text>
            <TouchableOpacity
              onPress={handleSendCode}
              disabled={sendCode.isPending || countdown > 0}
              className={`rounded-full py-4 ${
                sendCode.isPending || countdown > 0 ? "bg-muted" : "bg-primary"
              }`}
            >
              {sendCode.isPending ? (
                <View className="flex-row items-center justify-center">
                  <ActivityIndicator color="#fff" size="small" />
                  <Text className="text-background font-semibold ml-2">发送中...</Text>
                </View>
              ) : (
                <Text className="text-center text-background font-semibold">
                  {countdown > 0 ? `${countdown} 秒后可重新发送` : "发送验证码"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Verification Code Input */}
        {step === "code" && (
          <View className="mx-6 mb-6">
            <Text className="text-base font-semibold text-foreground mb-3">输入验证码</Text>
            <TextInput
              value={verificationCode}
              onChangeText={setVerificationCode}
              placeholder="6 位验证码"
              placeholderTextColor="#9BA1A6"
              keyboardType="number-pad"
              maxLength={6}
              className="bg-surface border border-border rounded-xl px-4 py-4 text-foreground text-2xl text-center mb-4 tracking-widest"
            />
            <Text className="text-sm text-muted mb-4 text-center">
              验证码已发送到 {phoneNumber}
            </Text>
            <TouchableOpacity
              onPress={handleVerifyCode}
              disabled={verifyCode.isPending}
              className={`rounded-full py-4 mb-3 ${
                verifyCode.isPending ? "bg-muted" : "bg-primary"
              }`}
            >
              {verifyCode.isPending ? (
                <View className="flex-row items-center justify-center">
                  <ActivityIndicator color="#fff" size="small" />
                  <Text className="text-background font-semibold ml-2">验证中...</Text>
                </View>
              ) : (
                <Text className="text-center text-background font-semibold">验证</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSendCode}
              disabled={countdown > 0}
              className="py-3"
            >
              <Text className="text-center text-primary text-sm">
                {countdown > 0 ? `${countdown} 秒后可重新发送` : "重新发送验证码"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Privacy Notice */}
        <View className="mx-6 bg-surface rounded-2xl p-6 border border-border">
          <Text className="text-lg font-bold text-foreground mb-3">🛡️ 隐私保护</Text>
          <View className="gap-2">
            <View className="flex-row items-center">
              <Text className="text-success mr-2">✓</Text>
              <Text className="text-sm text-muted">您的手机号码仅用于帐号验证</Text>
            </View>
            <View className="flex-row items-center">
              <Text className="text-success mr-2">✓</Text>
              <Text className="text-sm text-muted">不会用于营销或第三方共享</Text>
            </View>
            <View className="flex-row items-center">
              <Text className="text-success mr-2">✓</Text>
              <Text className="text-sm text-muted">符合 GDPR 和 CCPA 隐私法规</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
