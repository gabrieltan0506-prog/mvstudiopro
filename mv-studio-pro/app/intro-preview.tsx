import { Text, View, TouchableOpacity, StyleSheet, Platform, Dimensions, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { useState, useCallback, useRef } from "react";
import { showAlert, hapticImpact, hapticNotification } from "@/lib/web-utils";

const isWeb = Platform.OS === "web";
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWide = isWeb && SCREEN_WIDTH > 768;

/* ===== Intro Animation Templates ===== */
const INTRO_TEMPLATES = [
  {
    id: "logo-zoom",
    title: "Logo 缩放光效",
    desc: "Logo 从中心放大，搭配光晕扩散效果",
    duration: "3s",
    icon: "zoom-in" as const,
    color: "#FF6B6B",
    previewBg: "#1A0A0A",
  },
  {
    id: "particle-burst",
    title: "粒子爆发",
    desc: "粒子从四面八方汇聚成 Logo 形状",
    duration: "4s",
    icon: "blur-on" as const,
    color: "#64D2FF",
    previewBg: "#0A1520",
  },
  {
    id: "glitch-reveal",
    title: "故障风揭示",
    desc: "赛博朋克风格故障效果揭示 Logo",
    duration: "3s",
    icon: "flash-on" as const,
    color: "#C77DBA",
    previewBg: "#150A1A",
  },
  {
    id: "neon-trace",
    title: "霓虹描边",
    desc: "霓虹光线沿 Logo 轮廓描绘动画",
    duration: "5s",
    icon: "auto-awesome" as const,
    color: "#30D158",
    previewBg: "#0A150A",
  },
  {
    id: "cinematic-fade",
    title: "电影级淡入",
    desc: "搭配镜头光晕的电影级淡入效果",
    duration: "4s",
    icon: "movie-filter" as const,
    color: "#FFD60A",
    previewBg: "#1A1500",
  },
  {
    id: "3d-rotate",
    title: "3D 旋转入场",
    desc: "Logo 3D 旋转翻转入场动画",
    duration: "3s",
    icon: "3d-rotation" as const,
    color: "#FF9F0A",
    previewBg: "#1A1005",
  },
];

/* ===== Video Intro Videos (existing MV data for download) ===== */
const INTRO_VIDEOS = [
  {
    id: "mv-intro-1",
    title: "忆网情深 M&F — 红裙舞曲",
    thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/FMaQrMFVSirXzkvD.jpg",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/jxmFvYYJQHLTAQWr.mp4",
    duration: "0:35",
    size: "8.2 MB",
  },
  {
    id: "mv-intro-2",
    title: "忆网情深 M&F — 城市夜曲",
    thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/gjuvwUewnWpQtpRZ.jpg",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/bGfNjLQhJfLqnXWQ.mp4",
    duration: "0:35",
    size: "7.8 MB",
  },
  {
    id: "mv-intro-3",
    title: "意想爱 韩风版 — 花园晨曦",
    thumbnail: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/CXzVPwztIGcraPfw.jpg",
    videoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/YPTNJpRfFjJxGNpP.mp4",
    duration: "0:35",
    size: "9.1 MB",
  },
];

export default function IntroPreviewScreen() {
  const router = useRouter();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!selectedTemplate) return;
    hapticImpact();
    setGenerating(true);
    // Simulate generation
    await new Promise(r => setTimeout(r, 3000));
    setGenerating(false);
    setGenerated(true);
    hapticNotification();
    showAlert("生成成功", "片头动画已生成，可以预览和下载");
  }, [selectedTemplate]);

  const handleDownloadVideo = useCallback(async (videoUrl: string, title: string) => {
    setDownloading(videoUrl);
    hapticImpact();
    try {
      if (isWeb) {
        // Web: use fetch + blob for cross-origin download
        const response = await fetch(videoUrl);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${title}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        hapticNotification();
        showAlert("下载成功", `${title} 已开始下载`);
      } else {
        // Native: use expo-file-system
        const FileSystem = await import("expo-file-system/legacy");
        const fileName = `${title.replace(/\s/g, "_")}.mp4`;
        const fileUri = FileSystem.documentDirectory + fileName;
        const downloadResult = await FileSystem.downloadAsync(videoUrl, fileUri);
        hapticNotification();
        showAlert("下载成功", `视频已保存至 ${downloadResult.uri}`);
      }
    } catch (err) {
      console.error("Download failed:", err);
      showAlert("下载失败", "请稍后重试");
    } finally {
      setDownloading(null);
    }
  }, []);

  const handlePlayVideo = useCallback((videoUrl: string) => {
    if (playingVideo === videoUrl) {
      setPlayingVideo(null);
      return;
    }
    setPlayingVideo(videoUrl);
  }, [playingVideo]);

  return (
    <ScreenContainer edges={isWeb ? [] : ["top", "left", "right"]} containerClassName="bg-background">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
              <MaterialIcons name="arrow-back" size={24} color="#F7F4EF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>片头动画工坊</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Hero Section */}
          <View style={styles.heroSection}>
            <View style={styles.heroIconWrap}>
              <MaterialIcons name="movie-filter" size={40} color="#FFD60A" />
            </View>
            <Text style={styles.heroTitle}>打造震撼开场</Text>
            <Text style={styles.heroDesc}>
              选择动画模板，为您的视频生成专业级片头动画
            </Text>
          </View>

          {/* Rainbow divider */}
          <View style={styles.rainbowBar}>
            {["#FF6B6B", "#FFD60A", "#30D158", "#64D2FF", "#C77DBA"].map((c, i) => (
              <View key={i} style={[styles.rainbowSegment, { backgroundColor: c }]} />
            ))}
          </View>

          {/* Animation Templates */}
          <View style={styles.section}>
            <Text style={styles.sectionBadge}>ANIMATION TEMPLATES</Text>
            <Text style={styles.sectionTitle}>动画模板</Text>
            <Text style={styles.sectionDesc}>选择一种片头动画风格</Text>

            <View style={styles.templateGrid}>
              {INTRO_TEMPLATES.map((tmpl) => {
                const isSelected = selectedTemplate === tmpl.id;
                return (
                  <TouchableOpacity
                    key={tmpl.id}
                    style={[
                      styles.templateCard,
                      isSelected && { borderColor: tmpl.color, borderWidth: 2 },
                    ]}
                    onPress={() => {
                      setSelectedTemplate(tmpl.id);
                      setGenerated(false);
                      hapticImpact();
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.templatePreview, { backgroundColor: tmpl.previewBg }]}>
                      <MaterialIcons name={tmpl.icon} size={32} color={tmpl.color} />
                      {isSelected && (
                        <View style={[styles.selectedBadge, { backgroundColor: tmpl.color }]}>
                          <MaterialIcons name="check" size={14} color="#FFF" />
                        </View>
                      )}
                    </View>
                    <View style={styles.templateInfo}>
                      <Text style={styles.templateTitle}>{tmpl.title}</Text>
                      <Text style={styles.templateDesc}>{tmpl.desc}</Text>
                      <View style={styles.templateMeta}>
                        <MaterialIcons name="timer" size={12} color="#9B9691" />
                        <Text style={styles.templateDuration}>{tmpl.duration}</Text>
                      </View>
                    </View>
                    <View style={[styles.templateColorBar, { backgroundColor: tmpl.color }]} />
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Generate Button */}
            <TouchableOpacity
              style={[styles.generateBtn, !selectedTemplate && styles.generateBtnDisabled]}
              onPress={handleGenerate}
              activeOpacity={0.8}
              disabled={generating || !selectedTemplate}
            >
              {generating ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : generated ? (
                <>
                  <MaterialIcons name="check-circle" size={22} color="#FFF" />
                  <Text style={styles.generateBtnText}>生成完成！</Text>
                </>
              ) : (
                <>
                  <MaterialIcons name="auto-awesome" size={22} color="#FFF" />
                  <Text style={styles.generateBtnText}>生成片头动画</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Rainbow divider */}
          <View style={styles.rainbowBar}>
            {["#C77DBA", "#64D2FF", "#30D158", "#FFD60A", "#FF6B6B"].map((c, i) => (
              <View key={i} style={[styles.rainbowSegment, { backgroundColor: c }]} />
            ))}
          </View>

          {/* MV Download Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionBadge, { color: "#64D2FF" }]}>VIDEO DOWNLOADS</Text>
            <Text style={styles.sectionTitle}>视频视频下载</Text>
            <Text style={styles.sectionDesc}>下载精选视频视频到本地</Text>

            {INTRO_VIDEOS.map((video) => {
              const isPlaying = playingVideo === video.videoUrl;
              const isDownloading = downloading === video.videoUrl;
              return (
                <View key={video.id} style={styles.videoCard}>
                  {/* Video Preview / Player */}
                  <TouchableOpacity
                    style={styles.videoPreview}
                    onPress={() => handlePlayVideo(video.videoUrl)}
                    activeOpacity={0.9}
                  >
                    {isPlaying && isWeb ? (
                      <View style={styles.videoPlayerWrap}>
                        <video
                          ref={(el: HTMLVideoElement | null) => { videoRef.current = el; }}
                          src={video.videoUrl}
                          autoPlay
                          controls
                          playsInline
                          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12 } as any}
                        />
                      </View>
                    ) : (
                      <>
                        <Image source={{ uri: video.thumbnail }} style={styles.videoThumb} contentFit="cover" />
                        <View style={styles.playOverlay}>
                          <View style={styles.playCircle}>
                            <MaterialIcons name="play-arrow" size={32} color="#FFF" />
                          </View>
                        </View>
                        <View style={styles.durationBadge}>
                          <Text style={styles.durationText}>{video.duration}</Text>
                        </View>
                      </>
                    )}
                  </TouchableOpacity>

                  {/* Video Info */}
                  <View style={styles.videoInfo}>
                    <Text style={styles.videoTitle} numberOfLines={2}>{video.title}</Text>
                    <Text style={styles.videoSize}>{video.size}</Text>
                  </View>

                  {/* Download Button */}
                  <TouchableOpacity
                    style={styles.downloadBtn}
                    onPress={() => handleDownloadVideo(video.videoUrl, video.title)}
                    activeOpacity={0.8}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <MaterialIcons name="file-download" size={20} color="#FFF" />
                        <Text style={styles.downloadBtnText}>下载</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          <View style={{ height: 60 }} />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingBottom: 40,
  },
  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#F7F4EF",
  },

  // Hero
  heroSection: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  heroIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "rgba(255, 214, 10, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: isWide ? 36 : 28,
    fontWeight: "800",
    color: "#F7F4EF",
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  heroDesc: {
    fontSize: 15,
    color: "#9B9691",
    textAlign: "center",
    lineHeight: 22,
  },

  // Rainbow bar
  rainbowBar: {
    flexDirection: "row",
    height: 3,
    marginHorizontal: 24,
    borderRadius: 2,
    overflow: "hidden",
    marginVertical: 8,
  },
  rainbowSegment: {
    flex: 1,
  },

  // Section
  section: {
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  sectionBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFD60A",
    letterSpacing: 2,
    marginBottom: 6,
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: isWide ? 28 : 22,
    fontWeight: "800",
    color: "#F7F4EF",
    textAlign: "center",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  sectionDesc: {
    fontSize: 14,
    color: "#9B9691",
    textAlign: "center",
    marginBottom: 20,
  },

  // Template grid
  templateGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  templateCard: {
    width: isWide ? "31%" : "48%" as any,
    flexBasis: isWide ? "31%" : "48%" as any,
    flexGrow: 1,
    backgroundColor: "#1A1A1E",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  templatePreview: {
    height: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  templateInfo: {
    padding: 12,
  },
  templateTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#F7F4EF",
    marginBottom: 4,
  },
  templateDesc: {
    fontSize: 11,
    color: "#9B9691",
    lineHeight: 16,
    marginBottom: 6,
  },
  templateMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  templateDuration: {
    fontSize: 11,
    color: "#9B9691",
  },
  templateColorBar: {
    height: 3,
  },

  // Generate button
  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 28,
    ...(isWeb ? {
      backgroundImage: "linear-gradient(135deg, #FF6B6B, #C77DBA, #64D2FF)",
    } : {
      backgroundColor: "#E8825E",
    }),
  } as any,
  generateBtnDisabled: {
    opacity: 0.4,
  },
  generateBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },

  // Video cards
  videoCard: {
    backgroundColor: "#1A1A1E",
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  videoPreview: {
    width: "100%",
    height: 200,
    backgroundColor: "#111114",
  },
  videoPlayerWrap: {
    width: "100%",
    height: "100%",
  },
  videoThumb: {
    width: "100%",
    height: "100%",
  },
  playOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  playCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,107,107,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  durationBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  durationText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#FFF",
  },
  videoInfo: {
    padding: 14,
    paddingBottom: 0,
  },
  videoTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#F7F4EF",
    marginBottom: 4,
  },
  videoSize: {
    fontSize: 12,
    color: "#9B9691",
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    margin: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#30D158",
  },
  downloadBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFF",
  },
});
