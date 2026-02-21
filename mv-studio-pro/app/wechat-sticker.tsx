import { useState, useCallback } from "react";
import { Text, View, ScrollView, TouchableOpacity, TextInput, StyleSheet, Platform, ActivityIndicator, Dimensions } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { trpc } from "@/lib/trpc";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWeb = Platform.OS === "web";

// ─── 情緒分類 ───────────────────────────────────
const EMOTIONS = [
  { id: "happy", label: "开心", emoji: "😄", color: "#FFD60A" },
  { id: "love", label: "爱心", emoji: "❤️", color: "#FF2D55" },
  { id: "sad", label: "难过", emoji: "😢", color: "#64D2FF" },
  { id: "angry", label: "生气", emoji: "😡", color: "#FF453A" },
  { id: "surprised", label: "惊讶", emoji: "😲", color: "#FF9F0A" },
  { id: "shy", label: "害羞", emoji: "😊", color: "#FF6B8A" },
  { id: "cool", label: "酷", emoji: "😎", color: "#30D158" },
  { id: "sleepy", label: "困", emoji: "😴", color: "#8E8E93" },
  { id: "thinking", label: "思考", emoji: "🤔", color: "#A855F7" },
  { id: "excited", label: "兴奋", emoji: "🤩", color: "#FF6B6B" },
  { id: "awkward", label: "尴尬", emoji: "😅", color: "#BF5AF2" },
  { id: "grateful", label: "感谢", emoji: "🙏", color: "#30D158" },
];

// ─── 常用詞語 ───────────────────────────────────
const PHRASES = [
  "好的", "收到", "谢谢", "再见", "加油", "没问题",
  "哈哈哈", "666", "太棒了", "不要", "救命", "无语",
  "好吧", "了解", "辛苦了", "早安", "晚安", "生日快乐",
  "恭喜", "我错了", "在吗", "等等", "冲鸭", "摸鱼",
];

// ─── 表情風格 ───────────────────────────────────
const STYLES = [
  { id: "cute-cartoon", label: "可爱卡通", icon: "child-care", color: "#FFD60A" },
  { id: "pixel-art", label: "像素风", icon: "grid-on", color: "#30D158" },
  { id: "watercolor", label: "水彩手绘", icon: "brush", color: "#64D2FF" },
  { id: "chibi-anime", label: "Q版动漫", icon: "face", color: "#FF6B8A" },
  { id: "3d-clay", label: "3D 粘土", icon: "view-in-ar", color: "#A855F7" },
  { id: "flat-minimal", label: "扁平极简", icon: "crop-square", color: "#FF9F0A" },
  { id: "meme", label: "沙雕搞笑", icon: "sentiment-very-satisfied", color: "#FF453A" },
  { id: "elegant", label: "优雅复古", icon: "auto-awesome", color: "#BF5AF2" },
];

