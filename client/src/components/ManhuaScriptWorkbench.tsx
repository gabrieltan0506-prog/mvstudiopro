/**
 * 剧本工作台：左=本集资产 · 中=一集剧本+按段静帧 · 右=预览 · 底=集/段时间线
 * 一集：5–6 段 × 每段 3–4 关键静帧；每段一条成片（Seedance ≤15s，按时长合计钳制）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Focus,
  Download,
  LayoutGrid,
  Loader2,
  Play,
  RefreshCw,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { VIDEO_MODEL_OPTIONS, type CanvasBlock } from "@/lib/canvasTypes";
import {
  collectManhuaCharacterSheetUrlById,
  collectManhuaEpisodeSegmentPromptsForVoiceGate,
  collectManhuaPropImageUrlById,
  getBlockEpisodeIndex,
  MANHUA_FACTORY_STAGE_LABEL_ZH,
  queuedManhuaKeyartBlocks,
  stageKeyFromBlockId,
} from "@/lib/canvasDramaStudio";
import { manhuaClipQualityAllowsAssemble } from "@shared/manhuaClipQuality";
import {
  buildManhuaAssetsGapItems,
  buildManhuaAssetsGapZh,
  type ManhuaAssetsGapAnchor,
} from "@/lib/manhuaPhaseGapText";
import { tryLocalMediaDisplayForBlock } from "@/lib/manhuaLocalMediaStore";
import {
  getManhuaCharacterById,
  getManhuaCharacterDisplayName,
  getManhuaCharacterPreviewUrl,
  MANHUA_ART_STYLE_PRESETS,
  getManhuaArtStylePreset,
  isManhua3dArtStyle,
  normalizeManhuaArtStyleId,
  type ManhuaArtStyleId,
} from "@shared/manhuaCharacterAssetLibrary";
import { getAncientArchetypeById } from "@shared/manhuaAncientArchetypeLibrary";
import { getManhuaSceneTemplate } from "@shared/manhuaSceneAssetLibrary";
import {
  getManhuaDemoAsset,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssetsForSceneTemplate,
} from "@shared/manhuaScenePropDemoCatalog";
import {
  evaluateManhuaAssetImageGate,
  MANHUA_PROP_SHEET_MAX,
  shouldSpawnManhuaPropPlate,
} from "@shared/manhuaAssetImageGate";
import {
  resolveEpisodeMainScene,
  type ManhuaWriterAssetAnchor,
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
import { customAssetRefClaimsAnchor } from "@shared/manhuaAssetScriptSync";
import {
  buildManhuaAtReferenceIndex,
  resolveManhuaAtReferences,
} from "@shared/manhuaAtReference";
import {
  MANHUA_ASSET_REGEN_NOTE_MAX,
  manhuaAssetRegenPriceLabelZh,
  normalizeManhuaAssetRegenNoteZh,
  type ManhuaAssetRegenMode,
} from "@shared/manhuaAssetRegenRequest";
import type { ManhuaDeliveryPackage } from "@shared/manhuaDeliveryPackage";
import { syncDeliveryPackageSubtitleEnabled } from "@shared/manhuaDeliveryPackage";
import type { ManhuaCineVocabLocale } from "@shared/manhuaCineVocabBank";
import type { ManhuaRetakeVariable } from "@shared/manhuaDirectingWorkflow";
import type { ManhuaAssetStandardizeQuality } from "@shared/manhuaAssetStandardize";
import { MANHUA_REF_DUTIES } from "@shared/manhuaDirectingWorkflow";
import {
  areManhuaKeyartsPixelLocked,
  isBindableAssetPath,
  isManhuaKeyartPixelLocked,
  buildManhuaAssetLockRegistry,
} from "@shared/manhuaAssetLockRegistry";
import {
  ensureDefaultLookSetsForCharacters,
  getManhuaSegmentLookBinding,
  listManhuaLookSetsForCharacter,
  MANHUA_LOOK_SETS_PER_CHARACTER_MAX,
  setManhuaSegmentLookBinding,
  upsertManhuaCharacterLookSet,
  type ManhuaCharacterLookSet,
} from "@shared/manhuaCharacterLookSets";
import {
  collectManhuaCharacterTagsFromPrompt,
  evaluateManhuaCrossSegmentVoiceGate,
  resolveManhuaVoiceExtractWindow,
  type ManhuaCharacterVoiceLock,
} from "@shared/manhuaCharacterVoiceLock";
import { type ManhuaAudioReferenceLock } from "@shared/manhuaAudioReferenceLock";
import {
  groupShotsIntoSegments,
  MANHUA_FACTORY_DEFAULT_VIDEO_MODEL,
  MANHUA_KEYARTS_PER_SEGMENT_MIN,
  manhuaSegmentCountBounds,
  pinnedManhuaSegmentCount,
  parseWorkbenchShotsFromText,
  resolveClipLocalSegmentIndex,
  resolveClipSegmentIndex,
  resolveKeyartShotIndex,
  resolveSegmentIndexFromShotIndex,
  resolveWorkbenchShotAssetMount,
  workbenchShotTotalSec,
  type ManhuaWorkbenchSegment,
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
import {
  inferManhuaCastZhFromDialogue,
  parseManhuaEpisodeSegmentPlanFromMarkdown,
} from "@shared/manhuaEpisodeSegmentPlan";
import { applyShotDialoguesFromText } from "@shared/manhuaShotDialoguePersist";
import { summarizeManhuaVisualBriefForUi } from "@shared/manhuaScriptVisualBrief";
import { MANHUA_DRAFT_RETENTION_HINT_ZH } from "@shared/manhuaCloudDraft";
import ManhuaPathRecipePicker from "@/components/ManhuaPathRecipePicker";
import ManhuaPromptAssetChips from "@/components/ManhuaPromptAssetChips";
import ManhuaPromptMentionEditor from "@/components/ManhuaPromptMentionEditor";
import { downloadRemoteFile } from "@/lib/downloadRemoteFile";
import ManhuaRoughEditTimeline from "@/components/ManhuaRoughEditTimeline";
import ManhuaStylePackPanel from "@/components/ManhuaStylePackPanel";
import type { ManhuaStylePack } from "@shared/manhuaStylePack";
import ManhuaEditMultitrackPanel from "@/components/ManhuaEditMultitrackPanel";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { suggestManhuaClipCuts } from "@/lib/manhuaEditAutoCutApi";
import { parseFineCutByShot } from "@shared/manhuaEditFineCut";
import {
  isManhuaAssetCardExpanded,
  shouldShowManhuaAssetRoleChip,
} from "@/lib/manhuaAssetCardFold";
import {
  shouldShowToolbarAssetWallEntry,
  shouldShowToolbarCharacterLibraryEntry,
} from "@/lib/manhuaCharacterEntry";
import { manhuaToolbarActionCost } from "@/lib/manhuaToolbarGroups";
import type { ManhuaWorkflowPhase } from "@shared/manhuaWriterSession";

/** 阶段枚举收口在 shared：此处只取别名，不再另写一份 */
type WorkflowPhaseId = ManhuaWorkflowPhase;

/** 剧本设定表能出图的三类；与 planManhuaAssetImageSpawns 的 kind 对齐 */
type ManhuaCanonSheetKind = "charsheet" | "sceneplate" | "propsheet";

/** 定妆最吃紧排前，场景次之，道具垫后 */
const CANON_SHEET_KIND_ORDER: ManhuaCanonSheetKind[] = [
  "charsheet",
  "sceneplate",
  "propsheet",
];

const CANON_SHEET_SECTIONS: Array<{ kind: ManhuaCanonSheetKind; titleZh: string }> = [
  { kind: "charsheet", titleZh: "本集定妆" },
  { kind: "sceneplate", titleZh: "本集场景" },
  { kind: "propsheet", titleZh: "关键道具" },
];

type ManhuaPendingSheetAnchor = {
  anchorId: string;
  kind: ManhuaCanonSheetKind;
  nameZh: string;
  lookZh: string;
};

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
  /** Bible 已绑定造型的集号（1-based） */
  bibleBoundEpisodes?: number[];
  /** 蓝/红轨 + 叙事灯光状态行 */
  pathTrackLabelZh?: string;
  narrativeLightingLabelZh?: string;
  /** 运镜配方（路径/动作，预设文本，无手绘） */
  pathRecipeId?: string;
  actionRecipeId?: string;
  onPathRecipeIdChange?: (id: string) => void;
  onActionRecipeIdChange?: (id: string) => void;
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
  /**
   * 打开成片坞。坞渲染在 extras 视图（沉浸工作台下是 display:none），
   * 组件内部直接 scrollIntoView 对隐藏元素无效——必须由父级先切开视图再滚动。
   */
  onOpenClipDock?: () => void;
  /** 确认资产：先按序出角色图→场景图，再进分镜 */
  onConfirmAssetsAndPrepareImages?: () => void | Promise<void>;
  /** 清掉与现稿不符的旧设定图，并按剧本强制重出 */
  onRegenerateAssetsFromScript?: () => void | Promise<void>;
  /** 只清掉旧生成图、不触发重出（不扣费）；用户有现成资产时用这个 */
  onPurgeStaleAssets?: () => void;
  /** 剧本人物/场景与当前设定图不对齐时的提示 */
  assetScriptStaleHintZh?: string | null;
  /** 已锁 canon 与现剧本人物表换角漂移（重出会出旧角色）时的强警示 */
  canonWriterDriftHintZh?: string | null;
  /** 产品化风格包（色卡 + 光影构图 DNA） */
  stylePack?: ManhuaStylePack | null;
  onStylePackChange?: (pack: ManhuaStylePack | null) => void;
  /** 用户上传 / 基于库参考生成的参考图（人物 / 场景 / 服装 / 道具分栏） */
  customAssetRefs?: ManhuaCustomAssetRef[];
  /** 人物造型套（每人最多 3；服装为子类） */
  characterLookSets?: ManhuaCharacterLookSet[];
  onCharacterLookSetsChange?: (next: ManhuaCharacterLookSet[]) => void;
  /** 段手选造型绑定 */
  segmentLookBindings?: Record<string, Record<string, string>>;
  onSegmentLookBindingsChange?: (next: Record<string, Record<string, string>>) => void;
  /** 从有声成片抠出的角色声线参考 */
  characterVoiceLocks?: ManhuaCharacterVoiceLock[];
  /** 参考音频·全集参考（软·可选）：BGM/对白口音基准；不硬锁、不挡出片 */
  audioReferenceLock?: ManhuaAudioReferenceLock | null;
  onAudioReferenceLockChange?: (next: ManhuaAudioReferenceLock | null) => void;
  onExtractCharacterVoice?: (input: {
    clipId: string;
    characterTag: string;
    labelZh?: string;
    startSec?: number;
    durationSec?: number;
  }) => void | Promise<void>;
  onRemoveCharacterVoice?: (id: string) => void;
  onUploadCustomAssets?: (
    files: FileList | File[],
    role?: ManhuaCustomAssetRole,
  ) => void | Promise<void>;
  /**
   * 道具拼板拆分导入：一张拼板图（多件道具挤一张）→ 服务端切成单件图，
   * 各自进「我的道具」。仅在道具分栏出现「拼板拆分」按钮时用。
   */
  onImportPropSheetFile?: (file: File) => void | Promise<void>;
  onCustomAssetRoleChange?: (id: string, role: ManhuaCustomAssetRef["role"]) => void;
  onCustomAssetDutyChange?: (id: string, duty: ManhuaCustomAssetRefDuty | null) => void;
  /** 手动改名：改成与剧本表一致的名字即被认领（自动识别不追求 100%） */
  onCustomAssetLabelChange?: (id: string, labelZh: string) => void;
  /** AI 去字（3 分）：物理擦除画面文字 */
  onDetextCustomAsset?: (id: string) => void | Promise<void>;
  /** 免费裁字：按保留区比例裁剪后入库为新参考图 */
  onCropCustomAsset?: (id: string, crop: { x: number; y: number; w: number; h: number }) => void | Promise<void>;
  /** 明确认领稳定锚点；场景允许一图多选，替代用显示名猜主键。 */
  onCustomAssetClaimsChange?: (id: string, anchorIds: string[]) => void;
  onCustomAssetReviewAccept?: (id: string) => void;
  onStandardizeCustomAsset?: (id: string, quality: ManhuaAssetStandardizeQuality) => void | Promise<void>;
  assetStandardizeBusyId?: string | null;
  onRemoveCustomAsset?: (id: string) => void;
  /** 一键清空全部参考图（清了重导资产包用）；带确认 */
  onClearAllCustomAssets?: () => void;
  /** 删除本集设定图画廊里的一张（画布块）；可随时重出，不扣费 */
  onRemoveEpisodeSheet?: (blockId: string) => void;
  /** 段意图写回可拍表（工作台编辑） */
  onSegmentIntentChange?: (segmentIndex: number, intentZh: string) => void;
  /** 段出场角色写回可拍表（工作台编辑） */
  onSegmentCastChange?: (segmentIndex: number, castZh: string) => void;
  deliveryPackage?: ManhuaDeliveryPackage | null;
  onDeliveryPackageChange?: (next: ManhuaDeliveryPackage) => void;
  cineVocabLocale?: ManhuaCineVocabLocale;
  onCineVocabLocaleChange?: (locale: ManhuaCineVocabLocale) => void;
  onRetakeClip?: (clipBlockId: string, variable: ManhuaRetakeVariable) => void;
  /** 可拍表点名的角色在资产库找不到；非空则拦住出片并在左栏红条提示 */
  segmentCastMismatchHintZh?: string | null;
  /** 有人在场却没绑上任何角色定妆图；非空则拦住出片并在左栏提示去补图 */
  segmentNoFaceLockHintZh?: string | null;
  /** 基于当前库选条目生成新参考（库仅为种子） */
  onGenerateCustomAssetFromLibrary?: (opts: {
    role: ManhuaCustomAssetRole;
    seedLibraryId: string;
  }) => void | Promise<void>;
  /** 单补剧本表里某个还没图的角色/场景（左栏「待生成」卡） */
  onGenerateCanonAssetSheet?: (opts: {
    anchorId: string;
    nameZh: string;
  }) => void | Promise<void>;
  /** 补齐这一批缺图的资产（只出这几张、不清已出）；「补齐 N 张」按钮用 */
  onFillPendingSheets?: (anchorIds: string[]) => void | Promise<void>;
  /**
   * 重出这一批**已有图**的资产（按新编译提示词重来）；「重出本类 N 张」按钮用。
   * 画布节点重跑已接 compileManhuaRerun；工作台批量入口仍保留。
   */
  onRegenerateSheets?: (opts: {
    anchorIds: string[];
    /** 用户写的「哪里要改进」；接到这几张的提示词尾部 */
    noteZh: string;
    /** redraw=按描述重画；library=换成公有库里挑的那张（都另外扣积分） */
    mode: ManhuaAssetRegenMode;
    /** mode=library 时用户点选的库图 */
    libraryImageUrl?: string;
  }) => void | Promise<void>;
  /** 公有参考库候选（按类给弹框里的「从库里挑一张」用） */
  libraryPickerItems?: Array<{
    publicId: string;
    role: string;
    imageUrl: string;
    labelZh: string;
  }>;
  /** 打开弹框时按类拉库候选 */
  onRequestLibraryPicker?: (role: ManhuaCustomAssetRole) => void;
  /** 资产暂存区条数（清图/重出前存的，可恢复） */
  assetStashCount?: number;
  /** 从暂存区恢复被清掉的资产图 */
  onRestoreAssetStash?: () => void;
  /** 画布已出图但没进「我的角色/场景/道具」的设定卡，重新挂回 @ 号（不扣积分） */
  onAdoptEpisodeSheets?: () => void;
  /** 待认领张数：>0 说明有定妆图还没拿到 @ 槽位，静帧会锁不到这些脸 */
  unadoptedSheetCount?: number;
  /** 清理暂存区（清空暂存的旧设定图） */
  onClearAssetStash?: () => void;
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
  /**
   * 集级导演分镜板（阿硕对照）：上传整版 → 裁主画面 → 写入成片垫图。
   * 只接现成图，本入口不出图。
   */
  directorBoardMainUrl?: string | null;
  /** 本集段号(1 起) → 段级导演板 URL（段级为主、集级兜底；用于段选择接入状态） */
  directorBoardSegUrls?: Record<number, string> | null;
  /** segIndex 为空/0 = 本集共用；>0 = 只作用该段 */
  onIngestDirectorBoardFile?: (file: File, segIndex?: number | null) => void | Promise<void>;
  onClearDirectorBoard?: () => void;
  directorBoardBusy?: boolean;
  /** 复制导演板出图提示词（用户自行出图后再上传裁切） */
  onCopyDirectorBoardPrompt?: () => void | Promise<void>;
  /** 导入资产 ZIP（含 director_boards/） */
  onImportAssetZipFile?: (file: File) => void | Promise<void>;
  assetZipBusy?: boolean;
  /**
   * 审阅成片提示词主路径：铺段节点 + 竖排后，聚焦并高亮目标段节点到视口中央。
   * 有此回调时优先走它，避免「先 focus 再 layout」滚到空白区。
   */
  onReviewClipPromptsOnCanvas?: (opts?: { segmentIndex?: number }) => void;
  /** 写回段成片节点 prompt（审阅编辑） */
  onUpdateClipPrompt?: (clipId: string, prompt: string) => void;
  onResumeFromFailure?: () => void;
  /** 从编导反推强制重跑本集静帧（覆盖旧图；工作台主路径入口） */
  onRerunKeyartsFromReverse?: () => void;
  /** 只重跑当前分镜静帧，保留同集其他已完成镜头。 */
  onRerunKeyartShot?: (blockId: string, shotIndex: number) => void;
  /** 质检软拦：用户仍采用当前镜成片进入成片坞 */
  onAcceptClipDespiteQc?: (clipBlockId: string) => void;
  /** 建议切点后写入成片节点，供合成 ffmpeg 真裁切 */
  onApplyClipEditTrim?: (
    clipBlockId: string,
    trim: NonNullable<CanvasBlock["manhuaEditTrim"]>,
  ) => void;
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
  // 成图优先（含 local-media: / blob:）；缺成图时回退垫图/融合参考
  return (
    b.outputUrl ||
    b.outputUrls?.[0] ||
    b.refImageUrl ||
    b.editFusionUrls?.[0] ||
    undefined
  );
}

/**
 * 真实产出地址——**只认 outputUrl / outputUrls**，绝不回退垫图。
 *
 * 铺段时每个 clip 都会写 `refImageUrl` 当首帧垫图，所以 `mediaUrl()` 对一个还没出片的
 * 空壳段也返回非空。凡是拿它判「已出片 / 可播放 / 缺段 / 粗剪输入」的地方，都会把
 * 空壳段算成已完成：底栏显示段已齐、预览把静帧当视频播、粗剪把垫图送进自动切点。
 *
 * `mediaUrl()` 只保留给缩略图兜底（没出片时显示垫图是对的）。
 */
