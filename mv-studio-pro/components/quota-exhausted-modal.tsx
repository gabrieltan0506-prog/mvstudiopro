import { View, Text, TouchableOpacity, Modal, Platform } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";

export interface QuotaExhaustedModalProps {
  /**
   * Whether the modal is visible
   */
  visible: boolean;
  /**
   * The feature that was exhausted
   */
  featureName: string;
  /**
   * Whether the user is on a trial plan
   */
  isTrial?: boolean;
  /**
   * Whether the trial has expired (vs just quota used up)
   */
  trialExpired?: boolean;
  /**
   * Current plan name for display
   */
  planName?: string;
  /**
   * Callback to close the modal
   */
  onClose: () => void;
}

/**
 * Quota Exhausted Modal
 *
 * Shows a friendly message when a user's quota is used up.
 * Different messages for:
 * 1. Trial expired → "试用已到期，立即订阅"
 * 2. Trial quota used → "试用额度已用完，升级解锁更多"
 * 3. Paid plan quota used → "本月已用完，下月自动重置"
 * 4. Free tier used → "免费额度已用完，购买套餐或申请学生优惠"
 */
export function QuotaExhaustedModal({
  visible,
  featureName,
  isTrial = false,
  trialExpired = false,
  planName,
  onClose,
}: QuotaExhaustedModalProps) {
  const router = useRouter();
  const colors = useColors();

  // Determine which scenario we're in
  const isTrialExpired = isTrial && trialExpired;
  const isTrialQuotaUsed = isTrial && !trialExpired;
  const isPaidPlan = !isTrial && (planName?.includes("student_6months") || planName?.includes("student_1year"));

  const getTitle = () => {
    if (isTrialExpired) return "试用已到期";
    if (isTrialQuotaUsed) return "试用额度已用完";
    if (isPaidPlan) return "本月额度已用完";
    return "免费额度已用完";
  };

  const getMessage = () => {
    if (isTrialExpired) {
      return `您的 2 天免费试用已结束。\n\n您已生成的作品仍可查看，但无法新建作品。\n\n订阅学生方案即可继续使用「${featureName}」等所有功能，半年仅需 $20。`;
    }
    if (isTrialQuotaUsed) {
      return `您在试用期内的「${featureName}」次数已用完。\n\n升级到付费方案可获得更多额度，解锁全部功能。`;
    }
    if (isPaidPlan) {
      return `您本月的「${featureName}」额度已用完。\n\n额度将在下月 1 日自动重置，请耐心等待。\n\n如需更多额度，可升级到更高方案。`;
    }
    return `您的「${featureName}」免费体验次数已用完。\n\n购买套餐或申请学生优惠即可继续使用。`;
  };

  const getIcon = (): any => {
    if (isTrialExpired) return "timer-off";
    if (isTrialQuotaUsed) return "hourglass-empty";
    if (isPaidPlan) return "event-repeat";
    return "lock-outline";
  };

  const getIconColor = () => {
    if (isTrialExpired) return colors.error;
    if (isTrialQuotaUsed) return colors.warning;
    if (isPaidPlan) return colors.primary;
    return colors.muted;
  };

  const getPrimaryAction = () => {
    if (isTrialExpired || isTrialQuotaUsed) {
      return {
        label: "立即订阅",
        icon: "upgrade" as any,
        onPress: () => {
          onClose();
          router.push("/student-verification" as any);
        },
      };
    }
    if (isPaidPlan) {
      if (planName?.includes("6months")) {
        return {
          label: "升级一年版",
          icon: "upgrade" as any,
          onPress: () => {
            onClose();
            router.push("/student-verification" as any);
          },
        };
      }
      return null; // 1-year plan, just wait for reset
    }
    return {
      label: "查看方案",
      icon: "shopping-cart" as any,
      onPress: () => {
        onClose();
        router.push("/pricing" as any);
      },
    };
  };

  const primaryAction = getPrimaryAction();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <View
          className="w-full max-w-sm rounded-3xl p-6"
          style={{ backgroundColor: colors.background }}
        >
          {/* Icon */}
          <View className="items-center mb-4">
            <View
              className="w-16 h-16 rounded-full items-center justify-center"
              style={{ backgroundColor: getIconColor() + "15" }}
            >
              <MaterialIcons name={getIcon()} size={32} color={getIconColor()} />
            </View>
          </View>

          {/* Title */}
          <Text
            className="text-xl font-bold text-center mb-3"
            style={{ color: colors.foreground }}
          >
            {getTitle()}
          </Text>

          {/* Message */}
          <Text
            className="text-sm text-center leading-relaxed mb-6"
            style={{ color: colors.muted }}
          >
            {getMessage()}
          </Text>

          {/* Reset date hint for paid plans */}
          {isPaidPlan && (
            <View
              className="rounded-xl p-3 mb-4 flex-row items-center"
              style={{ backgroundColor: colors.primary + "10" }}
            >
              <MaterialIcons name="event" size={18} color={colors.primary} />
              <Text className="text-xs ml-2 flex-1" style={{ color: colors.foreground }}>
                下次重置：每月 1 日 00:00（UTC+8）
              </Text>
            </View>
          )}

          {/* Actions */}
          <View className="gap-3">
            {primaryAction && (
              <TouchableOpacity
                onPress={primaryAction.onPress}
                className="rounded-xl py-3.5 flex-row items-center justify-center"
                style={{ backgroundColor: colors.primary }}
              >
                <MaterialIcons name={primaryAction.icon} size={18} color="#fff" />
                <Text className="text-white font-semibold ml-2">{primaryAction.label}</Text>
              </TouchableOpacity>
            )}

            {/* Secondary: student discount hint for free users */}
            {!isTrial && !isPaidPlan && (
              <TouchableOpacity
                onPress={() => {
                  onClose();
                  router.push("/student-verification" as any);
                }}
                className="rounded-xl py-3 flex-row items-center justify-center"
                style={{ backgroundColor: colors.success + "15" }}
              >
                <MaterialIcons name="school" size={18} color={colors.success} />
                <Text className="font-semibold ml-2" style={{ color: colors.success }}>
                  学生？申请教育优惠
                </Text>
              </TouchableOpacity>
            )}

            {/* Close / OK */}
            <TouchableOpacity
              onPress={onClose}
              className="rounded-xl py-3 items-center"
              style={{ backgroundColor: colors.surface }}
            >
              <Text className="font-medium" style={{ color: colors.muted }}>
                {isPaidPlan && planName?.includes("1year") ? "我知道了" : "稍后再说"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
