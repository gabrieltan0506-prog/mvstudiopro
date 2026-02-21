import React, { useState, useCallback, useRef } from "react";
import {
  Text, View, ScrollView, TouchableOpacity, StyleSheet,
  Platform, Dimensions, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWeb = Platform.OS === "web";
const isWide = isWeb && SCREEN_WIDTH > 768;

/* ===== Filter Presets ===== */
const FILTERS = [
  { id: "warm-nostalgia", label: "暖色怀旧", icon: "wb-sunny", color: "#FF9F0A", css: "sepia(0.4) saturate(1.3) brightness(1.05) contrast(1.1)", desc: "温暖复古色调，适合情感回忆场景" },
  { id: "cold-lonely", label: "冷色孤寂", icon: "ac-unit", color: "#64D2FF", css: "saturate(0.7) brightness(0.9) hue-rotate(200deg) contrast(1.15)", desc: "冷冽蓝调，营造孤独深沉氛围" },
  { id: "dream-soft", label: "梦幻柔光", icon: "blur-on", color: "#C77DBA", css: "brightness(1.15) contrast(0.9) saturate(1.2) blur(0.5px)", desc: "柔和光晕效果，梦境般的视觉体验" },
  { id: "neon-cyber", label: "霓虹赛博", icon: "flash-on", color: "#30D158", css: "saturate(1.8) contrast(1.3) brightness(1.1) hue-rotate(10deg)", desc: "高饱和霓虹色彩，未来科技感" },
  { id: "retro-film", label: "复古胶片", icon: "camera-roll", color: "#FFD60A", css: "sepia(0.25) contrast(1.2) brightness(0.95) saturate(0.9)", desc: "经典胶片质感，电影般的颗粒感" },
  { id: "romantic-pink", label: "浪漫粉调", icon: "favorite", color: "#FF6B6B", css: "saturate(1.1) brightness(1.1) hue-rotate(330deg) contrast(1.05)", desc: "粉色浪漫色调，适合爱情主题" },
];

/* ===== Dynamic Effects ===== */
const EFFECTS = [
  { id: "particle-fall", label: "粒子飘落", icon: "grain", color: "#FFD60A", desc: "雪花/花瓣/星尘飘落效果" },
  { id: "light-pulse", label: "光晕脉动", icon: "flare", color: "#FF6B6B", desc: "柔和光晕呼吸式脉动" },
  { id: "camera-shake", label: "镜头摇晃", icon: "vibration", color: "#64D2FF", desc: "仿真手持摄影的微晃动" },
  { id: "color-wave", label: "色彩波动", icon: "waves", color: "#C77DBA", desc: "色彩渐变波浪式流动" },
  { id: "flash-beat", label: "闪光节拍", icon: "bolt", color: "#FF9F0A", desc: "跟随音乐节拍的闪光效果" },
  { id: "smoke-atmo", label: "烟雾氛围", icon: "cloud", color: "#30D158", desc: "烟雾弥漫的神秘氛围" },
];

/* ===== Transition Effects ===== */
const TRANSITIONS = [
  { id: "crossfade", label: "交叉淡化", icon: "compare", color: "#64D2FF" },
  { id: "slide-left", label: "左滑切换", icon: "arrow-back", color: "#FF6B6B" },
  { id: "zoom-in", label: "缩放进入", icon: "zoom-in", color: "#30D158" },
  { id: "blur-trans", label: "模糊过渡", icon: "blur-circular", color: "#C77DBA" },
  { id: "wipe-down", label: "下擦切换", icon: "vertical-align-bottom", color: "#FFD60A" },
  { id: "glitch", label: "故障效果", icon: "broken-image", color: "#FF9F0A" },
];

/* ===== Sample video frames for preview ===== */
const SAMPLE_FRAMES = [
  { id: "frame1", url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/FMaQrMFVSirXzkvD.jpg", label: "红裙舞曲" },
  { id: "frame2", url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/gjuvwUewnWpQtpRZ.jpg", label: "城市夜曲" },
  { id: "frame3", url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/BrPAcibOmXsyMiua.jpg", label: "雨中深情" },
  { id: "frame4", url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/nthPJMSIfmabjtqj.jpg", label: "天使之翼" },
];

export default function EffectsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"filters" | "effects" | "transitions">("filters");
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [selectedEffects, setSelectedEffects] = useState<string[]>([]);
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);
  const [filterIntensity, setFilterIntensity] = useState(75);
  const [effectIntensity, setEffectIntensity] = useState(50);
  const [previewFrame, setPreviewFrame] = useState(0);
  const [showBefore, setShowBefore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);

  const toggleEffect = useCallback((id: string) => {
    setSelectedEffects(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    );
  }, []);

  const handleUpload = useCallback(() => {
    if (isWeb && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  const handleFileChange = useCallback((e: any) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setUploadedImage(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    await new Promise(r => setTimeout(r, 1500));
    // Generate export config
    const config = {
      filter: selectedFilter,
      effects: selectedEffects,
      transition: selectedTransition,
      filterIntensity,
      effectIntensity,
      exportedAt: new Date().toISOString(),
    };
    if (Platform.OS === "web") {
      try {
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mv-effects-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error("Export failed:", e);
      }
    }
    setExporting(false);
    setExported(true);
    setTimeout(() => setExported(false), 3000);
  }, [selectedFilter, selectedEffects, selectedTransition, filterIntensity, effectIntensity]);

  const currentFilter = FILTERS.find(f => f.id === selectedFilter);
  const currentFrame = uploadedImage || SAMPLE_FRAMES[previewFrame].url;
  const filterStyle = currentFilter
    ? `${currentFilter.css.replace(/[\d.]+/g, (m, offset, str) => {
        // Adjust values based on intensity
        const num = parseFloat(m);
        if (isNaN(num)) return m;
        const factor = filterIntensity / 100;
        if (str.substring(offset - 10, offset).includes("blur")) return String(num * factor);
        if (num > 1) return String(1 + (num - 1) * factor);
        if (num < 1) return String(1 - (1 - num) * factor);
        return m;
      })}`
    : "none";

  const TABS = [
    { id: "filters" as const, label: "情感滤镜", icon: "palette" as const },
    { id: "effects" as const, label: "动态特效", icon: "auto-awesome" as const },
    { id: "transitions" as const, label: "转场效果", icon: "swap-horiz" as const },
  ];

  return (
    <ScreenContainer edges={isWeb ? [] : ["top", "left", "right"]} containerClassName="bg-background">
      {isWeb && (
        <input
          ref={fileInputRef as any}
          type="file"
          accept="image/*,video/*"
          style={{ display: "none" } as any}
          onChange={handleFileChange}
        />
      )}
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ===== Header ===== */}
        <View style={styles.header}>
          <View style={styles.headerInner}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
              <MaterialIcons name="arrow-back" size={22} color="#F7F4EF" />
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>分镜转视频</Text>
              <Text style={styles.headerSubtitle}>打造电影级视觉体验</Text>
            </View>
            <TouchableOpacity onPress={handleUpload} style={styles.uploadBtn} activeOpacity={0.7}>
              <MaterialIcons name="file-upload" size={20} color="#30D158" />
              <Text style={styles.uploadText}>上传素材</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ===== Preview Panel ===== */}
        <View style={styles.previewSection}>
          <View style={styles.previewContainer}>
            {/* Before/After toggle */}
            <TouchableOpacity
              style={styles.compareToggle}
              onPress={() => setShowBefore(!showBefore)}
              activeOpacity={0.7}
            >
              <MaterialIcons name={showBefore ? "visibility-off" : "visibility"} size={16} color="#F7F4EF" />
              <Text style={styles.compareText}>{showBefore ? "原图" : "效果"}</Text>
            </TouchableOpacity>

            <View style={styles.previewImageWrap}>
              {isWeb ? (
                <img
                  src={currentFrame}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    filter: showBefore ? "none" : filterStyle,
                    transition: "filter 0.3s ease",
                    borderRadius: 12,
                  } as any}
                />
              ) : (
                <Image source={{ uri: currentFrame }} style={styles.previewImage} contentFit="contain" />
              )}

              {/* Effect overlay indicators */}
              {!showBefore && selectedEffects.length > 0 && (
                <View style={styles.effectOverlay}>
                  {selectedEffects.map(eid => {
                    const eff = EFFECTS.find(e => e.id === eid);
                    return eff ? (
                      <View key={eid} style={[styles.effectTag, { backgroundColor: `${eff.color}30`, borderColor: `${eff.color}60` }]}>
                        <MaterialIcons name={eff.icon as any} size={12} color={eff.color} />
                        <Text style={[styles.effectTagText, { color: eff.color }]}>{eff.label}</Text>
                      </View>
                    ) : null;
                  })}
                </View>
              )}

              {/* Transition indicator */}
              {!showBefore && selectedTransition && (
                <View style={styles.transitionIndicator}>
                  <MaterialIcons name="swap-horiz" size={14} color="#64D2FF" />
                  <Text style={styles.transitionText}>
                    {TRANSITIONS.find(t => t.id === selectedTransition)?.label}
                  </Text>
                </View>
              )}
            </View>

            {/* Frame selector */}
            {!uploadedImage && (
              <View style={styles.framePicker}>
                {SAMPLE_FRAMES.map((frame, i) => (
                  <TouchableOpacity
                    key={frame.id}
                    style={[styles.frameThumb, previewFrame === i && styles.frameThumbActive]}
                    onPress={() => setPreviewFrame(i)}
                    activeOpacity={0.7}
                  >
                    <Image source={{ uri: frame.url }} style={styles.frameThumbImage} contentFit="cover" />
                    <Text style={[styles.frameLabel, previewFrame === i && styles.frameLabelActive]}>{frame.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {uploadedImage && (
              <TouchableOpacity style={styles.clearUploadBtn} onPress={() => setUploadedImage(null)} activeOpacity={0.7}>
                <MaterialIcons name="close" size={14} color="#FF6B6B" />
                <Text style={styles.clearUploadText}>移除上传图片，使用范例</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ===== Tab Selector ===== */}
        <View style={styles.tabBar}>
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tabItem, activeTab === tab.id && styles.tabItemActive]}
              onPress={() => setActiveTab(tab.id)}
              activeOpacity={0.7}
            >
              <MaterialIcons name={tab.icon} size={20} color={activeTab === tab.id ? "#FF6B6B" : "#9B9691"} />
              <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ===== Filters Tab ===== */}
        {activeTab === "filters" && (
          <View style={styles.controlSection}>
            <View style={styles.controlGrid}>
              {FILTERS.map(filter => (
                <TouchableOpacity
                  key={filter.id}
                  style={[
                    styles.controlCard,
                    selectedFilter === filter.id && { borderColor: filter.color, borderWidth: 2 },
                  ]}
                  onPress={() => setSelectedFilter(selectedFilter === filter.id ? null : filter.id)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.controlIconWrap, { backgroundColor: `${filter.color}18` }]}>
                    <MaterialIcons name={filter.icon as any} size={24} color={filter.color} />
                  </View>
                  <Text style={styles.controlLabel}>{filter.label}</Text>
                  <Text style={styles.controlDesc} numberOfLines={2}>{filter.desc}</Text>
                  {selectedFilter === filter.id && (
                    <View style={[styles.activeBadge, { backgroundColor: filter.color }]}>
                      <MaterialIcons name="check" size={12} color="#FFF" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Intensity Slider */}
            {selectedFilter && (
              <View style={styles.sliderSection}>
                <View style={styles.sliderHeader}>
                  <Text style={styles.sliderLabel}>滤镜强度</Text>
                  <Text style={[styles.sliderValue, { color: currentFilter?.color }]}>{filterIntensity}%</Text>
                </View>
                {isWeb ? (
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={filterIntensity}
                    onChange={(e: any) => setFilterIntensity(Number(e.target.value))}
                    style={{
                      width: "100%",
                      height: 6,
                      accentColor: currentFilter?.color || "#FF6B6B",
                      cursor: "pointer",
                    } as any}
                  />
                ) : (
                  <View style={styles.sliderTrack}>
                    <View style={[styles.sliderFill, { width: `${filterIntensity}%`, backgroundColor: currentFilter?.color }]} />
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* ===== Effects Tab ===== */}
        {activeTab === "effects" && (
          <View style={styles.controlSection}>
            <View style={styles.controlGrid}>
              {EFFECTS.map(effect => {
                const isSelected = selectedEffects.includes(effect.id);
                return (
                  <TouchableOpacity
                    key={effect.id}
                    style={[
                      styles.controlCard,
                      isSelected && { borderColor: effect.color, borderWidth: 2 },
                    ]}
                    onPress={() => toggleEffect(effect.id)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.controlIconWrap, { backgroundColor: `${effect.color}18` }]}>
                      <MaterialIcons name={effect.icon as any} size={24} color={effect.color} />
                    </View>
                    <Text style={styles.controlLabel}>{effect.label}</Text>
                    <Text style={styles.controlDesc} numberOfLines={2}>{effect.desc}</Text>
                    {isSelected && (
                      <View style={[styles.activeBadge, { backgroundColor: effect.color }]}>
                        <MaterialIcons name="check" size={12} color="#FFF" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Effect Intensity Slider */}
            {selectedEffects.length > 0 && (
              <View style={styles.sliderSection}>
                <View style={styles.sliderHeader}>
                  <Text style={styles.sliderLabel}>特效强度</Text>
                  <Text style={[styles.sliderValue, { color: "#C77DBA" }]}>{effectIntensity}%</Text>
                </View>
                {isWeb ? (
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={effectIntensity}
                    onChange={(e: any) => setEffectIntensity(Number(e.target.value))}
                    style={{
                      width: "100%",
                      height: 6,
                      accentColor: "#C77DBA",
                      cursor: "pointer",
                    } as any}
                  />
                ) : (
                  <View style={styles.sliderTrack}>
                    <View style={[styles.sliderFill, { width: `${effectIntensity}%`, backgroundColor: "#C77DBA" }]} />
                  </View>
                )}
                <Text style={styles.sliderHint}>
                  已选择 {selectedEffects.length} 个特效（可多选叠加）
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ===== Transitions Tab ===== */}
        {activeTab === "transitions" && (
          <View style={styles.controlSection}>
            <View style={styles.controlGrid}>
              {TRANSITIONS.map(trans => (
                <TouchableOpacity
                  key={trans.id}
                  style={[
                    styles.controlCard,
                    selectedTransition === trans.id && { borderColor: trans.color, borderWidth: 2 },
                  ]}
                  onPress={() => setSelectedTransition(selectedTransition === trans.id ? null : trans.id)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.controlIconWrap, { backgroundColor: `${trans.color}18` }]}>
                    <MaterialIcons name={trans.icon as any} size={24} color={trans.color} />
                  </View>
                  <Text style={styles.controlLabel}>{trans.label}</Text>
                  {selectedTransition === trans.id && (
                    <View style={[styles.activeBadge, { backgroundColor: trans.color }]}>
                      <MaterialIcons name="check" size={12} color="#FFF" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ===== Summary & Export ===== */}
        <View style={styles.summarySection}>
          <Text style={styles.summaryTitle}>当前配置</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <MaterialIcons name="palette" size={18} color="#FF9F0A" />
              <Text style={styles.summaryLabel}>滤镜</Text>
              <Text style={styles.summaryValue}>{currentFilter?.label || "未选择"}</Text>
            </View>
            <View style={styles.summaryItem}>
              <MaterialIcons name="auto-awesome" size={18} color="#C77DBA" />
              <Text style={styles.summaryLabel}>特效</Text>
              <Text style={styles.summaryValue}>
                {selectedEffects.length > 0
                  ? selectedEffects.map(id => EFFECTS.find(e => e.id === id)?.label).join("、")
                  : "未选择"}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <MaterialIcons name="swap-horiz" size={18} color="#64D2FF" />
              <Text style={styles.summaryLabel}>转场</Text>
              <Text style={styles.summaryValue}>
                {TRANSITIONS.find(t => t.id === selectedTransition)?.label || "未选择"}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.exportBtn,
              (!selectedFilter && selectedEffects.length === 0 && !selectedTransition) && styles.exportBtnDisabled,
            ]}
            onPress={handleExport}
            activeOpacity={0.8}
            disabled={exporting || (!selectedFilter && selectedEffects.length === 0 && !selectedTransition)}
          >
            {exporting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : exported ? (
              <>
                <MaterialIcons name="check-circle" size={20} color="#FFF" />
                <Text style={styles.exportBtnText}>导出成功！</Text>
              </>
            ) : (
              <>
                <MaterialIcons name="file-download" size={20} color="#FFF" />
                <Text style={styles.exportBtnText}>导出特效方案</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* ===== Tool Description Section ===== */}
        <View style={styles.toolDescSection}>
          <Text style={styles.toolDescTitle}>创作工具一览</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolDescScroll}>
            {[
              { icon: "videocam" as const, title: "视频展厅", desc: "浏览精选视频作品集，支持在线播放和评论交互", color: "#FF6B6B", route: "/mv-gallery" },
              { icon: "graphic-eq" as const, title: "视频 PK 评分", desc: "上传视频，AI 分析构图、色彩与爆款潜力", color: "#64D2FF", route: "/(tabs)/analyze" },
              { icon: "groups" as const, title: "虚拟偶像工坊", desc: "输入描述生成多风格虚拟偶像形象", color: "#C77DBA", route: "/(tabs)/avatar" },
              { icon: "auto-fix-high" as const, title: "分镜转视频", desc: "将分镜脚本转化为高质量视频片段", color: "#30D158", route: "/effects" },
              { icon: "campaign" as const, title: "多平台发布", desc: "AI 生成专属文案，一键跨平台发布", color: "#FFD60A", route: "/(tabs)/publish" },
            ].map((tool, i) => (
              <TouchableOpacity key={i} style={styles.toolDescCard} onPress={() => router.push(tool.route as any)} activeOpacity={0.8}>
                <View style={[styles.toolDescIcon, { backgroundColor: `${tool.color}18`, borderColor: `${tool.color}40`, borderWidth: 1 }]}>
                  <MaterialIcons name={tool.icon} size={24} color={tool.color} />
                </View>
                <Text style={styles.toolDescName}>{tool.title}</Text>
                <Text style={styles.toolDescText}>{tool.desc}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ===== Footer Spacing ===== */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, backgroundColor: "#0D0D0F" },

  /* Header */
  header: {
    backgroundColor: "rgba(16, 16, 18, 0.92)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
    ...(isWeb ? { position: "sticky" as any, top: 0, zIndex: 100, backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" } as any : {}),
  },
  headerInner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: isWide ? 48 : 20, paddingVertical: 14,
    maxWidth: 1200, alignSelf: "center", width: "100%",
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  headerTitleWrap: { flex: 1, marginLeft: 14 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#F7F4EF" },
  headerSubtitle: { fontSize: 12, color: "#9B9691", marginTop: 2 },
  uploadBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "rgba(48,209,88,0.12)",
    borderWidth: 1, borderColor: "rgba(48,209,88,0.3)",
  },
  uploadText: { fontSize: 13, fontWeight: "600", color: "#30D158" },

  /* Preview */
  previewSection: {
    paddingHorizontal: isWide ? 48 : 16, paddingVertical: 24,
    alignItems: "center",
  },
  previewContainer: {
    width: "100%", maxWidth: 600, alignItems: "center",
  },
  compareToggle: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-end", marginBottom: 10,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  compareText: { fontSize: 12, fontWeight: "600", color: "#F7F4EF" },
  previewImageWrap: {
    width: "100%", aspectRatio: 16 / 10, borderRadius: 12, overflow: "hidden",
    backgroundColor: "#1A1A1D", position: "relative",
    ...(isWeb ? { boxShadow: "0 8px 40px rgba(0,0,0,0.5)" } as any : { elevation: 8 }),
  },
  previewImage: { width: "100%", height: "100%" },
  effectOverlay: {
    position: "absolute", bottom: 10, left: 10,
    flexDirection: "row", flexWrap: "wrap", gap: 6,
  },
  effectTag: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    borderWidth: 1,
  },
  effectTagText: { fontSize: 10, fontWeight: "600" },
  transitionIndicator: {
    position: "absolute", top: 10, right: 10,
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    backgroundColor: "rgba(100,210,255,0.15)",
    borderWidth: 1, borderColor: "rgba(100,210,255,0.3)",
  },
  transitionText: { fontSize: 11, fontWeight: "600", color: "#64D2FF" },
  framePicker: {
    flexDirection: "row", gap: 10, marginTop: 16, justifyContent: "center",
  },
  frameThumb: {
    width: isWide ? 80 : 64, borderRadius: 8, overflow: "hidden",
    borderWidth: 2, borderColor: "transparent",
    alignItems: "center",
  },
  frameThumbActive: { borderColor: "#FF6B6B" },
  frameThumbImage: { width: "100%", aspectRatio: 0.75, borderRadius: 6 },
  frameLabel: { fontSize: 10, color: "#9B9691", marginTop: 4, textAlign: "center" },
  frameLabelActive: { color: "#FF6B6B", fontWeight: "600" },
  clearUploadBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    backgroundColor: "rgba(255,107,107,0.1)",
  },
  clearUploadText: { fontSize: 12, color: "#FF6B6B" },

  /* Tabs */
  tabBar: {
    flexDirection: "row", justifyContent: "center", gap: isWide ? 16 : 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  tabItem: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: isWide ? 20 : 14, paddingVertical: 10, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  tabItemActive: {
    backgroundColor: "rgba(255,107,107,0.12)",
    borderWidth: 1, borderColor: "rgba(255,107,107,0.3)",
  },
  tabLabel: { fontSize: 14, fontWeight: "500", color: "#9B9691" },
  tabLabelActive: { color: "#FF6B6B", fontWeight: "600" },

  /* Controls */
  controlSection: {
    paddingHorizontal: isWide ? 48 : 16, paddingVertical: 20,
    maxWidth: 1000, alignSelf: "center", width: "100%",
  },
  controlGrid: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "center",
    gap: isWide ? 14 : 10,
  },
  controlCard: {
    width: isWide ? "30%" : (SCREEN_WIDTH - 48) / 2,
    backgroundColor: "#161618", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
    position: "relative",
  },
  controlIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center", marginBottom: 10,
  },
  controlLabel: { fontSize: 15, fontWeight: "700", color: "#F7F4EF", marginBottom: 4 },
  controlDesc: { fontSize: 12, color: "#9B9691", lineHeight: 18 },
  activeBadge: {
    position: "absolute", top: 10, right: 10,
    width: 22, height: 22, borderRadius: 11,
    alignItems: "center", justifyContent: "center",
  },

  /* Slider */
  sliderSection: {
    marginTop: 24, paddingHorizontal: 4,
    backgroundColor: "#161618", borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  sliderHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: 14,
  },
  sliderLabel: { fontSize: 15, fontWeight: "600", color: "#F7F4EF" },
  sliderValue: { fontSize: 20, fontWeight: "800" },
  sliderTrack: {
    height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)",
  },
  sliderFill: { height: 6, borderRadius: 3 },
  sliderHint: { fontSize: 12, color: "#9B9691", marginTop: 10 },

  /* Summary & Export */
  summarySection: {
    paddingHorizontal: isWide ? 48 : 16, paddingVertical: 24,
    maxWidth: 1000, alignSelf: "center", width: "100%",
  },
  summaryTitle: {
    fontSize: 18, fontWeight: "700", color: "#F7F4EF", marginBottom: 16,
  },
  summaryGrid: {
    gap: 10, marginBottom: 24,
  },
  summaryItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#161618", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  summaryLabel: { fontSize: 14, fontWeight: "600", color: "#9B9691", width: 50 },
  summaryValue: { fontSize: 14, color: "#F7F4EF", flex: 1 },
  exportBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 16, borderRadius: 28,
    ...(isWeb ? {
      backgroundImage: "linear-gradient(135deg, #FF6B6B 0%, #C77DBA 50%, #64D2FF 100%)",
      boxShadow: "0 4px 20px rgba(255,107,107,0.3)",
    } as any : { backgroundColor: "#FF6B6B" }),
  },
  exportBtnDisabled: { opacity: 0.4 },
  exportBtnText: { fontSize: 16, fontWeight: "700", color: "#FFF" },

  /* Tool Description */
  toolDescSection: {
    paddingVertical: 28,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)",
    maxWidth: 1200, alignSelf: "center" as const, width: "100%" as const,
  },
  toolDescTitle: {
    fontSize: 18, fontWeight: "700" as const, color: "#F7F4EF",
    marginBottom: 16, paddingHorizontal: isWide ? 48 : 16,
  },
  toolDescScroll: {
    paddingHorizontal: isWide ? 48 : 16, gap: 12,
  },
  toolDescCard: {
    width: isWide ? 200 : 160, backgroundColor: "#161618",
    borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  toolDescIcon: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center" as const, justifyContent: "center" as const, marginBottom: 10,
  },
  toolDescName: {
    fontSize: 14, fontWeight: "700" as const, color: "#F7F4EF", marginBottom: 6,
  },
  toolDescText: {
    fontSize: 12, color: "#9B9691", lineHeight: 18,
  },
});
