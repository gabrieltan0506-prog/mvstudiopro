/**
 * 剧本工作台：左=本集资产 · 中=一集剧本+按段静帧 · 右=预览 · 底=集/段时间线
 * 一集：10–12 段 × 每段 3–4 关键静帧；每段一条成片（Seedance ≤15s，按时长合计钳制）。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Focus,
  LayoutGrid,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { CanvasBlock } from "@/lib/canvasTypes";
import {
  getBlockEpisodeIndex,
  MANHUA_FACTORY_STAGE_LABEL_ZH,
  stageKeyFromBlockId,
} from "@/lib/canvasDramaStudio";
import {
  getManhuaCharacterById,
  getManhuaCharacterDisplayName,
  getManhuaCharacterPreviewUrl,
  MANHUA_ART_STYLE_PRESETS,
  type ManhuaArtStyleId,
} from "@shared/manhuaCharacterAssetLibrary";
import { getAncientArchetypeById } from "@shared/manhuaAncientArchetypeLibrary";
import { getManhuaSceneTemplate } from "@shared/manhuaSceneAssetLibrary";
import {
  getManhuaDemoAsset,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssetsForSceneTemplate,
} from "@shared/manhuaScenePropDemoCatalog";
import { evaluateManhuaAssetImageGate } from "@shared/manhuaAssetImageGate";
import {
  resolveEpisodeMainScene,
  type ManhuaWriterAssetCanon,
} from "@shared/manhuaWriterAssetCanon";
import {
  MANHUA_CUSTOM_ASSET_REF_DUTY_LABEL_ZH,
  MANHUA_CUSTOM_ASSET_ROLE_LABEL_ZH,
  MANHUA_CUSTOM_ASSET_ROLES,
  summarizeCustomAssetRefsZh,
  type ManhuaCustomAssetRef,
  type ManhuaCustomAssetRefDuty,
  type ManhuaCustomAssetRole,
} from "@shared/manhuaCustomAssetRefs";
import type { ManhuaDeliveryPackage } from "@shared/manhuaDeliveryPackage";
import { syncDeliveryPackageSubtitleEnabled } from "@shared/manhuaDeliveryPackage";
import type { ManhuaCineVocabLocale } from "@shared/manhuaCineVocabBank";
import type { ManhuaRetakeVariable } from "@shared/manhuaDirectingWorkflow";
import { MANHUA_REF_DUTIES } from "@shared/manhuaDirectingWorkflow";
import {
  areManhuaKeyartsPixelLocked,
  isManhuaKeyartPixelLocked,
  buildManhuaAssetLockRegistry,
} from "@shared/manhuaAssetLockRegistry";
import {
  groupShotsIntoSegments,
  MANHUA_FACTORY_DEFAULT_VIDEO_MODEL,
  MANHUA_KEYARTS_PER_SEGMENT_MIN,
  MANHUA_SEGMENT_MIN,
  parseWorkbenchShotsFromText,
  resolveClipSegmentIndex,
  resolveKeyartShotIndex,
  resolveSegmentIndexFromShotIndex,
  resolveWorkbenchShotAssetMount,
  workbenchShotTotalSec,
  type ManhuaWorkbenchShot,
} from "@shared/manhuaScriptWorkbench";
import {
  canManhuaBurnVideo,
  type ManhuaProductionProgress,
} from "@shared/manhuaProductionPipeline";
import { resolveManhuaWorkbenchNextCta } from "@shared/manhuaWorkbenchNextCta";
import {
  explainManhuaClipActionGate,
  explainManhuaKeyartActionGate,
} from "@shared/manhuaWorkbenchActionGate";
import {
  buildManhuaSecondCueSheet,
  buildWorkbenchShotsFromSegmentPlan,
  evaluateManhuaCueSheetReady,
} from "@shared/manhuaStoryDistill";
import { parseManhuaEpisodeSegmentPlanFromMarkdown } from "@shared/manhuaEpisodeSegmentPlan";
import { applyShotDialoguesFromText } from "@shared/manhuaShotDialoguePersist";
import { summarizeManhuaVisualBriefForUi } from "@shared/manhuaScriptVisualBrief";
import type { ManhuaPathAnnotation } from "@shared/manhuaPathCameraAnnotate";
import { MANHUA_DRAFT_RETENTION_HINT_ZH } from "@shared/manhuaCloudDraft";
import ManhuaPathCameraAnnotatePanel from "@/components/ManhuaPathCameraAnnotatePanel";
import ManhuaAgentAdvisorPanel from "@/components/ManhuaAgentAdvisorPanel";
import ManhuaIntegratedAssetBoardPanel from "@/components/ManhuaIntegratedAssetBoardPanel";
import ManhuaRoughEditTimeline from "@/components/ManhuaRoughEditTimeline";
import ManhuaStylePackPanel from "@/components/ManhuaStylePackPanel";
import type { ManhuaStylePack } from "@shared/manhuaStylePack";
import ManhuaEditMultitrackPanel from "@/components/ManhuaEditMultitrackPanel";
import type { ManhuaWorkbenchSyncPayload } from "@shared/manhuaAgentLoopSync";
import { buildManhuaIntegratedAssetBoard } from "@shared/manhuaIntegratedAssetBoard";
import {
  MANHUA_CAMERA_ANGLE_ORDER,
  formatManhuaCameraAngleLine,
  getManhuaCameraAngle,
  recommendManhuaCameraAngleFromText,
  type ManhuaCameraAngleId,
} from "@shared/manhuaCameraAngleBank";
import { buildRoughCutClipsFromShots } from "@shared/manhuaEditWorkflowBank";
import type { ManhuaFineCutByShot, ManhuaFineCutTrim } from "@shared/manhuaEditFineCut";
import {
  loadManhuaWorkbenchBPersist,
  manhuaWorkbenchBPersistKey,
  saveManhuaWorkbenchBPersist,
} from "@shared/manhuaShotAnglePersist";
import { toast } from "sonner";

type WorkflowPhaseId = "outline" | "assets" | "storyboard" | "edit";

type Props = {
  blocks: CanvasBlock[];
  topic: string;
  seriesTitle?: string;
  logline?: string;
  /** 大纲页分集列表（标题即可） */
  outlineEpisodes?: Array<{ index: number; title: string }>;
  episodeCount: number;
  focusEpisode: number;
  onFocusEpisode: (ep: number) => void;
  characterIds: string[];
  ancientArchetypeIds?: string[];
  sceneId?: string;
  propIds: string[];
  artStyleLabelZh?: string;
  /** 专案 Bible 一行摘要（确认编剧后） */
  projectBibleSummary?: string;
  /** 编剧表资产真源：系列人物/道具/场景池 + 每集主场景 */
  assetCanon?: ManhuaWriterAssetCanon | null;
  /** 已选审定节奏模板短标签（大纲页展示） */
  viralTemplateLabelZh?: string;
  /** Bible 已绑定造型的集号（1-based） */
  bibleBoundEpisodes?: number[];
  /** 蓝/红轨 + 叙事灯光状态行 */
  pathTrackLabelZh?: string;
  narrativeLightingLabelZh?: string;
  /** 运镜标注（主屏可画蓝/红轨） */
  pathAnnotation?: ManhuaPathAnnotation | null;
  pathRecipeId?: string;
  actionRecipeId?: string;
  onPathAnnotationChange?: (ann: ManhuaPathAnnotation | null) => void;
  onPathRecipeIdChange?: (id: string) => void;
  onActionRecipeIdChange?: (id: string) => void;
  translateMotionZh?: (motionZh: string) => Promise<string>;
  /** 合成长片预览（成片坞合成后） */
  finalVideoUrl?: string | null;
  factoryBusy?: boolean;
  /** 工厂进度一行（如「第2集 · 静帧」） */
  factoryProgress?: string;
  /** 生成中随时中断（测试不必跑完整条链） */
  onStopFactory?: () => void;
  canRun?: boolean;
  /** 剧情包已出、尚未确认编剧 */
  writerPackReady?: boolean;
  onConfirmOutline?: () => void;
  /** @deprecated 方案 B 已取消跳过；保留字段仅兼容旧会话 */
  assetsSkipped?: boolean;
  onAssetsSkippedChange?: (skipped: boolean) => void;
  /** 三阶段（父级可持久化） */
  workflowPhase?: WorkflowPhaseId;
  onWorkflowPhaseChange?: (phase: WorkflowPhaseId) => void;
  onOpenCharacterCard?: () => void;
  onOpenAssetWall?: () => void;
  /** 确认资产：先按序出角色图→场景图，再进分镜 */
  onConfirmAssetsAndPrepareImages?: () => void | Promise<void>;
  /** 清掉与现稿不符的旧设定图，并按剧本强制重出 */
  onRegenerateAssetsFromScript?: () => void | Promise<void>;
  /** 剧本人物/场景与当前设定图不对齐时的提示 */
  assetScriptStaleHintZh?: string | null;
  /** 产品化风格包（色卡 + 光影构图 DNA） */
  stylePack?: ManhuaStylePack | null;
  onStylePackChange?: (pack: ManhuaStylePack | null) => void;
  /** 用户上传 / 基于库参考生成的参考图（人物 / 场景 / 道具分栏） */
  customAssetRefs?: ManhuaCustomAssetRef[];
  onUploadCustomAssets?: (
    files: FileList | File[],
    role?: ManhuaCustomAssetRole,
  ) => void | Promise<void>;
  onCustomAssetRoleChange?: (id: string, role: ManhuaCustomAssetRef["role"]) => void;
  onCustomAssetDutyChange?: (id: string, duty: ManhuaCustomAssetRefDuty | null) => void;
  onRemoveCustomAsset?: (id: string) => void;
  /** 段意图写回可拍表（工作台编辑） */
  onSegmentIntentChange?: (segmentIndex: number, intentZh: string) => void;
  deliveryPackage?: ManhuaDeliveryPackage | null;
  onDeliveryPackageChange?: (next: ManhuaDeliveryPackage) => void;
  cineVocabLocale?: ManhuaCineVocabLocale;
  onCineVocabLocaleChange?: (locale: ManhuaCineVocabLocale) => void;
  onRetakeClip?: (clipBlockId: string, variable: ManhuaRetakeVariable) => void;
  /** 基于当前库选条目生成新参考（库仅为种子） */
  onGenerateCustomAssetFromLibrary?: (opts: {
    role: ManhuaCustomAssetRole;
    seedLibraryId: string;
  }) => void | Promise<void>;
  /** 授权进库半价（付费积分）；兑换码赠送积分路径由父级锁定强制进库 */
  shareAssetToLibrary?: boolean;
  onShareAssetToLibraryChange?: (next: boolean) => void;
  assetShareBilling?: {
    credits: number;
    halfPriceApplied: boolean;
    giftedBlocksHalfPrice: boolean;
    noticeZh: string;
    priceLabelZh: string;
  };

  /** 生成当前选中段（段内缺静帧则先补 + 该段一条成片） */
  onSpawnAndRunClip?: () => void;
  onGenerateFragment?: (opts: {
    /** 段号 1-based（工厂按段出一条成片） */
    shotIndex: number;
    keyartId?: string;
    clipId?: string;
  }) => void;
  /** 本集缺成片/质检失败的段号依次生成 */
  onGenerateMissingFragments?: (segmentIndexes: number[]) => void;
  /** 资产锁定后：一次生成本集全部分镜静帧（主路径） */
  onGenerateAllEpisodeKeyarts?: () => void;
  /** 画布竖排：资产行 → 静帧行 → 成片提示词行 */
  onLayoutReadableChain?: () => void;
  /** 确保本集段成片节点已铺好（审阅提示词前） */
  onEnsureSegmentClips?: () => void;
  /** 写回段成片节点 prompt（审阅编辑） */
  onUpdateClipPrompt?: (clipId: string, prompt: string) => void;
  onResumeFromFailure?: () => void;
  /** 从编导反推强制重跑本集静帧（覆盖旧图；工作台主路径入口） */
  onRerunKeyartsFromReverse?: () => void;
  /** 只重跑当前分镜静帧，保留同集其他已完成镜头。 */
  onRerunKeyartShot?: (blockId: string, shotIndex: number) => void;
  /** 质检软拦：用户仍采用当前镜成片进入成片坞 */
  onAcceptClipDespiteQc?: (clipBlockId: string) => void;
  /** 成片坞勾选集（剪辑阶段可改） */
  dockSelectedIds?: Set<string>;
  onDockSelectedIdsChange?: (next: Set<string>) => void;
  onFocusBlock?: (blockId: string) => void;
  /** 确认编剧后：整屏编辑器壳（无圆角卡片、三栏占满视口） */
  immersive?: boolean;
  /**
   * 分镜右栏常驻画布（阿硕式）。有值时替换单路预览主区，质检条保留在下方。
   */
  previewCanvas?: ReactNode;
  /** 右栏画布工具条（呈现切换等） */
  previewCanvasToolbar?: ReactNode;
  /** 同集镜间接力：A 静帧←上镜静帧；B 成片←上镜成片末段 */
  shotContinuity?: {
    keyartFromPrevStill: boolean;
    clipFromPrevTail: boolean;
  };
  onShotContinuityChange?: (next: {
    keyartFromPrevStill: boolean;
    clipFromPrevTail: boolean;
  }) => void;
  /** 画风：仿真人 / CG 漫剧（资产设定页可自选） */
  artStyleId?: ManhuaArtStyleId;
  onArtStyleChange?: (id: ManhuaArtStyleId) => void;
  /** 创作顾问：同步规划产物到工厂节点 */
  onAdvisorApplySync?: (sync: ManhuaWorkbenchSyncPayload) => void;
  onAdvisorUpdateBeatsText?: (text: string) => void;
  onAdvisorUpdateStoryText?: (text: string) => void;
  onAdvisorBusyChange?: (busy: boolean) => void;
  /** 机位选定写回反推/节拍（供工厂注入） */
  onUpsertShotAngles?: (angles: Record<number, string>) => void;
  /** 分镜台词写回（成片注入用；静帧不读字面） */
  onUpsertShotDialogues?: (dialogues: Record<number, string>) => void;
};

function blockByStage(blocks: CanvasBlock[], episode: number, stage: string): CanvasBlock | undefined {
  return blocks.find((b) => stageKeyFromBlockId(b.id) === stage && (getBlockEpisodeIndex(b) ?? 1) === episode);
}

function keyartsForEpisode(blocks: CanvasBlock[], episode: number): CanvasBlock[] {
  return blocks
    .filter((b) => b.id.startsWith("keyart-") && (getBlockEpisodeIndex(b) ?? 1) === episode)
    .sort(
      (a, b) =>
        resolveKeyartShotIndex(a.id, a.prompt) - resolveKeyartShotIndex(b.id, b.prompt) ||
        a.id.localeCompare(b.id),
    );
}

function mediaUrl(b?: CanvasBlock): string | undefined {
  if (!b) return undefined;
  return b.outputUrl || b.outputUrls?.[0] || undefined;
}

const CLIP_QUALITY_ROWS = [
  ["CHARACTER_MATCH", "角色"],
  ["SCENE_MATCH", "场景"],
  ["PLOT_MATCH", "剧情"],
  ["CAMERA_MOTION", "运镜"],
  ["LIGHTING", "灯光"],
  ["DURATION_OK", "时长"],
] as const;

