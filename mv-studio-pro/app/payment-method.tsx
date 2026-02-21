import { ScrollView, Text, View, TouchableOpacity, Image, Alert } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export default function PaymentMethodScreen() {
  const router = useRouter();
  const { package: packageId } = useLocalSearchParams<{ package: string }>();
  const [selectedMethod, setSelectedMethod] = useState<"stripe" | "wechat" | "alipay" | null>(null);

  // Fetch payment packages
  const { data: packages } = trpc.payment.getPaymentPackages.useQuery();
  const createQRCodePayment = trpc.payment.createQRCodePayment.useMutation();

  const currentPackage = packages?.find((pkg) => pkg.id === packageId);

  const handleSelectMethod = async (method: "stripe" | "wechat" | "alipay") => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedMethod(method);

    if (method === "stripe") {
      // Navigate to Stripe payment page
      router.push(`/payment-stripe?package=${packageId}` as any);
    } else {
      // Create QR code payment order
      try {
        const result = await createQRCodePayment.mutateAsync({
          packageType: packageId as any,
          paymentMethod: method,
        });

        // Navigate to QR code payment page
        router.push({
          pathname: "/payment-qrcode" as any,
          params: {
            orderId: result.orderId,
            transactionId: result.transactionId.toString(),
            qrCodeUrl: result.qrCodeUrl,
            amount: result.packageInfo.price.toString(),
            currency: result.packageInfo.currency,
            paymentMethod: result.paymentMethod,
            recipientName: result.recipientName,
            packageName: result.packageInfo.name,
          },
        });
      } catch (error: any) {
        Alert.alert("错误", error.message || "创建订单失败");
      }
    }
  };

  if (!currentPackage) {
    return (
      <ScreenContainer className="bg-background">
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted">套餐不存在</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View className="px-6 pt-8 pb-6">
          <TouchableOpacity onPress={() => router.back()} className="mb-4">
            <Text className="text-primary text-base">← 返回</Text>
          </TouchableOpacity>
          <Text className="text-3xl font-bold text-foreground mb-2">选择支付方式</Text>
          <Text className="text-base text-muted">选择最方便的支付方式完成购买</Text>
        </View>

        {/* Package Summary */}
        <View className="mx-6 mb-6 bg-surface rounded-2xl p-6 border border-border">
          <Text className="text-lg font-bold text-foreground mb-2">{currentPackage.name}</Text>
          <Text className="text-sm text-muted mb-4">{currentPackage.description}</Text>
          <View className="flex-row items-baseline">
            <Text className="text-3xl font-bold text-primary">${currentPackage.price}</Text>
            <Text className="text-base text-muted ml-2">{currentPackage.currency}</Text>
          </View>
        </View>

        {/* Payment Methods */}
        <View className="px-6 gap-4">
          {/* Stripe */}
          <TouchableOpacity
            onPress={() => handleSelectMethod("stripe")}
            className={`bg-surface rounded-2xl p-6 border-2 ${
              selectedMethod === "stripe" ? "border-primary" : "border-border"
            }`}
            disabled={createQRCodePayment.isPending}
          >
            <View className="flex-row items-center mb-3">
              <View className="w-12 h-12 bg-primary/10 rounded-full items-center justify-center mr-4">
                <Text className="text-2xl">💳</Text>
              </View>
              <View className="flex-1">
                <Text className="text-lg font-bold text-foreground">信用卡 / Stripe</Text>
                <Text className="text-sm text-muted">国际信用卡、Apple Pay、Google Pay</Text>
              </View>
            </View>
            <View className="gap-2">
              <View className="flex-row items-center">
                <Text className="text-success mr-2">✓</Text>
                <Text className="text-sm text-muted">自动确认支付</Text>
              </View>
              <View className="flex-row items-center">
                <Text className="text-success mr-2">✓</Text>
                <Text className="text-sm text-muted">立即开通功能</Text>
              </View>
              <View className="flex-row items-center">
                <Text className="text-success mr-2">✓</Text>
                <Text className="text-sm text-muted">安全加密</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* WeChat Pay */}
          <TouchableOpacity
            onPress={() => handleSelectMethod("wechat")}
            className={`bg-surface rounded-2xl p-6 border-2 ${
              selectedMethod === "wechat" ? "border-primary" : "border-border"
            }`}
            disabled={createQRCodePayment.isPending}
          >
            <View className="flex-row items-center mb-3">
              <View className="w-12 h-12 bg-[#07C160]/10 rounded-full items-center justify-center mr-4">
                <Text className="text-2xl">💚</Text>
              </View>
              <View className="flex-1">
                <Text className="text-lg font-bold text-foreground">微信支付</Text>
                <Text className="text-sm text-muted">扫码支付，方便快捷</Text>
              </View>
            </View>
            <View className="gap-2">
              <View className="flex-row items-center">
                <Text className="text-warning mr-2">⚠</Text>
                <Text className="text-sm text-muted">需上传支付截屏</Text>
              </View>
              <View className="flex-row items-center">
                <Text className="text-success mr-2">✓</Text>
                <Text className="text-sm text-muted">AI 自动审核（通常 1 分钟内）</Text>
              </View>
              <View className="flex-row items-center">
                <Text className="text-success mr-2">✓</Text>
                <Text className="text-sm text-muted">无手续费</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Alipay */}
          <TouchableOpacity
            onPress={() => handleSelectMethod("alipay")}
            className={`bg-surface rounded-2xl p-6 border-2 ${
              selectedMethod === "alipay" ? "border-primary" : "border-border"
            }`}
            disabled={createQRCodePayment.isPending}
          >
            <View className="flex-row items-center mb-3">
              <View className="w-12 h-12 bg-[#1677FF]/10 rounded-full items-center justify-center mr-4">
                <Text className="text-2xl">💙</Text>
              </View>
              <View className="flex-1">
                <Text className="text-lg font-bold text-foreground">支付宝</Text>
                <Text className="text-sm text-muted">扫码支付，安全可靠</Text>
              </View>
            </View>
            <View className="gap-2">
              <View className="flex-row items-center">
                <Text className="text-warning mr-2">⚠</Text>
                <Text className="text-sm text-muted">需上传支付截屏</Text>
              </View>
              <View className="flex-row items-center">
                <Text className="text-success mr-2">✓</Text>
                <Text className="text-sm text-muted">AI 自动审核（通常 1 分钟内）</Text>
              </View>
              <View className="flex-row items-center">
                <Text className="text-success mr-2">✓</Text>
                <Text className="text-sm text-muted">无手续费</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {/* Loading Indicator */}
        {createQRCodePayment.isPending && (
          <View className="mx-6 mt-6 bg-primary/10 rounded-2xl p-4">
            <Text className="text-center text-primary">正在创建订单...</Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
