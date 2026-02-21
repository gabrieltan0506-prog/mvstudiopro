import { Text, View, TouchableOpacity, StyleSheet, Platform, Dimensions } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

const isWeb = Platform.OS === "web";
const isWide = isWeb && Dimensions.get("window").width > 768;

export default function MVCompareScreen() {
  const router = useRouter();

  return (
    <ScreenContainer edges={isWeb ? [] : ["top", "left", "right"]} containerClassName="bg-background">
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <MaterialIcons name="compare" size={48} color="#E8825E" />
        </View>
        <Text style={styles.title}>MV 版本对比</Text>
        <Text style={styles.subtitle}>即将推出</Text>
        <Text style={styles.description}>
          逐帧对比不同版本视频，{"\n"}精准定位画面差异与优化空间。
        </Text>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Text style={styles.backText}>← 返回首页</Text>
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "rgba(232, 130, 94, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: isWide ? 36 : 28,
    fontWeight: "700",
    color: "#F7F4EF",
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#E8825E",
    marginBottom: 16,
  },
  description: {
    fontSize: 15,
    color: "#9B9691",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 32,
  },
  backBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(247, 244, 239, 0.25)",
  },
  backText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#F7F4EF",
  },
});
