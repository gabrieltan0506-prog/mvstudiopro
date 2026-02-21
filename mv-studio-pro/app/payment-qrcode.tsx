import { ScrollView, Text, View, TouchableOpacity, Image, Alert, ActivityIndicator } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import * as Clipboard from "expo-clipboard";

export default function QRCodePaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    orderId: string;
    transactionId: string;
    qrCodeUrl: string;
    amount: string;
    currency: string;
    paymentMethod: string;
    recipientName: string;
    packageName: string;
  }>();

  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const submitScreenshot = trpc.payment.submitPaymentScreenshot.useMutation();

  const handlePickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0].base64) {
        setScreenshot(result.assets[0].base64);
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (error: any) {
      Alert.alert("错误", "选择图片失败：" + error.message);
    }
  };

  const handleSubmit = async () => {
    if (!screenshot) {
      Alert.alert("提示", "请先上传支付截屏");
      return;
    }

    setIsUploading(true);

    try {
      const result = await submitScreenshot.mutateAsync({
        orderId: params.orderId,
        screenshotBase64: screenshot,
      });

      if (result.success) {
        Alert.alert("支付成功", result.message, [
          {
            text: "确定",
            onPress: () => router.replace("/" as any),
          },
        ]);
      } else {
        Alert.alert(
          result.verification?.requiresManualReview ? "等待审核" : "验证失败",
          result.message,
          [
            {
              text: result.verification?.requiresManualReview ? "确定" : "重新上传",
              onPress: () => {
                if (result.verification?.requiresManualReview) {
                  router.replace("/" as any);
                } else {
                  setScreenshot(null);
                }
              },
            },
          ]
        );
      }
    } catch (error: any) {
      Alert.alert("错误", error.message || "提交失败，请稍后再试");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyOrderId = async () => {
    await Clipboard.setStringAsync(params.orderId);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Alert.alert("已拷贝", "订单号已拷贝到剪贴板");
  };

  const paymentMethodName = params.paymentMethod === "wechat" ? "微信支付" : "支付宝";
  
  // Static require mapping (Metro bundler doesn't support dynamic require)
  const qrCodeImages = {
    wechat: require("../assets/payment/wechat-qr.jpg"),
    alipay: require("../assets/payment/alipay-qr.jpg"),
  };
  
  const qrCodePath = params.qrCodeUrl.startsWith("/")
    ? qrCodeImages[params.paymentMethod as keyof typeof qrCodeImages]
    : params.qrCodeUrl;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View className="px-6 pt-8 pb-6">
          <TouchableOpacity onPress={() => router.back()} className="mb-4">
            <Text className="text-primary text-base">← 返回</Text>
          </TouchableOpacity>
          <Text className="text-3xl font-bold text-foreground mb-2">{paymentMethodName}</Text>
          <Text className="text-base text-muted">请使用{paymentMethodName}扫码支付</Text>
        </View>

        {/* Order Info */}
        <View className="mx-6 mb-6 bg-surface rounded-2xl p-6 border border-border">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-sm text-muted">套餐名称</Text>
            <Text className="text-base font-semibold text-foreground">{params.packageName}</Text>
          </View>
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-sm text-muted">支付金额</Text>
            <Text className="text-2xl font-bold text-primary">
              ${params.amount} {params.currency}
            </Text>
          </View>
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-sm text-muted">收款人</Text>
            <Text className="text-base font-semibold text-foreground">{params.recipientName}</Text>
          </View>
          <View className="flex-row justify-between items-center">
            <Text className="text-sm text-muted">订单号</Text>
            <TouchableOpacity onPress={handleCopyOrderId} className="flex-row items-center">
              <Text className="text-xs font-mono text-foreground mr-2">{params.orderId}</Text>
              <Text className="text-primary text-xs">拷贝</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* QR Code */}
        <View className="items-center mb-6">
          <View className="bg-white p-4 rounded-2xl shadow-lg">
            <Image
              source={qrCodePath}
              style={{ width: 280, height: 280 }}
              resizeMode="contain"
            />
          </View>
          <Text className="text-sm text-muted mt-4 text-center px-6">
            请使用{paymentMethodName} App 扫描上方二维码完成支付
          </Text>
        </View>

        {/* Instructions */}
        <View className="mx-6 mb-6 bg-primary/10 rounded-2xl p-6">
          <Text className="text-lg font-bold text-foreground mb-3">📝 支付步骤</Text>
          <View className="gap-3">
            <View className="flex-row">
              <Text className="text-primary font-bold mr-2">1.</Text>
              <Text className="text-sm text-foreground flex-1">
                使用{paymentMethodName} App 扫描上方二维码
              </Text>
            </View>
            <View className="flex-row">
              <Text className="text-primary font-bold mr-2">2.</Text>
              <Text className="text-sm text-foreground flex-1">
                确认金额为 ${params.amount} {params.currency}，收款人为「{params.recipientName}」
              </Text>
            </View>
            <View className="flex-row">
              <Text className="text-primary font-bold mr-2">3.</Text>
              <Text className="text-sm text-foreground flex-1">
                完成支付后，截屏支付成功页面（需包含订单号、金额、时间）
              </Text>
            </View>
            <View className="flex-row">
              <Text className="text-primary font-bold mr-2">4.</Text>
              <Text className="text-sm text-foreground flex-1">
                上传支付截屏，AI 将自动审核并开通功能
              </Text>
            </View>
          </View>
        </View>

        {/* Screenshot Upload */}
        <View className="mx-6 mb-6">
          <Text className="text-lg font-bold text-foreground mb-3">📸 上传支付截屏</Text>

          {screenshot ? (
            <View className="bg-surface rounded-2xl p-4 border border-border mb-4">
              <Image
                source={{ uri: `data:image/jpeg;base64,${screenshot}` }}
                style={{ width: "100%", height: 300 }}
                resizeMode="contain"
              />
              <TouchableOpacity
                onPress={() => setScreenshot(null)}
                className="mt-4 bg-error/10 rounded-full py-2"
              >
                <Text className="text-center text-error font-semibold">重新选择</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={handlePickImage}
              className="bg-surface rounded-2xl p-8 border-2 border-dashed border-border items-center"
            >
              <Text className="text-5xl mb-3">📷</Text>
              <Text className="text-base font-semibold text-foreground mb-2">点击上传截屏</Text>
              <Text className="text-sm text-muted text-center">
                支持 JPG、PNG 格式{"\n"}请确保截屏清晰完整
              </Text>
            </TouchableOpacity>
          )}

          {/* Submit Button */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!screenshot || isUploading}
            className={`rounded-full py-4 ${
              !screenshot || isUploading ? "bg-muted" : "bg-primary"
            }`}
          >
            {isUploading ? (
              <View className="flex-row items-center justify-center">
                <ActivityIndicator color="#fff" size="small" />
                <Text className="text-background font-semibold ml-2">AI 审核中...</Text>
              </View>
            ) : (
              <Text className="text-center text-background font-semibold">
                {screenshot ? "提交审核" : "请先上传截屏"}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* AI Verification Info */}
        <View className="mx-6 bg-surface rounded-2xl p-6 border border-border">
          <Text className="text-lg font-bold text-foreground mb-3">🤖 AI 自动审核</Text>
          <View className="gap-2">
            <View className="flex-row items-center">
              <Text className="text-success mr-2">✓</Text>
              <Text className="text-sm text-muted">自动识别订单号和金额</Text>
            </View>
            <View className="flex-row items-center">
              <Text className="text-success mr-2">✓</Text>
              <Text className="text-sm text-muted">验证支付时间和收款人</Text>
            </View>
            <View className="flex-row items-center">
              <Text className="text-success mr-2">✓</Text>
              <Text className="text-sm text-muted">通常 1 分钟内完成审核</Text>
            </View>
            <View className="flex-row items-center">
              <Text className="text-warning mr-2">⚠</Text>
              <Text className="text-sm text-muted">如 AI 无法确定，将转人工审核（1-2 小时）</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
