import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Dimensions,
  Linking,
  StyleSheet,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { ScreenContainer } from "@/components/screen-container";
import * as ImagePicker from "expo-image-picker";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import { ModelViewer } from "@/components/model-viewer";
import { CREDIT_COSTS } from "@/shared/credits";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const isWeb = Platform.OS === "web";
const isWide = isWeb && SCREEN_WIDTH > 768;

/* ===== 对比图数据 ===== */
const COMPARISON_IMAGES = {
  astronaut: {
    title: "宇航员模型",
    desc: "左：精雕 3D + PBR 材质（颜色、光照、细节完整）\n右：闪电 3D 基础 mesh（几何结构清晰，无材质）",
    url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/dw5mTl5cKGtD.webp",
  },
  cartoon: {
    title: "卡通角色转换",
    desc: "2D 图片 → 3D 模型，卷发、格子衬衫、相机细节完美还原",
    url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/4DcnKuTCvPgM.jpg",
  },
  warrior: {
    title: "高精度角色",
    desc: "Hunyuan3D 3.1 Pro 生成，毛发纹理、盔甲、腰带扣等细节极致还原",
    url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/zre1qFWcy4sn.jpg",
  },
};

/* ===== 模式定义 ===== */
type ModelTier = "rapid" | "pro";

interface TierConfig {
  id: ModelTier;
  name: string;
  subtitle: string;
  speed: string;
  baseCredits: number;
  apiCost: string;
  color: string;
  icon: string;
  features: string[];
  badge?: string;
}

const TIERS: TierConfig[] = [
  {
    id: "rapid",
    name: "闪电 3D",
    subtitle: "Rapid · 快速预览",
    speed: "15-30 秒",
    baseCredits: 5,
    apiCost: "$0.225",
    color: "#64D2FF",
    icon: "flash-on",
    badge: "推荐入门",
    features: [
      "15-30 秒极速生成",
      "中等几何精度",
      "支持 GLB / OBJ 导出",
      "可选 PBR 材质（+3 Credits）",
    ],
  },
  {
    id: "pro",
    name: "精雕 3D",
    subtitle: "Pro · 高精度",
    speed: "45-90 秒",
    baseCredits: 9,
    apiCost: "$0.375",
    color: "#FFD60A",
    icon: "auto-awesome",
    badge: "专业品质",
    features: [
      "高精度曲面平滑",
      "纹理细腻，颜色精准",
      "支持 GLB / OBJ 导出",
      "可选 PBR + 多视角 + 自定义面数",
    ],
  },
];

/* ===== 维度系列定价包 ===== */
interface PricingPack {
  name: string;
  subtitle: string;
  contents: string;
  price: string;
  discount: string;
  color: string;
  popular?: boolean;
}

const DIMENSION_PACKS: PricingPack[] = [
  { name: "维度·体验包", subtitle: "新用户专享", contents: "闪电 3D × 3 次", price: "免费", discount: "", color: "#30D158" },
  { name: "维度·探索包", subtitle: "入门创作", contents: "闪电 3D × 10 + 精雕 3D × 2", price: "¥58", discount: "约 85 折", color: "#64D2FF" },
  { name: "维度·创作包", subtitle: "进阶创作", contents: "闪电 3D × 20 + 精雕 3D × 10（含 PBR）", price: "¥168", discount: "约 75 折", color: "#C77DBA", popular: true },
  { name: "维度·大师包", subtitle: "专业制作", contents: "精雕 3D × 30（含 PBR）+ 多视角 × 10", price: "¥358", discount: "约 70 折", color: "#FFD60A" },
  { name: "维度·工作室包", subtitle: "团队/企业", contents: "精雕 3D × 100（全选项）", price: "¥888", discount: "约 65 折", color: "#FF6B6B" },
];

/* ===== 3D 软件兼容列表 ===== */
const COMPATIBLE_SOFTWARE = [
  { name: "Blender", icon: "3d-rotation", desc: "免费开源" },
  { name: "Unity", icon: "sports-esports", desc: "游戏引擎" },
  { name: "Unreal", icon: "videogame-asset", desc: "虚幻引擎" },
  { name: "Maya", icon: "architecture", desc: "专业建模" },
  { name: "Cinema 4D", icon: "movie-creation", desc: "动态设计" },
  { name: "3ds Max", icon: "view-in-ar", desc: "建筑可视化" },
];

