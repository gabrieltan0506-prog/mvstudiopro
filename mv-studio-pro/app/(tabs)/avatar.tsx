import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
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
import { NbpEngineSelector, type EngineOption } from "@/components/nbp-engine-selector";
import * as ImagePicker from "expo-image-picker";
import { ModelViewer } from "@/components/model-viewer";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWeb = Platform.OS === "web";
const isWide = isWeb && SCREEN_WIDTH > 768;

type StyleOption = { id: string; label: string; icon: string; color: string; desc: string };
type GenderOption = { id: string; label: string; icon: string };

const STYLES: StyleOption[] = [
  { id: "anime", label: "动漫风", icon: "auto-awesome", color: "#FF6B6B", desc: "日系动漫角色设计" },
  { id: "realistic", label: "真人风", icon: "face", color: "#64D2FF", desc: "极度真人・摄影级品质" },
  { id: "chibi", label: "Q版萌系", icon: "child-care", color: "#FFD60A", desc: "可爱 Q 版造型" },
  { id: "cyberpunk", label: "赛博庞克", icon: "memory", color: "#C77DBA", desc: "未来科技风格" },
  { id: "fantasy", label: "奇幻风", icon: "auto-fix-high", color: "#30D158", desc: "魔幻梦境风格" },
];

const GENDERS: GenderOption[] = [
  { id: "female", label: "女性", icon: "female" },
  { id: "male", label: "男性", icon: "male" },
  { id: "neutral", label: "中性", icon: "transgender" },
];

// 3D 转换现在使用 fal.ai Hunyuan3D，不再需要风格/角度选择

