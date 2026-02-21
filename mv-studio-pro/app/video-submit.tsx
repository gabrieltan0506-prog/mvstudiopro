import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Text, View, ScrollView, TouchableOpacity, StyleSheet,
  Platform, Dimensions, ActivityIndicator, TextInput, Alert,
  Modal, Animated, Easing,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWeb = Platform.OS === "web";

// ─── Platform Definitions ────────────────────────────
const PLATFORMS = [
  { id: "douyin" as const, name: "抖音", icon: "music-note", color: "#FE2C55", bgColor: "rgba(254,44,85,0.12)" },
  { id: "weixin_channels" as const, name: "视频号", icon: "videocam", color: "#07C160", bgColor: "rgba(7,193,96,0.12)" },
  { id: "xiaohongshu" as const, name: "小红书", icon: "auto-awesome", color: "#FF2442", bgColor: "rgba(255,36,66,0.12)" },
  { id: "bilibili" as const, name: "B站", icon: "smart-display", color: "#00A1D6", bgColor: "rgba(0,161,214,0.12)" },
] as const;

type PlatformId = typeof PLATFORMS[number]["id"];

type PlatformEntry = {
  platform: PlatformId;
  videoLink: string;
  dataScreenshotUrl: string;
  screenshotBase64: string | null;
};

type Step = "verify" | "upload" | "review" | "analyzing" | "result";

// ─── Showcase Content for Waiting Animation ──────────
const SHOWCASE_CONTENT = [
  {
    type: "feature" as const,
    icon: "auto-awesome",
    title: "AI 智能分镜脚本",
    desc: "上传歌曲即可自动生成专业视频分镜脚本，包含画面描述、运镜指导、情绪节奏",
    color: "#FF6B35",
  },
  {
    type: "feature" as const,
    icon: "brush",
    title: "NanoBanana 图片生成",
    desc: "全新 AI 图片生成引擎，支持多种风格，为你的视频创作绝美视觉素材",
    color: "#C77DBA",
  },
  {
    type: "feature" as const,
    icon: "movie-creation",
    title: "一键生成视频",
    desc: "从脚本到成片，AI 自动完成画面生成、音乐匹配、特效合成",
    color: "#64D2FF",
  },
  {
    type: "tip" as const,
    icon: "lightbulb",
    title: "爆款视频秘诀",
    desc: "前 3 秒决定留存率，开场要有冲击力！保持节奏紧凑，每 15-20 秒设置一个高潮点",
    color: "#FFD60A",
  },
  {
    type: "tip" as const,
    icon: "palette",
    title: "色彩运用技巧",
    desc: "统一的色调能提升专业感。尝试使用互补色制造视觉张力，让画面更具表现力",
    color: "#30D158",
  },
  {
    type: "tip" as const,
    icon: "music-note",
    title: "音乐与画面同步",
    desc: "好的视频音画同步率达 90% 以上。利用节拍点切换画面，让观众沉浸其中",
    color: "#FF6B6B",
  },
];

const ANALYSIS_STAGES = [
  { key: "downloading", label: "下载视频文档", icon: "cloud-download" },
  { key: "checking", label: "检测视频时长", icon: "timer" },
  { key: "extracting", label: "抽取关键帧", icon: "burst-mode" },
  { key: "uploading", label: "上传帧图片", icon: "cloud-upload" },
  { key: "analyzing", label: "AI 逐帧分析", icon: "psychology" },
  { key: "scoring", label: "综合评分计算", icon: "calculate" },
  { key: "data_scoring", label: "平台数据评分", icon: "analytics" },
];

