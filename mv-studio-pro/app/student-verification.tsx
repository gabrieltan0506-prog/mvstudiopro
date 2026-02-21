import {
  ScrollView,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useRouter } from "expo-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export default function StudentVerificationScreen() {
  const router = useRouter();
  const [step, setStep] = useState<"info" | "upload" | "email" | "subscription">("info");
  const [studentIdImage, setStudentIdImage] = useState<string | null>(null);
  const [schoolEmail, setSchoolEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<"6months" | "1year" | null>(null);

  const submitVerification = trpc.student.submitVerification.useMutation();
  const verifyEmail = trpc.student.verifySchoolEmail.useMutation();
  const createSubscription = trpc.student.createSubscription.useMutation();
  const startTrial = trpc.student.startTrial.useMutation();

  const handleStartTrial = async () => {
    Alert.alert(
      "开始免费试用",
      "您将获得 2 天免费试用，包含视频 PK 评分、2D/3D 偶像生成、720P 视频生成等内核功能。试用期内功能有限，升级订阅可解锁更多。",
      [
        { text: "再看看", style: "cancel" },
        {
          text: "立即试用",
          onPress: async () => {
            try {
              const result = await startTrial.mutateAsync();
              if (Platform.OS !== "web") {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
              Alert.alert(
                "试用已开始",
                `您的 2 天免费试用已启动！\n到期时间：${new Date(result.endDate).toLocaleDateString("zh-TW")}\n\n快去体验各项功能吧！`,
                [{ text: "开始探索", onPress: () => router.back() }]
              );
            } catch (error: any) {
              Alert.alert("错误", error.message || "启动试用失败");
            }
          },
        },
      ]
    );
  };

  const handlePickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0].base64) {
        setStudentIdImage(result.assets[0].base64);
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (error: any) {
      Alert.alert("错误", "选择图片失败：" + error.message);
    }
  };

  const handleSubmitStudentId = async () => {
    if (!studentIdImage) {
      Alert.alert("提示", "请上传学生证照片");
      return;
    }

    try {
      // TODO: Upload image to S3 and get URL
      const imageUrl = `data:image/jpeg;base64,${studentIdImage}`;
      
      await submitVerification.mutateAsync({
        studentIdImageUrl: imageUrl,
        schoolEmail: schoolEmail || "temp@temp.edu",
        educationLevel: "university",
        schoolName: "Pending",
      });
      setStep("email");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error: any) {
      Alert.alert("错误", error.message || "提交失败");
    }
  };

  const handleSendEmailCode = async () => {
    if (!schoolEmail.trim()) {
      Alert.alert("提示", "请输入学校邮箱");
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(schoolEmail)) {
      Alert.alert("提示", "请输入有效的邮箱地址");
      return;
    }

    // Check if it's an educational email
    const eduDomains = [".edu", ".ac.", ".edu."];
    const isEduEmail = eduDomains.some((domain) => schoolEmail.toLowerCase().includes(domain));
    if (!isEduEmail) {
      Alert.alert(
        "提示",
        "请使用学校邮箱（通常包含 .edu 或 .ac 等教育机构域名）"
      );
      return;
    }

    // Email code is sent automatically when submitting student ID
    Alert.alert("提示", "验证码已在提交学生证时发送到您的邮箱，请查收");
  };

  const handleVerifyEmail = async () => {
    if (!emailCode.trim() || emailCode.length !== 6) {
      Alert.alert("提示", "请输入 6 位验证码");
      return;
    }

    try {
      await verifyEmail.mutateAsync({ code: emailCode });
      setStep("subscription");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error: any) {
      Alert.alert("错误", error.message || "验证失败");
    }
  };

  const handleSelectPlan = async (plan: "6months" | "1year") => {
    setSelectedPlan(plan);
    const price = plan === "6months" ? 138 : 268;

    Alert.alert(
      "确认订阅",
      `您选择了${plan === "6months" ? "半年" : "一年"}订阅（¥${price}），请选择支付方式`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "继续支付",
          onPress: async () => {
            try {
              const result = await createSubscription.mutateAsync({
                subscriptionType: plan === "6months" ? "halfYear" : "fullYear",
                paymentMethod: "pending",
                paymentId: "pending",
              });

              // Navigate to payment page
              router.push({
                pathname: "/payment-method" as any,
                params: {
                  package: `student_${plan}`,
                  isSubscription: "true",
                },
              });
            } catch (error: any) {
              Alert.alert("错误", error.message || "创建订阅失败");
            }
          },
        },
      ]
    );
  };

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View className="px-6 pt-8 pb-6">
          <TouchableOpacity onPress={() => router.back()} className="mb-4">
            <Text className="text-primary text-base">← 返回</Text>
          </TouchableOpacity>
          <Text className="text-3xl font-bold text-foreground mb-2">🎓 学生优惠</Text>
          <Text className="text-base text-muted">验证学生身份，享受超值订阅优惠</Text>
        </View>

        {/* Step Indicator */}
        <View className="mx-6 mb-6 flex-row items-center justify-between">
          <View className="items-center flex-1">
            <View
              className={`w-10 h-10 rounded-full items-center justify-center ${
                step === "info" ? "bg-primary" : "bg-success"
              }`}
            >
              <Text className="text-background font-bold">1</Text>
            </View>
            <Text className="text-xs text-muted mt-2">优惠说明</Text>
          </View>
          <View className="h-0.5 bg-border flex-1 mx-2" />
          <View className="items-center flex-1">
            <View
              className={`w-10 h-10 rounded-full items-center justify-center ${
                step === "upload"
                  ? "bg-primary"
                  : step === "email" || step === "subscription"
                    ? "bg-success"
                    : "bg-surface border border-border"
              }`}
            >
              <Text
                className={`font-bold ${
                  step === "upload" || step === "email" || step === "subscription"
                    ? "text-background"
                    : "text-muted"
                }`}
              >
                2
              </Text>
            </View>
            <Text className="text-xs text-muted mt-2">上传学生证</Text>
          </View>
          <View className="h-0.5 bg-border flex-1 mx-2" />
          <View className="items-center flex-1">
            <View
              className={`w-10 h-10 rounded-full items-center justify-center ${
                step === "email"
                  ? "bg-primary"
                  : step === "subscription"
                    ? "bg-success"
                    : "bg-surface border border-border"
              }`}
            >
              <Text
                className={`font-bold ${
                  step === "email" || step === "subscription" ? "text-background" : "text-muted"
                }`}
              >
                3
              </Text>
            </View>
            <Text className="text-xs text-muted mt-2">验证邮箱</Text>
          </View>
          <View className="h-0.5 bg-border flex-1 mx-2" />
          <View className="items-center flex-1">
            <View
              className={`w-10 h-10 rounded-full items-center justify-center ${
                step === "subscription" ? "bg-primary" : "bg-surface border border-border"
              }`}
            >
              <Text className={`font-bold ${step === "subscription" ? "text-background" : "text-muted"}`}>
                4
              </Text>
            </View>
            <Text className="text-xs text-muted mt-2">选择订阅</Text>
          </View>
        </View>

        {/* Step: Info */}
        {step === "info" && (
          <View className="mx-6">
            {/* Benefits */}
            <View className="bg-gradient-to-r from-primary to-primary/80 rounded-2xl p-6 mb-6">
              <Text className="text-2xl font-bold text-background mb-4">学生专享优惠</Text>
              <View className="gap-3">
                <View className="flex-row items-center">
                  <Text className="text-background mr-2">✓</Text>
                  <Text className="text-sm text-background flex-1">
                    视频 PK 评分、分镜脚本、虚拟偶像生成等内核功能
                  </Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-background mr-2">✓</Text>
                  <Text className="text-sm text-background flex-1">免费试用 2 天，无需付款信息</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-background mr-2">✓</Text>
                  <Text className="text-sm text-background flex-1">订阅方案：半年 ¥138 或一年 ¥268</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-background mr-2">✓</Text>
                  <Text className="text-sm text-background flex-1">优先客服支持</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-background mr-2">✓</Text>
                  <Text className="text-sm text-background flex-1">
                    平台有权展示您的生成内容（可选匿名）
                  </Text>
                </View>
              </View>
            </View>

            {/* Eligibility */}
            <View className="bg-surface rounded-2xl p-6 border border-border mb-6">
              <Text className="text-lg font-bold text-foreground mb-3">📋 申请资格</Text>
              <View className="gap-2">
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">小学、初中、高中、大学在读学生</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-error mr-2">✗</Text>
                  <Text className="text-sm text-muted">不包含研究生及以上学历</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">需提供有效学生证和学校邮箱</Text>
                </View>
              </View>
            </View>

            {/* Terms */}
            <View className="bg-primary/10 rounded-2xl p-6 mb-6">
              <Text className="text-lg font-bold text-foreground mb-3">📜 用户协议</Text>
              <View className="gap-2">
                <Text className="text-sm text-foreground">1. 您保留生成内容的所有权</Text>
                <Text className="text-sm text-foreground">
                  2. 您授权平台将生成内容用于展示、推广和产品改进
                </Text>
                <Text className="text-sm text-foreground">
                  3. 平台承诺不将内容用于商业销售
                </Text>
                <Text className="text-sm text-foreground">
                  4. 展示时会标注创作者（可选匿名）
                </Text>
                <Text className="text-sm text-foreground">
                  5. 停止使用平台半年后，可要求移除生成内容
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={() => setStep("upload")}
              className="bg-primary rounded-full py-4"
            >
              <Text className="text-center text-background font-semibold">开始申请</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step: Upload Student ID */}
        {step === "upload" && (
          <View className="mx-6">
            <Text className="text-lg font-bold text-foreground mb-4">上传学生证</Text>
            <Text className="text-sm text-muted mb-6">
              请上传清晰的学生证照片，需包含姓名、学校名称和有效期
            </Text>

            {studentIdImage ? (
              <View className="bg-surface rounded-2xl p-4 border border-border mb-6">
                <Image
                  source={{ uri: `data:image/jpeg;base64,${studentIdImage}` }}
                  style={{ width: "100%", height: 300 }}
                  resizeMode="contain"
                />
                <TouchableOpacity
                  onPress={() => setStudentIdImage(null)}
                  className="mt-4 bg-error/10 rounded-full py-2"
                >
                  <Text className="text-center text-error font-semibold">重新选择</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={handlePickImage}
                className="bg-surface rounded-2xl p-8 border-2 border-dashed border-border items-center mb-6"
              >
                <Text className="text-5xl mb-3">🎓</Text>
                <Text className="text-base font-semibold text-foreground mb-2">点击上传学生证</Text>
                <Text className="text-sm text-muted text-center">
                  支持 JPG、PNG 格式{"\n"}请确保照片清晰完整
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={handleSubmitStudentId}
              disabled={!studentIdImage || submitVerification.isPending}
              className={`rounded-full py-4 ${
                !studentIdImage || submitVerification.isPending ? "bg-muted" : "bg-primary"
              }`}
            >
              {submitVerification.isPending ? (
                <View className="flex-row items-center justify-center">
                  <ActivityIndicator color="#fff" size="small" />
                  <Text className="text-background font-semibold ml-2">提交中...</Text>
                </View>
              ) : (
                <Text className="text-center text-background font-semibold">
                  {studentIdImage ? "下一步" : "请先上传学生证"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Step: Email Verification */}
        {step === "email" && (
          <View className="mx-6">
            <Text className="text-lg font-bold text-foreground mb-4">验证学校邮箱</Text>
            <Text className="text-sm text-muted mb-6">
              请使用学校邮箱（通常包含 .edu 或 .ac 等教育机构域名）
            </Text>

            <TextInput
              value={schoolEmail}
              onChangeText={setSchoolEmail}
              placeholder="your.name@school.edu"
              placeholderTextColor="#9BA1A6"
              keyboardType="email-address"
              autoCapitalize="none"
              className="bg-surface border border-border rounded-xl px-4 py-4 text-foreground text-base mb-4"
            />

            <TouchableOpacity
              onPress={handleSendEmailCode}
              className="rounded-full py-4 mb-6 bg-primary"
            >
              <Text className="text-center text-background font-semibold">查看提示</Text>
            </TouchableOpacity>

            <TextInput
              value={emailCode}
              onChangeText={setEmailCode}
              placeholder="6 位验证码"
              placeholderTextColor="#9BA1A6"
              keyboardType="number-pad"
              maxLength={6}
              className="bg-surface border border-border rounded-xl px-4 py-4 text-foreground text-2xl text-center mb-4 tracking-widest"
            />

            <TouchableOpacity
              onPress={handleVerifyEmail}
              disabled={verifyEmail.isPending}
              className={`rounded-full py-4 ${
                verifyEmail.isPending ? "bg-muted" : "bg-primary"
              }`}
            >
              {verifyEmail.isPending ? (
                <View className="flex-row items-center justify-center">
                  <ActivityIndicator color="#fff" size="small" />
                  <Text className="text-background font-semibold ml-2">验证中...</Text>
                </View>
              ) : (
                <Text className="text-center text-background font-semibold">验证邮箱</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Step: Subscription */}
        {step === "subscription" && (
          <View className="mx-6">
            <Text className="text-lg font-bold text-foreground mb-4">选择订阅计划</Text>
            <Text className="text-sm text-muted mb-6">先免费试用 2 天，再决定是否订阅</Text>

            {/* Free Trial */}
            <TouchableOpacity
              onPress={handleStartTrial}
              disabled={startTrial.isPending}
              className="bg-surface rounded-2xl p-6 border-2 border-success mb-4"
            >
              <View className="absolute top-4 right-4 bg-success rounded-full px-3 py-1">
                <Text className="text-xs text-background font-bold">免费</Text>
              </View>
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-xl font-bold text-foreground">2 天免费试用</Text>
                <View>
                  <Text className="text-3xl font-bold text-success">¥0</Text>
                </View>
              </View>
              <Text className="text-sm text-muted mb-4">先体验，再决定。无需付款信息</Text>
              <View className="gap-2">
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">视频 PK 评分：2 次</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">分镜脚本生成：1 次</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">虚拟偶像 2D 生成：3 个</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">偶像 2D 转 3D：1 次</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-foreground font-semibold">视频生成：1 次（限 720P）</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">视频展厅浏览：无限</Text>
                </View>
              </View>
              {startTrial.isPending && (
                <View className="mt-3 flex-row items-center justify-center">
                  <ActivityIndicator color="#22C55E" size="small" />
                  <Text className="text-success font-semibold ml-2">启动中...</Text>
                </View>
              )}
            </TouchableOpacity>

            <View className="flex-row items-center mb-4">
              <View className="flex-1 h-px bg-border" />
              <Text className="text-muted text-xs mx-3">或直接订阅</Text>
              <View className="flex-1 h-px bg-border" />
            </View>

            {/* 6 Months Plan */}
            <TouchableOpacity
              onPress={() => handleSelectPlan("6months")}
              disabled={createSubscription.isPending}
              className={`bg-surface rounded-2xl p-6 border-2 mb-4 ${
                selectedPlan === "6months" ? "border-primary" : "border-border"
              }`}
            >
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-xl font-bold text-foreground">半年订阅</Text>
                <View>
                  <Text className="text-3xl font-bold text-primary">¥138</Text>
                  <Text className="text-xs text-muted text-right">CNY</Text>
                </View>
              </View>
              <Text className="text-sm text-muted mb-4">平均每月 ¥23，适合短期项目</Text>
              <View className="gap-2">
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">视频 PK 评分：每月 5 次</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">分镜脚本生成：每月 3 次</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">虚拟偶像 2D 生成：无限</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">视频展厅浏览：无限</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">6 个月有效期</Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* 1 Year Plan */}
            <TouchableOpacity
              onPress={() => handleSelectPlan("1year")}
              disabled={createSubscription.isPending}
              className={`bg-surface rounded-2xl p-6 border-2 ${
                selectedPlan === "1year" ? "border-primary" : "border-border"
              }`}
            >
              <View className="absolute top-4 right-4 bg-primary rounded-full px-3 py-1">
                <Text className="text-xs text-background font-bold">推荐</Text>
              </View>
<View className="flex-row justify-between items-center mb-3">
                <Text className="text-xl font-bold text-foreground">一年订阅</Text>
                <View>
                  <Text className="text-3xl font-bold text-primary">¥268</Text>
                  <Text className="text-xs text-muted text-right">CNY</Text>
                </View>
              </View>
              <Text className="text-sm text-muted mb-4">平均每月 ¥22.3，最划算的选择</Text>
              <View className="gap-2">
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">视频 PK 评分：每月 15 次</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">分镜脚本生成：每月 8 次</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">虚拟偶像 2D 生成：无限</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">虚拟偶像 2D 转 3D：每月 3 次</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">口型同步：每月 5 次</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-foreground font-semibold">视频生成：每月 2 次 🔥</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">视频展厅 + 创作工具：无限</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">12 个月有效期</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-success mr-2">✓</Text>
                  <Text className="text-sm text-muted">优先客服支持</Text>
                </View>
              </View>
            </TouchableOpacity>

            {createSubscription.isPending && (
              <View className="mt-6 bg-primary/10 rounded-2xl p-4">
                <Text className="text-center text-primary">正在创建订阅...</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
