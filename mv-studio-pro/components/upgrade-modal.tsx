import { Modal, Text, View, TouchableOpacity, StyleSheet, Linking, Platform } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { CREDIT_COSTS } from "@/shared/credits";

interface UpgradeModalProps {
  visible: boolean;
  onClose: () => void;
  action?: keyof typeof CREDIT_COSTS;
  currentBalance?: number;
}

export function UpgradeModal({ visible, onClose, action, currentBalance = 0 }: UpgradeModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const checkoutMutation = trpc.stripe.createCheckoutSession.useMutation();

  const cost = action ? CREDIT_COSTS[action] : 0;
  const deficit = cost - currentBalance;

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const result = await checkoutMutation.mutateAsync({ plan: "pro", interval: "monthly" });
      if (result.url) {
        if (Platform.OS === "web") {
          window.open(result.url, "_blank");
        } else {
          await Linking.openURL(result.url);
        }
      }
      onClose();
    } catch (err: any) {
      alert(err.message || "无法创建付款页面");
    } finally {
      setLoading(false);
    }
  };

  const handleBuyCredits = () => {
    onClose();
    router.push("/pricing" as any);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Close Button */}
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <MaterialIcons name="close" size={24} color="#9BA1A6" />
          </TouchableOpacity>

          {/* Icon */}
          <View style={styles.iconCircle}>
            <MaterialIcons name="toll" size={40} color="#FF6B35" />
          </View>

          {/* Title */}
          <Text style={styles.title}>Credits 不足</Text>
          <Text style={styles.subtitle}>
            {action ? `此操作需要 ${cost} Credits，您目前有 ${currentBalance} Credits` : "您需要更多 Credits 才能使用此功能"}
          </Text>

          {/* Options */}
          <View style={styles.options}>
            {/* Upgrade to Pro */}
            <TouchableOpacity onPress={handleUpgrade} style={styles.upgradeBtn} disabled={loading}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <MaterialIcons name="star" size={20} color="#fff" />
                <Text style={styles.upgradeBtnText}>升级专业版</Text>
              </View>
              <Text style={styles.upgradePrice}>$29/月 · 500 Credits</Text>
            </TouchableOpacity>

            {/* Buy Credits */}
            <TouchableOpacity onPress={handleBuyCredits} style={styles.buyBtn}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <MaterialIcons name="add-circle-outline" size={20} color="#FF6B35" />
                <Text style={styles.buyBtnText}>购买 Credits 加值包</Text>
              </View>
              <Text style={styles.buyPrice}>100 Credits $9.99 起</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  modal: {
    backgroundColor: "#1A1A1D", borderRadius: 20, padding: 28,
    width: "100%", maxWidth: 400, alignItems: "center",
    borderWidth: 1, borderColor: "#2A2A2D",
  },
  closeBtn: { position: "absolute", top: 16, right: 16 },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "#FF6B3522", justifyContent: "center", alignItems: "center", marginBottom: 16,
  },
  title: { fontSize: 22, fontWeight: "800", color: "#ECEDEE", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#9BA1A6", textAlign: "center", lineHeight: 20, marginBottom: 24 },
  options: { width: "100%", gap: 12 },
  upgradeBtn: {
    backgroundColor: "#FF6B35", borderRadius: 12, padding: 16, alignItems: "center",
  },
  upgradeBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  upgradePrice: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 4 },
  buyBtn: {
    borderWidth: 1, borderColor: "#FF6B3555", borderRadius: 12, padding: 16, alignItems: "center",
  },
  buyBtnText: { color: "#FF6B35", fontSize: 15, fontWeight: "600" },
  buyPrice: { color: "#9BA1A6", fontSize: 12, marginTop: 4 },
});