export default function AvatarScreen() {
  const router = useRouter();
  const { isAuthenticated, loading, user } = useAuth();

  const [selectedStyle, setSelectedStyle] = useState<string>("anime");
  const [selectedGender, setSelectedGender] = useState<string>("female");
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ imageUrl: string; style: string; gender: string }>>([]);

  const [imageEngine, setImageEngine] = useState<EngineOption>("forge");

  // ── Reference image state ──
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [uploadingRef, setUploadingRef] = useState(false);

  // ── 3D Conversion state ──
  const [show3DPanel, setShow3DPanel] = useState(false);
  const [converting3D, setConverting3D] = useState(false);
  const [image3D, setImage3D] = useState<string | null>(null);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [mode3D, setMode3D] = useState<string | null>(null);
  const [timeTaken3D, setTimeTaken3D] = useState<number>(0);
  const [enablePbr, setEnablePbr] = useState(true);
  const [error3D, setError3D] = useState<string | null>(null);
  const [textureUrl3D, setTextureUrl3D] = useState<string | null>(null);
  const [thumbnailUrl3D, setThumbnailUrl3D] = useState<string | null>(null);
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);
  const [quotaModalInfo, setQuotaModalInfo] = useState<{ isTrial?: boolean; planName?: string }>({});

  const generateMutation = trpc.virtualIdol.generate.useMutation();
  const convert3DMutation = trpc.virtualIdol.convertTo3D.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const uploadScreenshotMutation = trpc.paymentSubmission.uploadScreenshot.useMutation();
  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    refetchOnMount: true,
  });
  const subQuery = trpc.stripe.getSubscription.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
  });
  const userPlan = (subQuery.data?.plan || "free") as string;
  const userCredits = subQuery.data?.credits?.balance ?? 0;

  // ── Pick reference image ──
  const pickReferenceImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });

      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      setReferenceImage(asset.uri);
      setReferenceImageUrl(null);

      if (asset.base64) {
        setUploadingRef(true);
        try {
          const uploadResult = await uploadScreenshotMutation.mutateAsync({
            imageBase64: asset.base64,
            mimeType: asset.mimeType || "image/jpeg",
          });
          setReferenceImageUrl(uploadResult.url);
        } catch (err: any) {
          Alert.alert("上传失败", err.message || "参考图上传失败，请重试");
          setReferenceImage(null);
        } finally {
          setUploadingRef(false);
        }
      }
    } catch (err: any) {
      Alert.alert("选择图片失败", err.message || "无法选择图片");
    }
  }, [uploadScreenshotMutation]);

  const removeReferenceImage = useCallback(() => {
    setReferenceImage(null);
    setReferenceImageUrl(null);
  }, []);

  const handleGenerate = useCallback(async () => {
    try {
      const accessCheck = await checkAccessMutation.mutateAsync({ featureType: "avatar" });
      
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

    if (referenceImage && !referenceImageUrl && uploadingRef) {
      Alert.alert("请稍候", "参考图正在上传中，请等待上传完成后再生成");
      return;
    }
    
    setGenerating(true);
    setError(null);
    setGeneratedImage(null);
    setShow3DPanel(false);
    setImage3D(null);
    // Map engine selection to quality parameter
    const qualityMap: Record<string, "free" | "2k" | "4k"> = {
      forge: "free",
      nbp_2k: "2k",
      nbp_4k: "4k",
    };
    const quality = qualityMap[imageEngine] || "free";

    try {
      const result = await generateMutation.mutateAsync({
        style: selectedStyle as any,
        gender: selectedGender as any,
        description: description || undefined,
        referenceImageUrl: referenceImageUrl || undefined,
        quality,
      });
      if (result.success === false) {
        setError((result as any).error || "生成失败");
      } else if (result.imageUrl) {
        setGeneratedImage(result.imageUrl);
        setHistory(prev => [{ imageUrl: result.imageUrl!, style: selectedStyle, gender: selectedGender }, ...prev].slice(0, 6));
      }
      usageStatsQuery.refetch();
    } catch (err: any) {
      setError(err.message || "生成失败，请稍后再试");
    } finally {
      setGenerating(false);
    }
  }, [selectedStyle, selectedGender, description, generateMutation, checkAccessMutation, router, usageStatsQuery, referenceImageUrl, referenceImage, uploadingRef, imageEngine]);

  // ── Handle 3D Conversion (fal.ai Hunyuan3D) ──
  const handleConvertTo3D = useCallback(async () => {
    if (!generatedImage) return;

    setConverting3D(true);
    setError3D(null);
    setImage3D(null);
    setGlbUrl(null);
    setObjUrl(null);
    setMode3D(null);
    setTimeTaken3D(0);
    try {
      const result = await convert3DMutation.mutateAsync({
        imageUrl: generatedImage,
        enablePbr,
      });
      setImage3D(result.imageUrl3D);
      setGlbUrl(result.glbUrl ?? null);
      setObjUrl(result.objUrl ?? null);
      setMode3D(result.mode);
      setTimeTaken3D(result.timeTaken ?? 0);
      setTextureUrl3D((result as any).textureUrl ?? null);
      setThumbnailUrl3D((result as any).thumbnailUrl ?? null);
    } catch (err: any) {
      if (err.message?.includes("仅限专业版")) {
        Alert.alert(
          "需要升级",
          "偶像转 3D 功能仅限专业版以上用户使用。\n\n升级后可享受 3D 转换，每次消耗 10 Credits。",
          [
            { text: "取消", style: "cancel" },
            { text: "立即升级", onPress: () => router.push("/pricing" as any) },
          ]
        );
      } else {
        setError3D(err.message || "3D 转换失败，请稍后再试");
      }
    } finally {
      setConverting3D(false);
    }
  }, [generatedImage, enablePbr, convert3DMutation, router]);

  const currentStyleInfo = useMemo(() => STYLES.find(s => s.id === selectedStyle), [selectedStyle]);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      console.log("[Avatar] Not authenticated, redirecting to login...");
      router.replace("/login");
    }
  }, [loading, isAuthenticated, router]);

  if (loading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator size="large" color="#0a7ea4" />
        <Text className="mt-4 text-muted">检查登录状态...</Text>
      </ScreenContainer>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <ScreenContainer edges={isWeb ? [] : ["top", "left", "right"]} containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Usage Quota Banner */}
        <UsageQuotaBanner
          featureType="avatar"
          currentCount={usageStatsQuery.data?.features.avatar.currentCount ?? 0}
          freeLimit={usageStatsQuery.data?.features.avatar.limit ?? 3}
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
          <Text style={styles.headerTitle}>虚拟偶像创建</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.content}>
          {/* Style Selection */}
          <View style={styles.sectionBox}>
            <Text style={styles.sectionTitle}>
              <MaterialIcons name="style" size={18} color="#C77DBA" /> 选择风格
            </Text>
            <View style={styles.styleGrid}>
              {STYLES.map((style) => (
                <TouchableOpacity
                  key={style.id}
                  style={[
                    styles.styleCard,
                    selectedStyle === style.id && { borderColor: style.color, backgroundColor: `${style.color}11` },
                  ]}
                  onPress={() => setSelectedStyle(style.id)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name={style.icon as any} size={28} color={selectedStyle === style.id ? style.color : "#6B6762"} />
                  <Text style={[styles.styleLabel, selectedStyle === style.id && { color: style.color }]}>{style.label}</Text>
                  <Text style={styles.styleDesc}>{style.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Gender Selection */}
          <View style={styles.sectionBox}>
            <Text style={styles.sectionTitle}>
              <MaterialIcons name="person" size={18} color="#64D2FF" /> 选择性别
            </Text>
            <View style={styles.genderRow}>
              {GENDERS.map((g) => (
                <TouchableOpacity
                  key={g.id}
                  style={[
                    styles.genderBtn,
                    selectedGender === g.id && styles.genderBtnActive,
                  ]}
                  onPress={() => setSelectedGender(g.id)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name={g.icon as any} size={22} color={selectedGender === g.id ? "#64D2FF" : "#6B6762"} />
                  <Text style={[styles.genderLabel, selectedGender === g.id && { color: "#64D2FF" }]}>{g.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Reference Image Upload ── */}
          <View style={styles.sectionBox}>
            <Text style={styles.sectionTitle}>
              <MaterialIcons name="add-a-photo" size={18} color="#FF9F0A" /> 上传参考图（可选）
            </Text>
            <Text style={styles.refHint}>
              上传一张人物照片作为参考，AI 将基于此照片的面部特征生成虚拟偶像
            </Text>

            {!referenceImage ? (
              <TouchableOpacity
                style={styles.refUploadBtn}
                onPress={pickReferenceImage}
                activeOpacity={0.8}
              >
                <MaterialIcons name="cloud-upload" size={32} color="#FF9F0A" />
                <Text style={styles.refUploadText}>点击选择参考图片</Text>
                <Text style={styles.refUploadSubtext}>支持 JPG、PNG 格式</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.refPreviewContainer}>
                <View style={styles.refPreviewWrap}>
                  <Image source={{ uri: referenceImage }} style={styles.refPreviewImage} contentFit="cover" />
                  {uploadingRef && (
                    <View style={styles.refUploadingOverlay}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.refUploadingText}>上传中...</Text>
                    </View>
                  )}
                  {referenceImageUrl && (
                    <View style={styles.refUploadedBadge}>
                      <MaterialIcons name="check-circle" size={16} color="#30D158" />
                    </View>
                  )}
                </View>
                <View style={styles.refActions}>
                  <TouchableOpacity style={styles.refChangeBtn} onPress={pickReferenceImage} activeOpacity={0.8}>
                    <MaterialIcons name="swap-horiz" size={16} color="#FF9F0A" />
                    <Text style={styles.refChangeBtnText}>更换</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.refRemoveBtn} onPress={removeReferenceImage} activeOpacity={0.8}>
                    <MaterialIcons name="delete-outline" size={16} color="#FF453A" />
                    <Text style={styles.refRemoveBtnText}>移除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Description */}
          <View style={styles.sectionBox}>
            <Text style={styles.sectionTitle}>
              <MaterialIcons name="edit" size={18} color="#FFD60A" /> 自定义描述（可选）
            </Text>
            <TextInput
              style={styles.descInput}
              placeholder="例如：长发、穿着红色礼服、手持麦克风..."
              placeholderTextColor="#6B6762"
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={500}
            />
            <Text style={styles.charCount}>{description.length}/500</Text>
          </View>

          {/* NBP Engine Selector */}
          <View style={{ marginBottom: 16 }}>
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
            style={[styles.generateBtn, (generating || uploadingRef) && styles.generateBtnDisabled]}
            onPress={handleGenerate}
            disabled={generating || uploadingRef}
            activeOpacity={0.8}
          >
            {generating ? (
              <>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.generateBtnText}>AI 生成中... 请稍候</Text>
              </>
            ) : (
              <>
                <MaterialIcons name="auto-awesome" size={22} color="#FFFFFF" />
                <Text style={styles.generateBtnText}>
                  {referenceImageUrl ? "基于参考图生成" : "生成虚拟偶像"}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* Error */}
          {error && (
            <View style={styles.errorBox}>
              <MaterialIcons name="error-outline" size={20} color="#FF453A" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Generated Result */}
          {generatedImage && (
            <View style={styles.resultBox}>
              <Text style={styles.resultTitle}>
                <MaterialIcons name="star" size={18} color="#FFD60A" /> 生成结果
              </Text>
              <View style={styles.resultImageWrap}>
                <Image source={{ uri: generatedImage }} style={styles.resultImage} contentFit="cover" />
              </View>
              <View style={styles.resultMeta}>
                <View style={styles.resultTag}>
                  <Text style={[styles.resultTagText, { color: currentStyleInfo?.color }]}>{currentStyleInfo?.label}</Text>
                </View>
                <View style={styles.resultTag}>
                  <Text style={styles.resultTagText}>{GENDERS.find(g => g.id === selectedGender)?.label}</Text>
                </View>
                {referenceImageUrl && (
                  <View style={[styles.resultTag, { backgroundColor: "rgba(255,159,10,0.1)" }]}>
                    <Text style={[styles.resultTagText, { color: "#FF9F0A" }]}>参考图生成</Text>
                  </View>
                )}
              </View>

              {/* Action Button */}
              <TouchableOpacity style={styles.regenerateBtn} onPress={handleGenerate} activeOpacity={0.8}>
                <MaterialIcons name="refresh" size={18} color="#C77DBA" />
                <Text style={styles.regenerateBtnText}>重新生成</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── 3D Conversion Panel — 自动展开 ── */}
          {generatedImage && (
            <View style={styles.panel3D}>
              <Text style={styles.panel3DTitle}>
                <MaterialIcons name="view-in-ar" size={20} color="#64D2FF" /> 3D 模型生成
              </Text>

              {/* 已生成 3D 模型 → 直接显示预览器 */}
              {image3D && (glbUrl || objUrl) ? (
                <View>
                  {mode3D === "real3d" && timeTaken3D > 0 && (
                    <Text style={{ fontSize: 12, color: "#9B9691", marginBottom: 8 }}>
                      Hunyuan3D 生成耗时 {timeTaken3D.toFixed(1)} 秒
                    </Text>
                  )}
                  <ModelViewer
                    glbUrl={glbUrl}
                    objUrl={objUrl}
                    textureUrl={textureUrl3D}
                    thumbnailUrl={thumbnailUrl3D || image3D}
                    height={isWide ? 400 : 300}
                    autoRotate={true}
                  />
                  <View style={styles.resultMeta}>
                    <View style={[styles.resultTag, { backgroundColor: "rgba(100,210,255,0.1)" }]}>
                      <Text style={[styles.resultTagText, { color: "#64D2FF" }]}>Hunyuan3D</Text>
                    </View>
                    {enablePbr && (
                      <View style={[styles.resultTag, { backgroundColor: "rgba(100,210,255,0.1)" }]}>
                        <Text style={[styles.resultTagText, { color: "#64D2FF" }]}>PBR 材质</Text>
                      </View>
                    )}
                  </View>
                  {/* 下载按钮 */}
                  <View style={styles.downloadRow}>
                    {glbUrl && (
                      <TouchableOpacity
                        style={styles.downloadBtn}
                        onPress={() => {
                          if (Platform.OS === "web") {
                            const a = document.createElement("a");
                            a.href = glbUrl;
                            a.download = "idol-3d-model.glb";
                            a.click();
                          } else {
                            Alert.alert("下载链接", glbUrl);
                          }
                        }}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="download" size={16} color="#64D2FF" />
                        <Text style={styles.downloadBtnText}>下载 GLB</Text>
                      </TouchableOpacity>
                    )}
                    {objUrl && (
                      <TouchableOpacity
                        style={styles.downloadBtn}
                        onPress={() => {
                          if (Platform.OS === "web") {
                            const a = document.createElement("a");
                            a.href = objUrl;
                            a.download = "idol-3d-model.obj";
                            a.click();
                          } else {
                            Alert.alert("下载链接", objUrl);
                          }
                        }}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="download" size={16} color="#64D2FF" />
                        <Text style={styles.downloadBtnText}>下载 OBJ</Text>
                      </TouchableOpacity>
                    )}
                    {textureUrl3D && (
                      <TouchableOpacity
                        style={styles.downloadBtn}
                        onPress={() => {
                          if (Platform.OS === "web") {
                            const a = document.createElement("a");
                            a.href = textureUrl3D;
                            a.download = "idol-3d-texture.png";
                            a.click();
                          } else {
                            Alert.alert("下载链接", textureUrl3D);
                          }
                        }}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="texture" size={16} color="#FFD60A" />
                        <Text style={[styles.downloadBtnText, { color: "#FFD60A" }]}>纹理贴图</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {/* 重新生成 3D */}
                  <TouchableOpacity
                    style={[styles.convert3DActionBtn, { marginTop: 12, backgroundColor: "rgba(100,210,255,0.15)" }]}
                    onPress={handleConvertTo3D}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="refresh" size={18} color="#64D2FF" />
                    <Text style={[styles.convert3DActionText, { color: "#64D2FF" }]}>重新生成 3D</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                /* 尚未生成 3D → 显示图片预览 + Credits 确认 + 生成按钮 */
                <View>
                  <Text style={styles.panel3DSubtitle}>
                    将您的偶像图片转换为可旋转的 3D 模型
                  </Text>
                  {/* 图片预览 */}
                  <View style={{ alignItems: "center", marginVertical: 12 }}>
                    <Image source={{ uri: generatedImage }} style={{ width: 160, height: 160, borderRadius: 12 }} contentFit="cover" />
                    <Text style={{ fontSize: 12, color: "#9B9691", marginTop: 6 }}>此图片将用于 3D 转换</Text>
                  </View>
                  {/* Credits 费用提示 */}
                  <View style={{ backgroundColor: "rgba(100,210,255,0.08)", borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "rgba(100,210,255,0.15)" }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: "#ECEDEE" }}>费用明细</Text>
                      <View style={{ backgroundColor: "rgba(100,210,255,0.15)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                        <Text style={{ fontSize: 14, fontWeight: "700", color: "#64D2FF" }}>{enablePbr ? "30" : "30"} Credits</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 12, color: "#9B9691" }}>Hunyuan3D Rapid · 预计 15-30 秒 · 输出 GLB/OBJ 格式</Text>
                  </View>
                  {/* PBR 材质开关 */}
                  <TouchableOpacity
                    style={styles.pbrToggle}
                    onPress={() => setEnablePbr(!enablePbr)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name={enablePbr ? "check-box" : "check-box-outline-blank"} size={22} color={enablePbr ? "#64D2FF" : "#6B6762"} />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={styles.pbrLabel}>激活 PBR 材质</Text>
                      <Text style={styles.pbrDesc}>生成更真实的光照和材质效果（推荐打开）</Text>
                    </View>
                  </TouchableOpacity>
                  {/* 生成按钮 */}
                  <TouchableOpacity
                    style={[styles.convert3DActionBtn, converting3D && { opacity: 0.6 }]}
                    onPress={handleConvertTo3D}
                    disabled={converting3D}
                    activeOpacity={0.8}
                  >
                    {converting3D ? (
                      <>
                        <ActivityIndicator size="small" color="#FFFFFF" />
                        <Text style={styles.convert3DActionText}>3D 模型生成中... 请稍候</Text>
                      </>
                    ) : (
                      <>
                        <MaterialIcons name="view-in-ar" size={20} color="#FFFFFF" />
                        <Text style={styles.convert3DActionText}>确认生成 3D 模型（30 Credits）</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* 3D Error */}
              {error3D && (
                <View style={styles.errorBox}>
                  <MaterialIcons name="error-outline" size={20} color="#FF453A" />
                  <Text style={styles.errorText}>{error3D}</Text>
                </View>
              )}
            </View>
          )}

          {/* ── 3D Demo Gallery (方案 A+E) ── */}
          {generatedImage && !image3D && !converting3D && (
            <View style={styles.demoGallery}>
              <Text style={styles.demoGalleryTitle}>
                <MaterialIcons name="auto-awesome" size={18} color="#FFD60A" /> 3D 效果展示
              </Text>
              <Text style={styles.demoGallerySubtitle}>
                以下是 Hunyuan3D 生成的真实 3D 模型效果，升级后即可将您的偶像转换为同等质量的 3D 模型
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 8 }}>
                {[
                  { label: "动漫风 3D", color: "#FF6B6B", icon: "face" as const, desc: "日系动漫角色 → 3D 模型" },
                  { label: "写实 3D", color: "#64D2FF", icon: "person" as const, desc: "真人风格 → 超写实 3D" },
                  { label: "Q版 3D", color: "#FFD60A", icon: "child-care" as const, desc: "Q版萌系 → 黏土风 3D" },
                  { label: "赛博庞克 3D", color: "#C77DBA", icon: "memory" as const, desc: "未来风格 → 科幻 3D" },
                  { label: "奇幻 3D", color: "#30D158", icon: "auto-fix-high" as const, desc: "奇幻角色 → 魔幻 3D" },
                ].map((demo, i) => (
                  <View key={i} style={[styles.demoCard, { borderColor: `${demo.color}33` }]}>
                    <View style={[styles.demoIconWrap, { backgroundColor: `${demo.color}15` }]}>
                      <MaterialIcons name={demo.icon} size={36} color={demo.color} />
                    </View>
                    <View style={styles.demoArrow}>
                      <MaterialIcons name="arrow-forward" size={16} color="#6B6762" />
                    </View>
                    <View style={[styles.demoIconWrap, { backgroundColor: `${demo.color}15` }]}>
                      <MaterialIcons name="view-in-ar" size={36} color={demo.color} />
                    </View>
                    <Text style={[styles.demoLabel, { color: demo.color }]}>{demo.label}</Text>
                    <Text style={styles.demoDesc}>{demo.desc}</Text>
                  </View>
                ))}
              </ScrollView>
              {/* 方案 E 提示 */}
              <View style={styles.depthPreviewHint}>
                <MaterialIcons name="3d-rotation" size={18} color="#64D2FF" />
                <Text style={styles.depthPreviewText}>
                  升级后可获得可下载的 GLB/OBJ 3D 模型文档，支持导入 Blender、Unity、Unreal Engine
                </Text>
              </View>
            </View>
          )}

          {/* History */}
          {history.length > 1 && (
            <View style={styles.historyBox}>
              <Text style={styles.historyTitle}>
                <MaterialIcons name="history" size={18} color="#9B9691" /> 生成历史
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyScroll}>
                {history.slice(1).map((item, i) => (
                  <TouchableOpacity key={i} onPress={() => setGeneratedImage(item.imageUrl)} activeOpacity={0.8}>
                    <Image source={{ uri: item.imageUrl }} style={styles.historyThumb} contentFit="cover" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Quota Exhausted Modal */}
      <QuotaExhaustedModal
        visible={quotaModalVisible}
        featureName="虚拟偶像生成"
        isTrial={quotaModalInfo.isTrial}
        planName={quotaModalInfo.planName}
        onClose={() => setQuotaModalVisible(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, backgroundColor: "#0D0D0F" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(16,16,18,0.92)",
    ...(isWeb ? { position: "sticky" as any, top: 0, zIndex: 100, backdropFilter: "blur(24px)" } as any : {}),
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#F7F4EF" },
  content: { maxWidth: 700, alignSelf: "center", width: "100%" as any, padding: 24, gap: 24 },

  sectionBox: {
    backgroundColor: "#161618", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#F7F4EF", marginBottom: 16 },

  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  styleCard: {
    width: isWide ? ("18.5%" as any) : ("47%" as any),
    alignItems: "center", gap: 6, paddingVertical: 16, paddingHorizontal: 8,
    borderRadius: 14, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  styleLabel: { fontSize: 14, fontWeight: "700", color: "#F7F4EF" },
  styleDesc: { fontSize: 12, color: "#6B6762", textAlign: "center" },

  genderRow: { flexDirection: "row", gap: 12 },
  genderBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 14, borderRadius: 12,
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  genderBtnActive: { borderColor: "#64D2FF", backgroundColor: "rgba(100,210,255,0.08)" },
  genderLabel: { fontSize: 15, fontWeight: "600", color: "#9B9691" },

  // ── Reference image styles ──
  refHint: { fontSize: 13, color: "#6B6762", marginTop: -8, marginBottom: 14, lineHeight: 20 },
  refUploadBtn: {
    alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 32, borderRadius: 14,
    borderWidth: 2, borderColor: "rgba(255,159,10,0.25)", borderStyle: "dashed",
    backgroundColor: "rgba(255,159,10,0.04)",
  },
  refUploadText: { fontSize: 15, fontWeight: "600", color: "#FF9F0A" },
  refUploadSubtext: { fontSize: 12, color: "#6B6762" },
  refPreviewContainer: { gap: 12 },
  refPreviewWrap: {
    width: 120, height: 120, borderRadius: 14, overflow: "hidden",
    borderWidth: 2, borderColor: "rgba(255,159,10,0.3)",
    position: "relative",
  },
  refPreviewImage: { width: "100%", height: "100%" },
  refUploadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", gap: 4,
  },
  refUploadingText: { fontSize: 11, color: "#FFFFFF" },
  refUploadedBadge: {
    position: "absolute", top: 6, right: 6,
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10, padding: 2,
  },
  refActions: { flexDirection: "row", gap: 10 },
  refChangeBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: "rgba(255,159,10,0.3)",
    backgroundColor: "rgba(255,159,10,0.06)",
  },
  refChangeBtnText: { fontSize: 13, fontWeight: "600", color: "#FF9F0A" },
  refRemoveBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: "rgba(255,69,58,0.3)",
    backgroundColor: "rgba(255,69,58,0.06)",
  },
  refRemoveBtnText: { fontSize: 13, fontWeight: "600", color: "#FF453A" },

  descInput: {
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: "#F7F4EF",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", minHeight: 80,
  },
  charCount: { fontSize: 12, color: "#6B6762", textAlign: "right", marginTop: 6 },

  generateBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 16, borderRadius: 28,
    backgroundColor: "#C77DBA",
  },
  generateBtnDisabled: { opacity: 0.6 },
  generateBtnText: { fontSize: 17, fontWeight: "700", color: "#FFFFFF" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,69,58,0.1)", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(255,69,58,0.2)",
  },
  errorText: { fontSize: 14, color: "#FF453A", flex: 1 },

  resultBox: {
    backgroundColor: "#161618", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "rgba(199,125,186,0.2)", gap: 16,
  },
  resultTitle: { fontSize: 18, fontWeight: "700", color: "#F7F4EF" },
  resultImageWrap: { borderRadius: 14, overflow: "hidden" },
  resultImage: { width: "100%" as any, aspectRatio: 1 },
  resultMeta: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  resultTag: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  resultTagText: { fontSize: 13, fontWeight: "600", color: "#9B9691" },
  regenerateBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 12, borderRadius: 24,
    borderWidth: 1.5, borderColor: "rgba(199,125,186,0.3)",
    backgroundColor: "rgba(199,125,186,0.06)",
  },
  regenerateBtnText: { fontSize: 15, fontWeight: "600", color: "#C77DBA" },

  // ── 3D Conversion Button ──
  convert3DBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 12, borderRadius: 24,
    borderWidth: 1.5, borderColor: "rgba(100,210,255,0.3)",
    backgroundColor: "rgba(100,210,255,0.06)",
  },
  convert3DBtnText: { fontSize: 15, fontWeight: "600", color: "#64D2FF" },
  proBadge: {
    backgroundColor: "#FF6B35", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
  },
  proBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },

  // ── 3D Panel ──
  panel3D: {
    backgroundColor: "#161618", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "rgba(100,210,255,0.2)", gap: 16,
  },
  panel3DTitle: { fontSize: 18, fontWeight: "700", color: "#F7F4EF" },
  panel3DSubtitle: { fontSize: 13, color: "#6B6762", marginTop: -8 },
  panel3DLabel: { fontSize: 14, fontWeight: "600", color: "#9B9691" },

  style3DGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  style3DCard: {
    width: isWide ? ("18.5%" as any) : ("47%" as any),
    alignItems: "center", gap: 4, paddingVertical: 12, paddingHorizontal: 6,
    borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  style3DLabel: { fontSize: 13, fontWeight: "700", color: "#F7F4EF" },
  style3DDesc: { fontSize: 10, color: "#6B6762", textAlign: "center" },

  angleRow: { flexDirection: "row", gap: 8 },
  angleBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  angleBtnActive: { borderColor: "#64D2FF", backgroundColor: "rgba(100,210,255,0.08)" },
  angleLabel: { fontSize: 13, fontWeight: "600", color: "#9B9691" },

  pbrToggle: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12,
    borderWidth: 1.5, borderColor: "rgba(100,210,255,0.15)",
    backgroundColor: "rgba(100,210,255,0.04)",
  },
  pbrLabel: { fontSize: 14, fontWeight: "600", color: "#F7F4EF" },
  pbrDesc: { fontSize: 11, color: "#6B6762", marginTop: 2 },

  convert3DActionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 14, borderRadius: 24,
    backgroundColor: "#1A8FE3",
  },
  convert3DActionText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },

  downloadRow: {
    flexDirection: "row", gap: 10, marginTop: 4,
  },
  downloadBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: 12,
    borderWidth: 1.5, borderColor: "rgba(100,210,255,0.3)",
    backgroundColor: "rgba(100,210,255,0.06)",
  },
  downloadBtnText: { fontSize: 13, fontWeight: "600", color: "#64D2FF" },

  // ── 3D Result ──
  result3DBox: {
    backgroundColor: "rgba(100,210,255,0.04)", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "rgba(100,210,255,0.15)", gap: 12,
  },
  result3DTitle: { fontSize: 16, fontWeight: "700", color: "#F7F4EF" },
  result3DCompare: { flexDirection: "row", gap: 12, alignItems: "center" },
  result3DImageWrap: { flex: 1, gap: 6 },
  result3DImage: { width: "100%" as any, aspectRatio: 1, borderRadius: 12 },
  result3DImageLabel: { fontSize: 11, color: "#6B6762", textAlign: "center" },

  // ── 3D Demo Gallery ──
  demoGallery: {
    backgroundColor: "#161618", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "rgba(255,214,10,0.15)", gap: 12,
  },
  demoGalleryTitle: { fontSize: 16, fontWeight: "700", color: "#F7F4EF" },
  demoGallerySubtitle: { fontSize: 12, color: "#6B6762", marginTop: -4 },
  demoCard: {
    width: 140, alignItems: "center", gap: 8, paddingVertical: 16, paddingHorizontal: 10,
    borderRadius: 14, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.02)",
  },
  demoIconWrap: {
    width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center",
  },
  demoArrow: {
    width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  demoLabel: { fontSize: 13, fontWeight: "700" },
  demoDesc: { fontSize: 10, color: "#6B6762", textAlign: "center" },
  depthPreviewHint: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10,
    backgroundColor: "rgba(100,210,255,0.06)",
    borderWidth: 1, borderColor: "rgba(100,210,255,0.12)",
  },
  depthPreviewText: { fontSize: 12, color: "#9B9691", flex: 1 },

  historyBox: {
    backgroundColor: "#161618", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  historyTitle: { fontSize: 15, fontWeight: "600", color: "#9B9691", marginBottom: 12 },
  historyScroll: { gap: 10 },
  historyThumb: { width: 80, height: 80, borderRadius: 12 },
});