function clipOutputUrl(b?: CanvasBlock): string | undefined {
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
  bibleBoundEpisodes = [],
  pathTrackLabelZh,
  narrativeLightingLabelZh,
  pathRecipeId,
  actionRecipeId,
  onPathRecipeIdChange,
  onActionRecipeIdChange,
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
  onOpenClipDock,
  onConfirmAssetsAndPrepareImages,
  onRegenerateAssetsFromScript,
  onPurgeStaleAssets,
  assetScriptStaleHintZh = null,
  canonWriterDriftHintZh = null,
  stylePack = null,
  onStylePackChange,
  customAssetRefs = [],
  characterLookSets = [],
  onCharacterLookSetsChange,
  segmentLookBindings = {},
  onSegmentLookBindingsChange,
  characterVoiceLocks = [],
  audioReferenceLock = null,
  onAudioReferenceLockChange,
  onExtractCharacterVoice,
  onRemoveCharacterVoice,
  onUploadCustomAssets,
  onImportPropSheetFile,
  onCustomAssetRoleChange,
  onCustomAssetDutyChange,
  onCustomAssetLabelChange,
  onDetextCustomAsset,
  onCropCustomAsset,
  onCustomAssetClaimsChange,
  onCustomAssetReviewAccept,
  onStandardizeCustomAsset,
  assetStandardizeBusyId = null,
  onRemoveCustomAsset,
  onClearAllCustomAssets,
  onRemoveEpisodeSheet,
  onSegmentIntentChange,
  onSegmentCastChange,
  deliveryPackage = null,
  onDeliveryPackageChange,
  cineVocabLocale,
  onCineVocabLocaleChange,
  onRetakeClip,
  segmentCastMismatchHintZh = null,
  segmentNoFaceLockHintZh = null,
  onGenerateCustomAssetFromLibrary,
  onGenerateCanonAssetSheet,
  onFillPendingSheets,
  onRegenerateSheets,
  libraryPickerItems,
  onRequestLibraryPicker,
  assetStashCount = 0,
  onRestoreAssetStash,
  onAdoptEpisodeSheets,
  unadoptedSheetCount = 0,
  onClearAssetStash,
  shareAssetToLibrary = false,
  onShareAssetToLibraryChange,
  assetShareBilling,
  onSpawnAndRunClip,
  onGenerateFragment,
  onGenerateMissingFragments,
  onGenerateAllEpisodeKeyarts,
  onLayoutReadableChain,
  onEnsureSegmentClips,
  directorBoardMainUrl = null,
  directorBoardSegUrls = null,
  onIngestDirectorBoardFile,
  onClearDirectorBoard,
  directorBoardBusy = false,
  onCopyDirectorBoardPrompt,
  onImportAssetZipFile,
  assetZipBusy = false,
  onReviewClipPromptsOnCanvas,
  onUpdateClipPrompt,
  onResumeFromFailure,
  onRerunKeyartsFromReverse,
  onRerunKeyartShot,
  onAcceptClipDespiteQc,
  onApplyClipEditTrim,
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
  onUpsertShotAngles,
  onUpsertShotDialogues,
}: Props) {
  const dockCanvas = Boolean(previewCanvas);
  const continuity = shotContinuity || {
    keyartFromPrevStill: true,
    clipFromPrevTail: true,
  };
  const activeArtStyleId: ManhuaArtStyleId = normalizeManhuaArtStyleId(artStyleId);
  const [shotIndex, setShotIndex] = useState(0);
  const [clipPromptReviewOpen, setClipPromptReviewOpen] = useState(false);
  /** 免费裁字弹层：拖框选保留区，框外（含烧字边缘）裁掉 */
  const [cropTarget, setCropTarget] = useState<{ id: string; url: string; labelZh: string } | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const cropDragRef = useRef<{ startX: number; startY: number } | null>(null);
  /** 参考图批量勾选：图角勾选 → 底部一键删除；删除后自动清勾 */
  const [selectedAssetIds, setSelectedAssetIds] = useState<ReadonlySet<string>>(new Set());
  const toggleAssetSelected = (id: string) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  /**
   * 逐卡展开态：简洁模式下资产卡只留 图/名字/✕/⋯，其余点「⋯」才出。
   * 单卡 11–13 个控件 × 13 张全平铺，是用户说「太复杂跟繁琐」的直接来源。
   */
  const [expandedAssetIds, setExpandedAssetIds] = useState<ReadonlySet<string>>(new Set());
  const toggleAssetExpanded = (id: string) => {
    setExpandedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  /** 待生成虚线卡折条：默认收起（26 张铺满一屏太吵），点「展开补图」再出卡 */
  const [pendingOpenKinds, setPendingOpenKinds] = useState<ReadonlySet<string>>(new Set());
  const togglePendingOpen = (kind: string) => {
    setPendingOpenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };
  /** 简洁模式（默认开）：说明性灰色小字与低频控件收起；「显示说明」随时展开 */
  const [compactUi, setCompactUi] = useState(() => {
    try {
      return window.localStorage.getItem("manhua_compact_ui") !== "0";
    } catch {
      return true;
    }
  });
  const toggleCompactUi = () => {
    setCompactUi((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("manhua_compact_ui", next ? "1" : "0");
      } catch {
        /* 无痕模式没 localStorage 也不影响本次会话 */
      }
      return next;
    });
  };
  const [downloadBusy, setDownloadBusy] = useState(false);
  /** 默认药丸视图；按段记「谁被切到了原文编辑」 */
  const [rawPromptSegments, setRawPromptSegments] = useState<Set<number>>(
    () => new Set(),
  );
  /** 药丸缩略图：对照表只给 id，图得从已挂资产里配 */
  const chipThumbByAssetId = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of customAssetRefs) {
      const id = String(r?.id || "").trim();
      const url = String(r?.url || "").trim();
      if (id && url) out[id] = url;
    }
    return out;
  }, [customAssetRefs]);
  useEffect(() => {
    setClipPromptReviewOpen(false);
  }, [focusEpisode, topic, seriesTitle]);
  /** 中栏：分镜 | 运镜画板 | 粗剪 */
  const [scriptTab, setScriptTab] = useState<"shots" | "path" | "edit">("shots");
  /** 每镜机位密码（可点选覆盖推荐） */
  const [shotAngleByIndex, setShotAngleByIndex] = useState<Record<number, ManhuaCameraAngleId>>(
    {},
  );
  /** 粗剪顺序（镜号列表）；空则按分镜序 */
  const [roughShotOrder, setRoughShotOrder] = useState<number[]>([]);
  /** 细剪进出点 */
  const [fineCutByShot, setFineCutByShot] = useState<ManhuaFineCutByShot>({});
  /** 气口建议切点分析中 */
  const [suggestAutoCutsBusy, setSuggestAutoCutsBusy] = useState(false);
  /** 剪辑台字幕轨：开则生成轨数据，默认不烧字 */
  const [editSubtitleEnabled, setEditSubtitleEnabled] = useState(false);
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
  }, [bPersistKey]);
  useEffect(() => {
    saveManhuaWorkbenchBPersist(bPersistKey, {
      shotAngleByIndex,
      roughShotOrder,
      fineCutByShot,
      subtitleEnabled: editSubtitleEnabled,
    });
  }, [
    bPersistKey,
    shotAngleByIndex,
    roughShotOrder,
    fineCutByShot,
    editSubtitleEnabled,
  ]);
  /** 右栏本集画布：阿硕 C2 分镜有静帧时强制常开；其余阶段仍可随成片收合 */
  const [canvasDockOpen, setCanvasDockOpen] = useState(true);
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
  const episodeClips = useMemo(
    () =>
      blocks
        .filter((b) => b.id.startsWith("clip-") && (getBlockEpisodeIndex(b) ?? 1) === focusEpisode)
        .sort(
          (a, b) =>
            resolveClipLocalSegmentIndex(a.id, a.prompt, focusEpisode) -
              resolveClipLocalSegmentIndex(b.id, b.prompt, focusEpisode) ||
            a.id.localeCompare(b.id),
        ),
    [blocks, focusEpisode],
  );
  const legacyClip = blockByStage(blocks, focusEpisode, "clip");
  const story = blockByStage(blocks, focusEpisode, "story");

  const shots: ManhuaWorkbenchShot[] = useMemo(() => {
    const reverseText = reverse?.outputText || reverse?.prompt || "";
    const beatsText = beats?.outputText || beats?.prompt || "";
    const storyText = story?.outputText || story?.prompt || "";
    // 方案 C：五至六段可拍表优先编译为每段 3 静帧（起幅/戏核/落幅）
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(
      `${storyText}\n${beatsText}\n${reverseText}`,
    );
    const fromPlan = buildWorkbenchShotsFromSegmentPlan(plan);
    const segMin = manhuaSegmentCountBounds(
      episodeClips[0]?.videoModel || legacyClip?.videoModel || MANHUA_FACTORY_DEFAULT_VIDEO_MODEL,
    ).min;
    let list: ManhuaWorkbenchShot[];
    if (fromPlan.length >= segMin * MANHUA_KEYARTS_PER_SEGMENT_MIN) {
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
    episodeClips,
    legacyClip?.videoModel,
  ]);

  const episodeVideoModel =
    episodeClips[0]?.videoModel || legacyClip?.videoModel || MANHUA_FACTORY_DEFAULT_VIDEO_MODEL;
  // 静帧一律取「这一轮真正会被跑到」的节点：从 mini（18 张）改选 2.5（12 张）后，
  // 超出新段表的静帧只是停放，队列不会跑它们。分母若仍按画布节点数算，成片门禁会卡死在 12/18。
  const episodeKeyarts = useMemo(() => {
    const queued = new Set(
      queuedManhuaKeyartBlocks(blocks, focusEpisode, episodeVideoModel).map((b) => b.id),
    );
    return keyartsForEpisode(blocks, focusEpisode).filter((b) => queued.has(b.id));
  }, [blocks, focusEpisode, episodeVideoModel]);
  const keyart = episodeKeyarts[0];
  const episodeSegmentBounds = manhuaSegmentCountBounds(episodeVideoModel);
  const episodeVideoLabelZh =
    VIDEO_MODEL_OPTIONS.find((m) => m.id === episodeVideoModel)?.label || "成片";
  const segments = useMemo(
    () =>
      groupShotsIntoSegments(shots, {
        // 只有段表固定的引擎才钉段；2.0 / 2.0-fast 的段数随长档变，钉死会把 12 段压回 6 段，
        // 而工厂那边对它们不钉段，界面段数与实收段数会再次脱节
        videoModel: episodeVideoModel,
        segmentCount: pinnedManhuaSegmentCount(episodeVideoModel),
        padToDefaultEpisode: true,
      }),
    [shots, episodeVideoModel],
  );
  /** 导演板上传作用范围：0=本集共用；>0=只作用该段（段级为主、集级兜底） */
  const [boardSegChoice, setBoardSegChoice] = useState(0);
  const shootablePlan = useMemo(
    () =>
      parseManhuaEpisodeSegmentPlanFromMarkdown(
        [
          story?.outputText || story?.prompt || "",
          beats?.outputText || beats?.prompt || "",
          reverse?.outputText || reverse?.prompt || "",
        ].join("\n"),
      ),
    [
      story?.outputText,
      story?.prompt,
      beats?.outputText,
      beats?.prompt,
      reverse?.outputText,
      reverse?.prompt,
    ],
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
  // A（用户 2026-07-29）：静帧门禁按「一镜一张」的实际分镜节点数算，不用「段×3」估算硬顶。
  // 已铺出静帧节点后，目标 = 实际已铺节点数（旧稿 13 张不该被新 plan 段×3=18 判成缺 5 张）；
  // 尚未铺任何静帧节点时，才用分镜数（段×3）排队首次生成。
  const expectedStillCount =
    episodeKeyarts.length > 0 ? episodeKeyarts.length : shots.length;
  const stillsCountReady =
    expectedStillCount > 0
      ? episodeStillCount >= expectedStillCount
      : episodeStillCount > 0;
  /** Skill：资产须垫图改图锁定；仅有成图 URL 不算可烧成片 */
  const keyartsPixelLocked = areManhuaKeyartsPixelLocked(episodeKeyarts, {
    minCount: expectedStillCount > 0 ? expectedStillCount : 1,
  });
  const stillsReadyEnough = stillsCountReady && keyartsPixelLocked;

  const totalSec = workbenchShotTotalSec(shots, episodeVideoModel);


  const stillIndexSet = useMemo(() => {
    const s = new Set<number>();
    for (const b of episodeKeyarts) {
      if (mediaUrl(b)) s.add(resolveKeyartShotIndex(b.id, b.prompt));
    }
    return s;
  }, [episodeKeyarts]);

  const clipIndexSet = useMemo(() => {
    const s = new Set<number>();
    // 粗剪只能吃真出片的段；垫图进来会被自动切点当成画面
    for (const b of episodeClips) {
      if (clipOutputUrl(b)) s.add(resolveKeyartShotIndex(b.id, b.prompt));
    }
    if (legacyClip && clipOutputUrl(legacyClip)) s.add(1);
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
            resolveClipLocalSegmentIndex(b.id, b.prompt, focusEpisode) ===
            resolveSegmentIndexFromShotIndex(c.shotIndex),
        ) || (resolveSegmentIndexFromShotIndex(c.shotIndex) === 1 ? legacyClip : undefined);
      const shotKeyart =
        episodeKeyarts.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === c.shotIndex) ||
        (c.shotIndex === 1 ? keyart : undefined);
      return {
        shotIndex: c.shotIndex,
        clipBlockId: shotClip?.id,
        keyartBlockId: shotKeyart?.id,
        outputUrl: clipOutputUrl(shotClip),
        quality: shotClip?.manhuaClipQuality ?? null,
      };
    });
  }, [roughClips, episodeClips, episodeKeyarts, legacyClip, keyart]);

  const handleSuggestAutoCuts = useCallback(async () => {
    if (suggestAutoCutsBusy || factoryBusy) return;
    type CutGroup = {
      videoUrl: string;
      clipBlockId: string;
      directorPrompt: string;
      shots: Array<{ shotIndex: number; durationSec: number }>;
    };
    const groups = new Map<string, CutGroup>();
    for (const media of editShotMedia) {
      const url = String(media.outputUrl || "").trim();
      const clipBlockId = String(media.clipBlockId || "").trim();
      if (!/^https:\/\//i.test(url) || !clipBlockId) continue;
      const rough = roughClips.find((c) => c.shotIndex === media.shotIndex);
      if (!rough) continue;
      const clipBlock =
        episodeClips.find((b) => b.id === clipBlockId) ||
        (legacyClip?.id === clipBlockId ? legacyClip : undefined);
      const g = groups.get(clipBlockId) || {
        videoUrl: url,
        clipBlockId,
        directorPrompt: String(clipBlock?.prompt || ""),
        shots: [],
      };
      g.shots.push({ shotIndex: rough.shotIndex, durationSec: rough.durationSec });
      groups.set(clipBlockId, g);
    }
    if (!groups.size) {
      toast.message("请先生成有声段成片，再建议切点");
      return;
    }
    setSuggestAutoCutsBusy(true);
    toast.message("正在按气口与导戏秒轴分析切点…", {
      description: `${groups.size} 段成片`,
    });
    try {
      const merged: ManhuaFineCutByShot = { ...fineCutByShot };
      const labels: string[] = [];
      for (const g of Array.from(groups.values())) {
        const out = await suggestManhuaClipCuts({
          videoUrl: g.videoUrl,
          shots: g.shots,
          directorPrompt: g.directorPrompt,
        });
        const parsed = parseFineCutByShot(out.fineCutByShot);
        for (const [k, trim] of Object.entries(parsed)) {
          merged[Number(k)] = trim;
        }
        if (out.segmentLabelZh) labels.push(out.segmentLabelZh);
        onApplyClipEditTrim?.(g.clipBlockId, {
          inSec: out.segmentTrim.inSec,
          outSec: out.segmentTrim.outSec,
          shotPieces: out.shotPieces,
          updatedAt: Date.now(),
        });
      }
      setFineCutByShot(merged);
      toast.message("切点已写入并挂到成片", {
        description: labels[0] || `已更新 ${Object.keys(merged).length} 镜 · 合成将按此裁切`,
      });
    } catch (e) {
      toast.message(e instanceof Error ? e.message : "切点分析失败");
    } finally {
      setSuggestAutoCutsBusy(false);
    }
  }, [
    suggestAutoCutsBusy,
    factoryBusy,
    editShotMedia,
    roughClips,
    fineCutByShot,
    episodeClips,
    legacyClip,
    onApplyClipEditTrim,
  ]);

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
    episodeClips.find(
      (b) => resolveClipLocalSegmentIndex(b.id, b.prompt, focusEpisode) === activeSegNo,
    ) || (activeSegNo === 1 ? legacyClip : undefined);
  const clip = activeClip || legacyClip;
  const clipQuality = clip?.manhuaClipQuality;
  const clipVideoUrl = clipOutputUrl(clip);
  const approvedClipUrl =
    clipQuality?.status === "passed" && clipVideoUrl ? clipVideoUrl : undefined;
  // 有成片就播：质检未过/服务暂不可用时仍可看，避免「生成成功却像失败」
  const playableClipUrl = approvedClipUrl || clipVideoUrl;
  const anyKeyartUrl = episodeKeyarts.map(mediaUrl).find(Boolean);
  const previewUrl = playableClipUrl || mediaUrl(activeKeyart) || anyKeyartUrl;
  const previewIsVideo = Boolean(playableClipUrl);
  const annotateStillUrl = mediaUrl(activeKeyart) || anyKeyartUrl;

  /** 切镜 / 成片：分镜有静帧时画布常开（阿硕 C2）；否则未出片展开、已出片收起 */
  useEffect(() => {
    if (!dockCanvas) return;
    if (activePhase === "storyboard" && episodeStillCount > 0) {
      setCanvasDockOpen(true);
      return;
    }
    setCanvasDockOpen(!playableClipUrl);
  }, [dockCanvas, playableClipUrl, activeShotNo, activePhase, episodeStillCount]);

  const openCanvasDock = () => setCanvasDockOpen(true);
  const closeCanvasDock = () => {
    // 分镜有静帧时禁止收起——右栏就是主预览
    if (activePhase === "storyboard" && episodeStillCount > 0) return;
    setCanvasDockOpen(false);
  };
  // 阿硕 C2：首次进分镜且有静帧 → 自动铺段节点 + 写入垫图锁提示词
  const autoLaidClipLocksRef = useRef(false);
  useEffect(() => {
    if (activePhase !== "storyboard" || episodeStillCount <= 0) return;
    setCanvasDockOpen(true);
    if (autoLaidClipLocksRef.current) return;
    if (!onReviewClipPromptsOnCanvas) return;
    autoLaidClipLocksRef.current = true;
    onReviewClipPromptsOnCanvas({ segmentIndex: activeSegNo });
  }, [activePhase, episodeStillCount, activeSegNo, onReviewClipPromptsOnCanvas]);
  const focusBlockAndOpenCanvas = (blockId: string) => {
    if (!blockId) return;
    setCanvasDockOpen(true);
    onFocusBlock?.(blockId);
  };
  /** 胶片 / 分镜列表：切镜后立刻把对应静帧或段成片滚入画布并高亮 */
  const selectShotAndFocusCanvas = (shotListIndex: number) => {
    const i = Math.max(0, Math.min(shotListIndex, Math.max(shots.length, 1) - 1));
    setShotIndex(i);
    const shot = shots[i];
    if (!shot) {
      openCanvasDock();
      return;
    }
    const keyart = episodeKeyarts.find(
      (b) => resolveKeyartShotIndex(b.id, b.prompt) === shot.index,
    );
    const segNo = resolveSegmentIndexFromShotIndex(shot.index);
    const clipBlock =
      episodeClips.find(
        (b) => resolveClipLocalSegmentIndex(b.id, b.prompt, focusEpisode) === segNo,
      ) || null;
    focusBlockAndOpenCanvas(clipBlock?.id || keyart?.id || "");
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
  const missingFragmentIndexes = useMemo(() => {
    return segments
      .filter((seg) => {
        const segClip =
          episodeClips.find(
            (b) => resolveClipLocalSegmentIndex(b.id, b.prompt, focusEpisode) === seg.index,
          ) || (seg.index === 1 ? legacyClip : undefined);
        // 只认真实产出：垫图不算出片，否则铺完段就显示「段已齐」
        const playable = Boolean(clipOutputUrl(segClip));
        const failed = segClip?.manhuaClipQuality?.status === "failed";
        return !playable || failed;
      })
      .map((seg) => seg.index);
  }, [segments, episodeClips, legacyClip, focusEpisode]);
  const segmentClipReviewList = useMemo(() => {
    return segments.map((seg) => {
      const segClip =
        episodeClips.find(
          (b) => resolveClipLocalSegmentIndex(b.id, b.prompt, focusEpisode) === seg.index,
        ) || (seg.index === 1 ? legacyClip : undefined);
      return {
        segmentIndex: seg.index,
        durationSec: seg.durationSec,
        clip: segClip,
        shotIndexes: seg.shots.map((s) => s.index),
      };
    });
  }, [segments, episodeClips, legacyClip, focusEpisode]);
  const selectedSorted = useMemo(
    () => [...selectedShotIndexes].sort((a, b) => a - b),
    [selectedShotIndexes],
  );
  /**
   * 底胶片按「段」列：一格 = 一次成片调用。镜留在中栏段内列表。
   * 之前按镜列 13 格却标「片段 01–13」，且每格都挂出片按钮——同段三格点哪个
   * 都入队同一段，13 个按钮实际只有 5 个动作。
   */
  const filmstripSegments = useMemo(() => {
    const list: ManhuaWorkbenchSegment[] = segments.length
      ? segments
      : [{ index: 1, durationSec: 15, shots: [] }];
    return list.map((seg) => {
      const segClip =
        episodeClips.find(
          (b) => resolveClipLocalSegmentIndex(b.id, b.prompt, focusEpisode) === seg.index,
        ) || (seg.index === 1 ? legacyClip : undefined);
      const keyarts = seg.shots.map((s) =>
        episodeKeyarts.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === s.index),
      );
      const withImage = keyarts.filter((b) => Boolean(mediaUrl(b)));
      const beat = shootablePlan.segments.find((s) => s.index === seg.index);
      return {
        index: seg.index,
        durationSec: seg.durationSec,
        shotIndexes: seg.shots.map((s) => s.index),
        shotCount: seg.shots.length,
        stillReady: withImage.length,
        // 有图但没走垫图改图 → 不能出成片，需重出该镜静帧
        unlockedCount: withImage.filter((b) => b && !isManhuaKeyartPixelLocked(b)).length,
        clip: segClip,
        // 段封面用段内首张已出静帧；缺图留占位，不挂假图
        thumb: withImage.length ? mediaUrl(withImage[0]) : "",
        firstKeyartId: withImage[0]?.id || keyarts.find(Boolean)?.id || "",
        sceneZh: String(beat?.sceneZh || "").trim(),
      };
    });
  }, [segments, episodeClips, episodeKeyarts, legacyClip, focusEpisode, shootablePlan]);
  /** 勾选数按「段」报，避免显示成镜数（13）让人以为要出 13 条片 */
  const selectedSegmentCount = useMemo(
    () => new Set(selectedShotIndexes.map((n) => resolveSegmentIndexFromShotIndex(n))).size,
    [selectedShotIndexes],
  );
  /** 段级勾选：整段的镜一起进出选区，与「生成所选成片」的段级语义对齐 */
  const toggleSegmentSelected = (shotIndexes: number[]) => {
    setSelectedShotIndexes((prev) => {
      const allIn = shotIndexes.length > 0 && shotIndexes.every((n) => prev.includes(n));
      return allIn
        ? prev.filter((n) => !shotIndexes.includes(n))
        : [...prev, ...shotIndexes.filter((n) => !prev.includes(n))];
    });
  };
  /** 点段卡：选中段首镜并把该段成片（或首张静帧）滚进画布 */
  const selectSegmentAndFocusCanvas = (shotIndexes: number[]) => {
    const first = shotIndexes[0];
    if (typeof first !== "number") return;
    const listIndex = shots.findIndex((s) => s.index === first);
    selectShotAndFocusCanvas(listIndex >= 0 ? listIndex : 0);
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
  /** 本集画布设定图 +「我的角色/场景/道具」已勾选图（避免场景墙空着但分栏有图） */
  const episodeSheetGallery = useMemo(() => {
    const items: Array<{
      id: string;
      kind: ManhuaCanonSheetKind;
      labelZh: string;
      url: string;
    }> = [];
    const seenUrl = new Set<string>();
    for (const b of blocks) {
      const isChar = b.id.startsWith("charsheet-");
      const isScene = b.id.startsWith("sceneplate-");
      const isProp = b.id.startsWith("propsheet-");
      if (!isChar && !isScene && !isProp) continue;
      const url = mediaUrl(b);
      if (!url || seenUrl.has(url)) continue;
      seenUrl.add(url);
      const seedId = b.id
        .replace(/^charsheet-/, "")
        .replace(/^sceneplate-/, "")
        .replace(/^propsheet-/, "");
      const labelZh = isChar
        ? assetCanon?.characters.find((c) => c.id === seedId || b.id.includes(c.id))?.nameZh ||
          "角色定妆"
        : isProp
          ? assetCanon?.props.find((p) => p.id === seedId || b.id.includes(p.id))?.nameZh ||
            "道具参考"
          : assetCanon?.locations.find((l) => l.id === seedId || b.id.includes(l.id))?.nameZh ||
            getManhuaSceneTemplate(seedId)?.nameZh ||
            "场景参考";
      items.push({
        id: b.id,
        kind: isChar ? "charsheet" : isProp ? "propsheet" : "sceneplate",
        labelZh,
        url,
      });
    }
    for (const ref of customAssetRefs) {
      const url = String(ref.url || "").trim();
      if (!/^https:\/\//i.test(url) || seenUrl.has(url)) continue;
      if (ref.role !== "character" && ref.role !== "scene" && ref.role !== "prop") continue;
      seenUrl.add(url);
      const kind: ManhuaCanonSheetKind =
        ref.role === "scene" ? "sceneplate" : ref.role === "prop" ? "propsheet" : "charsheet";
      items.push({
        id: `${kind}-custom-${ref.id}`,
        kind,
        labelZh:
          ref.labelZh ||
          (kind === "sceneplate" ? "场景参考" : kind === "propsheet" ? "道具参考" : "角色定妆"),
        url,
      });
    }
    return items.sort((a, b) => {
      if (a.kind === b.kind) return a.labelZh.localeCompare(b.labelZh, "zh");
      return CANON_SHEET_KIND_ORDER.indexOf(a.kind) - CANON_SHEET_KIND_ORDER.indexOf(b.kind);
    });
  }, [blocks, assetCanon, customAssetRefs]);

  /**
   * 画廊删除分流：用户自传参考图的画廊 id 是 `<kind>-custom-<refId>`，不在画布块里，
   * 直接喂 onRemoveEpisodeSheet 会静默无效（2026-08-13 用户实锤「X 点了删不掉」）——
   * custom 条目必须走 onRemoveCustomAsset(refId)，画布块条目才走 onRemoveEpisodeSheet。
   */
  const removeEpisodeGalleryItem = useCallback(
    (galleryId: string) => {
      const m = /^(?:charsheet|sceneplate|propsheet)-custom-(.+)$/.exec(galleryId);
      if (m?.[1]) {
        // custom 条目只认参考图删除；没有该回调也不许 fall through 到块删除装样子
        onRemoveCustomAsset?.(m[1]);
        return;
      }
      onRemoveEpisodeSheet?.(galleryId);
    },
    [onRemoveCustomAsset, onRemoveEpisodeSheet],
  );
  /**
   * 剧本表里点名、但还没有图的角色/场景/道具。
   *
   * 道具从前不收：那会儿它只并进角色定妆卡的特写格，没有独立出图路径，
   * 列出来是点了没反应的死卡。现在 planManhuaAssetImageSpawns 会出 propsheet-，
   * 占位格点下去真能补图，才敢一起列。
   */
  const pendingSheetAnchors = useMemo(() => {
    if (!assetCanon) return [] as ManhuaPendingSheetAnchor[];
    const hasImage = (
      anchor: ManhuaWriterAssetCanon["characters"][number],
      kind: ManhuaCanonSheetKind,
    ) =>
      episodeSheetGallery.some((g) => g.kind === kind && g.id.includes(anchor.id)) ||
      customAssetRefs.some((r) => {
        const role = kind === "charsheet" ? "character" : kind === "sceneplate" ? "scene" : "prop";
        return r.role === role && /^https:\/\//i.test(String(r.url || "")) && customAssetRefClaimsAnchor(r, anchor);
      });
    const out: ManhuaPendingSheetAnchor[] = [];
    for (const c of assetCanon.characters) {
      if (hasImage(c, "charsheet")) continue;
      out.push({
        anchorId: c.id,
        kind: "charsheet",
        nameZh: c.nameZh,
        lookZh: String(c.lookZh || "").trim(),
      });
    }
    for (const l of assetCanon.locations) {
      if (hasImage(l, "sceneplate")) continue;
      out.push({
        anchorId: l.id,
        kind: "sceneplate",
        nameZh: l.nameZh,
        lookZh: String(l.lookZh || "").trim(),
      });
    }
    /** 与出图计划同一把尺：那边不出的这边也别列，否则又是点不动的死卡 */
    for (const p of (assetCanon.props || [])
      .filter(shouldSpawnManhuaPropPlate)
      .slice(0, MANHUA_PROP_SHEET_MAX)) {
      if (hasImage(p, "propsheet")) continue;
      if (
        customAssetRefs.some(
          (r) =>
            r.role === "prop" &&
            String(r.labelZh || "").trim() === String(p.nameZh || "").trim() &&
            /^https:\/\//i.test(String(r.url || "")),
        )
      ) {
        continue;
      }
      out.push({
        anchorId: p.id,
        kind: "propsheet",
        nameZh: p.nameZh,
        lookZh: String(p.lookZh || "").trim(),
      });
    }
    return out;
  }, [assetCanon, episodeSheetGallery, customAssetRefs]);
  const customSummaryZh = summarizeCustomAssetRefsZh(customAssetRefs);
  /** 编剧主场景优先：有本集主场景名时，勿用题材默认的皇宫大殿库 id 去挂示范锁 */
  const lockSceneId = useMemo(() => {
    if (customAssetRefs.some((r) => r.role === "scene")) return "";
    if (episodeMainScene?.nameZh) return "";
    return sceneId;
  }, [customAssetRefs, episodeMainScene?.nameZh, sceneId]);
  /**
   * 必须与成片链路同源：左栏「本集出场对照」和成片门禁读同一份 registry，
   * 口径分叉会造成「左栏显示已挂图、出片被门禁拦下」的假信号。
   *
   * 原实现有两处分叉：用 mediaUrl() 会把只有垫图（refImageUrl / editFusionUrls）
   * 的定妆卡算成已出图；且没有「脸特写优先、无脸退全身」的定序，同角色两张图时
   * 全凭块顺序后者覆盖前者。
   */
  const characterSheetUrlById = useMemo(
    () => collectManhuaCharacterSheetUrlById(blocks, assetCanon),
    [blocks, assetCanon],
  );
  /** 漏传时 buildManhuaSheetPropSubSlots 会退回拿整张角色定妆卡当道具 path，甚至 logical:// 占位 */
  const propImageUrlById = useMemo(
    () => collectManhuaPropImageUrlById(customAssetRefs, assetCanon),
    [customAssetRefs, assetCanon],
  );
  const resolvedLookSets = useMemo(
    () =>
      ensureDefaultLookSetsForCharacters(
        characterLookSets,
        [
          ...(characterIds || []),
          ...(assetCanon?.characters || []).map((c) => c.id),
        ],
        Object.fromEntries(
          (assetCanon?.characters || []).map((c) => [c.id, c.nameZh]),
        ),
      ),
    [characterLookSets, characterIds, assetCanon],
  );
  const assetLockRegistry = useMemo(
    () =>
      buildManhuaAssetLockRegistry({
        characterIds,
        artStyleId: activeArtStyleId,
        sceneId: lockSceneId,
        propIds,
        customRefs: customAssetRefs,
        assetCanon,
        characterSheetUrlById,
        propImageUrlById,
        characterLookSets: resolvedLookSets,
      }),
    [
      characterIds,
      activeArtStyleId,
      lockSceneId,
      propIds,
      customAssetRefs,
      assetCanon,
      characterSheetUrlById,
      propImageUrlById,
      resolvedLookSets,
    ],
  );
  const outlineComplete = Boolean(canRun);
  /** 方案 B：剧本确认 + 角色/场景锁定 + 角色图/场景图齐，才可进分镜出片 */
  const assetsComplete = assetGate.ready && !assetScriptStaleHintZh;
  const productionProgress = useMemo((): ManhuaProductionProgress => {
    const segmentCount = segments.length;
    // 2.0：默认 5–6 段；2.5：4 段即可。静帧已按现有段出齐时，不得再卡「至少 10 段」拦审阅/出片
    const segmentPlanReady =
      segmentCount >= episodeSegmentBounds.min ||
      (segmentCount >= 1 && stillsReadyEnough);
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
      // 完成度判定只认真实产出：mediaUrl 会回退垫图，旧草稿/失败重跑会被当成「已有成片」
      hasClip: episodeClips.some(
        (b) => b.status === "done" && Boolean(clipOutputUrl(b)),
      ),
    };
  }, [
    segments,
    stillsReadyEnough,
    topic,
    outlineComplete,
    assetsComplete,
    episodeClips,
    episodeSegmentBounds.min,
  ]);
  const videoBurnUnlocked = canManhuaBurnVideo(productionProgress);
  const videoBurnHint = videoBurnUnlocked
    ? null
    : !stillsCountReady
      ? `请先出齐关键静帧（每段至少 ${MANHUA_KEYARTS_PER_SEGMENT_MIN} 张）`
      : !keyartsPixelLocked
        ? "关键静帧须垫图改图锁定（改图模式 + 定妆/场景参考图），纯文生成的图不能出成片"
        : !productionProgress.keyartsReady
          ? "请先完成垫图改图锁定的关键静帧"
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
    segmentCastMismatchHintZh,
    segmentNoFaceLockHintZh,
  });
  const fragmentGateHint = keyartGateHint;
  const refuseIfBlocked = (hint: string | null): boolean => {
    if (!hint) return false;
    toast.error("还差一步", { description: hint });
    return true;
  };
  /**
   * 审阅提示词（阿硕/OiiOii：有静帧图 → 铺段节点到画布看提示词）。
   * 只卡「有没有图」；垫图锁只拦真正出片，不拦审阅与画布展示。
   */
  const clipPromptReviewUnlocked = episodeStillCount > 0;
  const openClipPromptReview = () => {
    if (episodeStillCount <= 0) {
      toast.error("还差一步", { description: "请先出关键静帧，有图后再审阅提示词" });
      return;
    }
    if (activePhase !== "storyboard") setActivePhase("storyboard");
    setClipPromptReviewOpen(true);
    openCanvasDock();
    if (onReviewClipPromptsOnCanvas) {
      // 布局完成后再居中高亮，禁止先 focus 再甩节点到画布底
      onReviewClipPromptsOnCanvas({ segmentIndex: activeSegNo });
    } else {
      onEnsureSegmentClips?.();
      onLayoutReadableChain?.();
      const focusId =
        episodeClips.find(
          (b) => resolveClipLocalSegmentIndex(b.id, b.prompt, focusEpisode) === activeSegNo,
        )?.id ||
        episodeClips[0]?.id ||
        episodeKeyarts.find((b) => mediaUrl(b))?.id ||
        "";
      window.setTimeout(() => {
        if (focusId) focusBlockAndOpenCanvas(focusId);
      }, 160);
    }
    toast.message("已定位到成片提示词节点", {
      description: "画布会滚到该段并高亮；可直接改提示词",
    });
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
        // A：目标按「一镜一张」的实际已铺节点数算（未铺时才用段×3 分镜数排队）
        const expected =
          episodeKeyarts.length > 0 ? episodeKeyarts.length : shots.length;
        const has =
          expected > 0
            ? episodeStillCount >= expected && keyartsPixelLocked
            : episodeStillCount > 0 && keyartsPixelLocked;
        return {
          stage,
          label:
            episodeKeyarts.length > 1
              ? `${MANHUA_FACTORY_STAGE_LABEL_ZH[stage]} ${episodeStillCount}/${Math.max(expected, 1)}`
              : MANHUA_FACTORY_STAGE_LABEL_ZH[stage],
          has,
          blockId: activeKeyart?.id || episodeKeyarts[0]?.id,
        };
      }
      if (stage === "clip") {
        /**
         * 判据与「能不能进成片坞合成」收口到同一个函数。
         *
         * 原来硬写 status === "passed"：没盖到质检报告的段是 undefined，直接判 false。
         * 而质检报告缺失是常态（失败只给第 1 段盖报告、手点重跑不补质检），
         * 于是出现「片子能合成、阶段却永远算不完成、剪辑永远待开始」——
         * 同一个业务判断两处各写一遍，合成那条修了并写了注释，这条没跟着改。
         */
        const has = episodeClips.some(
          (b) =>
            b.status === "done" &&
            manhuaClipQualityAllowsAssemble({
              outputUrl: clipOutputUrl(b),
              quality: b.manhuaClipQuality,
            }),
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
  /** 勾选集是 Set：直接进依赖数组不会因元素增减触发重算，取 size */
  const dockSelectedCount = dockSelectedIds?.size ?? 0;

  const storyboardReadyEnough =
    assetsComplete && (shots.length > 0 || Boolean(episodeStillCount));

  const workflowPhases = useMemo(() => {
    const byStage = new Map(stageStrip.map((item) => [item.stage, item]));
    // 大纲 → 资产 → 分镜 → 剪辑
    const clipHas = Boolean(byStage.get("clip")?.has);
    const clipDone = episodeClips.filter(
      (b) =>
        b.status === "done" &&
        manhuaClipQualityAllowsAssemble({
          outputUrl: clipOutputUrl(b),
          quality: b.manhuaClipQuality,
        }),
    ).length;
    const clipTotal = Math.max(episodeClips.length, segments.length || 0);

    /**
     * 每格都要能回答「我为什么是这个状态、还差什么」。
     * 只显示「已完成 / 待开始」而不显示缺口，等于把调试成本转嫁给用户 ——
     * 0823 实况：资产标「已完成」而底部准入检查同时显示「尚未选角色」。
     */
    /**
     * 缺口明细升级（0829）：「缺角色 N」→「定妆 x/y」计数、场景分「未选/图未出」
     * 两态、风格包（选填）未填提示。组装逻辑抽在 manhuaPhaseGapText 纯函数里
     * 好测；判据仍全部来自 assetGate，complete 判定表达式原样不动。
     */
    const assetsGapInput = {
      assetsComplete,
      gate: assetGate,
      // 与闸门同一本人数账（characterIds 就是喂给 evaluateManhuaAssetImageGate 的那份）
      castTotal: characterIds.length,
      stylePackMissing: !stylePack,
      scriptStale: Boolean(assetScriptStaleHintZh),
    };
    const assetsGapItems = buildManhuaAssetsGapItems(assetsGapInput);
    const assetsGapZh = buildManhuaAssetsGapZh(assetsGapInput);

    const definitions: Array<{
      id: WorkflowPhaseId;
      label: string;
      complete: boolean;
      gapZh?: string;
      /** 缺口小字里的 [去补→] 微操：只有资产格用得上 */
      gapActions?: Array<{ labelZh: string; anchor: ManhuaAssetsGapAnchor }>;
    }> = [
      {
        id: "outline",
        label: "剧本大纲",
        complete: outlineComplete,
        gapZh: outlineComplete ? "" : "请先确认剧本大纲",
      },
      {
        id: "assets",
        label: "资产设定",
        complete: assetsComplete,
        gapZh: assetsGapZh,
        gapActions: assetsGapItems
          .filter((i) => i.anchor && i.jumpLabelZh)
          .map((i) => ({ labelZh: i.jumpLabelZh as string, anchor: i.anchor as ManhuaAssetsGapAnchor })),
      },
      {
        /**
         * 原来是「或」：只要有静帧就算分镜完成，哪怕一段成片都没出。
         * 于是用户看到「分镜视频 ✅」以为能进剪辑，点进去发现待开始，
         * 而且没有任何提示说还差什么。改成与剪辑同源：至少一段成片可用。
         */
        id: "storyboard",
        label: "分镜视频",
        complete: clipHas,
        gapZh: clipHas
          ? ""
          : clipTotal
            ? `静帧 ${episodeStillCount}/${Math.max(episodeKeyarts.length || shots.length, 1)} · 成片 ${clipDone}/${clipTotal}`
            : "先出静帧再出成片",
      },
      {
        id: "edit",
        label: "剪辑",
        complete: clipHas && roughClips.length > 0,
        gapZh: clipHas
          ? roughClips.length
            ? ""
            : "本集还没有可排的镜头"
          : "需先出至少 1 段成片",
      },
      {
        /**
         * 第五格：后期三件套（拼接 / BGM / 响度）都做完了，却不在流程条里 ——
         * 用户走到「剪辑 ✅」就以为到头了，根本不知道还有成片这一步，
         * 于是画布上永远没有长片。闭环的最后一格必须看得见。
         */
        id: "final",
        label: "成片",
        complete: Boolean(finalVideoUrl),
        gapZh: finalVideoUrl
          ? ""
          : !clipHas
            ? "需先出至少 1 段成片"
            : dockSelectedCount
              ? `已勾选 ${dockSelectedCount} 段 · 待合成`
              : "成片坞未勾选镜头",
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
    episodeKeyarts.length,
    episodeClips,
    shots.length,
    segments.length,
    roughClips.length,
    assetGate,
    assetScriptStaleHintZh,
    characterIds,
    stylePack,
    finalVideoUrl,
    dockSelectedCount,
  ]);

  useEffect(() => {
    if (!outlineComplete && activePhase !== "outline") {
      setActivePhase("outline");
    }
  }, [outlineComplete, activePhase]);

  // 不再因资产未齐强制踢回资产页——用横幅 + 点击报错说明，禁止静默挡操作

  const selectPhase = (phase: WorkflowPhaseId) => {
    if ((phase === "storyboard" || phase === "edit") && !outlineComplete) {
      toast.error("还差一步", { description: "请先确认剧本大纲" });
      setActivePhase("outline");
      return;
    }
    if (phase === "assets" && !outlineComplete) {
      toast.error("还差一步", { description: "请先确认剧本大纲" });
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
    if (phase === "final") {
      // 坞渲染在 extras 视图（沉浸工作台下 display:none），
      // 组件内部滚动对隐藏元素无效，必须由父级先切视图
      setActivePhase("final");
      onOpenClipDock?.();
      return;
    }
    setActivePhase(phase);
  };

  /**
   * [去补→] 微操：资产格缺口小字里的关键缺项一键跳到资产页对应区块。
   * 资产面板是条件渲染（activePhase === "assets" 才挂载），切页当帧查不到
   * 锚点，得等一拍再滚；风格包面板在简洁模式空包时带 hidden，滚不到就退
   * 而滚到画风选择区，保证点了总有落点、不静默。
   */
  const jumpToAssetsGapAnchor = (anchor: ManhuaAssetsGapAnchor) => {
    selectPhase("assets");
    window.setTimeout(() => {
      const bySelector = (sel: string) => document.querySelector<HTMLElement>(sel);
      let el =
        anchor === "style"
          ? bySelector("[data-manhua-style-pack-panel]")
          : anchor === "scene"
            ? bySelector('[data-manhua-episode-sheets-kind="sceneplate"]')
            : bySelector('[data-manhua-episode-sheets-kind="charsheet"]');
      if (anchor === "style" && (!el || el.offsetParent === null)) {
        el = bySelector("[data-manhua-art-style-picker]");
      }
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };

  /**
   * 「生成全部」双重确认（用户 2026-07-29）：全量生成会按剧本重出全部设定图、清掉旧图，
   * 误点一次就烧一整批积分（曾清掉 18 张）。改成先武装、强制等 5 秒、再点一次才放行。
   */
  const FULL_SPAWN_CONFIRM_MS = 5000;
  const [fullSpawnArmAt, setFullSpawnArmAt] = useState<number | null>(null);
  const [fullSpawnTick, setFullSpawnTick] = useState(() => Date.now());
  useEffect(() => {
    if (fullSpawnArmAt == null) return;
    const timer = setInterval(() => setFullSpawnTick(Date.now()), 250);
    return () => clearInterval(timer);
  }, [fullSpawnArmAt]);
  const fullSpawnRemainSec =
    fullSpawnArmAt == null
      ? 0
      : Math.max(
          0,
          Math.ceil((fullSpawnArmAt + FULL_SPAWN_CONFIRM_MS - fullSpawnTick) / 1000),
        );

  /**
   * 重出弹框（用户 2026-07-29 定）：点「重出」不再直接烧图，先让用户写清哪里要改进，
   * 再选按描述重画、还是换成公有库里类似的那张。两条路都另外扣积分（1 张 15 / 2 张 20）。
   * 弹框本身就是防误点闸门——不写描述也得多点一次「按描述重画」才会跑。
   */
  const [regenDraft, setRegenDraft] = useState<{
    key: string;
    titleZh: string;
    role: ManhuaCustomAssetRole;
    anchorIds: string[];
    noteZh: string;
    /** 展开「从库里挑一张」的候选墙 */
    picking: boolean;
  } | null>(null);
  /** 点缩略图先放大看清，再决定定位画布还是重出（缩略图 88px 看不出形制对不对） */
  const [sheetPreview, setSheetPreview] = useState<{
    id: string;
    url: string;
    labelZh: string;
  } | null>(null);
  const regenTileCount = regenDraft?.anchorIds.length || 1;
  const openRegenDraft = (opts: {
    key: string;
    titleZh: string;
    role: ManhuaCustomAssetRole;
    anchorIds: string[];
  }) => {
    if (!opts.anchorIds.length || !onRegenerateSheets) return;
    setRegenDraft({ ...opts, noteZh: "", picking: false });
  };
  const submitRegenDraft = (mode: ManhuaAssetRegenMode, libraryImageUrl?: string) => {
    if (!regenDraft || !onRegenerateSheets) return;
    // 不填也能重出：这时就按当下的提示词（含联网核对的形制）重画一版
    const noteZh = normalizeManhuaAssetRegenNoteZh(regenDraft.noteZh);
    const anchorIds = regenDraft.anchorIds;
    setRegenDraft(null);
    void onRegenerateSheets({ anchorIds, noteZh, mode, libraryImageUrl });
  };

  const enterStoryboard = () => {
    if (!outlineComplete) {
      toast.error("还差一步", { description: "请先确认剧本大纲" });
      setActivePhase("outline");
      return;
    }
    // 2026-08-10 用户明令：进分镜不得自动触发清图/出图（皆为扣费动作）。
    // 只提示缺什么，由用户在资产设定页显式选择「导 ZIP / 只清旧图 / 付费重出」。
    if (assetScriptStaleHintZh) {
      toast.message("设定图与剧本不符", {
        description: `${assetScriptStaleHintZh}（请先在资产设定处理：导入资产 ZIP、只清旧图，或付费重出）`,
      });
      setActivePhase("assets");
      return;
    }
    if (!assetsComplete) {
      toast.message("资产尚未齐备", {
        description: keyartGateHint || "请先在资产设定导入 ZIP 或手动生成设定图（生成将扣费）",
      });
      setActivePhase("assets");
      return;
    }
    if (refuseIfBlocked(keyartGateHint)) return;
    setActivePhase("storyboard");
  };

  /**
   * 全量生成统一入口：先武装、强制等 5 秒、再点一次才真跑。
   * 两个「生成全部」按钮都走这里，免得留后门。
   */
  const requestFullSpawn = () => {
    if (fullSpawnArmAt == null) {
      setFullSpawnArmAt(Date.now());
      setFullSpawnTick(Date.now());
      toast.message("确认要「全部生成」吗？", {
        description:
          "这会按剧本重出全部设定图、清掉已出的旧图。只想补缺图请点虚线卡或「补齐 N 张」。等 5 秒后再点一次确认。",
      });
      return;
    }
    if (fullSpawnRemainSec > 0) {
      toast.message(`再等 ${fullSpawnRemainSec} 秒`, { description: "确认期未满，防误点" });
      return;
    }
    setFullSpawnArmAt(null);
    enterStoryboard();
  };

  const runGenerateAllKeyarts = () => {
    if (refuseIfBlocked(keyartGateHint)) return;
    setActivePhase("storyboard");
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
        toast.error("还差一步", {
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
      className={`${compactUi ? "mh-compact " : ""}${
        immersive
          ? "flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#0a0d14]"
          : "mt-1 flex h-[calc(100dvh-5.75rem)] min-h-[620px] min-w-0 w-full flex-col overflow-hidden rounded-xl border border-white/12 bg-[#0a0d14] shadow-[0_12px_48px_rgba(0,0,0,0.45)]"
      }`}
    >
      {/* 顶栏 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5 md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Clapperboard className="h-4 w-4 shrink-0 text-cyan-300" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-white/95">
              {seriesTitle || topic || "剧本工作室"}
              <span className="ml-2 text-[11px] font-normal text-white/40">
                第{focusEpisode}集 · {segments.length} 段 · 约 {totalSec}s · {episodeVideoLabelZh}
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
        {/*
          主操作簇居中(用户 0820:高频按钮别压在最右上角,挪到画面上方中间)。

          花钱动作统一带 data-manhua-action-cost="spend"，样式上给一圈暖色描边，
          与「对齐画布竖排」这类无害动作区分开 ——
          本仓有过误点烧掉一整批积分（曾清掉 18 张）的事故，
          双重确认拦的是点下去之后，颜色分组拦的是**点错本身**。
        */}
        <div
          data-manhua-toolbar-cluster
          className="mx-auto flex flex-wrap items-center justify-center gap-1.5 [&_[data-manhua-action-cost=spend]]:ring-1 [&_[data-manhua-action-cost=spend]]:ring-amber-300/35 [&_[data-manhua-action-cost=spend]]:ring-offset-1 [&_[data-manhua-action-cost=spend]]:ring-offset-[#0a121c]"
        >
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
              {onGenerateAllEpisodeKeyarts && !(compactUi && activePhase === "storyboard") ? (
                <button
                  type="button"
                  data-manhua-action="generate-all-keyarts"
                  data-manhua-action-cost={manhuaToolbarActionCost("generate-all-keyarts")}
                  disabled={Boolean(factoryBusy)}
                  onClick={runGenerateAllKeyarts}
                  className={`inline-flex items-center gap-1 rounded-lg border border-cyan-300/45 bg-gradient-to-b from-cyan-400/30 to-cyan-600/25 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 disabled:opacity-45 ${
                    nextCta.kind === "generate_keyarts"
                      ? "ring-2 ring-cyan-300/70 ring-offset-1 ring-offset-[#0a121c]"
                      : ""
                  }`}
                  title={"一次出齐本集关键静帧（条件不满足时会提示缺什么）"
                  }
                >
                  <Play className="h-3.5 w-3.5" />
                  生成关键静帧
                </button>
              ) : null}
              <button
                type="button"
                data-manhua-action="review-clip-prompts"
                  data-manhua-action-cost={manhuaToolbarActionCost("review-clip-prompts")}
                disabled={Boolean(factoryBusy)}
                onClick={openClipPromptReview}
                className="inline-flex items-center gap-1 rounded-lg border border-cyan-300/35 bg-cyan-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-45"
                title={
                  !clipPromptReviewUnlocked
                    ? "先出关键静帧；有图即可审阅并在画布展示段提示词"
                    : "铺到画布审阅段提示词；确认后再出片"
                }
              >
                审阅成片提示词
              </button>
            </>
          )}
          {factoryBusy && onStopFactory ? null : (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-manhua-action="open-more-tools"
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-white/70 hover:border-white/25 hover:bg-white/[0.08]"
                  title="展开导演板、分段生成、接力与工作区设置"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  更多操作
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                data-manhua-toolbar-more
                className="z-[80] w-[min(92vw,38rem)] border-white/15 bg-[#0c121d]/98 p-3 text-white shadow-2xl [&_[data-manhua-action-cost=spend]]:ring-1 [&_[data-manhua-action-cost=spend]]:ring-amber-300/35 [&_[data-manhua-action-cost=spend]]:ring-offset-1 [&_[data-manhua-action-cost=spend]]:ring-offset-[#0c121d]"
              >
                <div className="mb-3 border-b border-white/10 pb-2">
                  <div className="text-[12px] font-semibold text-white/90">更多操作</div>
                  <p className="mt-0.5 text-[10px] text-white/45">
                    主流程留在步骤条；这里收纳导演板、局部重跑与工作区设置。
                  </p>
                </div>
                <div
                  data-manhua-toolbar-group="director-assets"
                  className="rounded-lg border border-white/10 bg-white/[0.025] p-2"
                >
                  <div className="mb-2 text-[10px] font-semibold tracking-wide text-cyan-100/75">
                    导演板与资产
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
              {onIngestDirectorBoardFile
                ? (() => {
                    // 切集后旧段号可能越界 → 自动回落「本集共用」
                    const segChoice =
                      boardSegChoice > 0 && boardSegChoice <= segments.length
                        ? boardSegChoice
                        : 0;
                    const chosenUrl =
                      segChoice > 0
                        ? directorBoardSegUrls?.[segChoice] || null
                        : directorBoardMainUrl;
                    return (
                      <span className="inline-flex items-center gap-1">
                        <select
                          value={segChoice}
                          disabled={Boolean(factoryBusy || directorBoardBusy)}
                          onChange={(e) => setBoardSegChoice(Number(e.target.value) || 0)}
                          className="rounded-lg border border-white/15 bg-white/[0.04] px-1.5 py-1.5 text-[10px] text-white/70 focus:outline-none disabled:opacity-45"
                          title="这张导演板作用范围：本集共用，或只作用某一段（段级优先、集级兜底）"
                        >
                          <option value={0}>本集共用</option>
                          {segments.map((s) => (
                            <option key={s.index} value={s.index}>
                              段{String(s.index).padStart(2, "0")}
                              {directorBoardSegUrls?.[s.index] ? " ✓" : ""}
                            </option>
                          ))}
                        </select>
                        <label
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold ${
                            chosenUrl
                              ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-50"
                              : "border-amber-300/35 bg-amber-500/10 text-amber-50/90"
                          } ${factoryBusy || directorBoardBusy ? "pointer-events-none opacity-45" : ""}`}
                          title="上传导演分镜板整版图；裁出主画面后接入成片垫图（不裁则模型易学四格拼贴）。选了段就只作用该段，未传段级板的段用本集共用板兜底"
                        >
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            disabled={Boolean(factoryBusy || directorBoardBusy)}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (!file) return;
                              void Promise.resolve(
                                onIngestDirectorBoardFile(file, segChoice > 0 ? segChoice : null),
                              ).catch((err: unknown) => {
                                toast.error(err instanceof Error ? err.message : "导演板接入失败");
                              });
                            }}
                          />
                          {directorBoardBusy
                            ? "导演板裁切中…"
                            : segChoice > 0
                              ? chosenUrl
                                ? `段${String(segChoice).padStart(2, "0")}已接入·可覆盖`
                                : `上传段${String(segChoice).padStart(2, "0")}导演板`
                              : chosenUrl
                                ? "导演板已接入"
                                : "上传导演板"}
                        </label>
                      </span>
                    );
                  })()
                : null}
              {onCopyDirectorBoardPrompt ? (
                <button
                  type="button"
                  disabled={Boolean(factoryBusy || directorBoardBusy)}
                  onClick={() => {
                    void Promise.resolve(onCopyDirectorBoardPrompt()).catch((err: unknown) => {
                      toast.error(err instanceof Error ? err.message : "复制提示词失败");
                    });
                  }}
                  className="rounded-lg border border-white/15 bg-white/[0.04] px-2 py-1.5 text-[10px] text-white/70 hover:bg-white/[0.08] disabled:opacity-45"
                  title="按本集可拍表拼导演板出图提示词并复制；先出齐定妆/场景/道具，再出整版图，最后上传裁切"
                >
                  复制导演板提示词
                </button>
              ) : null}
              {onImportAssetZipFile ? (
                <label
                  className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-white/70 hover:bg-white/[0.08] ${
                    factoryBusy || assetZipBusy || directorBoardBusy
                      ? "pointer-events-none opacity-45"
                      : ""
                  }`}
                  title="导入资产 ZIP：characters/scenes/props/costumes/director_boards"
                >
                  <input
                    type="file"
                    accept=".zip,application/zip"
                    className="hidden"
                    disabled={Boolean(factoryBusy || assetZipBusy || directorBoardBusy)}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      void Promise.resolve(onImportAssetZipFile(file)).catch((err: unknown) => {
                        toast.error(err instanceof Error ? err.message : "ZIP 导入失败");
                      });
                    }}
                  />
                  {assetZipBusy ? "资产包导入中…" : "导入资产 ZIP"}
                </label>
              ) : null}
              {directorBoardMainUrl && onClearDirectorBoard ? (
                <button
                  type="button"
                  disabled={Boolean(factoryBusy || directorBoardBusy)}
                  onClick={() => onClearDirectorBoard()}
                  className="rounded-lg border border-white/15 bg-white/[0.04] px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.08]"
                  title="清除本集导演板垫图绑定（不删已上传文件）"
                >
                  清除导演板
                </button>
              ) : null}
                  </div>
                </div>
                <div
                  data-manhua-toolbar-group="generation-workspace"
                  className="mt-2 rounded-lg border border-white/10 bg-white/[0.025] p-2"
                >
                  <div className="mb-2 text-[10px] font-semibold tracking-wide text-violet-100/75">
                    生成范围与画布
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={toggleCompactUi}
                title={compactUi ? "展开全部说明小字与低频控件" : "收起说明小字，界面更清爽"}
                className="rounded-lg border border-white/15 bg-white/[0.04] px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.08]"
              >
                {compactUi ? "显示说明" : "简洁模式"}
              </button>
              <button
                type="button"
                data-manhua-action="generate-fragment"
                  data-manhua-action-cost={manhuaToolbarActionCost("generate-fragment")}
                disabled={Boolean(factoryBusy)}
                onClick={runGenerateFragment}
                className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-white/75 hover:bg-white/[0.08] disabled:opacity-45"
                title={`当前第 ${String(activeSegNo).padStart(2, "0")} 段（含镜 ${String(activeShotNo).padStart(2, "0")}）：缺静帧则只补本段再出片`
                }
              >
                {`生成第 ${String(activeSegNo).padStart(2, "0")} 段成片`}
              </button>
          {onLayoutReadableChain ? (
            <button
              type="button"
              data-manhua-action="layout-readable-chain"
                  data-manhua-action-cost={manhuaToolbarActionCost("layout-readable-chain")}
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
                  data-manhua-action-cost={manhuaToolbarActionCost("generate-selected-fragments")}
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
              title={`依次生成已勾选段：${Array.from(
                  new Set(
                    selectedSorted.map((n) =>
                      String(resolveSegmentIndexFromShotIndex(n)).padStart(2, "0"),
                    ),
                  ),
                ).join("、")}`
              }
            >
              生成所选成片 {selectedSegmentCount} 段
            </button>
          ) : null}
          {onGenerateMissingFragments && (missingFragmentIndexes.length > 0 || stillsReadyEnough) ? (
            <button
              type="button"
              data-manhua-action="generate-missing-fragments"
                  data-manhua-action-cost={manhuaToolbarActionCost("generate-missing-fragments")}
              disabled={Boolean(factoryBusy)}
              onClick={() => {
                if (refuseIfBlocked(clipGateHint)) return;
                if (!stillsReadyEnough) {
                  toast.error("还差一步", {
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
              title={"静帧与导戏单锁定后批量出片"}
            >
              确认静帧，生成全部成片
            </button>
          ) : null}
          {onRerunKeyartsFromReverse ? (
            <button
              type="button"
              data-manhua-action="rerun-keyarts"
                  data-manhua-action-cost={manhuaToolbarActionCost("rerun-keyarts")}
              disabled={Boolean(factoryBusy)}
              onClick={() => {
                if (refuseIfBlocked(keyartGateHint)) return;
                setActivePhase("storyboard");
                onRerunKeyartsFromReverse();
              }}
              title={"从编导反推重跑本集多镜静帧，覆盖旧图"}
              className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-amber-50 hover:bg-amber-500/25 disabled:opacity-45"
            >
              重出全部分镜
            </button>
          ) : null}
                  </div>
                </div>
                <div
                  data-manhua-toolbar-group="continuity-entries"
                  className="mt-2 rounded-lg border border-white/10 bg-white/[0.025] p-2"
                >
                  <div className="mb-2 text-[10px] font-semibold tracking-wide text-emerald-100/75">
                    连续性与入口
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
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
              title={"仅从失败/未完成节点接着跑；已出的错图不会重做"}
              className="rounded-lg border border-white/12 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.06] disabled:opacity-45"
            >
              续跑
            </button>
          ) : null}
          {(
            <>
              {/* 入口去重：资产阶段人物卡旁边就有「去选人物 / 更换人物」，
                  同去处的远端按钮让位；其它阶段没有就近入口，这个必须留着 */}
              {shouldShowToolbarCharacterLibraryEntry({ activePhase, compactUi: false }) ? (
                <button
                  type="button"
                  onClick={() => onOpenCharacterCard?.()}
                  className="rounded-lg border border-white/12 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.06]"
                >
                  角色库
                </button>
              ) : null}
              {/* 同上：资产阶段已有 5 个就近入口（库场景·道具 / 更换 / 尚未选场景…），
                  远端这个让位；其它阶段留着当唯一通路 */}
              {shouldShowToolbarAssetWallEntry({ activePhase, compactUi: false }) ? (
                <button
                  type="button"
                  onClick={() => onOpenAssetWall?.()}
                  className="rounded-lg border border-white/12 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.06]"
                >
                  资产墙
                </button>
              ) : null}
            </>
          )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      <div
        data-manhua-draft-retention-hint
        className={
          // 沉浸分镜把高度留给三栏画布；提示缩成单行
          immersive
            ? "mh-hint shrink-0 truncate border-b border-white/8 bg-white/[0.03] px-3 py-0.5 text-[9px] text-white/35"
            : "mh-hint shrink-0 border-b border-white/8 bg-white/[0.03] px-3 py-1.5 text-[10px] leading-relaxed text-white/45"
        }
        title={MANHUA_DRAFT_RETENTION_HINT_ZH}
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
      {/* A2(UI 优化):成片闸门收敛为一条黄色状态条+跳转,按钮 title 不再重复整句 */}
      {outlineComplete && !keyartGateHint && clipGateHint ? (
        <div
          data-manhua-clip-gate-banner
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-400/20 bg-amber-500/10 px-3 py-1.5"
        >
          <p className="min-w-0 flex-1 text-[11px] text-amber-50/90">{clipGateHint}</p>
          <button
            type="button"
            data-manhua-action="goto-fix-from-clip-banner"
            onClick={() =>
              selectPhase(/静帧|垫图|导戏单/.test(clipGateHint) ? "storyboard" : "assets")
            }
            className="shrink-0 rounded-md border border-amber-300/45 bg-amber-500/25 px-2.5 py-1 text-[10px] font-semibold text-amber-50 hover:bg-amber-500/35"
          >
            {/静帧|垫图|导戏单/.test(clipGateHint) ? "去出静帧" : "去补图"}
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

      {/* 阿硕式：只留一条阶段轨（大纲→资产→分镜→剪辑→成片），勿叠第二套进度 */}
      <div
        data-manhua-workflow-rail
        data-manhua-ashuo-stepper
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-cyan-400/25 bg-gradient-to-r from-cyan-500/[0.1] via-[#0a121c] to-transparent px-3 py-2"
      >
        <span className="mr-1 shrink-0 text-[10px] font-semibold tracking-[0.12em] text-cyan-200/70">
          阶段
        </span>
        {workflowPhases.map((phase, index) => (
          <div key={phase.id} className="flex shrink-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              data-manhua-phase={phase.id}
              data-manhua-phase-status={
                phase.complete ? "complete" : phase.current ? "current" : "pending"
              }
              onClick={() => selectPhase(phase.id)}
              className={`flex min-w-[132px] flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left ${
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
              <span className="min-w-0 flex-1">
                <span className="block whitespace-nowrap text-[11px] font-semibold">
                  {phase.id === "assets" ? "资产设定" : phase.label}
                </span>
                {/* 缺口一直算了却没渲染：只显示「待开始」等于把排查成本推给用户 */}
                {phase.gapZh ? (
                  <span
                    data-manhua-phase-gap
                    title={phase.gapZh}
                    className="block truncate text-[8px] leading-tight opacity-70"
                  >
                    {phase.gapZh}
                    {/* 外层整格已是 <button>，内层不许再嵌 button——span 拦掉冒泡自己跳。
                        truncate 单行容器塞多个链接会被省略号吃掉（审查 P2），只渲染首个；
                        完整缺口清单在 title 悬浮里。 */}
                    {phase.gapActions?.slice(0, 1).map((a) => (
                      <span
                        key={`${a.anchor}-${a.labelZh}`}
                        role="button"
                        tabIndex={0}
                        data-manhua-phase-gap-jump={a.anchor}
                        onClick={(e) => {
                          e.stopPropagation();
                          jumpToAssetsGapAnchor(a.anchor);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            e.preventDefault();
                            jumpToAssetsGapAnchor(a.anchor);
                          }
                        }}
                        className="ml-1 cursor-pointer text-cyan-200/90 underline decoration-dotted underline-offset-2 hover:text-cyan-100"
                      >
                        {a.labelZh}→
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              <span className="ml-auto shrink-0 self-start text-[8px] opacity-60">
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
          <p className="mh-hint mt-0.5 text-[11px] leading-snug text-white/50">{nextCta.hintZh}</p>
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
            <p className="mh-hint mt-1 text-[11px] leading-5 text-white/45">
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
                <p className="mh-hint mt-2 text-[11px] text-white/40">{projectBibleSummary}</p>
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
                <div className={`text-[15px] font-bold tracking-wide text-white/95 ${compactUi ? "hidden" : ""}`}>
                  生成本集角色设定卡
                </div>
                <p className="mh-hint mt-1 text-[11px] leading-5 text-white/45">
                  {assetCanon?.characters.length
                    ? "以剧本人物表与系列场景池为准；点右上「生成全部」或底栏同名按钮出定妆与场景空镜。"
                    : "人物、场景、服装、道具分栏上传或生成，上传时先选分类，不设未归类池。"}
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
                        toast.error("还差一步", { description: "请先确认剧本大纲" });
                        return;
                      }
                      if (!assetGate.castLocked || !assetGate.sceneLocked) {
                        toast.error("还差一步", {
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
                {assetStashCount > 0 && onRestoreAssetStash ? (
                  <button
                    type="button"
                    data-manhua-action="restore-asset-stash"
                    onClick={onRestoreAssetStash}
                    className="rounded-lg border border-emerald-300/50 bg-emerald-500/20 px-3 py-1.5 text-[12px] font-semibold text-emerald-50 hover:bg-emerald-500/30"
                    title="重出/误删前存下的旧设定图都在暂存区，点此把被清掉的救回画布"
                  >
                    暂存区救回 {assetStashCount} 张
                  </button>
                ) : null}
                {unadoptedSheetCount > 0 && onAdoptEpisodeSheets ? (
                  <button
                    type="button"
                    data-manhua-action="adopt-episode-sheets"
                    disabled={Boolean(factoryBusy)}
                    onClick={onAdoptEpisodeSheets}
                    className="rounded-lg border border-cyan-300/50 bg-cyan-500/20 px-3 py-1.5 text-[12px] font-semibold text-cyan-50 hover:bg-cyan-500/30 disabled:opacity-45"
                    title="这些设定图已经出好了，但还没挂上 @ 号，静帧锁不到它们的脸与场景。点此挂回，不重画、不扣积分"
                  >
                    认领 {unadoptedSheetCount} 张设定图（不扣积分）
                  </button>
                ) : null}
                <button
                  type="button"
                  data-manhua-action="confirm-assets"
                  data-manhua-full-spawn-armed={fullSpawnArmAt == null ? "false" : "true"}
                  disabled={Boolean(factoryBusy) || fullSpawnRemainSec > 0}
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
                      // 全量生成会清旧图重出：走 5 秒双重确认，不直接放行
                      requestFullSpawn();
                      return;
                    }
                    if (refuseIfBlocked(keyartGateHint)) return;
                    setActivePhase("storyboard");
                  }}
                  className="rounded-lg border border-violet-300/50 bg-violet-500/30 px-3 py-1.5 text-[12px] font-bold text-violet-50 disabled:opacity-45"
                  title={(stillsReadyEnough ? "进入分镜" : "生成关键静帧")
                  }
                >
                  {fullSpawnArmAt != null
                    ? fullSpawnRemainSec > 0
                      ? `确认全部生成（${fullSpawnRemainSec}s）`
                      : "再点一次确认全部生成"
                    : episodeSheetGallery.length === 0 || !assetsComplete
                      ? "生成全部"
                      : !stillsReadyEnough
                        ? "生成关键静帧"
                        : "进入分镜 →"}
                </button>
              </div>
            </div>

            {canonWriterDriftHintZh ? (
              <div
                data-manhua-canon-drift-banner
                className="mt-3 rounded-xl border border-rose-400/50 bg-rose-500/15 px-3 py-2.5"
              >
                <p className="text-[12px] font-semibold text-rose-50">⚠ 角色对不上：设定图还是旧剧本的人</p>
                <p className="mt-1 text-[11px] leading-5 text-rose-50/85">{canonWriterDriftHintZh}</p>
              </div>
            ) : null}

            {assetScriptStaleHintZh ? (
              <div
                data-manhua-asset-stale-banner
                className="mt-3 rounded-xl border border-amber-300/40 bg-amber-500/15 px-3 py-2.5"
              >
                <p className="text-[12px] font-semibold text-amber-50">{assetScriptStaleHintZh}</p>
                <p className="mh-hint mt-1 text-[10px] leading-4 text-amber-50/70">
                  重写剧本后旧人物图不会自动继续用。点右上「按剧本重出设定图」清掉旧生成图并按现稿重出；你手动上传的参考会保留。
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {onPurgeStaleAssets ? (
                    <button
                      type="button"
                      disabled={factoryBusy}
                      onClick={() => onPurgeStaleAssets()}
                      className="rounded-lg border border-white/25 bg-white/[0.08] px-3 py-1.5 text-[11px] font-bold text-white/85 disabled:opacity-45"
                    >
                      只清掉旧图（不出图 · 不扣费）
                    </button>
                  ) : null}
                  {onRegenerateAssetsFromScript ? (
                    <button
                      type="button"
                      disabled={factoryBusy}
                      onClick={() => void onRegenerateAssetsFromScript()}
                      className="rounded-lg border border-amber-200/50 bg-amber-400/25 px-3 py-1.5 text-[11px] font-bold text-amber-50 disabled:opacity-45"
                    >
                      清掉并按剧本重出（将扣费）
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {segmentCastMismatchHintZh ? (
              <div
                data-manhua-cast-mismatch
                className="mt-3 rounded-xl border border-rose-400/45 bg-rose-500/[0.12] p-3"
              >
                <div className="text-[11px] font-semibold text-rose-50">
                  资产对不上剧本，已暂停出片
                </div>
                <p className="mt-1 text-[10px] leading-4 text-rose-50/80">
                  {segmentCastMismatchHintZh}
                </p>
                <button
                  type="button"
                  data-manhua-action="regenerate-assets-from-script"
                  disabled={factoryBusy || !onRegenerateAssetsFromScript}
                  onClick={() => void onRegenerateAssetsFromScript?.()}
                  className="mt-2 rounded-lg border border-rose-300/50 bg-rose-500/25 px-2.5 py-1 text-[11px] font-semibold text-rose-50 hover:bg-rose-500/40 disabled:opacity-45"
                >
                  按剧本重出角色图
                </button>
              </div>
            ) : null}

            {/* 与上面那条分开：那是「图对不上名字」要重出，这是「还没出图」要生成 */}
            {segmentNoFaceLockHintZh ? (
              <div
                data-manhua-no-face-lock
                className="mt-3 rounded-xl border border-amber-400/45 bg-amber-500/[0.12] p-3"
              >
                <div className="text-[11px] font-semibold text-amber-50">
                  还没锁脸，已暂停出片
                </div>
                <p className="mt-1 text-[10px] leading-4 text-amber-50/80">
                  {segmentNoFaceLockHintZh}
                </p>
                <button
                  type="button"
                  data-manhua-action="prepare-images-for-face-lock"
                  disabled={factoryBusy || !onConfirmAssetsAndPrepareImages}
                  onClick={() => void onConfirmAssetsAndPrepareImages?.()}
                  className="mt-2 rounded-lg border border-amber-300/50 bg-amber-500/25 px-2.5 py-1 text-[11px] font-semibold text-amber-50 hover:bg-amber-500/40 disabled:opacity-45"
                >
                  出齐定妆图
                </button>
              </div>
            ) : null}

            <div
              data-manhua-episode-sheets
              className="mt-3 space-y-2 rounded-xl border border-emerald-400/35 bg-emerald-500/[0.08] p-3"
            >
              <div>
                <div className="text-[11px] font-semibold text-emerald-50/95">
                  本集设定图 · {episodeSheetGallery.length} 张
                  {pendingSheetAnchors.length ? (
                    <span className="ml-1 font-normal text-amber-200/80">
                      · 待生成 {pendingSheetAnchors.length}（
                      {[
                        ["人物", "charsheet" as const],
                        ["场景", "sceneplate" as const],
                        ["道具", "propsheet" as const],
                      ]
                        .map(
                          ([zh, kind]) =>
                            `${zh} ${pendingSheetAnchors.filter((x) => x.kind === kind).length}`,
                        )
                        .join(" · ")}
                      ）
                    </span>
                  ) : null}
                </div>
                <p className="mh-hint mt-0.5 text-[10px] leading-4 text-white/45">
                  角色定妆、场景空镜、关键道具分栏；点缩略图定位画布，点虚线卡补这一张。生成后同步进下方「我的角色
                  / 我的场景 / 我的道具」。
                </p>
              </div>
              {cropTarget ? (
                <div
                  className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-2 bg-black/85 px-4 py-6"
                  onClick={() => setCropTarget(null)}
                >
                  <p className="text-[12px] font-semibold text-white/90">
                    裁字：在图上拖一个框，框内保留、框外裁掉（烧字通常在边缘）
                  </p>
                  <div
                    className="relative max-h-[70vh] max-w-full cursor-crosshair select-none"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => {
                      const box = e.currentTarget.getBoundingClientRect();
                      const x = (e.clientX - box.left) / box.width;
                      const y = (e.clientY - box.top) / box.height;
                      cropDragRef.current = { startX: x, startY: y };
                      setCropRect({ x, y, w: 0, h: 0 });
                    }}
                    onMouseMove={(e) => {
                      if (!cropDragRef.current) return;
                      const box = e.currentTarget.getBoundingClientRect();
                      const cx = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
                      const cy = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
                      const { startX, startY } = cropDragRef.current;
                      setCropRect({
                        x: Math.min(startX, cx),
                        y: Math.min(startY, cy),
                        w: Math.abs(cx - startX),
                        h: Math.abs(cy - startY),
                      });
                    }}
                    onMouseUp={() => {
                      cropDragRef.current = null;
                    }}
                    onMouseLeave={() => {
                      cropDragRef.current = null;
                    }}
                  >
                    <img
                      src={cropTarget.url}
                      alt={cropTarget.labelZh}
                      draggable={false}
                      className="max-h-[70vh] max-w-full rounded-lg border border-white/15 object-contain"
                    />
                    {cropRect && cropRect.w > 0.01 && cropRect.h > 0.01 ? (
                      <div
                        className="pointer-events-none absolute border-2 border-emerald-300 bg-emerald-400/10"
                        style={{
                          left: `${cropRect.x * 100}%`,
                          top: `${cropRect.y * 100}%`,
                          width: `${cropRect.w * 100}%`,
                          height: `${cropRect.h * 100}%`,
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      disabled={!cropRect || cropRect.w < 0.05 || cropRect.h < 0.05}
                      onClick={() => {
                        if (!cropRect || !onCropCustomAsset) return;
                        void onCropCustomAsset(cropTarget.id, cropRect);
                        setCropTarget(null);
                      }}
                      className="rounded-lg border border-emerald-300/50 bg-emerald-500/25 px-3 py-1.5 text-[12px] font-semibold text-emerald-50 hover:bg-emerald-500/40 disabled:opacity-40"
                    >
                      保留框内 · 裁掉框外（免费）
                    </button>
                    <button
                      type="button"
                      onClick={() => setCropRect(null)}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/[0.06]"
                    >
                      重画框
                    </button>
                    <button
                      type="button"
                      onClick={() => setCropTarget(null)}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-[12px] text-white/60 hover:bg-white/[0.06]"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : null}
              {sheetPreview ? (
                <div
                  className="fixed inset-0 z-[75] flex flex-col items-center justify-center gap-3 bg-black/85 px-4 py-6"
                  onClick={() => setSheetPreview(null)}
                >
                  <img
                    src={sheetPreview.url}
                    alt={sheetPreview.labelZh}
                    onClick={(e) => e.stopPropagation()}
                    className="max-h-[78vh] max-w-full rounded-xl border border-white/15 object-contain"
                  />
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex flex-wrap items-center gap-2 rounded-lg bg-black/70 px-3 py-1.5"
                    >
                    <span className="text-[12px] font-semibold text-white/90">
                      {sheetPreview.labelZh}
                    </span>
                    {sheetPreview.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          const id = sheetPreview.id;
                          setSheetPreview(null);
                          focusBlockAndOpenCanvas(id);
                        }}
                        className="rounded border border-white/20 px-2 py-0.5 text-[11px] text-white/80 hover:bg-white/[0.08]"
                      >
                        在画布中定位
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setSheetPreview(null)}
                      className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-white/60 hover:bg-white/[0.06]"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              ) : null}
              {regenDraft ? (
                // 居中浮层：卡片在页面下方时，内联面板会落在视野外，看着就像点了没反应
                <div
                  className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 py-6"
                  onClick={() => setRegenDraft(null)}
                >
                <div
                  data-manhua-regen-draft
                  onClick={(e) => e.stopPropagation()}
                  className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-amber-300/35 bg-[#12100c] px-3 py-2 shadow-2xl"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-amber-50">
                      重出「{regenDraft.titleZh}」
                      {regenTileCount > 1 ? ` · ${regenTileCount} 张` : ""}
                    </p>
                    <button
                      type="button"
                      onClick={() => setRegenDraft(null)}
                      className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-white/60 hover:bg-white/[0.06]"
                    >
                      取消
                    </button>
                  </div>
                  <textarea
                    data-manhua-regen-note
                    autoFocus
                    value={regenDraft.noteZh}
                    maxLength={MANHUA_ASSET_REGEN_NOTE_MAX}
                    onChange={(e) =>
                      setRegenDraft((prev) => (prev ? { ...prev, noteZh: e.target.value } : prev))
                    }
                    rows={2}
                    placeholder="想改哪里就写一句（可留空直接重出）。例：这件是长条扁平、略向内微弯的象牙板；或：这个角色是女性，脸要重画，服装不变。"
                    className="mt-1.5 w-full rounded-lg border border-white/12 bg-black/40 px-2 py-1.5 text-[11px] leading-4 text-white/85 placeholder:text-white/30"
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-manhua-action="regen-redraw"
                      disabled={factoryBusy}
                      onClick={() => submitRegenDraft("redraw")}
                      className="rounded-lg border border-violet-300/50 bg-violet-500/25 px-2.5 py-1 text-[11px] font-semibold text-violet-50 hover:bg-violet-500/40 disabled:opacity-45"
                    >
                      {normalizeManhuaAssetRegenNoteZh(regenDraft.noteZh) ? "按描述重画" : "直接重出"}
                      （{manhuaAssetRegenPriceLabelZh(regenTileCount, "redraw")}）
                    </button>
                    <button
                      type="button"
                      data-manhua-action="regen-pick-library"
                      disabled={factoryBusy}
                      onClick={() => {
                        setRegenDraft((prev) =>
                          prev ? { ...prev, picking: !prev.picking } : prev,
                        );
                        onRequestLibraryPicker?.(regenDraft.role);
                      }}
                      className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-white/75 hover:bg-white/[0.06] disabled:opacity-45"
                    >
                      {regenDraft.picking ? "收起库里候选" : "从库里挑一张…"}
                    </button>
                    <span className="text-[10px] text-white/40">
                      两条路都另外扣积分；描述只影响这
                      {regenTileCount > 1 ? ` ${regenTileCount} ` : "一"}张，其他图不动。
                    </span>
                  </div>
                  {regenDraft.picking ? (
                    <div className="mt-2">
                      {(libraryPickerItems || []).filter((x) => x.role === regenDraft.role)
                        .length ? (
                        <div className="flex flex-wrap gap-2">
                          {(libraryPickerItems || [])
                            .filter((x) => x.role === regenDraft.role)
                            .map((lib) => (
                              <button
                                key={lib.publicId}
                                type="button"
                                data-manhua-regen-library-pick={lib.publicId}
                                disabled={factoryBusy || regenTileCount > 1}
                                onClick={() => submitRegenDraft("library", lib.imageUrl)}
                                className="w-[76px] overflow-hidden rounded-lg border border-white/15 bg-black/40 text-left hover:border-amber-200/60 disabled:opacity-40"
                                title={`换成这张（${manhuaAssetRegenPriceLabelZh(1, "library")}）`}
                              >
                                <img
                                  src={lib.imageUrl}
                                  alt=""
                                  className="aspect-[3/4] w-full object-cover object-top"
                                  loading="lazy"
                                />
                                <span className="block truncate px-1 py-0.5 text-[9px] text-white/70">
                                  {lib.labelZh}
                                </span>
                              </button>
                            ))}
                        </div>
                      ) : (
                        <p className="mh-hint text-[10px] text-white/40">
                          库里还没有同类可用的匿名资产，先用「按描述重画」。
                        </p>
                      )}
                      {regenTileCount > 1 ? (
                        <p className="mt-1 text-[10px] text-amber-100/70">
                          换库里那张一次只能换一个：请从缩略图右下角的「改这张」单张进入。
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                </div>
              ) : null}
              {episodeSheetGallery.length || pendingSheetAnchors.length ? (
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
                      {
                        kind: "propsheet" as const,
                        titleZh: "关键道具",
                        emptyZh: "本集尚无道具单件图",
                      },
                    ] as const
                  ).map((sec) => {
                    const items = episodeSheetGallery.filter((x) => x.kind === sec.kind);
                    const pending = pendingSheetAnchors.filter((x) => x.kind === sec.kind);
                    /**
                     * 本类「已出图」的剧本锚点：重出用这批。
                     * 不能拿 items.id 直接算——里面还混着用户自传的 custom 卡，重出只管剧本表里的。
                     */
                    const pendingIdSet = new Set(pending.map((a) => a.anchorId));
                    /**
                     * 道具要跟出图计划同一把尺：canon 里可能写了十件，但计划只出
                     * 前 MANHUA_PROP_SHEET_MAX 件符合条件的，按数量直报会写成
                     * 「重出 10 张」而画廊只有 6 张。
                     */
                    const canonAnchorIds = (
                      sec.kind === "charsheet"
                        ? assetCanon?.characters.map((c) => c.id)
                        : sec.kind === "sceneplate"
                          ? assetCanon?.locations.map((l) => l.id)
                          : (assetCanon?.props || [])
                              .filter(shouldSpawnManhuaPropPlate)
                              .slice(0, MANHUA_PROP_SHEET_MAX)
                              .map((p) => p.id)
                    ) || [];
                    const doneAnchorIds = canonAnchorIds.filter((id) => !pendingIdSet.has(id));
                    const secRole: ManhuaCustomAssetRole =
                      sec.kind === "sceneplate"
                        ? "scene"
                        : sec.kind === "propsheet"
                          ? "prop"
                          : "character";
                    return (
                      <div
                        key={sec.kind}
                        data-manhua-episode-sheets-kind={sec.kind}
                        className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-[10px] font-semibold text-emerald-50/80">
                            {sec.titleZh}
                            <span className="ml-1 font-normal text-white/40">· {items.length}</span>
                            {/* D10(UI 优化):缺图红点计数,别让人在 30 张「定位」里找那颗补图钮 */}
                            {pending.length ? (
                              <span className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-rose-400/40 bg-rose-500/15 px-1.5 py-px font-semibold text-rose-100">
                                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                                缺 {pending.length} 项
                              </span>
                            ) : null}
                          </div>
                          {/* 分类一键补齐：人物/场景/道具各自成批出，免得几十个逐张点 */}
                          {pending.length ? (
                            <button
                              type="button"
                              data-manhua-action={`fill-pending-${sec.kind}`}
                              disabled={
                                !outlineComplete ||
                                !assetGate.castLocked ||
                                !assetGate.sceneLocked ||
                                factoryBusy ||
                                !onFillPendingSheets
                              }
                              onClick={() => {
                                void onFillPendingSheets?.(pending.map((a) => a.anchorId));
                              }}
                              className="shrink-0 rounded border border-violet-300/45 bg-violet-500/20 px-2 py-0.5 text-[9px] font-semibold text-violet-50 hover:bg-violet-500/35 disabled:opacity-40"
                              title={`一键出这 ${pending.length} 张${sec.titleZh}（只补缺图，不动已出的）`}
                            >
                              一键出{sec.titleZh} {pending.length} 张
                            </button>
                          ) : null}
                          {/* 重出本类：提示词改好后（例：道具禁烧字）已出的旧图要能按新词重画 */}
                          {doneAnchorIds.length && onRegenerateSheets ? (
                            <button
                              type="button"
                              data-manhua-action={`regen-${sec.kind}`}
                              disabled={
                                !outlineComplete ||
                                !assetGate.castLocked ||
                                !assetGate.sceneLocked ||
                                factoryBusy
                              }
                              onClick={() => {
                                openRegenDraft({
                                  key: sec.kind,
                                  titleZh: sec.titleZh,
                                  role: secRole,
                                  anchorIds: doneAnchorIds,
                                });
                                onRequestLibraryPicker?.(secRole);
                              }}
                              className="shrink-0 rounded border border-amber-300/40 bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold text-amber-50 hover:bg-amber-500/30 disabled:opacity-40"
                              title={`说明哪里要改进后重画这 ${doneAnchorIds.length} 张${sec.titleZh}（只覆盖本类，不动其他类）`}
                            >
                              重出{sec.titleZh} {doneAnchorIds.length} 张…
                            </button>
                          ) : null}
                          {/* 清重复：批次被打断重试会同名双开（2026-08-12 双烧实锤），一键只留每名第一张。
                              v2：同主体不同后缀（阿咎/阿咎_半身/阿咎_全身）也算同组——导入图与重出图
                              并存的乱局一键收敛；组内优先保「无后缀」那张（剧本认领绑的就是它）。 */}
                          {(() => {
                            if (!onRemoveEpisodeSheet) return null;
                            const baseOf = (s: string) =>
                              String(s || "").trim().replace(/[_·\s]*(半身|全身|特写|侧身)$/g, "");
                            const groups = new Map<string, typeof items>();
                            for (const it of items) {
                              const k = baseOf(it.labelZh) || it.id;
                              const arr = groups.get(k) || [];
                              arr.push(it);
                              groups.set(k, arr);
                            }
                            const extras: string[] = [];
                            for (const arr of Array.from(groups.values())) {
                              if (arr.length <= 1) continue;
                              const keep =
                                arr.find(
                                  (x: (typeof items)[number]) =>
                                    baseOf(x.labelZh) === String(x.labelZh || "").trim(),
                                ) || arr[0]!;
                              for (const x of arr) if (x.id !== keep.id) extras.push(x.id);
                            }
                            if (!extras.length) return null;
                            return (
                              <button
                                type="button"
                                data-manhua-action={`dedupe-${sec.kind}`}
                                disabled={factoryBusy}
                                onClick={() => extras.forEach((id) => removeEpisodeGalleryItem(id))}
                                className="shrink-0 rounded border border-rose-300/40 bg-rose-500/15 px-2 py-0.5 text-[9px] font-semibold text-rose-50 hover:bg-rose-500/30 disabled:opacity-40"
                                title={`同名多份只保留第一张，删除免费、可随时重出`}
                              >
                                清重复 {extras.length} 张
                              </button>
                            );
                          })()}
                        </div>
                        {items.length || pending.length ? (
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {items.map((item) => {
                              // 单个重出用剧本锚点，不用 block id：hero 的 charsheet-face-* 也要落回本人
                              const ownAnchorId =
                                canonAnchorIds.find((id) => item.id.includes(id)) || "";
                              // 用户自传的参考图不给重出——那是他自己的素材，不该被系统覆盖
                              const canRegenOne =
                                Boolean(ownAnchorId) &&
                                !item.id.includes("-custom-") &&
                                Boolean(onRegenerateSheets);
                              const oneKey = `${sec.kind}:${ownAnchorId}`;
                              const oneOpen = regenDraft?.key === oneKey;
                              return (
                                <div
                                  key={item.id}
                                  className="group relative w-[88px] overflow-hidden rounded-lg border border-emerald-300/35 bg-black/40 hover:border-emerald-200/60"
                                >
                                  {onRemoveEpisodeSheet ? (
                                    <button
                                      type="button"
                                      onClick={() => removeEpisodeGalleryItem(item.id)}
                                      title={`删除「${item.labelZh}」这张设定图（可随时重出，不扣费）`}
                                      className="absolute right-1 top-1 z-[2] flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[13px] leading-none text-rose-200 hover:bg-rose-500/70 hover:text-white"
                                    >
                                      ×
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    data-manhua-sheet-id={item.id}
                                    onClick={() =>
                                      setSheetPreview({
                                        id: item.id,
                                        url: item.url,
                                        labelZh: item.labelZh,
                                      })
                                    }
                                    className="flex w-full flex-col text-left"
                                    title={`放大看「${item.labelZh}」`}
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
                                  {canRegenOne ? (
                                    <button
                                      type="button"
                                      data-manhua-action="regen-one-sheet"
                                      data-manhua-regen-anchor={ownAnchorId}
                                      disabled={
                                        !outlineComplete ||
                                        !assetGate.castLocked ||
                                        !assetGate.sceneLocked ||
                                        factoryBusy
                                      }
                                      onClick={() => {
                                        openRegenDraft({
                                          key: oneKey,
                                          titleZh: item.labelZh,
                                          role: secRole,
                                          anchorIds: [ownAnchorId],
                                        });
                                        onRequestLibraryPicker?.(secRole);
                                      }}
                                      className={`absolute bottom-6 right-1 rounded border border-amber-300/50 bg-black/75 px-1 py-0.5 text-[9px] font-semibold text-amber-100 backdrop-blur hover:bg-amber-500/40 disabled:opacity-50 ${
                                        oneOpen ? "ring-1 ring-amber-200/70" : ""
                                      }`}
                                      title={`只改「${item.labelZh}」这一张：写一句哪里要改进，或从库里挑一张换`}
                                    >
                                      改这张
                                    </button>
                                  ) : null}
                                </div>
                              );
                            })}
                            {/* D10(UI 优化):缺图条与补图卡 order-first 置顶,先补缺再看已出的 */}
                            {pending.length ? (
                              <div className="order-first flex w-full flex-wrap items-center gap-2 rounded-lg border border-dashed border-amber-300/45 bg-amber-500/[0.07] px-2.5 py-1.5">
                                <span className="text-[10px] font-semibold text-amber-100/90">
                                  待生成 {pending.length}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[9px] text-amber-100/55">
                                  {pending.slice(0, 8).map((p) => p.nameZh).join("、")}
                                  {pending.length > 8 ? "…" : ""}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => togglePendingOpen(sec.kind)}
                                  className="rounded border border-amber-300/50 px-2 py-0.5 text-[10px] font-semibold text-amber-100 hover:bg-amber-500/25"
                                >
                                  {pendingOpenKinds.has(sec.kind) ? "收起" : "展开补图"}
                                </button>
                              </div>
                            ) : null}
                            {(pendingOpenKinds.has(sec.kind) ? pending : []).map((p) => (
                              <button
                                key={p.anchorId}
                                type="button"
                                data-manhua-action="generate-canon-sheet"
                                data-manhua-pending-anchor={p.anchorId}
                                disabled={factoryBusy || !onGenerateCanonAssetSheet}
                                onClick={() => {
                                  void onGenerateCanonAssetSheet?.({
                                    anchorId: p.anchorId,
                                    nameZh: p.nameZh,
                                  });
                                }}
                                className="flex w-[88px] flex-col overflow-hidden rounded-lg border border-dashed border-amber-300/45 bg-amber-500/[0.07] text-left hover:border-amber-200/70 hover:bg-amber-500/15 disabled:opacity-40"
                                title={
                                  p.lookZh
                                    ? `补图：${p.nameZh}｜${p.lookZh.slice(0, 60)}`
                                    : `补图：${p.nameZh}`
                                }
                              >
                                <span className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 px-1 text-center text-amber-100/85">
                                  <span className="text-[16px] leading-none">＋</span>
                                  <span className="text-[9px] leading-3">待生成</span>
                                </span>
                                <span className="truncate px-1.5 py-1 text-[10px] font-semibold text-amber-50/90">
                                  {p.nameZh}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="mh-hint mt-1 text-[10px] text-white/35">{sec.emptyZh}</p>
                        )}
                      </div>
                    );
                  })}
                  {pendingSheetAnchors.length ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[10px] text-amber-100/70">
                        虚线卡是剧本点名、还没出图的，点一张补一张；也可一次补齐。
                      </p>
                      <button
                        type="button"
                        data-manhua-action="fill-pending-sheets"
                        disabled={
                          !outlineComplete ||
                          !assetGate.castLocked ||
                          !assetGate.sceneLocked ||
                          factoryBusy
                        }
                        onClick={() => {
                          // 只补这几张缺的、绝不清已出（名副其实：N=真实要出的张数）
                          const ids = pendingSheetAnchors.map((a) => a.anchorId);
                          if (onFillPendingSheets) void onFillPendingSheets(ids);
                          else enterStoryboard();
                        }}
                        className="shrink-0 rounded-lg border border-violet-300/50 bg-violet-500/25 px-2.5 py-1 text-[11px] font-semibold text-violet-50 hover:bg-violet-500/40 disabled:opacity-45"
                        title="只生成这几张还没出的图，不动已出的（不会清全量重出）"
                      >
                        补齐 {pendingSheetAnchors.length} 张
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <p className="mh-hint text-[10px] text-white/40">
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
                    onClick={requestFullSpawn}
                    className="shrink-0 rounded-lg border border-violet-300/50 bg-violet-500/30 px-3 py-1.5 text-[12px] font-bold text-violet-50 hover:bg-violet-500/40 disabled:opacity-45"
                  >
                    {fullSpawnArmAt != null
                      ? fullSpawnRemainSec > 0
                        ? `确认全部生成（${fullSpawnRemainSec}s）`
                        : "再点一次确认全部生成"
                      : "生成全部"}
                  </button>
                </div>
              )}
            </div>

            {onArtStyleChange ? (
              <div
                data-manhua-art-style-picker
                className="mt-3 rounded-xl border border-cyan-400/30 bg-cyan-500/[0.07] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold text-cyan-50/95">成片画风 · 4 档</div>
                    <p className="mh-hint mt-0.5 text-[10px] leading-4 text-white/45">
                      决定角色卡与全部分镜的渲染语言。中途更换会让前后画风不一致，建议出图前定好。
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md border border-cyan-300/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-100/85">
                    当前 · {getManhuaArtStylePreset(activeArtStyleId).labelZh}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {MANHUA_ART_STYLE_PRESETS.map((preset) => {
                    const selected = activeArtStyleId === preset.id;
                    const is3d = isManhua3dArtStyle(preset.id);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        data-manhua-art-style-id={preset.id}
                        aria-pressed={selected}
                        onClick={() => onArtStyleChange(preset.id)}
                        className={`rounded-lg border px-2.5 py-2 text-left transition ${
                          selected
                            ? "border-cyan-400/60 bg-cyan-500/20 shadow-[0_0_0_1px_rgba(34,211,238,0.35)]"
                            : "border-white/10 bg-white/[0.03] hover:border-white/25"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-semibold text-white">{preset.labelZh}</span>
                          {is3d ? (
                            <span className="shrink-0 rounded border border-amber-300/40 bg-amber-400/15 px-1 text-[9px] font-bold text-amber-100">
                              3D
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[10px] leading-4 text-white/45">{preset.shortZh}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div
              data-manhua-cast-selected
              className="mt-3 rounded-xl border border-violet-400/30 bg-violet-500/[0.08] p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold text-violet-50/95">当前出演人物</div>
                  <p className="mh-hint mt-0.5 text-[10px] leading-4 text-white/45">
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
                <p className="mh-hint mt-2 rounded-lg border border-dashed border-white/15 px-3 py-4 text-center text-[11px] text-white/45">
                  尚未点选人物 · 请点「去选人物」打开角色库
                </p>
              )}
            </div>

            {onStylePackChange ? (
              // 风格包已填才常显；空包属可选进阶功能，简洁模式收进「显示说明」
              <div className={`mt-3 ${compactUi && !stylePack ? "hidden" : ""}`}>
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
                  <div className="text-[11px] font-semibold text-cyan-50/90">
                    本集出场对照
                  </div>
                  <p className="mh-hint mt-0.5 text-[10px] leading-4 text-white/45">
                    人名与场景会跟垫图一一对应。关键静帧请先挂上参考图，再出成片。
                  </p>
                  {compactUi
                    ? (() => {
                        const missing = assetLockRegistry.slots.filter(
                          (s) => !isBindableAssetPath(String(s.path || "")),
                        );
                        return (
                          <p className="mt-1 text-[10px] text-cyan-50/80">
                            已挂图 {assetLockRegistry.slots.length - missing.length}
                            {missing.length
                              ? ` · 缺图 ${missing.length}：${missing
                                  .slice(0, 4)
                                  .map((s) => s.labelZh || s.tag)
                                  .join("、")}${missing.length > 4 ? "…" : ""}`
                              : " · 全部就位"}
                            （点顶栏「显示说明」看全表）
                          </p>
                        );
                      })()
                    : null}
                  <div className={`mt-1.5 flex flex-wrap gap-1.5 ${compactUi ? "hidden" : ""}`}>
                    {assetLockRegistry.slots.map((s) => {
                      /**
                       * 必须与成片侧同一判定。`buildManhuaSheetPropSubSlots` 在既无道具单件图
                       * 也无角色定妆输出时仍会兜底成 `logical://` 占位，path 永远非空，
                       * 于是 `Boolean(s.path)` 让「已挂图」恒亮——而出片链路用
                       * `isBindableAssetPath` 把这类地址全过滤掉，判成缺口拦下出片。
                       */
                      const hasPad = isBindableAssetPath(String(s.path || ""));
                      const kindZh =
                        s.role === "character"
                          ? "人物"
                          : s.role === "scene"
                            ? "场景"
                            : s.role === "prop"
                              ? "道具"
                              : "服装";
                      return (
                        <span
                          key={`${s.tag}:${s.id}`}
                          className="rounded-md border border-cyan-300/35 bg-black/35 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-50"
                          title={s.labelZh}
                        >
                          <span className="font-normal text-white/45">{kindZh}</span>
                          <span className="ml-1 font-normal text-white/85">{s.labelZh}</span>
                          <span
                            className={`ml-1 text-[9px] font-semibold ${
                              hasPad ? "text-emerald-200/90" : "text-red-200"
                            }`}
                          >
                            {hasPad ? "已挂图" : "缺图"}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                  {assetLockRegistry.sheetPropSlots.length ? (
                    <div className="mt-2 border-t border-cyan-400/20 pt-1.5">
                      <div className="text-[10px] font-semibold text-amber-50/90">
                        定妆特写·随身道具
                      </div>
                      <p className="mh-hint mt-0.5 text-[10px] leading-4 text-white/40">
                        特写道具会挂到对应人物定妆上，换集时请保持同一套。
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {assetLockRegistry.sheetPropSlots.map((sp) => (
                          <span
                            key={`${sp.subTag}:${sp.propId}`}
                            className="rounded border border-amber-300/35 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-50/95"
                            title={`${sp.propNameZh} · ${sp.characterNameZh}`}
                          >
                            {sp.propNameZh}
                            <span className="ml-1 text-white/50">{sp.characterNameZh}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className={`mt-2 border-t border-cyan-400/20 pt-1.5 ${compactUi ? "hidden" : ""}`}>
                    <div className="text-[10px] font-semibold text-emerald-50/90">
                      角色声线参考（可选）
                    </div>
                    <p className="mh-hint mt-0.5 text-[10px] leading-4 text-white/40">
                      有参考音更稳，没有也能先出片。语音与配乐之后还能改；同框最多 3 人带声。
                    </p>
                    {characterVoiceLocks.length ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {characterVoiceLocks.map((v) => (
                          <span
                            key={v.id}
                            className="inline-flex items-center gap-1 rounded border border-emerald-300/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-50/95"
                          >
                            {v.characterTag}
                            {v.labelZh && v.labelZh !== v.characterTag ? (
                              <span className="font-sans text-white/50">{v.labelZh}</span>
                            ) : null}
                            {onRemoveCharacterVoice ? (
                              <button
                                type="button"
                                className="text-white/40 hover:text-white/80"
                                onClick={() => onRemoveCharacterVoice(v.id)}
                                aria-label={`移除 ${v.characterTag} 声线`}
                              >
                                ×
                              </button>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mh-hint mt-1 text-[10px] text-white/35">尚未挂声线</p>
                    )}
                    {onExtractCharacterVoice ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {blocks
                          .filter(
                            (b) =>
                              b.id.startsWith("clip-") &&
                              (getBlockEpisodeIndex(b) ?? 1) === focusEpisode &&
                              Boolean(b.outputUrl || b.outputUrls?.[0]),
                          )
                          .slice(0, 6)
                          .flatMap((clip) => {
                            const tags = collectManhuaCharacterTagsFromPrompt(clip.prompt);
                            const charTags =
                              tags.length > 0
                                ? tags
                                : assetLockRegistry.byRole.character
                                    .map((s) => s.tag)
                                    .slice(0, 2);
                            return charTags.map((tag) => {
                              const label =
                                assetLockRegistry.byRole.character.find((s) => s.tag === tag)
                                  ?.labelZh || "";
                              const win = resolveManhuaVoiceExtractWindow(clip.prompt, tag);
                              return (
                                <button
                                  key={`${clip.id}-${tag}`}
                                  type="button"
                                  title={win.labelZh}
                                  className="rounded border border-emerald-400/30 bg-black/30 px-1.5 py-0.5 text-[9px] text-emerald-50/90 hover:bg-emerald-500/15"
                                  onClick={() =>
                                    void onExtractCharacterVoice({
                                      clipId: clip.id,
                                      characterTag: tag,
                                      labelZh: label,
                                      startSec: win.startSec,
                                      durationSec: win.durationSec,
                                    })
                                  }
                                >
                                  段{resolveClipSegmentIndex(clip.id, clip.prompt)}·{tag}
                                  <span className="ml-1 text-white/40">
                                    {win.startSec}–{win.endSec}s
                                  </span>
                                </button>
                              );
                            });
                          })}
                      </div>
                    ) : null}
                  </div>
                  {!compactUi && onAudioReferenceLockChange ? (
                    <div className="mt-2 border-t border-cyan-400/20 pt-1.5">
                      <div className="text-[10px] font-semibold text-sky-50/90">
                        参考音频（BGM / 对白口音）· 可选
                      </div>
                      <p className="mh-hint mt-0.5 text-[10px] leading-4 text-white/40">
                        软参考，不硬锁、不挡出片：填背景音乐与对白口音基准，成片配乐/口音尽量对齐；后期还能改。角色专属音色仍用上方「角色声线参考」。
                      </p>
                      <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-white/45">背景音乐参考（https 音频链接，可空）</span>
                          <input
                            type="url"
                            inputMode="url"
                            placeholder="https://…/bgm.mp3"
                            defaultValue={audioReferenceLock?.bgmUrl || ""}
                            className="rounded border border-white/12 bg-black/40 px-1.5 py-1 font-mono text-[10px] text-white/85 outline-none focus:border-sky-400/50"
                            onBlur={(e) =>
                              onAudioReferenceLockChange({
                                ...(audioReferenceLock || {}),
                                bgmUrl: e.target.value.trim(),
                                updatedAt: Date.now(),
                              })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-white/45">BGM 风格说明（如「古风弦乐·紧张推进」）</span>
                          <input
                            type="text"
                            placeholder="古风弦乐·紧张推进"
                            defaultValue={audioReferenceLock?.bgmNoteZh || ""}
                            className="rounded border border-white/12 bg-black/40 px-1.5 py-1 text-[10px] text-white/85 outline-none focus:border-sky-400/50"
                            onBlur={(e) =>
                              onAudioReferenceLockChange({
                                ...(audioReferenceLock || {}),
                                bgmNoteZh: e.target.value.trim(),
                                updatedAt: Date.now(),
                              })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-white/45">对白口音基准（https 音频链接，可空）</span>
                          <input
                            type="url"
                            inputMode="url"
                            placeholder="https://…/accent.mp3"
                            defaultValue={audioReferenceLock?.accentUrl || ""}
                            className="rounded border border-white/12 bg-black/40 px-1.5 py-1 font-mono text-[10px] text-white/85 outline-none focus:border-sky-400/50"
                            onBlur={(e) =>
                              onAudioReferenceLockChange({
                                ...(audioReferenceLock || {}),
                                accentUrl: e.target.value.trim(),
                                updatedAt: Date.now(),
                              })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-white/45">口音说明（如「北方官话·沉稳」）</span>
                          <input
                            type="text"
                            placeholder="北方官话·沉稳"
                            defaultValue={audioReferenceLock?.accentNoteZh || ""}
                            className="rounded border border-white/12 bg-black/40 px-1.5 py-1 text-[10px] text-white/85 outline-none focus:border-sky-400/50"
                            onBlur={(e) =>
                              onAudioReferenceLockChange({
                                ...(audioReferenceLock || {}),
                                accentNoteZh: e.target.value.trim(),
                                updatedAt: Date.now(),
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
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
                      <p className="mh-hint mt-1 text-[10px] leading-4 text-white/40">
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
                    role: "wardrobe" as const,
                    titleZh: "我的服装（造型子类）",
                    hintZh:
                      "上传换装/妆造参考，编入造型套后按段手选启用。每人最多 3 套；换装不改脸号。",
                    border: "border-rose-400/30 bg-rose-500/[0.07]",
                    titleCls: "text-rose-50/90",
                    btnCls:
                      "border-rose-300/40 bg-rose-500/15 text-rose-50 hover:bg-rose-500/25",
                    seedReady: Boolean(characterIds[0] || ancientArchetypeIds[0]),
                    seedId: characterIds[0] || ancientArchetypeIds[0] || "",
                    genLabelZh: "基于库生成新服装",
                  },
                  {
                    role: "prop" as const,
                    titleZh: "我的道具",
                    hintZh:
                      "上传独立道具参考（每行 3 张）。可挂进造型套搭配；定妆卡特写格另有 @道具 子号。",
                    border: "border-amber-400/30 bg-amber-500/[0.07]",
                    titleCls: "text-amber-50/90",
                    btnCls:
                      "border-amber-300/40 bg-amber-500/15 text-amber-50 hover:bg-amber-500/25",
                    seedReady: Boolean(propIds[0]),
                    seedId: propIds[0] || "",
                    genLabelZh: "基于库生成新道具",
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
                        <p className="mh-hint mt-0.5 text-[10px] leading-4 text-white/45">{sec.hintZh}</p>
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
                        {sec.role === "prop" && onImportPropSheetFile ? (
                          <label
                            className={`inline-flex cursor-pointer items-center rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${sec.btnCls}`}
                            title="一张图里挤了多件道具？上传整张拼板，自动切成单件图分别进本栏"
                          >
                            拼板拆分
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void onImportPropSheetFile(file);
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
                          // 卡片名永远优先真人名：labelZh 空时回查认领锚点名，别让 @角色N 独占卡面
                          const displayNameZh =
                            ref.labelZh || (ref.claimedAnchorNamesZh || [])[0] || "";
                          const claimOptions: ManhuaWriterAssetAnchor[] =
                            ref.role === "character"
                              ? assetCanon?.characters || []
                              : ref.role === "scene"
                                ? assetCanon?.locations || []
                                : ref.role === "prop"
                                  ? assetCanon?.props || []
                                  : [];
                          const needsReview = ref.reviewStatus === "needs_review";
                          const cardExpanded = isManhuaAssetCardExpanded({
                            compactUi,
                            expandedIds: expandedAssetIds,
                            id: ref.id,
                            needsReview,
                          });
                          return (
                          <div
                            key={ref.id}
                            data-manhua-custom-ref-id={ref.id}
                            data-manhua-asset-lock-tag={lockTag || ""}
                            className="relative overflow-hidden rounded-lg border border-white/12 bg-black/35"
                          >
                            {onRemoveCustomAsset ? (
                              <>
                                <input
                                  type="checkbox"
                                  checked={selectedAssetIds.has(ref.id)}
                                  onChange={() => toggleAssetSelected(ref.id)}
                                  title="勾选后底部可一键批量删除"
                                  className="absolute left-1.5 top-1.5 z-[2] h-4 w-4 cursor-pointer accent-rose-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    onRemoveCustomAsset(ref.id);
                                    setSelectedAssetIds((prev) => {
                                      if (!prev.has(ref.id)) return prev;
                                      const next = new Set(prev);
                                      next.delete(ref.id);
                                      return next;
                                    });
                                  }}
                                  title="删除这张参考图"
                                  className="absolute right-1.5 top-1.5 z-[2] flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[13px] leading-none text-rose-200 hover:bg-rose-500/70 hover:text-white"
                                >
                                  ×
                                </button>
                              </>
                            ) : null}
                            {lockTag ? (
                              <span className="absolute left-7 top-1.5 z-[1] rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100">
                                {lockTag}
                              </span>
                            ) : null}
                            <img
                              src={ref.url}
                              alt=""
                              onClick={() =>
                                setSheetPreview({
                                  id: "",
                                  url: ref.url,
                                  labelZh: ref.labelZh || "参考图",
                                })
                              }
                              title="点开放大看"
                              className="aspect-[3/4] w-full cursor-zoom-in object-cover object-top"
                              loading="lazy"
                            />
                            <div className="space-y-1.5 p-2">
                              {ref.reviewStatus === "needs_review" ? (
                                <div className="rounded border border-amber-400/35 bg-amber-500/10 p-1.5 text-[9px] text-amber-100">
                                  <div>{(ref.qualityIssues || []).join("；") || "图片需人工确认"}</div>
                                  {onCustomAssetReviewAccept ? (
                                    <button
                                      type="button"
                                      onClick={() => onCustomAssetReviewAccept(ref.id)}
                                      className="mt-1 rounded bg-amber-300/20 px-1.5 py-0.5 font-medium hover:bg-amber-300/30"
                                    >
                                      确认原图可用
                                    </button>
                                  ) : null}
                                  {onStandardizeCustomAsset ? (
                                    <div className="mt-1 flex gap-1">
                                      <button
                                        type="button"
                                        disabled={assetStandardizeBusyId != null}
                                        onClick={() => void onStandardizeCustomAsset(ref.id, "medium")}
                                        className="rounded bg-cyan-300/15 px-1.5 py-0.5 font-medium text-cyan-100 disabled:opacity-40"
                                      >
                                        {assetStandardizeBusyId === ref.id ? "处理中…" : "AI 标准化·3分"}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={assetStandardizeBusyId != null}
                                        onClick={() => void onStandardizeCustomAsset(ref.id, "high")}
                                        className="rounded bg-violet-300/15 px-1.5 py-0.5 font-medium text-violet-100 disabled:opacity-40"
                                      >
                                        高质·5分
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              {onCustomAssetLabelChange ? (
                                <div
                                  className="flex items-center gap-1"
                                  title="识别错了就改名：改成与剧本表一致的人物/场景名，这张图立即被认领"
                                >
                                  {lockTag ? (
                                    <span className="shrink-0 text-[10px] text-white/55">{lockTag} ·</span>
                                  ) : null}
                                  <input
                                    key={`${ref.id}:${displayNameZh}`}
                                    type="text"
                                    defaultValue={displayNameZh}
                                    placeholder="改名认领：填剧本表里的名字"
                                    maxLength={40}
                                    onBlur={(e) => {
                                      // 与预填名（含认领回查名）相同就不写：零编辑失焦不落库
                                      const v = e.target.value.trim();
                                      if (v !== displayNameZh) onCustomAssetLabelChange(ref.id, v);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                    }}
                                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[10px] text-white/70 hover:border-white/15 focus:border-white/30 focus:bg-black/40 focus:outline-none"
                                  />
                                  <span className="shrink-0 text-[9px] text-white/35">
                                    {ref.source === "generated" ? "新生成" : "上传"}
                                  </span>
                                </div>
                              ) : (
                                <div className="truncate text-[10px] text-white/55">
                                  {lockTag ? `${lockTag} · ` : ""}
                                  {displayNameZh || "参考图"}
                                  {ref.source === "generated" ? " · 新生成" : " · 上传"}
                                </div>
                              )}
                              {cardExpanded && onCustomAssetClaimsChange && claimOptions.length ? (
                                <div className="space-y-1">
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      const picked = e.target.value;
                                      if (!picked) return;
                                      const current = ref.claimedAnchorIds || [];
                                      const next =
                                        ref.role === "scene" || ref.role === "prop"
                                          ? current.includes(picked)
                                            ? current.filter((id) => id !== picked)
                                            : [...current, picked]
                                          : [picked];
                                      onCustomAssetClaimsChange(ref.id, next);
                                    }}
                                    className="w-full rounded border border-white/10 bg-black/45 px-1 py-0.5 text-[9px] text-white/65"
                                  >
                                    <option value="">认领剧本资产…</option>
                                    {claimOptions.map((anchor) => (
                                      <option key={anchor.id} value={anchor.id}>
                                        {(ref.claimedAnchorIds || []).includes(anchor.id) ? "✓ " : ""}{anchor.nameZh}
                                      </option>
                                    ))}
                                  </select>
                                  {(ref.claimedAnchorIds || []).length ? (
                                    <button
                                      type="button"
                                      onClick={() => onCustomAssetClaimsChange(ref.id, [])}
                                      title="清除后这张图不再自动挂任何剧本资产；要重新认领请在上方点选，或直接改名"
                                      className="text-[9px] text-white/40 hover:text-white/65"
                                    >
                                      清除明确认领
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              {cardExpanded && (onCropCustomAsset || onDetextCustomAsset) ? (
                                <div className="flex flex-wrap gap-1">
                                  {onCropCustomAsset ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCropTarget({ id: ref.id, url: ref.url, labelZh: ref.labelZh || "参考图" });
                                        setCropRect(null);
                                      }}
                                      title="画面边缘有烧字？拖框选要保留的部分，框外裁掉——免费"
                                      className="rounded border border-emerald-300/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-100 hover:bg-emerald-500/25"
                                    >
                                      裁字·免费
                                    </button>
                                  ) : null}
                                  {onDetextCustomAsset ? (
                                    <button
                                      type="button"
                                      disabled={assetStandardizeBusyId != null}
                                      onClick={() => void onDetextCustomAsset(ref.id)}
                                      title="文字在画面中间裁不掉？AI 精确擦除文字，其余像素保持原样"
                                      className="rounded border border-cyan-300/40 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40"
                                    >
                                      {assetStandardizeBusyId === ref.id ? "去字中…" : "AI 去字·3分"}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              {shouldShowManhuaAssetRoleChip(cardExpanded) ? (
                                <div className="text-[9px] text-white/40">
                                  {MANHUA_CUSTOM_ASSET_ROLE_LABEL_ZH[ref.role]}
                                  {ref.refDuty
                                    ? ` · ${MANHUA_CUSTOM_ASSET_REF_DUTY_LABEL_ZH[ref.refDuty]}`
                                    : ""}
                                </div>
                              ) : null}
                              {cardExpanded ? (
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
                              </div>
                              ) : null}
                              {onCustomAssetDutyChange && cardExpanded ? (
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
                              {/* 折叠开关：90% 的时间只需要 图/名字/✕，其余点开再说。
                                  待人工确认的卡强制展开，不给收起（收起等于把问题藏了）*/}
                              {compactUi && !needsReview ? (
                                <button
                                  type="button"
                                  data-manhua-asset-card-toggle={ref.id}
                                  aria-expanded={cardExpanded}
                                  onClick={() => toggleAssetExpanded(ref.id)}
                                  title={
                                    cardExpanded
                                      ? "收起这张卡的分类、认领、裁字等设置"
                                      : "展开分类、垫图用途、认领、裁字/去字"
                                  }
                                  className="w-full rounded border border-white/10 bg-white/[0.03] py-0.5 text-[9px] text-white/40 hover:bg-white/10 hover:text-white/70"
                                >
                                  {cardExpanded ? "收起 ⌃" : "⋯ 更多设置"}
                                </button>
                              ) : null}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mh-hint mt-2 text-[10px] text-white/35">本栏尚无参考图。</p>
                    )}
                  </div>
                );
              })}
              {onClearAllCustomAssets && customAssetRefs.length > 0 ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `一键清空全部 ${customAssetRefs.length} 张参考图？清完可重新导入资产包，一次导干净。`,
                        )
                      )
                        return;
                      onClearAllCustomAssets();
                      setSelectedAssetIds(new Set());
                    }}
                    className="rounded-lg border border-rose-300/40 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-100 hover:bg-rose-500/25"
                    title="清空我的角色/场景/服装/道具全部参考图；本机草稿会同步保存"
                  >
                    一键清空参考图（{customAssetRefs.length}）
                  </button>
                </div>
              ) : null}
              {selectedAssetIds.size > 0 && onRemoveCustomAsset ? (
                <div className="sticky bottom-2 z-[5] flex items-center gap-2 rounded-xl border border-rose-300/40 bg-[#150d13]/95 px-3 py-2 backdrop-blur">
                  <span className="text-[11px] font-semibold text-rose-100">
                    已选 {selectedAssetIds.size} 张
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const ids = Array.from(selectedAssetIds);
                      if (!window.confirm(`删除所选 ${ids.length} 张参考图？只删参考记录，可重新上传。`)) return;
                      ids.forEach((id) => onRemoveCustomAsset(id));
                      setSelectedAssetIds(new Set());
                    }}
                    className="rounded-lg border border-rose-300/50 bg-rose-500/20 px-3 py-1 text-[11px] font-semibold text-rose-100 hover:bg-rose-500/35"
                  >
                    删除所选
                  </button>
                  {/* 能批量的原本只有「删除」和「重出」——而用户最需要批量的是**设置**：
                      4 角色 × 3 槽挂造型要点 12 次，逐张改垫图用途同理。 */}
                  {onCustomAssetRoleChange ? (
                    <select
                      value=""
                      title="把所选的图一次归到同一分类"
                      onChange={(e) => {
                        const role = e.target.value;
                        if (!role) return;
                        Array.from(selectedAssetIds).forEach((id) =>
                          onCustomAssetRoleChange(id, role as ManhuaCustomAssetRole),
                        );
                        e.currentTarget.value = "";
                      }}
                      className="rounded-lg border border-white/15 bg-black/45 px-2 py-1 text-[11px] text-white/70"
                    >
                      <option value="">批量改分类…</option>
                      {MANHUA_CUSTOM_ASSET_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {MANHUA_CUSTOM_ASSET_ROLE_LABEL_ZH[role]}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {onCustomAssetDutyChange ? (
                    <select
                      value=""
                      title="把所选的图一次设成同一种垫图用途"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        const duty = v === "__clear__"
                          ? null
                          : (v as ManhuaCustomAssetRefDuty);
                        Array.from(selectedAssetIds).forEach((id) =>
                          onCustomAssetDutyChange(id, duty),
                        );
                        e.currentTarget.value = "";
                      }}
                      className="rounded-lg border border-white/15 bg-black/45 px-2 py-1 text-[11px] text-white/70"
                    >
                      <option value="">批量设垫图用途…</option>
                      {MANHUA_REF_DUTIES.map((d) => (
                        <option key={d} value={d}>
                          {MANHUA_CUSTOM_ASSET_REF_DUTY_LABEL_ZH[d]}
                        </option>
                      ))}
                      <option value="__clear__">清为未标注</option>
                    </select>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setSelectedAssetIds(new Set())}
                    className="rounded-lg border border-white/15 px-3 py-1 text-[11px] text-white/60 hover:bg-white/[0.06]"
                  >
                    取消勾选
                  </button>
                </div>
              ) : null}
              {customAssetRefs.some((r) => r.role === "unset") ? (
                <div
                  data-manhua-custom-refs-role="unset"
                  className="rounded-xl border border-white/15 bg-white/[0.03] p-3"
                >
                  <div className="text-[11px] font-semibold text-white/70">
                    待归类（老草稿迁移）
                  </div>
                  <p className="mh-hint mt-0.5 text-[10px] text-white/40">
                    上传入口已统一为先选分类，这里只是老草稿留下的未归类图；
                    请点人物 / 场景 / 服装 / 道具归入对应栏，或直接删除——未归类不进融图。
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
                            onClick={() =>
                              setSheetPreview({
                                id: "",
                                url: ref.url,
                                labelZh: ref.labelZh || "参考图",
                              })
                            }
                            title="点开放大看"
                            className="aspect-[3/4] w-full cursor-zoom-in object-cover object-top"
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

            {onCharacterLookSetsChange ? (
              <div
                data-manhua-look-sets
                className="mt-3 rounded-xl border border-rose-400/25 bg-rose-500/[0.06] p-3"
              >
                <div className="text-[11px] font-semibold text-rose-50/90">
                  造型套（每人最多 {MANHUA_LOOK_SETS_PER_CHARACTER_MAX} 套）
                </div>
                <p className="mh-hint mt-0.5 text-[10px] leading-4 text-white/45">
                  妆造/服装挂进套后，分镜里按段手选启用；换装改套，不改 @角色 脸号。网址不展示。
                </p>
                <div className="mt-2 space-y-2">
                  {assetLockRegistry.byRole.character.slice(0, 4).map((ch) => {
                    const sets = listManhuaLookSetsForCharacter(resolvedLookSets, ch.id);
                    const wardrobeRefs = customAssetRefs.filter((r) => r.role === "wardrobe");
                    return (
                      <div
                        key={ch.id}
                        className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5"
                      >
                        <div className="text-[10px] font-semibold text-cyan-50/90">
                          {ch.tag} · {ch.labelZh}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {Array.from({ length: MANHUA_LOOK_SETS_PER_CHARACTER_MAX }, (_, i) => {
                            const idx = i + 1;
                            const ls =
                              sets.find((s) => s.index === idx) ||
                              ({
                                id: "",
                                characterId: ch.id,
                                index: idx,
                                labelZh: `造型${idx}`,
                              } as ManhuaCharacterLookSet);
                            return (
                              <div
                                key={`${ch.id}-${idx}`}
                                className="min-w-[9rem] flex-1 rounded border border-rose-300/25 bg-rose-500/10 px-1.5 py-1"
                              >
                                <input
                                  value={ls.labelZh}
                                  onChange={(e) =>
                                    onCharacterLookSetsChange(
                                      upsertManhuaCharacterLookSet(resolvedLookSets, {
                                        ...ls,
                                        characterId: ch.id,
                                        index: idx,
                                        labelZh: e.target.value,
                                      }),
                                    )
                                  }
                                  className="w-full rounded border border-white/10 bg-black/40 px-1 py-0.5 text-[10px] text-rose-50 outline-none"
                                  placeholder={`造型${idx}`}
                                />
                                <select
                                  value={ls.wardrobeRefId || ls.lookRefId || ""}
                                  onChange={(e) => {
                                    const refId = e.target.value;
                                    onCharacterLookSetsChange(
                                      upsertManhuaCharacterLookSet(resolvedLookSets, {
                                        ...ls,
                                        characterId: ch.id,
                                        index: idx,
                                        wardrobeRefId: refId || undefined,
                                        lookRefId: refId || undefined,
                                      }),
                                    );
                                  }}
                                  className="mt-1 w-full rounded border border-white/10 bg-black/40 px-1 py-0.5 text-[9px] text-white/70"
                                >
                                  <option value="">挂服装图…</option>
                                  {wardrobeRefs.map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.labelZh || r.id.slice(0, 12)}
                                    </option>
                                  ))}
                                </select>
                                <div className="mt-0.5 font-mono text-[8px] text-white/35">
                                  {assetLockRegistry.wardrobeSlots.find(
                                    (w) => w.lookSetId === ls.id,
                                  )?.wardrobeTag || `@服装?`}{" "}
                                  · id={ls.id || "待建"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {onArtStyleChange ? (
              <div
                data-manhua-art-style
                className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="text-[11px] font-semibold text-white/75">成片画风（自选，不硬套）</div>
                <p className="mh-hint mt-0.5 text-[10px] text-white/40">
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
                <p className="mh-hint mt-0.5 text-[10px] leading-4 text-white/45">
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
            onSuggestAutoCuts={() => void handleSuggestAutoCuts()}
            suggestAutoCutsBusy={suggestAutoCutsBusy}
            subtitleEnabled={editSubtitleEnabled}
            onSubtitleEnabledChange={(next) => {
              setEditSubtitleEnabled(next);
              if (deliveryPackage && onDeliveryPackageChange) {
                onDeliveryPackageChange(syncDeliveryPackageSubtitleEnabled(deliveryPackage, next));
              }
            }}
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
              if (onOpenClipDock) {
                onOpenClipDock();
                return;
              }
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

      {/* 阿硕工作流：左本集资产｜中片段脚本｜右本集画布；外层给定高，内层再横移，避免画布高度塌缩 */}
      <div
        data-manhua-phase-panel="storyboard"
        className={
          activePhase !== "storyboard"
            ? "hidden"
            : "flex min-h-0 flex-1 flex-col overflow-hidden"
        }
      >
        <div
          className={
            immersive
              ? "min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
              : "flex min-h-0 flex-1 overflow-hidden"
          }
        >
          <div
            className={
              immersive
                ? showCanvasDock
                  ? // 常规桌面先让三栏在当前视口内弹性收缩；极窄窗口才由外层横向滚动兜底。
                    "grid h-full min-h-0 min-w-[840px] grid-cols-[minmax(128px,0.34fr)_minmax(300px,0.78fr)_minmax(400px,1.28fr)] xl:min-w-0 xl:grid-cols-[152px_minmax(400px,0.58fr)_minmax(560px,1.08fr)]"
                  : "grid h-full min-h-0 min-w-[760px] grid-cols-[minmax(128px,0.38fr)_minmax(280px,0.8fr)_minmax(350px,1.15fr)] xl:min-w-0 xl:grid-cols-[168px_minmax(300px,0.72fr)_minmax(420px,1.08fr)]"
                : "flex h-full min-h-0 w-full overflow-hidden"
            }
          >
        {/* 左：本片段挂载（随胶片切换）+ 本集其他 */}
        <aside
          data-manhua-column="assets"
          data-manhua-shot-mount={shotMount.mode}
          data-manhua-shot-mount-cast={String(mountedCastCount)}
          className={
            immersive
              ? "h-full min-h-0 overflow-y-auto border-r border-white/10 p-2"
              : "min-h-0 w-[180px] shrink-0 overflow-y-auto border-r border-white/10 p-2"
          }
        >
          {/*
            剧本本人的定妆与场景。这一栏原先只列题材原型（「雨夜江湖刀客」之类），
            剧本里的角色一张都不在，看着满满当当其实一张脸都没锁——
            成片于是每段自己捏一张，十段十个人。缺图的留可点占位格，就地补。
          */}
          {episodeSheetGallery.length || pendingSheetAnchors.length ? (
            <div data-manhua-storyboard-canon-assets className="mb-2.5 space-y-2">
              {CANON_SHEET_SECTIONS.map((sec) => {
                const items = episodeSheetGallery.filter((x) => x.kind === sec.kind);
                const pending = pendingSheetAnchors.filter((x) => x.kind === sec.kind);
                if (!items.length && !pending.length) return null;
                return (
                  <div key={sec.kind}>
                    <div className="text-[10px] font-semibold tracking-wide text-white/40">
                      {sec.titleZh} · {items.length}
                      {pending.length ? (
                        <span className="ml-1 text-amber-200/75">待出 {pending.length}</span>
                      ) : null}
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                      {items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          data-manhua-canon-sheet={item.id}
                          onClick={() => {
                            if (item.id) focusBlockAndOpenCanvas(item.id);
                          }}
                          className="overflow-hidden rounded-lg border border-emerald-300/40 bg-black/40 text-left hover:border-emerald-200/70"
                          title={`定位：${item.labelZh}`}
                        >
                          <img
                            src={item.url}
                            alt=""
                            className="aspect-square w-full object-cover object-top"
                            loading="lazy"
                          />
                          <div className="truncate px-1 py-0.5 text-[9px] text-white/80">
                            {item.labelZh}
                          </div>
                        </button>
                      ))}
                      {pending.map((p) => (
                        <button
                          key={p.anchorId}
                          type="button"
                          data-manhua-pending-anchor={p.anchorId}
                          disabled={factoryBusy || !onGenerateCanonAssetSheet}
                          onClick={() => {
                            void onGenerateCanonAssetSheet?.({
                              anchorId: p.anchorId,
                              nameZh: p.nameZh,
                            });
                          }}
                          className="overflow-hidden rounded-lg border border-dashed border-amber-300/45 bg-amber-500/[0.07] text-left hover:bg-amber-500/15 disabled:opacity-40"
                          title={
                            p.lookZh
                              ? `补这一张：${p.nameZh}｜${p.lookZh.slice(0, 60)}`
                              : `补这一张：${p.nameZh}`
                          }
                        >
                          <span className="flex aspect-square w-full items-center justify-center text-[14px] leading-none text-amber-100/80">
                            ＋
                          </span>
                          <div className="truncate px-1 py-0.5 text-[9px] font-semibold text-amber-50/90">
                            {p.nameZh}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

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

          {/*
            题材库内的通用道具（传家玉佩、金步摇发簪之类）。剧本自己有道具表时
            这一栏得让位：上面「关键道具」列的才是本剧要锁的那几件，两栏并排都叫
            「道具」只会让人以为库内那三件已经锁上了——它们跟这部戏没关系。
          */}
          {assetCanon?.props?.length ? null : (
          <>
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
          </>
          )}

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

        {/* 中：分镜图卡（阿硕 C2：图为主、文为辅；右栏才是主预览） */}
        <section
          data-manhua-column="script"
          className={
            immersive
              ? "flex h-full min-h-0 flex-col overflow-hidden border-r border-white/10 p-2 md:p-2.5"
              : "flex min-h-0 w-[min(28vw,300px)] shrink-0 flex-col overflow-hidden border-r border-white/10 p-2 md:p-2.5"
          }
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-white/85">
                第 {String(activeSegNo).padStart(2, "0")} 段
                {story?.episodeTitle ? ` · ${story.episodeTitle}` : ""}
                <span className="ml-2 font-normal text-white/40">
                  {activeSegment?.durationSec ?? 15}s · 静帧 {activeShot?.index ?? "—"}/
                  {shots.length || 1} · {episodeVideoLabelZh}
                </span>
              </div>
              {episodeStillCount === 0 ? (
                <div className="mt-1.5 flex max-w-xl flex-col gap-1.5">
                  {onSegmentIntentChange ? (
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-medium text-cyan-100/70">
                        本段意图（观众应感到什么）
                      </span>
                      <input
                        data-manhua-segment-intent={activeSegNo}
                        value={String(
                          activeSegment?.shots.find((s) => s.intentZh)?.intentZh ||
                            activeShot?.intentZh ||
                            shootablePlan.segments.find((s) => s.index === activeSegNo)
                              ?.intentZh ||
                            "",
                        )}
                        onChange={(e) => onSegmentIntentChange(activeSegNo, e.target.value)}
                        placeholder="例：压迫感逼近，旧盟从硬撑到松口"
                        className="w-full rounded-md border border-cyan-400/25 bg-black/40 px-2 py-1 text-[11px] text-white/85 placeholder:text-white/30"
                      />
                    </label>
                  ) : null}
                  {onSegmentCastChange ? (
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-medium text-cyan-100/70">
                        本段出场（写真名，用顿号分开）
                      </span>
                      <input
                        data-manhua-segment-cast={activeSegNo}
                        value={String(
                          shootablePlan.segments.find((s) => s.index === activeSegNo)?.castZh ||
                            inferManhuaCastZhFromDialogue(
                              "",
                              shootablePlan.segments.find((s) => s.index === activeSegNo)
                                ?.dialogueZh || "",
                            ) ||
                            "",
                        )}
                        onChange={(e) => onSegmentCastChange(activeSegNo, e.target.value)}
                        placeholder="例：苏文谦、苏照雪"
                        className="w-full rounded-md border border-cyan-400/25 bg-black/40 px-2 py-1 text-[11px] text-white/85 placeholder:text-white/30"
                      />
                      <span className="text-[9px] leading-4 text-white/35">
                        写资产库真名，成片才锁对人脸；只写「黑衣剑客」容易对错。
                      </span>
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-black/30 p-0.5">
              {(
                [
                  ["shots", "分镜"],
                  ["path", "运镜"],
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
              {/* 有静帧后收起文字墙，只留图卡 + 一行状态（阿硕 C2） */}
              {episodeStillCount > 0 ? (
                <div
                  data-manhua-visual-brief-gate
                  data-manhua-stills-ready={stillsReadyEnough ? "true" : "false"}
                  className="mt-1.5 flex shrink-0 flex-wrap items-center justify-between gap-1.5 rounded-md border border-cyan-400/25 bg-cyan-500/[0.06] px-2 py-1"
                >
                  <span className="text-[10px] text-cyan-50/85">
                    静帧 {episodeStillCount}/
                    {Math.max(expectedStillCount, 1)}
                    {stillsReadyEnough
                      ? " · 已垫图锁"
                      : keyartsPixelLocked
                        ? " · 垫图锁过·张数未齐"
                        : " · 待垫图改图"}
                    {episodeKeyarts.some((b) => b.status === "error")
                      ? ` · 失败 ${episodeKeyarts.filter((b) => b.status === "error").length}`
                      : ""}
                  </span>
                  <span className="text-[9px] text-white/35">点图卡 → 右栏居中</span>
                </div>
              ) : (
                <>
                  <p className="mh-hint mt-2 max-h-14 shrink-0 overflow-y-auto rounded-lg border border-white/8 bg-black/30 px-2.5 py-2 text-[11px] leading-relaxed text-white/55">
                    {(
                      story?.outputText ||
                      story?.prompt ||
                      topic ||
                      "铺板并跑过故事节点后，此处显示本集摘要。"
                    ).slice(0, 360)}
                  </p>

                  <div
                    data-manhua-visual-brief-gate
                    data-manhua-stills-ready="false"
                    className="mt-2 shrink-0 rounded-lg border border-cyan-400/30 bg-cyan-500/[0.07] px-2.5 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold text-cyan-50/90">视觉简报</div>
                      <span className="text-[9px] text-white/40">
                        {keyartsPixelLocked ? "垫图锁过·张数未齐" : "待垫图改图"} · 静帧 0/
                        {Math.max(expectedStillCount, 1)}
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
                </>
              )}
              <div className="mt-2 shrink-0 text-[11px] font-semibold text-white/70">
                分镜（{shots.length}）· 当前第 {activeShot?.index ?? "—"} 镜
              </div>
              <div className="mt-1.5 min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
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
                      className={`w-full overflow-hidden rounded-lg border text-left transition ${
                        on
                          ? "border-cyan-300/70 bg-cyan-500/15 ring-1 ring-cyan-300/50"
                          : "border-white/10 bg-white/[0.03] hover:border-white/25"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => selectShotAndFocusCanvas(i)}
                        className="block w-full text-left"
                        title="选中本镜并在画布高亮对应节点"
                      >
                        <div
                          className={`relative aspect-[3/4] w-full overflow-hidden bg-amber-500/10 ${
                            keyartFailed || keyartUnlocked
                              ? "ring-1 ring-inset ring-red-400/55"
                              : ""
                          }`}
                          title={
                            keyartUnlocked
                              ? "有图但未垫图改图（缺参考图或非改图模式），不能出成片；请重出该镜静帧"
                              : undefined
                          }
                        >
                          {thumb ? (
                            <>
                              <img
                                src={thumb}
                                alt=""
                                className="h-full w-full object-cover"
                                onError={(e) => {
                                  const el = e.currentTarget;
                                  if (el.dataset.localRetry === "1") return;
                                  el.dataset.localRetry = "1";
                                  const id = shotKey?.id;
                                  if (!id) return;
                                  void tryLocalMediaDisplayForBlock(id, "output").then((local) => {
                                    if (local) el.src = local;
                                  });
                                }}
                              />
                              {keyartUnlocked ? (
                                <span className="absolute inset-x-0 bottom-0 bg-red-900/80 px-1 py-0.5 text-center text-[9px] font-semibold text-red-50">
                                  未垫图锁
                                </span>
                              ) : (
                                <span className="absolute left-1 top-1 rounded bg-emerald-600/90 px-1 py-px text-[8px] font-semibold text-white">
                                  已锁
                                </span>
                              )}
                            </>
                          ) : keyartFailed ? (
                            <div className="flex h-full items-center justify-center text-[11px] font-semibold text-red-100/90">
                              失败
                            </div>
                          ) : keyartRunning ? (
                            <div className="flex h-full items-center justify-center text-[11px] text-amber-100/80">
                              出图中…
                            </div>
                          ) : (
                            <div className="flex h-full flex-col items-center justify-center gap-1 text-amber-100/80">
                              <span className="text-[14px] font-semibold">
                                {String(shot.index).padStart(2, "0")}
                              </span>
                              <span className="text-[9px]">待出分镜图</span>
                            </div>
                          )}
                        </div>
                        <div className="space-y-0.5 px-1.5 py-1.5">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[11px] font-semibold text-white/90">
                              分镜 {String(shot.index).padStart(2, "0")}
                            </span>
                            {on ? (
                              <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
                            ) : null}
                          </div>
                          <div className="truncate text-[9px] text-cyan-100/65">
                            {(() => {
                              const ang = getManhuaCameraAngle(shotAngleByIndex[shot.index]);
                              return ang
                                ? `${ang.nameZh} · ${shot.cameraZh}`
                                : shot.cameraZh;
                            })()}
                          </div>
                          <div className="line-clamp-1 text-[10px] leading-snug text-white/60">
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
                          className="flex w-full items-center justify-center gap-1 border-t border-white/10 py-1 text-[9px] text-amber-100/75 hover:bg-amber-500/10 disabled:opacity-35"
                          title={`只重出第 ${shot.index} 镜，保留其他镜头`}
                        >
                          <RefreshCw className="h-3 w-3" />
                          单镜重出
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <p className="mh-hint mt-2 text-[10px] leading-snug text-white/35">
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
                      {(() => {
                        const p = String(row.clip?.prompt || "");
                        const hasPad =
                          Boolean(String(row.clip?.refImageUrl || "").trim()) ||
                          /【垫图】|【像素垫图锁/.test(p);
                        const hasAssetLock = /【资产·Image对照】|【资产】|【资产锁/.test(p);
                        const hasDuty = /【参考职责】/.test(p);
                        const tags = p.match(/@(?:角色|场景|道具)\d+/g) || [];
                        // @引用断链检查：@图NN/@音N/@板N 指到不存在的实体就标红，
                        // 出片前一眼可见，绝不静默跳过（shared 解析器同源）
                        const atRefMissing = resolveManhuaAtReferences({
                          text: p,
                          index: buildManhuaAtReferenceIndex({
                            registry: assetLockRegistry,
                            boardUrlByEpisode: directorBoardMainUrl
                              ? { [focusEpisode]: directorBoardMainUrl }
                              : null,
                          }),
                          registry: assetLockRegistry,
                        }).missing;
                        const voiceGate = evaluateManhuaCrossSegmentVoiceGate({
                          localSegmentIndex: row.segmentIndex,
                          currentPrompt: p,
                          episodeSegmentPrompts:
                            collectManhuaEpisodeSegmentPromptsForVoiceGate(
                              blocks,
                              focusEpisode,
                            ),
                          voiceLocks: characterVoiceLocks,
                        });
                        return (
                          <div
                            data-manhua-clip-lock-chips={row.segmentIndex}
                            className="mb-1 flex flex-wrap gap-1"
                          >
                            <span
                              className={`rounded px-1 py-px text-[8px] font-semibold ${
                                hasPad
                                  ? "bg-emerald-500/25 text-emerald-50"
                                  : "bg-red-500/25 text-red-50"
                              }`}
                            >
                              {hasPad ? "垫图锁✓" : "垫图锁缺失"}
                            </span>
                            <span
                              className={`rounded px-1 py-px text-[8px] font-semibold ${
                                hasAssetLock
                                  ? "bg-emerald-500/25 text-emerald-50"
                                  : "bg-amber-500/20 text-amber-50"
                              }`}
                            >
                              {hasAssetLock ? "Image对照✓" : "Image对照缺失"}
                            </span>
                            {atRefMissing.map((t) => (
                              <span
                                key={`at-missing-${t}`}
                                title={`@${t} 指到的资产不存在（可能已删除或敲错）；出片前请修正或删掉这个引用`}
                                className="rounded bg-red-500/30 px-1 py-px text-[8px] font-semibold text-red-50"
                              >
                                @{t} 断链
                              </span>
                            ))}
                            <span
                              className={`rounded px-1 py-px text-[8px] font-semibold ${
                                voiceGate.requiredTags.length === 0
                                  ? "bg-white/10 text-white/45"
                                  : voiceGate.missingTags.length === 0
                                    ? "bg-emerald-500/25 text-emerald-50"
                                    : "bg-white/10 text-white/45"
                              }`}
                              title={
                                voiceGate.requiredTags.length
                                  ? voiceGate.missingTags.length === 0
                                    ? `已挂声线：${voiceGate.requiredTags.join("、")}`
                                    : voiceGate.messageZh || "声线可选，缺音不挡出片"
                                  : "声线可选；初登场常无参考音"
                              }
                            >
                              {voiceGate.requiredTags.length === 0
                                ? "声线·可选"
                                : voiceGate.missingTags.length === 0
                                  ? "声线已挂"
                                  : "声线未挂·不挡"}
                            </span>
                            <span
                              className={`rounded px-1 py-px text-[8px] font-semibold ${
                                hasDuty
                                  ? "bg-emerald-500/25 text-emerald-50"
                                  : "bg-white/10 text-white/45"
                              }`}
                            >
                              {hasDuty ? "参考职责✓" : "参考职责—"}
                            </span>
                            {tags.slice(0, 6).map((t) => (
                              <span
                                key={`${row.segmentIndex}-${t}`}
                                className="rounded border border-cyan-400/30 bg-cyan-500/10 px-1 py-px font-mono text-[8px] text-cyan-50/90"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                      {(() => {
                        const promptText = String(row.clip?.prompt || "").replace(
                          /\n*【引擎光学】[^\n]*/g,
                          "",
                        );
                        const raw = rawPromptSegments.has(row.segmentIndex);
                        return (
                          <>
                            <div className="mb-1 flex items-center justify-end">
                              <button
                                type="button"
                                data-manhua-prompt-view={raw ? "raw" : "chips"}
                                onClick={() =>
                                  setRawPromptSegments((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(row.segmentIndex)) {
                                      next.delete(row.segmentIndex);
                                    } else {
                                      next.add(row.segmentIndex);
                                    }
                                    return next;
                                  })
                                }
                                className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] text-white/55 hover:bg-white/5"
                              >
                                {raw ? "看药丸视图" : "编辑原文"}
                              </button>
                            </div>
                            {raw ? (
                              <ManhuaPromptMentionEditor
                                segmentIndex={row.segmentIndex}
                                disabled={
                                  !row.clip?.id || !onUpdateClipPrompt || factoryBusy
                                }
                                value={promptText}
                                onChange={(next) => {
                                  if (row.clip?.id) onUpdateClipPrompt?.(row.clip.id, next);
                                }}
                                thumbUrlByAssetId={chipThumbByAssetId}
                                registry={assetLockRegistry}
                                assetCanon={assetCanon}
                                onRequestGenerateAsset={(c) => {
                                  toast.info(`「${c.labelZh}」还没有定妆图`, {
                                    description: "正在按剧本补这一张，出图后回来敲 @ 就能挂上",
                                  });
                                  void onConfirmAssetsAndPrepareImages?.();
                                }}
                                boardCandidate={
                                  directorBoardMainUrl
                                    ? {
                                        tag: `@板${focusEpisode}`,
                                        labelZh: `第${String(focusEpisode).padStart(2, "0")}集导演板（轨迹参考）`,
                                        thumbUrl: directorBoardMainUrl,
                                      }
                                    : null
                                }
                                placeholder={
                                  row.clip?.id
                                    ? "段成片提示词（输入 @ 挑本集人物/场景/道具/导演板）"
                                    : "点「审阅」时会先铺段节点；若仍空请对齐画布竖排"
                                }
                              />
                            ) : (
                              <ManhuaPromptAssetChips
                                prompt={promptText}
                                thumbUrlByAssetId={chipThumbByAssetId}
                                className="rounded border border-white/10 bg-black/30 px-1.5 py-1"
                              />
                            )}
                          </>
                        );
                      })()}
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
              <p className="mh-hint mt-2 text-[10px] leading-snug text-white/35">
                粗剪排序；剪辑阶段可细剪、字幕、质检返工，并勾选进成片坞。
              </p>
            </div>
          ) : (
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
              <p className="mh-hint text-[10px] leading-snug text-white/45">
                预设运镜配方（文字描述，交模型解读；不再靠手绘轨迹）
              </p>
              {onPathRecipeIdChange ? (
                <ManhuaPathRecipePicker
                  compact
                  pathRecipeId={pathRecipeId}
                  actionRecipeId={actionRecipeId}
                  disabled={!canRun || factoryBusy}
                  onPathRecipeIdChange={onPathRecipeIdChange}
                  onActionRecipeIdChange={onActionRecipeIdChange}
                />
              ) : (
                <p className="mh-hint rounded-lg border border-white/10 bg-black/30 px-3 py-4 text-[11px] text-white/40">
                  运镜配方未接线
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
              ? "flex h-full min-h-0 flex-col p-1.5 md:p-2"
              : showCanvasDock
                ? "flex min-h-0 min-w-0 flex-1 flex-col p-2"
                : "flex min-h-0 w-[min(42vw,480px)] shrink-0 flex-col p-2 md:p-2.5"
          }
        >
          <div className="mb-1.5 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-white/90">
              {showCanvasDock ? "本集画布（主预览）" : previewIsVideo || finalVideoUrl ? "视频结果" : "预览"}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(() => {
                /**
                 * 当前预览的产物：成片优先，否则静帧。
                 *
                 * 不看画布坞开没开：分镜阶段主预览是常开的，若按坞状态收起
                 * 按钮，最常用的那个状态反而永远下不了。
                 */
                const dlUrl = String(finalVideoUrl || previewUrl || "").trim();
                if (/^https?:\/\//i.test(dlUrl)) {
                  const isVid = Boolean(finalVideoUrl || previewIsVideo);
                  return (
                    <button
                      type="button"
                      data-manhua-action="download-preview"
                      disabled={downloadBusy}
                      onClick={async () => {
                        setDownloadBusy(true);
                        try {
                          const base = `${seriesTitle || topic || "漫剧"}-第${String(
                            focusEpisode,
                          ).padStart(2, "0")}集-第${String(activeSegNo).padStart(2, "0")}段`;
                          const r = await downloadRemoteFile(dlUrl, base);
                          if (r.via === "fallback") {
                            toast.message("已在新标签页打开", {
                              description: "直接下载被浏览器拦下，请在新页面右键另存。",
                            });
                          } else {
                            toast.success(isVid ? "开始下载成片" : "开始下载静帧");
                          }
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "下载失败");
                        } finally {
                          setDownloadBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-400/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-50 hover:bg-emerald-500/25 disabled:opacity-40"
                      title={isVid ? "下载本段成片" : "下载这张静帧"}
                    >
                      <Download className="h-3 w-3" />
                      {downloadBusy ? "下载中" : "下载"}
                    </button>
                  );
                }
                return null;
              })()}
              {dockCanvas ? (
                showCanvasDock ? (
                  activePhase === "storyboard" && episodeStillCount > 0 ? (
                    <span className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100/80">
                      主预览常开
                    </span>
                  ) : (
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
                  )
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
            <p className="mh-hint mt-1.5 shrink-0 text-[10px] leading-snug text-white/40">
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
                onClick={() => {
                  if (onOpenClipDock) {
                    onOpenClipDock();
                    return;
                  }
                  document.querySelector("#manhua-clip-dock-zone")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                }}
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
        </div>

      {/* 底胶片挂在分镜面板内，避免与三栏抢 shell 高度把画布压成 ~28px */}
      <div
        data-manhua-filmstrip
        data-manhua-keyart-ready={episodeKeyarts.filter((b) => mediaUrl(b)).length}
        data-manhua-shot-count={Math.max(episodeKeyarts.length, shots.length, 1)}
        className="max-h-[132px] shrink-0 overflow-hidden border-t border-white/10 bg-[#080b12] px-2.5 py-1 md:px-3"
      >
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="text-[11px] font-semibold text-white/75">
              成片段
              <span className="ml-1 text-[9px] font-normal text-white/40">
                {filmstripSegments.length} 段 · 共 {totalSec}s · 一格一次出片
              </span>
              {missingFragmentIndexes.length ? (
                <span className="ml-1.5 text-[9px] font-normal text-amber-100/70">
                  缺 {missingFragmentIndexes.length} 段
                </span>
              ) : (
                <span className="ml-1.5 text-[9px] font-normal text-emerald-100/60">齐</span>
              )}
              {selectedSegmentCount ? (
                <span className="ml-1.5 text-[9px] font-normal text-cyan-100/70">
                  已选 {selectedSegmentCount} 段
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
              {Math.max(expectedStillCount, 1)}
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
          {filmstripSegments.map((seg) => {
            // 质检通过 / 仍采用 都是「已出片」判定，只能认真实产出，不能吃垫图
            const clipUrl = clipOutputUrl(seg.clip);
            const qc = seg.clip?.manhuaClipQuality;
            const clipPassed = seg.clip?.status === "done" && qc?.status === "passed" && Boolean(clipUrl);
            const clipAccepted =
              qc?.status === "failed" && qc.userAcceptedDespiteQc && Boolean(clipUrl);
            const clipFailed = qc?.status === "failed" && !clipAccepted;
            const stillsShort = seg.stillReady < seg.shotCount;
            // 有图但未垫图改图 → 出片会跑偏，先重出该段静帧
            const hasUnlocked = seg.unlockedCount > 0;
            const on = seg.index === activeSegNo;
            const checked =
              seg.shotIndexes.length > 0 &&
              seg.shotIndexes.every((n) => selectedShotIndexes.includes(n));
            const statusLabel = clipPassed
              ? "片✓"
              : clipAccepted
                ? "已采用"
                : clipFailed
                  ? "质检"
                  : hasUnlocked
                    ? "未锁"
                    : stillsShort
                      ? "缺静帧"
                      : "待出片";
            const statusTone = clipPassed
              ? "bg-emerald-500/90 text-white"
              : clipAccepted
                ? "bg-amber-500/85 text-black"
                : clipFailed
                  ? "bg-rose-500/90 text-white"
                  : hasUnlocked
                    ? "bg-red-800/85 text-red-50"
                    : "bg-amber-500/85 text-black";
            return (
              <div
                key={`seg-${seg.index}`}
                data-manhua-filmstrip-segment={seg.index}
                data-manhua-active={on ? "true" : "false"}
                data-manhua-fragment-checked={checked ? "true" : "false"}
                data-manhua-fragment-status={
                  clipPassed
                    ? "clip"
                    : clipFailed
                      ? "qc-failed"
                      : hasUnlocked
                        ? "keyart-unlocked"
                        : stillsShort
                          ? "idle"
                          : "keyart"
                }
                className={`relative w-[132px] shrink-0 overflow-hidden rounded-md border text-left ${
                  checked
                    ? "border-cyan-300/70 ring-1 ring-cyan-400/45"
                    : on
                      ? "border-white/70 ring-1 ring-white/40"
                      : clipPassed
                        ? "border-emerald-400/35"
                        : clipAccepted || clipFailed
                          ? "border-amber-400/40"
                          : "border-white/12"
                }`}
              >
                <label
                  className="absolute right-1 top-1 z-10 flex h-4 w-4 cursor-pointer items-center justify-center rounded border border-white/30 bg-black/65"
                  title="勾选整段，可批量「生成所选成片」"
                >
                  <input
                    type="checkbox"
                    data-manhua-fragment-check={seg.index}
                    checked={checked}
                    onChange={() => toggleSegmentSelected(seg.shotIndexes)}
                    className="h-3 w-3 accent-cyan-400"
                  />
                </label>
                <button
                  type="button"
                  data-manhua-keyart-url={seg.thumb || ""}
                  onClick={() => selectSegmentAndFocusCanvas(seg.shotIndexes)}
                  className="block w-full text-left"
                  title={
                    hasUnlocked
                      ? "本段有静帧未垫图改图，出成片会跑偏；请重出该段静帧"
                      : "选中本段并在画布高亮对应成片节点"
                  }
                >
                  <div
                    className={`relative aspect-video ${
                      seg.thumb
                        ? "bg-black/70"
                        : "border border-dashed border-amber-400/30 bg-amber-500/10"
                    }`}
                  >
                    {seg.thumb ? (
                      <img src={seg.thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-0.5 text-amber-100/85">
                        <span className="text-[11px] font-semibold">
                          第{String(seg.index).padStart(2, "0")}段
                        </span>
                        <span className="text-[8px]">待出静帧</span>
                      </div>
                    )}
                    <span
                      className={`absolute left-1 top-1 rounded px-1 py-0.5 text-[8px] font-semibold ${statusTone}`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-1 py-0.5 text-[9px] text-white/70">
                    <span className="font-semibold">
                      第{String(seg.index).padStart(2, "0")}段
                    </span>
                    <span className="text-white/45">{seg.durationSec}s</span>
                  </div>
                  {seg.sceneZh ? (
                    <div
                      className="truncate px-1 text-[8px] text-cyan-100/60"
                      title={seg.sceneZh}
                    >
                      {seg.sceneZh}
                    </div>
                  ) : null}
                  <div className="border-t border-white/8 px-1 py-0.5 text-[8px] text-white/45">
                    静帧 {seg.stillReady}/{Math.max(seg.shotCount, 1)}
                    {hasUnlocked ? ` · ${seg.unlockedCount} 未锁` : ""}
                  </div>
                </button>
                {!clipPassed && onGenerateFragment ? (
                  <button
                    type="button"
                    data-manhua-action="retry-fragment"
                    data-manhua-retry-segment={seg.index}
                    disabled={Boolean(factoryBusy)}
                    onClick={() => {
                      if (refuseIfBlocked(clipGateHint)) return;
                      setActivePhase("storyboard");
                      selectSegmentAndFocusCanvas(seg.shotIndexes);
                      onGenerateFragment({
                        shotIndex: seg.index,
                        keyartId: seg.firstKeyartId || undefined,
                        clipId: seg.clip?.id,
                      });
                    }}
                    className="w-full border-t border-white/10 bg-white/[0.04] py-0.5 text-[8px] font-semibold text-cyan-100/80 hover:bg-cyan-500/15 disabled:opacity-35"
                    title={`生成第 ${seg.index} 段成片（约 ${seg.durationSec}s）`}
                  >
                    {clipUrl ? "重出本段成片" : "生成本段成片"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        {/* 集缩略：沉浸分镜隐藏，避免再吃底栏高度；非沉浸宽屏仍显示 */}
        <div
          className={
            immersive
              ? "hidden"
              : "mt-2 hidden gap-1.5 overflow-x-auto border-t border-white/5 pt-2 sm:flex"
          }
        >
          {episodeIndexes.map((ep) => {
            const epKeys = keyartsForEpisode(blocks, ep);
            const epClips = blocks.filter(
              (b) => b.id.startsWith("clip-") && (getBlockEpisodeIndex(b) ?? 1) === ep,
            );
            // 集级 ready 只认真实产出
            const epClipReady = epClips.find(
              (b) =>
                b.status === "done" &&
                b.manhuaClipQuality?.status === "passed" &&
                Boolean(clipOutputUrl(b)),
            );
            const clipReady = Boolean(epClipReady);
            const clipFailed = epClips.some((b) => b.manhuaClipQuality?.status === "failed");
            // 缩略图可以退静帧，但退的是静帧本身，不让垫图反过来参与上面的完成判定
            const thumb =
              (epClipReady ? clipOutputUrl(epClipReady) : undefined) ||
              epKeys.map(mediaUrl).find(Boolean);
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
    </div>
  );
}
