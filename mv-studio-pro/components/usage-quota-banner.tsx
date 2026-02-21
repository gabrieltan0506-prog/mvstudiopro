import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";

export interface UsageQuotaBannerProps {
  /**
   * Feature type for usage tracking
   */
  featureType: "avatar" | "analysis" | "storyboard";
  /**
   * Current usage count (how many times used)
   */
  currentCount: number;
  /**
   * Free tier limit (how many times free). -1 means unlimited (admin/subscriber).
   */
  freeLimit: number;
  /**
   * Loading state
   */
  loading?: boolean;
}

/**
 * Usage Quota Banner Component
 *
 * Displays remaining free usage quota at the top of paid feature pages.
 * When limit is -1 (admin or subscriber), shows "无限使用" badge instead.
 */
export function UsageQuotaBanner({
  featureType,
  currentCount,
  freeLimit,
  loading = false,
}: UsageQuotaBannerProps) {
  const router = useRouter();
  const colors = useColors();

  const featureNames = {
    avatar: "虚拟偶像生成",
    analysis: "视频 PK 评分",
    storyboard: "智能脚本与分镜生成",
  };

  if (loading) {
    return (
      <View className="mx-4 mt-4 p-4 bg-surface rounded-2xl border border-border flex-row items-center">
        <ActivityIndicator size="small" color={colors.primary} />
        <Text className="ml-3 text-muted text-sm">加载使用额度...</Text>
      </View>
    );
  }

  // ─── 管理员或订阅用户：无限使用 ──────────────────────
  if (freeLimit === -1) {
    return (
      <View
        className="mx-4 mt-4 p-4 rounded-2xl border flex-row items-center justify-between"
        style={{ backgroundColor: "rgba(34,197,94,0.08)", borderColor: "rgba(34,197,94,0.25)" }}
      >
        <View className="flex-row items-center flex-1">
          <MaterialIcons name="all-inclusive" size={24} color={colors.success} />
          <View className="ml-3 flex-1">
            <Text style={{ color: colors.success, fontWeight: "700", fontSize: 16 }}>
              无限使用
            </Text>
            <Text style={{ color: colors.success, opacity: 0.8, fontSize: 13, marginTop: 2 }}>
              {featureNames[featureType]} · 不限次数 · 不扣 Credits
            </Text>
          </View>
        </View>
        <View
          style={{
            backgroundColor: "rgba(34,197,94,0.15)",
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 16,
          }}
        >
          <Text style={{ color: colors.success, fontWeight: "700", fontSize: 12 }}>VIP</Text>
        </View>
      </View>
    );
  }

  // ─── 普通用户：显示免费额度 ──────────────────────────
  const remaining = Math.max(0, freeLimit - currentCount);
  const isExhausted = remaining === 0;

  return (
    <View
      className={`mx-4 mt-4 p-4 rounded-2xl border flex-row items-center justify-between ${
        isExhausted
          ? "bg-error/10 border-error/30"
          : "bg-primary/10 border-primary/30"
      }`}
    >
      <View className="flex-row items-center flex-1">
        <MaterialIcons
          name={isExhausted ? "error-outline" : "info-outline"}
          size={24}
          color={isExhausted ? colors.error : colors.primary}
        />
        <View className="ml-3 flex-1">
          {isExhausted ? (
            <>
              <Text className="text-error font-semibold text-base">
                免费额度已用完
              </Text>
              <Text className="text-error/80 text-sm mt-0.5">
                已使用 {currentCount}/{freeLimit} 次免费{featureNames[featureType]}
              </Text>
            </>
          ) : (
            <>
              <Text className="text-primary font-semibold text-base">
                剩余 {remaining} 次免费生成
              </Text>
              <Text className="text-primary/80 text-sm mt-0.5">
                已使用 {currentCount}/{freeLimit} 次免费{featureNames[featureType]}
              </Text>
            </>
          )}
        </View>
      </View>

      <TouchableOpacity
        onPress={() => router.push("/pricing" as any)}
        className={`px-4 py-2 rounded-full ${
          isExhausted ? "bg-error" : "bg-primary"
        }`}
        style={{ opacity: 0.9 }}
      >
        <Text className="text-white font-semibold text-sm">
          {isExhausted ? "立即购买" : "查看方案"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