export default function ManhuaScriptWorkbench({
  blocks,
  topic,
  seriesTitle,
  logline,
  outlineEpisodes = [],
  episodeCount,
  focusEpisode,
  onFocusEpisode,
  characterIds,
  ancientArchetypeIds = [],
  sceneId,
  propIds,
  artStyleLabelZh,
  projectBibleSummary,
  assetCanon = null,
  viralTemplateLabelZh,
  bibleBoundEpisodes = [],
  pathTrackLabelZh,
  narrativeLightingLabelZh,
  pathAnnotation = null,
  pathRecipeId,
  actionRecipeId,
  onPathAnnotationChange,
  onPathRecipeIdChange,
  onActionRecipeIdChange,
  translateMotionZh,
  finalVideoUrl,
  factoryBusy,
  factoryProgress,
  onStopFactory,
  canRun,
  writerPackReady,
  onConfirmOutline,
  assetsSkipped: _assetsSkippedProp,
  onAssetsSkippedChange: _onAssetsSkippedChange,
  workflowPhase: workflowPhaseProp,
  onWorkflowPhaseChange,
  onOpenCharacterCard,
  onOpenAssetWall,
  onConfirmAssetsAndPrepareImages,
  onRegenerateAssetsFromScript,
  assetScriptStaleHintZh = null,
  stylePack = null,
  onStylePackChange,
  customAssetRefs = [],
  onUploadCustomAssets,
  onCustomAssetRoleChange,
  onCustomAssetDutyChange,
  onRemoveCustomAsset,
  onSegmentIntentChange,
  deliveryPackage = null,
  onDeliveryPackageChange,
  cineVocabLocale,
  onCineVocabLocaleChange,
  onRetakeClip,
  onGenerateCustomAssetFromLibrary,
  shareAssetToLibrary = false,
  onShareAssetToLibraryChange,
  assetShareBilling,
  onSpawnAndRunClip,
  onGenerateFragment,
  onGenerateMissingFragments,
  onGenerateAllEpisodeKeyarts,
  onLayoutReadableChain,
  onEnsureSegmentClips,
  onUpdateClipPrompt,
  onResumeFromFailure,
  onRerunKeyartsFromReverse,
  onRerunKeyartShot,
  onAcceptClipDespiteQc,
  dockSelectedIds,
  onDockSelectedIdsChange,
  onFocusBlock,
  immersive = false,
  previewCanvas,
  previewCanvasToolbar,
  shotContinuity,
  onShotContinuityChange,
  artStyleId,
  onArtStyleChange,
  onAdvisorApplySync,
  onAdvisorUpdateBeatsText,
  onAdvisorUpdateStoryText,
  onAdvisorBusyChange,
  onUpsertShotAngles,
  onUpsertShotDialogues,
}: Props) {
  const dockCanvas = Boolean(previewCanvas);
  const continuity = shotContinuity || {
    keyartFromPrevStill: true,
    clipFromPrevTail: true,
  };
  const activeArtStyleId: ManhuaArtStyleId =
    artStyleId === "photoreal" ? "photoreal" : "cg_drama";
  const [shotIndex, setShotIndex] = useState(0);
  const [visualBriefConfirmed, setVisualBriefConfirmed] = useState(false);
  const [clipPromptReviewOpen, setClipPromptReviewOpen] = useState(false);
  useEffect(() => {
    setVisualBriefConfirmed(false);
    setClipPromptReviewOpen(false);
  }, [focusEpisode, topic, seriesTitle]);
  /** 中栏：分镜 | 运镜画板 | 一体参考板 | 粗剪 */
  const [scriptTab, setScriptTab] = useState<"shots" | "path" | "board" | "edit">("shots");
  /** 每镜机位密码（可点选覆盖推荐） */
  const [shotAngleByIndex, setShotAngleByIndex] = useState<Record<number, ManhuaCameraAngleId>>(
    {},
  );
  /** 粗剪顺序（镜号列表）；空则按分镜序 */
  const [roughShotOrder, setRoughShotOrder] = useState<number[]>([]);
  /** 细剪进出点 */
  const [fineCutByShot, setFineCutByShot] = useState<ManhuaFineCutByShot>({});
  /** 剪辑台字幕轨：开则生成轨数据，默认不烧字 */
  const [editSubtitleEnabled, setEditSubtitleEnabled] = useState(false);
  /** 包装动效（motionPromptBank id） */
  const [editMotionPromptIds, setEditMotionPromptIds] = useState<string[]>([]);
  const bPersistKey = manhuaWorkbenchBPersistKey(topic || seriesTitle || "manhua", focusEpisode);
  useEffect(() => {
    const hit = loadManhuaWorkbenchBPersist(bPersistKey);
    if (!hit) return;
    if (Object.keys(hit.shotAngleByIndex).length) setShotAngleByIndex(hit.shotAngleByIndex);
    if (hit.roughShotOrder.length) setRoughShotOrder(hit.roughShotOrder);
    if (hit.fineCutByShot && Object.keys(hit.fineCutByShot).length) {
      setFineCutByShot(hit.fineCutByShot);
    }
    setEditSubtitleEnabled(Boolean(hit.subtitleEnabled));
    if (hit.motionPromptIds?.length) setEditMotionPromptIds(hit.motionPromptIds);
  }, [bPersistKey]);
  useEffect(() => {
    saveManhuaWorkbenchBPersist(bPersistKey, {
      shotAngleByIndex,
      roughShotOrder,
      fineCutByShot,
      subtitleEnabled: editSubtitleEnabled,
      motionPromptIds: editMotionPromptIds,
    });
  }, [
    bPersistKey,
    shotAngleByIndex,
    roughShotOrder,
    fineCutByShot,
    editSubtitleEnabled,
    editMotionPromptIds,
  ]);
  /**
   * 右栏本集画布：未出片默认开；有成片后自动收起让出检查空间；用户可再开。
   * 镜头一多时避免画布长期占满右栏。
   */
  const [canvasDockOpen, setCanvasDockOpen] = useState(true);
  /** 运镜静帧画板：同样不常占位，有成片后默认收起 */
  const [pathBoardOpen, setPathBoardOpen] = useState(true);
  /** 胶片多选：生成所选 */
  const [selectedShotIndexes, setSelectedShotIndexes] = useState<number[]>([]);
  const [activePhaseLocal, setActivePhaseLocal] = useState<WorkflowPhaseId>(() =>
    canRun ? "storyboard" : "outline",
  );
  const activePhase = workflowPhaseProp ?? activePhaseLocal;
  const setActivePhase = (next: WorkflowPhaseId) => {
    if (workflowPhaseProp === undefined) setActivePhaseLocal(next);
    onWorkflowPhaseChange?.(next);
  };

  const episodeIndexes = useMemo(() => {
    const fromBlocks = new Set<number>();
    for (const b of blocks) {
      const ep = getBlockEpisodeIndex(b);
      if (ep) fromBlocks.add(ep);
    }
    const max = Math.max(episodeCount || 1, ...Array.from(fromBlocks), focusEpisode || 1);
    return Array.from({ length: Math.min(Math.max(max, 1), 12) }, (_, i) => i + 1);
  }, [blocks, episodeCount, focusEpisode]);

  const beats = blockByStage(blocks, focusEpisode, "beats");
  const reverse = blockByStage(blocks, focusEpisode, "reverse");
  const episodeKeyarts = useMemo(
    () => keyartsForEpisode(blocks, focusEpisode),
    [blocks, focusEpisode],
  );
  const episodeClips = useMemo(
    () =>
      blocks
        .filter((b) => b.id.startsWith("clip-") && (getBlockEpisodeIndex(b) ?? 1) === focusEpisode)
        .sort(
          (a, b) =>
            resolveClipSegmentIndex(a.id, a.prompt) - resolveClipSegmentIndex(b.id, b.prompt) ||
            a.id.localeCompare(b.id),
        ),
    [blocks, focusEpisode],
  );
  const keyart = episodeKeyarts[0];
  const legacyClip = blockByStage(blocks, focusEpisode, "clip");
  const story = blockByStage(blocks, focusEpisode, "story");

  const shots: ManhuaWorkbenchShot[] = useMemo(() => {
    const reverseText = reverse?.outputText || reverse?.prompt || "";
    const beatsText = beats?.outputText || beats?.prompt || "";
    const storyText = story?.outputText || story?.prompt || "";
    // 方案 C：十至十二段可拍表优先编译为每段 3 静帧（起幅/戏核/落幅）
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(
      `${storyText}\n${beatsText}\n${reverseText}`,
    );
    const fromPlan = buildWorkbenchShotsFromSegmentPlan(plan);
    let list: ManhuaWorkbenchShot[];
    if (fromPlan.length >= MANHUA_SEGMENT_MIN * MANHUA_KEYARTS_PER_SEGMENT_MIN) {
      list = fromPlan as ManhuaWorkbenchShot[];
    } else if (reverseText.trim()) {
      list = parseWorkbenchShotsFromText(reverseText);
    } else if (beatsText.trim()) {
      list = parseWorkbenchShotsFromText(beatsText);
    } else {
      list = fromPlan.length
        ? (fromPlan as ManhuaWorkbenchShot[])
        : parseWorkbenchShotsFromText(storyText);
    }
    // 工作台改过的「分镜台词」表优先写回（成片用）
    list = applyShotDialoguesFromText(list, reverseText);
    list = applyShotDialoguesFromText(list, beatsText);
    return list;
  }, [
    beats?.outputText,
    beats?.prompt,
    reverse?.outputText,
    reverse?.prompt,
    story?.outputText,
    story?.prompt,
  ]);

  const episodeVideoModel =
    episodeClips[0]?.videoModel || legacyClip?.videoModel || MANHUA_FACTORY_DEFAULT_VIDEO_MODEL;
  const segments = useMemo(
    () => groupShotsIntoSegments(shots, { videoModel: episodeVideoModel }),
    [shots, episodeVideoModel],
  );

  const visualBrief = useMemo(() => {
    const scriptBlob = [
      story?.outputText || story?.prompt || "",
      reverse?.outputText || reverse?.prompt || "",
      topic || "",
    ]
      .filter(Boolean)
      .join("\n\n");
    return summarizeManhuaVisualBriefForUi(scriptBlob, {
      topic,
      forStage: "key_art",
      maxChars: 900,
    });
  }, [story?.outputText, story?.prompt, reverse?.outputText, reverse?.prompt, topic]);
  const episodeStillCount = episodeKeyarts.filter((b) => mediaUrl(b)).length;
  const stillsCountReady =
    shots.length > 0
      ? episodeStillCount >= shots.length
      : episodeStillCount > 0;
  /** Skill：资产须垫图改图锁定；仅有成图 URL 不算可烧成片 */
  const keyartsPixelLocked = areManhuaKeyartsPixelLocked(episodeKeyarts, {
    minCount: shots.length > 0 ? shots.length : 1,
  });
  const stillsReadyEnough = stillsCountReady && keyartsPixelLocked;

  useEffect(() => {
    if (stillsReadyEnough) setVisualBriefConfirmed(true);
  }, [stillsReadyEnough]);

  const totalSec = workbenchShotTotalSec(shots, episodeVideoModel);

  const integratedBoard = useMemo(
    () =>
      buildManhuaIntegratedAssetBoard({
        characterIds,
        ancientArchetypeIds,
        sceneId,
        propIds,
        seriesTitle,
        artStyleLabelZh,
      }),
    [
      characterIds,
      ancientArchetypeIds,
      sceneId,
      propIds,
      seriesTitle,
      artStyleLabelZh,
    ],
  );

  const stillIndexSet = useMemo(() => {
    const s = new Set<number>();
    for (const b of episodeKeyarts) {
      if (mediaUrl(b)) s.add(resolveKeyartShotIndex(b.id, b.prompt));
    }
    return s;
  }, [episodeKeyarts]);

  const clipIndexSet = useMemo(() => {
    const s = new Set<number>();
    for (const b of episodeClips) {
      if (mediaUrl(b)) s.add(resolveKeyartShotIndex(b.id, b.prompt));
    }
    if (legacyClip && mediaUrl(legacyClip)) s.add(1);
    return s;
  }, [episodeClips, legacyClip]);

  const roughClips = useMemo(
    () =>
      buildRoughCutClipsFromShots(shots, {
        stillIndexes: stillIndexSet,
        clipIndexes: clipIndexSet,
        order: roughShotOrder.length ? roughShotOrder : undefined,
      }),
    [shots, stillIndexSet, clipIndexSet, roughShotOrder],
  );

  const editShotMedia = useMemo(() => {
    return roughClips.map((c) => {
      const shotClip =
        episodeClips.find(
          (b) =>
            resolveClipSegmentIndex(b.id, b.prompt) ===
            resolveSegmentIndexFromShotIndex(c.shotIndex),
        ) || (resolveSegmentIndexFromShotIndex(c.shotIndex) === 1 ? legacyClip : undefined);
      const shotKeyart =
        episodeKeyarts.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === c.shotIndex) ||
        (c.shotIndex === 1 ? keyart : undefined);
      return {
        shotIndex: c.shotIndex,
        clipBlockId: shotClip?.id,
        keyartBlockId: shotKeyart?.id,
        outputUrl: mediaUrl(shotClip),
        quality: shotClip?.manhuaClipQuality ?? null,
      };
    });
  }, [roughClips, episodeClips, episodeKeyarts, legacyClip, keyart]);

  useEffect(() => {
    // 新分镜到来时，为缺失镜号补推荐机位
    setShotAngleByIndex((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const shot of shots) {
        if (next[shot.index]) continue;
        const rec = recommendManhuaCameraAngleFromText(
          `${shot.cameraZh} ${shot.actionZh} ${shot.emotionZh || ""}`,
        );
        next[shot.index] = rec.id;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [shots]);

  const activeShot = shots[Math.min(shotIndex, Math.max(0, shots.length - 1))] || shots[0];
  const activeShotNo = activeShot?.index ?? 1;
  const activeSegNo = resolveSegmentIndexFromShotIndex(activeShotNo);
  const activeSegment = segments.find((s) => s.index === activeSegNo) || segments[0];
  // 严格按镜号对齐：禁止用「列表第 N 张」顶替，避免剧本与静帧错位
  const activeKeyart =
    episodeKeyarts.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === activeShotNo) ||
    (activeShotNo === 1 ? keyart : undefined);
  const activeClip =
    episodeClips.find((b) => resolveClipSegmentIndex(b.id, b.prompt) === activeSegNo) ||
    (activeSegNo === 1 ? legacyClip : undefined);
  const clip = activeClip || legacyClip;
  const clipQuality = clip?.manhuaClipQuality;
  const clipVideoUrl = mediaUrl(clip);
  const approvedClipUrl =
    clipQuality?.status === "passed" && clipVideoUrl ? clipVideoUrl : undefined;
  // 有成片就播：质检未过/服务暂不可用时仍可看，避免「生成成功却像失败」
  const playableClipUrl = approvedClipUrl || clipVideoUrl;
  const anyKeyartUrl = episodeKeyarts.map(mediaUrl).find(Boolean);
  const previewUrl = playableClipUrl || mediaUrl(activeKeyart) || anyKeyartUrl;
  const previewIsVideo = Boolean(playableClipUrl);
  const annotateStillUrl = mediaUrl(activeKeyart) || anyKeyartUrl;

  /** 切镜 / 成片出现：未出片展开，已出片收起；用户点开后可临时查看，再切镜会重新按规则收合 */
  useEffect(() => {
    if (!dockCanvas) return;
    setCanvasDockOpen(!playableClipUrl);
  }, [dockCanvas, playableClipUrl, activeShotNo]);

  useEffect(() => {
    setPathBoardOpen(!playableClipUrl);
  }, [playableClipUrl, activeShotNo]);

  const openCanvasDock = () => setCanvasDockOpen(true);
  const closeCanvasDock = () => setCanvasDockOpen(false);
  const focusBlockAndOpenCanvas = (blockId: string) => {
    setCanvasDockOpen(true);
    onFocusBlock?.(blockId);
  };

  const showCanvasDock = dockCanvas && canvasDockOpen;

  // runGenerateFragment 定义在门槛文案之后（避免静默 disabled）

  const characters = characterIds
    .map((id) => getManhuaCharacterById(id))
    .filter(Boolean);
  const archetypes = ancientArchetypeIds
    .map((id) => getAncientArchetypeById(id))
    .filter(Boolean);
  const scene = sceneId ? getManhuaSceneTemplate(sceneId) : null;
  const sceneDemos = useMemo(
    () => listManhuaDemoAssetsForSceneTemplate(sceneId).slice(0, 4),
    [sceneId],
  );
  const props = propIds.map((id) => getManhuaDemoAsset(id)).filter(Boolean);
  const shotMount = useMemo(
    () =>
      resolveWorkbenchShotAssetMount({
        actionZh: activeShot?.actionZh,
        cameraZh: activeShot?.cameraZh,
        keyartPrompt: activeKeyart?.prompt,
        characters: characters.map((c) => ({ id: c!.id, nameZh: c!.nameZh })),
        archetypes: archetypes.map((a) => ({ id: a!.id, nameZh: a!.nameZh })),
        props: props.map((p) => ({ id: p!.id, nameZh: p!.nameZh })),
      }),
    [
      activeShot?.actionZh,
      activeShot?.cameraZh,
      activeKeyart?.prompt,
      characterIds.join("|"),
      ancientArchetypeIds.join("|"),
      propIds.join("|"),
    ],
  );
  const mountedCharacterIdSet = useMemo(
    () => new Set(shotMount.characterIds),
    [shotMount.characterIds],
  );
  const mountedArchetypeIdSet = useMemo(
    () => new Set(shotMount.ancientArchetypeIds),
    [shotMount.ancientArchetypeIds],
  );
  const mountedPropIdSet = useMemo(() => new Set(shotMount.propIds), [shotMount.propIds]);
  const mountedCastCount =
    shotMount.characterIds.length + shotMount.ancientArchetypeIds.length;
  const mountGap =
    shotMount.expectedCastCount > mountedCastCount
      ? shotMount.expectedCastCount - mountedCastCount
      : 0;
  const filmstripShots = useMemo(
    () =>
      shots.length
        ? shots
        : ([{ index: 1, durationSec: 5, cameraZh: "", actionZh: "" }] as ManhuaWorkbenchShot[]),
    [shots],
  );
  const missingFragmentIndexes = useMemo(() => {
    return segments
      .filter((seg) => {
        const segClip =
          episodeClips.find((b) => resolveClipSegmentIndex(b.id, b.prompt) === seg.index) ||
          (seg.index === 1 ? legacyClip : undefined);
        const playable = Boolean(mediaUrl(segClip));
        const failed = segClip?.manhuaClipQuality?.status === "failed";
        return !playable || failed;
      })
      .map((seg) => seg.index);
  }, [segments, episodeClips, legacyClip]);
  const segmentClipReviewList = useMemo(() => {
    return segments.map((seg) => {
      const segClip =
        episodeClips.find((b) => resolveClipSegmentIndex(b.id, b.prompt) === seg.index) ||
        (seg.index === 1 ? legacyClip : undefined);
      return {
        segmentIndex: seg.index,
        durationSec: seg.durationSec,
        clip: segClip,
        shotIndexes: seg.shots.map((s) => s.index),
      };
    });
  }, [segments, episodeClips, legacyClip]);
  const selectedSorted = useMemo(
    () => [...selectedShotIndexes].sort((a, b) => a - b),
    [selectedShotIndexes],
  );
  const toggleShotSelected = (shotIndex: number) => {
    setSelectedShotIndexes((prev) =>
      prev.includes(shotIndex) ? prev.filter((n) => n !== shotIndex) : [...prev, shotIndex],
    );
  };
  const assetGate = useMemo(
    () =>
      evaluateManhuaAssetImageGate({
        characterIds,
        ancientArchetypeIds,
        sceneId,
        artStyleId: activeArtStyleId,
        customRefs: customAssetRefs,
        assetCanon,
        episodeIndex: focusEpisode,
        assetBlocks: blocks.filter(
          (b) => b.id.startsWith("charsheet-") || b.id.startsWith("sceneplate-"),
        ),
      }),
    [
      characterIds,
      ancientArchetypeIds,
      sceneId,
      activeArtStyleId,
      customAssetRefs,
      assetCanon,
      focusEpisode,
      blocks,
    ],
  );
  const episodeMainScene = useMemo(
    () => resolveEpisodeMainScene(assetCanon, focusEpisode),
    [assetCanon, focusEpisode],
  );
  /** 本集画布设定图 +「我的角色/场景」已勾选图（避免场景墙空着但分栏有图） */
  const episodeSheetGallery = useMemo(() => {
    const items: Array<{
      id: string;
      kind: "charsheet" | "sceneplate";
      labelZh: string;
      url: string;
    }> = [];
    const seenUrl = new Set<string>();
    for (const b of blocks) {
      const isChar = b.id.startsWith("charsheet-");
      const isScene = b.id.startsWith("sceneplate-");
      if (!isChar && !isScene) continue;
      const url = mediaUrl(b);
      if (!url || seenUrl.has(url)) continue;
      seenUrl.add(url);
      const seedId = b.id.replace(/^charsheet-/, "").replace(/^sceneplate-/, "");
      const labelZh = isChar
        ? assetCanon?.characters.find((c) => c.id === seedId || b.id.includes(c.id))?.nameZh ||
          "角色定妆"
        : assetCanon?.locations.find((l) => l.id === seedId || b.id.includes(l.id))?.nameZh ||
          getManhuaSceneTemplate(seedId)?.nameZh ||
          "场景参考";
      items.push({
        id: b.id,
        kind: isChar ? "charsheet" : "sceneplate",
        labelZh,
        url,
      });
    }
    for (const ref of customAssetRefs) {
      const url = String(ref.url || "").trim();
      if (!/^https:\/\//i.test(url) || seenUrl.has(url)) continue;
      if (ref.role !== "character" && ref.role !== "scene") continue;
      seenUrl.add(url);
      const kind = ref.role === "scene" ? ("sceneplate" as const) : ("charsheet" as const);
      items.push({
        id: `${kind}-custom-${ref.id}`,
        kind,
        labelZh: ref.labelZh || (kind === "sceneplate" ? "场景参考" : "角色定妆"),
        url,
      });
    }
    return items.sort((a, b) => {
      if (a.kind === b.kind) return a.labelZh.localeCompare(b.labelZh, "zh");
      return a.kind === "charsheet" ? -1 : 1;
    });
  }, [blocks, assetCanon, customAssetRefs]);
  const customSummaryZh = summarizeCustomAssetRefsZh(customAssetRefs);
  /** 编剧主场景优先：有本集主场景名时，勿用题材默认的皇宫大殿库 id 去挂示范锁 */
  const lockSceneId = useMemo(() => {
    if (customAssetRefs.some((r) => r.role === "scene")) return "";
    if (episodeMainScene?.nameZh) return "";
    return sceneId;
  }, [customAssetRefs, episodeMainScene?.nameZh, sceneId]);
  const assetLockRegistry = useMemo(
    () =>
      buildManhuaAssetLockRegistry({
        characterIds,
        artStyleId: activeArtStyleId,
        sceneId: lockSceneId,
        propIds,
        customRefs: customAssetRefs,
      }),
    [characterIds, activeArtStyleId, lockSceneId, propIds, customAssetRefs],
  );
  const outlineComplete = Boolean(canRun);
  /** 方案 B：剧本确认 + 角色/场景锁定 + 角色图/场景图齐，才可进分镜出片 */
  const assetsComplete = assetGate.ready && !assetScriptStaleHintZh;
  const productionProgress = useMemo((): ManhuaProductionProgress => {
    const segmentCount = segments.length;
    const segmentPlanReady = segmentCount >= MANHUA_SEGMENT_MIN;
    const keyartsReady = stillsReadyEnough;
    const cueSheets = segments.map((seg) => ({
      segmentIndex: seg.index,
      beatCount: buildManhuaSecondCueSheet({
        segment: {
          index: seg.index,
          intentZh:
            String(seg.shots.find((s) => s.intentZh)?.intentZh || "").trim() ||
            "让观众感到局势或人物关系变化",
          dialogueZh: seg.shots.find((s) => s.dialogueZh)?.dialogueZh || "",
          performanceZh: seg.shots.find((s) => s.emotionZh)?.emotionZh || "",
          sceneZh: "",
          paletteZh: "",
          castZh: "",
          wardrobePropZh: "",
          lightingCameraZh: seg.shots[0]?.cameraZh || "",
        },
        shots: seg.shots,
        durationSec: seg.durationSec,
      }).length,
    }));
    const cueSheetReady =
      keyartsReady &&
      evaluateManhuaCueSheetReady({ segmentCount, cueSheets });
    return {
      hasTopic: Boolean(String(topic || "").trim()),
      hasScreenplay: outlineComplete,
      assetsLocked: assetsComplete,
      segmentPlanReady,
      keyartsReady,
      cueSheetReady,
      hasClip: episodeClips.some(
        (b) => b.status === "done" && Boolean(mediaUrl(b)),
      ),
    };
  }, [
    segments,
    stillsReadyEnough,
    topic,
    outlineComplete,
    assetsComplete,
    episodeClips,
  ]);
  const videoBurnUnlocked = canManhuaBurnVideo(productionProgress);
  const videoBurnHint = videoBurnUnlocked
    ? null
    : !productionProgress.assetsLocked
      ? "请先锁定资产并出齐参考图"
      : !productionProgress.segmentPlanReady
        ? `可拍表不足：至少 ${MANHUA_SEGMENT_MIN} 段`
        : !stillsCountReady
          ? `请先出齐关键静帧（每段至少 ${MANHUA_KEYARTS_PER_SEGMENT_MIN} 张）`
          : !keyartsPixelLocked
            ? "关键静帧须带资产垫图改图（见 @角色/@场景/@道具 编号）后才能出成片"
            : !productionProgress.keyartsReady
              ? "请先完成带资产锁的关键静帧"
              : "请先确认按秒导戏单（静帧锁定后自动生成）";

  /** 门槛只用于点击时报错，禁止拿来把按钮静默变灰 */
  const keyartGateHint = explainManhuaKeyartActionGate({
    outlineComplete,
    assetGate,
    assetScriptStaleHintZh,
    factoryBusy,
  });
  const clipGateHint = explainManhuaClipActionGate({
    outlineComplete,
    assetGate,
    assetScriptStaleHintZh,
    factoryBusy,
    videoBurnHintZh: videoBurnHint,
    stillsReadyEnough,
    visualBriefConfirmed,
  });
  const fragmentGateHint = keyartGateHint;
  const refuseIfBlocked = (hint: string | null): boolean => {
    if (!hint) return false;
    toast.error("还不能跑", { description: hint });
    return true;
  };
  const clipPromptReviewUnlocked = Boolean(
    stillsReadyEnough && keyartsPixelLocked && !clipGateHint,
  );
  const openClipPromptReview = () => {
    if (!stillsReadyEnough) {
      toast.error("还不能跑", { description: "请先出齐关键静帧" });
      return;
    }
    if (!keyartsPixelLocked) {
      toast.error("还不能跑", {
        description: "关键静帧须带资产垫图锁后才能审阅成片提示词",
      });
      return;
    }
    if (refuseIfBlocked(clipGateHint)) return;
    onEnsureSegmentClips?.();
    setClipPromptReviewOpen(true);
    if (activePhase !== "storyboard") setActivePhase("storyboard");
  };
  const runGenerateFragment = () => {
    if (refuseIfBlocked(clipGateHint)) return;
    if (activePhase !== "storyboard") setActivePhase("storyboard");
    if (onGenerateFragment) {
      onGenerateFragment({
        // shotIndex 现为段号（工厂按段出一条成片）
        shotIndex: activeSegNo,
        keyartId: activeKeyart?.id,
        clipId: activeClip?.id || clip?.id,
      });
      return;
    }
    onSpawnAndRunClip?.();
  };

  const nextCta = useMemo(
    () =>
      resolveManhuaWorkbenchNextCta({
        outlineComplete,
        assetsComplete,
        episodeSheetCount: episodeSheetGallery.length,
        stillsReadyEnough,
        videoBurnUnlocked,
        hasClip: productionProgress.hasClip,
        factoryBusy: Boolean(factoryBusy),
        factoryProgress,
        writerPackReady: Boolean(writerPackReady),
      }),
    [
      outlineComplete,
      assetsComplete,
      episodeSheetGallery.length,
      stillsReadyEnough,
      videoBurnUnlocked,
      productionProgress.hasClip,
      factoryBusy,
      factoryProgress,
      writerPackReady,
    ],
  );

  const stageStrip = useMemo(() => {
    const stages = ["story", "bible", "beats", "reverse", "keyart", "clip"] as const;
    return stages.map((stage) => {
      if (stage === "keyart") {
        // 须出齐且垫图锁过，才算阶段完成；禁止「有一张图就打勾」
        const has =
          shots.length > 0
            ? episodeStillCount >= shots.length && keyartsPixelLocked
            : episodeStillCount > 0 && keyartsPixelLocked;
        return {
          stage,
          label:
            episodeKeyarts.length > 1
              ? `${MANHUA_FACTORY_STAGE_LABEL_ZH[stage]} ${episodeStillCount}/${Math.max(shots.length, episodeKeyarts.length, 1)}`
              : MANHUA_FACTORY_STAGE_LABEL_ZH[stage],
          has,
          blockId: activeKeyart?.id || episodeKeyarts[0]?.id,
        };
      }
      if (stage === "clip") {
        const has = episodeClips.some(
          (b) => b.status === "done" && b.manhuaClipQuality?.status === "passed" && mediaUrl(b),
        );
        return {
          stage,
          label: MANHUA_FACTORY_STAGE_LABEL_ZH[stage],
          has,
          blockId: activeClip?.id || episodeClips[0]?.id || legacyClip?.id,
        };
      }
      const b = blockByStage(blocks, focusEpisode, stage);
      const has = Boolean(b && (b.outputUrl || b.outputUrls?.[0] || (b.outputText || "").trim()));
      return {
        stage,
        label: MANHUA_FACTORY_STAGE_LABEL_ZH[stage],
        has,
        blockId: b?.id,
      };
    });
  }, [
    blocks,
    focusEpisode,
    episodeKeyarts,
    episodeClips,
    activeKeyart?.id,
    activeClip?.id,
    legacyClip?.id,
    episodeStillCount,
    shots.length,
    keyartsPixelLocked,
  ]);
  const storyboardReadyEnough =
    assetsComplete && (shots.length > 0 || Boolean(episodeStillCount));

  const workflowPhases = useMemo(() => {
    const byStage = new Map(stageStrip.map((item) => [item.stage, item]));
    // 大纲 → 资产 → 分镜 → 剪辑
    const definitions: Array<{
      id: WorkflowPhaseId;
      label: string;
      complete: boolean;
    }> = [
      { id: "outline", label: "剧本大纲", complete: outlineComplete },
      { id: "assets", label: "资产设定", complete: assetsComplete },
      {
        id: "storyboard",
        label: "分镜视频",
        complete: Boolean(byStage.get("clip")?.has) || episodeStillCount > 0,
      },
      {
        id: "edit",
        label: "剪辑",
        complete: Boolean(byStage.get("clip")?.has) && roughClips.length > 0,
      },
    ];
    return definitions.map((phase, index) => ({
      ...phase,
      index: index + 1,
      current: phase.id === activePhase,
    }));
  }, [
    stageStrip,
    outlineComplete,
    assetsComplete,
    activePhase,
    episodeStillCount,
    roughClips.length,
  ]);

  useEffect(() => {
    if (!outlineComplete && activePhase !== "outline") {
      setActivePhase("outline");
    }
  }, [outlineComplete, activePhase]);

  // 不再因资产未齐强制踢回资产页——用横幅 + 点击报错说明，禁止静默挡操作

  const selectPhase = (phase: WorkflowPhaseId) => {
    if ((phase === "storyboard" || phase === "edit") && !outlineComplete) {
      toast.error("还不能进分镜", { description: "请先确认剧本大纲" });
      setActivePhase("outline");
      return;
    }
    if (phase === "assets" && !outlineComplete) {
      toast.error("还不能进资产设定", { description: "请先确认剧本大纲" });
      setActivePhase("outline");
      return;
    }
    if (
      (phase === "storyboard" || phase === "edit") &&
      keyartGateHint &&
      activePhase !== phase
    ) {
      // 允许进入分镜查看，但明确告知还缺什么（不强制踢回、不静默）
      toast.message("分镜可看，生成仍有门槛", { description: keyartGateHint });
    }
    if (phase === "edit" && !storyboardReadyEnough) {
      toast.message("请先准备分镜镜头", {
        description: "剪辑台需要分镜就绪后再进入",
      });
      setActivePhase("storyboard");
      return;
    }
    setActivePhase(phase);
  };

  const enterStoryboard = () => {
    if (!outlineComplete) {
      toast.error("还不能进分镜", { description: "请先确认剧本大纲" });
      setActivePhase("outline");
      return;
    }
    if (assetScriptStaleHintZh && onRegenerateAssetsFromScript) {
      toast.message("设定图与剧本不符", {
        description: assetScriptStaleHintZh,
      });
      void onRegenerateAssetsFromScript();
      return;
    }
    if (!assetsComplete && onConfirmAssetsAndPrepareImages) {
      if (keyartGateHint) {
        toast.message("正在准备资产", { description: keyartGateHint });
      }
      void onConfirmAssetsAndPrepareImages();
      return;
    }
    if (refuseIfBlocked(keyartGateHint)) return;
    setActivePhase("storyboard");
  };

  const runGenerateAllKeyarts = () => {
    if (refuseIfBlocked(keyartGateHint)) return;
    setActivePhase("storyboard");
    setVisualBriefConfirmed(true);
    onGenerateAllEpisodeKeyarts?.();
  };

  const runNextCta = () => {
    if (nextCta.kind === "busy") {
      onStopFactory?.();
      return;
    }
    if (nextCta.kind === "confirm_outline") {
      selectPhase(nextCta.targetPhase);
      if (!writerPackReady || !onConfirmOutline) {
        toast.error("还不能跑", {
          description: "请先在「改题材」扩写或导入剧本，再确认大纲",
        });
        return;
      }
      onConfirmOutline();
      return;
    }
    if (nextCta.kind === "spawn_sheets" || nextCta.kind === "enter_storyboard") {
      enterStoryboard();
      return;
    }
    if (nextCta.kind === "generate_keyarts") {
      runGenerateAllKeyarts();
      return;
    }
    if (nextCta.kind === "generate_all_clips") {
      if (refuseIfBlocked(clipGateHint)) return;
      selectPhase("storyboard");
      const idxs =
        missingFragmentIndexes.length > 0
          ? missingFragmentIndexes
          : segments.map((s) => s.index);
      if (idxs.length) onGenerateMissingFragments?.(idxs);
      return;
    }
    if (nextCta.kind === "generate_clip") {
      runGenerateFragment();
      return;
    }
    if (nextCta.kind === "open_edit") {
      selectPhase("edit");
    }
  };

  return (
    <div
      id="manhua-workbench-shell"
      data-manhua-layout={immersive ? "immersive-3col" : "card-3col"}
      className={
        immersive
          ? "flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#0a0d14]"
          : "mt-1 flex h-[calc(100dvh-5.75rem)] min-h-[620px] w-full min-w-[1180px] flex-col overflow-hidden rounded-xl border border-white/12 bg-[#0a0d14] shadow-[0_12px_48px_rgba(0,0,0,0.45)]"
      }
    >
      {/* 顶栏 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5 md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Clapperboard className="h-4 w-4 shrink-0 text-cyan-300" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-white/95">
              {seriesTitle || topic || "剧本工作室"}
              <span className="ml-2 text-[11px] font-normal text-white/40">
                第{focusEpisode}集 · {segments.length} 段 · 约 {totalSec}s · {episodeVideoModel}
                {artStyleLabelZh ? ` · ${artStyleLabelZh}` : ""}
              </span>
            </div>
            {immersive ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => selectPhase("assets")}
                  className={`rounded px-1.5 py-0.5 font-medium ${
                    activePhase === "assets"
                      ? "bg-cyan-500/25 text-cyan-50"
                      : "text-white/55 hover:bg-white/10 hover:text-white/85"
                  }`}
                >
                  本集资产
                </button>
                <span aria-hidden className="text-white/25">
                  ｜
                </span>
                <button
                  type="button"
                  onClick={() => selectPhase("outline")}
                  className={`rounded px-1.5 py-0.5 font-medium ${
                    activePhase === "outline"
                      ? "bg-cyan-500/25 text-cyan-50"
                      : "text-white/55 hover:bg-white/10 hover:text-white/85"
                  }`}
                >
                  本集剧本
                </button>
                <span aria-hidden className="text-white/25">
                  ｜
                </span>
                <button
                  type="button"
                  onClick={() => selectPhase("storyboard")}
                  className={`rounded px-1.5 py-0.5 font-medium ${
                    activePhase === "storyboard"
                      ? "bg-cyan-500/25 text-cyan-50"
                      : "text-white/55 hover:bg-white/10 hover:text-white/85"
                  }`}
                >
                  {dockCanvas ? "本集画布" : "视频结果"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {factoryBusy && onStopFactory ? (
            <button
              type="button"
              data-manhua-action="stop-factory"
              onClick={onStopFactory}
              className="inline-flex items-center gap-1 rounded-lg border border-red-400/50 bg-red-500/20 px-3 py-1.5 text-[11px] font-semibold text-red-50 hover:bg-red-500/30"
              title="立刻中断当前生成，不必跑完整条链"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              中断生成
            </button>
          ) : (
            <>
              {onGenerateAllEpisodeKeyarts ? (
                <button
                  type="button"
                  data-manhua-action="generate-all-keyarts"
                  disabled={Boolean(factoryBusy)}
                  onClick={runGenerateAllKeyarts}
                  className={`inline-flex items-center gap-1 rounded-lg border border-cyan-300/45 bg-gradient-to-b from-cyan-400/30 to-cyan-600/25 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 disabled:opacity-45 ${
                    nextCta.kind === "generate_keyarts"
                      ? "ring-2 ring-cyan-300/70 ring-offset-1 ring-offset-[#0a121c]"
                      : ""
                  }`}
                  title={
                    keyartGateHint ||
                    "一次出齐本集关键静帧（条件不满足时会提示缺什么）"
                  }
                >
                  <Play className="h-3.5 w-3.5" />
                  生成关键静帧
                </button>
              ) : null}
              <button
                type="button"
                data-manhua-action="review-clip-prompts"
                disabled={Boolean(factoryBusy)}
                onClick={openClipPromptReview}
                className="inline-flex items-center gap-1 rounded-lg border border-cyan-300/35 bg-cyan-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-45"
                title={
                  clipGateHint ||
                  (!clipPromptReviewUnlocked
                    ? "静帧齐且垫图锁通过后可审阅各段成片提示词"
                    : "先审阅段成片提示词，再按段生成")
                }
              >
                审阅成片提示词
              </button>
              <button
                type="button"
                data-manhua-action="generate-fragment"
                disabled={Boolean(factoryBusy)}
                onClick={runGenerateFragment}
                className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-white/75 hover:bg-white/[0.08] disabled:opacity-45"
                title={
                  clipGateHint ||
                  `当前第 ${String(activeSegNo).padStart(2, "0")} 段（含镜 ${String(activeShotNo).padStart(2, "0")}）：缺静帧则只补本段再出片`
                }
              >
                {`生成第 ${String(activeSegNo).padStart(2, "0")} 段成片`}
              </button>
            </>
          )}
          {onLayoutReadableChain ? (
            <button
              type="button"
              data-manhua-action="layout-readable-chain"
              disabled={Boolean(factoryBusy)}
              onClick={() => {
                if (activePhase !== "storyboard") setActivePhase("storyboard");
                onLayoutReadableChain();
              }}
              className="rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-white/70 hover:bg-white/[0.08] disabled:opacity-45"
              title="画布竖排：角色墙→场景墙→静帧列→段成片（每段约15s卡面读秒轴）"
            >
              对齐画布竖排
            </button>
          ) : null}
          {onGenerateMissingFragments && selectedSorted.length > 0 ? (
            <button
              type="button"
              data-manhua-action="generate-selected-fragments"
              disabled={Boolean(factoryBusy)}
              onClick={() => {
                if (refuseIfBlocked(clipGateHint)) return;
                setActivePhase("storyboard");
                onGenerateMissingFragments(
                  Array.from(
                    new Set(selectedSorted.map((n) => resolveSegmentIndexFromShotIndex(n))),
                  ),
                );
              }}
              className="rounded-lg border border-cyan-300/35 bg-cyan-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-45"
              title={
                clipGateHint ||
                `依次生成已勾选段：${selectedSorted.map((n) => String(resolveSegmentIndexFromShotIndex(n)).padStart(2, "0")).join("、")}`
              }
            >
              生成所选成片 {selectedSorted.length}
            </button>
          ) : null}
          {onGenerateMissingFragments && (missingFragmentIndexes.length > 0 || stillsReadyEnough) ? (
            <button
              type="button"
              data-manhua-action="generate-missing-fragments"
              disabled={Boolean(factoryBusy)}
              onClick={() => {
                if (refuseIfBlocked(clipGateHint)) return;
                if (!stillsReadyEnough) {
                  toast.error("还不能跑", {
                    description: "请先点「生成关键静帧」出齐本集静帧",
                  });
                  return;
                }
                setActivePhase("storyboard");
                const idxs =
                  missingFragmentIndexes.length > 0
                    ? missingFragmentIndexes
                    : segments.map((s) => s.index);
                if (
                  !window.confirm(
                    `确认静帧后将生成全部段成片（${idxs.map((n) => String(n).padStart(2, "0")).join("、")}）。继续？`,
                  )
                ) {
                  return;
                }
                onGenerateMissingFragments(idxs);
              }}
              className="rounded-lg border border-fuchsia-300/35 bg-fuchsia-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-fuchsia-50 hover:bg-fuchsia-500/25 disabled:opacity-45"
              title={clipGateHint || "静帧与导戏单锁定后批量出片"}
            >
              确认静帧，生成全部成片
            </button>
          ) : null}
          {onRerunKeyartsFromReverse ? (
            <button
              type="button"
              data-manhua-action="rerun-keyarts"
              disabled={Boolean(factoryBusy)}
              onClick={() => {
                if (refuseIfBlocked(keyartGateHint)) return;
                setActivePhase("storyboard");
                onRerunKeyartsFromReverse();
              }}
              title={keyartGateHint || "从编导反推重跑本集多镜静帧，覆盖旧图"}
              className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-amber-50 hover:bg-amber-500/25 disabled:opacity-45"
            >
              重出全部分镜
            </button>
          ) : null}
          {onShotContinuityChange ? (
            <div
              data-manhua-shot-continuity
              className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-1.5 py-1"
              title="镜间接力：减少人物/场景飘移；可分别关闭"
            >
              <span className="px-1 text-[9px] text-white/40">接力</span>
              <button
                type="button"
                data-manhua-continuity="keyart"
                aria-pressed={continuity.keyartFromPrevStill}
                onClick={() =>
                  onShotContinuityChange({
                    ...continuity,
                    keyartFromPrevStill: !continuity.keyartFromPrevStill,
                  })
                }
                className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                  continuity.keyartFromPrevStill
                    ? "border border-cyan-400/40 bg-cyan-500/20 text-cyan-50"
                    : "border border-white/10 text-white/40"
                }`}
                title="A：下一镜静帧以上一镜静帧为起点"
              >
                静帧←上镜
              </button>
              <button
                type="button"
                data-manhua-continuity="clip"
                aria-pressed={continuity.clipFromPrevTail}
                onClick={() =>
                  onShotContinuityChange({
                    ...continuity,
                    clipFromPrevTail: !continuity.clipFromPrevTail,
                  })
                }
                className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                  continuity.clipFromPrevTail
                    ? "border border-emerald-400/40 bg-emerald-500/20 text-emerald-50"
                    : "border border-white/10 text-white/40"
                }`}
                title="B：下一段成片以上一段末 3–5 秒画面为起幅参考（约 15s 一镜衔接）"
              >
                成片←上段末帧
              </button>
            </div>
          ) : null}
          {onResumeFromFailure ? (
            <button
              type="button"
              disabled={Boolean(factoryBusy)}
              onClick={() => {
                if (refuseIfBlocked(keyartGateHint)) return;
                onResumeFromFailure();
              }}
              title={keyartGateHint || "仅从失败/未完成节点接着跑；已出的错图不会重做"}
              className="rounded-lg border border-white/12 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.06] disabled:opacity-45"
            >
              续跑
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenCharacterCard?.()}
            className="rounded-lg border border-white/12 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.06]"
          >
            角色库
          </button>
          <button
            type="button"
            onClick={() => onOpenAssetWall?.()}
            className="rounded-lg border border-white/12 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.06]"
          >
            资产墙
          </button>
        </div>
      </div>

      <div
        data-manhua-draft-retention-hint
        className="shrink-0 border-b border-white/8 bg-white/[0.03] px-3 py-1.5 text-[10px] leading-relaxed text-white/45"
      >
        {MANHUA_DRAFT_RETENTION_HINT_ZH}
      </div>
      {!outlineComplete ? (
        <div className="shrink-0 border-b border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-50/90">
          请先确认剧本大纲，再进入资产与分镜
        </div>
      ) : null}
      {outlineComplete && keyartGateHint ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-400/20 bg-amber-500/10 px-3 py-1.5">
          <p className="min-w-0 flex-1 text-[11px] text-amber-50/90">
            {keyartGateHint}
          </p>
          <button
            type="button"
            data-manhua-action="goto-assets-from-banner"
            onClick={() => selectPhase("assets")}
            className="shrink-0 rounded-md border border-amber-300/45 bg-amber-500/25 px-2.5 py-1 text-[10px] font-semibold text-amber-50 hover:bg-amber-500/35"
          >
            打开资产设定
          </button>
        </div>
      ) : null}
      {factoryBusy ? (
        <div
          data-manhua-status="running"
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-400/25 bg-amber-500/10 px-3 py-1.5"
        >
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-amber-50">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="truncate">
              {factoryProgress?.trim() ? factoryProgress : "生成中…"}
              <span className="ml-1.5 font-normal text-amber-50/60">可随时中断</span>
            </span>
          </div>
          {onStopFactory ? (
            <button
              type="button"
              data-manhua-action="stop-factory-banner"
              onClick={onStopFactory}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-400/45 bg-red-500/20 px-2.5 py-1 text-[10px] font-semibold text-red-50 hover:bg-red-500/30"
            >
              <Square className="h-3 w-3 fill-current" />
              中断
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 阿硕式：只留一条阶段轨（大纲→资产→分镜→剪辑），勿叠第二套进度 */}
      <div
        data-manhua-workflow-rail
        data-manhua-ashuo-stepper
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-cyan-400/25 bg-gradient-to-r from-cyan-500/[0.1] via-[#0a121c] to-transparent px-3 py-2"
      >
        <span className="mr-1 shrink-0 text-[10px] font-semibold tracking-[0.12em] text-cyan-200/70">
          阶段
        </span>
        {workflowPhases.map((phase, index) => (
          <div key={phase.id} className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              data-manhua-phase={phase.id}
              data-manhua-phase-status={
                phase.complete ? "complete" : phase.current ? "current" : "pending"
              }
              onClick={() => selectPhase(phase.id)}
              className={`flex min-w-[100px] flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left ${
                phase.complete
                  ? "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-50"
                  : phase.current
                    ? phase.id === "edit"
                      ? "border-violet-400/45 bg-violet-500/[0.12] text-violet-50"
                      : "border-cyan-400/45 bg-cyan-500/[0.12] text-cyan-50 shadow-[0_0_14px_rgba(34,211,238,0.15)]"
                    : "border-white/10 bg-white/[0.025] text-white/40"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  phase.complete
                    ? "bg-emerald-400 text-emerald-950"
                    : phase.current
                      ? "bg-cyan-300 text-cyan-950"
                      : "bg-white/10 text-white/45"
                }`}
              >
                {phase.complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : phase.index}
              </span>
              <span className="truncate text-[11px] font-semibold">
                {phase.id === "assets" ? "资产设定" : phase.label}
              </span>
              <span className="ml-auto shrink-0 text-[8px] opacity-60">
                {phase.complete ? "已完成" : phase.current ? "当前" : "待开始"}
              </span>
            </button>
            {index < workflowPhases.length - 1 ? (
              <span aria-hidden className="text-[10px] text-white/25">
                →
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <div
        data-manhua-ashuo-step-bar
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-[#0a121c] px-3 py-2"
      >
        <div className="min-w-0 flex-1">
          <div
            data-manhua-ashuo-step-title
            className="text-[13px] font-bold tracking-wide text-white/95"
          >
            {nextCta.stepTitleZh}
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-white/50">{nextCta.hintZh}</p>
        </div>
        <button
          type="button"
          data-manhua-action="ashuo-prev"
          disabled={!nextCta.prevPhase || factoryBusy}
          onClick={() => {
            if (nextCta.prevPhase) selectPhase(nextCta.prevPhase);
          }}
          className="shrink-0 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-white/70 hover:bg-white/[0.08] disabled:opacity-35"
        >
          上一步
        </button>
        <button
          type="button"
          data-manhua-action="ashuo-step-generate"
          disabled={
            nextCta.kind === "busy"
              ? !onStopFactory
              : nextCta.kind === "idle_done"
                ? true
                : Boolean(factoryBusy)
          }
          onClick={runNextCta}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12px] font-bold disabled:opacity-45 ${
            nextCta.kind === "busy"
              ? "border-red-400/50 bg-red-500/25 text-red-50"
              : "border-violet-300/50 bg-violet-500/30 text-violet-50 hover:bg-violet-500/40"
          }`}
        >
          {nextCta.kind === "busy" ? (
            <Square className="h-3.5 w-3.5 fill-current" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {nextCta.labelZh}
        </button>
      </div>

      {activePhase === "outline" ? (
        <div
          data-manhua-phase-panel="outline"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6"
        >
          <div className="mx-auto max-w-3xl">
            <div className="text-[13px] font-semibold text-white/90">剧本大纲</div>
            <p className="mt-1 text-[11px] leading-5 text-white/45">
              确认系列与分集大纲后，再进入资产设定与分镜视频。
            </p>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-[15px] font-semibold text-white/95">
                {seriesTitle || topic || "未命名系列"}
              </div>
              {(logline || topic) && (
                <p className="mt-2 text-[12px] leading-6 text-white/65">
                  {logline || topic}
                </p>
              )}
              {projectBibleSummary ? (
                <p className="mt-2 text-[11px] text-white/40">{projectBibleSummary}</p>
              ) : null}
              {viralTemplateLabelZh ? (
                <p className="mt-2 text-[11px] text-amber-100/70">
                  节奏模板：{viralTemplateLabelZh}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white/40">
                <span>共 {Math.max(episodeCount, outlineEpisodes.length, 1)} 集</span>
                <span aria-hidden>·</span>
                <span>当前第 {focusEpisode} 集</span>
                {artStyleLabelZh ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{artStyleLabelZh}</span>
                  </>
                ) : null}
              </div>
            </div>
            {outlineEpisodes.length ? (
              <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {outlineEpisodes.slice(0, 12).map((ep) => (
                  <button
                    key={ep.index}
                    type="button"
                    onClick={() => onFocusEpisode(ep.index)}
                    className={`rounded-lg border px-3 py-2 text-left ${
                      focusEpisode === ep.index
                        ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-50"
                        : "border-white/10 bg-white/[0.02] text-white/70 hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="text-[10px] text-white/40">第 {ep.index} 集</div>
                    <div className="truncate text-[12px] font-medium">
                      {ep.title || `第${ep.index}集`}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {!outlineComplete && writerPackReady && onConfirmOutline ? (
                <button
                  type="button"
                  data-manhua-action="confirm-outline"
                  onClick={() => onConfirmOutline()}
                  className="rounded-lg border border-cyan-300/45 bg-cyan-500/20 px-3.5 py-2 text-[12px] font-semibold text-cyan-50"
                >
                  确认大纲，进入资产设定
                </button>
              ) : null}
              {!outlineComplete && !writerPackReady ? (
                <p className="text-[11px] text-amber-100/80">
                  请先在上方「改题材」扩写或导入剧本，再回来确认大纲。
                </p>
              ) : null}
              {outlineComplete ? (
                <button
                  type="button"
                  data-manhua-action="goto-assets"
                  onClick={() => selectPhase("assets")}
                  className="rounded-lg border border-cyan-300/45 bg-cyan-500/20 px-3.5 py-2 text-[12px] font-semibold text-cyan-50"
                >
                  进入资产设定
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activePhase === "assets" ? (
        <div
          data-manhua-phase-panel="assets"
          data-manhua-assets-ready={assetsComplete ? "true" : "false"}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6"
        >
          <div className="mx-auto max-w-4xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-bold tracking-wide text-white/95">
                  生成本集角色设定卡
                </div>
                <p className="mt-1 text-[11px] leading-5 text-white/45">
                  {assetCanon?.characters.length
                    ? "以剧本人物表与系列场景池为准；点右上「生成全部」或底栏同名按钮出定妆与场景空镜。"
                    : "人物、场景、服装道具分栏上传或生成；未归类不进融图。"}
                  {customSummaryZh ? ` 已归类：${customSummaryZh}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onOpenCharacterCard?.()}
                  className="rounded-lg border border-white/12 px-2.5 py-1.5 text-[11px] text-white/70 hover:bg-white/[0.06]"
                >
                  库角色（可选）
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAssetWall?.()}
                  className="rounded-lg border border-white/12 px-2.5 py-1.5 text-[11px] text-white/70 hover:bg-white/[0.06]"
                >
                  库场景·道具（可选）
                </button>
                {onRegenerateAssetsFromScript ? (
                  <button
                    type="button"
                    data-manhua-action="regen-assets-from-script"
                    disabled={Boolean(factoryBusy)}
                    onClick={() => {
                      if (!outlineComplete) {
                        toast.error("还不能跑", { description: "请先确认剧本大纲" });
                        return;
                      }
                      if (!assetGate.castLocked || !assetGate.sceneLocked) {
                        toast.error("还不能跑", {
                          description: !assetGate.castLocked
                            ? "请先锁定人物（剧本人物表或勾选人物参考）"
                            : "请先锁定场景（剧本场景表或勾选场景参考）",
                        });
                        return;
                      }
                      void onRegenerateAssetsFromScript();
                    }}
                    className="rounded-lg border border-amber-300/45 bg-amber-500/20 px-3 py-1.5 text-[12px] font-semibold text-amber-50 disabled:opacity-45"
                    title="清掉与现稿不符的旧人物/场景设定图，再按剧本重出（会扣积分）"
                  >
                    按剧本重出设定图
                  </button>
                ) : null}
                <button
                  type="button"
                  data-manhua-action="confirm-assets"
                  disabled={Boolean(factoryBusy)}
                  onClick={() => {
                    if (
                      !keyartGateHint &&
                      episodeSheetGallery.length > 0 &&
                      onGenerateAllEpisodeKeyarts &&
                      !stillsReadyEnough
                    ) {
                      runGenerateAllKeyarts();
                      return;
                    }
                    if (episodeSheetGallery.length === 0 || !assetsComplete) {
                      enterStoryboard();
                      return;
                    }
                    if (refuseIfBlocked(keyartGateHint)) return;
                    setActivePhase("storyboard");
                  }}
                  className="rounded-lg border border-violet-300/50 bg-violet-500/30 px-3 py-1.5 text-[12px] font-bold text-violet-50 disabled:opacity-45"
                  title={
                    keyartGateHint ||
                    (stillsReadyEnough ? "进入分镜" : "生成关键静帧")
                  }
                >
                  {assetScriptStaleHintZh
                    ? "设定图已过期"
                    : episodeSheetGallery.length === 0 || !assetsComplete
                      ? "生成全部"
                      : !stillsReadyEnough
                        ? "生成关键静帧"
                        : "进入分镜 →"}
                </button>
              </div>
            </div>

            {assetScriptStaleHintZh ? (
              <div
                data-manhua-asset-stale-banner
                className="mt-3 rounded-xl border border-amber-300/40 bg-amber-500/15 px-3 py-2.5"
              >
                <p className="text-[12px] font-semibold text-amber-50">{assetScriptStaleHintZh}</p>
                <p className="mt-1 text-[10px] leading-4 text-amber-50/70">
                  重写剧本后旧人物图不会自动继续用。点右上「按剧本重出设定图」清掉旧生成图并按现稿重出；你手动上传的参考会保留。
                </p>
                {onRegenerateAssetsFromScript ? (
                  <button
                    type="button"
                    disabled={factoryBusy}
                    onClick={() => void onRegenerateAssetsFromScript()}
                    className="mt-2 rounded-lg border border-amber-200/50 bg-amber-400/25 px-3 py-1.5 text-[11px] font-bold text-amber-50 disabled:opacity-45"
                  >
                    立刻清掉旧图并重出
                  </button>
                ) : null}
              </div>
            ) : null}

            <div
              data-manhua-episode-sheets
              className="mt-3 space-y-2 rounded-xl border border-emerald-400/35 bg-emerald-500/[0.08] p-3"
            >
              <div>
                <div className="text-[11px] font-semibold text-emerald-50/95">
                  本集设定图 · {episodeSheetGallery.length} 张
                </div>
                <p className="mt-0.5 text-[10px] leading-4 text-white/45">
                  角色定妆与场景空镜分栏；点缩略图定位画布。生成后同步进下方「我的角色 / 我的场景」。
                </p>
              </div>
              {episodeSheetGallery.length ? (
                <>
                  {(
                    [
                      {
                        kind: "charsheet" as const,
                        titleZh: "角色定妆",
                        emptyZh: "本集尚无角色定妆",
                      },
                      {
                        kind: "sceneplate" as const,
                        titleZh: "场景空镜",
                        emptyZh: "本集尚无场景空镜",
                      },
                    ] as const
                  ).map((sec) => {
                    const items = episodeSheetGallery.filter((x) => x.kind === sec.kind);
                    return (
                      <div
                        key={sec.kind}
                        data-manhua-episode-sheets-kind={sec.kind}
                        className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2"
                      >
                        <div className="text-[10px] font-semibold text-emerald-50/80">
                          {sec.titleZh}
                          <span className="ml-1 font-normal text-white/40">· {items.length}</span>
                        </div>
                        {items.length ? (
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {items.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                data-manhua-sheet-id={item.id}
                                onClick={() => onFocusBlock?.(item.id)}
                                className="flex w-[88px] flex-col overflow-hidden rounded-lg border border-emerald-300/35 bg-black/40 text-left hover:border-emerald-200/60"
                                title={`定位：${item.labelZh}`}
                              >
                                <img
                                  src={item.url}
                                  alt=""
                                  className="aspect-[3/4] w-full object-cover object-top"
                                  loading="lazy"
                                />
                                <span className="truncate px-1.5 py-1 text-[10px] text-white/85">
                                  {item.labelZh}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-[10px] text-white/35">{sec.emptyZh}</p>
                        )}
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <p className="text-[10px] text-white/40">
                    尚未出设定图。点「生成全部」（或底栏同名按钮）；也可到下方分区上传参考。
                  </p>
                  <button
                    type="button"
                    data-manhua-action="spawn-episode-sheets"
                    disabled={
                      !outlineComplete ||
                      !assetGate.castLocked ||
                      !assetGate.sceneLocked ||
                      factoryBusy
                    }
                    onClick={enterStoryboard}
                    className="shrink-0 rounded-lg border border-violet-300/50 bg-violet-500/30 px-3 py-1.5 text-[12px] font-bold text-violet-50 hover:bg-violet-500/40 disabled:opacity-45"
                  >
                    生成全部
                  </button>
                </div>
              )}
            </div>

            <div
              data-manhua-cast-selected
              className="mt-3 rounded-xl border border-violet-400/30 bg-violet-500/[0.08] p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold text-violet-50/95">当前出演人物</div>
                  <p className="mt-0.5 text-[10px] leading-4 text-white/45">
                    默认以剧本人物表为准自动出设定图；库内点选仅为可选参考。古装线显示造型原型。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenCharacterCard?.()}
                  className="rounded-lg border border-violet-300/40 bg-violet-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-violet-50 hover:bg-violet-500/30"
                >
                  {characters.length || archetypes.length ? "更换人物" : "去选人物"}
                </button>
              </div>
              {characters.length || archetypes.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {characters.map((c) => (
                    <button
                      key={c!.id}
                      type="button"
                      onClick={() => onOpenCharacterCard?.()}
                      className="flex w-[88px] flex-col overflow-hidden rounded-lg border border-white/15 bg-black/40 text-left hover:border-violet-300/50"
                    >
                      <img
                        src={getManhuaCharacterPreviewUrl(c!.id, {
                          artStyleId: activeArtStyleId,
                        })}
                        alt=""
                        className="aspect-[3/4] w-full object-cover object-top"
                        loading="lazy"
                      />
                      <span className="truncate px-1.5 py-1 text-[10px] text-white/85">
                        {getManhuaCharacterDisplayName(c!.id, {
                          artStyleId: activeArtStyleId,
                        }) || c!.nameZh}
                      </span>
                    </button>
                  ))}
                  {archetypes.map((a) => (
                    <button
                      key={a!.id}
                      type="button"
                      onClick={() => onOpenCharacterCard?.()}
                      className="flex min-w-[88px] flex-col justify-center rounded-lg border border-amber-400/35 bg-amber-500/15 px-2 py-3 text-left text-[11px] font-semibold text-amber-50 hover:border-amber-300/55"
                    >
                      {a!.nameZh}
                      <span className="mt-0.5 text-[9px] font-normal text-amber-100/70">
                        古装造型
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 rounded-lg border border-dashed border-white/15 px-3 py-4 text-center text-[11px] text-white/45">
                  尚未点选人物 · 请点「去选人物」打开角色库
                </p>
              )}
            </div>

            {onStylePackChange ? (
              <div className="mt-3">
                <ManhuaStylePackPanel
                  value={stylePack}
                  onChange={onStylePackChange}
                  artStyleLabelZh={artStyleLabelZh}
                />
              </div>
            ) : null}

            <div data-manhua-custom-refs className="mt-3 space-y-2">
              {assetLockRegistry.slots.length ? (
                <div
                  data-manhua-asset-lock-tags
                  className="rounded-xl border border-cyan-400/30 bg-cyan-500/[0.08] px-3 py-2"
                >
                  <div className="text-[11px] font-semibold text-cyan-50/90">资产锁编号</div>
                  <p className="mt-0.5 text-[10px] leading-4 text-white/45">
                    静帧改图会按这些编号对照垫图/融图；没有编号垫图的静帧不能出成片。
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {assetLockRegistry.slots.map((s) => (
                      <span
                        key={s.tag}
                        className="rounded-md border border-cyan-300/35 bg-black/35 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-50"
                        title={s.labelZh}
                      >
                        {s.tag}
                        <span className="ml-1 font-normal text-white/50">{s.labelZh}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {onGenerateCustomAssetFromLibrary || onShareAssetToLibraryChange ? (
                <div
                  data-manhua-asset-share
                  className="rounded-xl border border-white/10 bg-black/25 px-3 py-2"
                >
                  {assetShareBilling?.giftedBlocksHalfPrice ? (
                    <p className="text-[10px] leading-4 text-amber-100/85">
                      {assetShareBilling.noticeZh}
                      {assetShareBilling.priceLabelZh
                        ? ` 本单约 ${assetShareBilling.priceLabelZh}。`
                        : ""}
                    </p>
                  ) : (
                    <>
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={Boolean(shareAssetToLibrary)}
                          disabled={!onShareAssetToLibraryChange || factoryBusy}
                          onChange={(e) =>
                            onShareAssetToLibraryChange?.(e.target.checked)
                          }
                        />
                        <span className="text-[10px] leading-4 text-white/70">
                          授权进库半价
                          {assetShareBilling?.priceLabelZh
                            ? ` · ${assetShareBilling.priceLabelZh}`
                            : ""}
                        </span>
                      </label>
                      <p className="mt-1 text-[10px] leading-4 text-white/40">
                        {assetShareBilling?.noticeZh ||
                          "勾选后本单半价并匿名进参考库；兑换码赠送积分不享半价，生成后仍无条件进库。成片与分镜静帧不享受半价。"}
                      </p>
                    </>
                  )}
                </div>
              ) : null}
              {(
                [
                  {
                    role: "character" as const,
                    titleZh: "我的角色",
                    hintZh: "上传人物参考，或基于库生成新人物。只进人物垫图/融图。",
                    border: "border-violet-400/30 bg-violet-500/[0.07]",
                    titleCls: "text-violet-50/90",
                    btnCls:
                      "border-violet-300/40 bg-violet-500/15 text-violet-50 hover:bg-violet-500/25",
                    seedReady: Boolean(characterIds[0] || ancientArchetypeIds[0]),
                    seedId: characterIds[0] || ancientArchetypeIds[0] || "",
                    genLabelZh: "基于库生成新人物",
                  },
                  {
                    role: "scene" as const,
                    titleZh: "我的场景",
                    hintZh: "上传场景空镜参考，或基于库生成新场景。与人物分栏，不混排。",
                    border: "border-emerald-400/30 bg-emerald-500/[0.07]",
                    titleCls: "text-emerald-50/90",
                    btnCls:
                      "border-emerald-300/40 bg-emerald-500/15 text-emerald-50 hover:bg-emerald-500/25",
                    seedReady: Boolean(sceneId),
                    seedId: sceneId || "",
                    genLabelZh: "基于库生成新场景",
                  },
                  {
                    role: "prop" as const,
                    titleZh: "我的服装道具",
                    hintZh:
                      "上传独立服装/道具参考（每行 3 张）。角色定妆卡里已含部分服化道，不必重复上传。",
                    border: "border-amber-400/30 bg-amber-500/[0.07]",
                    titleCls: "text-amber-50/90",
                    btnCls:
                      "border-amber-300/40 bg-amber-500/15 text-amber-50 hover:bg-amber-500/25",
                    seedReady: Boolean(propIds[0]),
                    seedId: propIds[0] || "",
                    genLabelZh: "基于库生成新服装道具",
                  },
                ] as const
              ).map((sec) => {
                const refs = customAssetRefs.filter((r) => r.role === sec.role);
                return (
                  <div
                    key={sec.role}
                    data-manhua-custom-refs-role={sec.role}
                    className={`rounded-xl border p-3 ${sec.border}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className={`text-[11px] font-semibold ${sec.titleCls}`}>
                          {sec.titleZh}
                          <span className="ml-1 font-normal text-white/40">· {refs.length}</span>
                        </div>
                        <p className="mt-0.5 text-[10px] leading-4 text-white/45">{sec.hintZh}</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {onUploadCustomAssets ? (
                          <label
                            className={`inline-flex cursor-pointer items-center rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${sec.btnCls}`}
                          >
                            上传
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              onChange={(e) => {
                                const files = e.target.files;
                                if (files?.length) void onUploadCustomAssets(files, sec.role);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        ) : null}
                        {onGenerateCustomAssetFromLibrary ? (
                          <button
                            type="button"
                            disabled={factoryBusy || !sec.seedReady}
                            onClick={() =>
                              void onGenerateCustomAssetFromLibrary({
                                role: sec.role,
                                seedLibraryId: sec.seedId,
                              })
                            }
                            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-white/70 hover:bg-white/[0.06] disabled:opacity-40"
                          >
                            {sec.genLabelZh}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {refs.length ? (
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {refs.map((ref) => {
                          const lockTag =
                            assetLockRegistry.slots.find((s) => s.path === ref.url)?.tag ||
                            assetLockRegistry.byRole[sec.role].find((s) => s.id === ref.id)?.tag;
                          return (
                          <div
                            key={ref.id}
                            data-manhua-custom-ref-id={ref.id}
                            data-manhua-asset-lock-tag={lockTag || ""}
                            className="relative overflow-hidden rounded-lg border border-white/12 bg-black/35"
                          >
                            {lockTag ? (
                              <span className="absolute left-1.5 top-1.5 z-[1] rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100">
                                {lockTag}
                              </span>
                            ) : null}
                            <img
                              src={ref.url}
                              alt=""
                              className="aspect-[3/4] w-full object-cover object-top"
                              loading="lazy"
                            />
                            <div className="space-y-1.5 p-2">
                              <div className="truncate text-[10px] text-white/55">
                                {lockTag ? `${lockTag} · ` : ""}
                                {ref.labelZh || "参考图"}
                                {ref.source === "generated" ? " · 新生成" : " · 上传"}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {MANHUA_CUSTOM_ASSET_ROLES.map((role) => {
                                  const on = ref.role === role;
                                  return (
                                    <button
                                      key={role}
                                      type="button"
                                      aria-pressed={on}
                                      onClick={() => onCustomAssetRoleChange?.(ref.id, role)}
                                      className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                                        on
                                          ? "bg-white/20 text-white"
                                          : "bg-white/5 text-white/45 hover:bg-white/10"
                                      }`}
                                    >
                                      {MANHUA_CUSTOM_ASSET_ROLE_LABEL_ZH[role]}
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() => onRemoveCustomAsset?.(ref.id)}
                                  className="ml-auto rounded px-1.5 py-0.5 text-[9px] text-rose-200/70 hover:bg-rose-500/20"
                                >
                                  删除
                                </button>
                              </div>
                              {onCustomAssetDutyChange ? (
                                <label
                                  className="flex flex-col gap-0.5 text-[9px] text-white/40"
                                  title="成片时这张垫图锁什么：人物默认锁脸、场景默认锁场；可手改"
                                >
                                  <span className="flex items-center gap-1">
                                    垫图用途
                                    <span className="rounded bg-white/10 px-1 text-[8px] text-white/45">
                                      自动+可改
                                    </span>
                                  </span>
                                  <select
                                    value={ref.refDuty || ""}
                                    onChange={(e) => {
                                      const v = e.target.value.trim();
                                      onCustomAssetDutyChange(
                                        ref.id,
                                        (MANHUA_REF_DUTIES as readonly string[]).includes(v)
                                          ? (v as ManhuaCustomAssetRefDuty)
                                          : null,
                                      );
                                    }}
                                    className="min-w-0 w-full rounded border border-white/12 bg-black/40 px-1 py-0.5 text-[9px] text-white/75"
                                  >
                                    <option value="">未标注</option>
                                    {MANHUA_REF_DUTIES.map((d) => (
                                      <option key={d} value={d}>
                                        {MANHUA_CUSTOM_ASSET_REF_DUTY_LABEL_ZH[d]}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ) : null}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-[10px] text-white/35">本栏尚无参考图。</p>
                    )}
                  </div>
                );
              })}
              {customAssetRefs.some((r) => r.role === "unset") ? (
                <div
                  data-manhua-custom-refs-role="unset"
                  className="rounded-xl border border-white/15 bg-white/[0.03] p-3"
                >
                  <div className="text-[11px] font-semibold text-white/70">待归类</div>
                  <p className="mt-0.5 text-[10px] text-white/40">
                    旧上传未分栏的图；请点人物 / 场景 / 服装道具归入对应栏，未归类不进融图。
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {customAssetRefs
                      .filter((r) => r.role === "unset")
                      .map((ref) => (
                        <div
                          key={ref.id}
                          data-manhua-custom-ref-id={ref.id}
                          className="overflow-hidden rounded-lg border border-white/12 bg-black/35"
                        >
                          <img
                            src={ref.url}
                            alt=""
                            className="aspect-[3/4] w-full object-cover object-top"
                            loading="lazy"
                          />
                          <div className="space-y-1.5 p-2">
                            <div className="truncate text-[10px] text-white/55">
                              {ref.labelZh || "参考图"}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {MANHUA_CUSTOM_ASSET_ROLES.map((role) => (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => onCustomAssetRoleChange?.(ref.id, role)}
                                  className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-white/55 hover:bg-white/10"
                                >
                                  {MANHUA_CUSTOM_ASSET_ROLE_LABEL_ZH[role]}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => onRemoveCustomAsset?.(ref.id)}
                                className="ml-auto rounded px-1.5 py-0.5 text-[9px] text-rose-200/70 hover:bg-rose-500/20"
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}
            </div>

            {onArtStyleChange ? (
              <div
                data-manhua-art-style
                className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="text-[11px] font-semibold text-white/75">成片画风（自选，不硬套）</div>
                <p className="mt-0.5 text-[10px] text-white/40">
                  仿真人 / CG 漫剧均可；影响静帧与成片，与角色库底栏同步。
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {MANHUA_ART_STYLE_PRESETS.map((p) => {
                    const on = activeArtStyleId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        data-manhua-art-style-id={p.id}
                        aria-pressed={on}
                        onClick={() => onArtStyleChange(p.id)}
                        className={`rounded-lg border px-3 py-2.5 text-left transition ${
                          on
                            ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-50"
                            : "border-white/12 bg-black/30 text-white/65 hover:border-white/25"
                        }`}
                      >
                        <div className="text-[12px] font-semibold">{p.labelZh}</div>
                        <div className="mt-0.5 text-[10px] text-white/45">{p.shortZh}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {assetCanon?.locations.length ||
            assetCanon?.characters.length ||
            assetCanon?.props.length ? (
              <div
                data-manhua-writer-canon
                className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.07] p-3"
              >
                <div className="text-[11px] font-semibold text-amber-50/95">剧本表 · 系列资产</div>
                <p className="mt-0.5 text-[10px] leading-4 text-white/45">
                  人物 {assetCanon?.characters.length || 0} · 道具 {assetCanon?.props.length || 0} ·
                  场景池 {assetCanon?.locations.length || 0}
                  {episodeMainScene
                    ? ` · 本集主场景「${episodeMainScene.nameZh}」`
                    : ""}
                  。竖排每行 3 个；人物定妆卡已含部分服化道细节。
                </p>
                {assetCanon?.characters.length ? (
                  <div className="mt-2">
                    <div className="mb-1 text-[9px] font-semibold text-white/40">人物</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {assetCanon.characters.map((ch, i) => {
                        const isMain = i === 0 || /主/.test(String(ch.nameZh || ""));
                        return (
                          <span
                            key={ch.id}
                            className={`truncate rounded-md border px-2 py-1.5 text-[10px] ${
                              isMain
                                ? "border-amber-300/45 bg-amber-500/20 text-amber-50"
                                : "border-white/10 bg-white/[0.03] text-white/65"
                            }`}
                            title={ch.nameZh}
                          >
                            {isMain ? "主 · " : ""}
                            {ch.nameZh}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {assetCanon?.props.length ? (
                  <div className="mt-2">
                    <div className="mb-1 text-[9px] font-semibold text-white/40">
                      道具 · 服装（独立条目；角色卡内服化另见定妆）
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {assetCanon.props.map((it) => (
                        <span
                          key={it.id}
                          className="truncate rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] text-white/60"
                          title={it.nameZh}
                        >
                          {it.nameZh}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {assetCanon?.locations.length ? (
                  <div className="mt-2">
                    <div className="mb-1 text-[9px] font-semibold text-white/40">场景池</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {assetCanon.locations.map((loc) => {
                        const isMain = episodeMainScene?.id === loc.id;
                        return (
                          <span
                            key={loc.id}
                            className={`truncate rounded-md border px-2 py-1.5 text-[10px] ${
                              isMain
                                ? "border-amber-300/45 bg-amber-500/20 text-amber-50"
                                : "border-white/10 bg-white/[0.03] text-white/55"
                            }`}
                            title={loc.nameZh}
                          >
                            {isMain ? "主 · " : ""}
                            {loc.nameZh}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div
              data-manhua-asset-ready
              className="mt-3 flex flex-wrap gap-1.5 text-[10px]"
            >
              <span
                className={`rounded-md border px-2 py-0.5 ${
                  assetGate.castLocked
                    ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-50"
                    : "border-white/10 bg-white/[0.03] text-white/40"
                }`}
              >
                角色{" "}
                {assetGate.viaCustomUpload
                  ? "自传已勾选"
                  : assetGate.viaWriterCanon
                    ? `剧本表 ${assetCanon?.characters.length || 0}`
                    : characters.length || archetypes.length
                      ? `库选 ${(characters.length || 0) + (archetypes.length || 0)}`
                      : "未齐"}
              </span>
              <span
                className={`rounded-md border px-2 py-0.5 ${
                  assetGate.sceneLocked
                    ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-50"
                    : "border-white/10 bg-white/[0.03] text-white/40"
                }`}
              >
                场景{" "}
                {assetGate.viaCustomUpload
                  ? "自传已勾选"
                  : assetGate.viaWriterCanon
                    ? episodeMainScene
                      ? `主场景「${episodeMainScene.nameZh}」`
                      : "场景池已锁"
                    : scene
                      ? "库选"
                      : "未齐"}
                {scene && !sceneDemos.length && !assetGate.viaCustomUpload && !assetGate.viaWriterCanon
                  ? " · 缺示意封面"
                  : ""}
              </span>
              <span
                className={`rounded-md border px-2 py-0.5 ${
                  props.length
                    ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-50"
                    : "border-white/10 bg-white/[0.03] text-white/40"
                }`}
              >
                道具 {props.length ? `已选 ${props.length}` : "可选"}
              </span>
              <span
                className={`rounded-md border px-2 py-0.5 ${
                  assetsComplete
                    ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-50"
                    : "border-rose-400/30 bg-rose-500/10 text-rose-50"
                }`}
              >
                {assetsComplete
                  ? "可进分镜"
                  : !assetGate.castImagesReady
                    ? "缺角色图"
                    : !assetGate.sceneImageReady
                      ? "缺场景图"
                      : "未齐"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-white/70">
                  <span>角色 · {(characters.length || 0) + (archetypes.length || 0)}</span>
                  <button
                    type="button"
                    onClick={() => onOpenCharacterCard?.()}
                    className="text-[9px] font-normal text-cyan-200/80 hover:text-cyan-100"
                  >
                    更换
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {characters.map((c) => (
                    <button
                      key={c!.id}
                      type="button"
                      onClick={() => onOpenCharacterCard?.()}
                      className="overflow-hidden rounded-lg border border-white/12 bg-black/40 text-left hover:border-cyan-400/40"
                      title="点击更换角色"
                    >
                      <img
                        src={getManhuaCharacterPreviewUrl(c!.id, { artStyleId: activeArtStyleId })}
                        alt=""
                        className="aspect-square w-full object-cover object-top"
                        loading="lazy"
                      />
                      <div className="truncate px-1 py-0.5 text-[9px] text-white/80">
                        {getManhuaCharacterDisplayName(c!.id, {
                          artStyleId: activeArtStyleId,
                        }) || c!.nameZh}
                      </div>
                    </button>
                  ))}
                  {archetypes.map((a) => (
                    <button
                      key={a!.id}
                      type="button"
                      onClick={() => onOpenCharacterCard?.()}
                      className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-1.5 py-2 text-left text-[9px] text-amber-50 hover:border-amber-300/50"
                      title="点击更换造型"
                    >
                      {a!.nameZh}
                    </button>
                  ))}
                  {!characters.length && !archetypes.length ? (
                    <button
                      type="button"
                      onClick={() => onOpenCharacterCard?.()}
                      className="col-span-3 rounded-lg border border-dashed border-white/15 px-2 py-6 text-[10px] text-white/40"
                    >
                      尚未选角色 · 点此更换
                    </button>
                  ) : null}
                </div>
              </section>
              <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-white/70">
                  <span>场景</span>
                  <button
                    type="button"
                    onClick={() => onOpenAssetWall?.()}
                    className="text-[9px] font-normal text-cyan-200/80 hover:text-cyan-100"
                  >
                    更换
                  </button>
                </div>
                {scene ? (
                  <button
                    type="button"
                    onClick={() => onOpenAssetWall?.()}
                    className="w-full overflow-hidden rounded-lg border border-white/12 text-left hover:border-cyan-400/40"
                    title="点击更换场景"
                  >
                    {sceneDemos[0] ? (
                      <img
                        src={getManhuaDemoAssetPublicUrl(sceneDemos[0].id)}
                        alt=""
                        className="aspect-video w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex aspect-video items-center justify-center bg-black/40 text-[10px] text-white/35">
                        场景已选
                      </div>
                    )}
                    <div className="px-2 py-1.5 text-[11px] text-white/80">{scene.nameZh}</div>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenAssetWall?.()}
                    className="w-full rounded-lg border border-dashed border-white/15 px-2 py-8 text-[10px] text-white/40"
                  >
                    尚未选场景 · 点此更换
                  </button>
                )}
              </section>
              <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-white/70">
                  <span>道具·服装 · {props.length}</span>
                  <button
                    type="button"
                    onClick={() => onOpenAssetWall?.()}
                    className="text-[9px] font-normal text-cyan-200/80 hover:text-cyan-100"
                  >
                    更换
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {props.map((p) => (
                    <button
                      key={p!.id}
                      type="button"
                      onClick={() => onOpenAssetWall?.()}
                      className="overflow-hidden rounded-lg border border-white/12 bg-black/40 text-left hover:border-cyan-400/40"
                      title="点击更换道具或服装"
                    >
                      <img
                        src={getManhuaDemoAssetPublicUrl(p!.id)}
                        alt=""
                        className="aspect-square w-full object-cover"
                        loading="lazy"
                      />
                      <div className="truncate px-1 py-0.5 text-[9px] text-white/80">
                        {p!.nameZh}
                      </div>
                    </button>
                  ))}
                  {!props.length ? (
                    <button
                      type="button"
                      onClick={() => onOpenAssetWall?.()}
                      className="col-span-3 rounded-lg border border-dashed border-white/15 px-2 py-6 text-[10px] text-white/40"
                    >
                      道具·服装可选 · 点此添加或更换
                    </button>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {activePhase === "edit" ? (
        <div
          data-manhua-phase-panel="edit"
          className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-white/5"
        >
          <ManhuaEditMultitrackPanel
            roughClips={roughClips}
            shots={shots}
            stillIndexes={stillIndexSet}
            clipIndexes={clipIndexSet}
            activeShotIndex={activeShotNo}
            fineCutByShot={fineCutByShot}
            onFineCutChange={(shotIndex: number, trim: ManhuaFineCutTrim) => {
              setFineCutByShot((prev) => ({ ...prev, [shotIndex]: trim }));
            }}
            subtitleEnabled={editSubtitleEnabled}
            onSubtitleEnabledChange={(next) => {
              setEditSubtitleEnabled(next);
              if (deliveryPackage && onDeliveryPackageChange) {
                onDeliveryPackageChange(syncDeliveryPackageSubtitleEnabled(deliveryPackage, next));
              }
            }}
            motionPromptIds={editMotionPromptIds}
            onMotionPromptIdsChange={setEditMotionPromptIds}
            shotMedia={editShotMedia}
            factoryBusy={factoryBusy}
            dockSelectedIds={dockSelectedIds}
            deliveryPackage={deliveryPackage}
            onDeliveryPackageChange={(next) => {
              onDeliveryPackageChange?.(next);
              setEditSubtitleEnabled(Boolean(next.subtitle.needSubtitles));
            }}
            cineVocabLocale={cineVocabLocale}
            onCineVocabLocaleChange={onCineVocabLocaleChange}
            onRetakeClip={onRetakeClip}
            onToggleDockClip={(clipBlockId, selected) => {
              if (!onDockSelectedIdsChange) return;
              const next = new Set(dockSelectedIds || []);
              if (selected) next.add(clipBlockId);
              else next.delete(clipBlockId);
              onDockSelectedIdsChange(next);
            }}
            onSelectExportableClips={(ids) => {
              if (!onDockSelectedIdsChange) return;
              const next = new Set(dockSelectedIds || []);
              for (const id of ids) next.add(id);
              onDockSelectedIdsChange(next);
            }}
            onReworkClip={(shotIndex) => {
              onGenerateFragment?.({
                shotIndex: resolveSegmentIndexFromShotIndex(shotIndex),
              });
            }}
            onReworkFailedClips={(indexes) => {
              onGenerateMissingFragments?.(
                Array.from(
                  new Set(indexes.map((n) => resolveSegmentIndexFromShotIndex(n))),
                ),
              );
            }}
            onReworkStill={(shotIndex) => {
              const media = editShotMedia.find((m) => m.shotIndex === shotIndex);
              if (media?.keyartBlockId && onRerunKeyartShot) {
                onRerunKeyartShot(media.keyartBlockId, shotIndex);
              }
            }}
            onAcceptDespiteQc={(clipBlockId) => {
              onAcceptClipDespiteQc?.(clipBlockId);
              if (onDockSelectedIdsChange) {
                const next = new Set(dockSelectedIds || []);
                next.add(clipBlockId);
                onDockSelectedIdsChange(next);
              }
            }}
            onOpenClipDock={() => {
              document.querySelector("#manhua-clip-dock-zone")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }}
            onSelectShot={(idx) => {
              const i = shots.findIndex((s) => s.index === idx);
              if (i >= 0) setShotIndex(i);
            }}
            onReorder={setRoughShotOrder}
          />
          <div className="shrink-0 border-t border-white/10 px-3 py-2">
            <button
              type="button"
              onClick={() => selectPhase("storyboard")}
              className="text-[10px] text-cyan-200/80 underline-offset-2 hover:underline"
            >
              ← 返回分镜视频
            </button>
            {!storyboardReadyEnough ? (
              <span className="ml-3 text-[10px] text-amber-100/70">
                请先在分镜阶段准备镜头后再剪辑
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 阿硕工作流：左本集资产｜中片段脚本｜右本集画布；窄屏保持桌面比例并横移 */}
      <div
        data-manhua-phase-panel="storyboard"
        className={
          activePhase !== "storyboard"
            ? "hidden"
            :             immersive
              ? showCanvasDock
                ? "grid min-h-0 min-w-[1280px] flex-1 grid-cols-[200px_minmax(300px,0.85fr)_minmax(480px,1.35fr)] overflow-x-auto overflow-y-hidden"
                : "grid min-h-0 min-w-[1120px] flex-1 grid-cols-[220px_minmax(420px,1fr)_minmax(380px,440px)] overflow-x-auto overflow-y-hidden"
              : "flex min-h-0 flex-1 overflow-hidden"
        }
      >
        {/* 左：本片段挂载（随胶片切换）+ 本集其他 */}
        <aside
          data-manhua-column="assets"
          data-manhua-shot-mount={shotMount.mode}
          data-manhua-shot-mount-cast={String(mountedCastCount)}
          className={
            immersive
              ? "min-h-0 overflow-y-auto border-r border-white/10 p-2.5"
              : "min-h-0 w-[240px] shrink-0 overflow-y-auto border-r border-white/10 p-2.5"
          }
        >
          <div className="mb-2.5 space-y-2">
            <ManhuaAgentAdvisorPanel
              compact
              topic={topic}
              factoryBusy={factoryBusy}
              onAdvisorBusyChange={onAdvisorBusyChange}
              onApplySync={onAdvisorApplySync}
              onUpdateBeatsText={onAdvisorUpdateBeatsText}
              onUpdateStoryText={onAdvisorUpdateStoryText}
              onConfirmVisualBrief={() => setVisualBriefConfirmed(true)}
              onRequestKeyarts={() => {
                setVisualBriefConfirmed(true);
                onGenerateAllEpisodeKeyarts?.();
              }}
              onRequestClips={(shotIndexes) => {
                const idx = shotIndexes?.[0] ?? activeShotNo;
                const keyarts = keyartsForEpisode(blocks, focusEpisode);
                const keyart = keyarts.find(
                  (k) => resolveKeyartShotIndex(k.id, k.prompt) === idx,
                );
                onGenerateFragment?.({
                  shotIndex: resolveSegmentIndexFromShotIndex(idx),
                  keyartId: keyart?.id,
                });
              }}
            />
            <ManhuaIntegratedAssetBoardPanel
              compact
              board={integratedBoard}
              onCopyInjectSummary={(text) => {
                void navigator.clipboard?.writeText(text).then(
                  () => toast.success("已复制一体参考摘要"),
                  () => toast.message(text.slice(0, 120)),
                );
              }}
            />
          </div>
          <div className="mb-2 flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-white/85">
                本片段挂载
                <span className="ml-1 text-[10px] font-normal text-white/40">
                  {String(activeShotNo).padStart(2, "0")}
                </span>
              </div>
              <div className="mt-0.5 text-[9px] text-white/35">
                {shotMount.mode === "matched" ? "按分镜文案点名" : "默认本集资产"}
                {mountGap > 0 ? ` · 还缺 ${mountGap} 人同框` : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenCharacterCard?.()}
              className="shrink-0 text-[10px] text-cyan-200/80 underline-offset-2 hover:underline"
            >
              换造型
            </button>
          </div>

          <div className="text-[10px] font-semibold tracking-wide text-white/40">
            角色 · 上场 {mountedCastCount}/
            {(characters.length || 0) + (archetypes.length || 0)}
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {characters.map((c) => {
              const onShot = mountedCharacterIdSet.has(c!.id);
              return (
                <button
                  key={c!.id}
                  type="button"
                  data-manhua-mount-char={c!.id}
                  data-manhua-mount-on={onShot ? "true" : "false"}
                  onClick={() => onOpenCharacterCard?.()}
                  className={`overflow-hidden rounded-lg border text-left ${
                    onShot
                      ? "border-cyan-400/55 bg-cyan-500/10 ring-1 ring-cyan-400/30"
                      : "border-white/10 bg-black/40 opacity-45"
                  }`}
                  title={onShot ? "本片段上场" : "本集其他·本片段未挂"}
                >
                  <img
                    src={getManhuaCharacterPreviewUrl(c!.id)}
                    alt=""
                    className="aspect-square w-full object-cover object-top"
                    loading="lazy"
                  />
                  <div className="truncate px-1 py-0.5 text-[9px] text-white/80">
                    {onShot ? "● " : ""}
                    {c!.nameZh}
                  </div>
                </button>
              );
            })}
            {archetypes.map((a) => {
              const onShot = mountedArchetypeIdSet.has(a!.id);
              return (
                <button
                  key={a!.id}
                  type="button"
                  data-manhua-mount-arch={a!.id}
                  data-manhua-mount-on={onShot ? "true" : "false"}
                  onClick={() => onOpenCharacterCard?.()}
                  className={`overflow-hidden rounded-lg border text-left ${
                    onShot
                      ? "border-amber-400/55 bg-gradient-to-b from-amber-500/25 to-black/50 ring-1 ring-amber-400/30"
                      : "border-amber-400/20 bg-gradient-to-b from-amber-500/10 to-black/50 opacity-45"
                  }`}
                  title={
                    onShot
                      ? `${a!.nameZh} · 本片段上场`
                      : `${a!.nameZh} · 本集其他`
                  }
                >
                  <div className="flex aspect-square w-full flex-col justify-between p-1.5">
                    <span className="rounded bg-black/45 px-1 py-0.5 text-[8px] text-amber-100/80">
                      {onShot ? "上场" : "本集"}
                    </span>
                    <div>
                      <div className="line-clamp-2 text-[10px] font-semibold leading-tight text-amber-50">
                        {a!.nameZh}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[8px] leading-snug text-white/45">
                        {(a!.wardrobeLayers || []).slice(0, 2).join("·") || "古装层次"}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            {!characters.length && !archetypes.length ? (
              <button
                type="button"
                onClick={() => onOpenCharacterCard?.()}
                className="col-span-3 rounded-lg border border-dashed border-white/15 px-2 py-5 text-center text-[10px] text-white/40"
              >
                尚未套用角色 · 打开角色卡
              </button>
            ) : null}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="text-[10px] font-semibold tracking-wide text-white/40">
              场景 · {sceneDemos.length || (scene ? 1 : 0)}
            </div>
            <button
              type="button"
              onClick={() => onOpenAssetWall?.()}
              className="text-[10px] text-cyan-200/80 underline-offset-2 hover:underline"
            >
              资产墙
            </button>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {sceneDemos.map((d) => {
              const url = getManhuaDemoAssetPublicUrl(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onOpenAssetWall?.()}
                  className="overflow-hidden rounded-lg border border-white/12 bg-black/40 text-left"
                  title={d.nameZh}
                >
                  {url ? (
                    <img src={url} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex aspect-video items-center justify-center text-[9px] text-white/30">
                      待生成
                    </div>
                  )}
                  <div className="truncate px-1 py-0.5 text-[9px] text-white/70">{d.nameZh}</div>
                </button>
              );
            })}
            {!sceneDemos.length ? (
              <div className="col-span-2 rounded-lg border border-white/10 bg-black/35 px-2 py-3 text-[11px] text-white/55">
                {scene ? scene.nameZh : "未选场景（铺板时按题材推荐）"}
              </div>
            ) : null}
          </div>

          <div className="mt-3 text-[10px] font-semibold tracking-wide text-white/40">
            道具 · 上场 {shotMount.propIds.length}/{props.length}
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {props.map((p) => {
              const onShot = mountedPropIdSet.has(p!.id);
              return (
                <button
                  key={p!.id}
                  type="button"
                  data-manhua-mount-prop={p!.id}
                  data-manhua-mount-on={onShot ? "true" : "false"}
                  onClick={() => onOpenAssetWall?.()}
                  className={`overflow-hidden rounded-md border text-left ${
                    onShot
                      ? "border-cyan-400/45 bg-black/40 ring-1 ring-cyan-400/25"
                      : "border-white/10 bg-black/40 opacity-45"
                  }`}
                  title={onShot ? `${p!.nameZh} · 本片段` : `${p!.nameZh} · 本集其他`}
                >
                  <img
                    src={getManhuaDemoAssetPublicUrl(p!.id)}
                    alt=""
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
                    }}
                  />
                  <div className="truncate px-1 py-0.5 text-[9px] text-white/65">{p!.nameZh}</div>
                </button>
              );
            })}
            {!props.length ? (
              <button
                type="button"
                onClick={() => onOpenAssetWall?.()}
                className="col-span-3 rounded-lg border border-dashed border-white/15 px-2 py-4 text-center text-[10px] text-white/40"
              >
                未点选道具 · 打开资产墙
              </button>
            ) : null}
          </div>

          <button
            type="button"
            data-manhua-open-path-tab
            onClick={() => setScriptTab("path")}
            className="mt-3 w-full rounded-xl border border-cyan-400/25 bg-cyan-500/[0.08] px-2.5 py-2 text-left text-[10px] leading-relaxed text-white/65 hover:border-cyan-300/40 hover:bg-cyan-500/[0.12]"
          >
            <div className="mb-1 text-[10px] font-semibold text-cyan-100/90">运镜 · 点此画轨</div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-md border border-sky-400/35 bg-sky-500/20 px-1.5 py-0.5 text-sky-50">
                蓝线·镜头
              </span>
              <span className="rounded-md border border-rose-400/35 bg-rose-500/20 px-1.5 py-0.5 text-rose-50">
                红线·人物
              </span>
            </div>
            <div className="mt-1.5 text-white/55">{pathTrackLabelZh || "尚未画轨 · 中栏「运镜」可画"}</div>
            <div className="mt-0.5 text-white/45">
              灯光：{narrativeLightingLabelZh || "未选"}
            </div>
          </button>
        </aside>

        {/* 中：片段脚本 */}
        <section
          data-manhua-column="script"
          className={
            immersive
              ? "flex min-h-0 flex-col overflow-hidden border-r border-white/10 p-2.5 md:p-3"
              : "flex min-h-0 min-w-[360px] flex-1 flex-col overflow-hidden border-r border-white/10 p-2.5 md:p-3"
          }
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-white/85">
                第 {String(activeSegNo).padStart(2, "0")} 段
                {story?.episodeTitle ? ` · ${story.episodeTitle}` : ""}
                <span className="ml-2 font-normal text-white/40">
                  {activeSegment?.durationSec ?? 15}s · 静帧 {activeShot?.index ?? "—"}/
                  {shots.length || 1} · {episodeVideoModel}
                </span>
              </div>
              {onSegmentIntentChange ? (
                <label className="mt-1.5 flex max-w-xl flex-col gap-0.5">
                  <span className="text-[9px] font-medium text-cyan-100/70">本段意图（观众应感到什么）</span>
                  <input
                    data-manhua-segment-intent={activeSegNo}
                    value={String(
                      activeSegment?.shots.find((s) => s.intentZh)?.intentZh ||
                        activeShot?.intentZh ||
                        "",
                    )}
                    onChange={(e) => onSegmentIntentChange(activeSegNo, e.target.value)}
                    placeholder="例：压迫感逼近，旧盟从硬撑到松口"
                    className="w-full rounded-md border border-cyan-400/25 bg-black/40 px-2 py-1 text-[11px] text-white/85 placeholder:text-white/30"
                  />
                </label>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-black/30 p-0.5">
              {(
                [
                  ["shots", "分镜"],
                  ["path", "运镜"],
                  ["board", "参考板"],
                  ["edit", "粗剪"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  data-manhua-script-tab={id}
                  onClick={() => setScriptTab(id)}
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                    scriptTab === id
                      ? id === "path"
                        ? "bg-sky-500/25 text-sky-50"
                        : id === "board"
                          ? "bg-amber-500/25 text-amber-50"
                          : id === "edit"
                            ? "bg-violet-500/25 text-violet-50"
                            : "bg-white/12 text-white"
                      : "text-white/40 hover:text-white/70"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {scriptTab === "shots" ? (
            <>
              <p className="mt-2 max-h-14 shrink-0 overflow-y-auto rounded-lg border border-white/8 bg-black/30 px-2.5 py-2 text-[11px] leading-relaxed text-white/55">
                {(
                  story?.outputText ||
                  story?.prompt ||
                  topic ||
                  "铺板并跑过故事节点后，此处显示本集摘要。"
                ).slice(0, 360)}
              </p>

              <div
                data-manhua-visual-brief-gate
                data-manhua-brief-confirmed={visualBriefConfirmed ? "true" : "false"}
                className="mt-2 shrink-0 rounded-lg border border-cyan-400/30 bg-cyan-500/[0.07] px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold text-cyan-50/90">视觉简报（出图前确认）</div>
                  <span className="text-[9px] text-white/40">
                    {visualBriefConfirmed ? "已确认" : "未确认"} · 静帧 {episodeStillCount}/
                    {Math.max(episodeKeyarts.length, shots.length, 1)}
                    {episodeKeyarts.some((b) => b.status === "error")
                      ? ` · 失败 ${episodeKeyarts.filter((b) => b.status === "error").length}`
                      : ""}
                  </span>
                </div>
                <div className="mt-1.5 grid max-h-28 gap-1 overflow-y-auto text-[10px] leading-4 text-white/65">
                  {visualBrief.pathLabelZh ? (
                    <div>运镜：{visualBrief.pathLabelZh}</div>
                  ) : null}
                  {visualBrief.actionLabelZh ? (
                    <div>动作轨：{visualBrief.actionLabelZh}</div>
                  ) : null}
                  {visualBrief.scenes[0] ? (
                    <div>场景：{visualBrief.scenes.slice(0, 2).join(" · ")}</div>
                  ) : null}
                  {visualBrief.cameras[0] ? (
                    <div>镜头：{visualBrief.cameras.slice(0, 2).join(" · ")}</div>
                  ) : null}
                  {(() => {
                    const ang = getManhuaCameraAngle(shotAngleByIndex[activeShotNo]);
                    return ang ? <div>机位：{ang.nameZh} · {ang.techHintZh}</div> : null;
                  })()}
                  {visualBrief.motions[0] ? (
                    <div>动作：{visualBrief.motions.slice(0, 2).join(" · ")}</div>
                  ) : null}
                  {visualBrief.events[0] ? (
                    <div>事件：{visualBrief.events.slice(0, 2).join(" · ")}</div>
                  ) : null}
                  {visualBrief.performanceLines?.[0] ? (
                    <div>表演：{visualBrief.performanceLines.slice(0, 2).join(" ｜ ")}</div>
                  ) : null}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    data-manhua-action="confirm-visual-brief"
                    disabled={factoryBusy}
                    onClick={() => setVisualBriefConfirmed(true)}
                    className="rounded-md border border-cyan-300/40 bg-cyan-500/20 px-2 py-1 text-[10px] font-semibold text-cyan-50 disabled:opacity-40"
                  >
                    确认简报
                  </button>
                  {onGenerateAllEpisodeKeyarts ? (
                    <button
                      type="button"
                      disabled={Boolean(factoryBusy)}
                      onClick={runGenerateAllKeyarts}
                      className="rounded-md border border-cyan-300/40 bg-cyan-500/15 px-2 py-1 text-[10px] font-semibold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-40"
                    >
                      生成关键静帧
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 shrink-0 text-[11px] font-semibold text-white/70">
                分镜（{shots.length}）· 当前第 {activeShot?.index ?? "—"} 镜
              </div>
              <div className="mt-1.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                {shots.map((shot, i) => {
                  const on = i === Math.min(shotIndex, shots.length - 1);
                  // 严格按镜号对齐；禁止用列表下标顶替，避免有图/失败状态错位
                  const shotKey = episodeKeyarts.find(
                    (b) => resolveKeyartShotIndex(b.id, b.prompt) === shot.index,
                  );
                  const thumb = mediaUrl(shotKey);
                  const keyartFailed =
                    Boolean(shotKey) &&
                    (shotKey!.status === "error" || Boolean(shotKey!.error)) &&
                    !thumb;
                  const keyartRunning = shotKey?.status === "running" && !thumb;
                  const keyartUnlocked = Boolean(thumb && shotKey && !isManhuaKeyartPixelLocked(shotKey));
                  return (
                    <div
                      key={shot.index}
                      data-manhua-shot={shot.index}
                      data-manhua-active={on ? "true" : "false"}
                      data-manhua-keyart-url={thumb || ""}
                      data-manhua-keyart-status={
                        keyartUnlocked
                          ? "unlocked"
                          : thumb
                            ? "ready"
                            : keyartFailed
                              ? "error"
                              : keyartRunning
                                ? "running"
                                : "idle"
                      }
                      className={`flex w-full items-stretch rounded-lg border text-left transition ${
                        on
                          ? "border-cyan-400/50 bg-cyan-500/15"
                          : "border-white/10 bg-white/[0.03] hover:border-white/20"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setShotIndex(i)}
                        className="flex min-w-0 flex-1 gap-2 px-2 py-2 text-left"
                      >
                        <div
                          className={`relative h-14 w-10 shrink-0 overflow-hidden rounded-md border border-dashed bg-amber-500/10 ${
                            keyartFailed || keyartUnlocked
                              ? "border-red-400/55"
                              : "border-amber-400/35"
                          }`}
                          title={
                            keyartUnlocked
                              ? "有图但未带资产垫图锁，不能直接出成片；请重出该镜静帧"
                              : undefined
                          }
                        >
                          {thumb ? (
                            <>
                              <img src={thumb} alt="" className="h-full w-full object-cover" />
                              {keyartUnlocked ? (
                                <span className="absolute inset-x-0 bottom-0 bg-red-900/75 px-0.5 py-px text-center text-[7px] font-semibold text-red-50">
                                  未锁
                                </span>
                              ) : null}
                            </>
                          ) : keyartFailed ? (
                            <div className="flex h-full items-center justify-center px-0.5 text-center text-[8px] font-semibold leading-tight text-red-100/90">
                              失败
                            </div>
                          ) : keyartRunning ? (
                            <div className="flex h-full items-center justify-center text-[8px] text-amber-100/80">
                              …
                            </div>
                          ) : (
                            <div className="flex h-full flex-col items-center justify-center gap-0.5 px-0.5 text-center text-amber-100/80">
                              <span className="text-[9px] font-semibold">
                                {String(shot.index).padStart(2, "0")}
                              </span>
                              <span className="text-[7px] leading-tight">待出图</span>
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-white/90">
                              分镜 {shot.index}
                              <span className="ml-2 font-normal text-white/45">
                                {shot.durationSec}s
                              </span>
                            </span>
                            {on ? (
                              <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-[10px] text-cyan-100/70">
                            {(() => {
                              const ang = getManhuaCameraAngle(shotAngleByIndex[shot.index]);
                              return ang
                                ? `${ang.nameZh} · ${shot.cameraZh}`
                                : shot.cameraZh;
                            })()}
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/70">
                            {shot.actionZh}
                          </div>
                          {on ? (
                            <div
                              className="mt-1 space-y-1"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <label className="block text-[9px] text-rose-100/55">
                                成片台词（写入本段一轮表演剧本；静帧不用字面）
                                <input
                                  type="text"
                                  value={shot.dialogueZh || ""}
                                  placeholder="台词 · 只重出本段，勿整集重烧"
                                  maxLength={80}
                                  onChange={(e) => {
                                    const line = e.target.value.slice(0, 80);
                                    const next: Record<number, string> = {};
                                    for (const s of shots) {
                                      const v =
                                        s.index === shot.index
                                          ? line
                                          : String(s.dialogueZh || "").trim();
                                      if (v) next[s.index] = v;
                                    }
                                    if (line.trim()) next[shot.index] = line.trim();
                                    onUpsertShotDialogues?.(next);
                                  }}
                                  className="mt-0.5 w-full rounded border border-rose-400/25 bg-black/35 px-1.5 py-1 text-[10px] text-rose-50 outline-none placeholder:text-white/25 focus:border-rose-300/45"
                                />
                              </label>
                              <div className="text-[9px] leading-snug text-white/35">
                                静帧锁脸服场 · 成片本段一轮吃多镜表演 · 改台词只重本段
                              </div>
                            </div>
                          ) : shot.dialogueZh || shot.emotionZh || shot.microExpressionZh ? (
                            <div className="mt-0.5 line-clamp-1 text-[10px] text-rose-100/65">
                              {shot.dialogueZh ? `「${shot.dialogueZh}」` : ""}
                              {shot.dialogueZh && (shot.emotionZh || shot.microExpressionZh)
                                ? " · "
                                : ""}
                              {shot.emotionZh || shot.microExpressionZh || ""}
                            </div>
                          ) : null}
                          {on ? (
                            <div
                              className="mt-1 flex flex-wrap gap-0.5"
                              data-manhua-shot-angles={shot.index}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              {MANHUA_CAMERA_ANGLE_ORDER.map((id) => {
                                const ang = getManhuaCameraAngle(id)!;
                                const selected = shotAngleByIndex[shot.index] === id;
                                return (
                                  <button
                                    key={id}
                                    type="button"
                                    title={`${ang.functionZh}｜${ang.whenToUseZh}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const next = {
                                        ...shotAngleByIndex,
                                        [shot.index]: id,
                                      };
                                      setShotAngleByIndex(next);
                                      onUpsertShotAngles?.(next);
                                      toast.message(`镜${shot.index} · ${ang.nameZh}`, {
                                        description: formatManhuaCameraAngleLine(ang).slice(0, 80),
                                      });
                                    }}
                                    className={`rounded px-1 py-0.5 text-[8px] ${
                                      selected
                                        ? "bg-cyan-500/30 text-cyan-50 ring-1 ring-cyan-400/40"
                                        : "bg-white/[0.04] text-white/40 hover:text-white/70"
                                    }`}
                                  >
                                    {ang.nameZh}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </button>
                      {shotKey?.id && onRerunKeyartShot ? (
                        <button
                          type="button"
                          data-manhua-action="rerun-shot"
                          disabled={Boolean(factoryBusy)}
                          onClick={() => {
                            if (refuseIfBlocked(keyartGateHint)) return;
                            onRerunKeyartShot(shotKey.id, shot.index);
                          }}
                          className="flex w-11 shrink-0 flex-col items-center justify-center gap-1 border-l border-white/10 text-[9px] text-amber-100/75 hover:bg-amber-500/10 disabled:opacity-35"
                          title={keyartGateHint || `只重出第 ${shot.index} 镜，保留其他镜头`}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          单镜
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-white/35">
                确认简报 → 静帧锁脸服场 → 审阅段成片提示词 → 本段一轮成片吃多镜表演；改台词只重出本段，勿整集重烧。
              </p>
              {clipPromptReviewOpen ? (
                <div
                  data-manhua-clip-prompt-review
                  className="mt-2 max-h-[42vh] space-y-2 overflow-y-auto rounded-lg border border-cyan-400/30 bg-cyan-500/[0.06] p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold text-cyan-50">
                      段成片提示词（可改 · 约 {segments.length} 次调用）
                    </div>
                    <button
                      type="button"
                      className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] text-white/55 hover:bg-white/5"
                      onClick={() => setClipPromptReviewOpen(false)}
                    >
                      收起
                    </button>
                  </div>
                  {segmentClipReviewList.map((row) => (
                    <div
                      key={`clip-prompt-seg-${row.segmentIndex}`}
                      className="rounded-md border border-white/10 bg-black/30 p-1.5"
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-1 text-[9px] text-white/55">
                        <span>
                          第 {String(row.segmentIndex).padStart(2, "0")} 段 · 约{" "}
                          {row.durationSec}s · 镜{" "}
                          {row.shotIndexes.map((n) => String(n).padStart(2, "0")).join("/")}
                        </span>
                        {row.clip?.id ? (
                          <button
                            type="button"
                            className="text-cyan-100/80 hover:underline"
                            onClick={() => focusBlockAndOpenCanvas(row.clip!.id)}
                          >
                            画布节点
                          </button>
                        ) : (
                          <span className="text-amber-100/70">尚未铺节点</span>
                        )}
                      </div>
                      <textarea
                        data-manhua-clip-prompt={row.segmentIndex}
                        disabled={!row.clip?.id || !onUpdateClipPrompt || factoryBusy}
                        value={row.clip?.prompt || ""}
                        onChange={(e) => {
                          if (row.clip?.id) onUpdateClipPrompt?.(row.clip.id, e.target.value);
                        }}
                        rows={5}
                        className="w-full resize-y rounded border border-white/10 bg-black/40 px-1.5 py-1 font-mono text-[10px] leading-snug text-white/80 disabled:opacity-40"
                        placeholder={
                          row.clip?.id
                            ? "段成片提示词"
                            : "点「审阅」时会先铺段节点；若仍空请对齐画布竖排"
                        }
                      />
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    <button
                      type="button"
                      data-manhua-action="generate-after-prompt-review"
                      disabled={Boolean(factoryBusy)}
                      onClick={() => {
                        setClipPromptReviewOpen(false);
                        runGenerateFragment();
                      }}
                      className="rounded-md border border-cyan-300/40 bg-cyan-500/20 px-2 py-1 text-[10px] font-semibold text-cyan-50 disabled:opacity-40"
                    >
                      确认并生成本段
                    </button>
                    {onGenerateMissingFragments ? (
                      <button
                        type="button"
                        disabled={Boolean(factoryBusy) || !missingFragmentIndexes.length}
                        onClick={() => {
                          if (refuseIfBlocked(clipGateHint)) return;
                          setClipPromptReviewOpen(false);
                          onGenerateMissingFragments(missingFragmentIndexes);
                        }}
                        className="rounded-md border border-white/15 bg-white/[0.06] px-2 py-1 text-[10px] font-semibold text-white/75 disabled:opacity-40"
                      >
                        确认并生成缺段
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : scriptTab === "board" ? (
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-0.5">
              <ManhuaIntegratedAssetBoardPanel
                board={integratedBoard}
                onCopyInjectSummary={(text) => {
                  void navigator.clipboard?.writeText(text).then(
                    () => toast.success("已复制一体参考摘要"),
                    () => toast.message(text.slice(0, 120)),
                  );
                }}
              />
              <p className="mt-2 text-[10px] leading-snug text-white/35">
                出图前一眼看齐角色、场景、道具；摘要可注入静帧提示词。
              </p>
            </div>
          ) : scriptTab === "edit" ? (
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-0.5">
              <ManhuaRoughEditTimeline
                clips={roughClips}
                activeShotIndex={activeShotNo}
                onSelectShot={(idx) => {
                  const i = shots.findIndex((s) => s.index === idx);
                  if (i >= 0) setShotIndex(i);
                }}
                onReorder={setRoughShotOrder}
              />
              <p className="mt-2 text-[10px] leading-snug text-white/35">
                粗剪排序；剪辑阶段可细剪、字幕、质检返工，并勾选进成片坞。
              </p>
            </div>
          ) : (
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] leading-snug text-white/45">
                  静帧画轨（
                  <span className="text-sky-200">蓝=镜头</span>
                  {" · "}
                  <span className="text-rose-200">红=人物</span>
                  ）· 有成片后默认收起，不占分镜列表空间
                </p>
                {pathBoardOpen ? (
                  <button
                    type="button"
                    onClick={() => setPathBoardOpen(false)}
                    className="inline-flex items-center gap-1 rounded-md border border-white/12 px-2 py-0.5 text-[10px] text-white/55 hover:bg-white/[0.06]"
                  >
                    <X className="h-3 w-3" />
                    收起画板
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPathBoardOpen(true)}
                    className="inline-flex items-center gap-1 rounded-md border border-sky-400/35 bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-50 hover:bg-sky-500/25"
                  >
                    <Focus className="h-3 w-3" />
                    {playableClipUrl ? "打开画板改轨" : "打开画板"}
                  </button>
                )}
              </div>
              {pathBoardOpen ? (
                onPathAnnotationChange ? (
                  <ManhuaPathCameraAnnotatePanel
                    compact
                    imageUrl={annotateStillUrl}
                    value={pathAnnotation}
                    recipeId={pathRecipeId}
                    actionRecipeId={actionRecipeId}
                    disabled={!canRun || factoryBusy}
                    onChange={onPathAnnotationChange}
                    onRecipeIdChange={onPathRecipeIdChange}
                    onActionRecipeIdChange={onActionRecipeIdChange}
                    translateMotionZh={translateMotionZh}
                  />
                ) : (
                  <p className="rounded-lg border border-white/10 bg-black/30 px-3 py-4 text-[11px] text-white/40">
                    运镜画板未接线
                  </p>
                )
              ) : (
                <p className="rounded-lg border border-dashed border-white/12 bg-white/[0.02] px-3 py-3 text-[11px] leading-relaxed text-white/40">
                  {playableClipUrl
                    ? "本镜已有成片，画板已收起。检查视频请看右栏；若要改运镜轨再点「打开画板改轨」。"
                    : "画板已收起，点上方打开后在静帧上划线。"}
                </p>
              )}
              {!annotateStillUrl ? (
                <p className="text-[10px] text-amber-100/70">
                  尚无本片段静帧。请先点「生成关键静帧」；单镜成片缺图时只补本镜。
                </p>
              ) : null}
            </div>
          )}
        </section>

        {/* 右：本集画布（阿硕式常驻）或单路视频结果 */}
        <aside
          data-manhua-column="preview"
          data-manhua-preview-kind={
            showCanvasDock
              ? "canvas"
              : finalVideoUrl || previewIsVideo
                ? "video"
                : previewUrl
                  ? "image"
                  : "empty"
          }
          data-manhua-preview-url={finalVideoUrl || previewUrl || ""}
          className={
            immersive
              ? "flex min-h-0 flex-col p-2 md:p-2.5"
              : showCanvasDock
                ? "flex min-h-0 w-[min(56vw,640px)] shrink-0 flex-col p-2.5"
                : "flex min-h-0 w-[440px] shrink-0 flex-col p-2.5 md:p-3"
          }
        >
          <div className="mb-1.5 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-white/90">
              {showCanvasDock ? "本集画布" : previewIsVideo || finalVideoUrl ? "视频结果" : "预览"}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {dockCanvas ? (
                showCanvasDock ? (
                  <button
                    type="button"
                    data-manhua-action="close-canvas-dock"
                    onClick={closeCanvasDock}
                    className="inline-flex items-center gap-1 rounded-md border border-white/12 px-2 py-0.5 text-[10px] text-white/55 hover:bg-white/[0.06]"
                    title="收起画布，腾出空间检查成片"
                  >
                    <X className="h-3 w-3" />
                    收起画布
                  </button>
                ) : (
                  <button
                    type="button"
                    data-manhua-action="open-canvas-dock"
                    onClick={openCanvasDock}
                    className="inline-flex items-center gap-1 rounded-md border border-cyan-400/35 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-50 hover:bg-cyan-500/25"
                    title="打开本集画布（多镜节点）"
                  >
                    <LayoutGrid className="h-3 w-3" />
                    打开画布
                  </button>
                )
              ) : null}
              {showCanvasDock ? previewCanvasToolbar : null}
              {factoryBusy ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold text-amber-50">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  生成／质检中
                </span>
              ) : clipQuality?.status === "failed" && clipQuality.userAcceptedDespiteQc ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/45 bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold text-amber-50">
                  <AlertTriangle className="h-3 w-3" />
                  已采用（质检未过）
                </span>
              ) : clipQuality?.status === "failed" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/45 bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold text-amber-50">
                  <AlertTriangle className="h-3 w-3" />
                  质检提醒
                </span>
              ) : finalVideoUrl ? (
                <span className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2 py-0.5 text-[9px] font-semibold text-cyan-100">
                  长片已合成
                </span>
              ) : previewIsVideo && clipQuality?.status === "passed" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/12 px-2 py-0.5 text-[9px] font-medium text-emerald-100/85">
                  <CheckCircle2 className="h-3 w-3" />
                  质检通过
                </span>
              ) : previewIsVideo ? (
                <span className="rounded-full border border-amber-400/35 bg-amber-500/12 px-2 py-0.5 text-[9px] font-medium text-amber-50">
                  成片可播
                </span>
              ) : previewUrl ? (
                <span className="rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[9px] text-white/50">
                  静帧
                </span>
              ) : (
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] text-white/35">
                  {dockCanvas ? "可调节点" : "待生成"}
                </span>
              )}
            </div>
          </div>
          {dockCanvas ? (
            <div
              id="freeform-canvas-zone"
              className={
                showCanvasDock
                  ? `relative min-h-0 w-full flex-1 overflow-hidden rounded-lg border bg-[#06080f] ${
                      factoryBusy ? "border-amber-400/35" : "border-white/12"
                    }`
                  : "hidden"
              }
              aria-hidden={!showCanvasDock}
            >
              {previewCanvas}
            </div>
          ) : null}
          {!showCanvasDock ? (
            <div
              data-manhua-shot-pair-preview
              className={`flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-lg border bg-black ${
                finalVideoUrl || previewIsVideo
                  ? "border-cyan-400/45"
                  : factoryBusy
                    ? "border-amber-400/35"
                    : "border-white/12"
              }`}
            >
              {annotateStillUrl && (playableClipUrl || finalVideoUrl) ? (
                <div className="flex max-h-[28%] shrink-0 items-center gap-2 border-b border-white/10 bg-black/80 px-2 py-1.5">
                  <img
                    src={annotateStillUrl}
                    alt=""
                    className="h-16 w-12 shrink-0 rounded object-cover object-top"
                  />
                  <div className="min-w-0 text-[10px] text-white/55">
                    <div className="font-semibold text-white/75">
                      镜 {String(activeShotNo).padStart(2, "0")} · 静帧
                    </div>
                    <div className="truncate text-white/40">成片在下方，一镜一图一片</div>
                  </div>
                </div>
              ) : null}
              <div className="flex min-h-0 flex-1 items-center justify-center">
                {finalVideoUrl ? (
                  <video src={finalVideoUrl} controls className="h-full max-h-full w-full object-contain" />
                ) : previewUrl ? (
                  previewIsVideo ? (
                    <video src={previewUrl} controls className="h-full max-h-full w-full object-contain" />
                  ) : (
                    <img src={previewUrl} alt="" className="h-full max-h-full w-full object-contain" />
                  )
                ) : (
                  <div className="px-4 text-center text-[11px] leading-relaxed text-white/40">
                    {factoryBusy
                      ? "正在生成…"
                      : dockCanvas
                        ? "点「打开画布」调节点，或先生成片段后在此检查成片"
                        : "生成关键静帧后，静帧 / 成片在此预览"}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          <div
            data-manhua-clip-quality={clipQuality?.status || "idle"}
            className={`mt-2 shrink-0 rounded-lg border px-2.5 py-2 ${
              clipQuality?.status === "passed"
                ? "border-emerald-400/25 bg-emerald-500/[0.07]"
                : clipQuality?.status === "failed"
                  ? "border-amber-400/30 bg-amber-500/[0.08]"
                  : "border-white/10 bg-white/[0.025]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-white/75">
                <ShieldCheck className="h-3.5 w-3.5 text-cyan-200/80" />
                智能质检
              </div>
              <span className="text-[9px] text-white/35">
                {clipQuality
                  ? `第 ${clipQuality.attempts} 次 · ${
                      clipQuality.status === "passed"
                        ? "可进入成片坞"
                        : clipQuality.userAcceptedDespiteQc
                          ? "已采用（质检未过）"
                          : "提醒·默认不进坞"
                    }`
                  : factoryBusy
                    ? "生成后自动检查"
                    : "等待成片"}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1">
              {CLIP_QUALITY_ROWS.map(([key, label]) => {
                const passed = clipQuality?.checks[key] === true;
                const failed = clipQuality?.status === "failed" && !passed;
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-1 rounded px-1.5 py-1 text-[9px] ${
                      passed
                        ? "bg-emerald-500/12 text-emerald-100"
                        : failed
                          ? "bg-amber-500/12 text-amber-50"
                          : "bg-white/[0.035] text-white/35"
                    }`}
                  >
                    {passed ? (
                      <CheckCircle2 className="h-2.5 w-2.5" />
                    ) : failed ? (
                      <AlertTriangle className="h-2.5 w-2.5" />
                    ) : (
                      <span className="h-2.5 w-2.5 rounded-full border border-white/20" />
                    )}
                    {label}
                  </div>
                );
              })}
            </div>
            {clipQuality?.status === "failed" ? (
              <div className="mt-1.5 space-y-1.5">
                <p className="line-clamp-3 text-[9px] leading-relaxed text-amber-50/85">
                  {clipQuality.summary}
                  {/文字|设定卡|姓名条|字幕|重出静帧/.test(clipQuality.summary || "")
                    ? " → 建议重出静帧后再采用。"
                    : " → 成片可预览；要不要进成片坞由你决定。"}
                </p>
                {clip?.id && onAcceptClipDespiteQc && !clipQuality.userAcceptedDespiteQc ? (
                  <button
                    type="button"
                    data-manhua-action="accept-clip-despite-qc"
                    onClick={() => onAcceptClipDespiteQc(clip.id)}
                    className="rounded-md border border-amber-400/45 bg-amber-500/20 px-2.5 py-1 text-[10px] font-semibold text-amber-50 hover:bg-amber-500/30"
                  >
                    仍采用此片
                  </button>
                ) : clipQuality.userAcceptedDespiteQc ? (
                  <p className="text-[9px] text-amber-100/70">已采用：可进成片坞勾选合成</p>
                ) : null}
              </div>
            ) : null}
          </div>
          {((previewUrl && !previewIsVideo) ||
            (clipQuality?.status === "failed" &&
              /文字|设定卡|姓名条|字幕|重出静帧/.test(clipQuality.summary || ""))) &&
          onRerunKeyartsFromReverse ? (
            <p className="mt-1.5 shrink-0 text-[10px] leading-snug text-white/40">
              静帧不对（穿错时代/没进场景/带字）→ 顶栏点
              <button
                type="button"
                disabled={Boolean(factoryBusy)}
                onClick={() => {
                  if (refuseIfBlocked(keyartGateHint)) return;
                  onRerunKeyartsFromReverse();
                }}
                className="mx-0.5 font-semibold text-amber-100/90 underline underline-offset-2 disabled:opacity-45"
              >
                重出静帧
              </button>
              （从反推重跑，覆盖旧图）。「续跑」不会重做已出图。
            </p>
          ) : null}
          <div className="mt-1.5 flex shrink-0 flex-wrap gap-1.5">
            {finalVideoUrl ? (
              <button
                type="button"
                className="text-[10px] text-cyan-100/75 underline underline-offset-2 hover:text-cyan-50"
                onClick={() =>
                  document.querySelector("#manhua-clip-dock-zone")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                打开成片坞
              </button>
            ) : null}
            {activeKeyart?.id ? (
              <button
                type="button"
                onClick={() => focusBlockAndOpenCanvas(activeKeyart.id)}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-0.5 text-[10px] text-white/65 hover:bg-white/5"
              >
                <Focus className="h-3 w-3" /> 静帧节点
              </button>
            ) : null}
            {clip?.id ? (
              <button
                type="button"
                onClick={() => focusBlockAndOpenCanvas(clip.id)}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-0.5 text-[10px] text-white/65 hover:bg-white/5"
              >
                <Focus className="h-3 w-3" /> 成片节点
              </button>
            ) : null}
          </div>
        </aside>
      </div>

      <div className="shrink-0 border-t border-white/8 px-2.5 pt-1.5 md:px-3">
        <p className="mb-1 text-[9px] text-white/40">
          粗剪按镜排序 · 约 {segments.length} 段成片（{segments.length} 次调用）· 段时长合计约{" "}
          {Math.round(segments.reduce((n, s) => n + s.durationSec, 0))}s
        </p>
        <ManhuaRoughEditTimeline
          clips={roughClips}
          activeShotIndex={activeShotNo}
          onSelectShot={(idx) => {
            const i = shots.findIndex((s) => s.index === idx);
            if (i >= 0) setShotIndex(i);
          }}
          onReorder={setRoughShotOrder}
        />
      </div>

      {/* 底胶片：片段条为主（对标阿硕），集切换为次 */}
      <div
        data-manhua-filmstrip
        data-manhua-keyart-ready={episodeKeyarts.filter((b) => mediaUrl(b)).length}
        data-manhua-shot-count={Math.max(episodeKeyarts.length, shots.length, 1)}
        className="shrink-0 border-t border-white/10 bg-[#080b12] px-2.5 py-2 md:px-3"
      >
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="text-[11px] font-semibold text-white/75">
              片段
              {missingFragmentIndexes.length ? (
                <span className="ml-1.5 text-[9px] font-normal text-amber-100/70">
                  缺 {missingFragmentIndexes.length} 段
                </span>
              ) : (
                <span className="ml-1.5 text-[9px] font-normal text-emerald-100/60">齐</span>
              )}
              {selectedSorted.length ? (
                <span className="ml-1.5 text-[9px] font-normal text-cyan-100/70">
                  已选 {selectedSorted.length}
                </span>
              ) : null}
            </div>
            {onGenerateMissingFragments ? (
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  data-manhua-action="select-missing-fragments"
                  disabled={!missingFragmentIndexes.length}
                  onClick={() =>
                    setSelectedShotIndexes(
                      segments
                        .filter((seg) => missingFragmentIndexes.includes(seg.index))
                        .flatMap((seg) => seg.shots.map((s) => s.index)),
                    )
                  }
                  className="rounded border border-white/12 px-1.5 py-0.5 text-[9px] text-white/55 hover:bg-white/[0.06] disabled:opacity-35"
                >
                  勾选缺段
                </button>
                <button
                  type="button"
                  data-manhua-action="clear-fragment-selection"
                  disabled={!selectedSorted.length}
                  onClick={() => setSelectedShotIndexes([])}
                  className="rounded border border-white/12 px-1.5 py-0.5 text-[9px] text-white/55 hover:bg-white/[0.06] disabled:opacity-35"
                >
                  清空勾选
                </button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] text-white/35">
              已出静帧 {episodeKeyarts.filter((b) => mediaUrl(b)).length}/
              {Math.max(episodeKeyarts.length, shots.length, 1)}
              {episodeKeyarts.filter((b) => b.status === "error" && !mediaUrl(b)).length
                ? ` · 失败 ${episodeKeyarts.filter((b) => b.status === "error" && !mediaUrl(b)).length}`
                : ""}
            </span>
            <div className="flex gap-1 overflow-x-auto">
              {episodeIndexes.map((ep) => {
                const bound = bibleBoundEpisodes.includes(ep);
                const on = ep === focusEpisode;
                return (
                  <button
                    key={`ep-chip-${ep}`}
                    type="button"
                    onClick={() => onFocusEpisode(ep)}
                    className={`rounded-md border px-1.5 py-0.5 text-[9px] ${
                      on
                        ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-50"
                        : "border-white/10 text-white/40 hover:text-white/65"
                    }`}
                    title={bound ? "设定已绑定" : undefined}
                  >
                    第{ep}集{bound ? "·" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {filmstripShots.map((shot, i) => {
              // 严格按镜号；禁止用列表下标顶替（缺镜时会把下一镜图错绑到本格）
              const shotKey = episodeKeyarts.find(
                (b) => resolveKeyartShotIndex(b.id, b.prompt) === shot.index,
              );
              const shotClip =
                episodeClips.find(
                  (b) =>
                    resolveClipSegmentIndex(b.id, b.prompt) ===
                    resolveSegmentIndexFromShotIndex(shot.index),
                ) ||
                (resolveSegmentIndexFromShotIndex(shot.index) === 1 ? legacyClip : undefined);
              const thumb = mediaUrl(shotKey);
              const clipPassed =
                shotClip?.status === "done" &&
                shotClip.manhuaClipQuality?.status === "passed" &&
                Boolean(mediaUrl(shotClip));
              const clipAccepted =
                shotClip?.manhuaClipQuality?.status === "failed" &&
                shotClip.manhuaClipQuality.userAcceptedDespiteQc &&
                Boolean(mediaUrl(shotClip));
              const clipFailed =
                shotClip?.manhuaClipQuality?.status === "failed" && !clipAccepted;
              const stillOk = Boolean(thumb);
              const stillUnlocked = Boolean(
                thumb && shotKey && !isManhuaKeyartPixelLocked(shotKey),
              );
              const clipOk = Boolean(mediaUrl(shotClip));
              const statusLabel = clipPassed
                ? "片✓"
                : clipAccepted
                  ? "已采用"
                  : clipFailed
                    ? "质检"
                    : stillUnlocked
                      ? "未锁"
                      : stillOk
                        ? "图✓"
                        : "待出";
              const pairLabel = `${stillUnlocked ? "未锁" : stillOk ? "图✓" : "图—"} ${clipOk ? "片✓" : "片—"}`;
              const on = i === Math.min(shotIndex, Math.max(shots.length, 1) - 1);
              const dur = shot.durationSec || 5;
              const needsRetry = !clipPassed;
              const checked = selectedShotIndexes.includes(shot.index);
              return (
                <div
                  key={`shot-${shot.index}`}
                  data-manhua-fragment-checked={checked ? "true" : "false"}
                  className={`relative w-[100px] shrink-0 overflow-hidden rounded-md border text-left ${
                    checked
                      ? "border-cyan-300/70 ring-1 ring-cyan-400/45"
                      : on
                        ? "border-white/70 ring-1 ring-white/40"
                        : clipPassed
                          ? "border-emerald-400/35"
                          : clipAccepted
                            ? "border-amber-400/40"
                          : clipFailed
                            ? "border-amber-400/35"
                            : "border-white/12"
                  }`}
                >
                  <label
                    className="absolute right-1 top-1 z-10 flex h-4 w-4 cursor-pointer items-center justify-center rounded border border-white/30 bg-black/65"
                    title="勾选后可批量生成所选"
                  >
                    <input
                      type="checkbox"
                      data-manhua-fragment-check={shot.index}
                      checked={checked}
                      onChange={() => toggleShotSelected(shot.index)}
                      className="h-3 w-3 accent-cyan-400"
                    />
                  </label>
                  <button
                    type="button"
                    data-manhua-filmstrip-shot={shot.index}
                    data-manhua-active={on ? "true" : "false"}
                    data-manhua-keyart-url={thumb || ""}
                    data-manhua-fragment-status={
                      clipPassed
                        ? "clip"
                        : clipFailed
                          ? "qc-failed"
                          : stillUnlocked
                            ? "keyart-unlocked"
                            : thumb
                              ? "keyart"
                              : "idle"
                    }
                    onClick={() => setShotIndex(i)}
                    className="block w-full text-left"
                    title={
                      stillUnlocked
                        ? "有图但未带资产垫图锁，不能直接出成片；请重出该镜静帧"
                        : undefined
                    }
                  >
                    <div
                      className={`relative aspect-video ${
                        thumb ? "bg-black/70" : "border border-dashed border-amber-400/30 bg-amber-500/10"
                      }`}
                    >
                      {thumb ? (
                        <>
                          <img src={thumb} alt="" className="h-full w-full object-cover" />
                          {stillUnlocked ? (
                            <span className="absolute inset-x-0 bottom-0 bg-red-900/75 px-0.5 py-px text-center text-[8px] font-semibold text-red-50">
                              未锁
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-0.5 text-amber-100/85">
                          <span className="text-[11px] font-semibold">
                            {String(shot.index).padStart(2, "0")}
                          </span>
                          <span className="text-[8px]">待出图</span>
                        </div>
                      )}
                      <span
                        className={`absolute left-1 top-1 rounded px-1 py-0.5 text-[8px] font-semibold ${
                          clipPassed
                            ? "bg-emerald-500/90 text-white"
                            : clipFailed
                              ? "bg-rose-500/90 text-white"
                              : thumb
                                ? "bg-amber-500/85 text-black"
                                : "bg-amber-500/80 text-black"
                        }`}
                      >
                        {statusLabel === "待出" ? "待出图" : statusLabel}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-1 py-0.5 text-[9px] text-white/65">
                      <span>片段 {String(shot.index).padStart(2, "0")}</span>
                      <span className="text-white/40">{dur.toFixed(1)}s</span>
                    </div>
                    <div className="border-t border-white/8 px-1 py-0.5 text-[8px] text-white/45">
                      {pairLabel}
                    </div>
                  </button>
                  {needsRetry && onGenerateFragment ? (
                    <button
                      type="button"
                      data-manhua-action="retry-fragment"
                      data-manhua-retry-shot={shot.index}
                      disabled={Boolean(factoryBusy)}
                      onClick={() => {
                        if (refuseIfBlocked(clipGateHint)) return;
                        setActivePhase("storyboard");
                        setShotIndex(i);
                        onGenerateFragment({
                          shotIndex: resolveSegmentIndexFromShotIndex(shot.index),
                          keyartId: shotKey?.id,
                          clipId: shotClip?.id,
                        });
                      }}
                      className="w-full border-t border-white/10 bg-white/[0.04] py-0.5 text-[8px] font-semibold text-cyan-100/80 hover:bg-cyan-500/15 disabled:opacity-35"
                      title={clipGateHint || "重跑本段：缺静帧先补段内镜再出一条成片"}
                    >
                      生成本段成片
                    </button>
                  ) : null}
                </div>
              );
            })}
        </div>
        {/* 集缩略（窄条，不抢片段胶片） */}
        <div className="mt-2 hidden gap-1.5 overflow-x-auto border-t border-white/5 pt-2 sm:flex">
          {episodeIndexes.map((ep) => {
            const epKeys = keyartsForEpisode(blocks, ep);
            const epClips = blocks.filter(
              (b) => b.id.startsWith("clip-") && (getBlockEpisodeIndex(b) ?? 1) === ep,
            );
            const epClipReady = epClips.find(
              (b) =>
                b.status === "done" &&
                b.manhuaClipQuality?.status === "passed" &&
                Boolean(mediaUrl(b)),
            );
            const clipReady = Boolean(epClipReady);
            const clipFailed = epClips.some((b) => b.manhuaClipQuality?.status === "failed");
            const thumb =
              (epClipReady ? mediaUrl(epClipReady) : undefined) || epKeys.map(mediaUrl).find(Boolean);
            const stillReady = epKeys.some((b) => Boolean(mediaUrl(b)));
            const bound = bibleBoundEpisodes.includes(ep);
            const on = ep === focusEpisode;
            return (
              <button
                key={ep}
                type="button"
                onClick={() => {
                  onFocusEpisode(ep);
                  setShotIndex(0);
                }}
                className={`w-[96px] shrink-0 overflow-hidden rounded-xl border text-left transition ${
                  on
                    ? "border-cyan-400/55 bg-cyan-500/15 shadow-[0_0_16px_rgba(34,211,238,0.12)]"
                    : clipReady
                      ? "border-emerald-400/30 bg-emerald-500/8 hover:border-emerald-400/45"
                      : "border-white/10 bg-black/35 hover:border-white/25"
                }`}
              >
                <div className="relative aspect-[9/12] bg-black/60">
                  {thumb ? (
                    <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-white/30">
                      待生成
                    </div>
                  )}
                  <span
                    className={`absolute right-1 top-1 rounded px-1 py-0.5 text-[9px] font-semibold ${
                      clipReady
                        ? "bg-emerald-500/90 text-white"
                        : clipFailed
                          ? "bg-rose-500/90 text-white"
                        : stillReady
                          ? "bg-amber-500/85 text-black"
                          : "bg-black/65 text-white/60"
                    }`}
                  >
                    {clipReady ? "通过" : clipFailed ? "质检失败" : stillReady ? "静帧" : "待跑"}
                  </span>
                  {bound ? (
                    <span
                      className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                      title="专案设定已绑定本集"
                    />
                  ) : null}
                </div>
                <div className="px-1.5 py-1 text-[10px] font-semibold text-white/80">
                  第{ep}集
                  {bound ? <span className="ml-1 font-normal text-emerald-200/70">绑</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
