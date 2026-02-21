import React, { useState, useCallback, useEffect } from "react";
import {
  Text, View, ScrollView, TouchableOpacity, StyleSheet,
  Platform, Dimensions, ActivityIndicator, TextInput, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWeb = Platform.OS === "web";
const isWide = isWeb && SCREEN_WIDTH > 768;

/* ===== Platform Data ===== */
const PLATFORMS = [
  {
    id: "xiaohongshu",
    name: "小红书",
    icon: "auto-awesome",
    color: "#FF2442",
    bgColor: "rgba(255,36,66,0.12)",
    bestTime: "周二/四/六 18:00-21:00",
    format: "竖屏 9:16 | 3-5分钟",
    audience: "18-35岁女性为主",
    tips: ["封面图决定 80% 点击率", "标题用数字+情绪词", "前 3 秒必须抓住注意力"],
  },
  {
    id: "bilibili",
    name: "B站",
    icon: "smart-display",
    color: "#00A1D6",
    bgColor: "rgba(0,161,214,0.12)",
    bestTime: "周五/六/日 19:00-22:00",
    format: "横屏 16:9 | 5-15分钟",
    audience: "15-30岁 Z世代",
    tips: ["封面要有信息量", "标题党适度使用", "交互区引导三连"],
  },
  {
    id: "douyin",
    name: "抖音",
    icon: "music-note",
    color: "#FE2C55",
    bgColor: "rgba(254,44,85,0.12)",
    bestTime: "每天 12:00-14:00, 18:00-22:00",
    format: "竖屏 9:16 | 15-60秒",
    audience: "全年龄层",
    tips: ["前 1 秒是生死线", "BGM 选择决定流量", "评论区交互提升推荐"],
  },
  {
    id: "channels",
    name: "视频号",
    icon: "videocam",
    color: "#07C160",
    bgColor: "rgba(7,193,96,0.12)",
    bestTime: "周一至周五 20:00-22:00",
    format: "竖屏 9:16 | 1-3分钟",
    audience: "30-55岁",
    tips: ["社交裂变是内核", "正能量内容更易传播", "朋友圈分享带动播放"],
  },
];

/* ===== Content Templates ===== */
const CONTENT_TEMPLATES = [
  { id: "emotional", label: "情感共鸣", icon: "favorite", color: "#FF6B6B", desc: "触动人心的故事叙述" },
  { id: "trending", label: "热点追踪", icon: "trending-up", color: "#FFD60A", desc: "紧跟当下流行趋势" },
  { id: "tutorial", label: "教学分享", icon: "school", color: "#64D2FF", desc: "专业知识输出" },
  { id: "behind", label: "幕后花絮", icon: "movie-filter", color: "#C77DBA", desc: "创作过程揭秘" },
  { id: "challenge", label: "挑战交互", icon: "emoji-events", color: "#30D158", desc: "引发用户参与" },
  { id: "collab", label: "联名合作", icon: "handshake", color: "#FF9F0A", desc: "跨界破圈传播" },
];

/* ===== Time Slots ===== */
const TIME_SLOTS = [
  { id: "morning", label: "上午", time: "09:00-12:00", icon: "wb-sunny" },
  { id: "noon", label: "午间", time: "12:00-14:00", icon: "light-mode" },
  { id: "afternoon", label: "下午", time: "14:00-18:00", icon: "wb-cloudy" },
  { id: "evening", label: "黄金时段", time: "18:00-22:00", icon: "nights-stay" },
  { id: "late", label: "深夜", time: "22:00-00:00", icon: "dark-mode" },
];

type GeneratedContent = {
  title: string;
  caption: string;
  hashtags: string[];
  tips: string;
};

export default function PublishScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Check authentication and redirect if not logged in
    if (!isAuthenticated) {
      setTimeout(() => {
        router.replace("/login");
      }, 0);
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) {
    return null; // Will redirect to login
  }
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>("evening");
  const [mvTitle, setMvTitle] = useState("");
  const [mvDescription, setMvDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedContents, setGeneratedContents] = useState<Record<string, GeneratedContent>>({});
  const [activeDetailPlatform, setActiveDetailPlatform] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [publishStep, setPublishStep] = useState<"config" | "generate" | "review">("config");

  const togglePlatform = useCallback((id: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }, []);

  const handleCopy = useCallback(async (text: string, field: string) => {
    if (isWeb && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
      } catch {
        // fallback
      }
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (selectedPlatforms.length === 0) return;
    setGenerating(true);

    // Generate content for each platform
    const contents: Record<string, GeneratedContent> = {};
    const template = CONTENT_TEMPLATES.find(t => t.id === selectedTemplate);

    for (const platformId of selectedPlatforms) {
      const platform = PLATFORMS.find(p => p.id === platformId);
      if (!platform) continue;

      // Generate platform-specific content locally
      const titlePrefix: Record<string, string> = {
        xiaohongshu: "🔥",
        bilibili: "【必看】",
        douyin: "❤️",
        channels: "✨",
      };

      const hashtagSets: Record<string, string[]> = {
        xiaohongshu: ["#视频制作", "#音乐视频", "#创作灵感", `#${platform.name}推荐`, "#视觉艺术"],
        bilibili: ["#视频", "#音乐", "#原创", "#视觉特效", "#创作分享"],
        douyin: ["#视频", "#音乐推荐", "#视觉冲击", "#创作者", "#热门"],
        channels: ["#视频分享", "#音乐生活", "#创意视频", "#正能量", "#好歌推荐"],
      };

      const captionStyles: Record<string, string> = {
        xiaohongshu: `这支视频真的太绝了！${mvDescription || "每一帧都是视觉盛宴"}✨\n\n${template ? `用${template.label}的方式呈现，` : ""}从构图到色彩都经过精心设计，看完整个人都被治愈了～\n\n💡 创作心得：好的视频不只是画面好看，更要能触动人心。\n\n📌 收藏这条，下次创作时参考！`,
        bilibili: `【${mvTitle || "视频创作"}】${mvDescription || "从零到一的视觉创作之旅"}\n\n${template ? `本期以「${template.label}」为主题，` : ""}带大家深入了解视频制作的每一个环节。\n\n⏰ 时间轴：\n00:00 开场\n00:15 内核片段\n00:30 幕后解析\n\n🎵 BGM 信息见评论区置顶\n\n如果喜欢的话，一键三连支持一下吧！`,
        douyin: `${mvDescription || "这个视频你一定没见过"}👀\n${template ? `#${template.label} ` : ""}每一秒都是惊喜！\n\n看到最后有彩蛋🎁`,
        channels: `分享一支用心制作的视频 🎬\n\n${mvDescription || "音乐与视觉的完美融合"}，${template ? `以「${template.label}」的风格呈现，` : ""}希望能带给大家一些美好的感受。\n\n创作不易，感谢每一位观看和分享的朋友 🙏`,
      };

      contents[platformId] = {
        title: `${titlePrefix[platformId] || ""} ${mvTitle || "震撞视频首发"}｜${template?.label || "视觉盛宴"}`,
        caption: captionStyles[platformId] || "",
        hashtags: hashtagSets[platformId] || [],
        tips: platform.tips.join("\n"),
      };
    }

    // Simulate AI processing time
    await new Promise(r => setTimeout(r, 1500));
    setGeneratedContents(contents);
    setGenerating(false);
    setPublishStep("review");
  }, [selectedPlatforms, selectedTemplate, mvTitle, mvDescription]);

  const handleReset = useCallback(() => {
    setPublishStep("config");
    setGeneratedContents({});
    setActiveDetailPlatform(null);
  }, []);

  return (
    <ScreenContainer edges={isWeb ? [] : ["top", "left", "right"]} containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ===== Header ===== */}
        <View style={styles.header}>
          <View style={styles.headerInner}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
              <MaterialIcons name="arrow-back" size={22} color="#F7F4EF" />
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>多平台发布中心</Text>
              <Text style={styles.headerSubtitle}>智能制定跨平台发布策略</Text>
            </View>
            {publishStep === "review" && (
              <TouchableOpacity onPress={handleReset} style={styles.resetBtn} activeOpacity={0.7}>
                <MaterialIcons name="refresh" size={18} color="#FF6B6B" />
                <Text style={styles.resetText}>重新配置</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ===== Step Indicator ===== */}
        <View style={styles.stepIndicator}>
          {[
            { step: "config", label: "配置", icon: "settings" as const },
            { step: "generate", label: "生成", icon: "auto-awesome" as const },
            { step: "review", label: "预览发布", icon: "publish" as const },
          ].map((s, i) => {
            const isActive = s.step === publishStep;
            const isPast = (publishStep === "review" && i < 2) || (publishStep === "generate" && i < 1);
            return (
              <React.Fragment key={s.step}>
                {i > 0 && <View style={[styles.stepLine, (isPast || isActive) && styles.stepLineActive]} />}
                <View style={styles.stepItem}>
                  <View style={[styles.stepCircle, (isActive || isPast) && styles.stepCircleActive]}>
                    <MaterialIcons name={isPast ? "check" : s.icon} size={16} color={(isActive || isPast) ? "#FFF" : "#9B9691"} />
                  </View>
                  <Text style={[styles.stepLabel, (isActive || isPast) && styles.stepLabelActive]}>{s.label}</Text>
                </View>
              </React.Fragment>
            );
          })}
        </View>

        {/* ===== Config Step ===== */}
        {publishStep === "config" && (
          <>
            {/* Platform Selection */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="language" size={20} color="#FFD60A" />
                <Text style={styles.sectionTitle}>选择发布平台</Text>
                <Text style={styles.sectionBadge}>{selectedPlatforms.length} 个已选</Text>
              </View>
              <View style={styles.platformGrid}>
                {PLATFORMS.map(platform => {
                  const isSelected = selectedPlatforms.includes(platform.id);
                  return (
                    <TouchableOpacity
                      key={platform.id}
                      style={[
                        styles.platformCard,
                        isSelected && { borderColor: platform.color, borderWidth: 2 },
                      ]}
                      onPress={() => togglePlatform(platform.id)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.platformIconWrap, { backgroundColor: platform.bgColor }]}>
                        <MaterialIcons name={platform.icon as any} size={28} color={platform.color} />
                      </View>
                      <Text style={[styles.platformName, isSelected && { color: platform.color }]}>{platform.name}</Text>
                      <Text style={styles.platformAudience}>{platform.audience}</Text>
                      <View style={styles.platformMeta}>
                        <MaterialIcons name="schedule" size={12} color="#9B9691" />
                        <Text style={styles.platformMetaText}>{platform.bestTime}</Text>
                      </View>
                      <View style={styles.platformMeta}>
                        <MaterialIcons name="aspect-ratio" size={12} color="#9B9691" />
                        <Text style={styles.platformMetaText}>{platform.format}</Text>
                      </View>
                      {isSelected && (
                        <View style={[styles.checkBadge, { backgroundColor: platform.color }]}>
                          <MaterialIcons name="check" size={14} color="#FFF" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Content Template */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="article" size={20} color="#C77DBA" />
                <Text style={styles.sectionTitle}>内容风格</Text>
              </View>
              <View style={styles.templateGrid}>
                {CONTENT_TEMPLATES.map(tmpl => (
                  <TouchableOpacity
                    key={tmpl.id}
                    style={[
                      styles.templateCard,
                      selectedTemplate === tmpl.id && { borderColor: tmpl.color, borderWidth: 2 },
                    ]}
                    onPress={() => setSelectedTemplate(selectedTemplate === tmpl.id ? null : tmpl.id)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name={tmpl.icon as any} size={22} color={tmpl.color} />
                    <Text style={styles.templateLabel}>{tmpl.label}</Text>
                    <Text style={styles.templateDesc}>{tmpl.desc}</Text>
                    {selectedTemplate === tmpl.id && (
                      <View style={[styles.checkBadge, { backgroundColor: tmpl.color }]}>
                        <MaterialIcons name="check" size={12} color="#FFF" />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Video Info */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="edit" size={20} color="#64D2FF" />
                <Text style={styles.sectionTitle}>视频信息</Text>
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>视频标题</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="例如：忆网情深 M&F"
                  placeholderTextColor="#6B6762"
                  value={mvTitle}
                  onChangeText={setMvTitle}
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>视频描述（可选）</Text>
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  placeholder="简述视频的主题、风格或亮点..."
                  placeholderTextColor="#6B6762"
                  value={mvDescription}
                  onChangeText={setMvDescription}
                  multiline
                  numberOfLines={3}
                />
              </View>
            </View>

            {/* Time Slot */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="schedule" size={20} color="#30D158" />
                <Text style={styles.sectionTitle}>发布时段</Text>
              </View>
              <View style={styles.timeGrid}>
                {TIME_SLOTS.map(slot => (
                  <TouchableOpacity
                    key={slot.id}
                    style={[
                      styles.timeCard,
                      selectedTimeSlot === slot.id && styles.timeCardActive,
                    ]}
                    onPress={() => setSelectedTimeSlot(slot.id)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons
                      name={slot.icon as any}
                      size={20}
                      color={selectedTimeSlot === slot.id ? "#FFD60A" : "#9B9691"}
                    />
                    <Text style={[styles.timeLabel, selectedTimeSlot === slot.id && styles.timeLabelActive]}>
                      {slot.label}
                    </Text>
                    <Text style={styles.timeRange}>{slot.time}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Generate Button */}
            <View style={styles.generateSection}>
              <TouchableOpacity
                style={[styles.generateBtn, selectedPlatforms.length === 0 && styles.generateBtnDisabled]}
                onPress={() => {
                  setPublishStep("generate");
                  handleGenerate();
                }}
                activeOpacity={0.8}
                disabled={selectedPlatforms.length === 0 || generating}
              >
                <MaterialIcons name="auto-awesome" size={22} color="#FFF" />
                <Text style={styles.generateBtnText}>
                  生成 {selectedPlatforms.length} 个平台发布方案
                </Text>
              </TouchableOpacity>
              {selectedPlatforms.length === 0 && (
                <Text style={styles.generateHint}>请先选择至少一个发布平台</Text>
              )}
            </View>
          </>
        )}

        {/* ===== Generating Step ===== */}
        {publishStep === "generate" && generating && (
          <View style={styles.loadingSection}>
            <ActivityIndicator size="large" color="#FF6B6B" />
            <Text style={styles.loadingTitle}>AI 正在生成发布方案...</Text>
            <Text style={styles.loadingDesc}>
              正在为 {selectedPlatforms.length} 个平台量身定制标题、文案和标签
            </Text>
            <View style={styles.loadingPlatforms}>
              {selectedPlatforms.map(pid => {
                const p = PLATFORMS.find(pl => pl.id === pid);
                return p ? (
                  <View key={pid} style={[styles.loadingPlatformTag, { backgroundColor: p.bgColor }]}>
                    <MaterialIcons name={p.icon as any} size={14} color={p.color} />
                    <Text style={[styles.loadingPlatformText, { color: p.color }]}>{p.name}</Text>
                  </View>
                ) : null;
              })}
            </View>
          </View>
        )}

        {/* ===== Review Step ===== */}
        {publishStep === "review" && !generating && (
          <>
            {/* Platform tabs */}
            <View style={styles.reviewTabs}>
              {selectedPlatforms.map(pid => {
                const p = PLATFORMS.find(pl => pl.id === pid);
                if (!p) return null;
                const isActive = activeDetailPlatform === pid || (!activeDetailPlatform && selectedPlatforms[0] === pid);
                return (
                  <TouchableOpacity
                    key={pid}
                    style={[styles.reviewTab, isActive && { borderColor: p.color, backgroundColor: p.bgColor }]}
                    onPress={() => setActiveDetailPlatform(pid)}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name={p.icon as any} size={18} color={isActive ? p.color : "#9B9691"} />
                    <Text style={[styles.reviewTabText, isActive && { color: p.color }]}>{p.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Content Preview */}
            {(() => {
              const activePid = activeDetailPlatform || selectedPlatforms[0];
              const content = generatedContents[activePid];
              const platform = PLATFORMS.find(p => p.id === activePid);
              if (!content || !platform) return null;

              return (
                <View style={styles.contentPreview}>
                  {/* Title */}
                  <View style={styles.contentBlock}>
                    <View style={styles.contentBlockHeader}>
                      <Text style={styles.contentBlockLabel}>标题</Text>
                      <TouchableOpacity
                        onPress={() => handleCopy(content.title, `${activePid}-title`)}
                        style={styles.copyBtn}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons
                          name={copiedField === `${activePid}-title` ? "check" : "content-copy"}
                          size={16}
                          color={copiedField === `${activePid}-title` ? "#30D158" : "#9B9691"}
                        />
                        <Text style={[styles.copyText, copiedField === `${activePid}-title` && { color: "#30D158" }]}>
                          {copiedField === `${activePid}-title` ? "已拷贝" : "拷贝"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.contentTitle}>{content.title}</Text>
                  </View>

                  {/* Caption */}
                  <View style={styles.contentBlock}>
                    <View style={styles.contentBlockHeader}>
                      <Text style={styles.contentBlockLabel}>文案</Text>
                      <TouchableOpacity
                        onPress={() => handleCopy(content.caption, `${activePid}-caption`)}
                        style={styles.copyBtn}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons
                          name={copiedField === `${activePid}-caption` ? "check" : "content-copy"}
                          size={16}
                          color={copiedField === `${activePid}-caption` ? "#30D158" : "#9B9691"}
                        />
                        <Text style={[styles.copyText, copiedField === `${activePid}-caption` && { color: "#30D158" }]}>
                          {copiedField === `${activePid}-caption` ? "已拷贝" : "拷贝"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.contentCaption}>{content.caption}</Text>
                  </View>

                  {/* Hashtags */}
                  <View style={styles.contentBlock}>
                    <View style={styles.contentBlockHeader}>
                      <Text style={styles.contentBlockLabel}>标签</Text>
                      <TouchableOpacity
                        onPress={() => handleCopy(content.hashtags.join(" "), `${activePid}-tags`)}
                        style={styles.copyBtn}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons
                          name={copiedField === `${activePid}-tags` ? "check" : "content-copy"}
                          size={16}
                          color={copiedField === `${activePid}-tags` ? "#30D158" : "#9B9691"}
                        />
                        <Text style={[styles.copyText, copiedField === `${activePid}-tags` && { color: "#30D158" }]}>
                          {copiedField === `${activePid}-tags` ? "已拷贝" : "拷贝"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.hashtagWrap}>
                      {content.hashtags.map((tag, i) => (
                        <View key={i} style={[styles.hashtagChip, { backgroundColor: `${platform.color}15`, borderColor: `${platform.color}30` }]}>
                          <Text style={[styles.hashtagText, { color: platform.color }]}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* Platform Tips */}
                  <View style={styles.contentBlock}>
                    <Text style={styles.contentBlockLabel}>发布建议</Text>
                    <View style={styles.tipsWrap}>
                      {platform.tips.map((tip, i) => (
                        <View key={i} style={styles.tipItem}>
                          <View style={[styles.tipDot, { backgroundColor: platform.color }]} />
                          <Text style={styles.tipText}>{tip}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* Time recommendation */}
                  <View style={[styles.timeRecommend, { borderColor: `${platform.color}30` }]}>
                    <MaterialIcons name="schedule" size={18} color={platform.color} />
                    <View style={styles.timeRecommendContent}>
                      <Text style={styles.timeRecommendLabel}>推荐发布时间</Text>
                      <Text style={[styles.timeRecommendValue, { color: platform.color }]}>{platform.bestTime}</Text>
                    </View>
                  </View>

                  {/* Copy All Button */}
                  <TouchableOpacity
                    style={[styles.copyAllBtn, { backgroundColor: `${platform.color}15`, borderColor: `${platform.color}40` }]}
                    onPress={() => handleCopy(
                      `${content.title}\n\n${content.caption}\n\n${content.hashtags.join(" ")}`,
                      `${activePid}-all`
                    )}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons
                      name={copiedField === `${activePid}-all` ? "check-circle" : "content-copy"}
                      size={20}
                      color={platform.color}
                    />
                    <Text style={[styles.copyAllText, { color: platform.color }]}>
                      {copiedField === `${activePid}-all` ? "全部已拷贝！" : "一键拷贝全部内容"}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })()}
          </>
        )}

        {/* ===== Footer Spacing ===== */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, backgroundColor: "#0C0808" },

  /* Header */
  header: {
    backgroundColor: "rgba(14, 8, 8, 0.95)",
    borderBottomWidth: 1, borderBottomColor: "rgba(255,107,107,0.10)",
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
  resetBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: "rgba(255,107,107,0.1)",
  },
  resetText: { fontSize: 13, fontWeight: "600", color: "#FF6B6B" },

  /* Step Indicator */
  stepIndicator: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 20, paddingHorizontal: 24, gap: 0,
  },
  stepItem: { alignItems: "center", gap: 6 },
  stepCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  stepCircleActive: {
    ...(isWeb ? {
      backgroundImage: "linear-gradient(135deg, #FF6B6B, #C77DBA)",
    } as any : { backgroundColor: "#FF6B6B" }),
  },
  stepLabel: { fontSize: 11, color: "#9B9691", fontWeight: "500" },
  stepLabelActive: { color: "#F7F4EF", fontWeight: "600" },
  stepLine: {
    width: isWide ? 60 : 30, height: 2,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginHorizontal: 8, marginBottom: 20,
  },
  stepLineActive: { backgroundColor: "#FF6B6B" },

  /* Section */
  section: {
    paddingHorizontal: isWide ? 48 : 16, paddingVertical: 16,
    maxWidth: 1000, alignSelf: "center", width: "100%",
  },
  sectionHeader: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16,
  },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#F7F4EF", flex: 1 },
  sectionBadge: {
    fontSize: 12, fontWeight: "600", color: "#FFD60A",
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10,
    backgroundColor: "rgba(255,214,10,0.12)",
  },

  /* Platform Grid */
  platformGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: isWide ? 14 : 10,
    justifyContent: "center",
  },
  platformCard: {
    width: isWide ? "22%" : (SCREEN_WIDTH - 42) / 2,
    backgroundColor: "#161618", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
    position: "relative",
  },
  platformIconWrap: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: "center", justifyContent: "center", marginBottom: 10,
  },
  platformName: { fontSize: 16, fontWeight: "700", color: "#F7F4EF", marginBottom: 4 },
  platformAudience: { fontSize: 12, color: "#9B9691", marginBottom: 8 },
  platformMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  platformMetaText: { fontSize: 11, color: "#9B9691" },
  checkBadge: {
    position: "absolute", top: 10, right: 10,
    width: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },

  /* Template Grid */
  templateGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center",
  },
  templateCard: {
    width: isWide ? "30%" : (SCREEN_WIDTH - 42) / 2,
    backgroundColor: "#161618", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
    alignItems: "center", position: "relative",
  },
  templateLabel: { fontSize: 14, fontWeight: "700", color: "#F7F4EF", marginTop: 8 },
  templateDesc: { fontSize: 11, color: "#9B9691", marginTop: 4, textAlign: "center" },

  /* Input */
  inputGroup: { marginBottom: 16 },
  inputLabel: { fontSize: 14, fontWeight: "600", color: "#F7F4EF", marginBottom: 8 },
  textInput: {
    backgroundColor: "#161618", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    color: "#F7F4EF", fontSize: 15,
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },

  /* Time Grid */
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" },
  timeCard: {
    width: isWide ? "18%" : (SCREEN_WIDTH - 52) / 3,
    backgroundColor: "#161618", borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
  },
  timeCardActive: { borderColor: "#FFD60A", backgroundColor: "rgba(255,214,10,0.08)" },
  timeLabel: { fontSize: 13, fontWeight: "600", color: "#9B9691", marginTop: 6 },
  timeLabelActive: { color: "#FFD60A" },
  timeRange: { fontSize: 10, color: "#6B6762", marginTop: 2 },

  /* Generate */
  generateSection: {
    paddingHorizontal: isWide ? 48 : 16, paddingVertical: 24,
    maxWidth: 1000, alignSelf: "center", width: "100%",
  },
  generateBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 16, borderRadius: 28,
    ...(isWeb ? {
      backgroundImage: "linear-gradient(135deg, #FF6B6B 0%, #C77DBA 50%, #64D2FF 100%)",
      boxShadow: "0 4px 20px rgba(255,107,107,0.3)",
    } as any : { backgroundColor: "#FF6B6B" }),
  },
  generateBtnDisabled: { opacity: 0.4 },
  generateBtnText: { fontSize: 16, fontWeight: "700", color: "#FFF" },
  generateHint: { fontSize: 12, color: "#9B9691", textAlign: "center", marginTop: 10 },

  /* Loading */
  loadingSection: {
    alignItems: "center", justifyContent: "center",
    paddingVertical: 80, paddingHorizontal: 24,
  },
  loadingTitle: { fontSize: 20, fontWeight: "700", color: "#F7F4EF", marginTop: 24 },
  loadingDesc: { fontSize: 14, color: "#9B9691", marginTop: 8, textAlign: "center" },
  loadingPlatforms: {
    flexDirection: "row", gap: 10, marginTop: 20, flexWrap: "wrap", justifyContent: "center",
  },
  loadingPlatformTag: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
  },
  loadingPlatformText: { fontSize: 13, fontWeight: "600" },

  /* Review Tabs */
  reviewTabs: {
    flexDirection: "row", justifyContent: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 16,
  },
  reviewTab: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  reviewTabText: { fontSize: 14, fontWeight: "500", color: "#9B9691" },

  /* Content Preview */
  contentPreview: {
    paddingHorizontal: isWide ? 48 : 16, paddingVertical: 8,
    maxWidth: 800, alignSelf: "center", width: "100%",
  },
  contentBlock: {
    backgroundColor: "#161618", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
    marginBottom: 12,
  },
  contentBlockHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: 10,
  },
  contentBlockLabel: { fontSize: 13, fontWeight: "700", color: "#9B9691", textTransform: "uppercase", letterSpacing: 1 },
  contentTitle: { fontSize: 18, fontWeight: "700", color: "#F7F4EF", lineHeight: 26 },
  contentCaption: { fontSize: 14, color: "#F7F4EF", lineHeight: 22 },
  copyBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  copyText: { fontSize: 12, fontWeight: "500", color: "#9B9691" },

  /* Hashtags */
  hashtagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hashtagChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    borderWidth: 1,
  },
  hashtagText: { fontSize: 13, fontWeight: "600" },

  /* Tips */
  tipsWrap: { gap: 8, marginTop: 8 },
  tipItem: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  tipDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  tipText: { fontSize: 14, color: "#F7F4EF", lineHeight: 20, flex: 1 },

  /* Time Recommend */
  timeRecommend: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#161618", borderRadius: 14, padding: 16,
    borderWidth: 1, marginBottom: 12,
  },
  timeRecommendContent: { flex: 1 },
  timeRecommendLabel: { fontSize: 12, color: "#9B9691", marginBottom: 2 },
  timeRecommendValue: { fontSize: 15, fontWeight: "700" },

  /* Copy All */
  copyAllBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 24, borderWidth: 1,
    marginTop: 4,
  },
  copyAllText: { fontSize: 15, fontWeight: "700" },
});
