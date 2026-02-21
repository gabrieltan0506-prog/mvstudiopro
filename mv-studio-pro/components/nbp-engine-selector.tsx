/**
 * NBP 引擎选择器组件
 * 
 * 用于分镜页面和虚拟偶像页面，让用户选择图片生成引擎：
 * - Forge AI（免费，含水印）
 * - NBP 2K（5 Credits/张，Pro+ 可用）
 * - NBP 4K（9 Credits/张，Enterprise 可用）
 */
import { Text, View, TouchableOpacity, StyleSheet } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

export type EngineOption = "forge" | "nbp_2k" | "nbp_4k";

interface EngineInfo {
  id: EngineOption;
  label: string;
  desc: string;
  cost: string;
  icon: string;
  color: string;
  available: boolean;
  reason?: string;
}

interface NbpEngineSelectorProps {
  selected: EngineOption;
  onSelect: (engine: EngineOption) => void;
  plan: string; // "free" | "pro" | "enterprise"
  creditsAvailable: number;
  compact?: boolean;
  isAdmin?: boolean;
}

export function NbpEngineSelector({
  selected,
  onSelect,
  plan,
  creditsAvailable,
  compact = false,
  isAdmin = false,
}: NbpEngineSelectorProps) {
  // 管理员拥有所有引擎的完整权限
  const effectivePlan = isAdmin ? "enterprise" : plan;
  const effectiveCredits = isAdmin ? 99999 : creditsAvailable;
  const engines: EngineInfo[] = [
    {
      id: "forge",
      label: "Forge AI",
      desc: "免费生成，含水印",
      cost: "免费",
      icon: "auto-awesome",
      color: "#30D158",
      available: true,
    },
    {
      id: "nbp_2k",
      label: "NBP 2K",
      desc: "高清 2K，" + (isAdmin ? "管理员免费" : effectivePlan === "free" ? "需升级" : effectivePlan === "pro" ? "含水印" : "无水印"),
      cost: isAdmin ? "免费" : "5 Cr/张",
      icon: "hd",
      color: "#64D2FF",
      available: isAdmin || (effectivePlan !== "free" && effectiveCredits >= 5),
      reason:
        effectivePlan === "free"
          ? "升级到 Pro 方案即可使用"
          : effectiveCredits < 5
          ? "Credits 不足，请充值"
          : undefined,
    },
    {
      id: "nbp_4k",
      label: "NBP 4K",
      desc: "超高清 4K，" + (isAdmin ? "管理员免费" : effectivePlan === "enterprise" ? "无水印" : "需升级"),
      cost: isAdmin ? "免费" : "9 Cr/张",
      icon: "4k",
      color: "#FFD60A",
      available: isAdmin || (effectivePlan === "enterprise" && effectiveCredits >= 9),
      reason:
        effectivePlan !== "enterprise"
          ? "升级到 Enterprise 方案即可使用"
          : effectiveCredits < 9
          ? "Credits 不足，请充值"
          : undefined,
    },
  ];

  if (compact) {
    return (
      <View style={styles.compactContainer}>
        <Text style={styles.compactLabel}>图片引擎</Text>
        <View style={styles.compactRow}>
          {engines.map((eng) => {
            const isSelected = selected === eng.id;
            const disabled = !eng.available;
            return (
              <TouchableOpacity
                key={eng.id}
                onPress={() => !disabled && onSelect(eng.id)}
                activeOpacity={disabled ? 1 : 0.7}
                style={[
                  styles.compactChip,
                  isSelected && { backgroundColor: eng.color + "30", borderColor: eng.color },
                  disabled && styles.compactChipDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.compactChipText,
                    isSelected && { color: eng.color, fontWeight: "700" },
                    disabled && { color: "#555" },
                  ]}
                >
                  {eng.label}
                </Text>
                {isSelected && (
                  <Text style={[styles.compactCost, { color: eng.color }]}>{eng.cost}</Text>
                )}
                {disabled && (
                  <MaterialIcons name="lock" size={10} color="#555" style={{ marginLeft: 2 }} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        {/* Credits 余额 */}
        <View style={styles.creditsRow}>
          <MaterialIcons name="stars" size={14} color="#FFD60A" />
          <Text style={styles.creditsText}>可用 Credits: {creditsAvailable}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>选择图片生成引擎</Text>
        <View style={styles.creditsBadge}>
          <MaterialIcons name="stars" size={14} color="#FFD60A" />
          <Text style={styles.creditsValue}>{creditsAvailable}</Text>
        </View>
      </View>

      {engines.map((eng) => {
        const isSelected = selected === eng.id;
        const disabled = !eng.available;

        return (
          <TouchableOpacity
            key={eng.id}
            onPress={() => !disabled && onSelect(eng.id)}
            activeOpacity={disabled ? 1 : 0.7}
            style={[
              styles.engineCard,
              isSelected && { borderColor: eng.color, backgroundColor: eng.color + "10" },
              disabled && styles.engineCardDisabled,
            ]}
          >
            <View style={styles.engineLeft}>
              <View style={[styles.engineIcon, { backgroundColor: eng.color + "20" }]}>
                <MaterialIcons name={eng.icon as any} size={20} color={disabled ? "#555" : eng.color} />
              </View>
              <View style={styles.engineInfo}>
                <View style={styles.engineNameRow}>
                  <Text style={[styles.engineName, disabled && { color: "#555" }]}>
                    {eng.label}
                  </Text>
                  {disabled && (
                    <MaterialIcons name="lock" size={14} color="#555" style={{ marginLeft: 4 }} />
                  )}
                </View>
                <Text style={[styles.engineDesc, disabled && { color: "#444" }]}>
                  {disabled && eng.reason ? eng.reason : eng.desc}
                </Text>
              </View>
            </View>

            <View style={styles.engineRight}>
              <Text style={[styles.engineCost, { color: disabled ? "#555" : eng.color }]}>
                {eng.cost}
              </Text>
              {isSelected && (
                <MaterialIcons name="check-circle" size={20} color={eng.color} />
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ECEDEE",
  },
  creditsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,214,10,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  creditsValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFD60A",
  },
  engineCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1C1C1E",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1.5,
    borderColor: "#2C2C2E",
  },
  engineCardDisabled: {
    opacity: 0.5,
  },
  engineLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  engineIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  engineInfo: {
    flex: 1,
  },
  engineNameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  engineName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ECEDEE",
  },
  engineDesc: {
    fontSize: 12,
    color: "#9BA1A6",
    marginTop: 2,
  },
  engineRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  engineCost: {
    fontSize: 13,
    fontWeight: "700",
  },
  // ─── Compact ───
  compactContainer: {
    gap: 6,
  },
  compactLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#9BA1A6",
  },
  compactRow: {
    flexDirection: "row",
    gap: 8,
  },
  compactChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2C2C2E",
    backgroundColor: "#1C1C1E",
  },
  compactChipDisabled: {
    opacity: 0.4,
  },
  compactChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#9BA1A6",
  },
  compactCost: {
    fontSize: 11,
    fontWeight: "600",
  },
  creditsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  creditsText: {
    fontSize: 12,
    color: "#9BA1A6",
  },
});
