import React, { useState, useRef, useCallback, useEffect } from "react";
import { Text, View, ScrollView, TouchableOpacity, StyleSheet, Platform, Dimensions, ActivityIndicator, TextInput, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { UsageQuotaBanner } from "@/components/usage-quota-banner";
import { StudentUpgradePrompt } from "@/components/student-upgrade-prompt";
import { TrialCountdownBanner } from "@/components/trial-countdown-banner";
import { QuotaExhaustedModal } from "@/components/quota-exhausted-modal";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWeb = Platform.OS === "web";
const isWide = isWeb && SCREEN_WIDTH > 768;

type AnalysisResult = {
  composition: number;
  color: number;
  lighting: number;
  impact: number;
  viralPotential: number;
  strengths: string[];
  improvements: string[];
  platforms: string[];
  summary: string;
};

type UploadStage = "idle" | "reading" | "uploading" | "analyzing" | "done" | "error";

export default function AnalyzeScreen() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();

  // ✅ All useState hooks MUST be called at the top level, before any early returns
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [estimatedTime, setEstimatedTime] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);
  const [quotaModalInfo, setQuotaModalInfo] = useState<{ isTrial?: boolean; planName?: string }>({});

  // ✅ All tRPC mutations and queries MUST be called at the top level
  const analyzeMutation = trpc.mvAnalysis.analyzeFrame.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    refetchOnMount: true,
  });

  // ✅ All useEffect hooks MUST be called at the top level
  useEffect(() => {
    // Wait for auth check to complete before redirecting
    if (!loading && !isAuthenticated) {
      console.log("[Analyze] Not authenticated, redirecting to login...");
      router.replace("/login");
    }
  }, [loading, isAuthenticated, router]);

  // Timer for elapsed time during upload/analysis
  useEffect(() => {
    if (uploadStage === "uploading" || uploadStage === "analyzing") {
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [uploadStage]);

  // ✅ All useCallback hooks MUST be called at the top level
  const handleSelectFile = useCallback(() => {
    if (isWeb && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  const handleFileChange = useCallback((e: any) => {
    const file = e.target?.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      setError("请上传图片或视频文件（JPG、PNG、MP4）");
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);
    setUploadStage("reading");
    setUploadProgress(0);
    setError(null);
    setAnalysis(null);

    // Estimate time based on file size (rough: 1MB = ~2s read + 5s upload + 10s analyze)
    const sizeMB = file.size / (1024 * 1024);
    const est = Math.max(10, Math.round(sizeMB * 2 + 15));
    setEstimatedTime(est);

    if (isImage) {
      // Simulate reading progress
      let readProgress = 0;
      const readInterval = setInterval(() => {
        readProgress += 15;
        if (readProgress >= 30) {
          clearInterval(readInterval);
          setUploadProgress(30);
        } else {
          setUploadProgress(readProgress);
        }
      }, 200);

      const reader = new FileReader();
      reader.onload = (ev) => {
        clearInterval(readInterval);
        const dataUrl = ev.target?.result as string;
        setSelectedImage(dataUrl);
        const base64 = dataUrl.split(",")[1];
        setImageBase64(base64);
        setUploadStage("idle");
        setUploadProgress(100);
      };
      reader.readAsDataURL(file);
    } else if (isVideo) {
      // Simulate reading progress for video
      let readProgress = 0;
      const readInterval = setInterval(() => {
        readProgress += 5;
        if (readProgress >= 25) {
          clearInterval(readInterval);
          setUploadProgress(25);
        } else {
          setUploadProgress(readProgress);
        }
      }, 300);

      const video = document.createElement("video");
      const url = URL.createObjectURL(file);
      video.src = url;
      video.muted = true;
      video.currentTime = 1;
      video.onloadeddata = () => {
        clearInterval(readInterval);
        setUploadProgress(40);
        video.currentTime = Math.min(1, video.duration / 4);
      };
      video.onseeked = () => {
        setUploadProgress(60);
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          setSelectedImage(dataUrl);
          const base64 = dataUrl.split(",")[1];
          setImageBase64(base64);
          setUploadStage("idle");
          setUploadProgress(100);
          // ✅ Release Blob URL AFTER canvas drawing is complete
          URL.revokeObjectURL(url);
        } else {
          // ✅ Release Blob URL if canvas context creation fails
          URL.revokeObjectURL(url);
        }
      };
      video.onerror = () => {
        clearInterval(readInterval);
        setError("视频读取失败，请尝试上传图片截屏");
        setUploadStage("error");
        URL.revokeObjectURL(url);
      };
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!imageBase64) return;
    
    // Check usage and payment status
    try {
      const accessCheck = await checkAccessMutation.mutateAsync({ featureType: "analysis" });
      
      if (!accessCheck.allowed) {
        setQuotaModalInfo({
          isTrial: (accessCheck as any).isTrial,
          planName: (accessCheck as any).planName,
        });
        setQuotaModalVisible(true);
        return;
      }
    } catch (error: any) {
      Alert.alert("错误", error.message || "无法检查使用权限");
      return;
    }
    
    setUploadStage("uploading");
    setUploadProgress(0);
    setError(null);
    startTimeRef.current = Date.now();
    setElapsedTime(0);

    // Estimate: upload ~5s, analysis ~10-15s
    const sizeMB = fileSize / (1024 * 1024);
    setEstimatedTime(Math.max(12, Math.round(sizeMB * 1.5 + 12)));

    // Simulate upload progress (0-50%)
    let prog = 0;
    const uploadInterval = setInterval(() => {
      prog += Math.random() * 8 + 2;
      if (prog >= 50) {
        clearInterval(uploadInterval);
        setUploadProgress(50);
      } else {
        setUploadProgress(Math.round(prog));
      }
    }, 400);

    try {
      // Start the actual mutation
      const resultPromise = analyzeMutation.mutateAsync({
        imageBase64,
        mimeType: "image/jpeg",
        context: context || undefined,
      });

      // When upload is "done", switch to analyzing stage
      setTimeout(() => {
        clearInterval(uploadInterval);
        setUploadProgress(50);
        setUploadStage("analyzing");

        // Simulate analysis progress (50-95%)
        let analysisProg = 50;
        const analysisInterval = setInterval(() => {
          analysisProg += Math.random() * 5 + 1;
          if (analysisProg >= 95) {
            clearInterval(analysisInterval);
            setUploadProgress(95);
          } else {
            setUploadProgress(Math.round(analysisProg));
          }
        }, 600);

        resultPromise.then((result) => {
          clearInterval(analysisInterval);
          setUploadProgress(100);
          setUploadStage("done");
          setAnalysis(result.analysis);
          // ✅ Refetch usage stats after successful analysis
          usageStatsQuery.refetch();
        }).catch((err: any) => {
          clearInterval(analysisInterval);
          setError(err.message || "分析失败，请稍后再试");
          setUploadStage("error");
        });
      }, 2500);
    } catch (err: any) {
      clearInterval(uploadInterval);
      setError(err.message || "上传失败，请稍后再试");
      setUploadStage("error");
    }
  }, [imageBase64, context, analyzeMutation, fileSize, usageStatsQuery]);

  const handleReset = useCallback(() => {
    setSelectedImage(null);
    setImageBase64(null);
    setAnalysis(null);
    setError(null);
    setContext("");
    setUploadStage("idle");
    setUploadProgress(0);
    setElapsedTime(0);
    setFileName("");
    setFileSize(0);
  }, []);

  // ✅ Utility functions (not hooks, can be anywhere)
  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}秒`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}分${s}秒`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "#30D158";
    if (score >= 60) return "#FFD60A";
    if (score >= 40) return "#FF9F0A";
    return "#FF453A";
  };

  const getStageLabel = () => {
    switch (uploadStage) {
      case "reading": return "读取文件中...";
      case "uploading": return "上传画面中...";
      case "analyzing": return "AI 智能分析中...";
      case "done": return "分析完成！";
      case "error": return "处理失败";
      default: return "";
    }
  };

  const isProcessing = uploadStage === "uploading" || uploadStage === "analyzing";

  // Show loading while checking authentication
  if (loading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator size="large" color="#0a7ea4" />
        <Text className="mt-4 text-muted">检查登录状态...</Text>
      </ScreenContainer>
    );
  }

  // Redirect to login if not authenticated (will happen in useEffect)
  if (!isAuthenticated) {
    return null;
  }
  const remainingTime = Math.max(0, estimatedTime - elapsedTime);

  return (
    <ScreenContainer edges={isWeb ? [] : ["top", "left", "right"]} containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Usage Quota Banner */}
        <UsageQuotaBanner
          featureType="analysis"
          currentCount={usageStatsQuery.data?.features.analysis.currentCount ?? 0}
          freeLimit={usageStatsQuery.data?.features.analysis.limit ?? 2}
          loading={usageStatsQuery.isLoading}
        />

        {/* Trial Countdown Banner */}
        <TrialCountdownBanner
          isTrial={(usageStatsQuery.data as any)?.isTrial}
          trialEndDate={(usageStatsQuery.data as any)?.trialEndDate}
          trialExpired={(usageStatsQuery.data as any)?.trialExpired}
        />

        {/* Student Upgrade Prompt */}
        {usageStatsQuery.data?.studentPlan && (
          <StudentUpgradePrompt
            studentPlan={usageStatsQuery.data.studentPlan}
            usageData={usageStatsQuery.data.features}
            isTrial={(usageStatsQuery.data as any).isTrial}
            trialEndDate={(usageStatsQuery.data as any).trialEndDate}
          />
        )}

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <MaterialIcons name="arrow-back" size={24} color="#F7F4EF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>视频 PK 评分</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.content}>
          {/* Upload Section */}
          {!selectedImage ? (
            <View style={styles.uploadSection}>
              <View style={styles.uploadBox}>
                <TouchableOpacity style={styles.uploadArea} onPress={handleSelectFile} activeOpacity={0.8}>
                  <View style={styles.uploadIconWrap}>
                    <MaterialIcons name="cloud-upload" size={48} color="#64D2FF" />
                  </View>
                  <Text style={styles.uploadTitle}>上传视频画面</Text>
                  <Text style={styles.uploadDesc}>
                    支持图片（JPG、PNG）或视频（MP4）{"\n"}
                    视频将自动截取画面进行分析
                  </Text>
                  <View style={styles.uploadBtnInner}>
                    <MaterialIcons name="add" size={20} color="#FFFFFF" />
                    <Text style={styles.uploadBtnText}>选择文件</Text>
                  </View>
                </TouchableOpacity>
                {isWeb && (
                  <input
                    ref={fileInputRef as any}
                    type="file"
                    accept="image/*,video/*"
                    onChange={handleFileChange}
                    style={{ display: "none" } as any}
                  />
                )}
              </View>

              {/* Reading progress */}
              {uploadStage === "reading" && (
                <View style={styles.progressSection}>
                  <View style={styles.progressHeader}>
                    <Text style={styles.progressLabel}>
                      <MaterialIcons name="insert-drive-file" size={14} color="#64D2FF" /> {fileName}
                    </Text>
                    <Text style={styles.progressPercent}>{uploadProgress}%</Text>
                  </View>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${uploadProgress}%` as any }]} />
                  </View>
                  <Text style={styles.progressSubtext}>读取文件中... {formatFileSize(fileSize)}</Text>
                </View>
              )}

              <View style={styles.tipsBox}>
                <Text style={styles.tipsTitle}>
                  <MaterialIcons name="lightbulb" size={16} color="#FFD60A" /> 分析提示
                </Text>
                <Text style={styles.tipsText}>{"\u2022"} 选择视频中最具代表性的画面</Text>
                <Text style={styles.tipsText}>{"\u2022"} 高分辨率图片能获得更准确的分析</Text>
                <Text style={styles.tipsText}>{"\u2022"} AI 将从构图、色彩、光影、冲击力等维度评分</Text>
                <Text style={styles.tipsText}>{"\u2022"} 分析结果包含爆款潜力评估和平台推荐</Text>
              </View>
            </View>
          ) : (
            <View style={styles.analysisSection}>
              {/* Preview */}
              <View style={styles.previewBox}>
                <Image source={{ uri: selectedImage }} style={styles.previewImage} contentFit="contain" />
                {!isProcessing && uploadStage !== "done" && (
                  <View style={styles.previewActions}>
                    <View style={styles.fileInfoRow}>
                      <MaterialIcons name="insert-drive-file" size={14} color="#9B9691" />
                      <Text style={styles.fileInfoText}>{fileName} ({formatFileSize(fileSize)})</Text>
                    </View>
                    <TouchableOpacity style={styles.resetBtn} onPress={handleReset} activeOpacity={0.7}>
                      <MaterialIcons name="refresh" size={18} color="#F7F4EF" />
                      <Text style={styles.resetBtnText}>重新选择</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Upload/Analysis Progress Bar */}
              {isProcessing && (
                <View style={styles.progressSection}>
                  <View style={styles.progressHeader}>
                    <Text style={styles.progressLabel}>
                      <MaterialIcons
                        name={uploadStage === "uploading" ? "cloud-upload" : "auto-awesome"}
                        size={16}
                        color={uploadStage === "uploading" ? "#64D2FF" : "#C77DBA"}
                      />
                      {" "}{getStageLabel()}
                    </Text>
                    <Text style={styles.progressPercent}>{uploadProgress}%</Text>
                  </View>

                  {/* Progress Bar */}
                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${uploadProgress}%` as any,
                          backgroundColor: uploadStage === "uploading" ? "#64D2FF" : "#C77DBA",
                        },
                      ]}
                    />
                  </View>

                  {/* Time Info */}
                  <View style={styles.timeRow}>
                    <Text style={styles.timeText}>
                      <MaterialIcons name="timer" size={13} color="#9B9691" /> 已用时间：{formatTime(elapsedTime)}
                    </Text>
                    <Text style={styles.timeText}>
                      预估剩余：{remainingTime > 0 ? `~${formatTime(remainingTime)}` : "即将完成"}
                    </Text>
                  </View>

                  {/* Stage Steps */}
                  <View style={styles.stageSteps}>
                    <View style={styles.stageStep}>
                      <View style={[styles.stepDot, uploadProgress > 0 && styles.stepDotActive]} />
                      <Text style={[styles.stepText, uploadProgress > 0 && styles.stepTextActive]}>上传画面</Text>
                    </View>
                    <View style={[styles.stepLine, uploadProgress >= 50 && styles.stepLineActive]} />
                    <View style={styles.stageStep}>
                      <View style={[styles.stepDot, uploadProgress >= 50 && styles.stepDotActive]} />
                      <Text style={[styles.stepText, uploadProgress >= 50 && styles.stepTextActive]}>AI 分析</Text>
                    </View>
                    <View style={[styles.stepLine, uploadProgress >= 95 && styles.stepLineActive]} />
                    <View style={styles.stageStep}>
                      <View style={[styles.stepDot, uploadProgress >= 100 && styles.stepDotActive]} />
                      <Text style={[styles.stepText, uploadProgress >= 100 && styles.stepTextActive]}>生成报告</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Context Input - only show before analysis starts */}
              {!analysis && !isProcessing && uploadStage !== "done" && (
                <View style={styles.contextBox}>
                  <Text style={styles.contextLabel}>补充说明（可选）</Text>
                  <TextInput
                    style={styles.contextInput}
                    placeholder="例如：这是副歌高潮部分的画面..."
                    placeholderTextColor="#6B6762"
                    value={context}
                    onChangeText={setContext}
                    multiline
                  />
                  <TouchableOpacity
                    style={styles.analyzeBtn}
                    onPress={handleAnalyze}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="auto-awesome" size={20} color="#FFFFFF" />
                    <Text style={styles.analyzeBtnText}>开始 AI 分析</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Error */}
              {error && (
                <View style={styles.errorBox}>
                  <MaterialIcons name="error-outline" size={20} color="#FF453A" />
                  <Text style={styles.errorText}>{error}</Text>
                  <TouchableOpacity onPress={handleReset} style={styles.retryBtn} activeOpacity={0.7}>
                    <Text style={styles.retryBtnText}>重试</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Analysis Results */}
              {analysis && (
                <View style={styles.resultsBox}>
                  <View style={styles.resultsTitleRow}>
                    <Text style={styles.resultsTitle}>
                      <MaterialIcons name="analytics" size={20} color="#64D2FF" /> AI 分析报告
                    </Text>
                    <View style={styles.completeBadge}>
                      <MaterialIcons name="check-circle" size={14} color="#30D158" />
                      <Text style={styles.completeBadgeText}>分析完成</Text>
                    </View>
                  </View>

                  {/* Score Grid */}
                  <View style={styles.scoreGrid}>
                    {[
                      { label: "构图", score: analysis.composition, icon: "grid-on" as const },
                      { label: "色彩", score: analysis.color, icon: "palette" as const },
                      { label: "光影", score: analysis.lighting, icon: "wb-sunny" as const },
                      { label: "冲击力", score: analysis.impact, icon: "bolt" as const },
                      { label: "爆款潜力", score: analysis.viralPotential, icon: "local-fire-department" as const },
                    ].map((item, i) => (
                      <View key={i} style={styles.scoreItem}>
                        <MaterialIcons name={item.icon} size={20} color={getScoreColor(item.score)} />
                        <Text style={[styles.scoreValue, { color: getScoreColor(item.score) }]}>{item.score}</Text>
                        <Text style={styles.scoreLabel}>{item.label}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Summary */}
                  {analysis.summary && (
                    <View style={styles.summaryBox}>
                      <Text style={styles.summaryTitle}>总结</Text>
                      <Text style={styles.summaryText}>{analysis.summary}</Text>
                    </View>
                  )}

                  {/* Strengths */}
                  <View style={styles.listBox}>
                    <Text style={[styles.listTitle, { color: "#30D158" }]}>
                      <MaterialIcons name="check-circle" size={16} color="#30D158" /> 优点
                    </Text>
                    {analysis.strengths.map((s: string, i: number) => (
                      <Text key={i} style={styles.listItem}>{"\u2022"} {s}</Text>
                    ))}
                  </View>

                  {/* Improvements */}
                  <View style={styles.listBox}>
                    <Text style={[styles.listTitle, { color: "#FFD60A" }]}>
                      <MaterialIcons name="tips-and-updates" size={16} color="#FFD60A" /> 改进建议
                    </Text>
                    {analysis.improvements.map((s: string, i: number) => (
                      <Text key={i} style={styles.listItem}>{"\u2022"} {s}</Text>
                    ))}
                  </View>

                  {/* Platforms */}
                  <View style={styles.platformsBox}>
                    <Text style={styles.listTitle}>
                      <MaterialIcons name="language" size={16} color="#C77DBA" /> 推荐平台
                    </Text>
                    <View style={styles.platformTags}>
                      {analysis.platforms.map((p: string, i: number) => (
                        <View key={i} style={styles.platformTag}>
                          <Text style={styles.platformTagText}>{p}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* Re-analyze */}
                  <TouchableOpacity style={styles.reanalyzeBtn} onPress={handleReset} activeOpacity={0.8}>
                    <MaterialIcons name="refresh" size={18} color="#64D2FF" />
                    <Text style={styles.reanalyzeBtnText}>分析另一张画面</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Quota Exhausted Modal */}
      <QuotaExhaustedModal
        visible={quotaModalVisible}
        featureName="视频 PK 评分"
        isTrial={quotaModalInfo.isTrial}
        planName={quotaModalInfo.planName}
        onClose={() => setQuotaModalVisible(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, backgroundColor: "#080C14" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: "rgba(100,210,255,0.10)",
    backgroundColor: "rgba(10,14,22,0.95)",
    ...(isWeb ? { position: "sticky" as any, top: 0, zIndex: 100, backdropFilter: "blur(24px)" } as any : {}),
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#F7F4EF" },
  content: { maxWidth: 700, alignSelf: "center", width: "100%" as any, padding: 24 },

  uploadSection: { gap: 20 },
  uploadBox: {
    borderRadius: 16, borderWidth: 2, borderStyle: "dashed",
    borderColor: "rgba(100,210,255,0.3)", backgroundColor: "rgba(100,210,255,0.04)",
    overflow: "hidden",
  },
  uploadArea: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 24 },
  uploadIconWrap: {
    width: 80, height: 80, borderRadius: 20,
    backgroundColor: "rgba(100,210,255,0.12)", alignItems: "center", justifyContent: "center",
    marginBottom: 20,
  },
  uploadTitle: { fontSize: 22, fontWeight: "700", color: "#F7F4EF", marginBottom: 8 },
  uploadDesc: { fontSize: 15, color: "#9B9691", textAlign: "center", lineHeight: 22, marginBottom: 24 },
  uploadBtnInner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24,
    backgroundColor: "#64D2FF",
  },
  uploadBtnText: { fontSize: 16, fontWeight: "600", color: "#FFFFFF" },

  // Progress Section
  progressSection: {
    backgroundColor: "#161618", borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: "rgba(100,210,255,0.15)",
  },
  progressHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
  },
  progressLabel: { fontSize: 15, fontWeight: "600", color: "#F7F4EF" },
  progressPercent: { fontSize: 20, fontWeight: "800", color: "#64D2FF" },
  progressBarBg: {
    height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden",
  },
  progressBarFill: {
    height: 8, borderRadius: 4, backgroundColor: "#64D2FF",
  },
  progressSubtext: { fontSize: 13, color: "#9B9691", marginTop: 8 },
  timeRow: {
    flexDirection: "row", justifyContent: "space-between", marginTop: 12,
  },
  timeText: { fontSize: 13, color: "#9B9691" },

  // Stage Steps
  stageSteps: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    marginTop: 20, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)",
  },
  stageStep: { alignItems: "center", gap: 6 },
  stepDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  stepDotActive: { backgroundColor: "#64D2FF" },
  stepText: { fontSize: 12, color: "#6B6762", fontWeight: "500" },
  stepTextActive: { color: "#F7F4EF" },
  stepLine: {
    width: 40, height: 2, backgroundColor: "rgba(255,255,255,0.08)", marginHorizontal: 8,
  },
  stepLineActive: { backgroundColor: "#64D2FF" },

  tipsBox: {
    backgroundColor: "#161618", borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: "rgba(255,214,10,0.12)",
  },
  tipsTitle: { fontSize: 15, fontWeight: "700", color: "#FFD60A", marginBottom: 12 },
  tipsText: { fontSize: 14, color: "#9B9691", lineHeight: 22 },

  analysisSection: { gap: 20 },
  previewBox: {
    borderRadius: 16, overflow: "hidden", backgroundColor: "#161618",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  previewImage: { width: "100%" as any, aspectRatio: 16 / 9 },
  previewActions: {
    padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  fileInfoRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  fileInfoText: { fontSize: 13, color: "#9B9691" },
  resetBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  resetBtnText: { fontSize: 14, fontWeight: "500", color: "#F7F4EF" },

  contextBox: {
    backgroundColor: "#161618", borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  contextLabel: { fontSize: 14, fontWeight: "600", color: "#9B9691", marginBottom: 10 },
  contextInput: {
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: "#F7F4EF",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", minHeight: 60,
    marginBottom: 16,
  },
  analyzeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 28,
    backgroundColor: "#FF6B6B",
  },
  analyzeBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,69,58,0.1)", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(255,69,58,0.2)",
  },
  errorText: { fontSize: 14, color: "#FF453A", flex: 1 },
  retryBtn: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16,
    backgroundColor: "rgba(255,69,58,0.2)",
  },
  retryBtnText: { fontSize: 13, fontWeight: "600", color: "#FF453A" },

  resultsBox: {
    backgroundColor: "#161618", borderRadius: 16, padding: 24,
    borderWidth: 1, borderColor: "rgba(100,210,255,0.12)", gap: 20,
  },
  resultsTitleRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  resultsTitle: { fontSize: 20, fontWeight: "700", color: "#F7F4EF" },
  completeBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    backgroundColor: "rgba(48,209,88,0.1)",
  },
  completeBadgeText: { fontSize: 12, fontWeight: "600", color: "#30D158" },

  scoreGrid: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12,
  },
  scoreItem: {
    width: isWide ? ("18%" as any) : ("30%" as any),
    alignItems: "center", gap: 4,
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, paddingVertical: 16,
  },
  scoreValue: { fontSize: 28, fontWeight: "800" },
  scoreLabel: { fontSize: 13, color: "#9B9691", fontWeight: "500" },

  summaryBox: {
    backgroundColor: "rgba(100,210,255,0.06)", borderRadius: 12, padding: 16,
    borderLeftWidth: 3, borderLeftColor: "#64D2FF",
  },
  summaryTitle: { fontSize: 15, fontWeight: "700", color: "#64D2FF", marginBottom: 8 },
  summaryText: { fontSize: 15, color: "#F7F4EF", lineHeight: 24 },

  listBox: { gap: 6 },
  listTitle: { fontSize: 15, fontWeight: "700", color: "#F7F4EF", marginBottom: 4 },
  listItem: { fontSize: 14, color: "#9B9691", lineHeight: 22, paddingLeft: 4 },

  platformsBox: { gap: 10 },
  platformTags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  platformTag: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16,
    backgroundColor: "rgba(199,125,186,0.15)",
  },
  platformTagText: { fontSize: 14, fontWeight: "600", color: "#C77DBA" },

  reanalyzeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 12, borderRadius: 24,
    borderWidth: 1.5, borderColor: "rgba(100,210,255,0.3)",
    backgroundColor: "rgba(100,210,255,0.06)",
  },
  reanalyzeBtnText: { fontSize: 15, fontWeight: "600", color: "#64D2FF" },
});
