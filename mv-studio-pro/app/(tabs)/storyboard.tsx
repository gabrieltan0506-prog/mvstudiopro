import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Dimensions, Platform } from "react-native";
import { useState, useEffect, useCallback } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import * as Linking from "expo-linking";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { UsageQuotaBanner } from "@/components/usage-quota-banner";
import { StudentUpgradePrompt } from "@/components/student-upgrade-prompt";
import { TrialCountdownBanner } from "@/components/trial-countdown-banner";
import { QuotaExhaustedModal } from "@/components/quota-exhausted-modal";
import { NbpEngineSelector, type EngineOption } from "@/components/nbp-engine-selector";

interface StoryboardScene {
  sceneNumber: number;
  timestamp: string;
  duration: string;
  description: string;
  cameraMovement: string;
  mood: string;
  visualElements: string[];
  transition?: string;
  previewImageUrl?: string | null;
}

interface StoryboardResult {
  title: string;
  musicInfo: {
    bpm: number;
    emotion: string;
    style: string;
    key: string;
  };
  scenes: StoryboardScene[];
  summary: string;
}

// ─── 字数限制常量 ───────────────────────────────────
// AI 智能生成脚本：1000 字免费
const AI_GENERATE_MAX_CHARS = 1000;
// 用户自有脚本（直接输入）：2000 字免费
const OWN_SCRIPT_MAX_CHARS = 2000;
const MAX_SCENES = 10;

const { width: SCREEN_WIDTH } = Dimensions.get("window");
// 图片宽度 = 屏幕宽度 - 左右 padding (24*2) - 卡片 padding (20*2)
const IMAGE_WIDTH = Math.min(SCREEN_WIDTH - 88, 600);
// 16:9 比例
const IMAGE_HEIGHT = Math.round(IMAGE_WIDTH * 9 / 16);