/* ===== 主组件 ===== */
export default function ThreeDStudioScreen() {
  const { user, isAuthenticated } = useAuth();

  // 状态
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<ModelTier>("rapid");
  const [enablePbr, setEnablePbr] = useState(false);
  const [enableMultiview, setEnableMultiview] = useState(false);
  const [enableCustomFaces, setEnableCustomFaces] = useState(false);
  const [targetFaceCount, setTargetFaceCount] = useState(50000);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");
  const [generatedResult, setGeneratedResult] = useState<{
    glbUrl: string;
    objUrl?: string;
    textureUrl?: string;
    previewUrl?: string;
    formats: string[];
    timeTaken: number;
    creditsUsed: number;
    tier: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"generate" | "compare" | "pricing">("generate");
  const [error, setError] = useState<string | null>(null);

  // 计算 Credits
  const calculateCredits = useCallback(() => {
    if (selectedTier === "rapid") {
      return enablePbr ? 8 : 5;
    }
    // Pro
    if (enablePbr && enableMultiview && enableCustomFaces) return 18;
    if (enablePbr && enableMultiview) return 15;
    if (enablePbr) return 12;
    return 9;
  }, [selectedTier, enablePbr, enableMultiview, enableCustomFaces]);

  // 选择图片
  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        setError("需要相册权限才能选择图片");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 1,
      });
      if (!result.canceled && result.assets[0]) {
        setSelectedImage(result.assets[0].uri);
        setGeneratedResult(null);
        setError(null);
      }
    } catch (e) {
      setError("选择图片失败，请重试");
    }
  };

  const generateMutation = trpc.hunyuan3d.generate.useMutation();

  // 计算当前配置的 Credits 费用
  const getCreditsRequired = () => {
    if (selectedTier === "rapid") {
      return enablePbr ? CREDIT_COSTS.rapid3D_pbr : CREDIT_COSTS.rapid3D;
    }
    if (enablePbr && enableMultiview && enableCustomFaces) return CREDIT_COSTS.pro3D_full;
    if (enablePbr && enableMultiview) return CREDIT_COSTS.pro3D_pbr_mv;
    if (enablePbr) return CREDIT_COSTS.pro3D_pbr;
    return CREDIT_COSTS.pro3D;
  };

  // 生成 3D 模型
  const doGenerate = async () => {
    try {
      setIsGenerating(true);
      setError(null);
      setGenerationProgress(selectedTier === "rapid" ? "闪电模式生成中，预计 15-30 秒..." : "精雕模式生成中，预计 45-90 秒...");

      const result = await generateMutation.mutateAsync({
        imageUrl: selectedImage!,
        tier: selectedTier,
        enablePbr,
        targetFaceCount: enableCustomFaces ? targetFaceCount : undefined,
      });

      if (!result.success || !result.output) {
        throw new Error("生成失败，请重试");
      }

      setGeneratedResult({
        glbUrl: result.output.model_url,
        objUrl: result.output.obj_url,
        textureUrl: result.output.texture_url,
        previewUrl: result.output.preview_url,
        formats: result.output.available_formats,
        timeTaken: result.timeTaken ?? 0,
        creditsUsed: result.creditsUsed,
        tier: result.tier,
      });

      setGenerationProgress("");
    } catch (e: any) {
      setError(e.message || "生成失败，请重试");
      setGenerationProgress("");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = () => {
    if (!selectedImage) {
      setError("请先选择一张图片");
      return;
    }
    if (!isAuthenticated) {
      setError("请先登录");
      return;
    }
    const credits = getCreditsRequired();
    const tierLabel = selectedTier === "rapid" ? "闪电 3D (Rapid)" : "精雕 3D (Pro)";
    const extras = [
      enablePbr && "PBR 材质",
      enableMultiview && "多视角",
      enableCustomFaces && "自定义面数",
    ].filter(Boolean).join(" + ");
    const desc = `${tierLabel}${extras ? ` + ${extras}` : ""}`;

    if (Platform.OS === "web") {
      const confirmed = window.confirm(`即将扣除 ${credits} Credits\n\n模式：${desc}\n预计时间：${selectedTier === "rapid" ? "15-30 秒" : "45-90 秒"}\n\n确认继续？`);
      if (confirmed) doGenerate();
    } else {
      Alert.alert(
        "确认生成 3D 模型",
        `即将扣除 ${credits} Credits\n\n模式：${desc}\n预计时间：${selectedTier === "rapid" ? "15-30 秒" : "45-90 秒"}`,
        [
          { text: "取消", style: "cancel" },
          { text: "确认生成", onPress: doGenerate },
        ]
      );
    }
  };

  // 下载模型
  const handleDownload = (url: string, format: string) => {
    if (isWeb) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `mv-studio-3d-model.${format}`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      Linking.openURL(url);
    }
  };

  return (
    <ScreenContainer edges={isWeb ? [] : ["top", "left", "right"]} containerClassName="bg-background">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>

        {/* ===== 页面标题 ===== */}
        <View style={s.header}>
          <View style={s.headerBg} />
          <View style={s.headerContent}>
            <View style={s.titleBadge}>
              <MaterialIcons name="view-in-ar" size={14} color="#FFD60A" />
              <Text style={s.titleBadgeText}>HUNYUAN3D v3.1</Text>
            </View>
            <Text style={s.title}>2D 转 3D 工作室</Text>
            <Text style={s.subtitle}>
              上传任意 2D 图片，AI 自动生成高质量 3D 模型{"\n"}
              支持 GLB / OBJ 格式导出，可直接导入 Blender、Unity、Unreal
            </Text>
          </View>
        </View>

        {/* ===== Tab 切换 ===== */}
        <View style={s.tabBar}>
          {([
            { key: "generate", label: "生成模型", icon: "auto-fix-high" },
            { key: "compare", label: "效果对比", icon: "compare" },
            { key: "pricing", label: "维度定价包", icon: "local-offer" },
          ] as const).map((tab) => (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={[s.tabItem, activeTab === tab.key && s.tabItemActive]}
              activeOpacity={0.7}
            >
              <MaterialIcons
                name={tab.icon as any}
                size={18}
                color={activeTab === tab.key ? "#FFD60A" : "#9B9691"}
              />
              <Text style={[s.tabLabel, activeTab === tab.key && s.tabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ===== Tab: 生成模型 ===== */}
        {activeTab === "generate" && (
          <View style={s.section}>
            {/* 模式选择 */}
            <Text style={s.sectionTitle}>选择生成模式</Text>
            <View style={s.tierGrid}>
              {TIERS.map((tier) => {
                const isSelected = selectedTier === tier.id;
                return (
                  <TouchableOpacity
                    key={tier.id}
                    onPress={() => {
                      setSelectedTier(tier.id);
                      if (tier.id === "rapid") {
                        setEnableMultiview(false);
                        setEnableCustomFaces(false);
                      }
                    }}
                    style={[
                      s.tierCard,
                      { borderColor: isSelected ? tier.color : "#2A2A2E" },
                      isSelected && { backgroundColor: `${tier.color}10` },
                    ]}
                    activeOpacity={0.7}
                  >
                    {tier.badge && (
                      <View style={[s.tierBadge, { backgroundColor: `${tier.color}25` }]}>
                        <Text style={[s.tierBadgeText, { color: tier.color }]}>{tier.badge}</Text>
                      </View>
                    )}
                    <View style={[s.tierIconWrap, { backgroundColor: `${tier.color}20` }]}>
                      <MaterialIcons name={tier.icon as any} size={28} color={tier.color} />
                    </View>
                    <Text style={s.tierName}>{tier.name}</Text>
                    <Text style={s.tierSubtitle}>{tier.subtitle}</Text>
                    <View style={s.tierMeta}>
                      <MaterialIcons name="timer" size={14} color="#9B9691" />
                      <Text style={s.tierMetaText}>{tier.speed}</Text>
                    </View>
                    <View style={s.tierMeta}>
                      <MaterialIcons name="toll" size={14} color={tier.color} />
                      <Text style={[s.tierMetaText, { color: tier.color, fontWeight: "700" }]}>
                        {tier.baseCredits} Credits 起
                      </Text>
                    </View>
                    <View style={s.tierFeatures}>
                      {tier.features.map((f, i) => (
                        <View key={i} style={s.tierFeatureRow}>
                          <MaterialIcons name="check-circle" size={14} color={tier.color} />
                          <Text style={s.tierFeatureText}>{f}</Text>
                        </View>
                      ))}
                    </View>
                    {isSelected && (
                      <View style={[s.selectedIndicator, { backgroundColor: tier.color }]}>
                        <MaterialIcons name="check" size={16} color="#000" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 图片上传 */}
            <Text style={[s.sectionTitle, { marginTop: 32 }]}>上传 2D 图片</Text>
            <View style={s.uploadArea}>
              {selectedImage ? (
                <View style={s.uploadedPreview}>
                  <Image
                    source={{ uri: selectedImage }}
                    style={s.uploadedImage}
                    contentFit="contain"
                  />
                  <TouchableOpacity onPress={pickImage} style={s.reuploadBtn} activeOpacity={0.7}>
                    <MaterialIcons name="refresh" size={18} color="#FFF" />
                    <Text style={s.reuploadText}>重新选择</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={pickImage} style={s.uploadPlaceholder} activeOpacity={0.7}>
                  <View style={s.uploadIconWrap}>
                    <MaterialIcons name="cloud-upload" size={48} color="#64D2FF" />
                  </View>
                  <Text style={s.uploadTitle}>点击上传图片</Text>
                  <Text style={s.uploadHint}>支持 JPG、PNG、WebP 格式</Text>
                  <Text style={s.uploadTip}>建议使用纯色背景、主体清晰的图片效果最佳</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* 增强选项 */}
            {selectedImage && (
              <>
                <Text style={[s.sectionTitle, { marginTop: 32 }]}>增强选项</Text>
                <View style={s.optionsGrid}>
                  {/* PBR 材质 */}
                  <TouchableOpacity
                    onPress={() => setEnablePbr(!enablePbr)}
                    style={[s.optionCard, enablePbr && s.optionCardActive]}
                    activeOpacity={0.7}
                  >
                    <View style={s.optionHeader}>
                      <MaterialIcons
                        name={enablePbr ? "check-box" : "check-box-outline-blank"}
                        size={22}
                        color={enablePbr ? "#30D158" : "#6B6762"}
                      />
                      <Text style={s.optionCredits}>+3 Credits</Text>
                    </View>
                    <Text style={s.optionTitle}>PBR 真实材质</Text>
                    <Text style={s.optionDesc}>添加物理渲染材质，光照、反射、粗糙度更真实</Text>
                  </TouchableOpacity>

                  {/* 多视角（仅 Pro） */}
                  <TouchableOpacity
                    onPress={() => selectedTier === "pro" && setEnableMultiview(!enableMultiview)}
                    style={[
                      s.optionCard,
                      enableMultiview && s.optionCardActive,
                      selectedTier !== "pro" && s.optionCardDisabled,
                    ]}
                    activeOpacity={0.7}
                    disabled={selectedTier !== "pro"}
                  >
                    <View style={s.optionHeader}>
                      <MaterialIcons
                        name={enableMultiview ? "check-box" : "check-box-outline-blank"}
                        size={22}
                        color={enableMultiview ? "#30D158" : "#6B6762"}
                      />
                      <Text style={s.optionCredits}>+3 Credits</Text>
                    </View>
                    <Text style={s.optionTitle}>多视角增强</Text>
                    <Text style={s.optionDesc}>
                      {selectedTier === "pro" ? "上传多角度照片，提升 3D 还原精度" : "仅精雕模式可用"}
                    </Text>
                    {selectedTier !== "pro" && (
                      <View style={s.proOnlyBadge}>
                        <Text style={s.proOnlyText}>精雕专属</Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  {/* 自定义面数（仅 Pro） */}
                  <TouchableOpacity
                    onPress={() => selectedTier === "pro" && setEnableCustomFaces(!enableCustomFaces)}
                    style={[
                      s.optionCard,
                      enableCustomFaces && s.optionCardActive,
                      selectedTier !== "pro" && s.optionCardDisabled,
                    ]}
                    activeOpacity={0.7}
                    disabled={selectedTier !== "pro"}
                  >
                    <View style={s.optionHeader}>
                      <MaterialIcons
                        name={enableCustomFaces ? "check-box" : "check-box-outline-blank"}
                        size={22}
                        color={enableCustomFaces ? "#30D158" : "#6B6762"}
                      />
                      <Text style={s.optionCredits}>+3 Credits</Text>
                    </View>
                    <Text style={s.optionTitle}>自定义精度</Text>
                    <Text style={s.optionDesc}>
                      {selectedTier === "pro" ? "指定模型面数，适配不同 3D 引擎需求" : "仅精雕模式可用"}
                    </Text>
                    {selectedTier !== "pro" && (
                      <View style={s.proOnlyBadge}>
                        <Text style={s.proOnlyText}>精雕专属</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>

                {/* 费用汇总 */}
                <View style={s.costSummary}>
                  <View style={s.costRow}>
                    <Text style={s.costLabel}>
                      {selectedTier === "rapid" ? "闪电 3D" : "精雕 3D"} 基础
                    </Text>
                    <Text style={s.costValue}>{selectedTier === "rapid" ? 5 : 9} Credits</Text>
                  </View>
                  {enablePbr && (
                    <View style={s.costRow}>
                      <Text style={s.costLabel}>+ PBR 真实材质</Text>
                      <Text style={s.costValue}>3 Credits</Text>
                    </View>
                  )}
                  {enableMultiview && selectedTier === "pro" && (
                    <View style={s.costRow}>
                      <Text style={s.costLabel}>+ 多视角增强</Text>
                      <Text style={s.costValue}>3 Credits</Text>
                    </View>
                  )}
                  {enableCustomFaces && selectedTier === "pro" && (
                    <View style={s.costRow}>
                      <Text style={s.costLabel}>+ 自定义精度</Text>
                      <Text style={s.costValue}>3 Credits</Text>
                    </View>
                  )}
                  <View style={[s.costRow, s.costTotal]}>
                    <Text style={s.costTotalLabel}>合计消耗</Text>
                    <Text style={s.costTotalValue}>{calculateCredits()} Credits</Text>
                  </View>
                </View>

                {/* 生成按钮 */}
                <TouchableOpacity
                  onPress={handleGenerate}
                  disabled={isGenerating}
                  style={[s.generateBtn, isGenerating && { opacity: 0.6 }]}
                  activeOpacity={0.8}
                >
                  {isGenerating ? (
                    <View style={s.generateBtnInner}>
                      <ActivityIndicator color="#000" size="small" />
                      <Text style={s.generateBtnText}>{generationProgress || "生成中..."}</Text>
                    </View>
                  ) : (
                    <View style={s.generateBtnInner}>
                      <MaterialIcons name="auto-fix-high" size={22} color="#000" />
                      <Text style={s.generateBtnText}>生成 3D 模型</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {/* 错误提示 */}
                {error && (
                  <View style={s.errorBox}>
                    <MaterialIcons name="error-outline" size={18} color="#FF6B6B" />
                    <Text style={s.errorText}>{error}</Text>
                  </View>
                )}
              </>
            )}

            {/* ===== 生成结果 + 导出 ===== */}
            {generatedResult && (
              <View style={s.resultSection}>
                <View style={s.resultHeader}>
                  <MaterialIcons name="check-circle" size={24} color="#30D158" />
                  <Text style={s.resultTitle}>3D 模型生成完成</Text>
                </View>

                <View style={s.resultMeta}>
                  <View style={s.resultMetaItem}>
                    <Text style={s.resultMetaLabel}>模式</Text>
                    <Text style={s.resultMetaValue}>
                      {generatedResult.tier === "rapid" ? "闪电 3D" : "精雕 3D"}
                    </Text>
                  </View>
                  <View style={s.resultMetaItem}>
                    <Text style={s.resultMetaLabel}>耗时</Text>
                    <Text style={s.resultMetaValue}>{generatedResult.timeTaken.toFixed(1)} 秒</Text>
                  </View>
                  <View style={s.resultMetaItem}>
                    <Text style={s.resultMetaLabel}>消耗</Text>
                    <Text style={[s.resultMetaValue, { color: "#FFD60A" }]}>
                      {generatedResult.creditsUsed} Credits
                    </Text>
                  </View>
                </View>

                {/* 3D 互动预览器 */}
                <View style={s.previewBox}>
                  <ModelViewer
                    glbUrl={generatedResult.glbUrl}
                    objUrl={generatedResult.objUrl}
                    textureUrl={generatedResult.textureUrl}
                    thumbnailUrl={generatedResult.previewUrl}
                    height={isWide ? 400 : 280}
                    autoRotate={true}
                  />
                </View>

                {/* 导出按钮 */}
                <Text style={[s.sectionTitle, { marginTop: 24 }]}>导出 3D 模型文件</Text>
                <Text style={s.exportHint}>
                  下载后可直接导入 Blender、Unity、Unreal Engine 等 3D 软件
                </Text>

                <View style={s.exportGrid}>
                  {/* GLB 导出 */}
                  <TouchableOpacity
                    onPress={() => handleDownload(generatedResult.glbUrl, "glb")}
                    style={[s.exportCard, { borderColor: "#64D2FF" }]}
                    activeOpacity={0.7}
                  >
                    <View style={[s.exportIconWrap, { backgroundColor: "rgba(100,210,255,0.15)" }]}>
                      <MaterialIcons name="view-in-ar" size={32} color="#64D2FF" />
                    </View>
                    <Text style={s.exportFormat}>GLB 格式</Text>
                    <Text style={s.exportDesc}>
                      二进制 glTF，包含模型+材质+纹理{"\n"}
                      推荐用于 Web / Unity / Blender
                    </Text>
                    <View style={[s.downloadBtn, { backgroundColor: "#64D2FF" }]}>
                      <MaterialIcons name="file-download" size={18} color="#000" />
                      <Text style={s.downloadBtnText}>下载 .glb</Text>
                    </View>
                  </TouchableOpacity>

                  {/* OBJ 导出 */}
                  <TouchableOpacity
                    onPress={() => generatedResult.objUrl && handleDownload(generatedResult.objUrl, "obj")}
                    style={[s.exportCard, { borderColor: "#FFD60A" }]}
                    activeOpacity={0.7}
                  >
                    <View style={[s.exportIconWrap, { backgroundColor: "rgba(255,214,10,0.15)" }]}>
                      <MaterialIcons name="layers" size={32} color="#FFD60A" />
                    </View>
                    <Text style={s.exportFormat}>OBJ 格式</Text>
                    <Text style={s.exportDesc}>
                      通用 3D 格式，兼容性最广{"\n"}
                      推荐用于 Maya / 3ds Max / Cinema 4D
                    </Text>
                    <View style={[s.downloadBtn, { backgroundColor: "#FFD60A" }]}>
                      <MaterialIcons name="file-download" size={18} color="#000" />
                      <Text style={s.downloadBtnText}>下载 .obj</Text>
                    </View>
                  </TouchableOpacity>
                </View>

                {/* 纹理贴图 */}
                {generatedResult.textureUrl && (
                  <TouchableOpacity
                    onPress={() => handleDownload(generatedResult.textureUrl!, "png")}
                    style={s.textureDownload}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="texture" size={20} color="#C77DBA" />
                    <Text style={s.textureDownloadText}>下载纹理贴图 (.png)</Text>
                    <MaterialIcons name="file-download" size={18} color="#C77DBA" />
                  </TouchableOpacity>
                )}

                {/* 兼容软件列表 */}
                <View style={s.compatSection}>
                  <Text style={s.compatTitle}>兼容 3D 软件</Text>
                  <View style={s.compatGrid}>
                    {COMPATIBLE_SOFTWARE.map((sw) => (
                      <View key={sw.name} style={s.compatItem}>
                        <MaterialIcons name={sw.icon as any} size={20} color="#9B9691" />
                        <Text style={s.compatName}>{sw.name}</Text>
                        <Text style={s.compatDesc}>{sw.desc}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ===== Tab: 效果对比 ===== */}
        {activeTab === "compare" && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>闪电 3D vs 精雕 3D 效果对比</Text>
            <Text style={s.sectionDesc}>
              基于 Hunyuan3D v3.1 实际生成效果，帮助您选择最适合的模式
            </Text>

            {/* 对比表格 */}
            <View style={s.compareTable}>
              <View style={s.compareTableHeader}>
                <Text style={[s.compareTableCell, s.compareTableHeaderText, { flex: 1.5 }]}>对比维度</Text>
                <Text style={[s.compareTableCell, s.compareTableHeaderText, { flex: 2, color: "#64D2FF" }]}>闪电 3D (Rapid)</Text>
                <Text style={[s.compareTableCell, s.compareTableHeaderText, { flex: 2, color: "#FFD60A" }]}>精雕 3D (Pro)</Text>
              </View>
              {[
                ["生成速度", "15-30 秒", "45-90 秒"],
                ["几何精度", "中等，边缘有锯齿", "高，曲面平滑"],
                ["纹理还原", "颜色大致准确", "颜色精准，渐变自然"],
                ["面部细节", "五官轮廓正确", "表情、皮肤纹理清晰"],
                ["PBR 材质", "支持（+3 Credits）", "支持（效果更好）"],
                ["多视角输入", "不支持", "支持（+3 Credits）"],
                ["自定义面数", "不支持", "支持（+3 Credits）"],
                ["Credits", "5 Credits 起", "9 Credits 起"],
                ["导出格式", "GLB / OBJ", "GLB / OBJ"],
              ].map(([label, rapid, pro], i) => (
                <View key={i} style={[s.compareTableRow, i % 2 === 0 && s.compareTableRowAlt]}>
                  <Text style={[s.compareTableCell, { flex: 1.5, fontWeight: "600", color: "#F7F4EF" }]}>{label}</Text>
                  <Text style={[s.compareTableCell, { flex: 2 }]}>{rapid}</Text>
                  <Text style={[s.compareTableCell, { flex: 2 }]}>{pro}</Text>
                </View>
              ))}
            </View>

            {/* 对比图展示 */}
            <Text style={[s.sectionTitle, { marginTop: 40 }]}>实际效果展示</Text>
            {Object.entries(COMPARISON_IMAGES).map(([key, img]) => (
              <View key={key} style={s.compareImageCard}>
                <Image source={{ uri: img.url }} style={s.compareImage} contentFit="cover" />
                <View style={s.compareImageInfo}>
                  <Text style={s.compareImageTitle}>{img.title}</Text>
                  <Text style={s.compareImageDesc}>{img.desc}</Text>
                </View>
              </View>
            ))}

            {/* 适用场景 */}
            <Text style={[s.sectionTitle, { marginTop: 40 }]}>适用场景建议</Text>
            <View style={s.scenarioGrid}>
              {[
                { scene: "快速预览 / 概念验证", tier: "闪电 3D", reason: "速度快、成本低", color: "#64D2FF" },
                { scene: "社交媒体展示", tier: "闪电 3D + PBR", reason: "加材质后视觉效果提升明显", color: "#64D2FF" },
                { scene: "商业用途 / 产品展示", tier: "精雕 3D + PBR", reason: "细节精准，适合正式发布", color: "#FFD60A" },
                { scene: "游戏 / 动画资产", tier: "精雕 3D + 全选项", reason: "可控制面数适配引擎需求", color: "#FFD60A" },
                { scene: "3D 打印", tier: "精雕 3D", reason: "几何精度高，打印效果好", color: "#FFD60A" },
              ].map((item, i) => (
                <View key={i} style={[s.scenarioCard, { borderLeftColor: item.color }]}>
                  <Text style={s.scenarioScene}>{item.scene}</Text>
                  <View style={s.scenarioTierRow}>
                    <MaterialIcons name="arrow-forward" size={14} color={item.color} />
                    <Text style={[s.scenarioTier, { color: item.color }]}>{item.tier}</Text>
                  </View>
                  <Text style={s.scenarioReason}>{item.reason}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ===== Tab: 维度定价包 ===== */}
        {activeTab === "pricing" && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>维度系列 · 3D 专属收费包</Text>
            <Text style={s.sectionDesc}>
              为重度 3D 用户提供专属优惠包，批量购买更划算
            </Text>

            <View style={s.pricingGrid}>
              {DIMENSION_PACKS.map((pack, i) => (
                <View
                  key={i}
                  style={[
                    s.pricingCard,
                    { borderColor: pack.color },
                    pack.popular && s.pricingCardPopular,
                  ]}
                >
                  {pack.popular && (
                    <View style={[s.popularBadge, { backgroundColor: pack.color }]}>
                      <Text style={s.popularBadgeText}>最受欢迎</Text>
                    </View>
                  )}
                  <Text style={[s.pricingName, { color: pack.color }]}>{pack.name}</Text>
                  <Text style={s.pricingSubtitle}>{pack.subtitle}</Text>
                  <Text style={s.pricingPrice}>{pack.price}</Text>
                  {pack.discount ? (
                    <Text style={s.pricingDiscount}>{pack.discount}</Text>
                  ) : null}
                  <View style={s.pricingDivider} />
                  <Text style={s.pricingContents}>{pack.contents}</Text>
                  <TouchableOpacity
                    style={[s.pricingBtn, { backgroundColor: `${pack.color}20`, borderColor: pack.color }]}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.pricingBtnText, { color: pack.color }]}>
                      {pack.price === "免费" ? "立即领取" : "立即购买"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            {/* 订阅方案内含额度 */}
            <Text style={[s.sectionTitle, { marginTop: 40 }]}>订阅方案 · 每月 3D 额度</Text>
            <View style={s.subTable}>
              <View style={s.subTableHeader}>
                <Text style={[s.subTableCell, { flex: 1.5, fontWeight: "700", color: "#F7F4EF" }]}>订阅等级</Text>
                <Text style={[s.subTableCell, { flex: 2, fontWeight: "700", color: "#F7F4EF" }]}>每月 3D 额度</Text>
                <Text style={[s.subTableCell, { flex: 1.5, fontWeight: "700", color: "#F7F4EF" }]}>可用模式</Text>
              </View>
              {[
                ["免费版", "闪电 3D × 3 次", "仅闪电"],
                ["专业版 ¥108/月", "闪电 × 15 + 精雕 × 5", "全部"],
                ["企业版 ¥358/月", "闪电 × 50 + 精雕 × 20", "全部 + 优先"],
                ["学生版", "闪电 × 8 + 精雕 × 2", "全部"],
              ].map(([plan, quota, mode], i) => (
                <View key={i} style={[s.subTableRow, i % 2 === 0 && s.subTableRowAlt]}>
                  <Text style={[s.subTableCell, { flex: 1.5, fontWeight: "600", color: "#F7F4EF" }]}>{plan}</Text>
                  <Text style={[s.subTableCell, { flex: 2 }]}>{quota}</Text>
                  <Text style={[s.subTableCell, { flex: 1.5 }]}>{mode}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ===== 底部间距 ===== */}
        <View style={{ height: 80 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

/* ===== 样式 ===== */
const s = StyleSheet.create({
  /* Header */
  header: {
    paddingVertical: isWide ? 60 : 40,
    paddingHorizontal: 24,
    position: "relative",
    overflow: "hidden",
  },
  headerBg: {
    ...(isWeb ? {
      position: "absolute" as any, top: 0, left: 0, right: 0, bottom: 0,
      backgroundImage: "linear-gradient(135deg, rgba(100,210,255,0.12) 0%, rgba(255,214,10,0.08) 50%, rgba(199,125,186,0.10) 100%)",
    } as any : { backgroundColor: "#101012" }),
  },
  headerContent: { alignItems: "center", zIndex: 2 },
  titleBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    backgroundColor: "rgba(255,214,10,0.15)", borderWidth: 1, borderColor: "rgba(255,214,10,0.30)",
    marginBottom: 16,
  },
  titleBadgeText: { fontSize: 11, fontWeight: "700", color: "#FFD60A", letterSpacing: 1.5 },
  title: {
    fontSize: isWide ? 42 : 28, fontWeight: "800", color: "#FFFFFF",
    textAlign: "center", letterSpacing: -1,
  },
  subtitle: {
    fontSize: isWide ? 16 : 14, color: "#B5B0AB", textAlign: "center",
    marginTop: 12, lineHeight: isWide ? 26 : 22, maxWidth: 500,
  },

  /* Tab Bar */
  tabBar: {
    flexDirection: "row", justifyContent: "center", gap: 8,
    paddingHorizontal: 24, paddingVertical: 12,
    backgroundColor: "#0D0D0F",
    borderBottomWidth: 1, borderBottomColor: "#2A2A2E",
  },
  tabItem: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
    backgroundColor: "#1A1A1D",
  },
  tabItemActive: {
    backgroundColor: "rgba(255,214,10,0.12)",
    borderWidth: 1, borderColor: "rgba(255,214,10,0.30)",
  },
  tabLabel: { fontSize: 13, fontWeight: "600", color: "#9B9691" },
  tabLabelActive: { color: "#FFD60A" },

  /* Section */
  section: {
    paddingHorizontal: isWide ? 60 : 20,
    paddingTop: 32,
    maxWidth: 1100,
    alignSelf: "center",
    width: "100%",
  },
  sectionTitle: {
    fontSize: isWide ? 24 : 20, fontWeight: "700", color: "#F7F4EF",
    marginBottom: 8,
  },
  sectionDesc: {
    fontSize: 14, color: "#9B9691", lineHeight: 22, marginBottom: 24,
  },

  /* Tier Cards */
  tierGrid: {
    flexDirection: isWide ? "row" : "column",
    gap: 16, marginTop: 16,
  },
  tierCard: {
    flex: 1, backgroundColor: "#1A1A1D", borderRadius: 20,
    padding: 24, borderWidth: 2, position: "relative", overflow: "hidden",
  },
  tierBadge: {
    position: "absolute", top: 16, right: 16,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
  },
  tierBadgeText: { fontSize: 11, fontWeight: "700" },
  tierIconWrap: {
    width: 56, height: 56, borderRadius: 16,
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  tierName: { fontSize: 22, fontWeight: "800", color: "#F7F4EF", marginBottom: 4 },
  tierSubtitle: { fontSize: 13, color: "#9B9691", marginBottom: 16 },
  tierMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  tierMetaText: { fontSize: 13, color: "#9B9691" },
  tierFeatures: { marginTop: 12, gap: 8 },
  tierFeatureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tierFeatureText: { fontSize: 13, color: "#B5B0AB" },
  selectedIndicator: {
    position: "absolute", top: 16, left: 16,
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },

  /* Upload */
  uploadArea: {
    marginTop: 16, borderRadius: 20, overflow: "hidden",
    backgroundColor: "#1A1A1D", borderWidth: 2, borderColor: "#2A2A2E",
    borderStyle: "dashed",
  },
  uploadPlaceholder: {
    alignItems: "center", justifyContent: "center",
    paddingVertical: 48, paddingHorizontal: 24,
  },
  uploadIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "rgba(100,210,255,0.10)",
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  uploadTitle: { fontSize: 18, fontWeight: "700", color: "#F7F4EF", marginBottom: 8 },
  uploadHint: { fontSize: 14, color: "#9B9691" },
  uploadTip: { fontSize: 12, color: "#6B6762", marginTop: 8, textAlign: "center" },
  uploadedPreview: { position: "relative" },
  uploadedImage: { width: "100%", height: isWide ? 400 : 280 },
  reuploadBtn: {
    position: "absolute", bottom: 16, right: 16,
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  reuploadText: { fontSize: 13, fontWeight: "600", color: "#FFF" },

  /* Options */
  optionsGrid: {
    flexDirection: isWide ? "row" : "column",
    gap: 12, marginTop: 16,
  },
  optionCard: {
    flex: 1, backgroundColor: "#1A1A1D", borderRadius: 16,
    padding: 16, borderWidth: 1.5, borderColor: "#2A2A2E",
    position: "relative",
  },
  optionCardActive: { borderColor: "#30D158", backgroundColor: "rgba(48,209,88,0.06)" },
  optionCardDisabled: { opacity: 0.5 },
  optionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  optionCredits: { fontSize: 12, fontWeight: "700", color: "#FFD60A" },
  optionTitle: { fontSize: 15, fontWeight: "700", color: "#F7F4EF", marginBottom: 4 },
  optionDesc: { fontSize: 12, color: "#9B9691", lineHeight: 18 },
  proOnlyBadge: {
    position: "absolute", top: 8, right: 8,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
    backgroundColor: "rgba(255,214,10,0.15)",
  },
  proOnlyText: { fontSize: 10, fontWeight: "700", color: "#FFD60A" },

  /* Cost Summary */
  costSummary: {
    marginTop: 24, backgroundColor: "#1A1A1D", borderRadius: 16,
    padding: 20, borderWidth: 1, borderColor: "#2A2A2E",
  },
  costRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 8,
  },
  costLabel: { fontSize: 14, color: "#9B9691" },
  costValue: { fontSize: 14, color: "#F7F4EF", fontWeight: "600" },
  costTotal: {
    borderTopWidth: 1, borderTopColor: "#2A2A2E",
    marginTop: 8, paddingTop: 12,
  },
  costTotalLabel: { fontSize: 16, fontWeight: "700", color: "#F7F4EF" },
  costTotalValue: { fontSize: 20, fontWeight: "800", color: "#FFD60A" },

  /* Generate Button */
  generateBtn: {
    marginTop: 24, borderRadius: 16, paddingVertical: 18,
    alignItems: "center", justifyContent: "center",
    ...(isWeb ? {
      backgroundImage: "linear-gradient(135deg, #64D2FF 0%, #FFD60A 50%, #30D158 100%)",
    } as any : { backgroundColor: "#64D2FF" }),
  },
  generateBtnInner: { flexDirection: "row", alignItems: "center", gap: 10 },
  generateBtnText: { fontSize: 17, fontWeight: "800", color: "#000" },

  /* Error */
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 16, padding: 14, borderRadius: 12,
    backgroundColor: "rgba(255,107,107,0.10)", borderWidth: 1, borderColor: "rgba(255,107,107,0.30)",
  },
  errorText: { fontSize: 13, color: "#FF6B6B", flex: 1 },

  /* Result Section */
  resultSection: {
    marginTop: 40, backgroundColor: "#1A1A1D", borderRadius: 20,
    padding: 24, borderWidth: 1.5, borderColor: "#30D158",
  },
  resultHeader: {
    flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20,
  },
  resultTitle: { fontSize: 20, fontWeight: "700", color: "#F7F4EF" },
  resultMeta: {
    flexDirection: "row", gap: 16, marginBottom: 20,
    flexWrap: "wrap",
  },
  resultMetaItem: {
    backgroundColor: "#101012", borderRadius: 12, padding: 14, flex: 1, minWidth: 100,
  },
  resultMetaLabel: { fontSize: 12, color: "#9B9691", marginBottom: 4 },
  resultMetaValue: { fontSize: 16, fontWeight: "700", color: "#F7F4EF" },

  /* Preview */
  previewBox: {
    borderRadius: 16, overflow: "hidden", position: "relative",
    backgroundColor: "#101012",
  },
  previewImage: { width: "100%", height: isWide ? 350 : 220 },
  previewOverlay: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    alignItems: "center", paddingVertical: 16,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  previewHint: { fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 4 },

  /* Export */
  exportHint: { fontSize: 13, color: "#9B9691", marginBottom: 16 },
  exportGrid: {
    flexDirection: isWide ? "row" : "column", gap: 16,
  },
  exportCard: {
    flex: 1, backgroundColor: "#101012", borderRadius: 16,
    padding: 24, borderWidth: 1.5, alignItems: "center",
  },
  exportIconWrap: {
    width: 64, height: 64, borderRadius: 20,
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  exportFormat: { fontSize: 18, fontWeight: "800", color: "#F7F4EF", marginBottom: 8 },
  exportDesc: { fontSize: 12, color: "#9B9691", textAlign: "center", lineHeight: 18, marginBottom: 16 },
  downloadBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12,
  },
  downloadBtnText: { fontSize: 15, fontWeight: "700", color: "#000" },

  /* Texture Download */
  textureDownload: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, marginTop: 16, paddingVertical: 14, borderRadius: 12,
    backgroundColor: "rgba(199,125,186,0.10)", borderWidth: 1, borderColor: "rgba(199,125,186,0.30)",
  },
  textureDownloadText: { fontSize: 14, fontWeight: "600", color: "#C77DBA" },

  /* Compatible Software */
  compatSection: { marginTop: 24 },
  compatTitle: { fontSize: 15, fontWeight: "700", color: "#F7F4EF", marginBottom: 12 },
  compatGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 10,
  },
  compatItem: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: "#101012", borderWidth: 1, borderColor: "#2A2A2E",
  },
  compatName: { fontSize: 12, fontWeight: "600", color: "#F7F4EF" },
  compatDesc: { fontSize: 10, color: "#6B6762" },

  /* Compare Table */
  compareTable: {
    borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#2A2A2E",
  },
  compareTableHeader: {
    flexDirection: "row", backgroundColor: "#1A1A1D", paddingVertical: 14, paddingHorizontal: 12,
  },
  compareTableHeaderText: { fontWeight: "700", color: "#F7F4EF" },
  compareTableRow: {
    flexDirection: "row", paddingVertical: 12, paddingHorizontal: 12,
    borderTopWidth: 1, borderTopColor: "#2A2A2E",
  },
  compareTableRowAlt: { backgroundColor: "rgba(26,26,29,0.5)" },
  compareTableCell: { flex: 1, fontSize: 13, color: "#B5B0AB" },

  /* Compare Images */
  compareImageCard: {
    borderRadius: 16, overflow: "hidden", marginBottom: 20,
    backgroundColor: "#1A1A1D", borderWidth: 1, borderColor: "#2A2A2E",
  },
  compareImage: { width: "100%", height: isWide ? 320 : 200 },
  compareImageInfo: { padding: 16 },
  compareImageTitle: { fontSize: 16, fontWeight: "700", color: "#F7F4EF", marginBottom: 6 },
  compareImageDesc: { fontSize: 13, color: "#9B9691", lineHeight: 20 },

  /* Scenario */
  scenarioGrid: { gap: 12 },
  scenarioCard: {
    backgroundColor: "#1A1A1D", borderRadius: 14, padding: 16,
    borderLeftWidth: 4,
  },
  scenarioScene: { fontSize: 15, fontWeight: "700", color: "#F7F4EF", marginBottom: 6 },
  scenarioTierRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  scenarioTier: { fontSize: 14, fontWeight: "700" },
  scenarioReason: { fontSize: 12, color: "#9B9691" },

  /* Pricing Cards */
  pricingGrid: {
    flexDirection: isWide ? "row" : "column",
    flexWrap: "wrap", gap: 16,
  },
  pricingCard: {
    flex: isWide ? undefined : undefined,
    width: isWide ? "18%" : "100%",
    backgroundColor: "#1A1A1D", borderRadius: 18,
    padding: 24, borderWidth: 1.5, position: "relative",
    minWidth: isWide ? 180 : undefined,
  },
  pricingCardPopular: {
    ...(isWeb ? {
      boxShadow: "0 0 20px rgba(199,125,186,0.3)",
    } as any : {}),
  },
  popularBadge: {
    position: "absolute", top: -1, right: 20,
    paddingHorizontal: 12, paddingVertical: 4,
    borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
  },
  popularBadgeText: { fontSize: 11, fontWeight: "700", color: "#000" },
  pricingName: { fontSize: 18, fontWeight: "800", marginBottom: 4 },
  pricingSubtitle: { fontSize: 12, color: "#9B9691", marginBottom: 12 },
  pricingPrice: { fontSize: 28, fontWeight: "800", color: "#F7F4EF", marginBottom: 4 },
  pricingDiscount: { fontSize: 12, color: "#30D158", fontWeight: "600", marginBottom: 12 },
  pricingDivider: { height: 1, backgroundColor: "#2A2A2E", marginVertical: 12 },
  pricingContents: { fontSize: 13, color: "#B5B0AB", lineHeight: 20, marginBottom: 16 },
  pricingBtn: {
    paddingVertical: 12, borderRadius: 12, alignItems: "center",
    borderWidth: 1,
  },
  pricingBtnText: { fontSize: 14, fontWeight: "700" },

  /* Subscription Table */
  subTable: {
    borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#2A2A2E",
    marginTop: 16,
  },
  subTableHeader: {
    flexDirection: "row", backgroundColor: "#1A1A1D", paddingVertical: 14, paddingHorizontal: 12,
  },
  subTableRow: {
    flexDirection: "row", paddingVertical: 12, paddingHorizontal: 12,
    borderTopWidth: 1, borderTopColor: "#2A2A2E",
  },
  subTableRowAlt: { backgroundColor: "rgba(26,26,29,0.5)" },
  subTableCell: { flex: 1, fontSize: 13, color: "#B5B0AB" },
});