export default function VideoSubmitScreen() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();

  // ─── Step State ────────────────────────────────────
  const [step, setStep] = useState<Step>("verify");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ─── Verification State ────────────────────────────
  const [realName, setRealName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [idFrontBase64, setIdFrontBase64] = useState<string | null>(null);
  const [idFrontUrl, setIdFrontUrl] = useState("");

  // ─── Video Upload State ────────────────────────────
  const [videoTitle, setVideoTitle] = useState("");
  const [videoDescription, setVideoDescription] = useState("");
  const [videoBase64, setVideoBase64] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [thumbnailBase64, setThumbnailBase64] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [platformEntries, setPlatformEntries] = useState<PlatformEntry[]>([]);
  const [licenseAgreed, setLicenseAgreed] = useState(false);
  const [showLicense, setShowLicense] = useState(false);

  // ─── Result State ──────────────────────────────────
  const [submitResult, setSubmitResult] = useState<any>(null);

   // ─── Analyzing State ───────────────────────────
  const [analysisVideoId, setAnalysisVideoId] = useState<number | null>(null);
  const [analysisStage, setAnalysisStage] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisDetail, setAnalysisDetail] = useState("");
  const [analysisFrames, setAnalysisFrames] = useState<Array<{ frameIndex: number; timestamp: number; imageUrl: string; dropped?: boolean; frameScore?: number }>>([]);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  // ─── tRPC Queries & Mutations ──────────────────
  const verificationStatus = trpc.videoSubmission.getVerificationStatus.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const submitVerification = trpc.videoSubmission.submitVerification.useMutation();
  const uploadFile = trpc.videoSubmission.uploadFile.useMutation();
  const submitVideo = trpc.videoSubmission.submitVideo.useMutation();
  const licenseQuery = trpc.videoSubmission.getLicenseAgreement.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // ─── Analysis Progress Polling ─────────────────
  const analysisProgressQuery = trpc.videoSubmission.getAnalysisProgress.useQuery(
    { videoId: analysisVideoId! },
    {
      enabled: step === "analyzing" && analysisVideoId !== null,
      refetchInterval: 3000,
    }
  );

  useEffect(() => {
    if (!analysisProgressQuery.data) return;
    const data = analysisProgressQuery.data;
    setAnalysisStage(data.stage);
    setAnalysisProgress(data.progress);
    setAnalysisDetail(data.detail || "");
    if (data.frameAnalyses) {
      setAnalysisFrames(data.frameAnalyses as any);
    }

    // Animate progress bar
    Animated.timing(progressAnim, {
      toValue: data.progress / 100,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    if (data.completed) {
      // Analysis complete - transition to result
      if (data.stage === "completed" && (data as any).score !== undefined) {
        setSubmitResult({
          status: "scored",
          score: (data as any).score,
          creditsRewarded: (data as any).creditsRewarded || 0,
          scoreDetails: (data as any).scoreDetails,
        });
        setStep("result");
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } else if ((data as any).error) {
        setSubmitResult({ status: "pending_review", message: data.detail });
        setStep("result");
      }
    }
  }, [analysisProgressQuery.data]);

  // ─── Pulse Animation for Analyzing ────────────
  useEffect(() => {
    if (step !== "analyzing") return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [step]);

  // ─── Carousel Timer for Showcase ──────────────
  useEffect(() => {
    if (step !== "analyzing") return;
    const timer = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % SHOWCASE_CONTENT.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [step]);

  // ─── Auto-advance if already verified ──────────────
  useEffect(() => {
    if (verificationStatus.data?.verified) {
      setStep("upload");
    }
  }, [verificationStatus.data]);

  // ─── Auth Check ────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return null;

  // ─── Image Picker Helper ──────────────────────────
  const pickImage = async (): Promise<{ base64: string; uri: string } | null> => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets[0].base64) {
        return { base64: result.assets[0].base64, uri: result.assets[0].uri };
      }
    } catch (e: any) {
      Alert.alert("错误", "选择图片失败：" + e.message);
    }
    return null;
  };

  const pickVideo = async (): Promise<{ base64: string; uri: string } | null> => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsEditing: false,
        quality: 0.5,
        base64: true,
      });
      if (!result.canceled && result.assets[0]) {
        // For video, base64 might not be available on all platforms
        return {
          base64: result.assets[0].base64 || "",
          uri: result.assets[0].uri,
        };
      }
    } catch (e: any) {
      Alert.alert("错误", "选择视频失败：" + e.message);
    }
    return null;
  };

  // ─── Upload to S3 Helper ──────────────────────────
  const uploadToS3 = async (base64: string, folder: "id-photos" | "data-screenshots" | "videos" | "thumbnails", mimeType = "image/jpeg") => {
    const result = await uploadFile.mutateAsync({
      fileBase64: base64,
      mimeType,
      folder,
    });
    return result.url;
  };

  // ─── Submit Verification ──────────────────────────
  const handleSubmitVerification = async () => {
    if (!realName.trim()) { setError("请输入真实姓名"); return; }
    if (!idNumber.trim() || idNumber.length < 15) { setError("请输入有效的身份证号码"); return; }
    if (!idFrontBase64) { setError("请上传身份证正面照片"); return; }

    setLoading(true);
    setError("");
    try {
      // Upload ID photo first
      const url = await uploadToS3(idFrontBase64, "id-photos");
      setIdFrontUrl(url);

      const result = await submitVerification.mutateAsync({
        realName,
        idNumber,
        idFrontUrl: url,
      });

      if (result.success) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (result.autoApproved) {
          setStep("upload");
        } else {
          Alert.alert("已提交", "实名认证已提交，等待审核通过后即可上传视频");
        }
      } else {
        setError(result.error || "提交失败");
      }
    } catch (e: any) {
      setError(e.message || "提交失败");
    } finally {
      setLoading(false);
    }
  };

  // ─── Toggle Platform ──────────────────────────────
  const togglePlatform = (platformId: PlatformId) => {
    setPlatformEntries(prev => {
      const exists = prev.find(p => p.platform === platformId);
      if (exists) {
        return prev.filter(p => p.platform !== platformId);
      }
      return [...prev, { platform: platformId, videoLink: "", dataScreenshotUrl: "", screenshotBase64: null }];
    });
  };

  const updatePlatformEntry = (platformId: PlatformId, field: keyof PlatformEntry, value: string) => {
    setPlatformEntries(prev =>
      prev.map(p => p.platform === platformId ? { ...p, [field]: value } : p)
    );
  };

  // ─── Pick Screenshot for Platform ─────────────────
  const pickPlatformScreenshot = async (platformId: PlatformId) => {
    const result = await pickImage();
    if (result) {
      setPlatformEntries(prev =>
        prev.map(p => p.platform === platformId ? { ...p, screenshotBase64: result.base64 } : p)
      );
    }
  };

  // ─── Submit Video ─────────────────────────────────
  const handleSubmitVideo = async () => {
    if (!videoTitle.trim()) { setError("请输入视频标题"); return; }
    if (platformEntries.length === 0) { setError("请选择至少一个发布平台"); return; }
    if (!licenseAgreed) { setError("请先阅读并同意平台授权协议"); return; }

    // Validate all platform entries
    for (const entry of platformEntries) {
      if (!entry.videoLink.trim()) {
        const pName = PLATFORMS.find(p => p.id === entry.platform)?.name;
        setError(`请输入「${pName}」的视频链接`);
        return;
      }
      if (!entry.screenshotBase64 && !entry.dataScreenshotUrl) {
        const pName = PLATFORMS.find(p => p.id === entry.platform)?.name;
        setError(`请上传「${pName}」的后台数据截屏`);
        return;
      }
    }

    setLoading(true);
    setError("");
    setStep("review");

    try {
      // Upload all screenshots
      const uploadedLinks = [];
      for (const entry of platformEntries) {
        let screenshotUrl = entry.dataScreenshotUrl;
        if (entry.screenshotBase64 && !screenshotUrl) {
          screenshotUrl = await uploadToS3(entry.screenshotBase64, "data-screenshots");
        }
        uploadedLinks.push({
          platform: entry.platform,
          videoLink: entry.videoLink,
          dataScreenshotUrl: screenshotUrl,
        });
      }

      // Upload video if we have base64 (or use a placeholder URL for now)
      let finalVideoUrl = videoUrl;
      if (!finalVideoUrl && videoBase64) {
        finalVideoUrl = await uploadToS3(videoBase64, "videos", "video/mp4");
      }
      if (!finalVideoUrl) {
        // Use the first platform link as a reference
        finalVideoUrl = platformEntries[0].videoLink;
      }

      // Upload thumbnail if available
      let finalThumbnailUrl = thumbnailUrl;
      if (!finalThumbnailUrl && thumbnailBase64) {
        finalThumbnailUrl = await uploadToS3(thumbnailBase64, "thumbnails");
      }

      // Submit to backend for AI scoring
      const result = await submitVideo.mutateAsync({
        title: videoTitle,
        description: videoDescription || undefined,
        videoUrl: finalVideoUrl,
        thumbnailUrl: finalThumbnailUrl || undefined,
        platformLinks: uploadedLinks,
        licenseAgreed: true,
      });

      setSubmitResult(result);

      if (result.status === "analyzing" && result.videoId) {
        // 转到分析等待页面
        setAnalysisVideoId(result.videoId);
        setAnalysisStage("");
        setAnalysisProgress(0);
        setAnalysisDetail("");
        setAnalysisFrames([]);
        progressAnim.setValue(0);
        setStep("analyzing");
      } else if (result.status === "pending_review") {
        setStep("result");
      } else {
        setStep("result");
      }

      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (e: any) {
      setError(e.message || "提交失败");
      setStep("upload");
    } finally {
      setLoading(false);
    }
  };

    // ─── Score Color Helper ───────────────────────
  const getScoreColor = (score: number) => {
    if (score >= 90) return "#30D158";
    if (score >= 80) return "#FFD60A";
    if (score >= 60) return "#FF9F0A";
    return "#FF6B6B";
  };

  // ─── Stage Label Helper ───────────────────────
  const getStageInfo = (stage: string) => {
    const stageMap: Record<string, { label: string; icon: string; color: string }> = {
      downloading: { label: "下载视频中", icon: "cloud-download", color: "#64D2FF" },
      checking: { label: "检测视频时长", icon: "timer", color: "#C77DBA" },
      extracting: { label: "抽取关键帧", icon: "burst-mode", color: "#FF9F0A" },
      uploading: { label: "上传帧图片", icon: "cloud-upload", color: "#64D2FF" },
      analyzing: { label: "AI 逐帧分析", icon: "psychology", color: "#30D158" },
      scoring: { label: "综合评分计算", icon: "calculate", color: "#FFD60A" },
      data_scoring: { label: "平台数据评分", icon: "analytics", color: "#FF6B35" },
      completed: { label: "分析完成", icon: "check-circle", color: "#30D158" },
    };
    return stageMap[stage] || { label: "处理中", icon: "hourglass-top", color: "#999" };
  };

  // ═══════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════

  return (
    <ScreenContainer edges={isWeb ? [] : ["top", "left", "right"]} containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <MaterialIcons name="arrow-back" size={22} color="#F7F4EF" />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>爆款视频奖励计划</Text>
            <Text style={styles.headerSubtitle}>上传爆款视频，赢取 Credits 奖励</Text>
          </View>
        </View>

        {/* Step Indicator */}
        <View style={styles.stepRow}>
          {[
            { key: "verify", label: "实名认证", icon: "verified-user" },
            { key: "upload", label: "上传视频", icon: "cloud-upload" },
            { key: "review", label: "AI 审核", icon: "psychology" },
            { key: "result", label: "评分结果", icon: "emoji-events" },
          ].map((s, i) => {
            const steps: Step[] = ["verify", "upload", "review", "result"];
            const currentIdx = steps.indexOf(step);
            const thisIdx = steps.indexOf(s.key as Step);
            const isActive = thisIdx === currentIdx;
            const isPast = thisIdx < currentIdx;
            return (
              <React.Fragment key={s.key}>
                {i > 0 && <View style={[styles.stepLine, isPast && styles.stepLineActive]} />}
                <View style={styles.stepItem}>
                  <View style={[styles.stepCircle, isActive && styles.stepCircleActive, isPast && styles.stepCircleDone]}>
                    <MaterialIcons
                      name={isPast ? "check" : (s.icon as any)}
                      size={14}
                      color={isActive || isPast ? "#FFF" : "#666"}
                    />
                  </View>
                  <Text style={[styles.stepLabel, (isActive || isPast) && styles.stepLabelActive]}>
                    {s.label}
                  </Text>
                </View>
              </React.Fragment>
            );
          })}
        </View>

        {/* Error Message */}
        {error ? (
          <View style={styles.errorBox}>
            <MaterialIcons name="error-outline" size={18} color="#FF6B6B" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => setError("")}>
              <MaterialIcons name="close" size={18} color="#FF6B6B" />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ═══ Step 1: Verification ═══ */}
        {step === "verify" && (
          <View style={styles.section}>
            {verificationStatus.data?.status === "pending" ? (
              <View style={styles.pendingBox}>
                <MaterialIcons name="hourglass-top" size={48} color="#FFD60A" />
                <Text style={styles.pendingTitle}>实名认证审核中</Text>
                <Text style={styles.pendingDesc}>
                  您的实名认证正在审核中，通过后即可上传视频。
                </Text>
                <TouchableOpacity
                  style={styles.refreshBtn}
                  onPress={() => verificationStatus.refetch()}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="refresh" size={18} color="#0A7EA4" />
                  <Text style={styles.refreshText}>刷新状态</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.sectionHeader}>
                  <MaterialIcons name="verified-user" size={22} color="#FFD60A" />
                  <Text style={styles.sectionTitle}>实名认证</Text>
                </View>
                <Text style={styles.sectionDesc}>
                  上传视频前需完成实名认证，确保内容真实可靠。
                </Text>

                {verificationStatus.data?.status === "rejected" && (
                  <View style={styles.rejectedBox}>
                    <MaterialIcons name="warning" size={18} color="#FF6B6B" />
                    <Text style={styles.rejectedText}>
                      认证被拒绝：{verificationStatus.data.adminNotes || "请重新提交"}
                    </Text>
                  </View>
                )}

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>真实姓名</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="请输入真实姓名"
                    placeholderTextColor="#666"
                    value={realName}
                    onChangeText={setRealName}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>身份证号码</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="请输入身份证号码"
                    placeholderTextColor="#666"
                    value={idNumber}
                    onChangeText={setIdNumber}
                    secureTextEntry
                  />
                  <Text style={styles.inputHint}>仅用于验证身份，不会完整存储</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>身份证正面照片</Text>
                  <TouchableOpacity
                    style={styles.uploadBox}
                    onPress={async () => {
                      const result = await pickImage();
                      if (result) setIdFrontBase64(result.base64);
                    }}
                    activeOpacity={0.7}
                  >
                    {idFrontBase64 ? (
                      <Image
                        source={{ uri: `data:image/jpeg;base64,${idFrontBase64}` }}
                        style={styles.uploadPreview}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={styles.uploadPlaceholder}>
                        <MaterialIcons name="add-a-photo" size={36} color="#666" />
                        <Text style={styles.uploadPlaceholderText}>点击上传身份证正面</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.primaryBtn, loading && styles.btnDisabled]}
                  onPress={handleSubmitVerification}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <>
                      <MaterialIcons name="verified" size={20} color="#FFF" />
                      <Text style={styles.primaryBtnText}>提交认证</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* ═══ Step 2: Upload Video ═══ */}
        {step === "upload" && (
          <>
            {/* Reward Rules Banner */}
            <View style={styles.rewardBanner}>
              <View style={styles.rewardBannerHeader}>
                <MaterialIcons name="emoji-events" size={24} color="#FFD60A" />
                <Text style={styles.rewardBannerTitle}>奖励规则</Text>
              </View>
              <View style={styles.rewardGrid}>
                <View style={[styles.rewardCard, { borderColor: "#FFD60A" }]}>
                  <Text style={styles.rewardScore}>80-89 分</Text>
                  <Text style={[styles.rewardAmount, { color: "#FFD60A" }]}>+30 Credits</Text>
                </View>
                <View style={[styles.rewardCard, { borderColor: "#30D158" }]}>
                  <Text style={styles.rewardScore}>90-100 分</Text>
                  <Text style={[styles.rewardAmount, { color: "#30D158" }]}>+80 Credits</Text>
                </View>
              </View>
              <Text style={styles.rewardNote}>
                获奖视频将在平台展厅展示，同一视频多平台分发仅计算一次
              </Text>
            </View>

            {/* Video Info */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="movie" size={22} color="#64D2FF" />
                <Text style={styles.sectionTitle}>视频信息</Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>视频标题 *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="请输入视频标题"
                  placeholderTextColor="#666"
                  value={videoTitle}
                  onChangeText={setVideoTitle}
                  maxLength={255}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>视频描述</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="简要描述视频内容（可选）"
                  placeholderTextColor="#666"
                  value={videoDescription}
                  onChangeText={setVideoDescription}
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* Thumbnail Upload */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>视频封面（可选）</Text>
                <TouchableOpacity
                  style={styles.uploadBoxSmall}
                  onPress={async () => {
                    const result = await pickImage();
                    if (result) setThumbnailBase64(result.base64);
                  }}
                  activeOpacity={0.7}
                >
                  {thumbnailBase64 ? (
                    <Image
                      source={{ uri: `data:image/jpeg;base64,${thumbnailBase64}` }}
                      style={styles.uploadPreviewSmall}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={styles.uploadPlaceholderSmall}>
                      <MaterialIcons name="image" size={24} color="#666" />
                      <Text style={styles.uploadPlaceholderTextSmall}>上传封面</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Platform Selection & Links */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="language" size={22} color="#FF6B6B" />
                <Text style={styles.sectionTitle}>平台发布记录 *</Text>
              </View>
              <Text style={styles.sectionDesc}>
                请选择已发布的平台，并提供视频链接和后台数据截屏
              </Text>

              {/* Platform Chips */}
              <View style={styles.platformChips}>
                {PLATFORMS.map(p => {
                  const isSelected = platformEntries.some(e => e.platform === p.id);
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[
                        styles.platformChip,
                        isSelected && { backgroundColor: p.bgColor, borderColor: p.color },
                      ]}
                      onPress={() => togglePlatform(p.id)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name={p.icon as any} size={18} color={isSelected ? p.color : "#999"} />
                      <Text style={[styles.platformChipText, isSelected && { color: p.color }]}>
                        {p.name}
                      </Text>
                      {isSelected && <MaterialIcons name="check-circle" size={16} color={p.color} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Platform Entry Forms */}
              {platformEntries.map(entry => {
                const platform = PLATFORMS.find(p => p.id === entry.platform)!;
                return (
                  <View key={entry.platform} style={[styles.platformForm, { borderLeftColor: platform.color }]}>
                    <View style={styles.platformFormHeader}>
                      <MaterialIcons name={platform.icon as any} size={18} color={platform.color} />
                      <Text style={[styles.platformFormTitle, { color: platform.color }]}>
                        {platform.name}
                      </Text>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabelSmall}>视频链接 *</Text>
                      <TextInput
                        style={styles.inputSmall}
                        placeholder={`请粘贴${platform.name}的视频链接`}
                        placeholderTextColor="#555"
                        value={entry.videoLink}
                        onChangeText={(v) => updatePlatformEntry(entry.platform, "videoLink", v)}
                        autoCapitalize="none"
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabelSmall}>后台数据截屏 *</Text>
                      <TouchableOpacity
                        style={styles.screenshotUpload}
                        onPress={() => pickPlatformScreenshot(entry.platform)}
                        activeOpacity={0.7}
                      >
                        {entry.screenshotBase64 ? (
                          <Image
                            source={{ uri: `data:image/jpeg;base64,${entry.screenshotBase64}` }}
                            style={styles.screenshotPreview}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={styles.screenshotPlaceholder}>
                            <MaterialIcons name="add-photo-alternate" size={28} color="#666" />
                            <Text style={styles.screenshotPlaceholderText}>
                              上传{platform.name}后台数据截屏
                            </Text>
                            <Text style={styles.screenshotHint}>
                              包含播放量、点赞数等数据
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* License Agreement */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="gavel" size={22} color="#C77DBA" />
                <Text style={styles.sectionTitle}>平台授权协议</Text>
              </View>

              <View style={styles.licenseBox}>
                <Text style={styles.licensePreview}>
                  当视频获得 80 分以上评分并获得 Credits 奖励后，您同意授予 MV Studio Pro 平台对该视频的非独家使用权，包括无偿展示和二次开发，无需另行告知原作者。原作者仍保留视频的原始著作权。
                </Text>
                <TouchableOpacity
                  style={styles.licenseReadMore}
                  onPress={() => setShowLicense(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.licenseReadMoreText}>阅读完整协议</Text>
                  <MaterialIcons name="chevron-right" size={18} color="#0A7EA4" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => setLicenseAgreed(!licenseAgreed)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, licenseAgreed && styles.checkboxChecked]}>
                  {licenseAgreed && <MaterialIcons name="check" size={16} color="#FFF" />}
                </View>
                <Text style={styles.checkboxLabel}>
                  我已阅读并同意《爆款视频奖励计划 — 平台授权协议》
                </Text>
              </TouchableOpacity>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[
                styles.submitBtn,
                (!licenseAgreed || platformEntries.length === 0 || !videoTitle.trim()) && styles.submitBtnDisabled,
              ]}
              onPress={handleSubmitVideo}
              disabled={!licenseAgreed || platformEntries.length === 0 || !videoTitle.trim() || loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <MaterialIcons name="rocket-launch" size={22} color="#FFF" />
                  <Text style={styles.submitBtnText}>提交视频 · AI 自动评分</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* ═══ Step 3: AI Review (Loading) ═══ */}
        {step === "review" && loading && (
          <View style={styles.reviewingBox}>
            <ActivityIndicator size="large" color="#FFD60A" />
            <Text style={styles.reviewingTitle}>正在提交视频...</Text>
            <Text style={styles.reviewingDesc}>
              正在上传数据截屏和验证平台链接
            </Text>
          </View>
        )}

        {/* ═══ Step 3.5: Analyzing (Rich Waiting Animation) ═══ */}
        {step === "analyzing" && (
          <View style={styles.analyzingContainer}>
            {/* Progress Header */}
            <Animated.View style={[styles.analyzingHeader, { transform: [{ scale: pulseAnim }] }]}>
              <View style={styles.analyzingIconCircle}>
                <MaterialIcons
                  name={(getStageInfo(analysisStage).icon) as any}
                  size={36}
                  color={getStageInfo(analysisStage).color}
                />
              </View>
              <Text style={styles.analyzingTitle}>
                {getStageInfo(analysisStage).label}
              </Text>
              <Text style={styles.analyzingDetail}>{analysisDetail}</Text>
            </Animated.View>

            {/* Progress Bar */}
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBg}>
                <Animated.View
                  style={[
                    styles.progressBarFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["0%", "100%"],
                      }),
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>{analysisProgress}%</Text>
            </View>

            {/* Analysis Stages Timeline */}
            <View style={styles.stagesTimeline}>
              {ANALYSIS_STAGES.map((s, i) => {
                const stageIdx = ANALYSIS_STAGES.findIndex((st) => st.key === analysisStage);
                const thisIdx = i;
                const isPast = thisIdx < stageIdx;
                const isCurrent = thisIdx === stageIdx;
                return (
                  <View key={s.key} style={styles.stageTimelineItem}>
                    <View style={[
                      styles.stageTimelineDot,
                      isPast && styles.stageTimelineDotDone,
                      isCurrent && styles.stageTimelineDotActive,
                    ]}>
                      {isPast ? (
                        <MaterialIcons name="check" size={10} color="#FFF" />
                      ) : (
                        <MaterialIcons name={s.icon as any} size={10} color={isCurrent ? "#FFF" : "#666"} />
                      )}
                    </View>
                    <Text style={[
                      styles.stageTimelineLabel,
                      (isPast || isCurrent) && styles.stageTimelineLabelActive,
                    ]}>
                      {s.label}
                    </Text>
                    {i < ANALYSIS_STAGES.length - 1 && (
                      <View style={[styles.stageTimelineLine, isPast && styles.stageTimelineLineDone]} />
                    )}
                  </View>
                );
              })}
            </View>

            {/* Frame Preview Grid */}
            {analysisFrames.length > 0 && (
              <View style={styles.framePreviewSection}>
                <Text style={styles.framePreviewTitle}>
                  已分析帧 ({analysisFrames.length})
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}>
                  {analysisFrames.map((frame) => (
                    <View key={frame.frameIndex} style={[
                      styles.framePreviewCard,
                      frame.dropped && styles.framePreviewCardDropped,
                    ]}>
                      <Image
                        source={{ uri: frame.imageUrl }}
                        style={styles.framePreviewImage}
                        contentFit="cover"
                      />
                      <View style={styles.framePreviewInfo}>
                        <Text style={styles.framePreviewTime}>
                          {frame.timestamp.toFixed(1)}s
                        </Text>
                        {frame.frameScore !== undefined && (
                          <Text style={[
                            styles.framePreviewScore,
                            { color: getScoreColor(frame.frameScore) },
                          ]}>
                            {frame.frameScore}
                          </Text>
                        )}
                        {frame.dropped && (
                          <View style={styles.droppedBadge}>
                            <Text style={styles.droppedBadgeText}>已去除</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Showcase Carousel */}
            <View style={styles.showcaseCarousel}>
              <View style={styles.showcaseCard}>
                <View style={[styles.showcaseIconBg, { backgroundColor: SHOWCASE_CONTENT[carouselIndex].color + "20" }]}>
                  <MaterialIcons
                    name={SHOWCASE_CONTENT[carouselIndex].icon as any}
                    size={28}
                    color={SHOWCASE_CONTENT[carouselIndex].color}
                  />
                </View>
                <Text style={styles.showcaseTitle}>
                  {SHOWCASE_CONTENT[carouselIndex].title}
                </Text>
                <Text style={styles.showcaseDesc}>
                  {SHOWCASE_CONTENT[carouselIndex].desc}
                </Text>
                {/* Dots */}
                <View style={styles.showcaseDots}>
                  {SHOWCASE_CONTENT.map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.showcaseDot,
                        i === carouselIndex && styles.showcaseDotActive,
                      ]}
                    />
                  ))}
                </View>
              </View>
            </View>

            {/* Duration Rule Reminder */}
            <View style={styles.durationReminder}>
              <MaterialIcons name="info-outline" size={16} color="#64D2FF" />
              <Text style={styles.durationReminderText}>
                评分策略：≤5分钟抽取10帧去最低1帧取9帧均分，5-10分钟抽取12帧去最低2帧取10帧均分
              </Text>
            </View>
          </View>
        )}

        {/* ═══ Step 4: Result ═══ */}
        {step === "result" && submitResult && (
          <View style={styles.resultSection}>
            {/* Score Circle */}
            <View style={styles.scoreCircle}>
              <Text style={[styles.scoreNumber, { color: getScoreColor(submitResult.score || 0) }]}>
                {submitResult.score || "—"}
              </Text>
              <Text style={styles.scoreLabel}>爆款评分</Text>
            </View>

            {/* Reward */}
            {submitResult.creditsRewarded > 0 ? (
              <View style={styles.rewardResult}>
                <MaterialIcons name="celebration" size={32} color="#FFD60A" />
                <Text style={styles.rewardResultTitle}>
                  恭喜获得 {submitResult.creditsRewarded} Credits！
                </Text>
                <Text style={styles.rewardResultDesc}>
                  Credits 已自动发放到您的帐户
                </Text>
              </View>
            ) : (
              <View style={styles.noRewardResult}>
                <MaterialIcons name="sentiment-neutral" size={32} color="#999" />
                <Text style={styles.noRewardTitle}>未达奖励门槛</Text>
                <Text style={styles.noRewardDesc}>
                  80 分以上可获得 Credits 奖励，继续加油！
                </Text>
              </View>
            )}

            {/* Score Details */}
            {submitResult.scoreDetails?.dimensions && (
              <View style={styles.dimensionSection}>
                <Text style={styles.dimensionTitle}>评分维度</Text>
                {Object.entries(submitResult.scoreDetails.dimensions).map(([key, dim]: [string, any]) => {
                  const labels: Record<string, string> = {
                    playVolume: "播放量",
                    engagement: "交互率",
                    contentQuality: "内容质量",
                    distribution: "分发广度",
                  };
                  return (
                    <View key={key} style={styles.dimensionRow}>
                      <View style={styles.dimensionInfo}>
                        <Text style={styles.dimensionLabel}>{labels[key] || key}</Text>
                        <Text style={styles.dimensionWeight}>
                          权重 {((dim.weight || 0) * 100).toFixed(0)}%
                        </Text>
                      </View>
                      <View style={styles.dimensionBarBg}>
                        <View
                          style={[
                            styles.dimensionBar,
                            {
                              width: `${dim.score || 0}%`,
                              backgroundColor: getScoreColor(dim.score || 0),
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.dimensionScore, { color: getScoreColor(dim.score || 0) }]}>
                        {dim.score || 0}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Summary */}
            {submitResult.scoreDetails?.summary && (
              <View style={styles.summaryBox}>
                <Text style={styles.summaryTitle}>AI 评语</Text>
                <Text style={styles.summaryText}>{submitResult.scoreDetails.summary}</Text>
              </View>
            )}

            {/* Highlights */}
            {submitResult.scoreDetails?.highlights?.length > 0 && (
              <View style={styles.highlightsBox}>
                <Text style={styles.highlightsTitle}>亮点</Text>
                {submitResult.scoreDetails.highlights.map((h: string, i: number) => (
                  <View key={i} style={styles.highlightItem}>
                    <MaterialIcons name="star" size={16} color="#FFD60A" />
                    <Text style={styles.highlightText}>{h}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Improvements */}
            {submitResult.scoreDetails?.improvements?.length > 0 && (
              <View style={styles.improvementsBox}>
                <Text style={styles.improvementsTitle}>改进建议</Text>
                {submitResult.scoreDetails.improvements.map((imp: string, i: number) => (
                  <View key={i} style={styles.improvementItem}>
                    <MaterialIcons name="lightbulb" size={16} color="#FF9F0A" />
                    <Text style={styles.improvementText}>{imp}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Actions */}
            <View style={styles.resultActions}>
              <TouchableOpacity
                style={styles.resultActionBtn}
                onPress={() => {
                  setStep("upload");
                  setSubmitResult(null);
                  setVideoTitle("");
                  setVideoDescription("");
                  setPlatformEntries([]);
                  setLicenseAgreed(false);
                  setVideoBase64(null);
                  setThumbnailBase64(null);
                  setError("");
                }}
                activeOpacity={0.7}
              >
                <MaterialIcons name="add" size={20} color="#0A7EA4" />
                <Text style={styles.resultActionText}>提交另一个视频</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.resultActionBtn}
                onPress={() => router.push("/credits-dashboard")}
                activeOpacity={0.7}
              >
                <MaterialIcons name="account-balance-wallet" size={20} color="#0A7EA4" />
                <Text style={styles.resultActionText}>查看 Credits</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Pending Review Result */}
        {step === "result" && submitResult?.status === "pending_review" && (
          <View style={styles.pendingBox}>
            <MaterialIcons name="hourglass-top" size={48} color="#FFD60A" />
            <Text style={styles.pendingTitle}>视频已提交</Text>
            <Text style={styles.pendingDesc}>{submitResult.message}</Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* License Modal */}
      <Modal visible={showLicense} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>平台授权协议</Text>
              <TouchableOpacity onPress={() => setShowLicense(false)}>
                <MaterialIcons name="close" size={24} color="#F7F4EF" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <Text style={styles.modalText}>
                {licenseQuery.data?.content || "加载中..."}
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={styles.modalAgreeBtn}
              onPress={() => {
                setLicenseAgreed(true);
                setShowLicense(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.modalAgreeBtnText}>我已阅读并同意</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

// ═══════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════
const styles = StyleSheet.create({
  scrollContent: { paddingBottom: 40 },
  header: {
    paddingHorizontal: 20,
    paddingTop: isWeb ? 20 : 12,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  headerTitleWrap: { flex: 1 },
  headerTitle: { fontSize: 22, fontWeight: "800", color: "#F7F4EF" },
  headerSubtitle: { fontSize: 13, color: "#9B9691", marginTop: 2 },

  // Step Indicator
  stepRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 20, paddingVertical: 16, gap: 0,
  },
  stepItem: { alignItems: "center", gap: 4 },
  stepCircle: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1.5, borderColor: "#333",
    alignItems: "center", justifyContent: "center",
  },
  stepCircleActive: { backgroundColor: "#FF6B35", borderColor: "#FF6B35" },
  stepCircleDone: { backgroundColor: "#30D158", borderColor: "#30D158" },
  stepLine: { flex: 1, height: 2, backgroundColor: "#333", marginHorizontal: 4, marginBottom: 18 },
  stepLineActive: { backgroundColor: "#30D158" },
  stepLabel: { fontSize: 10, color: "#666" },
  stepLabelActive: { color: "#F7F4EF", fontWeight: "600" },

  // Error
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 20, marginBottom: 12, padding: 12,
    backgroundColor: "rgba(255,107,107,0.1)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,107,107,0.3)",
  },
  errorText: { flex: 1, fontSize: 13, color: "#FF6B6B" },

  // Section
  section: {
    marginHorizontal: 20, marginBottom: 20, padding: 20,
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#F7F4EF" },
  sectionDesc: { fontSize: 13, color: "#9B9691", marginBottom: 16, lineHeight: 20 },

  // Input
  inputGroup: { marginBottom: 16 },
  inputLabel: { fontSize: 14, fontWeight: "600", color: "#F7F4EF", marginBottom: 8 },
  inputLabelSmall: { fontSize: 12, fontWeight: "600", color: "#CCC", marginBottom: 6 },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 14,
    fontSize: 15, color: "#F7F4EF", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  inputSmall: {
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 10,
    fontSize: 13, color: "#F7F4EF", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  inputHint: { fontSize: 11, color: "#666", marginTop: 4 },

  // Upload
  uploadBox: {
    borderRadius: 12, borderWidth: 2, borderColor: "rgba(255,255,255,0.1)", borderStyle: "dashed",
    overflow: "hidden", height: 160,
  },
  uploadPreview: { width: "100%", height: "100%" },
  uploadPlaceholder: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  uploadPlaceholderText: { fontSize: 13, color: "#666" },
  uploadBoxSmall: {
    borderRadius: 10, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)", borderStyle: "dashed",
    overflow: "hidden", height: 100, width: 160,
  },
  uploadPreviewSmall: { width: "100%", height: "100%" },
  uploadPlaceholderSmall: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 4,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  uploadPlaceholderTextSmall: { fontSize: 11, color: "#666" },

  // Platform Chips
  platformChips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  platformChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)",
  },
  platformChipText: { fontSize: 13, fontWeight: "600", color: "#999" },

  // Platform Form
  platformForm: {
    marginBottom: 16, padding: 16, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.02)", borderLeftWidth: 3,
  },
  platformFormHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  platformFormTitle: { fontSize: 15, fontWeight: "700" },

  // Screenshot Upload
  screenshotUpload: {
    borderRadius: 10, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)", borderStyle: "dashed",
    overflow: "hidden", height: 120,
  },
  screenshotPreview: { width: "100%", height: "100%" },
  screenshotPlaceholder: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 4,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  screenshotPlaceholderText: { fontSize: 12, color: "#666" },
  screenshotHint: { fontSize: 10, color: "#555" },

  // License
  licenseBox: {
    padding: 14, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
    marginBottom: 16,
  },
  licensePreview: { fontSize: 12, color: "#9B9691", lineHeight: 20 },
  licenseReadMore: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 10 },
  licenseReadMoreText: { fontSize: 13, color: "#0A7EA4", fontWeight: "600" },

  // Checkbox
  checkboxRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#555",
    alignItems: "center", justifyContent: "center", marginTop: 1,
  },
  checkboxChecked: { backgroundColor: "#FF6B35", borderColor: "#FF6B35" },
  checkboxLabel: { flex: 1, fontSize: 13, color: "#CCC", lineHeight: 20 },

  // Buttons
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#FF6B35", borderRadius: 14, paddingVertical: 16, marginTop: 8,
  },
  primaryBtnText: { fontSize: 16, fontWeight: "700", color: "#FFF" },
  btnDisabled: { opacity: 0.5 },

  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: "#FF6B35", borderRadius: 16, paddingVertical: 18, marginHorizontal: 20, marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { fontSize: 17, fontWeight: "800", color: "#FFF" },

  // Reward Banner
  rewardBanner: {
    marginHorizontal: 20, marginBottom: 20, padding: 20,
    backgroundColor: "rgba(255,214,10,0.06)", borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(255,214,10,0.2)",
  },
  rewardBannerHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  rewardBannerTitle: { fontSize: 16, fontWeight: "700", color: "#FFD60A" },
  rewardGrid: { flexDirection: "row", gap: 12, marginBottom: 12 },
  rewardCard: {
    flex: 1, padding: 14, borderRadius: 12, alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1.5,
  },
  rewardScore: { fontSize: 14, fontWeight: "700", color: "#F7F4EF", marginBottom: 4 },
  rewardAmount: { fontSize: 18, fontWeight: "800" },
  rewardNote: { fontSize: 11, color: "#9B9691", textAlign: "center" },

  // Pending
  pendingBox: {
    alignItems: "center", padding: 40, marginHorizontal: 20, marginTop: 20,
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 16,
  },
  pendingTitle: { fontSize: 20, fontWeight: "700", color: "#F7F4EF", marginTop: 16 },
  pendingDesc: { fontSize: 14, color: "#9B9691", textAlign: "center", marginTop: 8, lineHeight: 22 },
  refreshBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 20,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
    backgroundColor: "rgba(10,126,164,0.15)",
  },
  refreshText: { fontSize: 14, color: "#0A7EA4", fontWeight: "600" },

  // Rejected
  rejectedBox: {
    flexDirection: "row", alignItems: "center", gap: 8, padding: 12, marginBottom: 16,
    backgroundColor: "rgba(255,107,107,0.1)", borderRadius: 10,
  },
  rejectedText: { flex: 1, fontSize: 13, color: "#FF6B6B" },

  // Reviewing
  reviewingBox: {
    alignItems: "center", padding: 40, marginHorizontal: 20, marginTop: 20,
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 16,
  },
  reviewingTitle: { fontSize: 18, fontWeight: "700", color: "#F7F4EF", marginTop: 20 },
  reviewingDesc: { fontSize: 13, color: "#9B9691", textAlign: "center", marginTop: 8 },
  reviewSteps: { marginTop: 24, gap: 12, alignSelf: "stretch", paddingHorizontal: 20 },
  reviewStepItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  reviewStepText: { fontSize: 13, color: "#CCC" },

  // Result
  resultSection: { marginHorizontal: 20, marginTop: 12 },
  scoreCircle: {
    alignSelf: "center", width: 140, height: 140, borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 3, borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center", marginBottom: 20,
  },
  scoreNumber: { fontSize: 48, fontWeight: "900" },
  scoreLabel: { fontSize: 12, color: "#9B9691", marginTop: 2 },

  // Reward Result
  rewardResult: {
    alignItems: "center", padding: 24, marginBottom: 20,
    backgroundColor: "rgba(255,214,10,0.08)", borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(255,214,10,0.2)",
  },
  rewardResultTitle: { fontSize: 20, fontWeight: "800", color: "#FFD60A", marginTop: 12 },
  rewardResultDesc: { fontSize: 14, color: "#9B9691", marginTop: 6 },

  noRewardResult: {
    alignItems: "center", padding: 24, marginBottom: 20,
    backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 16,
  },
  noRewardTitle: { fontSize: 18, fontWeight: "700", color: "#999", marginTop: 12 },
  noRewardDesc: { fontSize: 14, color: "#666", marginTop: 6 },

  // Dimensions
  dimensionSection: {
    padding: 20, marginBottom: 16, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  dimensionTitle: { fontSize: 16, fontWeight: "700", color: "#F7F4EF", marginBottom: 16 },
  dimensionRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  dimensionInfo: { width: 80 },
  dimensionLabel: { fontSize: 12, fontWeight: "600", color: "#CCC" },
  dimensionWeight: { fontSize: 10, color: "#666" },
  dimensionBarBg: {
    flex: 1, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden",
  },
  dimensionBar: { height: "100%", borderRadius: 4 },
  dimensionScore: { width: 30, textAlign: "right", fontSize: 14, fontWeight: "700" },

  // Summary
  summaryBox: {
    padding: 16, marginBottom: 16, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  summaryTitle: { fontSize: 14, fontWeight: "700", color: "#F7F4EF", marginBottom: 8 },
  summaryText: { fontSize: 13, color: "#9B9691", lineHeight: 22 },

  // Highlights
  highlightsBox: {
    padding: 16, marginBottom: 16, borderRadius: 12,
    backgroundColor: "rgba(255,214,10,0.05)",
  },
  highlightsTitle: { fontSize: 14, fontWeight: "700", color: "#FFD60A", marginBottom: 10 },
  highlightItem: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
  highlightText: { flex: 1, fontSize: 13, color: "#CCC", lineHeight: 20 },

  // Improvements
  improvementsBox: {
    padding: 16, marginBottom: 16, borderRadius: 12,
    backgroundColor: "rgba(255,159,10,0.05)",
  },
  improvementsTitle: { fontSize: 14, fontWeight: "700", color: "#FF9F0A", marginBottom: 10 },
  improvementItem: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
  improvementText: { flex: 1, fontSize: 13, color: "#CCC", lineHeight: 20 },

  // Result Actions
  resultActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  resultActionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 14, borderRadius: 12,
    backgroundColor: "rgba(10,126,164,0.12)", borderWidth: 1, borderColor: "rgba(10,126,164,0.3)",
  },
  resultActionText: { fontSize: 13, fontWeight: "600", color: "#0A7EA4" },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#1A1A1C", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: "80%", paddingBottom: Platform.OS === "ios" ? 34 : 20,
  },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 20, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#F7F4EF" },
  modalBody: { paddingHorizontal: 20, paddingVertical: 16 },
  modalText: { fontSize: 14, color: "#CCC", lineHeight: 24 },
  modalAgreeBtn: {
    marginHorizontal: 20, marginTop: 12, paddingVertical: 16, borderRadius: 14,
    backgroundColor: "#FF6B35", alignItems: "center",
  },
  modalAgreeBtnText: { fontSize: 16, fontWeight: "700", color: "#FFF" },

  // Analyzing Step
  analyzingContainer: { marginHorizontal: 20, marginTop: 12, gap: 20 },
  analyzingHeader: {
    alignItems: "center", padding: 30,
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  analyzingIconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  analyzingTitle: { fontSize: 20, fontWeight: "800", color: "#F7F4EF", marginBottom: 8 },
  analyzingDetail: { fontSize: 13, color: "#9B9691", textAlign: "center", lineHeight: 20 },

  // Progress Bar
  progressBarContainer: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 4,
  },
  progressBarBg: {
    flex: 1, height: 8, borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden",
  },
  progressBarFill: {
    height: "100%", borderRadius: 4,
    backgroundColor: "#FF6B35",
  },
  progressText: { fontSize: 14, fontWeight: "700", color: "#FF6B35", width: 40, textAlign: "right" },

  // Stages Timeline
  stagesTimeline: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "center",
    gap: 4, paddingHorizontal: 4,
  },
  stageTimelineItem: {
    flexDirection: "row", alignItems: "center", gap: 4,
  },
  stageTimelineDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "#333",
    alignItems: "center", justifyContent: "center",
  },
  stageTimelineDotDone: { backgroundColor: "#30D158", borderColor: "#30D158" },
  stageTimelineDotActive: { backgroundColor: "#FF6B35", borderColor: "#FF6B35" },
  stageTimelineLabel: { fontSize: 10, color: "#666", marginRight: 4 },
  stageTimelineLabelActive: { color: "#F7F4EF", fontWeight: "600" },
  stageTimelineLine: {
    width: 12, height: 2, backgroundColor: "#333",
  },
  stageTimelineLineDone: { backgroundColor: "#30D158" },

  // Frame Preview
  framePreviewSection: {
    padding: 16, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  framePreviewTitle: { fontSize: 14, fontWeight: "700", color: "#F7F4EF", marginBottom: 12 },
  framePreviewCard: {
    width: 100, borderRadius: 10, overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  framePreviewCardDropped: {
    opacity: 0.4, borderColor: "#FF6B6B",
  },
  framePreviewImage: { width: 100, height: 60 },
  framePreviewInfo: { padding: 6, alignItems: "center", gap: 2 },
  framePreviewTime: { fontSize: 10, color: "#9B9691" },
  framePreviewScore: { fontSize: 14, fontWeight: "800" },
  droppedBadge: {
    backgroundColor: "rgba(255,107,107,0.2)", borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  droppedBadgeText: { fontSize: 9, color: "#FF6B6B", fontWeight: "600" },

  // Showcase Carousel
  showcaseCarousel: { paddingHorizontal: 4 },
  showcaseCard: {
    padding: 24, borderRadius: 16, alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  showcaseIconBg: {
    width: 56, height: 56, borderRadius: 16,
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  showcaseTitle: { fontSize: 17, fontWeight: "700", color: "#F7F4EF", marginBottom: 8 },
  showcaseDesc: { fontSize: 13, color: "#9B9691", textAlign: "center", lineHeight: 20 },
  showcaseDots: {
    flexDirection: "row", gap: 6, marginTop: 16,
  },
  showcaseDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.15)",
  },
  showcaseDotActive: { backgroundColor: "#FF6B35", width: 18 },

  // Duration Reminder
  durationReminder: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 14, borderRadius: 12,
    backgroundColor: "rgba(100,210,255,0.06)", borderWidth: 1, borderColor: "rgba(100,210,255,0.15)",
  },
  durationReminderText: { flex: 1, fontSize: 12, color: "#64D2FF", lineHeight: 18 },
});
