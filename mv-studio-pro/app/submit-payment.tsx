import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Image, Alert, ActivityIndicator, StyleSheet } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { MaterialIcons } from "@expo/vector-icons";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";

const PACKAGE_OPTIONS = [
  { value: "basic", label: "基础版", price: "¥86/4次" },
  { value: "pro", label: "专业版", price: "¥108/2次" },
  { value: "enterprise", label: "企业版", price: "¥143/月" },
];

const PAYMENT_METHODS = [
  { value: "wechat", label: "微信支付" },
  { value: "alipay", label: "支付宝" },
  { value: "bank_transfer", label: "银行转帐" },
];

export default function SubmitPaymentScreen() {
  const colors = useColors();
  const { isAuthenticated, user } = useAuth();
  const [packageType, setPackageType] = useState("basic");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("wechat");
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ✅ All tRPC mutations MUST be called at the top level, before any early returns
  const submitPaymentMutation = trpc.paymentSubmission.submit.useMutation();
  const uploadScreenshotMutation = trpc.paymentSubmission.uploadScreenshot.useMutation();

  // 检查登录状态（所有 Hooks 必须在条件判断之前调用）
  if (!isAuthenticated) {
    return (
      <ScreenContainer>
        <View style={[s.container, { backgroundColor: colors.background }]}>
          <MaterialIcons name="lock" size={64} color={colors.muted} />
          <Text style={[s.title, { color: colors.foreground }]}>请先登录</Text>
          <Text style={[s.subtitle, { color: colors.muted }]}>您需要登录才能提交付款截屏</Text>
          <TouchableOpacity
            style={[s.loginBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/login")}
          >
            <Text style={[s.loginBtnText, { color: "#FFFFFF" }]}>前往登录</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("权限不足", "需要相册权限才能上传付款截屏");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setScreenshotUri(result.assets[0].uri);
    }
  };

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("权限不足", "需要相机权限才能拍摄付款截屏");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setScreenshotUri(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (!amount || !screenshotUri) {
      Alert.alert("数据不完整", "请填写付款金额并上传付款截屏");
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      Alert.alert("金额错误", "请输入有效的付款金额");
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. 将图片转换为 base64
      const response = await fetch(screenshotUri);
      const blob = await response.blob();
      const reader = new FileReader();
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const base64 = reader.result as string;
          // 移除 data:image/jpeg;base64, 前缀
          const base64Data = base64.split(",")[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // 2. 上传图片到 S3
      const uploadResult = await uploadScreenshotMutation.mutateAsync({
        imageBase64,
        mimeType: "image/jpeg",
      });

      // 3. 提交付款审核
      await submitPaymentMutation.mutateAsync({
        packageType,
        amount: amountNum.toString(),
        paymentMethod,
        screenshotUrl: uploadResult.url,
      });

      Alert.alert(
        "提交成功",
        "您的付款截屏已提交，管理员将在 24 小时内审核。审核通过后，您的帐号将自动开通对应的套餐权限。",
        [{ text: "确定", onPress: () => router.back() }]
      );
    } catch (error) {
      console.error("提交付款失败:", error);
      Alert.alert("提交失败", "提交付款截屏时发生错误，请稍后再试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <ScrollView style={[s.scrollView, { backgroundColor: colors.background }]}>
        <View style={s.container}>
          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[s.headerTitle, { color: colors.foreground }]}>提交付款截屏</Text>
            <View style={{ width: 24 }} />
          </View>

          {/* 套餐选择 */}
          <View style={s.section}>
            <Text style={[s.label, { color: colors.foreground }]}>选择套餐</Text>
            <View style={s.optionsRow}>
              {PACKAGE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    s.optionCard,
                    { borderColor: packageType === option.value ? colors.primary : colors.border },
                    packageType === option.value && { backgroundColor: `${colors.primary}20` },
                  ]}
                  onPress={() => setPackageType(option.value)}
                >
                  <Text style={[s.optionLabel, { color: colors.foreground }]}>{option.label}</Text>
                  <Text style={[s.optionPrice, { color: colors.muted }]}>{option.price}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* 付款金额 */}
          <View style={s.section}>
            <Text style={[s.label, { color: colors.foreground }]}>付款金额（CNY）</Text>
            <TextInput
              style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
              placeholder="请输入付款金额"
              placeholderTextColor={colors.muted}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
          </View>

          {/* 付款方式 */}
          <View style={s.section}>
            <Text style={[s.label, { color: colors.foreground }]}>付款方式</Text>
            <View style={s.optionsRow}>
              {PAYMENT_METHODS.map((method) => (
                <TouchableOpacity
                  key={method.value}
                  style={[
                    s.methodBtn,
                    { borderColor: paymentMethod === method.value ? colors.primary : colors.border },
                    paymentMethod === method.value && { backgroundColor: `${colors.primary}20` },
                  ]}
                  onPress={() => setPaymentMethod(method.value)}
                >
                  <Text style={[s.methodLabel, { color: colors.foreground }]}>{method.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* 付款截屏 */}
          <View style={s.section}>
            <Text style={[s.label, { color: colors.foreground }]}>付款截屏</Text>
            {screenshotUri ? (
              <View style={s.imagePreview}>
                <Image source={{ uri: screenshotUri }} style={s.image} />
                <TouchableOpacity
                  style={[s.removeBtn, { backgroundColor: colors.error }]}
                  onPress={() => setScreenshotUri(null)}
                >
                  <MaterialIcons name="close" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.uploadBtns}>
                <TouchableOpacity
                  style={[s.uploadBtn, { borderColor: colors.border }]}
                  onPress={handlePickImage}
                >
                  <MaterialIcons name="photo-library" size={32} color={colors.primary} />
                  <Text style={[s.uploadBtnText, { color: colors.foreground }]}>从相册选择</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.uploadBtn, { borderColor: colors.border }]}
                  onPress={handleTakePhoto}
                >
                  <MaterialIcons name="camera-alt" size={32} color={colors.primary} />
                  <Text style={[s.uploadBtnText, { color: colors.foreground }]}>拍摄照片</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* 提交按钮 */}
          <TouchableOpacity
            style={[s.submitBtn, { backgroundColor: colors.primary }]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={s.submitBtnText}>提交审核</Text>
            )}
          </TouchableOpacity>

          {/* 提示 */}
          <View style={[s.notice, { backgroundColor: `${colors.warning}20`, borderColor: colors.warning }]}>
            <MaterialIcons name="info" size={20} color={colors.warning} />
            <Text style={[s.noticeText, { color: colors.foreground }]}>
              提交后，管理员将在 24 小时内审核您的付款。审核通过后，系统将自动开通对应的套餐权限。
            </Text>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const s = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 24,
    textAlign: "center",
  },
  loginBtn: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
  },
  loginBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  backBtn: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "600",
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  optionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  optionCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  optionPrice: {
    fontSize: 14,
  },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  methodBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
  },
  methodLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  uploadBtns: {
    flexDirection: "row",
    gap: 12,
  },
  uploadBtn: {
    flex: 1,
    padding: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    gap: 8,
  },
  uploadBtnText: {
    fontSize: 14,
    fontWeight: "500",
  },
  imagePreview: {
    position: "relative",
    borderRadius: 12,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: 300,
    resizeMode: "contain",
  },
  removeBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtn: {
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  submitBtnText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "600",
  },
  notice: {
    flexDirection: "row",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  noticeText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});