export default function StoryboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const { isAuthenticated, loading, user } = useAuth();

  const [lyricsText, setLyricsText] = useState("");
  const [sceneCount, setSceneCount] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [storyboard, setStoryboard] = useState<StoryboardResult | null>(null);
  const [editingSceneId, setEditingSceneId] = useState<number | null>(null);
  const [editedScene, setEditedScene] = useState<StoryboardScene | null>(null);
  const [imageEngine, setImageEngine] = useState<EngineOption>("forge");
  const [showInspirationModal, setShowInspirationModal] = useState(false);
  const [inspirationInput, setInspirationInput] = useState("");
  const [isGeneratingInspiration, setIsGeneratingInspiration] = useState(false);
  const [upgradePromptDismissed, setUpgradePromptDismissed] = useState(false);
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);
  const [quotaModalInfo, setQuotaModalInfo] = useState<{ isTrial?: boolean; planName?: string }>({});
  // 追踪脚本来源：是 AI 生成的还是用户自己输入的
  const [scriptSource, setScriptSource] = useState<"own" | "ai">("own");
  const [exportMenuVisible, setExportMenuVisible] = useState(false);

  const generateStoryboard = trpc.storyboard.generate.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const exportPDFMutation = trpc.storyboard.exportPDF.useMutation();
  const inspirationMutation = trpc.storyboard.generateInspiration.useMutation();
  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    refetchOnMount: true,
  });
  const subQuery = trpc.stripe.getSubscription.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
  });
  const userPlan = (subQuery.data?.plan || "free") as string;
  const userCredits = subQuery.data?.credits?.balance ?? 0;

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [loading, isAuthenticated, router]);

  if (loading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="mt-4 text-muted">检查登录状态...</Text>
      </ScreenContainer>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  // ─── 字数限制逻辑 ───────────────────────────────────
  const charCount = lyricsText.length;
  const currentMaxChars = scriptSource === "ai" ? AI_GENERATE_MAX_CHARS : OWN_SCRIPT_MAX_CHARS;
  const isOverCharLimit = charCount > currentMaxChars;
  const isOverSceneLimit = sceneCount > MAX_SCENES;

  const handleGenerate = async () => {
    if (!lyricsText.trim()) {
      Alert.alert("提示", "请输入歌词或文本内容");
      return;
    }

    if (isOverCharLimit) {
      Alert.alert(
        "超出免费额度",
        `您的文本为 ${charCount} 字，超出${scriptSource === "ai" ? "AI 生成" : "自有脚本"}的免费额度 ${currentMaxChars} 字。\n\n超出部分需消耗 Credits。`,
        [
          { text: "取消", style: "cancel" },
          {
            text: "查看 Credits",
            onPress: () => router.push("/pricing" as any),
          },
        ]
      );
      return;
    }

    // Check usage and payment status
    try {
      const accessCheck = await checkAccessMutation.mutateAsync({ featureType: "storyboard" });
      
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

    setIsGenerating(true);
    try {
      const result = await generateStoryboard.mutateAsync({
        lyrics: lyricsText,
        sceneCount: sceneCount,
      });

      if (result.success && result.storyboard) {
        setStoryboard(result.storyboard);
        usageStatsQuery.refetch();
        Alert.alert("成功", result.message || "分镜脚本已生成！");
      }
    } catch (error) {
      console.error("Error generating storyboard:", error);
      Alert.alert("错误", "生成分镜脚本失败，请重试");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setLyricsText("");
    setSceneCount(5);
    setStoryboard(null);
    setScriptSource("own");
  };

  // Web 端直接触发下载（避免 popup blocker 和 Alert 不显示问题）
  const triggerDownload = (url: string, filename: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      Linking.openURL(url);
    }
  };

  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const handleExportPDF = async () => {
    if (!storyboard) {
      if (Platform.OS === 'web') {
        setExportStatus('请先生成分镜脚本');
        setTimeout(() => setExportStatus(null), 3000);
      } else {
        Alert.alert('提示', '请先生成分镜脚本');
      }
      return;
    }

    try {
      setExportStatus('正在生成 PDF...');
      const result = await exportPDFMutation.mutateAsync({ storyboard, format: "pdf" });
      
      if (result.success && result.pdfUrl) {
        setExportStatus('PDF 已生成，正在下载...');
        triggerDownload(result.pdfUrl, `${storyboard.title || 'storyboard'}.pdf`);
        setTimeout(() => setExportStatus(null), 3000);
      } else {
        setExportStatus(result.message || 'PDF 生成失败，请重试');
        setTimeout(() => setExportStatus(null), 5000);
      }
    } catch (error: any) {
      console.error('[Export PDF Error]', error);
      setExportStatus(`导出失败: ${error.message || '未知错误'}`);
      setTimeout(() => setExportStatus(null), 5000);
    }
  };

  const handleExportWord = async () => {
    if (!storyboard) {
      if (Platform.OS === 'web') {
        setExportStatus('请先生成分镜脚本');
        setTimeout(() => setExportStatus(null), 3000);
      } else {
        Alert.alert('提示', '请先生成分镜脚本');
      }
      return;
    }

    try {
      setExportStatus('正在生成 Word 文档...');
      const result = await exportPDFMutation.mutateAsync({ storyboard, format: "word" });
      
      if (result.success && result.pdfUrl) {
        setExportStatus('Word 文档已生成，正在下载...');
        triggerDownload(result.pdfUrl, `${storyboard.title || 'storyboard'}.doc`);
        setTimeout(() => setExportStatus(null), 3000);
      } else {
        setExportStatus(result.message || 'Word 文档生成失败，请重试');
        setTimeout(() => setExportStatus(null), 5000);
      }
    } catch (error: any) {
      console.error('[Export Word Error]', error);
      setExportStatus(`导出失败: ${error.message || '未知错误'}`);
      setTimeout(() => setExportStatus(null), 5000);
    }
  };

  const handleEditScene = (scene: StoryboardScene) => {
    setEditingSceneId(scene.sceneNumber);
    setEditedScene({ ...scene });
  };

  const handleSaveEdit = () => {
    if (!editedScene || !storyboard) return;

    const updatedScenes = storyboard.scenes.map((scene) =>
      scene.sceneNumber === editedScene.sceneNumber ? editedScene : scene
    );

    setStoryboard({
      ...storyboard,
      scenes: updatedScenes,
    });

    setEditingSceneId(null);
    setEditedScene(null);
    Alert.alert("成功", "场景已更新！");
  };

  const handleCancelEdit = () => {
    setEditingSceneId(null);
    setEditedScene(null);
  };

  const handleUpdateField = (field: keyof StoryboardScene, value: any) => {
    if (!editedScene) return;
    setEditedScene({
      ...editedScene,
      [field]: value,
    });
  };

  return (
    <ScreenContainer>
      <ScrollView className="flex-1 bg-background">
        {/* Usage Quota Banner */}
        <UsageQuotaBanner
          featureType="storyboard"
          currentCount={usageStatsQuery.data?.features.storyboard.currentCount ?? 0}
          freeLimit={usageStatsQuery.data?.features.storyboard.limit ?? 1}
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
            visible={!upgradePromptDismissed}
            onDismiss={() => setUpgradePromptDismissed(true)}
          />
        )}

        {/* Header */}
        <View className="px-6 pt-6 pb-4">
          <Text className="text-3xl font-bold text-foreground mb-2">智能脚本与分镜生成</Text>
          <Text className="text-base text-muted">输入歌词或文本，AI 自动生成专业视频分镜脚本</Text>
          <View className="mt-3 bg-success/10 px-4 py-2.5 rounded-lg">
            <Text className="text-success font-semibold text-sm">
              🎁 AI 智能生成：{AI_GENERATE_MAX_CHARS} 字内免费 · 自有脚本：{OWN_SCRIPT_MAX_CHARS} 字内免费
            </Text>
          </View>
        </View>

        {/* Input Section */}
        {!storyboard && (
          <View className="px-6 py-4">
            <View className="bg-surface rounded-2xl p-6 border border-border">
              {/* AI Inspiration Assistant */}
              {!showInspirationModal ? (
                <TouchableOpacity
                  onPress={() => setShowInspirationModal(true)}
                  className="mb-4 rounded-xl p-4 flex-row items-center"
                  style={{ backgroundColor: colors.primary + '15', borderWidth: 1, borderColor: colors.primary + '30' }}
                >
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: colors.primary + '20' }}
                  >
                    <MaterialIcons name="auto-awesome" size={22} color={colors.primary} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-foreground font-semibold text-base">创作没灵感？</Text>
                    <Text className="text-muted text-sm mt-0.5">给我三句话，我帮你生成完整脚本（消耗 Credits）</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={colors.muted} />
                </TouchableOpacity>
              ) : (
                <View className="mb-4 rounded-xl p-4" style={{ backgroundColor: colors.primary + '10', borderWidth: 1, borderColor: colors.primary + '30' }}>
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-row items-center">
                      <MaterialIcons name="auto-awesome" size={20} color={colors.primary} />
                      <Text className="text-foreground font-semibold ml-2">AI 灵感助手</Text>
                      <View className="ml-2 bg-warning/15 px-2 py-0.5 rounded-full">
                        <Text className="text-warning text-xs font-medium">消耗 Credits</Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => { setShowInspirationModal(false); setInspirationInput(""); }}>
                      <MaterialIcons name="close" size={20} color={colors.muted} />
                    </TouchableOpacity>
                  </View>
                  <Text className="text-muted text-sm mb-1">接入 Gemini 大模型，根据描述生成专业脚本</Text>
                  <Text className="text-muted text-sm mb-3">例如：「一对情侣在雨天的东京重逢，从陈旧的咖啡厅开始」</Text>
                  <TextInput
                    value={inspirationInput}
                    onChangeText={setInspirationInput}
                    placeholder="用 1-3 句话描述你的灵感..."
                    placeholderTextColor={colors.muted}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    maxLength={200}
                    className="bg-background rounded-lg p-3 text-foreground mb-3"
                    style={{ minHeight: 80, borderWidth: 1, borderColor: colors.border, fontSize: 15, lineHeight: 22 }}
                    returnKeyType="done"
                  />
                  <View className="flex-row items-center justify-between">
                    <Text className="text-muted text-xs">{inspirationInput.length}/200</Text>
                    <TouchableOpacity
                      onPress={async () => {
                        if (!inspirationInput.trim()) {
                          Alert.alert("提示", "请输入灵感描述");
                          return;
                        }
                        setIsGeneratingInspiration(true);
                        try {
                          const result = await inspirationMutation.mutateAsync({ briefDescription: inspirationInput.trim() });
                          if (result.success && result.text) {
                            setLyricsText(result.text);
                            setScriptSource("ai"); // 标记为 AI 生成
                            setShowInspirationModal(false);
                            setInspirationInput("");
                            Alert.alert("成功", "灵感脚本已生成，您可以继续编辑或直接生成分镜");
                          }
                        } catch (error: any) {
                          Alert.alert("错误", error.message || "生成失败，请重试");
                        } finally {
                          setIsGeneratingInspiration(false);
                        }
                      }}
                      disabled={!inspirationInput.trim() || isGeneratingInspiration}
                      className="rounded-lg px-5 py-2.5 flex-row items-center"
                      style={{
                        backgroundColor: !inspirationInput.trim() || isGeneratingInspiration ? colors.muted + '40' : colors.primary,
                      }}
                    >
                      {isGeneratingInspiration ? (
                        <>
                          <ActivityIndicator color="#fff" size="small" />
                          <Text className="text-white font-semibold ml-2">生成中...</Text>
                        </>
                      ) : (
                        <>
                          <MaterialIcons name="auto-awesome" size={16} color="#fff" />
                          <Text className="text-white font-semibold ml-1">生成脚本</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Lyrics Input */}
              <View className="mb-4">
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center">
                    <Text className="text-lg font-semibold text-foreground">歌词或文本内容</Text>
                    {scriptSource === "ai" && (
                      <View className="ml-2 bg-primary/15 px-2 py-0.5 rounded-full">
                        <Text className="text-primary text-xs font-medium">AI 生成</Text>
                      </View>
                    )}
                  </View>
                  <Text
                    className="text-sm font-medium"
                    style={{ color: isOverCharLimit ? colors.error : colors.muted }}
                  >
                    {charCount}/{currentMaxChars} 字
                  </Text>
                </View>
                <TextInput
                  value={lyricsText}
                  onChangeText={(text) => {
                    setLyricsText(text);
                    // 如果用户手动修改了 AI 生成的内容，仍保持 AI 标记
                    // 只有完全清空后重新输入才切回 own
                    if (text.length === 0) setScriptSource("own");
                  }}
                  placeholder="请输入歌词或文本内容..."
                  placeholderTextColor={colors.muted}
                  multiline
                  numberOfLines={10}
                  textAlignVertical="top"
                  className="bg-background rounded-xl p-4 text-foreground"
                  style={{
                    minHeight: 200,
                    borderWidth: 1,
                    borderColor: isOverCharLimit ? colors.error : colors.border,
                    fontSize: 16,
                    lineHeight: 24,
                  }}
                />
                {isOverCharLimit && (
                  <Text className="text-error text-sm mt-2">
                    ⚠️ 超出免费额度 {charCount - currentMaxChars} 字，超出部分需消耗 Credits
                  </Text>
                )}
              </View>

              {/* Scene Count Selector */}
              <View className="mb-6">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-lg font-semibold text-foreground">分镜数量</Text>
                  <Text
                    className="text-sm font-medium"
                    style={{ color: isOverSceneLimit ? colors.error : colors.muted }}
                  >
                    {sceneCount}/{MAX_SCENES} 个
                  </Text>
                </View>
                <View className="flex-row items-center justify-between bg-background rounded-xl p-4">
                  <TouchableOpacity
                    onPress={() => setSceneCount(Math.max(1, sceneCount - 1))}
                    disabled={sceneCount <= 1}
                    className="w-12 h-12 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: sceneCount <= 1 ? colors.muted + "30" : colors.primary,
                    }}
                  >
                    <MaterialIcons name="remove" size={24} color="#FFF" />
                  </TouchableOpacity>
                  <Text className="text-2xl font-bold text-foreground">{sceneCount}</Text>
                  <TouchableOpacity
                    onPress={() => setSceneCount(Math.min(MAX_SCENES + 5, sceneCount + 1))}
                    className="w-12 h-12 items-center justify-center rounded-full"
                    style={{ backgroundColor: colors.primary }}
                  >
                    <MaterialIcons name="add" size={24} color="#FFF" />
                  </TouchableOpacity>
                </View>
                {isOverSceneLimit && (
                  <Text className="text-error text-sm mt-2">
                    ⚠️ 超出免费额度 {sceneCount - MAX_SCENES} 个分镜，超出部分需消耗 Credits
                  </Text>
                )}
              </View>

              {/* NBP Engine Selector */}
              <View className="mb-6">
                <NbpEngineSelector
                  selected={imageEngine}
                  onSelect={setImageEngine}
                  plan={userPlan}
                  creditsAvailable={userCredits}
                  isAdmin={user?.role === "admin"}
                />
              </View>

              {/* Generate Button */}
              <TouchableOpacity
                onPress={handleGenerate}
                disabled={!lyricsText.trim() || isGenerating}
                className="rounded-xl py-4 px-6"
                style={{
                  backgroundColor: !lyricsText.trim() || isGenerating ? colors.muted : colors.primary,
                  opacity: !lyricsText.trim() || isGenerating ? 0.5 : 1,
                }}
              >
                {isGenerating ? (
                  <View className="flex-row items-center justify-center">
                    <ActivityIndicator color="#fff" size="small" />
                    <Text className="text-white font-semibold ml-2">AI 生成中...</Text>
                  </View>
                ) : (
                  <Text className="text-white font-semibold text-center">
                    生成分镜脚本
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Storyboard Result */}
        {storyboard && (
          <View className="px-6 py-4">
            {/* Music Info */}
            <View className="bg-surface rounded-2xl p-6 border border-border mb-4">
              <Text className="text-xl font-bold text-foreground mb-4">{storyboard.title}</Text>
              <View className="flex-row flex-wrap gap-2">
                <View className="bg-primary/10 px-3 py-1 rounded-full">
                  <Text className="text-primary text-sm font-medium">BPM: {storyboard.musicInfo.bpm}</Text>
                </View>
                <View className="bg-primary/10 px-3 py-1 rounded-full">
                  <Text className="text-primary text-sm font-medium">{storyboard.musicInfo.emotion}</Text>
                </View>
                <View className="bg-primary/10 px-3 py-1 rounded-full">
                  <Text className="text-primary text-sm font-medium">{storyboard.musicInfo.style}</Text>
                </View>
                <View className="bg-primary/10 px-3 py-1 rounded-full">
                  <Text className="text-primary text-sm font-medium">调性: {storyboard.musicInfo.key}</Text>
                </View>
              </View>
            </View>

            {/* Scenes */}
            <View className="mb-4">
              <Text className="text-xl font-bold text-foreground mb-3">分镜详情</Text>
              {storyboard.scenes.map((scene) => {
                const isEditing = editingSceneId === scene.sceneNumber;
                const displayScene = isEditing && editedScene ? editedScene : scene;
                
                return (
                  <View key={scene.sceneNumber} className="bg-surface rounded-2xl p-5 border border-border mb-4">
                    <View className="flex-row items-center justify-between mb-3">
                      <Text className="text-lg font-bold text-foreground">场景 {scene.sceneNumber}</Text>
                      <View className="flex-row items-center gap-2">
                        <Text className="text-muted text-sm">
                          {scene.timestamp} ({scene.duration})
                        </Text>
                        {!isEditing && (
                          <TouchableOpacity
                            onPress={() => handleEditScene(scene)}
                            className="bg-primary/10 px-3 py-1 rounded-full"
                          >
                            <Text className="text-primary text-xs font-medium">编辑</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    
                    {/* ─── 预览图片（全宽 16:9 比例） ─── */}
                    {scene.previewImageUrl && (
                      <View className="mb-4 rounded-xl overflow-hidden" style={{ backgroundColor: colors.border + '30' }}>
                        <Image
                          source={{ uri: scene.previewImageUrl }}
                          style={{
                            width: '100%' as any,
                            aspectRatio: 16 / 9,
                          }}
                          contentFit="contain"
                          transition={300}
                        />
                      </View>
                    )}
                    
                    {/* Scene Description */}
                    <View className="mb-3">
                      <Text className="text-muted text-sm mb-1">场景描述</Text>
                      {isEditing ? (
                        <TextInput
                          value={displayScene.description}
                          onChangeText={(text) => handleUpdateField('description', text)}
                          multiline
                          className="bg-background rounded-lg p-3 text-foreground"
                          style={{ minHeight: 80 }}
                        />
                      ) : (
                        <Text className="text-foreground leading-relaxed">{displayScene.description}</Text>
                      )}
                    </View>
                    
                    {/* Camera Movement */}
                    <View className="bg-background rounded-lg p-3 mb-2">
                      <Text className="text-muted text-sm mb-1">镜头运动</Text>
                      {isEditing ? (
                        <TextInput
                          value={displayScene.cameraMovement}
                          onChangeText={(text) => handleUpdateField('cameraMovement', text)}
                          className="text-foreground"
                        />
                      ) : (
                        <Text className="text-foreground">{displayScene.cameraMovement}</Text>
                      )}
                    </View>
                    
                    {/* Mood */}
                    <View className="bg-background rounded-lg p-3 mb-2">
                      <Text className="text-muted text-sm mb-1">情绪氛围</Text>
                      {isEditing ? (
                        <TextInput
                          value={displayScene.mood}
                          onChangeText={(text) => handleUpdateField('mood', text)}
                          className="text-foreground"
                        />
                      ) : (
                        <Text className="text-foreground">{displayScene.mood}</Text>
                      )}
                    </View>
                    
                    {/* Visual Elements */}
                    <View className="bg-background rounded-lg p-3 mb-2">
                      <Text className="text-muted text-sm mb-2">视觉元素</Text>
                      {isEditing ? (
                        <TextInput
                          value={displayScene.visualElements.join(', ')}
                          onChangeText={(text) => handleUpdateField('visualElements', text.split(',').map(s => s.trim()))}
                          placeholder="以逗号分隔多个元素"
                          className="text-foreground"
                        />
                      ) : (
                        <View className="flex-row flex-wrap gap-2">
                          {displayScene.visualElements.map((element, idx) => (
                            <View key={idx} className="bg-primary/10 px-2 py-1 rounded">
                              <Text className="text-primary text-xs">{element}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                    
                    {/* Transition */}
                    {(displayScene.transition || isEditing) && (
                      <View className="bg-background rounded-lg p-3 mb-2">
                        <Text className="text-muted text-sm mb-1">转场建议</Text>
                        {isEditing ? (
                          <TextInput
                            value={displayScene.transition || ''}
                            onChangeText={(text) => handleUpdateField('transition', text)}
                            className="text-foreground"
                          />
                        ) : (
                          <Text className="text-foreground">{displayScene.transition}</Text>
                        )}
                      </View>
                    )}
                    
                    {/* Edit Actions */}
                    {isEditing && (
                      <View className="flex-row gap-2 mt-3">
                        <TouchableOpacity
                          onPress={handleSaveEdit}
                          className="flex-1 rounded-lg py-3"
                          style={{ backgroundColor: colors.primary }}
                        >
                          <Text className="text-white font-semibold text-center">保存</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleCancelEdit}
                          className="flex-1 bg-muted/20 rounded-lg py-3"
                        >
                          <Text className="text-foreground font-semibold text-center">取消</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            {/* Summary */}
            <View className="bg-surface rounded-2xl p-6 border border-border mb-4">
              <Text className="text-lg font-bold text-foreground mb-3">整体建议</Text>
              <Text className="text-foreground leading-relaxed">{storyboard.summary}</Text>
            </View>

            {/* Actions — 导出菜单 */}
            <View className="mb-6">
              <View className="flex-row gap-3 mb-3">
                <TouchableOpacity
                  onPress={handleReset}
                  className="flex-1 bg-muted/20 rounded-xl py-4 px-6"
                >
                  <Text className="text-foreground font-semibold text-center">重新生成</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setExportMenuVisible(!exportMenuVisible)}
                  className="flex-1 rounded-xl py-4 px-6 flex-row items-center justify-center"
                  style={{ backgroundColor: colors.primary }}
                >
                  <MaterialIcons name="file-download" size={18} color="#fff" />
                  <Text className="text-white font-semibold ml-2">导出脚本</Text>
                </TouchableOpacity>
              </View>

              {/* Export Format Options */}
              {exportMenuVisible && (
                <View className="bg-surface rounded-xl border border-border overflow-hidden">
                  <TouchableOpacity
                    onPress={() => { setExportMenuVisible(false); handleExportPDF(); }}
                    disabled={exportPDFMutation.isPending}
                    className="flex-row items-center p-4 border-b border-border"
                  >
                    <MaterialIcons name="picture-as-pdf" size={24} color="#E53935" />
                    <View className="ml-3 flex-1">
                      <Text className="text-foreground font-semibold">导出 PDF</Text>
                      <Text className="text-muted text-xs mt-0.5">含分镜图片，适合打印和分享</Text>
                    </View>
                    {exportPDFMutation.isPending && <ActivityIndicator size="small" color={colors.primary} />}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setExportMenuVisible(false); handleExportWord(); }}
                    disabled={exportPDFMutation.isPending}
                    className="flex-row items-center p-4"
                  >
                    <MaterialIcons name="description" size={24} color="#1565C0" />
                    <View className="ml-3 flex-1">
                      <Text className="text-foreground font-semibold">导出 Word</Text>
                      <Text className="text-muted text-xs mt-0.5">可编辑格式，适合团队协作</Text>
                    </View>
                    {exportPDFMutation.isPending && <ActivityIndicator size="small" color={colors.primary} />}
                  </TouchableOpacity>
                </View>
              )}

              {/* Export Status Toast */}
              {exportStatus && (
                <View className="bg-surface rounded-xl border border-primary p-3 mt-3">
                  <View className="flex-row items-center">
                    {exportPDFMutation.isPending ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <MaterialIcons name="info-outline" size={18} color={colors.primary} />
                    )}
                    <Text className="text-foreground text-sm ml-2 flex-1">{exportStatus}</Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Quota Exhausted Modal */}
      <QuotaExhaustedModal
        visible={quotaModalVisible}
        featureName="智能脚本与分镜生成"
        isTrial={quotaModalInfo.isTrial}
        planName={quotaModalInfo.planName}
        onClose={() => setQuotaModalVisible(false)}
      />
    </ScreenContainer>
  );
}