export default function WechatStickerScreen() {
  const router = useRouter();
  const [selectedEmotion, setSelectedEmotion] = useState<string>("");
  const [selectedPhrase, setSelectedPhrase] = useState<string>("");
  const [customText, setCustomText] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("cute-cartoon");
  const [characterDesc, setCharacterDesc] = useState("");
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<Array<{ imageUrl: string; emotion: string; phrase: string }>>([]);

  const generateMutation = trpc.wechatSticker.generate.useMutation();

  const handleGenerate = useCallback(async () => {
    if (!selectedEmotion) return;
    setGenerating(true);
    try {
      const result = await generateMutation.mutateAsync({
        emotion: selectedEmotion,
        phrase: selectedPhrase || undefined,
        customText: customText || undefined,
        style: selectedStyle,
        characterDesc: characterDesc || undefined,
      });
      if (result.success && result.imageUrl) {
        setResults(prev => [{ imageUrl: result.imageUrl, emotion: result.emotion, phrase: result.phrase }, ...prev]);
      }
    } catch (e: any) {
      // error handled by UI
    } finally {
      setGenerating(false);
    }
  }, [selectedEmotion, selectedPhrase, customText, selectedStyle, characterDesc]);

  const selectedEmotionData = EMOTIONS.find(e => e.id === selectedEmotion);
  const selectedStyleData = STYLES.find(s => s.id === selectedStyle);

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView style={st.scroll} contentContainerStyle={st.scrollContent}>
        {/* Header */}
        <View style={st.header}>
          <TouchableOpacity onPress={() => router.back()} style={st.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#FFF" />
          </TouchableOpacity>
          <View style={st.headerCenter}>
            <Text style={st.headerTitle}>微信表情包工坊</Text>
            <Text style={st.headerSub}>AI 一键生成专属表情包 · 3 Credits/个</Text>
          </View>
        </View>

        {/* Step 1: 選擇情緒 */}
        <View style={st.section}>
          <View style={st.sectionHeader}>
            <View style={[st.stepBadge, { backgroundColor: "#FF6B6B" }]}>
              <Text style={st.stepNum}>1</Text>
            </View>
            <Text style={st.sectionTitle}>选择情绪</Text>
          </View>
          <View style={st.emotionGrid}>
            {EMOTIONS.map(e => (
              <TouchableOpacity
                key={e.id}
                onPress={() => setSelectedEmotion(e.id)}
                style={[
                  st.emotionCard,
                  selectedEmotion === e.id && { borderColor: e.color, backgroundColor: `${e.color}20` },
                ]}
              >
                <Text style={st.emotionEmoji}>{e.emoji}</Text>
                <Text style={[st.emotionLabel, selectedEmotion === e.id && { color: e.color }]}>{e.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Step 2: 選擇詞語 */}
        <View style={st.section}>
          <View style={st.sectionHeader}>
            <View style={[st.stepBadge, { backgroundColor: "#FFD60A" }]}>
              <Text style={st.stepNum}>2</Text>
            </View>
            <Text style={st.sectionTitle}>添加文字</Text>
            <Text style={st.optionalTag}>可选</Text>
          </View>
          <View style={st.phraseGrid}>
            {PHRASES.map(p => (
              <TouchableOpacity
                key={p}
                onPress={() => { setSelectedPhrase(selectedPhrase === p ? "" : p); setCustomText(""); }}
                style={[
                  st.phraseChip,
                  selectedPhrase === p && st.phraseChipActive,
                ]}
              >
                <Text style={[st.phraseText, selectedPhrase === p && st.phraseTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={st.customInput}
            placeholder="或输入自定义文字（最多10字）"
            placeholderTextColor="#666"
            value={customText}
            onChangeText={(t) => { setCustomText(t.slice(0, 10)); setSelectedPhrase(""); }}
            maxLength={10}
            returnKeyType="done"
          />
        </View>

        {/* Step 3: 選擇風格 */}
        <View style={st.section}>
          <View style={st.sectionHeader}>
            <View style={[st.stepBadge, { backgroundColor: "#A855F7" }]}>
              <Text style={st.stepNum}>3</Text>
            </View>
            <Text style={st.sectionTitle}>选择风格</Text>
          </View>
          <View style={st.styleGrid}>
            {STYLES.map(s => (
              <TouchableOpacity
                key={s.id}
                onPress={() => setSelectedStyle(s.id)}
                style={[
                  st.styleCard,
                  selectedStyle === s.id && { borderColor: s.color, backgroundColor: `${s.color}15` },
                ]}
              >
                <MaterialIcons name={s.icon as any} size={24} color={selectedStyle === s.id ? s.color : "#888"} />
                <Text style={[st.styleLabel, selectedStyle === s.id && { color: s.color }]}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Step 4: 角色描述 */}
        <View style={st.section}>
          <View style={st.sectionHeader}>
            <View style={[st.stepBadge, { backgroundColor: "#64D2FF" }]}>
              <Text style={st.stepNum}>4</Text>
            </View>
            <Text style={st.sectionTitle}>角色描述</Text>
            <Text style={st.optionalTag}>可选</Text>
          </View>
          <TextInput
            style={[st.customInput, { height: 60 }]}
            placeholder="描述表情包角色，如：一只橘色的小猫、一个戴眼镜的男生..."
            placeholderTextColor="#666"
            value={characterDesc}
            onChangeText={setCharacterDesc}
            maxLength={200}
            multiline
            returnKeyType="done"
          />
        </View>

        {/* 生成按鈕 */}
        <TouchableOpacity
          onPress={handleGenerate}
          disabled={!selectedEmotion || generating}
          style={[st.generateBtn, (!selectedEmotion || generating) && st.generateBtnDisabled]}
        >
          {generating ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <MaterialIcons name="auto-awesome" size={20} color="#FFF" />
          )}
          <Text style={st.generateBtnText}>
            {generating ? "生成中..." : `生成表情包 · 3 Credits`}
          </Text>
        </TouchableOpacity>

        {/* 預覽 */}
        {selectedEmotion && (
          <View style={st.previewSection}>
            <Text style={st.previewTitle}>预览设置</Text>
            <View style={st.previewRow}>
              <View style={[st.previewTag, { backgroundColor: `${selectedEmotionData?.color}20` }]}>
                <Text style={{ fontSize: 16 }}>{selectedEmotionData?.emoji}</Text>
                <Text style={[st.previewTagText, { color: selectedEmotionData?.color }]}>{selectedEmotionData?.label}</Text>
              </View>
              {(selectedPhrase || customText) && (
                <View style={[st.previewTag, { backgroundColor: "rgba(255,214,10,0.15)" }]}>
                  <Text style={[st.previewTagText, { color: "#FFD60A" }]}>{customText || selectedPhrase}</Text>
                </View>
              )}
              <View style={[st.previewTag, { backgroundColor: `${selectedStyleData?.color}15` }]}>
                <Text style={[st.previewTagText, { color: selectedStyleData?.color }]}>{selectedStyleData?.label}</Text>
              </View>
            </View>
          </View>
        )}

        {/* 生成結果 */}
        {results.length > 0 && (
          <View style={st.resultsSection}>
            <Text style={st.resultsTitle}>已生成 · {results.length} 个表情</Text>
            <View style={st.resultsGrid}>
              {results.map((r, i) => (
                <View key={i} style={st.resultCard}>
                  <Image source={{ uri: r.imageUrl }} style={st.resultImage} contentFit="contain" />
                  <View style={st.resultInfo}>
                    <Text style={st.resultEmotion}>{r.emotion}</Text>
                    {r.phrase ? <Text style={st.resultPhrase}>{r.phrase}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 底部提示 */}
        <View style={st.tipSection}>
          <MaterialIcons name="info-outline" size={16} color="#666" />
          <Text style={st.tipText}>
            微信表情包标准：240×240px · GIF/PNG 格式 · 一套 16-24 个
          </Text>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const st = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#0C0A08" },
  scrollContent: { paddingBottom: 40 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,214,10,0.12)",
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  headerCenter: { marginLeft: 12, flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#FFF" },
  headerSub: { fontSize: 12, color: "#888", marginTop: 2 },
  section: { paddingHorizontal: 16, marginTop: 24 },
  sectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  stepBadge: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  stepNum: { fontSize: 12, fontWeight: "700", color: "#FFF" },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#FFF", marginLeft: 8 },
  optionalTag: { fontSize: 11, color: "#666", marginLeft: 8, backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  emotionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  emotionCard: {
    width: (SCREEN_WIDTH - 32 - 24) / 4,
    ...(isWeb ? { width: 80 } : {}),
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.08)",
  },
  emotionEmoji: { fontSize: 28 },
  emotionLabel: { fontSize: 11, color: "#AAA", marginTop: 4, fontWeight: "500" },
  phraseGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  phraseChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  phraseChipActive: { backgroundColor: "rgba(255,214,10,0.15)", borderColor: "#FFD60A" },
  phraseText: { fontSize: 13, color: "#AAA" },
  phraseTextActive: { color: "#FFD60A", fontWeight: "600" },
  customInput: {
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#FFF",
  },
  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  styleCard: {
    width: (SCREEN_WIDTH - 32 - 24) / 4,
    ...(isWeb ? { width: 100 } : {}),
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 6,
  },
  styleLabel: { fontSize: 11, color: "#AAA", fontWeight: "500" },
  generateBtn: {
    marginHorizontal: 16,
    marginTop: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: "#FFD60A",
  },
  generateBtnDisabled: { opacity: 0.4 },
  generateBtnText: { fontSize: 16, fontWeight: "700", color: "#FFF" },
  previewSection: { marginHorizontal: 16, marginTop: 20, padding: 14, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  previewTitle: { fontSize: 13, fontWeight: "600", color: "#888", marginBottom: 8 },
  previewRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  previewTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  previewTagText: { fontSize: 12, fontWeight: "600" },
  resultsSection: { marginHorizontal: 16, marginTop: 28 },
  resultsTitle: { fontSize: 16, fontWeight: "600", color: "#FFF", marginBottom: 12 },
  resultsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  resultCard: {
    width: (SCREEN_WIDTH - 32 - 12) / 2,
    ...(isWeb ? { width: 160 } : {}),
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  resultImage: { width: "100%", aspectRatio: 1, backgroundColor: "#FFF" },
  resultInfo: { padding: 10 },
  resultEmotion: { fontSize: 12, fontWeight: "600", color: "#FFF" },
  resultPhrase: { fontSize: 11, color: "#888", marginTop: 2 },
  tipSection: { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 16, marginTop: 24, padding: 12, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)" },
  tipText: { fontSize: 12, color: "#666", flex: 1 },
});
