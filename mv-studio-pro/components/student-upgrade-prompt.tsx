import { View, Text, TouchableOpacity } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";

export interface StudentUpgradePromptProps {
  /**
   * Current student plan: "student_trial" | "student_6months" | "student_1year"
   */
  studentPlan: string;
  /**
   * Feature usage data: { featureType: { currentCount, limit, remaining } }
   */
  usageData: Record<string, { currentCount: number; limit: number; remaining: number }>;
  /**
   * Whether the user is on a trial plan
   */
  isTrial?: boolean;
  /**
   * Trial end date ISO string (for countdown display)
   */
  trialEndDate?: string;
  /**
   * Whether to show the prompt (controlled externally)
   */
  visible?: boolean;
  /**
   * Callback when user dismisses the prompt
   */
  onDismiss?: () => void;
}

/**
 * Student Upgrade Prompt Component
 *
 * Shows an upgrade card in two scenarios:
 * 1. Trial users: always show with trial countdown and upgrade CTA
 * 2. Half-year users: when approaching usage limits (>=70%)
 */
export function StudentUpgradePrompt({
  studentPlan,
  usageData,
  isTrial = false,
  trialEndDate,
  visible = true,
  onDismiss,
}: StudentUpgradePromptProps) {
  const router = useRouter();
  const colors = useColors();

  if (!visible) return null;

  // ─── Trial User Prompt ──────────────────────────────────
  if (isTrial || studentPlan === "student_trial") {
    const endDate = trialEndDate ? new Date(trialEndDate) : null;
    const now = new Date();
    const hoursLeft = endDate ? Math.max(0, Math.round((endDate.getTime() - now.getTime()) / (1000 * 60 * 60))) : 0;
    const isExpiringSoon = hoursLeft <= 12;

    // Find used features for display
    const usedFeatures = Object.entries(usageData)
      .filter(([, data]) => data.limit > 0 && data.currentCount > 0)
      .map(([key, data]) => {
        const nameMap: Record<string, string> = {
          analysis: "视频 PK 评分",
          storyboard: "智能脚本与分镜",
          avatar: "虚拟偶像生成",
          idol3D: "偶像转 3D",
          videoGeneration: "视频生成",
        };
        return {
          name: nameMap[key] || key,
          used: data.currentCount,
          total: data.limit,
        };
      });

    return (
      <View
        className="mx-4 mt-4 rounded-2xl p-5 border"
        style={{
          backgroundColor: isExpiringSoon ? colors.error + "10" : colors.primary + "10",
          borderColor: isExpiringSoon ? colors.error + "30" : colors.primary + "30",
        }}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center flex-1">
            <View
              className="w-8 h-8 rounded-full items-center justify-center mr-2"
              style={{ backgroundColor: isExpiringSoon ? colors.error + "20" : colors.primary + "20" }}
            >
              <MaterialIcons
                name={isExpiringSoon ? "timer" : "science"}
                size={18}
                color={isExpiringSoon ? colors.error : colors.primary}
              />
            </View>
            <View className="flex-1">
              <Text className="text-foreground font-bold text-base">
                {isExpiringSoon ? "试用即将到期" : "免费试用中"}
              </Text>
              <Text className="text-muted text-xs">
                {hoursLeft > 0
                  ? `剩余 ${hoursLeft} 小时`
                  : "试用已到期"}
              </Text>
            </View>
          </View>
          {onDismiss && (
            <TouchableOpacity onPress={onDismiss}>
              <MaterialIcons name="close" size={18} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Usage summary */}
        {usedFeatures.length > 0 && (
          <View className="mb-3">
            <Text className="text-muted text-xs mb-1.5">已使用：</Text>
            {usedFeatures.map((f, idx) => (
              <Text key={idx} className="text-foreground text-xs mb-0.5">
                {f.name}：{f.used}/{f.total} 次
              </Text>
            ))}
          </View>
        )}

        {/* Upgrade comparison */}
        <View
          className="p-3 rounded-xl"
          style={{ backgroundColor: colors.success + "10" }}
        >
          <Text className="text-foreground font-semibold text-sm mb-2">
            升级订阅，解锁完整体验：
          </Text>
          <View className="gap-1.5">
            <View className="flex-row items-center">
              <MaterialIcons name="check-circle" size={14} color={colors.success} />
              <Text className="text-muted text-xs ml-1.5">
                半年版 $20：PK 评分 <Text className="text-foreground font-semibold">5 次/月</Text>、脚本 <Text className="text-foreground font-semibold">3 次/月</Text>
              </Text>
            </View>
            <View className="flex-row items-center">
              <MaterialIcons name="check-circle" size={14} color={colors.success} />
              <Text className="text-muted text-xs ml-1.5">
                一年版 $38：PK 评分 <Text className="text-foreground font-semibold">15 次/月</Text> + 视频生成 <Text className="text-foreground font-semibold">2 次/月</Text>
              </Text>
            </View>
            <View className="flex-row items-center">
              <MaterialIcons name="check-circle" size={14} color={colors.success} />
              <Text className="text-muted text-xs ml-1.5">
                一年版独享：3D 转换、口型同步、1080P 视频
              </Text>
            </View>
          </View>
        </View>

        {/* CTA Button */}
        <TouchableOpacity
          onPress={() => router.push("/student-verification" as any)}
          className="mt-3 rounded-xl py-3 flex-row items-center justify-center"
          style={{ backgroundColor: colors.primary }}
        >
          <MaterialIcons name="upgrade" size={18} color="#fff" />
          <Text className="text-white font-semibold ml-2">
            {hoursLeft > 0 ? "立即升级订阅" : "试用已到期，立即订阅"}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Half-Year User Prompt (approaching limits) ─────────
  if (studentPlan !== "student_6months") return null;

  // Check if any feature is approaching limit (>=70% used)
  const approachingLimit = Object.entries(usageData).some(([, data]) => {
    if (data.limit <= 0) return false;
    return data.currentCount / data.limit >= 0.7;
  });

  if (!approachingLimit) return null;

  const nearLimitFeatures = Object.entries(usageData)
    .filter(([, data]) => data.limit > 0 && data.currentCount / data.limit >= 0.7)
    .map(([key, data]) => {
      const nameMap: Record<string, string> = {
        analysis: "视频 PK 评分",
        storyboard: "智能脚本与分镜",
        avatar: "虚拟偶像生成",
        idol3D: "偶像转 3D",
        videoGeneration: "视频生成",
      };
      return {
        name: nameMap[key] || key,
        used: data.currentCount,
        total: data.limit,
        percent: Math.round((data.currentCount / data.limit) * 100),
      };
    });

  return (
    <View
      className="mx-4 mt-4 rounded-2xl p-5 border"
      style={{
        backgroundColor: colors.warning + "10",
        borderColor: colors.warning + "30",
      }}
    >
      {/* Header */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center">
          <View
            className="w-8 h-8 rounded-full items-center justify-center mr-2"
            style={{ backgroundColor: colors.warning + "20" }}
          >
            <MaterialIcons name="trending-up" size={18} color={colors.warning} />
          </View>
          <Text className="text-foreground font-bold text-base">额度即将用完</Text>
        </View>
        {onDismiss && (
          <TouchableOpacity onPress={onDismiss}>
            <MaterialIcons name="close" size={18} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Usage bars */}
      {nearLimitFeatures.map((feature, idx) => (
        <View key={idx} className="mb-2">
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-foreground text-sm">{feature.name}</Text>
            <Text className="text-muted text-xs">
              {feature.used}/{feature.total} 次（{feature.percent}%）
            </Text>
          </View>
          <View
            className="h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: colors.border }}
          >
            <View
              className="h-full rounded-full"
              style={{
                width: `${Math.min(feature.percent, 100)}%`,
                backgroundColor:
                  feature.percent >= 90 ? colors.error : colors.warning,
              }}
            />
          </View>
        </View>
      ))}

      {/* Upgrade comparison */}
      <View
        className="mt-3 p-3 rounded-xl"
        style={{ backgroundColor: colors.primary + "10" }}
      >
        <Text className="text-foreground font-semibold text-sm mb-2">
          升级一年版 $38，享受更多额度：
        </Text>
        <View className="gap-1.5">
          <View className="flex-row items-center">
            <MaterialIcons name="check-circle" size={14} color={colors.success} />
            <Text className="text-muted text-xs ml-1.5">
              视频 PK 评分：5 次/月 → <Text className="text-foreground font-semibold">15 次/月</Text>
            </Text>
          </View>
          <View className="flex-row items-center">
            <MaterialIcons name="check-circle" size={14} color={colors.success} />
            <Text className="text-muted text-xs ml-1.5">
              分镜脚本：3 次/月 → <Text className="text-foreground font-semibold">8 次/月</Text>
            </Text>
          </View>
          <View className="flex-row items-center">
            <MaterialIcons name="check-circle" size={14} color={colors.success} />
            <Text className="text-muted text-xs ml-1.5">
              添加偶像转 3D（<Text className="text-foreground font-semibold">3 次/月</Text>）
            </Text>
          </View>
          <View className="flex-row items-center">
            <MaterialIcons name="check-circle" size={14} color={colors.success} />
            <Text className="text-muted text-xs ml-1.5">
              添加口型同步（<Text className="text-foreground font-semibold">5 次/月</Text>）
            </Text>
          </View>
          <View className="flex-row items-center">
            <MaterialIcons name="check-circle" size={14} color={colors.success} />
            <Text className="text-muted text-xs ml-1.5">
              添加视频生成（<Text className="text-foreground font-semibold">2 次/月</Text>）
            </Text>
          </View>
        </View>
      </View>

      {/* CTA Button */}
      <TouchableOpacity
        onPress={() => router.push("/student-verification" as any)}
        className="mt-3 rounded-xl py-3 flex-row items-center justify-center"
        style={{ backgroundColor: colors.primary }}
      >
        <MaterialIcons name="upgrade" size={18} color="#fff" />
        <Text className="text-white font-semibold ml-2">立即升级一年版</Text>
      </TouchableOpacity>
    </View>
  );
}
