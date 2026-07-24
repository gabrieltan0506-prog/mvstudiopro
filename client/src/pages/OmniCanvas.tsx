import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Navbar from "@/components/Navbar";
import FreeformCanvas from "@/components/canvas/FreeformCanvas";
import ManhuaClipDock from "@/components/canvas/ManhuaClipDock";
import type { CanvasBlock, CanvasEdge } from "@/lib/canvasTypes";
import { defaultCanvasBlock, makeCanvasBlockId, normalizeCanvasBlock } from "@/lib/canvasTypes";
import { runCanvasBlock, type CanvasRunDeps } from "@/lib/canvasRunBlock";
import {
  evaluateManhuaAssetImageGate,
  planManhuaAssetImageSpawns,
} from "@shared/manhuaAssetImageGate";
import {
  buildManhuaCustomAssetGenFromLibraryPrompt,
  defaultManhuaCustomAssetRefDuty,
  makeManhuaCustomAssetId,
  normalizeManhuaCustomAssetRefs,
  upsertGeneratedManhuaCustomAssetRef,
  type ManhuaCustomAssetRef,
  type ManhuaCustomAssetRefDuty,
  type ManhuaCustomAssetRole,
} from "@shared/manhuaCustomAssetRefs";
import {
  collectStaleAssetSheetBlockIds,
  evaluateManhuaAssetScriptAlignment,
  purgeStaleCustomAssetRefsForCanon,
} from "@shared/manhuaAssetScriptSync";
import { resolveManhuaCustomAssetSeed } from "@shared/manhuaCustomAssetSeed";
import { absolutizeManhuaAssetUrl } from "@shared/manhuaKeyartEditFusion";
import {
  buildManhuaAssetLockRegistry,
  buildManhuaAssetPathById,
} from "@shared/manhuaAssetLockRegistry";
import {
  normalizeManhuaCharacterLookSets,
  normalizeManhuaSegmentLookBindings,
} from "@shared/manhuaCharacterLookSets";
import {
  formatManhuaFactoryUserError,
  manhuaFactoryStageLabelFromBlockId,
} from "@shared/manhuaFactoryUserErrors";
import {
  countManhuaKeyartProgress,
  formatManhuaKeyartProgressZh,
} from "@shared/manhuaKeyartProgress";
import {
  MANHUA_ASSET_SHARE_CONSENT_HINT_ZH,
  MANHUA_ASSET_STILL_FULL_CREDITS,
  MANHUA_ASSET_STILL_SHARE_HALF_CREDITS,
  manhuaAssetStillPriceLabelZh,
} from "@shared/manhuaAssetSharePricing";
import { uploadCanvasFilesParallel } from "@/lib/canvasUpload";
import {
  MANHUA_FACTORY_STAGE_LABEL_ZH,
  MANHUA_FACTORY_STAGE_ORDER,
  MANHUA_SERIES_SPAWN_MAX,
  applyFactoryPrefsToBlocks,
  applyTopicToFactoryStory,
  filterBlocksByEpisode,
  getBlockEpisodeIndex,
  isTransientFactoryError,
  manhuaEpisodeHasFactoryChain,
  replaceManhuaEpisodeChain,
  resolveFactoryResumeStage,
  resolveManhuaEpisodeSpawnContinuity,
  ensureManhuaFragmentClips,
  layoutManhuaEpisodeReadableChain,
  collectManhuaCharacterSheetUrlById,
  collectManhuaEpisodeSegmentPromptsForVoiceGate,
  countExpectedManhuaKeyartShots,
  runManhuaDramaFactoryPipeline,
  sanitizeManhuaClipBlocksPrompts,
  sanitizeManhuaRecapUpstreamLinks,
  spawnManhuaDramaStudio,
  spawnManhuaDramaStudioSeries,
  stageKeyFromBlockId,
  stripManhuaFactoryCanvasArtifacts,
  type ManhuaFactoryStageKey,
} from "@/lib/canvasDramaStudio";
import {
  collectManhuaClipDockItems,
  episodeIndexesFromDockSelection,
} from "@/lib/manhuaProjectExport";
import { shouldAttachManhuaPreviouslyOn } from "@shared/manhuaEpisodeRecap";
import {
  resolveClipLocalSegmentIndex,
  resolveClipSegmentIndex,
  resolveKeyartShotIndex,
  resolveSegmentIndexFromShotIndex,
} from "@shared/manhuaScriptWorkbench";
import { extractManhuaSceneHintFromPrompt } from "@shared/manhuaClipDialogueTimeline";
import { upsertShotAngleSection } from "@shared/manhuaShotAnglePersist";
import { upsertShotDialogueSection } from "@shared/manhuaShotDialoguePersist";
import {
  listScreenwriterGenres,
  MANHUA_SCENE_GENRE_LABEL_ZH,
  recommendManhuaSceneIdFromTopic,
} from "@shared/screenwriterGenreTemplates";
import { getManhuaSceneTemplate, listManhuaScenes } from "@shared/manhuaSceneAssetLibrary";
import {
  DEFAULT_MANHUA_ART_STYLE_ID,
  buildManhuaCharacterSheetGenPrompt,
  getManhuaArtStylePreset,
  recommendManhuaArtStyleFromTopic,
  type ManhuaArtStyleId,
  type ManhuaCharacterGender,
} from "@shared/manhuaCharacterAssetLibrary";
import { recommendManhuaCastBundle } from "@shared/manhuaCastBundle";
import {
  buildManhuaProjectBible,
  summarizeManhuaProjectBible,
  type ManhuaProjectBible,
} from "@shared/manhuaProjectBible";
import {
  evaluateWriterPackAssetAndDensity,
  formatWriterAssetCanonFactoryAddon,
  formatWriterAssetCanonIdentityLock,
} from "@shared/manhuaWriterAssetCanon";
import {
  loadManhuaWriterSessionFromStorage,
  saveManhuaWriterSessionToStorage,
} from "@shared/manhuaWriterSession";
import {
  makeManhuaCharacterVoiceLockId,
  normalizeManhuaCharacterVoiceLocks,
  type ManhuaCharacterVoiceLock,
} from "@shared/manhuaCharacterVoiceLock";
import { extractManhuaClipAudio } from "@/lib/manhuaCharacterVoiceApi";
import type { ManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import {
  MANHUA_CLOUD_DRAFT_SYNC_DEBOUNCE_MS,
  buildLocalCloudDraftSnapshot,
  chooseManhuaDraftHydrate,
  cloudDraftBlocksToCanvas,
  persistManhuaDraftLocally,
  readLocalDraftPartsForHydrate,
  repairLocalFromCloudDraft,
  serializeCloudDraftForUpload,
  trySaveLocalCanvas,
  trySaveLocalClientUpdatedAt,
  uploadManhuaCloudDraftViaGcsDirect,
} from "@/lib/manhuaCloudDraftSync";
import {
  loadManhuaShotContinuityPrefs,
  saveManhuaShotContinuityPrefs,
  type ManhuaShotContinuityPrefs,
} from "@shared/manhuaShotContinuity";
import {
  MANHUA_ASSEMBLE_MUSIC_DURATION_SEC,
  summarizeManhuaPathTrackStatus,
} from "@shared/manhuaFinalAssemble";
import { buildManhuaAssembleJobInput } from "@shared/manhuaAssembleJobInput";
import ManhuaCharacterGallery from "@/components/ManhuaCharacterGallery";
import ManhuaGuidedPathRail from "@/components/ManhuaGuidedPathRail";
import ManhuaCastStrip from "@/components/ManhuaCastStrip";
import ManhuaLiveProgressBoard from "@/components/ManhuaLiveProgressBoard";
import ManhuaScriptWorkbench from "@/components/ManhuaScriptWorkbench";
import ManhuaAssetWall from "@/components/ManhuaAssetWall";
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";
import { createJobSameOrigin, pollJobUntilTerminal } from "@/lib/jobs";
import {
  MOTION_PROMPT_BANK,
  MOTION_PROMPT_CATEGORY_LABEL_ZH,
  recommendMotionPromptFromTopic,
  type MotionPromptCategory,
} from "@shared/motionPromptBank";
import {
  CRAFT_SHOT_BANK,
  CRAFT_SHOT_CATEGORY_LABEL_ZH,
  getCraftShotById,
  recommendCraftShotFromTopic,
  type CraftShotCategory,
} from "@shared/craftShotBank";
import { recommendPathCameraFromTopic } from "@shared/manhuaPathCameraRecipeBank";
import {
  getNarrativeLightingById,
  listNarrativeLighting,
  recommendNarrativeLightingFromTopic,
} from "@shared/manhuaNarrativeLightingBank";
import {
  buildMaleHairstyleInjectBlock,
  listMaleHairstylePresets,
} from "@shared/manhuaMaleHairstylePresetBank";
import {
  buildMaleMicroExpressionInjectBlock,
  listMaleMicroExpressions,
  recommendMaleMicroExpressionFromTopic,
} from "@shared/manhuaMaleMicroExpressionBank";
import { listPromoCoverLayouts } from "@shared/manhuaPromoCoverLayouts";
import { recommendActionCameraFromTopic } from "@shared/manhuaActionCameraRecipeBank";
import {
  MANHUA_CINE_VOCAB_BANK,
  MANHUA_CINE_VOCAB_LOCALE_LABEL_ZH,
  type ManhuaCineVocabLocale,
} from "@shared/manhuaCineVocabBank";
import {
  normalizeManhuaDeliveryPackage,
  type ManhuaDeliveryPackage,
} from "@shared/manhuaDeliveryPackage";
import {
  parseManhuaEpisodeSegmentPlanFromMarkdown,
  upsertManhuaSegmentIntentInMarkdown,
} from "@shared/manhuaEpisodeSegmentPlan";
import {
  patchPromptForRetakeVariable,
  type ManhuaRetakeVariable,
} from "@shared/manhuaDirectingWorkflow";
import { listWardrobePropContinuity } from "@shared/manhuaWardrobePropContinuity";
import type { ManhuaPathAnnotation } from "@shared/manhuaPathCameraAnnotate";
import ManhuaPathCameraAnnotatePanel from "@/components/ManhuaPathCameraAnnotatePanel";
import ManhuaFactoryDebugPanel, {
  type ManhuaFactoryDebugEntry,
  type ManhuaFactoryDebugLevel,
} from "@/components/canvas/ManhuaFactoryDebugPanel";
import type { VideoReverseOutputMode } from "@shared/videoReversePrompt";
import {
  MANHUA_WRITER_EPISODE_DEFAULT,
  MANHUA_WRITER_EPISODE_MAX,
  MANHUA_WRITER_EPISODE_MIN,
  clampWriterEpisodeCount,
  composeWriterPackFactoryContext,
  deriveSeriesTitleFromTopic,
  importManhuaWriterPackFromText,
  isPlaceholderSeriesTitle,
  writerPackLooksReady,
  type ManhuaWriterPack,
} from "@shared/manhuaWriterRoom";
import {
  getManhuaViralTemplate,
  listApprovedManhuaViralTemplatesGrouped,
  type ManhuaViralTemplateCard,
  type ManhuaViralTemplateLane,
} from "@shared/manhuaViralTemplateBank";
import { useAuth } from "@/_core/hooks/useAuth";
import { hasSupervisorAccess } from "@/lib/supervisorAccess";
import {
  MANHUA_SCREENWRITER_TERRA_MODEL,
  MANHUA_SCREENWRITER_TRANSLATE_BRIEF,
} from "@shared/manhuaScreenwriterTranslate";
import { trpc } from "@/lib/trpc";
import { Clapperboard, FileUp, LayoutTemplate, Loader2, Play, Sparkles, Square, X } from "lucide-react";
import { toast } from "sonner";

const MANHUA_FACTORY_DEBUG_MAX = 80;

const LS_KEY = "mv-freeform-canvas-v1";
const LS_FACTORY_PREFS_KEY = "mv-manhua-factory-character-prefs-v1";
const LS_CANVAS_MODE_KEY = "mv-canvas-workspace-mode-v1";

type CanvasWorkspaceMode = "pick" | "manhua" | "freeform";

function loadCanvasWorkspaceMode(): CanvasWorkspaceMode {
  try {
    const raw = localStorage.getItem(LS_CANVAS_MODE_KEY);
    if (raw === "manhua" || raw === "freeform" || raw === "pick") return raw;
  } catch {
    /* ignore */
  }
  return "pick";
}

type FactoryCharacterPrefs = {
  topic?: string;
  femaleId?: string;
  maleId?: string;
  artStyleId?: ManhuaArtStyleId;
  femaleLeadManual?: boolean;
  maleLeadManual?: boolean;
  artStyleManual?: boolean;
};

function loadCanvasState(): { blocks: CanvasBlock[]; edges: CanvasEdge[] } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { blocks: [], edges: [] };
    const parsed = JSON.parse(raw) as { blocks?: CanvasBlock[]; edges?: CanvasEdge[] };
    return {
      blocks: (parsed.blocks || []).map(normalizeCanvasBlock),
      edges: parsed.edges || [],
    };
  } catch {
    return { blocks: [], edges: [] };
  }
}

function saveCanvasState(blocks: CanvasBlock[], edges: CanvasEdge[]) {
  // 本机瘦身：去视频/blob；配额失败时再降级（见 trySaveLocalCanvas）
  trySaveLocalCanvas(blocks, edges);
}

function loadFactoryCharacterPrefs(): FactoryCharacterPrefs {
  try {
    const raw = localStorage.getItem(LS_FACTORY_PREFS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as FactoryCharacterPrefs;
  } catch {
    return {};
  }
}

function saveFactoryCharacterPrefs(prefs: FactoryCharacterPrefs) {
  try {
    localStorage.setItem(LS_FACTORY_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

/** 本机编剧会话（剧情包 / 确认态 / Bible）；硬刷新恢复，避免线上重扩 */
function bootWriterSession() {
  return loadManhuaWriterSessionFromStorage();
}

export default function OmniCanvas() {
  const { user } = useAuth({ redirectOnUnauthenticated: false });
  const [supervisorAccess] = useState(() => hasSupervisorAccess());
  const canShowCanvasDebug =
    supervisorAccess || user?.role === "admin" || user?.role === "supervisor";
  const [debugMode, setDebugMode] = useState(false);
  const [debugLog, setDebugLog] = useState<ManhuaFactoryDebugEntry[]>([]);
  const stageStartedAtRef = useRef<number | null>(null);

  const pushDebug = useCallback(
    (
      op: string,
      opts?: {
        level?: ManhuaFactoryDebugLevel;
        detail?: string;
        ms?: number;
        request?: string;
        response?: string;
      },
    ) => {
      if (!canShowCanvasDebug) return;
      const entry: ManhuaFactoryDebugEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: Date.now(),
        level: opts?.level || "info",
        op,
        detail: opts?.detail,
        ms: opts?.ms,
        request: opts?.request,
        response: opts?.response,
      };
      setDebugLog((prev) => [entry, ...prev].slice(0, MANHUA_FACTORY_DEBUG_MAX));
    },
    [canShowCanvasDebug],
  );

  useEffect(() => {
    if (!canShowCanvasDebug && debugMode) setDebugMode(false);
  }, [canShowCanvasDebug, debugMode]);

  const initial = useMemo(() => loadCanvasState(), []);
  const initialFactoryPrefs = useMemo(() => loadFactoryCharacterPrefs(), []);
  const initialWriterSession = useMemo(() => bootWriterSession(), []);

  useEffect(() => {
    if (!initialWriterSession?.writerPack && !initialWriterSession?.projectBible) return;
    pushDebug("writerSession:restore", {
      level: "ok",
      detail: [
        initialWriterSession.writerPack
          ? `${initialWriterSession.writerPack.seriesTitle}·${initialWriterSession.writerPack.episodes.length}ep`
          : "noPack",
        `confirmed=${Boolean(initialWriterSession.writerConfirmed)}`,
        `bible=${summarizeManhuaProjectBible(initialWriterSession.projectBible)}`,
      ].join(" · "),
    });
  }, [initialWriterSession, pushDebug]);

  const bootBible = initialWriterSession?.projectBible ?? null;
  const bootCast = bootBible?.cast;
  const bootManual = bootBible?.manualOverrides;
  const [blocks, setBlocks] = useState<CanvasBlock[]>(initial.blocks);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const [edges, setEdges] = useState<CanvasEdge[]>(initial.edges);
  const [factoryBusy, setFactoryBusy] = useState(false);
  /** 剧本工作台优先；已确认编剧时强制工作台（旧 session 若停在表单会像「UI 没改」） */
  const [manhuaUiMode, setManhuaUiMode] = useState<"workbench" | "form">(() => {
    if (initialWriterSession?.writerConfirmed) return "workbench";
    return initialWriterSession?.manhuaUiMode || "workbench";
  });
  /** 沉浸工作台下临时展开编剧室/成片坞 */
  const [immersiveExtrasOpen, setImmersiveExtrasOpen] = useState(false);
  /** 角色库 / 资产墙改抽屉，避免长期占主流程 */
  const [manhuaAssetDrawer, setManhuaAssetDrawer] = useState<null | "characters" | "assets">(null);
  /** 确认编剧后的专案 Bible（系列级真相；≠ 工厂节点 bible-*） */
  const [projectBible, setProjectBible] = useState<ManhuaProjectBible | null>(() => bootBible);
  const [factoryTopic, setFactoryTopic] = useState(
    () => initialWriterSession?.topic || initialFactoryPrefs.topic || "",
  );
  const [factoryGenreId, setFactoryGenreId] = useState("");
  const [factorySceneId, setFactorySceneId] = useState(() => bootCast?.sceneId || "");
  /** 资产墙点选的道具示范（最多 4） */
  const [factoryPropIds, setFactoryPropIds] = useState<string[]>(() => bootCast?.propIds || []);
  /** 古风原型 arch_*（最多 2） */
  const [factoryAncientArchetypeIds, setFactoryAncientArchetypeIds] = useState<string[]>(
    () => bootCast?.ancientArchetypeIds || [],
  );
  /** 剧本跟随身份锁（CastBundle） */
  const [factoryIdentityLockZh, setFactoryIdentityLockZh] = useState(
    () => bootCast?.identityLockZh || "",
  );
  /** 手选场景后不再被题材自动覆盖（⑤D） */
  const [sceneManual, setSceneManual] = useState(() =>
    Boolean(bootManual?.scene || (bootCast?.sceneId && initialWriterSession?.writerConfirmed)),
  );
  const bootUrbanIds = bootCast?.lane === "urban" ? bootCast.characterIds : [];
  const [factoryFemaleId, setFactoryFemaleId] = useState(
    () => bootUrbanIds[0] || initialFactoryPrefs.femaleId || "",
  );
  const [factoryMaleId, setFactoryMaleId] = useState(
    () => bootUrbanIds[1] || initialFactoryPrefs.maleId || "",
  );
  /** 用户手选后不再被题材自动覆盖（4.B） */
  const [femaleLeadManual, setFemaleLeadManual] = useState(() =>
    Boolean(
      bootManual?.femaleLead ||
        initialFactoryPrefs.femaleLeadManual ||
        (bootUrbanIds[0] && initialWriterSession?.writerConfirmed),
    ),
  );
  const [maleLeadManual, setMaleLeadManual] = useState(() =>
    Boolean(
      bootManual?.maleLead ||
        initialFactoryPrefs.maleLeadManual ||
        (bootUrbanIds[1] && initialWriterSession?.writerConfirmed),
    ),
  );
  const [ancientManual, setAncientManual] = useState(() =>
    Boolean(
      bootManual?.ancient ||
        (bootCast?.lane === "ancient" &&
          bootCast.ancientArchetypeIds.length &&
          initialWriterSession?.writerConfirmed),
    ),
  );
  const [wardrobeManual, setWardrobeManual] = useState(() =>
    Boolean(
      bootManual?.wardrobe ||
        (bootCast?.wardrobePropContinuityIds.length && initialWriterSession?.writerConfirmed),
    ),
  );
  const [propManual, setPropManual] = useState(() =>
    Boolean(
      bootManual?.props || (bootCast?.propIds.length && initialWriterSession?.writerConfirmed),
    ),
  );
  const [factoryArtStyleId, setFactoryArtStyleId] = useState<ManhuaArtStyleId>(
    () =>
      (bootCast?.artStyleId as ManhuaArtStyleId | undefined) ||
      initialFactoryPrefs.artStyleId ||
      DEFAULT_MANHUA_ART_STYLE_ID,
  );
  const [artStyleManual, setArtStyleManual] = useState(() =>
    Boolean(
      bootManual?.artStyle ||
        initialFactoryPrefs.artStyleManual ||
        (bootCast?.artStyleId && initialWriterSession?.writerConfirmed),
    ),
  );
  const [factoryMotionId, setFactoryMotionId] = useState("");
  const [factoryCraftShotId, setFactoryCraftShotId] = useState("");
  /** 手选手法后不再被题材自动覆盖 */
  const [craftShotManual, setCraftShotManual] = useState(false);
  const [motionManual, setMotionManual] = useState(false);
  const [factoryPathRecipeId, setFactoryPathRecipeId] = useState("");
  const [pathRecipeManual, setPathRecipeManual] = useState(false);
  const [factoryPathAnnotation, setFactoryPathAnnotation] = useState<ManhuaPathAnnotation | null>(
    null,
  );
  const [factoryNarrativeLightingId, setFactoryNarrativeLightingId] = useState("");
  const [narrativeLightingManual, setNarrativeLightingManual] = useState(false);
  const [factoryMaleHairstyleId, setFactoryMaleHairstyleId] = useState("");
  const [factoryMaleMicroId, setFactoryMaleMicroId] = useState("");
  const [maleMicroManual, setMaleMicroManual] = useState(false);
  const [factoryPromoLayoutId, setFactoryPromoLayoutId] = useState("");
  const [factoryActionRecipeId, setFactoryActionRecipeId] = useState("");
  const [actionRecipeManual, setActionRecipeManual] = useState(false);
  const [factoryCineVocabId, setFactoryCineVocabId] = useState("");
  const [factoryCineVocabLocale, setFactoryCineVocabLocale] = useState<ManhuaCineVocabLocale>(
    () => initialWriterSession?.cineVocabLocale || "zh",
  );
  const [deliveryPackage, setDeliveryPackage] = useState<ManhuaDeliveryPackage>(() =>
    normalizeManhuaDeliveryPackage(initialWriterSession?.deliveryPackage, {
      seriesTitle: initialWriterSession?.writerPack?.seriesTitle,
      locale: initialWriterSession?.cineVocabLocale || "zh",
    }),
  );
  /** 链式深度：重锚后忽略该场景此前已完成成片数（按场景开链） */
  const [chainIgnoreByScene, setChainIgnoreByScene] = useState<Record<string, number>>(
    () => initialWriterSession?.chainIgnoreByScene || {},
  );
  const [factoryWardrobeId, setFactoryWardrobeId] = useState(
    () => bootCast?.wardrobePropContinuityIds[0] || "",
  );
  const [factoryReverseMode, setFactoryReverseMode] = useState<VideoReverseOutputMode>("zh");
  /** 侧栏进阶下拉默认折叠，降低信息密度 */
  const [factoryAdvancedOpen, setFactoryAdvancedOpen] = useState(false);
  const [factoryProgress, setFactoryProgress] = useState<string>("");
  const [writerBrief, setWriterBrief] = useState(() => initialWriterSession?.brief || "");
  const [viralTemplateId, setViralTemplateId] = useState(
    () => String(initialWriterSession?.viralTemplateId || "").trim(),
  );
  const [writerEpisodeCount, setWriterEpisodeCount] = useState(() =>
    clampWriterEpisodeCount(initialWriterSession?.episodeCount ?? MANHUA_WRITER_EPISODE_DEFAULT),
  );
  const [writerBusy, setWriterBusy] = useState(false);
  /** 确认编剧失败时的门禁原因（页面常驻，不只 toast） */
  const [writerConfirmBlockers, setWriterConfirmBlockers] = useState<string[]>([]);
  /** 次要入口：粘贴 / 上传已有剧本 */
  const [writerImportDraft, setWriterImportDraft] = useState("");
  const writerImportFileRef = useRef<HTMLInputElement | null>(null);
  const [writerPack, setWriterPack] = useState<ManhuaWriterPack | null>(
    () => initialWriterSession?.writerPack ?? null,
  );
  const [writerConfirmed, setWriterConfirmed] = useState(
    () => Boolean(initialWriterSession?.writerConfirmed),
  );
  const [writerFocusEpisode, setWriterFocusEpisode] = useState(() =>
    Math.max(1, Math.floor(Number(initialWriterSession?.focusEpisode) || 1)),
  );
  const [directorUnlocked, setDirectorUnlocked] = useState(
    () => Boolean(initialWriterSession?.directorUnlocked),
  );
  const [assetsSkipped, setAssetsSkipped] = useState(
    () => Boolean(initialWriterSession?.assetsSkipped),
  );
  const [customAssetRefs, setCustomAssetRefs] = useState<ManhuaCustomAssetRef[]>(() =>
    normalizeManhuaCustomAssetRefs(initialWriterSession?.customAssetRefs),
  );
  const [characterVoiceLocks, setCharacterVoiceLocks] = useState<ManhuaCharacterVoiceLock[]>(() =>
    normalizeManhuaCharacterVoiceLocks(initialWriterSession?.characterVoiceLocks),
  );
  const [characterLookSets, setCharacterLookSets] = useState(() =>
    normalizeManhuaCharacterLookSets(initialWriterSession?.characterLookSets),
  );
  const [segmentLookBindings, setSegmentLookBindings] = useState(() =>
    normalizeManhuaSegmentLookBindings(initialWriterSession?.segmentLookBindings),
  );
  const [stylePack, setStylePack] = useState(() => initialWriterSession?.stylePack ?? null);
  const [shareAssetToLibrary, setShareAssetToLibrary] = useState(
    () => Boolean(initialWriterSession?.shareAssetToLibrary),
  );
  const [workflowPhase, setWorkflowPhase] = useState<
    "outline" | "assets" | "storyboard" | "edit"
  >(
    () =>
      initialWriterSession?.workflowPhase ||
      (initialWriterSession?.writerConfirmed ? "storyboard" : "outline"),
  );
  /** 工厂运行范围：焦点集（默认）或成片坞已勾选集 */
  const [factoryRunScope, setFactoryRunScope] = useState<"focus" | "dock">("focus");
  const [dockSelectedIds, setDockSelectedIds] = useState<Set<string>>(() => new Set());
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  /** 漫剧工厂画布：默认只看本集静帧/成片，避免文本节点墙 */
  const [manhuaCanvasPresentation, setManhuaCanvasPresentation] = useState<"media" | "all">(
    "media",
  );
  const [shotContinuity, setShotContinuity] = useState<ManhuaShotContinuityPrefs>(() =>
    loadManhuaShotContinuityPrefs(),
  );

  const openManhuaFactoryCanvas = useCallback(
    (blockId?: string) => {
      if (blockId) {
        const block = blocks.find((b) => b.id === blockId);
        const presentMedia =
          String(blockId).startsWith("clip-") ||
          String(blockId).startsWith("keyart-") ||
          block?.kind === "image" ||
          block?.kind === "video";
        setManhuaCanvasPresentation(presentMedia ? "media" : "all");
        // 同 id 再点也要重新触发 FreeformCanvas focus effect
        setFocusBlockId(null);
        window.setTimeout(() => setFocusBlockId(blockId), 0);
      }
      // 工作台右栏画布若已收起，点节点时自动展开
      window.setTimeout(() => {
        const openBtn = document.querySelector(
          '[data-manhua-action="open-canvas-dock"]',
        ) as HTMLButtonElement | null;
        openBtn?.click();
      }, 0);
      window.setTimeout(() => {
        const zone = document.getElementById("freeform-canvas-zone");
        // 右栏已挂画布时只聚焦，不展开下方折叠区、不跳出三栏
        if (zone && zone.getClientRects().length > 0) {
          zone.scrollIntoView({ behavior: "smooth", block: "nearest" });
          return;
        }
        const details = document.getElementById(
          "manhua-factory-canvas-details",
        ) as HTMLDetailsElement | null;
        if (details) details.open = true;
        document
          .getElementById("freeform-canvas-zone")
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 80);
    },
    [blocks],
  );
  const [canvasMode, setCanvasMode] = useState<CanvasWorkspaceMode>(() => loadCanvasWorkspaceMode());
  const [assembleBusy, setAssembleBusy] = useState(false);
  const [finalAssembleVideoUrl, setFinalAssembleVideoUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chargeWorkflowStepMutation = trpc.workflow.chargeStep.useMutation();
  const refundWorkflowStepMutation = trpc.workflow.refundStep.useMutation();
  /** 登录后云端草稿：与本机双通路，互不放弃 */
  const [cloudSyncReady, setCloudSyncReady] = useState(false);
  const cloudHydrateDoneRef = useRef(false);
  const cloudDraftQuery = trpc.manhuaCloudDraft.get.useQuery(undefined, {
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const generateAssetStillMutation = trpc.manhuaAssetShare.generateAssetStill.useMutation();
  const assetShareQuote = trpc.manhuaAssetShare.quote.useQuery(
    { shareToLibrary: shareAssetToLibrary },
    {
      enabled: Boolean(user?.id) && canvasMode === "manhua",
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  );
  const assetShareBillingUi = useMemo(() => {
    const q = assetShareQuote.data;
    const remainingGifted = Number(q?.remainingGiftedCredits) || 0;
    const priceLabelZh = manhuaAssetStillPriceLabelZh({
      shareToLibrary: shareAssetToLibrary,
      remainingGiftedCredits: remainingGifted,
    });
    if (q) {
      return {
        credits: q.credits,
        halfPriceApplied: q.halfPriceApplied,
        giftedBlocksHalfPrice: q.giftedBlocksHalfPrice,
        noticeZh: q.noticeZh,
        priceLabelZh,
      };
    }
    return {
      credits: shareAssetToLibrary
        ? MANHUA_ASSET_STILL_SHARE_HALF_CREDITS
        : MANHUA_ASSET_STILL_FULL_CREDITS,
      halfPriceApplied: Boolean(shareAssetToLibrary),
      giftedBlocksHalfPrice: false,
      noticeZh: MANHUA_ASSET_SHARE_CONSENT_HINT_ZH,
      priceLabelZh,
    };
  }, [assetShareQuote.data, shareAssetToLibrary]);
  const cloudDraftFailAtRef = useRef(0);
  /** 确认编剧后立刻自动出设定图（避免闭包旧 state） */
  const confirmAssetsAutoRef = useRef<
    (opts?: {
      assetCanonOverride?: NonNullable<typeof projectBible>["assetCanon"];
      episodeIndexOverride?: number;
      topicOverride?: string;
      forceRegenerate?: boolean;
    }) => Promise<void>
  >(async () => {});
  const cloudDraftUpsert = trpc.manhuaCloudDraft.upsert.useMutation({
    onError: (err) => {
      const raw = String(err.message || err);
      const now = Date.now();
      // HTML/非 JSON 时多为反代回了网页；勿刷屏
      if (now - cloudDraftFailAtRef.current < 60_000) return;
      cloudDraftFailAtRef.current = now;
      const detail = /<!DOCTYPE|Unexpected token\s*['"]?</i.test(raw)
        ? "云端草稿接口返回了网页而非数据（已改打长任务 API；请刷新后重试）"
        : raw.slice(0, 160);
      pushDebug("cloudDraft:upsert-fail", { level: "warn", detail });
    },
  });
  const cloudDraftPrepareUpload = trpc.manhuaCloudDraft.prepareDirectUpload.useMutation();
  const cloudDraftCommitUpload = trpc.manhuaCloudDraft.commitDirectUpload.useMutation();
  /** 避免 mutation 对象换引用时把防抖同步打成死循环狂刷 */
  const cloudDraftPrepareMutateRef = useRef(cloudDraftPrepareUpload.mutateAsync);
  const cloudDraftCommitMutateRef = useRef(cloudDraftCommitUpload.mutateAsync);
  const cloudDraftUpsertMutateRef = useRef(cloudDraftUpsert.mutate);
  const cloudDraftSyncInFlightRef = useRef(false);
  cloudDraftPrepareMutateRef.current = cloudDraftPrepareUpload.mutateAsync;
  cloudDraftCommitMutateRef.current = cloudDraftCommitUpload.mutateAsync;
  cloudDraftUpsertMutateRef.current = cloudDraftUpsert.mutate;
  const syncCloudDraftPayload = useCallback(
    async (payload: ManhuaCloudDraftPayload) => {
      if (!user?.id) return;
      if (cloudDraftSyncInFlightRef.current) {
        pushDebug("cloudDraft:skip-in-flight", { level: "warn", detail: "上一笔云草稿仍在传" });
        return;
      }
      const payloadJson = serializeCloudDraftForUpload(payload);
      if (!payloadJson) {
        pushDebug("cloudDraft:skip-too-large", { level: "warn" });
        return;
      }
      cloudDraftSyncInFlightRef.current = true;
      try {
        const direct = await uploadManhuaCloudDraftViaGcsDirect({
          userId: user.id,
          payload,
          prepare: () => cloudDraftPrepareMutateRef.current(),
          commit: () => cloudDraftCommitMutateRef.current(),
        });
        if (direct.ok) {
          trySaveLocalClientUpdatedAt(payload.clientUpdatedAt);
          pushDebug("cloudDraft:gcs-direct-ok", { level: "ok" });
          return;
        }
        pushDebug("cloudDraft:gcs-direct-fail", {
          level: "warn",
          detail: direct.error.slice(0, 120),
        });
        cloudDraftUpsertMutateRef.current(
          { payloadJson },
          {
            onSuccess: () => {
              trySaveLocalClientUpdatedAt(payload.clientUpdatedAt);
              pushDebug("cloudDraft:upsert-fallback-ok", { level: "ok" });
            },
          },
        );
      } finally {
        cloudDraftSyncInFlightRef.current = false;
      }
    },
    [user?.id, pushDebug],
  );

  const selectCanvasMode = useCallback((mode: CanvasWorkspaceMode) => {
    setCanvasMode(mode);
    try {
      localStorage.setItem(LS_CANVAS_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);
  const genreOptions = useMemo(() => listScreenwriterGenres({ onlyReady: true }), []);
  const factoryGenreLabel = useMemo(() => {
    const g = genreOptions.find((x) => x.id === factoryGenreId);
    return String(g?.labelZh || g?.id || "").trim();
  }, [factoryGenreId, genreOptions]);
  const sceneOptions = useMemo(() => {
    const g = genreOptions.find((x) => x.id === factoryGenreId);
    if (g?.sceneGenre) return listManhuaScenes({ genre: g.sceneGenre });
    return listManhuaScenes();
  }, [factoryGenreId, genreOptions]);
  const recommendedSceneRec = useMemo(
    () =>
      recommendManhuaSceneIdFromTopic({
        genreId: factoryGenreId || undefined,
        topic: factoryTopic,
      }),
    [factoryGenreId, factoryTopic],
  );
  const recommendedScene = useMemo(
    () => (recommendedSceneRec.sceneId ? getManhuaSceneTemplate(recommendedSceneRec.sceneId) : null),
    [recommendedSceneRec.sceneId],
  );
  const sceneAutoApplied =
    !sceneManual &&
    Boolean(factorySceneId) &&
    factorySceneId === recommendedSceneRec.sceneId;

  useEffect(() => {
    if (!sceneManual && recommendedSceneRec.sceneId) {
      setFactorySceneId(recommendedSceneRec.sceneId);
    }
  }, [recommendedSceneRec.sceneId, sceneManual]);

  const castBundle = useMemo(
    () =>
      recommendManhuaCastBundle({
        topic: factoryTopic,
        genreId: factoryGenreId || undefined,
        charactersMd: writerPack?.charactersMd,
      }),
    [factoryTopic, factoryGenreId, writerPack?.charactersMd],
  );
  /** 1423：编剧确认 / 跳过进编导后才硬套 Cast；此前仅软预览 */
  const castHardApplyReady = writerConfirmed || directorUnlocked;
  const femaleAutoApplied =
    castHardApplyReady &&
    !femaleLeadManual &&
    castBundle.lane === "urban" &&
    Boolean(factoryFemaleId) &&
    factoryFemaleId === castBundle.femaleId;
  const maleAutoApplied =
    castHardApplyReady &&
    !maleLeadManual &&
    castBundle.lane === "urban" &&
    Boolean(factoryMaleId) &&
    factoryMaleId === castBundle.maleId;
  const recommendedArtStyle = useMemo(
    () => recommendManhuaArtStyleFromTopic(factoryTopic),
    [factoryTopic],
  );
  const artStyleAutoApplied =
    !artStyleManual && factoryArtStyleId === recommendedArtStyle.artStyleId;

  useEffect(() => {
    setFactoryIdentityLockZh(castBundle.identityLockZh);

    // 古风题材：确认前也清掉残留都市角色卡（防 localStorage/prefs 污染）
    if (castBundle.lane === "ancient") {
      setFactoryFemaleId("");
      setFactoryMaleId("");
      setFemaleLeadManual(false);
      setMaleLeadManual(false);
    }

    if (!castHardApplyReady) {
      // 软预览：不写入原型/都市脸/服/道具，等编剧确认
      if (!ancientManual) setFactoryAncientArchetypeIds([]);
      if (!wardrobeManual) setFactoryWardrobeId("");
      if (!propManual) setFactoryPropIds([]);
      if (castBundle.lane === "urban") {
        if (!femaleLeadManual) setFactoryFemaleId("");
        if (!maleLeadManual) setFactoryMaleId("");
        if (!ancientManual) setFactoryAncientArchetypeIds([]);
      }
      return;
    }

    if (castBundle.lane === "ancient") {
      if (!ancientManual) setFactoryAncientArchetypeIds(castBundle.ancientArchetypeIds);
    } else {
      if (!femaleLeadManual && castBundle.femaleId) setFactoryFemaleId(castBundle.femaleId);
      if (!maleLeadManual && castBundle.maleId) setFactoryMaleId(castBundle.maleId);
      if (!ancientManual) setFactoryAncientArchetypeIds([]);
    }
    if (!wardrobeManual) {
      setFactoryWardrobeId(castBundle.wardrobePropContinuityIds[0] || "");
    }
    if (!propManual) {
      setFactoryPropIds(castBundle.propIds);
    }
  }, [
    castBundle,
    castHardApplyReady,
    femaleLeadManual,
    maleLeadManual,
    ancientManual,
    wardrobeManual,
    propManual,
  ]);

  useEffect(() => {
    if (!artStyleManual) {
      setFactoryArtStyleId(recommendedArtStyle.artStyleId);
    }
  }, [recommendedArtStyle.artStyleId, artStyleManual]);

  /** 确认/铺板瞬间同步硬套 Cast（避免 setState 尚未生效就 spawn） */
  const resolveHardCastForSpawn = useCallback(
    (opts?: { topicOverride?: string; charactersMd?: string | null }) => {
      const topic = String(opts?.topicOverride || factoryTopic || "").trim();
      const bundle = recommendManhuaCastBundle({
        topic,
        genreId: factoryGenreId || undefined,
        charactersMd: opts?.charactersMd ?? writerPack?.charactersMd,
      });
      setFactoryIdentityLockZh(bundle.identityLockZh);
      if (bundle.lane === "ancient") {
        const ancientIds = ancientManual
          ? factoryAncientArchetypeIds
          : bundle.ancientArchetypeIds;
        const propIds = propManual ? factoryPropIds : bundle.propIds;
        const wardrobeId = wardrobeManual
          ? factoryWardrobeId
          : bundle.wardrobePropContinuityIds[0] || "";
        setFactoryFemaleId("");
        setFactoryMaleId("");
        setFemaleLeadManual(false);
        setMaleLeadManual(false);
        if (!ancientManual) setFactoryAncientArchetypeIds(ancientIds);
        if (!propManual) setFactoryPropIds(propIds);
        if (!wardrobeManual) setFactoryWardrobeId(wardrobeId);
        return {
          characterIds: [] as string[],
          ancientArchetypeIds: ancientIds,
          propIds,
          wardrobePropContinuityIds: wardrobeId ? [wardrobeId] : [],
          identityLockZh: bundle.identityLockZh,
          lane: "ancient" as const,
        };
      }
      const femaleId = femaleLeadManual ? factoryFemaleId : bundle.femaleId;
      const maleId = maleLeadManual ? factoryMaleId : bundle.maleId;
      const propIds = propManual ? factoryPropIds : bundle.propIds;
      const wardrobeId = wardrobeManual
        ? factoryWardrobeId
        : bundle.wardrobePropContinuityIds[0] || "";
      if (!femaleLeadManual && bundle.femaleId) setFactoryFemaleId(bundle.femaleId);
      if (!maleLeadManual && bundle.maleId) setFactoryMaleId(bundle.maleId);
      if (!ancientManual) setFactoryAncientArchetypeIds([]);
      if (!propManual) setFactoryPropIds(propIds);
      if (!wardrobeManual) setFactoryWardrobeId(wardrobeId);
      return {
        characterIds: [femaleId, maleId].map((id) => String(id || "").trim()).filter(Boolean),
        ancientArchetypeIds: [] as string[],
        propIds,
        wardrobePropContinuityIds: wardrobeId ? [wardrobeId] : [],
        identityLockZh: bundle.identityLockZh,
        lane: "urban" as const,
      };
    },
    [
      factoryTopic,
      factoryGenreId,
      writerPack?.charactersMd,
      ancientManual,
      factoryAncientArchetypeIds,
      propManual,
      factoryPropIds,
      wardrobeManual,
      factoryWardrobeId,
      femaleLeadManual,
      factoryFemaleId,
      maleLeadManual,
      factoryMaleId,
    ],
  );

  useEffect(() => {
    saveFactoryCharacterPrefs({
      topic: factoryTopic,
      femaleId: factoryFemaleId,
      maleId: factoryMaleId,
      artStyleId: factoryArtStyleId,
      femaleLeadManual,
      maleLeadManual,
      artStyleManual,
    });
  }, [
    factoryTopic,
    factoryFemaleId,
    factoryMaleId,
    factoryArtStyleId,
    femaleLeadManual,
    maleLeadManual,
    artStyleManual,
  ]);

  const spawnSameLayoutSheet = useCallback(
    (gender: ManhuaCharacterGender) => {
      const seedId = gender === "female" ? factoryFemaleId : factoryMaleId;
      const style = getManhuaArtStylePreset(factoryArtStyleId);
      const prompt = buildManhuaCharacterSheetGenPrompt({
        characterId: seedId || undefined,
        gender,
        artStyleId: factoryArtStyleId,
      });
      // 同版式设定卡也落左上角色带，勿贴画布最右
      const charCount = blocks.filter((b) => b.id.startsWith("charsheet-")).length;
      const sheet = defaultCanvasBlock("image", 60 + charCount * 380, 80);
      sheet.id = makeCanvasBlockId("charsheet");
      sheet.prompt = prompt;
      sheet.aspectRatio = "9:16";
      sheet.imageModel = "gpt-image-2";
      // 仅预填 prompt；不挂本地 /manhua-characters 相对路径（云端生图拉不到）
      sheet.imageMode = "generate";
      sheet.refImageUrl = undefined;
      sheet.width = 380;
      sheet.height = 420;
      const nextBlocks = [...blocks, sheet];
      setBlocks(nextBlocks);
      saveCanvasState(nextBlocks, edges);
      toast.success(
        `已铺「同版式设定卡·${gender === "female" ? "女主" : "男主"}」节点（${style.labelZh}）`,
        { description: "节点已预填，打开即可核对 prompt。点运行才会扣费——验收阶段请勿点运行。" },
      );
    },
    [blocks, edges, factoryFemaleId, factoryMaleId, factoryArtStyleId],
  );

  const recommendedCraft = useMemo(
    () => recommendCraftShotFromTopic(factoryTopic),
    [factoryTopic],
  );
  const selectedCraftShot = useMemo(
    () => (factoryCraftShotId ? getCraftShotById(factoryCraftShotId) : null),
    [factoryCraftShotId],
  );
  const craftAutoApplied =
    !craftShotManual &&
    Boolean(factoryCraftShotId) &&
    factoryCraftShotId === recommendedCraft.craftShotId;

  useEffect(() => {
    if (!craftShotManual && recommendedCraft.craftShotId) {
      setFactoryCraftShotId(recommendedCraft.craftShotId);
    }
  }, [recommendedCraft.craftShotId, craftShotManual]);

  const recommendedMotion = useMemo(
    () => recommendMotionPromptFromTopic(factoryTopic),
    [factoryTopic],
  );
  useEffect(() => {
    if (motionManual) return;
    if (recommendedMotion.motionId) {
      setFactoryMotionId(recommendedMotion.motionId);
    }
  }, [recommendedMotion.motionId, motionManual]);

  /** 运镜/动作推荐：题材 + 本集剧本（打斗/比赛/多人/肢体移位等） */
  const craftHintBlob = useMemo(() => {
    const parts = [factoryTopic.trim()];
    if (writerPack) {
      const ep =
        writerPack.episodes.find((e) => e.index === writerFocusEpisode) || writerPack.episodes[0];
      parts.push(
        writerPack.seriesTitle || "",
        writerPack.logline || "",
        ep?.title || "",
        ep?.body || "",
        ep?.endHook || "",
      );
    }
    return parts.filter(Boolean).join("\n");
  }, [factoryTopic, writerPack, writerFocusEpisode]);

  const recommendedPath = useMemo(
    () => recommendPathCameraFromTopic(craftHintBlob),
    [craftHintBlob],
  );
  const recommendedNarrativeLighting = useMemo(
    () => recommendNarrativeLightingFromTopic(factoryTopic),
    [factoryTopic],
  );
  const recommendedMaleMicro = useMemo(
    () => recommendMaleMicroExpressionFromTopic(factoryTopic),
    [factoryTopic],
  );
  const recommendedAction = useMemo(
    () => recommendActionCameraFromTopic(craftHintBlob),
    [craftHintBlob],
  );

  useEffect(() => {
    if (!pathRecipeManual && recommendedPath.recipeId) {
      setFactoryPathRecipeId(recommendedPath.recipeId);
    }
  }, [recommendedPath.recipeId, pathRecipeManual]);

  useEffect(() => {
    if (!actionRecipeManual && recommendedAction.recipeId) {
      setFactoryActionRecipeId(recommendedAction.recipeId);
    }
  }, [recommendedAction.recipeId, actionRecipeManual]);

  useEffect(() => {
    if (!narrativeLightingManual && recommendedNarrativeLighting.lightingId) {
      setFactoryNarrativeLightingId(recommendedNarrativeLighting.lightingId);
    }
  }, [recommendedNarrativeLighting.lightingId, narrativeLightingManual]);

  useEffect(() => {
    if (!maleMicroManual && recommendedMaleMicro.expressionId) {
      setFactoryMaleMicroId(recommendedMaleMicro.expressionId);
    }
  }, [recommendedMaleMicro.expressionId, maleMicroManual]);

  const selectedCharacterIds = useMemo(
    () => [factoryFemaleId, factoryMaleId].map((id) => id.trim()).filter(Boolean),
    [factoryFemaleId, factoryMaleId],
  );

  /** 编剧包 / Bible / 确认态持久化：硬刷新后继续三集流程，无需重扩 */
  useEffect(() => {
    try {
      saveManhuaWriterSessionToStorage({
        topic: factoryTopic,
        brief: writerBrief,
        episodeCount: writerEpisodeCount,
        focusEpisode: writerFocusEpisode,
        writerPack,
        writerConfirmed,
        directorUnlocked,
        projectBible,
        manhuaUiMode,
        assetsSkipped,
        workflowPhase,
        customAssetRefs,
        characterVoiceLocks,
        shareAssetToLibrary,
        viralTemplateId,
        stylePack,
      });
    } catch {
      /* 本机权限/配额失败：不阻断云端通路 */
    }
  }, [
    factoryTopic,
    writerBrief,
    writerEpisodeCount,
    writerFocusEpisode,
    writerPack,
    writerConfirmed,
    directorUnlocked,
    projectBible,
    manhuaUiMode,
    assetsSkipped,
    workflowPhase,
    customAssetRefs,
    characterVoiceLocks,
    shareAssetToLibrary,
    viralTemplateId,
    stylePack,
  ]);

  const applyCloudDraftToUi = useCallback((draft: ManhuaCloudDraftPayload) => {
    const session = draft.writerSession;
    const nextBlocks = cloudDraftBlocksToCanvas(draft.canvas.blocks);
    const nextEdges = draft.canvas.edges as CanvasEdge[];
    setBlocks(nextBlocks);
    setEdges(nextEdges);
    setFactoryTopic(session.topic || "");
    setWriterBrief(session.brief || "");
    setWriterEpisodeCount(clampWriterEpisodeCount(session.episodeCount));
    setWriterFocusEpisode(Math.max(1, Math.floor(Number(session.focusEpisode) || 1)));
    setWriterPack(session.writerPack);
    setWriterConfirmed(Boolean(session.writerConfirmed));
    setDirectorUnlocked(Boolean(session.directorUnlocked));
    setProjectBible(session.projectBible);
    setManhuaUiMode(session.manhuaUiMode === "form" ? "form" : "workbench");
    setAssetsSkipped(Boolean(session.assetsSkipped));
    setCustomAssetRefs(normalizeManhuaCustomAssetRefs(session.customAssetRefs));
    setCharacterVoiceLocks(
      normalizeManhuaCharacterVoiceLocks(session.characterVoiceLocks),
    );
    setCharacterLookSets(normalizeManhuaCharacterLookSets(session.characterLookSets));
    setSegmentLookBindings(
      normalizeManhuaSegmentLookBindings(session.segmentLookBindings),
    );
    setStylePack(session.stylePack ?? null);
    setShareAssetToLibrary(Boolean(session.shareAssetToLibrary));
    setViralTemplateId(String(session.viralTemplateId || "").trim());
    if (session.deliveryPackage) {
      setDeliveryPackage(
        normalizeManhuaDeliveryPackage(session.deliveryPackage, {
          seriesTitle: session.writerPack?.seriesTitle,
        }),
      );
    }
    if (session.cineVocabLocale) setFactoryCineVocabLocale(session.cineVocabLocale);
    if (session.chainIgnoreByScene) setChainIgnoreByScene(session.chainIgnoreByScene);
    setWorkflowPhase(
      session.workflowPhase === "assets" ||
        session.workflowPhase === "storyboard" ||
        session.workflowPhase === "edit"
        ? session.workflowPhase
        : session.writerConfirmed
          ? "storyboard"
          : "outline",
    );
    const prefs = draft.factoryPrefs || {};
    if (Array.isArray(prefs.customAssetRefs)) {
      setCustomAssetRefs(normalizeManhuaCustomAssetRefs(prefs.customAssetRefs));
    }
    if (typeof prefs.femaleId === "string") setFactoryFemaleId(prefs.femaleId);
    if (typeof prefs.maleId === "string") setFactoryMaleId(prefs.maleId);
    if (typeof prefs.artStyleId === "string") {
      setFactoryArtStyleId(prefs.artStyleId as ManhuaArtStyleId);
    }
    if (prefs.femaleLeadManual != null) setFemaleLeadManual(Boolean(prefs.femaleLeadManual));
    if (prefs.maleLeadManual != null) setMaleLeadManual(Boolean(prefs.maleLeadManual));
    if (prefs.artStyleManual != null) setArtStyleManual(Boolean(prefs.artStyleManual));
    const cast = session.projectBible?.cast;
    if (cast) {
      if (cast.sceneId) setFactorySceneId(cast.sceneId);
      if (cast.propIds?.length) setFactoryPropIds(cast.propIds);
      if (cast.ancientArchetypeIds?.length) setFactoryAncientArchetypeIds(cast.ancientArchetypeIds);
      if (cast.identityLockZh) setFactoryIdentityLockZh(cast.identityLockZh);
      if (cast.wardrobePropContinuityIds?.[0]) {
        setFactoryWardrobeId(cast.wardrobePropContinuityIds[0]);
      }
      if (cast.lane === "urban" && cast.characterIds?.length) {
        if (cast.characterIds[0]) setFactoryFemaleId(cast.characterIds[0]);
        if (cast.characterIds[1]) setFactoryMaleId(cast.characterIds[1]);
      }
      if (cast.artStyleId) setFactoryArtStyleId(cast.artStyleId as ManhuaArtStyleId);
    }
    // 胜出草稿尽量补写本机（失败忽略）
    repairLocalFromCloudDraft(draft);
  }, []);

  /** 登录后：云端与本机比新，胜出方驱动 UI，并补写较弱一侧 */
  useEffect(() => {
    if (!user?.id) {
      cloudHydrateDoneRef.current = false;
      setCloudSyncReady(false);
      return;
    }
    if (cloudHydrateDoneRef.current) return;
    if (cloudDraftQuery.isLoading || cloudDraftQuery.isFetching) return;
    cloudHydrateDoneRef.current = true;

    const localParts = readLocalDraftPartsForHydrate();
    const choice = chooseManhuaDraftHydrate({
      cloud: cloudDraftQuery.data?.draft ?? null,
      localWriter: localParts.writer,
      localCanvas: localParts.canvas,
      localPrefs: localParts.prefs,
      localClientUpdatedAt: localParts.clientUpdatedAt,
    });

    if (choice.source === "cloud") {
      applyCloudDraftToUi(choice.draft);
      toast.message("已从云端恢复草稿（约 30 天暂存；请记得导出备份）");
      pushDebug("cloudDraft:hydrate-cloud", {
        level: "ok",
        detail: `blocks=${choice.draft.canvas.blocks.length} · at=${choice.draft.clientUpdatedAt}`,
      });
    } else if (choice.source === "local") {
      // 本机较新：补写云端（不打断当前 UI；优先 GCS 直传）
      void syncCloudDraftPayload(choice.draft).then(() => {
        pushDebug("cloudDraft:repair-cloud-from-local", { level: "ok" });
      });
      // 本机读失败键再尽力写一次
      persistManhuaDraftLocally({
        writerSession: choice.draft.writerSession,
        blocks: cloudDraftBlocksToCanvas(choice.draft.canvas.blocks),
        edges: choice.draft.canvas.edges as CanvasEdge[],
        factoryPrefs: choice.draft.factoryPrefs,
        clientUpdatedAt: choice.draft.clientUpdatedAt,
      });
    } else if (cloudDraftQuery.isError) {
      pushDebug("cloudDraft:hydrate-skip", {
        level: "warn",
        detail: "云端暂不可用，继续本机通路",
      });
    }

    setCloudSyncReady(true);
  }, [
    user?.id,
    cloudDraftQuery.isLoading,
    cloudDraftQuery.isFetching,
    cloudDraftQuery.isError,
    cloudDraftQuery.data?.draft,
    applyCloudDraftToUi,
    syncCloudDraftPayload,
    pushDebug,
  ]);

  /** 登录后防抖上传云端；本机仍各自写，互不依赖 */
  useEffect(() => {
    if (!user?.id || !cloudSyncReady) return;
    // 扩写/出片期间停云同步，避免直传狂刷拖死长任务
    if (factoryBusy || writerBusy) return;
    const clientUpdatedAt = new Date().toISOString();
    const factoryPrefs = {
      topic: factoryTopic,
      femaleId: factoryFemaleId,
      maleId: factoryMaleId,
      artStyleId: factoryArtStyleId,
      femaleLeadManual,
      maleLeadManual,
      artStyleManual,
      customAssetRefs,
      shareAssetToLibrary,
    };
    const writerSession = {
      topic: factoryTopic,
      brief: writerBrief,
      episodeCount: writerEpisodeCount,
      focusEpisode: writerFocusEpisode,
      writerPack,
      writerConfirmed,
      directorUnlocked,
      projectBible,
      manhuaUiMode,
      assetsSkipped,
      workflowPhase,
      customAssetRefs,
      characterVoiceLocks,
      characterLookSets,
      segmentLookBindings,
      shareAssetToLibrary,
      viralTemplateId,
      deliveryPackage,
      cineVocabLocale: factoryCineVocabLocale,
      chainIgnoreByScene,
    };
    // 本机双写补强（与既有 LS effect 叠加；失败不阻断）
    persistManhuaDraftLocally({
      writerSession,
      blocks,
      edges,
      factoryPrefs,
      clientUpdatedAt,
    });

    const timer = window.setTimeout(() => {
      const payload = buildLocalCloudDraftSnapshot({
        writerSession,
        blocks,
        edges,
        factoryPrefs,
        clientUpdatedAt,
      });
      void syncCloudDraftPayload(payload);
    }, MANHUA_CLOUD_DRAFT_SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    user?.id,
    cloudSyncReady,
    factoryBusy,
    writerBusy,
    factoryTopic,
    writerBrief,
    writerEpisodeCount,
    writerFocusEpisode,
    writerPack,
    writerConfirmed,
    directorUnlocked,
    projectBible,
    manhuaUiMode,
    assetsSkipped,
    workflowPhase,
    customAssetRefs,
    characterVoiceLocks,
    shareAssetToLibrary,
    viralTemplateId,
    deliveryPackage,
    factoryCineVocabLocale,
    chainIgnoreByScene,
    blocks,
    edges,
    factoryFemaleId,
    factoryMaleId,
    factoryArtStyleId,
    femaleLeadManual,
    maleLeadManual,
    artStyleManual,
    syncCloudDraftPayload,
  ]);

  /** 抽屉改造型后回写 Bible cast（保留 confirmedAt 与剧情正文） */
  useEffect(() => {
    if (!writerConfirmed || !projectBible) return;
    const sceneId = factorySceneId || projectBible.cast.sceneId || "";
    const wardrobeIds = factoryWardrobeId.trim()
      ? [factoryWardrobeId.trim()]
      : projectBible.cast.wardrobePropContinuityIds;
    const nextCast = {
      ...projectBible.cast,
      lane: castBundle.lane,
      characterIds: selectedCharacterIds,
      ancientArchetypeIds: factoryAncientArchetypeIds,
      artStyleId: factoryArtStyleId,
      sceneId: sceneId || undefined,
      propIds: factoryPropIds,
      wardrobePropContinuityIds: wardrobeIds,
      identityLockZh: factoryIdentityLockZh || projectBible.cast.identityLockZh,
    };
    const same =
      nextCast.lane === projectBible.cast.lane &&
      nextCast.artStyleId === projectBible.cast.artStyleId &&
      nextCast.sceneId === projectBible.cast.sceneId &&
      nextCast.identityLockZh === projectBible.cast.identityLockZh &&
      nextCast.characterIds.join("|") === projectBible.cast.characterIds.join("|") &&
      nextCast.ancientArchetypeIds.join("|") === projectBible.cast.ancientArchetypeIds.join("|") &&
      nextCast.propIds.join("|") === projectBible.cast.propIds.join("|") &&
      nextCast.wardrobePropContinuityIds.join("|") ===
        projectBible.cast.wardrobePropContinuityIds.join("|");
    if (same) return;
    setProjectBible({
      ...projectBible,
      cast: nextCast,
      focusEpisode: writerFocusEpisode,
      manualOverrides: {
        femaleLead: femaleLeadManual,
        maleLead: maleLeadManual,
        ancient: ancientManual,
        artStyle: artStyleManual,
        scene: sceneManual,
        props: propManual,
        wardrobe: wardrobeManual,
      },
    });
  }, [
    writerConfirmed,
    projectBible,
    castBundle.lane,
    selectedCharacterIds,
    factoryAncientArchetypeIds,
    factoryArtStyleId,
    factorySceneId,
    factoryPropIds,
    factoryWardrobeId,
    factoryIdentityLockZh,
    writerFocusEpisode,
    femaleLeadManual,
    maleLeadManual,
    ancientManual,
    artStyleManual,
    sceneManual,
    propManual,
    wardrobeManual,
  ]);
  const selectedMotionIds = useMemo(
    () => (factoryMotionId.trim() ? [factoryMotionId.trim()] : []),
    [factoryMotionId],
  );
  const selectedCraftShotIds = useMemo(
    () => (factoryCraftShotId.trim() ? [factoryCraftShotId.trim()] : []),
    [factoryCraftShotId],
  );
  const selectedPathRecipeIds = useMemo(
    () => (factoryPathRecipeId.trim() ? [factoryPathRecipeId.trim()] : []),
    [factoryPathRecipeId],
  );
  const selectedNarrativeLightingIds = useMemo(
    () => (factoryNarrativeLightingId.trim() ? [factoryNarrativeLightingId.trim()] : []),
    [factoryNarrativeLightingId],
  );
  const selectedMaleHairstyleIds = useMemo(
    () => (factoryMaleHairstyleId.trim() ? [factoryMaleHairstyleId.trim()] : []),
    [factoryMaleHairstyleId],
  );
  const selectedMaleMicroIds = useMemo(
    () => (factoryMaleMicroId.trim() ? [factoryMaleMicroId.trim()] : []),
    [factoryMaleMicroId],
  );
  const selectedPromoLayoutIds = useMemo(
    () => (factoryPromoLayoutId.trim() ? [factoryPromoLayoutId.trim()] : []),
    [factoryPromoLayoutId],
  );
  const selectedActionRecipeIds = useMemo(
    () => (factoryActionRecipeId.trim() ? [factoryActionRecipeId.trim()] : []),
    [factoryActionRecipeId],
  );
  const selectedCineVocabIds = useMemo(
    () => (factoryCineVocabId.trim() ? [factoryCineVocabId.trim()] : []),
    [factoryCineVocabId],
  );
  const selectedWardrobeIds = useMemo(
    () => (factoryWardrobeId.trim() ? [factoryWardrobeId.trim()] : []),
    [factoryWardrobeId],
  );

  const debugInjectSummary = useMemo(() => {
    if (!debugMode) return "";
    const pathAnchors = factoryPathAnnotation?.anchors?.length || 0;
    const pathStrokes = factoryPathAnnotation?.strokes?.length || 0;
    const lines = [
      `topic: ${factoryTopic.trim() || "—"}`,
      `focusEpisode: ${writerFocusEpisode}`,
      `runScope: ${factoryRunScope}`,
      `castApply: ${castHardApplyReady ? "hard(after-writer)" : "soft-preview"} · lane=${castBundle.lane}`,
      `projectBible: ${summarizeManhuaProjectBible(projectBible)}`,
      `chars: ${selectedCharacterIds.join(",") || "—"}`,
      `ancient: ${factoryAncientArchetypeIds.join(",") || "—"}`,
      `artStyle: ${factoryArtStyleId}`,
      `imageEngine: gpt-image-2-2026-04-21 · keyart=library-pad+edit`,
      `genre/scene: ${factoryGenreId || "auto"} / ${factorySceneId || "auto"}`,
      `props: ${factoryPropIds.join(",") || "—"}`,
      `craft: ${selectedCraftShotIds.join(",") || "—"}`,
      `pathRecipe: ${selectedPathRecipeIds.join(",") || "—"}`,
      `actionRecipe: ${selectedActionRecipeIds.join(",") || "—"}`,
      `pathAnnotate: anchors=${pathAnchors} strokes=${pathStrokes}`,
      `lighting: ${selectedNarrativeLightingIds.join(",") || "—"}`,
      `maleHair/micro: ${selectedMaleHairstyleIds.join(",") || "—"} / ${selectedMaleMicroIds.join(",") || "—"}`,
      `cineVocab: ${selectedCineVocabIds.join(",") || "—"}`,
      `wardrobe: ${selectedWardrobeIds.join(",") || "—"}`,
      `promo: ${selectedPromoLayoutIds.join(",") || "—"}`,
      `motion: ${selectedMotionIds.join(",") || "—"}`,
      `reverseMode: ${factoryReverseMode}`,
      `writerPack: ${writerPack ? `${writerPack.seriesTitle} · ${writerPack.episodes.length}ep · confirmed=${writerConfirmed}` : "—"}`,
      `progress: ${factoryProgress || "—"}`,
    ];
    return lines.join("\n");
  }, [
    debugMode,
    factoryTopic,
    writerFocusEpisode,
    factoryRunScope,
    castHardApplyReady,
    castBundle.lane,
    projectBible,
    selectedCharacterIds,
    factoryAncientArchetypeIds,
    factoryArtStyleId,
    factoryGenreId,
    factorySceneId,
    factoryPropIds,
    selectedCraftShotIds,
    selectedPathRecipeIds,
    selectedActionRecipeIds,
    factoryPathAnnotation,
    selectedNarrativeLightingIds,
    selectedMaleHairstyleIds,
    selectedMaleMicroIds,
    selectedCineVocabIds,
    selectedWardrobeIds,
    selectedPromoLayoutIds,
    selectedMotionIds,
    factoryReverseMode,
    writerPack,
    writerConfirmed,
    factoryProgress,
  ]);

  const keyArtPreviewUrl = useMemo(() => {
    const key = blocks.find(
      (b) => b.id.startsWith("keyart-") && (b.outputUrl || b.outputUrls?.[0] || b.refImageUrl),
    );
    return key?.outputUrl || key?.outputUrls?.[0] || key?.refImageUrl || "";
  }, [blocks]);

  /** 已铺工厂板时：手法/动效/场景/反推档（已铺可同步）变更同步进节点，不必整板重铺（短防抖） */
  useEffect(() => {
    const hasFactory = blocks.some((b) => MANHUA_FACTORY_STAGE_ORDER.some((s) => b.id.startsWith(`${s}-`)));
    if (!hasFactory || factoryBusy) return;
    const timer = window.setTimeout(() => {
      setBlocks((prev) => {
        const next = applyFactoryPrefsToBlocks(prev, {
          craftShotIds: selectedCraftShotIds,
          motionPromptIds: selectedMotionIds,
          pathCameraRecipeIds: selectedPathRecipeIds,
          pathAnnotationJson: factoryPathAnnotation,
          narrativeLightingIds: selectedNarrativeLightingIds,
          maleHairstyleIds: selectedMaleHairstyleIds,
          maleMicroExpressionIds: selectedMaleMicroIds,
          promoCoverLayoutIds: selectedPromoLayoutIds,
          actionCameraRecipeIds: selectedActionRecipeIds,
          cineVocabIds: selectedCineVocabIds,
            cineVocabLocale: factoryCineVocabLocale,
          wardrobePropContinuityIds: selectedWardrobeIds,
          sceneId: factorySceneId || undefined,
          propIds: factoryPropIds,
          genreId: factoryGenreId || undefined,
          characterIds: selectedCharacterIds,
          ancientArchetypeIds: factoryAncientArchetypeIds,
          identityLockZh: factoryIdentityLockZh || castBundle.identityLockZh,
          artStyleId: factoryArtStyleId,
          videoReverseOutputMode: factoryReverseMode,
          customRefs: customAssetRefs,
          assetCanon: projectBible?.assetCanon,
        });
        const changed = next.some((b, i) => {
          const p = prev[i];
          return (
            !p ||
            p.prompt !== b.prompt ||
            p.videoReverseOutputMode !== b.videoReverseOutputMode ||
            p.pathCameraRecipeId !== b.pathCameraRecipeId ||
            p.pathAnnotationJson !== b.pathAnnotationJson ||
            p.refImageUrl !== b.refImageUrl ||
            p.imageMode !== b.imageMode
          );
        });
        if (!changed) return prev;
        saveCanvasState(next, edges);
        return next;
      });
    }, 180);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅跟工厂选择器
  }, [
    factoryCraftShotId,
    factoryMotionId,
    factoryPathRecipeId,
    factoryPathAnnotation,
    factoryNarrativeLightingId,
    factoryMaleHairstyleId,
    factoryMaleMicroId,
    factoryPromoLayoutId,
    factoryActionRecipeId,
    factoryCineVocabId,
    factoryWardrobeId,
    factorySceneId,
    factoryPropIds,
    factoryGenreId,
    factoryFemaleId,
    factoryMaleId,
    factoryAncientArchetypeIds,
    factoryIdentityLockZh,
    factoryArtStyleId,
    factoryReverseMode,
    customAssetRefs,
    selectedCraftShotIds,
    selectedMotionIds,
    selectedPathRecipeIds,
    selectedNarrativeLightingIds,
    selectedMaleHairstyleIds,
    selectedMaleMicroIds,
    selectedPromoLayoutIds,
    selectedActionRecipeIds,
    selectedCineVocabIds,
    selectedWardrobeIds,
    selectedCharacterIds,
  ]);
  const motionGrouped = useMemo(() => {
    const cats: MotionPromptCategory[] = ["logo", "product_ad", "data", "caption", "scene_steal"];
    return cats.map((category) => ({
      category,
      label: MOTION_PROMPT_CATEGORY_LABEL_ZH[category],
      items: MOTION_PROMPT_BANK.filter((e) => e.category === category),
    }));
  }, []);
  const craftShotGrouped = useMemo(() => {
    const cats: CraftShotCategory[] = ["lighting", "camera", "emotion", "transition"];
    return cats.map((category) => ({
      category,
      label: CRAFT_SHOT_CATEGORY_LABEL_ZH[category],
      items: CRAFT_SHOT_BANK.filter((e) => e.category === category),
    }));
  }, []);
  const writerContext = useMemo(() => {
    if (!writerConfirmed || !writerPack) return undefined;
    const addon = projectBible?.assetCanon
      ? formatWriterAssetCanonFactoryAddon(projectBible.assetCanon, writerFocusEpisode)
      : "";
    return composeWriterPackFactoryContext(writerPack, writerFocusEpisode, {
      assetCanonAddonZh: addon || undefined,
    });
  }, [writerConfirmed, writerPack, writerFocusEpisode, projectBible?.assetCanon]);

  const assetScriptAlign = useMemo(
    () =>
      evaluateManhuaAssetScriptAlignment({
        assetCanon: projectBible?.assetCanon,
        customRefs: customAssetRefs,
        assetBlocks: blocks.filter(
          (b) => b.id.startsWith("charsheet-") || b.id.startsWith("sceneplate-"),
        ),
      }),
    [projectBible?.assetCanon, customAssetRefs, blocks],
  );

  /** 剧本表变了：自动清掉对不上的旧生成设定图（上传保留），并提示按剧本重出 */
  const lastAssetStalePurgeFpRef = useRef("");
  useEffect(() => {
    if (!writerConfirmed || !projectBible?.assetCanon) return;
    if (assetScriptAlign.aligned) {
      lastAssetStalePurgeFpRef.current = assetScriptAlign.fingerprint;
      return;
    }
    if (lastAssetStalePurgeFpRef.current === assetScriptAlign.fingerprint) return;
    lastAssetStalePurgeFpRef.current = assetScriptAlign.fingerprint;
    const purged = purgeStaleCustomAssetRefsForCanon(
      customAssetRefs,
      projectBible.assetCanon,
    );
    const removeIds = new Set(
      collectStaleAssetSheetBlockIds(blocks, projectBible.assetCanon),
    );
    if (purged.removedCount > 0) setCustomAssetRefs(purged.refs);
    if (removeIds.size > 0) {
      const nextBlocks = blocks.filter((b) => !removeIds.has(b.id));
      const nextEdges = edges.filter(
        (e) => !removeIds.has(e.fromId) && !removeIds.has(e.toId),
      );
      setBlocks(nextBlocks);
      setEdges(nextEdges);
      saveCanvasState(nextBlocks, nextEdges);
    }
    if (purged.removedCount > 0 || removeIds.size > 0) {
      setWorkflowPhase("assets");
      toast.message("已清掉与现稿不符的旧设定图", {
        description: "请到资产设定点「按剧本重出设定图」生成新人物/场景",
      });
      pushDebug("assetScriptStale:autoPurge", {
        level: "warn",
        detail: `refs=${purged.removedCount} sheets=${removeIds.size} fp=${assetScriptAlign.fingerprint.slice(0, 80)}`,
      });
    }
  }, [
    writerConfirmed,
    projectBible?.assetCanon,
    assetScriptAlign.aligned,
    assetScriptAlign.fingerprint,
    customAssetRefs,
    blocks,
    edges,
    pushDebug,
  ]);

  const optimizeCopyMutation = trpc.mvAnalysis.optimizeCustomCopy.useMutation();
  const canvasTerraVisionMutation = trpc.mvAnalysis.canvasTerraVisionMarkdown.useMutation();
  const canvasTerraVideoReverseMutation = trpc.mvAnalysis.canvasTerraVideoReverse.useMutation();
  const expandWriterMutation = trpc.mvAnalysis.expandManhuaWriterPack.useMutation();
  const getSignedUrlMutation = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();

  const pathTrackStatus = useMemo(
    () => summarizeManhuaPathTrackStatus(factoryPathAnnotation),
    [factoryPathAnnotation],
  );
  const narrativeLightingLabelZh = useMemo(() => {
    const e = getNarrativeLightingById(factoryNarrativeLightingId);
    return e ? `${e.nameZh}（${e.stageZh}）` : "";
  }, [factoryNarrativeLightingId]);

  const assembleManhuaFinal = useCallback(
    async (
      clips: Array<{
        episodeIndex: number;
        episodeTitle?: string;
        clipUrl?: string;
        keyartUrl?: string;
      }>,
    ) => {
      if (assembleBusy || factoryBusy) return;
      const ready = clips.filter((c) => c.clipUrl);
      if (!ready.length) {
        toast.error("至少需要一集成片才能合成长片");
        return;
      }
      setAssembleBusy(true);
      pushDebug("assemble:start", {
        level: "info",
        detail: `clips=${ready.map((c) => c.episodeIndex).join(",")}`,
      });
      const charged: Array<"music" | "final_render"> = [];
      try {
        await chargeWorkflowStepMutation.mutateAsync({ step: "music", quantity: 1 });
        charged.push("music");
        await chargeWorkflowStepMutation.mutateAsync({ step: "final_render", quantity: 1 });
        charged.push("final_render");

        // 短入队（www→Vercel rewrite→Fly）+ GET 轮询，不走长任务直连 api 子域
        pushDebug("assemble:music", { level: "info", detail: "queued · polling…" });
        const { jobId } = await createJobSameOrigin({
          type: "video",
          userId: user?.id ? String(user.id) : "",
          input: buildManhuaAssembleJobInput({
            clips: ready,
            topic: factoryTopic,
            seriesTitle: writerPack?.seriesTitle || projectBible?.seriesTitle || "",
            logline: writerPack?.logline || projectBible?.logline || "",
            musicDuration: MANHUA_ASSEMBLE_MUSIC_DURATION_SEC,
            musicVolume: 0.35,
            musicFadeInSec: 1,
            musicFadeOutSec: 2,
          }),
        });
        pushDebug("assemble:queued", { level: "info", detail: `jobId=${jobId}` });
        const job = await pollJobUntilTerminal(jobId, {
          maxWaitMs: 18 * 60_000,
          intervalMs: 3000,
          onPoll: (tick) => {
            if (tick.attempt === 1 || tick.attempt % 5 === 0) {
              pushDebug("assemble:poll", {
                level: "info",
                detail: `#${tick.attempt} · ${tick.status} · ${Math.round(tick.elapsedMs / 1000)}s`,
              });
            }
          },
        });
        if (job.status !== "succeeded") {
          throw new Error(job.error || "合成失败");
        }
        const out = (job.output || {}) as {
          finalVideoUrl?: string;
          videoUrl?: string;
          sceneCount?: number;
        };
        const finalVideoUrl = String(out.finalVideoUrl || out.videoUrl || "").trim();
        if (!finalVideoUrl) throw new Error("合成完成但未返回成片地址");
        setFinalAssembleVideoUrl(finalVideoUrl);
        pushDebug("assemble:done", {
          level: "ok",
          detail: `scenes=${out.sceneCount || ready.length} · final ok`,
          response: finalVideoUrl.slice(0, 180),
        });
        toast.success(`长片已合成（${out.sceneCount || ready.length} 集 + 配乐）`);
        window.setTimeout(() => {
          document.querySelector("#manhua-clip-dock-zone")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 80);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "合成失败";
        for (const step of charged.reverse()) {
          void refundWorkflowStepMutation
            .mutateAsync({ step, quantity: 1, reason: `漫剧合成失败退款·${step}` })
            .catch(() => {});
        }
        pushDebug("assemble:error", { level: "error", detail: msg });
        toast.error(msg);
      } finally {
        setAssembleBusy(false);
      }
    },
    [
      assembleBusy,
      factoryBusy,
      chargeWorkflowStepMutation,
      refundWorkflowStepMutation,
      factoryTopic,
      writerPack?.seriesTitle,
      writerPack?.logline,
      projectBible?.seriesTitle,
      projectBible?.logline,
      pushDebug,
      user?.id,
    ],
  );

  /** 仅出片后台：id→垫图 path，绝不写入节点提示词 */
  const manhuaAssetPathById = useMemo(() => {
    const reg = buildManhuaAssetLockRegistry({
      characterIds: selectedCharacterIds,
      artStyleId: factoryArtStyleId,
      sceneId: factorySceneId,
      propIds: factoryPropIds,
      customRefs: customAssetRefs,
      characterLookSets,
      assetCanon: projectBible?.assetCanon,
      characterSheetUrlById: collectManhuaCharacterSheetUrlById(
        blocks,
        projectBible?.assetCanon,
      ),
    });
    return buildManhuaAssetPathById(reg);
  }, [
    selectedCharacterIds,
    factoryArtStyleId,
    factorySceneId,
    factoryPropIds,
    customAssetRefs,
    characterLookSets,
    projectBible?.assetCanon,
    blocks,
  ]);

  const runDeps = useMemo<CanvasRunDeps>(
    () => ({
      userId: user?.id ? String(user.id) : "",
      characterVoiceLocks,
      manhuaAssetPathById,
      getManhuaEpisodeSegmentPromptsForVoiceGate: (episodeIndex) =>
        collectManhuaEpisodeSegmentPromptsForVoiceGate(blocksRef.current, episodeIndex),
      optimizeCopy: async ({ sourceText, optimizationBrief, modelName }) => {
        const t0 = Date.now();
        const reqPreview = [
          `model=${modelName || "default"}`,
          optimizationBrief ? `brief:\n${optimizationBrief.slice(0, 2000)}` : "",
          `source:\n${String(sourceText || "").slice(0, 6000)}`,
        ]
          .filter(Boolean)
          .join("\n\n");
        const maxAttempts = 3;
        let lastErr: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const res = await optimizeCopyMutation.mutateAsync({
              sourceText,
              optimizationBrief,
              modelName,
            });
            const md = res.result.optimizedMarkdown;
            if (debugMode) {
              pushDebug("optimizeCopy:ok", {
                level: "ok",
                ms: Date.now() - t0,
                detail: `model=${modelName || "default"} · out=${md.length}c · try=${attempt}`,
                request: reqPreview,
                response: md.slice(0, 8000),
              });
            }
            return md;
          } catch (e: unknown) {
            lastErr = e;
            const msg = e instanceof Error ? e.message : "optimizeCopy failed";
            const canRetry = attempt < maxAttempts && isTransientFactoryError(msg);
            if (debugMode) {
              pushDebug(canRetry ? "optimizeCopy:retry" : "optimizeCopy:error", {
                level: canRetry ? "warn" : "error",
                ms: Date.now() - t0,
                detail: canRetry ? `try=${attempt}/${maxAttempts} · ${msg}` : msg,
                request: reqPreview,
                response: msg,
              });
            }
            if (!canRetry) {
              throw new Error(formatManhuaFactoryUserError(msg));
            }
            await new Promise((r) => setTimeout(r, 1200 * attempt));
          }
        }
        throw lastErr instanceof Error
          ? new Error(formatManhuaFactoryUserError(lastErr.message))
          : new Error("文案生成失败，请稍后重试");
      },
      canvasTerraVisionMarkdown: async ({ prompt, images }) => {
        const res = await canvasTerraVisionMutation.mutateAsync({ prompt, images });
        const md = String(res.markdown || "").trim();
        if (!md) throw new Error("多图分析返回为空");
        return md;
      },
      canvasTerraVideoReverse: async ({ userHint, images, outputMode, targetEngine }) => {
        const res = await canvasTerraVideoReverseMutation.mutateAsync({
          userHint,
          images,
          outputMode,
          targetEngine,
        });
        const md = String(res.markdown || "").trim();
        if (!md) throw new Error("视频反推返回为空");
        return md;
      },
      uploadImageFile: async (file) => {
        const { uploadOneCanvasAsset } = await import("@/lib/canvasUpload");
        const asset = await uploadOneCanvasAsset({
          file,
          index: Date.now() % 1000,
          getSignedUploadUrl: (input) => getSignedUrlMutation.mutateAsync(input),
        });
        return asset.url;
      },
    }),
    [
      optimizeCopyMutation,
      canvasTerraVisionMutation,
      canvasTerraVideoReverseMutation,
      getSignedUrlMutation,
      debugMode,
      pushDebug,
      user?.id,
      characterVoiceLocks,
      manhuaAssetPathById,
    ],
  );

  /** Terra：中文运镜说明润色（编剧大师人设） */
  const translateMotionZh = useCallback(
    async (englishMotion: string) => {
      const src = String(englishMotion || "").trim();
      if (!src) return "";
      const md = await runDeps.optimizeCopy({
        sourceText: src,
        optimizationBrief: MANHUA_SCREENWRITER_TRANSLATE_BRIEF,
        modelName: MANHUA_SCREENWRITER_TERRA_MODEL,
      });
      return String(md || "").trim();
    },
    [runDeps],
  );

  const handleBlocksChange = useCallback(
    (next: CanvasBlock[] | ((prev: CanvasBlock[]) => CanvasBlock[])) => {
      setBlocks((cur) => {
        const resolved = typeof next === "function" ? next(cur) : next;
        const cleaned = sanitizeManhuaClipBlocksPrompts(resolved);
        setEdges((edges) => {
          saveCanvasState(cleaned, edges);
          return edges;
        });
        return cleaned;
      });
    },
    [],
  );

  // 进页一次：清掉历史成片节点里误写的网址（裸奔）
  useEffect(() => {
    setBlocks((cur) => {
      const cleaned = sanitizeManhuaClipBlocksPrompts(cur);
      if (cleaned === cur) return cur;
      setEdges((edges) => {
        saveCanvasState(cleaned, edges);
        return edges;
      });
      return cleaned;
    });
    // 仅挂载时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEdgesChange = useCallback((next: CanvasEdge[]) => {
    setEdges(next);
    setBlocks((cur) => {
      saveCanvasState(cur, next);
      return cur;
    });
  }, []);

  const stageChipStatus = useMemo(() => {
    const scoped = filterBlocksByEpisode(blocks, writerFocusEpisode);
    const pool = scoped.length ? scoped : blocks;
    return MANHUA_FACTORY_STAGE_ORDER.flatMap((stage) => {
      const b = pool.find((x) => x.id.startsWith(`${stage}-`));
      // 第 1–2 集无 recap_card：不展示空闲 chip，避免误导
      if (stage === "recap_card" && !b) return [];
      return [
        {
          stage,
          label: MANHUA_FACTORY_STAGE_LABEL_ZH[stage],
          status: b?.status || ("idle" as const),
        },
      ];
    });
  }, [blocks, writerFocusEpisode]);

  const resolveRunEpisodeIndexes = useCallback(
    (sourceBlocks: CanvasBlock[] = blocks): number[] => {
      if (factoryRunScope === "dock") {
        const items = collectManhuaClipDockItems(sourceBlocks);
        const fromDock = episodeIndexesFromDockSelection(items, dockSelectedIds);
        if (fromDock.length) return fromDock;
        toast.message("坞内未勾选片段，改跑焦点集");
      }
      const onCanvas = new Set(
        sourceBlocks.map((b) => getBlockEpisodeIndex(b)).filter((n): n is number => n != null),
      );
      if (onCanvas.has(writerFocusEpisode) || !onCanvas.size) {
        return [writerFocusEpisode];
      }
      // 焦点集链尚未铺上时，仍优先跑焦点集（ensureStudioSpawned 应已补铺）
      return [writerFocusEpisode];
    },
    [factoryRunScope, blocks, dockSelectedIds, writerFocusEpisode],
  );

  const remapDockSelectionAfterSpawn = useCallback(
    (nextBlocks: CanvasBlock[], touchedEpisode?: number) => {
      setDockSelectedIds((prev) => {
        const alive = new Set(nextBlocks.map((b) => b.id));
        const next = new Set<string>();
        for (const id of Array.from(prev)) {
          if (alive.has(id)) next.add(id);
        }
        if (touchedEpisode != null) {
          const story = nextBlocks.find(
            (b) => b.id.startsWith("story-") && getBlockEpisodeIndex(b) === touchedEpisode,
          );
          if (story) next.add(story.id);
        }
        return next;
      });
    },
    [],
  );

  const ensureStudioSpawned = useCallback(
    (topic?: string) => {
      const focusEp = Math.max(1, Math.floor(writerFocusEpisode));
      if (manhuaEpisodeHasFactoryChain(blocks, focusEp)) {
        const nextBlocks = topic ? applyTopicToFactoryStory(blocks, topic) : blocks;
        if (topic) {
          setBlocks(nextBlocks);
          saveCanvasState(nextBlocks, edges);
        }
        return { blocks: nextBlocks, edges };
      }

      const continuity =
        writerConfirmed && writerPack
          ? resolveManhuaEpisodeSpawnContinuity(writerPack.episodes, focusEp)
          : {
              episodeIndex: focusEp,
              episodeTitle: undefined as string | undefined,
              endingHook: undefined as string | undefined,
              previousEndingHook: undefined as string | undefined,
              previouslyOnRecap: undefined as string | undefined,
            };
      const focusCtx =
        writerConfirmed && writerPack
          ? composeWriterPackFactoryContext(writerPack, continuity.episodeIndex, {
              assetCanonAddonZh: projectBible?.assetCanon
                ? formatWriterAssetCanonFactoryAddon(
                    projectBible.assetCanon,
                    continuity.episodeIndex,
                  )
                : undefined,
            })
          : writerContext;
      const hardCast =
        writerConfirmed || directorUnlocked
          ? resolveHardCastForSpawn({
              topicOverride: topic || factoryTopic,
              charactersMd: writerPack?.charactersMd,
            })
          : null;
      const identityFromCanon = projectBible?.assetCanon
        ? formatWriterAssetCanonIdentityLock(projectBible.assetCanon, {
            episodeIndex: continuity.episodeIndex,
          })
        : "";
      let spawned = spawnManhuaDramaStudio({
        originX: 60,
        originY: 80 + Math.max(0, continuity.episodeIndex - 1) * 420,
        topic,
        seriesTitle: writerPack?.seriesTitle,
        genreId: factoryGenreId || undefined,
        sceneId: factorySceneId || undefined,
        propIds: hardCast?.propIds ?? factoryPropIds,
        characterIds: hardCast?.characterIds ?? selectedCharacterIds,
        ancientArchetypeIds: hardCast?.ancientArchetypeIds ?? factoryAncientArchetypeIds,
        identityLockZh:
          identityFromCanon ||
          hardCast?.identityLockZh ||
          factoryIdentityLockZh ||
          castBundle.identityLockZh,
        artStyleId: factoryArtStyleId,
        motionPromptIds: selectedMotionIds,
        craftShotIds: selectedCraftShotIds,
        pathCameraRecipeIds: selectedPathRecipeIds,
        pathAnnotationJson: factoryPathAnnotation,
        narrativeLightingIds: selectedNarrativeLightingIds,
        maleHairstyleIds: selectedMaleHairstyleIds,
        maleMicroExpressionIds: selectedMaleMicroIds,
        promoCoverLayoutIds: selectedPromoLayoutIds,
        actionCameraRecipeIds: selectedActionRecipeIds,
        cineVocabIds: selectedCineVocabIds,
            cineVocabLocale: factoryCineVocabLocale,
        wardrobePropContinuityIds: hardCast?.wardrobePropContinuityIds ?? selectedWardrobeIds,
        videoReverseOutputMode: factoryReverseMode,
        customRefs: customAssetRefs,
        assetCanon: projectBible?.assetCanon,
        stylePack,
        writerContext: focusCtx,
        includeDirectorCraft: Boolean(focusCtx) || directorUnlocked,
        episodeIndex: continuity.episodeIndex,
        episodeTitle: continuity.episodeTitle,
        endingHook: continuity.endingHook,
        previousEndingHook: continuity.previousEndingHook,
        previouslyOnRecap: continuity.previouslyOnRecap,
      });
      spawned = {
        ...spawned,
        blocks: layoutManhuaEpisodeReadableChain(spawned.blocks, writerFocusEpisode, {
          assetCanon: projectBible?.assetCanon,
          characterSheetUrlById: collectManhuaCharacterSheetUrlById(
            spawned.blocks,
            projectBible?.assetCanon,
          ),
        }),
      };
      if (spawned.genreInferred && spawned.resolvedGenreId && !factoryGenreId) {
        setFactoryGenreId(spawned.resolvedGenreId);
        toast.message(
          `已按题材自动套用剧种「${MANHUA_SCENE_GENRE_LABEL_ZH[spawned.resolvedGenreId as keyof typeof MANHUA_SCENE_GENRE_LABEL_ZH] || spawned.resolvedGenreId}」`,
        );
      }
      if (spawned.resolvedSceneId && !factorySceneId) {
        setFactorySceneId(spawned.resolvedSceneId);
      }

      const hasOtherEpisodes = blocks.some((b) => {
        const ep = getBlockEpisodeIndex(b);
        return ep != null && ep !== continuity.episodeIndex;
      });
      const next = hasOtherEpisodes
        ? replaceManhuaEpisodeChain(blocks, edges, spawned, continuity.episodeIndex)
        : spawned;
      setBlocks(next.blocks);
      setEdges(next.edges);
      saveCanvasState(next.blocks, next.edges);
      remapDockSelectionAfterSpawn(next.blocks, continuity.episodeIndex);
      if (hasOtherEpisodes) {
        toast.message(`已补铺第${continuity.episodeIndex}集工厂链`);
      }
      return next;
    },
    [
      blocks,
      edges,
      factoryGenreId,
      factorySceneId,
      factoryPropIds,
      factoryArtStyleId,
      factoryTopic,
      factoryAncientArchetypeIds,
      factoryIdentityLockZh,
      castBundle.identityLockZh,
      resolveHardCastForSpawn,
      selectedCharacterIds,
      selectedMotionIds,
      selectedCraftShotIds,
      selectedPathRecipeIds,
      factoryPathAnnotation,
      selectedNarrativeLightingIds,
      selectedMaleHairstyleIds,
      selectedMaleMicroIds,
      selectedPromoLayoutIds,
      selectedActionRecipeIds,
      selectedCineVocabIds,
      selectedWardrobeIds,
      factoryReverseMode,
      customAssetRefs,
      stylePack,
      writerContext,
      directorUnlocked,
      writerConfirmed,
      writerPack,
      writerFocusEpisode,
      projectBible?.assetCanon,
      remapDockSelectionAfterSpawn,
    ],
  );

  const expandWriterRoom = useCallback(async () => {
    const topic = factoryTopic.trim();
    const brief = writerBrief.trim();
    if (!topic && !brief) {
      toast.error("请先填写题材，或至少写几句补充条件");
      return;
    }
    // 重扩写：旧剧情包不再留备份，以新稿为准（先提醒再跑）
    if (writerPack) {
      const ok = window.confirm(
        "重新扩写将以新剧本为准，覆盖本机与云端的旧剧情包（不再保留旧备份）。是否继续？",
      );
      if (!ok) return;
    }
    setWriterBusy(true);
    setWriterConfirmed(false);
    setDirectorUnlocked(false);
    setProjectBible(null);
    setCustomAssetRefs([]);
    setWriterConfirmBlockers([]);
    setViralTemplateId("");
    const t0 = Date.now();
    const count = clampWriterEpisodeCount(writerEpisodeCount);
    const designInject = [
      buildMaleHairstyleInjectBlock(selectedMaleHairstyleIds),
      buildMaleMicroExpressionInjectBlock(selectedMaleMicroIds),
    ]
      .filter(Boolean)
      .join("\n\n");
    const mergedBrief = [brief, designInject].filter(Boolean).join("\n\n");
    const reqPreview = `topic=${topic}\nepisodes=${count}\nbrief:\n${mergedBrief.slice(0, 4000)}\nviralTemplate=${viralTemplateId || "off"}`;
    pushDebug("expandWriterPack:start", {
      detail: `topicLen=${topic.length} briefLen=${brief.length} episodes=${count} overwriteOld=1 viralTemplate=${viralTemplateId || "off"}`,
      request: reqPreview,
    });
    /** 服务端 300s；客户端略宽一点，超时必须解锁，避免旧稿挂着却一直「正在扩写」 */
    const EXPAND_CLIENT_TIMEOUT_MS = 320_000;
    try {
      const res = await Promise.race([
        expandWriterMutation.mutateAsync({
          topic,
          brief: mergedBrief || undefined,
          episodeCount: count,
          viralTemplateId: viralTemplateId || undefined,
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            reject(new Error("剧情扩写超时，请稍后重试（旧稿未改动）"));
          }, EXPAND_CLIENT_TIMEOUT_MS);
        }),
      ]);
      const pack = res.pack;
      if (isPlaceholderSeriesTitle(pack.seriesTitle)) {
        const fallback = deriveSeriesTitleFromTopic(topic);
        if (fallback) pack.seriesTitle = fallback;
      }
      if (!res.ready && !writerPackLooksReady(pack)) {
        toast.message("已生成草稿，建议检查每集片尾钩子是否完整");
      }
      // 新剧情包不应继续展示旧静帧/成片/多集坞（云草稿残留）
      const cleaned = stripManhuaFactoryCanvasArtifacts(blocks, edges);
      const nextBlocks = cleaned.removedCount > 0 ? cleaned.blocks : blocks;
      const nextEdges = cleaned.removedCount > 0 ? cleaned.edges : edges;
      if (cleaned.removedCount > 0) {
        if (abortRef.current) abortRef.current.abort();
        setBlocks(nextBlocks);
        setEdges(nextEdges);
        saveCanvasState(nextBlocks, nextEdges);
        setDockSelectedIds(new Set());
        setWorkflowPhase("outline");
      }
      setWriterPack(pack);
      setWriterFocusEpisode(1);
      setWriterConfirmBlockers([]);
      // 新剧本立刻落盘并覆盖本机+云端旧稿，避免刷新后又被旧云草稿盖回
      const clientUpdatedAt = new Date().toISOString();
      setCharacterVoiceLocks([]);
      const writerSession = {
        topic,
        brief,
        episodeCount: count,
        focusEpisode: 1,
        writerPack: pack,
        writerConfirmed: false,
        directorUnlocked: false,
        projectBible: null,
        manhuaUiMode,
        assetsSkipped: false,
        workflowPhase: "outline" as const,
        customAssetRefs: [] as ManhuaCustomAssetRef[],
        characterVoiceLocks: [] as ManhuaCharacterVoiceLock[],
        shareAssetToLibrary,
        viralTemplateId,
      };
      const factoryPrefs = {
        topic,
        femaleId: factoryFemaleId,
        maleId: factoryMaleId,
        artStyleId: factoryArtStyleId,
        femaleLeadManual,
        maleLeadManual,
        artStyleManual,
        customAssetRefs: [] as ManhuaCustomAssetRef[],
        shareAssetToLibrary,
      };
      persistManhuaDraftLocally({
        writerSession,
        blocks: nextBlocks,
        edges: nextEdges,
        factoryPrefs,
        clientUpdatedAt,
      });
      void syncCloudDraftPayload(
        buildLocalCloudDraftSnapshot({
          writerSession,
          blocks: nextBlocks,
          edges: nextEdges,
          factoryPrefs,
          clientUpdatedAt,
        }),
      );
      const epDigest = pack.episodes
        .map((ep) => `第${ep.index}集·${ep.title || ""}：${String(ep.endHook || "").slice(0, 80)}`)
        .join("\n");
      pushDebug("expandWriterPack:ok", {
        level: "ok",
        ms: Date.now() - t0,
        detail: `${pack.seriesTitle || "—"} · ${pack.episodes.length}ep · ready=${Boolean(res.ready)} · clearedFactory=${cleaned.removedCount} · overwritten=1 · viralTemplate=${viralTemplateId || "off"}`,
        request: reqPreview,
        response: `${pack.seriesTitle || ""}\n${pack.logline || ""}\n${epDigest}`.slice(0, 8000),
      });
      toast.success(
        cleaned.removedCount > 0
          ? `已扩写 ${pack.episodes.length} 集：新剧本已覆盖本机与云端旧稿，并清空旧分镜/成片`
          : `已扩写 ${pack.episodes.length} 集：新剧本已覆盖本机与云端旧稿`,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "扩写失败";
      pushDebug("expandWriterPack:error", {
        level: "error",
        ms: Date.now() - t0,
        detail: msg,
        request: reqPreview,
        response: msg,
      });
      toast.error(msg);
    } finally {
      setWriterBusy(false);
    }
  }, [
    factoryTopic,
    writerBrief,
    writerEpisodeCount,
    viralTemplateId,
    expandWriterMutation,
    selectedMaleHairstyleIds,
    selectedMaleMicroIds,
    blocks,
    edges,
    pushDebug,
    writerPack,
    manhuaUiMode,
    shareAssetToLibrary,
    factoryFemaleId,
    factoryMaleId,
    factoryArtStyleId,
    femaleLeadManual,
    maleLeadManual,
    artStyleManual,
    syncCloudDraftPayload,
  ]);

  const viralTemplatesRemoteQuery = trpc.manhuaViralTemplate.listApproved.useQuery(undefined, {
    staleTime: 60_000,
    retry: 1,
  });
  const viralTemplateGrouped = useMemo(() => {
    const remote = viralTemplatesRemoteQuery.data?.groups;
    if (remote && remote.length > 0) {
      return remote as Array<{ laneZh: ManhuaViralTemplateLane; items: ManhuaViralTemplateCard[] }>;
    }
    return listApprovedManhuaViralTemplatesGrouped();
  }, [viralTemplatesRemoteQuery.data]);
  const selectedViralTemplate = useMemo(() => {
    const extras = viralTemplateGrouped.flatMap((g) => g.items);
    return getManhuaViralTemplate(viralTemplateId, extras);
  }, [viralTemplateId, viralTemplateGrouped]);

  const importWriterRoomFromText = useCallback(
    (raw: string) => {
      const text = String(raw || "").trim();
      if (!text) {
        toast.error("请先粘贴剧本，或选择 .txt / .md 文件");
        return;
      }
      const res = importManhuaWriterPackFromText(text, {
        topic: factoryTopic.trim() || undefined,
        episodeCount: writerEpisodeCount,
      });
      if (!res.ok) {
        toast.error(res.error);
        pushDebug("importWriterPack:error", {
          level: "error",
          detail: res.error,
          request: text.slice(0, 4000),
        });
        return;
      }
      const cleaned = stripManhuaFactoryCanvasArtifacts(blocks, edges);
      if (cleaned.removedCount > 0) {
        if (abortRef.current) abortRef.current.abort();
        setBlocks(cleaned.blocks);
        setEdges(cleaned.edges);
        saveCanvasState(cleaned.blocks, cleaned.edges);
        setDockSelectedIds(new Set());
        setWorkflowPhase("outline");
      }
      setWriterPack(res.pack);
      setWriterConfirmed(false);
      setProjectBible(null);
      setWriterFocusEpisode(1);
      setWriterEpisodeCount(res.pack.episodeCount);
      setWriterImportDraft(text);
      setWriterConfirmBlockers([]);
      if (!factoryTopic.trim()) {
        setFactoryTopic(res.pack.seriesTitle);
      }
      pushDebug("importWriterPack:ok", {
        level: "ok",
        detail: `${res.pack.seriesTitle} · ${res.pack.episodes.length}ep · via=${res.via} · clearedFactory=${cleaned.removedCount}`,
        request: text.slice(0, 4000),
        response: res.pack.episodes.map((ep) => `第${ep.index}集·${ep.title}`).join("\n"),
      });
      toast.success(
        cleaned.removedCount > 0
          ? `已导入 ${res.pack.episodes.length} 集《${res.pack.seriesTitle}》，并清空旧分镜/成片`
          : `已导入 ${res.pack.episodes.length} 集《${res.pack.seriesTitle}》，确认后再进入编导`,
      );
    },
    [factoryTopic, writerEpisodeCount, blocks, edges, pushDebug],
  );

  const onWriterImportFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      const name = file.name.toLowerCase();
      if (!/\.(txt|md|markdown)$/.test(name) && file.type && !/^text\//i.test(file.type)) {
        toast.error("请上传 .txt 或 .md 文本文件");
        return;
      }
      if (file.size > 2_000_000) {
        toast.error("文件过大，请控制在约 2MB 以内");
        return;
      }
      try {
        const text = await file.text();
        importWriterRoomFromText(text);
      } catch {
        toast.error("读取文件失败，请改用粘贴导入");
      }
    },
    [importWriterRoomFromText],
  );

  const confirmWriterToDirector = useCallback(() => {
    if (!writerPack || !writerPackLooksReady(writerPack)) {
      toast.error("请先扩写或导入剧本，并检查剧情包是否完整");
      return;
    }
    const densityGate = evaluateWriterPackAssetAndDensity({
      charactersMd: writerPack.charactersMd,
      propsMd: writerPack.propsMd,
      locationsMd: writerPack.locationsMd,
      episodes: writerPack.episodes,
      targetSec: 180,
    });
    if (!densityGate.ok) {
      setWriterConfirmBlockers(densityGate.errors.slice(0, 6));
      toast.error("剧本未过三分钟密度/资产表门禁", {
        description: densityGate.errors.slice(0, 4).join("；"),
      });
      pushDebug("confirmWriterToDirector", {
        level: "warn",
        detail: densityGate.errors.join(" | ").slice(0, 500),
      });
      return;
    }
    setWriterConfirmBlockers([]);
    const canon = densityGate.canon;
    setWriterConfirmed(true);
    setDirectorUnlocked(true);
    const topicForSpawn = factoryTopic.trim() || writerPack.seriesTitle || writerPack.logline || "连载短剧";
    if (!factoryTopic.trim()) {
      setFactoryTopic(topicForSpawn);
    }
    // 库 Cast 仍作可选补充；身份锁与场景以编剧表真源为准
    const hardCast = resolveHardCastForSpawn({
      topicOverride: topicForSpawn,
      charactersMd: writerPack.charactersMd,
    });
    const continuity = resolveManhuaEpisodeSpawnContinuity(writerPack.episodes, writerFocusEpisode);
    const mainSceneId =
      canon.episodeMainSceneId[continuity.episodeIndex] || canon.locations[0]?.id || "";
    const identityFromCanon = formatWriterAssetCanonIdentityLock(canon, {
      episodeIndex: continuity.episodeIndex,
    });
    // 主场景跟编剧表，勿残留题材推荐的皇宫大殿库 id
    if (mainSceneId) {
      setFactorySceneId(mainSceneId);
    }
    const sceneForBible = mainSceneId || factorySceneId || recommendedScene?.id || "";
    const bible = buildManhuaProjectBible({
      topic: topicForSpawn,
      pack: writerPack,
      cast: {
        lane: hardCast.lane,
        characterIds: hardCast.characterIds,
        ancientArchetypeIds: hardCast.ancientArchetypeIds,
        artStyleId: factoryArtStyleId,
        sceneId: sceneForBible || undefined,
        propIds: hardCast.propIds,
        wardrobePropContinuityIds: hardCast.wardrobePropContinuityIds,
        identityLockZh: identityFromCanon || hardCast.identityLockZh,
      },
      focusEpisode: continuity.episodeIndex,
      assetCanon: canon,
      manualOverrides: {
        femaleLead: femaleLeadManual,
        maleLead: maleLeadManual,
        ancient: ancientManual,
        artStyle: artStyleManual,
        scene: sceneManual,
        props: propManual,
        wardrobe: wardrobeManual,
      },
    });
    setProjectBible(bible);
    setFactoryIdentityLockZh(identityFromCanon || hardCast.identityLockZh || "");
    const spawned = spawnManhuaDramaStudio({
      originX: 60,
      originY: 80 + Math.max(0, continuity.episodeIndex - 1) * 420,
      topic: topicForSpawn,
      seriesTitle: writerPack.seriesTitle,
      genreId: factoryGenreId || undefined,
      sceneId: factorySceneId || undefined,
      propIds: hardCast.propIds,
      characterIds: hardCast.characterIds,
      ancientArchetypeIds: hardCast.ancientArchetypeIds,
      identityLockZh: identityFromCanon || hardCast.identityLockZh,
      artStyleId: factoryArtStyleId,
      motionPromptIds: selectedMotionIds,
      craftShotIds: selectedCraftShotIds,
      pathCameraRecipeIds: selectedPathRecipeIds,
      pathAnnotationJson: factoryPathAnnotation,
      narrativeLightingIds: selectedNarrativeLightingIds,
      maleHairstyleIds: selectedMaleHairstyleIds,
      maleMicroExpressionIds: selectedMaleMicroIds,
      promoCoverLayoutIds: selectedPromoLayoutIds,
      actionCameraRecipeIds: selectedActionRecipeIds,
      cineVocabIds: selectedCineVocabIds,
            cineVocabLocale: factoryCineVocabLocale,
      wardrobePropContinuityIds: hardCast.wardrobePropContinuityIds,
      videoReverseOutputMode: factoryReverseMode,
      customRefs: customAssetRefs,
      assetCanon: projectBible?.assetCanon,
      writerContext: composeWriterPackFactoryContext(writerPack, continuity.episodeIndex, {
        assetCanonAddonZh: formatWriterAssetCanonFactoryAddon(canon, continuity.episodeIndex),
      }),
      includeDirectorCraft: true,
      episodeIndex: continuity.episodeIndex,
      episodeTitle: continuity.episodeTitle,
      endingHook: continuity.endingHook,
      previousEndingHook: continuity.previousEndingHook,
      previouslyOnRecap: continuity.previouslyOnRecap,
    });
    if (spawned.genreInferred && spawned.resolvedGenreId && !factoryGenreId) {
      setFactoryGenreId(spawned.resolvedGenreId);
    }
    if (spawned.resolvedSceneId && !factorySceneId) {
      setFactorySceneId(spawned.resolvedSceneId);
    }
    // 确认编剧 = 以新剧情铺链；先剥尽旧工厂产物，避免旧系列多集坞/英文4镜残留
    const cleaned = stripManhuaFactoryCanvasArtifacts(blocks, edges);
    // 旧「我的角色/场景」生成垫图若不跟新剧本表，会把门禁误报已齐并藏掉「生成全部」
    const purgedRefs = purgeStaleCustomAssetRefsForCanon(customAssetRefs, canon, {
      forceAllGenerated: true,
    });
    if (purgedRefs.removedCount > 0) {
      setCustomAssetRefs(purgedRefs.refs);
    }
    const next = {
      blocks: [...cleaned.blocks, ...spawned.blocks],
      edges: [...cleaned.edges, ...spawned.edges],
      resolvedGenreId: spawned.resolvedGenreId,
      genreInferred: spawned.genreInferred,
      resolvedSceneId: spawned.resolvedSceneId,
      characterIds: spawned.characterIds,
    };
    setBlocks(next.blocks);
    setEdges(next.edges);
    saveCanvasState(next.blocks, next.edges);
    remapDockSelectionAfterSpawn(next.blocks, continuity.episodeIndex);
    const tips = [
      continuity.previousEndingHook ? "上集钩子" : null,
      continuity.previouslyOnRecap ? "前情提要" : null,
      `表人物${canon.characters.length}`,
      `场景池${canon.locations.length}`,
      mainSceneId ? `本集主场景已锁定` : null,
      cleaned.removedCount > 0 ? `已替换旧链${cleaned.removedCount}节点` : null,
    ].filter(Boolean);
    pushDebug("confirmWriterToDirector", {
      level: "ok",
      detail: `ep=${continuity.episodeIndex} · ${summarizeManhuaProjectBible(bible)} · canonChars=${canon.characters.length} · mainScene=${mainSceneId || "—"} · clearedFactory=${cleaned.removedCount}`,
    });
    setManhuaUiMode("workbench");
    setImmersiveExtrasOpen(false);
    // 确认剧本后先进资产设定：从剧本表自动出缺的角色/场景设定图，再进分镜
    setWorkflowPhase("assets");
    toast.success(
      `已确认剧情并锁定编剧表（${tips.join("·")}${
        purgedRefs.removedCount > 0 ? `·已清旧设定图${purgedRefs.removedCount}` : ""
      }）。正在从剧本出角色/场景设定图…`,
    );
    window.setTimeout(() => {
      void confirmAssetsAutoRef.current({
        assetCanonOverride: canon,
        episodeIndexOverride: continuity.episodeIndex,
        topicOverride: topicForSpawn,
        forceRegenerate: true,
      });
    }, 80);
  }, [
    writerPack,
    factoryTopic,
    resolveHardCastForSpawn,
    recommendedScene?.id,
    femaleLeadManual,
    maleLeadManual,
    ancientManual,
    artStyleManual,
    sceneManual,
    propManual,
    wardrobeManual,
    selectedMotionIds,
    selectedCraftShotIds,
    selectedPathRecipeIds,
    factoryPathAnnotation,
    selectedNarrativeLightingIds,
    selectedMaleHairstyleIds,
    selectedMaleMicroIds,
    selectedPromoLayoutIds,
    selectedActionRecipeIds,
    selectedCineVocabIds,
    factoryArtStyleId,
    factoryReverseMode,
    factoryGenreId,
    factorySceneId,
    writerFocusEpisode,
    blocks,
    edges,
    customAssetRefs,
    remapDockSelectionAfterSpawn,
    pushDebug,
  ]);

  const confirmWriterSeriesSpawn = useCallback(() => {
    if (!writerPack || !writerPackLooksReady(writerPack)) {
      toast.error("请先扩写并检查剧情包是否完整");
      return;
    }
    const densityGate = evaluateWriterPackAssetAndDensity({
      charactersMd: writerPack.charactersMd,
      propsMd: writerPack.propsMd,
      locationsMd: writerPack.locationsMd,
      episodes: writerPack.episodes,
      targetSec: 180,
    });
    if (!densityGate.ok) {
      setWriterConfirmBlockers(densityGate.errors.slice(0, 6));
      toast.error("剧本未过三分钟密度/资产表门禁", {
        description: densityGate.errors.slice(0, 4).join("；"),
      });
      return;
    }
    setWriterConfirmBlockers([]);
    const canon = densityGate.canon;
    const episodes = [...writerPack.episodes]
      .sort((a, b) => a.index - b.index)
      .slice(0, MANHUA_SERIES_SPAWN_MAX);
    const n = episodes.length;
    const nodeEstimate = episodes.reduce(
      (sum, ep) => sum + (shouldAttachManhuaPreviouslyOn(ep.index) ? 8 : 7),
      0,
    );
    if (
      !window.confirm(
        `将按集铺 ${n} 条工厂链（约 ${nodeEstimate} 个节点，最多 ${MANHUA_SERIES_SPAWN_MAX} 集同屏），积分与耗时较高。继续？`,
      )
    ) {
      return;
    }
    setWriterConfirmed(true);
    setDirectorUnlocked(true);
    const topicForSpawn = factoryTopic.trim() || writerPack.seriesTitle || writerPack.logline || "连载短剧";
    if (!factoryTopic.trim()) {
      setFactoryTopic(topicForSpawn);
    }
    const hardCast = resolveHardCastForSpawn({
      topicOverride: topicForSpawn,
      charactersMd: writerPack.charactersMd,
    });
    const identityFromCanon = formatWriterAssetCanonIdentityLock(canon, {
      episodeIndex: writerFocusEpisode,
    });
    const mainSceneId =
      canon.episodeMainSceneId[writerFocusEpisode] || canon.locations[0]?.id || "";
    if (mainSceneId) {
      setFactorySceneId(mainSceneId);
    }
    const sceneForBible = mainSceneId || factorySceneId || recommendedScene?.id || "";
    setProjectBible(
      buildManhuaProjectBible({
        topic: topicForSpawn,
        pack: writerPack,
        cast: {
          lane: hardCast.lane,
          characterIds: hardCast.characterIds,
          ancientArchetypeIds: hardCast.ancientArchetypeIds,
          artStyleId: factoryArtStyleId,
          sceneId: sceneForBible || undefined,
          propIds: hardCast.propIds,
          wardrobePropContinuityIds: hardCast.wardrobePropContinuityIds,
          identityLockZh: identityFromCanon || hardCast.identityLockZh,
        },
        focusEpisode: writerFocusEpisode,
        assetCanon: canon,
        manualOverrides: {
          femaleLead: femaleLeadManual,
          maleLead: maleLeadManual,
          ancient: ancientManual,
          artStyle: artStyleManual,
          scene: sceneManual,
          props: propManual,
          wardrobe: wardrobeManual,
        },
      }),
    );
    setFactoryIdentityLockZh(identityFromCanon || hardCast.identityLockZh || "");
    setManhuaUiMode("workbench");
    const spawned = spawnManhuaDramaStudioSeries({
      originX: 60,
      originY: 80,
      topic: topicForSpawn,
      seriesTitle: writerPack.seriesTitle,
      genreId: factoryGenreId || undefined,
      sceneId: factorySceneId || undefined,
      propIds: hardCast.propIds,
      characterIds: hardCast.characterIds,
      ancientArchetypeIds: hardCast.ancientArchetypeIds,
      identityLockZh: identityFromCanon || hardCast.identityLockZh,
      artStyleId: factoryArtStyleId,
      motionPromptIds: selectedMotionIds,
      craftShotIds: selectedCraftShotIds,
      pathCameraRecipeIds: selectedPathRecipeIds,
      pathAnnotationJson: factoryPathAnnotation,
      narrativeLightingIds: selectedNarrativeLightingIds,
      maleHairstyleIds: selectedMaleHairstyleIds,
      maleMicroExpressionIds: selectedMaleMicroIds,
      promoCoverLayoutIds: selectedPromoLayoutIds,
      actionCameraRecipeIds: selectedActionRecipeIds,
      cineVocabIds: selectedCineVocabIds,
            cineVocabLocale: factoryCineVocabLocale,
      wardrobePropContinuityIds: hardCast.wardrobePropContinuityIds,
      videoReverseOutputMode: factoryReverseMode,
      customRefs: customAssetRefs,
      assetCanon: projectBible?.assetCanon,
      episodes: episodes.map((ep) => ({
        index: ep.index,
        title: ep.title,
        endHook: ep.endHook,
        body: ep.body,
      })),
      writerContextForEpisode: (ep) =>
        composeWriterPackFactoryContext(writerPack, ep.index, {
          assetCanonAddonZh: formatWriterAssetCanonFactoryAddon(canon, ep.index),
        }),
      includeDirectorCraft: true,
      maxEpisodes: MANHUA_SERIES_SPAWN_MAX,
    });
    if (spawned.genreInferred && spawned.resolvedGenreId && !factoryGenreId) {
      setFactoryGenreId(spawned.resolvedGenreId);
    }
    if (spawned.resolvedSceneId && !factorySceneId) {
      setFactorySceneId(spawned.resolvedSceneId);
    }
    setBlocks(spawned.blocks);
    setEdges(spawned.edges);
    saveCanvasState(spawned.blocks, spawned.edges);
    // 铺板后预勾选各集 story，便于立刻用「成片坞已勾选集」跑多集
    setDockSelectedIds(
      new Set(spawned.blocks.filter((b) => b.id.startsWith("story-")).map((b) => b.id)),
    );
    setFactoryRunScope("dock");
    toast.success(
      `已按集铺板 ${spawned.episodeCount} 行链（上集钩子已注入；第3集起含前情提要片头；坞已预勾选可跑）`,
    );
  }, [
    writerPack,
    factoryTopic,
    resolveHardCastForSpawn,
    recommendedScene?.id,
    femaleLeadManual,
    maleLeadManual,
    ancientManual,
    artStyleManual,
    sceneManual,
    propManual,
    wardrobeManual,
    writerFocusEpisode,
    selectedMotionIds,
    selectedCraftShotIds,
    selectedPathRecipeIds,
    factoryPathAnnotation,
    selectedNarrativeLightingIds,
    selectedMaleHairstyleIds,
    selectedMaleMicroIds,
    selectedPromoLayoutIds,
    selectedActionRecipeIds,
    selectedCineVocabIds,
    factoryArtStyleId,
    factoryReverseMode,
    factoryGenreId,
    factorySceneId,
  ]);

  const stopFactory = useCallback(() => {
    if (!abortRef.current) {
      toast.message("当前没有进行中的生成");
      return;
    }
    abortRef.current.abort();
    toast.message("已请求中断", {
      description: "当前步骤结束后会停住；已完成的片段会保留，可改设定后继续测。",
    });
  }, []);

  const uploadCustomAssetFiles = useCallback(
    async (files: FileList | File[], role?: ManhuaCustomAssetRole) => {
      const list = Array.from(files || []).filter((f) => /^image\//i.test(f.type));
      if (!list.length) {
        toast.message("请选择图片文件");
        return;
      }
      const resolvedRole: ManhuaCustomAssetRef["role"] =
        role === "character" || role === "scene" || role === "prop" ? role : "unset";
      try {
        const { assets, failed } = await uploadCanvasFilesParallel({
          files: list,
          getSignedUploadUrl: (input) => getSignedUrlMutation.mutateAsync(input),
        });
        const added: ManhuaCustomAssetRef[] = assets
          .filter((a) => a.kind === "image" && /^https:\/\//i.test(a.url))
          .map((a) => ({
            id: makeManhuaCustomAssetId(),
            url: a.url,
            role: resolvedRole,
            labelZh: a.fileName?.replace(/\.[^.]+$/, "").slice(0, 40) || "上传参考",
            source: "upload" as const,
          }));
        if (added.length) {
          setCustomAssetRefs((prev) =>
            normalizeManhuaCustomAssetRefs([...prev, ...added]),
          );
          const roleZh =
            resolvedRole === "character"
              ? "人物"
              : resolvedRole === "scene"
                ? "场景"
                : resolvedRole === "prop"
                  ? "服装道具"
                  : "";
          toast.message(`已上传 ${added.length} 张${roleZh || "参考"}图`, {
            description: roleZh
              ? `已归入「我的${roleZh}」。`
              : "请到对应分区勾选人物、场景或服装道具。",
          });
        }
        if (failed.length) {
          toast.error(`${failed.length} 张上传失败`, {
            description: failed[0]?.error || "请重试",
          });
        }
      } catch (e: unknown) {
        toast.error("上传失败", {
          description: e instanceof Error ? e.message : "请稍后重试",
        });
      }
    },
    [getSignedUrlMutation],
  );

  const setCustomAssetRole = useCallback(
    (id: string, role: ManhuaCustomAssetRef["role"]) => {
      setCustomAssetRefs((prev) =>
        normalizeManhuaCustomAssetRefs(
          prev.map((r) =>
            r.id === id
              ? {
                  ...r,
                  role,
                  // 换分栏后按新角色自动填用途，仍可在下拉手改
                  refDuty: defaultManhuaCustomAssetRefDuty(role),
                }
              : r,
          ),
        ),
      );
    },
    [],
  );

  const setCustomAssetDuty = useCallback((id: string, duty: ManhuaCustomAssetRefDuty | null) => {
    setCustomAssetRefs((prev) =>
      normalizeManhuaCustomAssetRefs(
        prev.map((r) => (r.id === id ? { ...r, refDuty: duty } : r)),
      ),
    );
  }, []);

  const handleSegmentIntentChange = useCallback(
    (segmentIndex: number, intentZh: string) => {
      const intent = String(intentZh || "").trim().slice(0, 80);
      const ep = writerFocusEpisode;
      setWriterPack((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          episodes: prev.episodes.map((e) =>
            e.index === ep
              ? {
                  ...e,
                  body: upsertManhuaSegmentIntentInMarkdown(e.body || "", segmentIndex, intent),
                }
              : e,
          ),
        };
      });
      setBlocks((prev) => {
        const next = prev.map((b) => {
          if ((getBlockEpisodeIndex(b) ?? 1) !== ep) return b;
          const stage = stageKeyFromBlockId(b.id);
          if (stage !== "story" && stage !== "beats" && stage !== "reverse") return b;
          const base = b.outputText || b.prompt || "";
          const updated = upsertManhuaSegmentIntentInMarkdown(base, segmentIndex, intent);
          if (updated === base) return b;
          return {
            ...b,
            outputText: b.outputText != null ? updated : b.outputText,
            prompt: b.outputText != null ? b.prompt : updated,
          };
        });
        setEdges((eds) => {
          saveCanvasState(next, eds);
          return eds;
        });
        return next;
      });
    },
    [writerFocusEpisode],
  );

  const removeCustomAssetRef = useCallback((id: string) => {
    setCustomAssetRefs((prev) => prev.filter((r) => r.id !== id));
  }, []);

  /** 基于库参考生成新人物/场景/服装道具（扣费；授权进库半价） */
  const generateCustomAssetFromLibrary = useCallback(
    async (opts: { role: ManhuaCustomAssetRole; seedLibraryId: string }) => {
      if (factoryBusy) {
        toast.message("请等待当前生成结束");
        return;
      }
      if (!user?.id) {
        toast.message("请先登录后再生成资产图");
        return;
      }
      const seed = resolveManhuaCustomAssetSeed({
        role: opts.role,
        seedLibraryId: opts.seedLibraryId,
        artStyleId: factoryArtStyleId,
        topic: factoryTopic,
      });
      if (!seed) {
        toast.message("未找到库参考，请先点选对应库条目");
        return;
      }
      const style = getManhuaArtStylePreset(factoryArtStyleId);
      const prompt = buildManhuaCustomAssetGenFromLibraryPrompt({
        role: opts.role,
        seedLabelZh: seed.labelZh,
        seedPromptZh: seed.promptZh,
        topic: factoryTopic,
        artStyleLabelZh: style.labelZh,
        artStylePromptZh: style.promptZh,
      });
      // 有类似人物/服装道具/场景库图 → 垫图；无类似才纯文案出图
      const refAbs = seed.previewPath
        ? absolutizeManhuaAssetUrl(seed.previewPath, window.location.origin)
        : "";
      const usePad = Boolean(refAbs && /^https:\/\//i.test(refAbs) && seed.strategy !== "text");
      setFactoryBusy(true);
      const roleZh =
        opts.role === "character" ? "人物" : opts.role === "scene" ? "场景" : "服装道具";
      setFactoryProgress(
        usePad ? `基于库参考生成新${roleZh}…` : `按文案生成新${roleZh}…`,
      );
      try {
        toast.message(`正在生成新${roleZh}`, {
          description: usePad
            ? `${assetShareBillingUi.priceLabelZh} · 参考「${seed.labelZh}」`
            : `${assetShareBillingUi.priceLabelZh} · 按文案生成（库中无近似参考图）`,
        });
        const stillRole =
          opts.role === "character" || opts.role === "scene" || opts.role === "prop"
            ? opts.role
            : "prop"; // wardrobe → prop（出图 API 无服装独立 role）
        const res = await generateAssetStillMutation.mutateAsync({
          prompt,
          role: stillRole,
          shareToLibrary: shareAssetToLibrary,
          labelZh: `新${roleZh}·${seed.labelZh}`,
          aspectRatio: "9:16",
          referenceImageUrl: usePad ? refAbs : undefined,
        });
        const url = String(res.imageUrl || "").trim();
        if (!/^https:\/\//i.test(url)) {
          throw new Error("未返回可用图片地址");
        }
        const ref: ManhuaCustomAssetRef = {
          id: makeManhuaCustomAssetId(),
          url,
          role: opts.role,
          labelZh: `新${roleZh}·${seed.labelZh}`,
          source: "generated",
          seedLibraryId: seed.seedLibraryId,
        };
        setCustomAssetRefs((prev) => normalizeManhuaCustomAssetRefs([...prev, ref]));
        void assetShareQuote.refetch();
        const doneDesc = res.giftedBlocksHalfPrice
          ? `已扣 ${res.creditsCharged} 积分（兑换码积分原价），已无条件匿名进参考库`
          : res.halfPriceApplied
            ? `已扣 ${res.creditsCharged} 积分（半价），已匿名进参考库`
            : res.shareToLibrary
              ? `已扣 ${res.creditsCharged} 积分，已匿名进参考库`
              : `已扣 ${res.creditsCharged} 积分；勾选授权可用充值积分半价并进库`;
        toast.message(`已生成新${roleZh}并勾选`, { description: doneDesc });
      } catch (e: unknown) {
        toast.error(`新${roleZh}生成失败`, {
          description: e instanceof Error ? e.message : "请稍后重试",
        });
      } finally {
        setFactoryBusy(false);
        setFactoryProgress("");
      }
    },
    [
      assetShareBillingUi.priceLabelZh,
      assetShareQuote,
      factoryArtStyleId,
      factoryBusy,
      factoryTopic,
      generateAssetStillMutation,
      shareAssetToLibrary,
      user?.id,
    ],
  );

  /** 从剧本表（或自传/库）锁资产：有图则复用，缺图才生成；齐后进分镜 */
  const confirmAssetsAndPrepareImages = useCallback(
    async (opts?: {
      assetCanonOverride?: NonNullable<typeof projectBible>["assetCanon"];
      episodeIndexOverride?: number;
      topicOverride?: string;
      /** 清掉旧生成设定图并强制按现稿重出（重扩写/用户点「按剧本重出」） */
      forceRegenerate?: boolean;
    }) => {
      const assetCanon = opts?.assetCanonOverride ?? projectBible?.assetCanon;
      const episodeIndex = opts?.episodeIndexOverride ?? writerFocusEpisode;
      const topic = String(opts?.topicOverride || factoryTopic || "").trim();
      const forceRegenerate = Boolean(opts?.forceRegenerate);
      const writerMainSceneId =
        assetCanon?.episodeMainSceneId[episodeIndex] || assetCanon?.locations[0]?.id || "";
      // 按剧本出资产：主场景跟编剧表；清掉未列入场景表的库示范场景（如 scene_06 皇宫大殿）
      if (writerMainSceneId) {
        setFactorySceneId(writerMainSceneId);
      }

      let workingRefs = customAssetRefs;
      let canvasBlocks = blocks;
      let canvasEdges = edges;
      const align = evaluateManhuaAssetScriptAlignment({
        assetCanon,
        customRefs: workingRefs,
        assetBlocks: canvasBlocks.filter(
          (b) => b.id.startsWith("charsheet-") || b.id.startsWith("sceneplate-"),
        ),
      });
      const shouldPurge =
        forceRegenerate || Boolean(assetCanon && !align.aligned);
      if (shouldPurge) {
        const purged = purgeStaleCustomAssetRefsForCanon(workingRefs, assetCanon, {
          forceAllGenerated: forceRegenerate,
        });
        workingRefs = purged.refs;
        if (purged.removedCount > 0) {
          setCustomAssetRefs(purged.refs);
        }
        const removeIds = new Set(
          collectStaleAssetSheetBlockIds(canvasBlocks, assetCanon, {
            forceAllSheets: forceRegenerate,
          }),
        );
        if (removeIds.size > 0) {
          if (abortRef.current) abortRef.current.abort();
          canvasBlocks = canvasBlocks.filter((b) => !removeIds.has(b.id));
          canvasEdges = canvasEdges.filter(
            (e) => !removeIds.has(e.fromId) && !removeIds.has(e.toId),
          );
          setBlocks(canvasBlocks);
          setEdges(canvasEdges);
          saveCanvasState(canvasBlocks, canvasEdges);
        }
      } else if (assetCanon?.locations?.length) {
        const locIds = new Set(assetCanon.locations.map((l) => l.id));
        const locNames = assetCanon.locations.map((l) => l.nameZh).filter(Boolean);
        const filtered = workingRefs.filter((r) => {
          if (r.role !== "scene") return true;
          const seed = String(r.seedLibraryId || "").trim();
          if (seed && locIds.has(seed)) return true;
          const label = String(r.labelZh || "").trim();
          if (label && locNames.some((n) => label.includes(n) || n.includes(label))) return true;
          if (/^scene_\d+/i.test(seed)) return false;
          return true;
        });
        if (filtered.length !== workingRefs.length) {
          workingRefs = filtered;
          setCustomAssetRefs(filtered);
        }
      }

      const sceneId =
        writerMainSceneId ||
        factorySceneId ||
        recommendedScene?.id ||
        "";
      const assetBlocks = canvasBlocks.filter(
        (b) => b.id.startsWith("charsheet-") || b.id.startsWith("sceneplate-"),
      );
      const gateInput = {
        characterIds: selectedCharacterIds,
        ancientArchetypeIds: factoryAncientArchetypeIds,
        sceneId,
        artStyleId: factoryArtStyleId,
        topic,
        customRefs: workingRefs,
        assetCanon,
        episodeIndex,
        episodes: writerPack?.episodes?.map((ep) => ({
          index: ep.index,
          body: ep.body,
          title: ep.title,
        })),
        assetBlocks,
      };
      const gate = evaluateManhuaAssetImageGate(gateInput);
      if (!gate.castLocked || !gate.sceneLocked) {
        toast.message(
          gate.viaWriterCanon
            ? "剧本人物/场景表不完整，无法自动出设定图"
            : "请上传并勾选人物与场景，或先确认含人物表的剧本",
        );
        setWorkflowPhase("assets");
        setManhuaAssetDrawer(!gate.castLocked ? "characters" : "assets");
        return;
      }
      setAssetsSkipped(false);
      const ingestSheetToMyLibrary = (
        plan: {
          id: string;
          kind: "charsheet" | "sceneplate";
          labelZh: string;
          layout?: "single" | "grid2x2" | "heroSheet";
        },
        url: string | null | undefined,
      ) => {
        const u = String(url || "").trim();
        if (!/^https:\/\//i.test(u)) return;
        const seedLibraryId = plan.id
          .replace(/^charsheet-/, "")
          .replace(/^sceneplate-/, "");
        setCustomAssetRefs((prev) =>
          upsertGeneratedManhuaCustomAssetRef(prev, {
            url: u,
            role: plan.kind === "charsheet" ? "character" : "scene",
            labelZh: plan.labelZh,
            seedLibraryId,
            refDuty: plan.kind === "charsheet" ? "identity" : "space",
          }),
        );
      };
      /** 已有画布设定图 → 同步进「我的角色 / 我的场景」分栏 */
      const syncExistingSheetsToMyLibrary = () => {
        for (const b of assetBlocks) {
          const url = b.outputUrl || b.outputUrls?.[0];
          if (!url) continue;
          const isScene = b.id.startsWith("sceneplate-");
          const isChar = b.id.startsWith("charsheet-");
          if (!isScene && !isChar) continue;
          const kind = isScene ? ("sceneplate" as const) : ("charsheet" as const);
          const seedId = b.id.replace(/^charsheet-/, "").replace(/^sceneplate-/, "");
          const labelZh =
            (kind === "charsheet"
              ? assetCanon?.characters.find((c) => c.id === seedId || b.id.includes(c.id))
                  ?.nameZh
              : assetCanon?.locations.find((l) => l.id === seedId || b.id.includes(l.id))
                  ?.nameZh) ||
            (kind === "charsheet" ? "角色定妆" : "场景参考");
          ingestSheetToMyLibrary({ id: b.id, kind, labelZh }, url);
        }
      };
      const hasEpisodeSheetMedia = assetBlocks.some((b) =>
        Boolean(b.outputUrl || b.outputUrls?.[0]),
      );
      const alignAfterPurge = evaluateManhuaAssetScriptAlignment({
        assetCanon,
        customRefs: workingRefs,
        assetBlocks,
      });
      // 强制重出 / 与现稿不对齐时绝不早退进分镜
      if (
        !forceRegenerate &&
        alignAfterPurge.aligned &&
        gate.ready &&
        hasEpisodeSheetMedia
      ) {
        syncExistingSheetsToMyLibrary();
        setWorkflowPhase("storyboard");
        toast.message(
          gate.viaCustomUpload
            ? "自传参考已齐，进入分镜"
            : "剧本资产图已齐，已写入我的角色与场景分栏，进入分镜",
        );
        return;
      }
      if (factoryBusy) {
        toast.message("请等待当前生成结束");
        return;
      }

      const plans = planManhuaAssetImageSpawns(gateInput, {
        forceEpisodeSheets: forceRegenerate || !hasEpisodeSheetMedia,
      });
      if (!plans.length) {
        toast.message(
          hasEpisodeSheetMedia
            ? gate.hintZh || "资产图未齐"
            : "暂无可生成的设定图：请确认剧本人物/场景表，或到「我的角色 / 我的场景」上传参考",
        );
        return;
      }

      const ac = new AbortController();
      abortRef.current = ac;
      setFactoryBusy(true);
      setFactoryProgress(
        gate.viaWriterCanon
          ? "从剧本出角色/场景设定图…"
          : "准备角色/场景图…",
      );
      pushDebug("confirmAssetsFromScript:start", {
        detail: `plans=${plans.length} · viaCanon=${gate.viaWriterCanon} · missingCast=${gate.missingCastIds.length}`,
      });
      try {
        let working = [...canvasBlocks];
        /** 资产图固定左上：角色一行、场景一行；禁止再贴到画布最右 */
        const ASSET_ORIGIN_X = 60;
        const CHAR_SHEET_Y = 80;
        const SCENE_SHEET_Y = 520;
        const sheetColGap = 380;
        const packAssetSheetPositions = (list: typeof working) => {
          let c = 0;
          let s = 0;
          return list.map((b) => {
            if (b.id.startsWith("charsheet-")) {
              const next = {
                ...b,
                x: ASSET_ORIGIN_X + c * sheetColGap,
                y: CHAR_SHEET_Y,
                width: b.width || 360,
                height: b.height || 400,
              };
              c += 1;
              return next;
            }
            if (b.id.startsWith("sceneplate-")) {
              const next = {
                ...b,
                x: ASSET_ORIGIN_X + s * sheetColGap,
                y: SCENE_SHEET_Y,
                width: b.width || 360,
                height: b.height || 400,
              };
              s += 1;
              return next;
            }
            return b;
          });
        };
        working = packAssetSheetPositions(working);
        setBlocks(working);
        saveCanvasState(working, canvasEdges);
        // 视口滚到左上资产带并高亮，别让人去右边找
        {
          const focusAssetId =
            plans[0]?.id ||
            working.find((b) => b.id.startsWith("charsheet-"))?.id ||
            working.find((b) => b.id.startsWith("sceneplate-"))?.id;
          if (focusAssetId) openManhuaFactoryCanvas(focusAssetId);
        }
        for (let i = 0; i < plans.length; i++) {
          const plan = plans[i]!;
          if (ac.signal.aborted) break;
          let block = working.find((b) => b.id === plan.id);
          if (!block) {
            const isChar = plan.kind === "charsheet";
            const col = working.filter((b) =>
              b.id.startsWith(isChar ? "charsheet-" : "sceneplate-"),
            ).length;
            block = defaultCanvasBlock(
              "image",
              ASSET_ORIGIN_X + col * sheetColGap,
              isChar ? CHAR_SHEET_Y : SCENE_SHEET_Y,
            );
            block.id = plan.id;
            block.prompt = plan.prompt;
            block.aspectRatio = "9:16";
            block.imageModel = "gpt-image-2";
            block.imageMode = "generate";
            block.refImageUrl = undefined;
            block.width = 360;
            block.height = 400;
            working = packAssetSheetPositions([...working, block]);
            block = working.find((b) => b.id === plan.id)!;
          } else if (!(block.outputUrl || block.outputUrls?.[0])) {
            block = { ...block, prompt: plan.prompt, status: "idle", error: undefined };
            working = working.map((b) => (b.id === plan.id ? block! : b));
          } else {
            ingestSheetToMyLibrary(plan, block.outputUrl || block.outputUrls?.[0]);
            continue;
          }
          setBlocks(working);
          saveCanvasState(working, canvasEdges);
          if (i === 0) openManhuaFactoryCanvas(plan.id);
          setFactoryProgress(
            plan.kind === "charsheet"
              ? `角色图 · ${plan.labelZh}`
              : `场景图 · ${plan.labelZh}`,
          );
          toast.message(
            plan.kind === "charsheet"
              ? `正在出角色图：${plan.labelZh}`
              : `正在出场景图：${plan.labelZh}`,
          );
          const out = await runCanvasBlock(runDeps, block, { visionImages: [], texts: [] });
          working = working.map((b) =>
            b.id === plan.id
              ? {
                  ...b,
                  ...out,
                  status: out.outputUrl || out.outputUrls?.[0] ? ("done" as const) : ("error" as const),
                  error:
                    out.outputUrl || out.outputUrls?.[0]
                      ? undefined
                      : "角色/场景图未返回可用地址",
                }
              : b,
          );
          setBlocks(working);
          saveCanvasState(working, canvasEdges);
          ingestSheetToMyLibrary(plan, out.outputUrl || out.outputUrls?.[0]);
          if (out.outputUrl || out.outputUrls?.[0]) {
            pushDebug("confirmAssetsFromScript:engine", {
              level: "ok",
              detail: `${plan.kind}:${plan.labelZh} · ${out.imageModel || "gpt-image-2"}`,
            });
          }
        }
        working = layoutManhuaEpisodeReadableChain(
          packAssetSheetPositions(working),
          writerFocusEpisode,
          {
            assetCanon: projectBible?.assetCanon,
            characterSheetUrlById: collectManhuaCharacterSheetUrlById(
              working,
              projectBible?.assetCanon,
            ),
          },
        );
        setBlocks(working);
        saveCanvasState(working, canvasEdges);
        {
          const focusAssetId =
            working.find((b) => b.id.startsWith("charsheet-"))?.id ||
            working.find((b) => b.id.startsWith("sceneplate-"))?.id;
          if (focusAssetId) openManhuaFactoryCanvas(focusAssetId);
        }
        const nextGate = evaluateManhuaAssetImageGate({
          ...gateInput,
          customRefs: workingRefs,
          assetBlocks: working.filter(
            (b) => b.id.startsWith("charsheet-") || b.id.startsWith("sceneplate-"),
          ),
        });
        if (nextGate.ready) {
          setWorkflowPhase("storyboard");
          toast.message("角色图 / 场景图已齐，已按竖排对齐画布，可出关键静帧");
          pushDebug("confirmAssetsFromScript:ok", {
            level: "ok",
            detail: `plans=${plans.length}`,
          });
        } else {
          setWorkflowPhase("assets");
          toast.message(nextGate.hintZh || "资产图仍未齐，可点「确认资产并出角色/场景图」重试");
          pushDebug("confirmAssetsFromScript:partial", {
            level: "warn",
            detail: nextGate.hintZh || "not-ready",
          });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "资产图生成失败";
        toast.error("角色/场景图未完成", { description: msg });
        setWorkflowPhase("assets");
        pushDebug("confirmAssetsFromScript:error", { level: "error", detail: msg });
      } finally {
        setFactoryBusy(false);
        setFactoryProgress("");
        abortRef.current = null;
      }
    },
    [
      blocks,
      customAssetRefs,
      edges,
      factoryAncientArchetypeIds,
      factoryArtStyleId,
      factoryBusy,
      factorySceneId,
      factoryTopic,
      projectBible?.assetCanon,
      pushDebug,
      recommendedScene?.id,
      runDeps,
      selectedCharacterIds,
      writerFocusEpisode,
      writerPack?.episodes,
    ],
  );

  useEffect(() => {
    confirmAssetsAutoRef.current = confirmAssetsAndPrepareImages;
  }, [confirmAssetsAndPrepareImages]);

  const runFactory = useCallback(
    async (
      untilStage: ManhuaFactoryStageKey,
      opts?: {
        forceFromStage?: ManhuaFactoryStageKey;
        /** 按集各自续跑起点；优先于 forceFromStage */
        forceFromStageByEpisode?: Partial<Record<number, ManhuaFactoryStageKey>>;
        /** 覆盖运行范围解析出的集号列表 */
        episodeIndexes?: number[];
        /** 仅重跑已铺好的指定节点（工作台单镜重出）。 */
        targetBlockIds?: string[];
        /** 工作台「生成片段」：只跑该镜静帧（若缺）+ 该镜成片。 */
        fragmentShotIndex?: number;
        /** 依次生成多个片段（缺片批量）。 */
        fragmentShotIndexes?: number[];
        /** true：覆盖重出本集全部关键静帧；默认只补失败/缺失 */
        overwriteKeyarts?: boolean;
      },
    ) => {
      if (factoryBusy) return;
      const ac = new AbortController();
      abortRef.current = ac;
      setFactoryBusy(true);
      setFactoryProgress("准备中…");
      window.setTimeout(() => {
        document.querySelector("#manhua-live-progress-zone")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        const canvasDetails = document.getElementById(
          "manhua-factory-canvas-details",
        ) as HTMLDetailsElement | null;
        if (canvasDetails) canvasDetails.open = true;
      }, 40);
      const runStartedAt = Date.now();
      const fragmentShotIndexes = (
        opts?.fragmentShotIndexes?.length
          ? opts.fragmentShotIndexes
          : typeof opts?.fragmentShotIndex === "number" && opts.fragmentShotIndex >= 1
            ? [opts.fragmentShotIndex]
            : []
      )
        .map((n) => Math.floor(n))
        .filter((n) => n >= 1);
      const uniqueFragmentIndexes = Array.from(new Set(fragmentShotIndexes));
      pushDebug("factoryRun:start", {
        detail: `until=${untilStage} · force=${opts?.forceFromStage || "—"} · frag=${uniqueFragmentIndexes.join(",") || "—"}`,
      });
      let workingBlocks = blocks;
      let workingEdges = edges;
      let factorySaveTimer: number | undefined;
      const flushFactorySave = () => {
        if (factorySaveTimer != null) {
          window.clearTimeout(factorySaveTimer);
          factorySaveTimer = undefined;
        }
        saveCanvasState(workingBlocks, workingEdges);
      };
      try {
        const spawned = ensureStudioSpawned(factoryTopic);
        const cleanedGraph = sanitizeManhuaRecapUpstreamLinks(spawned.blocks, spawned.edges);
        workingBlocks = cleanedGraph.blocks;
        workingEdges = cleanedGraph.edges;
        if (
          cleanedGraph.edges.length !== spawned.edges.length ||
          spawned.blocks.some(
            (b) => b.id.startsWith("story-") && Boolean(b.parentId?.startsWith("recap_card-")),
          )
        ) {
          setBlocks(workingBlocks);
          setEdges(workingEdges);
          saveCanvasState(workingBlocks, workingEdges);
        }
        const episodeIndexes = opts?.episodeIndexes?.length
          ? opts.episodeIndexes
          : resolveRunEpisodeIndexes(workingBlocks);
        pushDebug("factoryRun:episodes", {
          detail: `eps=[${episodeIndexes.join(",")}] · chars=${selectedCharacterIds.join(",") || "—"} · path=${selectedPathRecipeIds.join(",") || "—"} · action=${selectedActionRecipeIds.join(",") || "—"}`,
        });

        /** A：出静帧/成片前强制资产门禁 + 注入人物/场景/画风（含重出） */
        const needsAssetLock = untilStage === "keyart" || untilStage === "clip";
        if (needsAssetLock) {
          const sceneId =
            projectBible?.assetCanon?.episodeMainSceneId[writerFocusEpisode] ||
            factorySceneId ||
            recommendedScene?.id ||
            "";
          const gate = evaluateManhuaAssetImageGate({
            characterIds: selectedCharacterIds,
            ancientArchetypeIds: factoryAncientArchetypeIds,
            sceneId,
            artStyleId: factoryArtStyleId,
            customRefs: customAssetRefs,
            assetCanon: projectBible?.assetCanon,
            episodeIndex: writerFocusEpisode,
            assetBlocks: workingBlocks.filter(
              (b) => b.id.startsWith("charsheet-") || b.id.startsWith("sceneplate-"),
            ),
          });
          if (!gate.ready) {
            pushDebug("factoryRun:assetGate", {
              level: "warn",
              detail: gate.hintZh || "assets not ready",
            });
            toast.message(gate.hintZh || "请先锁定本集角色设定卡与场景设定图", {
              description: "库内示意封面不算；可自传勾选人物+场景替代。",
            });
            setWorkflowPhase("assets");
            setManhuaAssetDrawer(!gate.castLocked ? "characters" : "assets");
            setFactoryBusy(false);
            setFactoryProgress("");
            return;
          }
          workingBlocks = applyFactoryPrefsToBlocks(workingBlocks, {
            craftShotIds: selectedCraftShotIds,
            motionPromptIds: selectedMotionIds,
            pathCameraRecipeIds: selectedPathRecipeIds,
            pathAnnotationJson: factoryPathAnnotation,
            narrativeLightingIds: selectedNarrativeLightingIds,
            maleHairstyleIds: selectedMaleHairstyleIds,
            maleMicroExpressionIds: selectedMaleMicroIds,
            promoCoverLayoutIds: selectedPromoLayoutIds,
            actionCameraRecipeIds: selectedActionRecipeIds,
            cineVocabIds: selectedCineVocabIds,
            cineVocabLocale: factoryCineVocabLocale,
            wardrobePropContinuityIds: selectedWardrobeIds,
            sceneId,
            propIds: factoryPropIds,
            genreId: factoryGenreId || undefined,
            characterIds: selectedCharacterIds,
            ancientArchetypeIds: factoryAncientArchetypeIds,
            identityLockZh: factoryIdentityLockZh || castBundle.identityLockZh,
            artStyleId: factoryArtStyleId,
            videoReverseOutputMode: factoryReverseMode,
            customRefs: customAssetRefs,
            assetCanon: projectBible?.assetCanon,
          });
          setBlocks(workingBlocks);
          saveCanvasState(workingBlocks, workingEdges);
        }

        const fragmentLabel = uniqueFragmentIndexes.length
          ? uniqueFragmentIndexes.map((n) => String(n).padStart(2, "0")).join("、")
          : "";
        toast.message(
          fragmentLabel
            ? `生成片段 ${fragmentLabel}（第 ${episodeIndexes.join("、")} 集）`
            : untilStage === "reverse"
              ? `漫剧工厂：故事→角色→节拍→反推（第 ${episodeIndexes.join("、")} 集）`
              : untilStage === "keyart"
                ? `一次生成本集全部分镜静帧（第 ${episodeIndexes.join("、")} 集）`
                : `漫剧工厂：全部分镜静帧 + 成片（第 ${episodeIndexes.join("、")} 集）`,
        );
        let completed = 0;
        let skipped = 0;
        let lastError: { id: string; message: string } | null = null;
        const fragmentPasses = uniqueFragmentIndexes.length
          ? uniqueFragmentIndexes
          : [undefined as number | undefined];
        outer: for (const episodeIndex of episodeIndexes) {
          for (const fragmentShotIndex of fragmentPasses) {
            if (ac.signal.aborted) break outer;
            const fragmentPad =
              typeof fragmentShotIndex === "number"
                ? String(fragmentShotIndex).padStart(2, "0")
                : "";
            setFactoryProgress(
              fragmentPad
                ? `第${episodeIndex}集 · 片段 ${fragmentPad}`
                : `第${episodeIndex}集 · 准备…`,
            );
            const forceFromStage =
              opts?.forceFromStageByEpisode?.[episodeIndex] ?? opts?.forceFromStage;
            // 片段续拍：须挂上一段尾帧/成片；同场景链式深度封顶（超限引导重锚设定板）
            if (
              untilStage === "clip" &&
              typeof fragmentShotIndex === "number" &&
              fragmentShotIndex > 1
            ) {
              const {
                canContinueManhuaChain,
                manhuaContinuationRequiresLastFrame,
                measureManhuaChainDepth,
                formatManhuaChainReanchorHintZh,
                normalizeManhuaChainSceneKey,
              } = await import("@shared/manhuaDirectingWorkflow");
              const priorDone = workingBlocks
                .filter(
                  (b) =>
                    b.id.startsWith("clip-") &&
                    (getBlockEpisodeIndex(b) ?? 1) === episodeIndex &&
                    b.status === "done" &&
                    Boolean(b.outputUrl || b.outputUrls?.[0]),
                )
                .sort((a, b) => a.id.localeCompare(b.id));
              const lastAccepted = priorDone[priorDone.length - 1];
              const cont = manhuaContinuationRequiresLastFrame({
                acceptedClipUrl: lastAccepted?.outputUrl || lastAccepted?.outputUrls?.[0],
                lastFrameUrl: lastAccepted?.lastFrameUrl,
              });
              if (!cont.ok) {
                toast.message(cont.hintZh || "请先完成上一段成片再续拍");
                pushDebug("continuation:blocked", {
                  level: "warn",
                  detail: cont.hintZh || "no-last-frame",
                });
                break outer;
              }
              const priorSceneKeys = priorDone.map(
                (b) =>
                  extractManhuaSceneHintFromPrompt(b.prompt) ||
                  `第${episodeIndex}集`,
              );
              const nextKeyart = workingBlocks.find(
                (b) =>
                  b.id.startsWith("keyart-") &&
                  (getBlockEpisodeIndex(b) ?? 1) === episodeIndex &&
                  resolveSegmentIndexFromShotIndex(resolveKeyartShotIndex(b.id, b.prompt)) ===
                    fragmentShotIndex,
              );
              const nextSceneRaw =
                extractManhuaSceneHintFromPrompt(nextKeyart?.prompt) ||
                extractManhuaSceneHintFromPrompt(lastAccepted?.prompt) ||
                `第${episodeIndex}集·段${fragmentShotIndex}`;
              const sceneKey = normalizeManhuaChainSceneKey(nextSceneRaw);
              const ignoreFirstN = chainIgnoreByScene[sceneKey] || 0;
              const measured = measureManhuaChainDepth({
                priorSceneKeys,
                nextSceneKey: sceneKey,
                ignoreFirstN,
              });
              const chain = canContinueManhuaChain({
                sceneKey: measured.sceneKey,
                depth: measured.depth,
              });
              if (!chain.ok) {
                const hint = formatManhuaChainReanchorHintZh(measured.sceneKey);
                toast.message(chain.reasonZh || hint, {
                  description: "点右侧可重锚角色/场景设定图，然后重新开链续拍。",
                  action: {
                    label: "重锚设定板",
                    onClick: () => {
                      setChainIgnoreByScene((prev) => ({
                        ...prev,
                        [sceneKey]: priorSceneKeys.length,
                      }));
                      setManhuaAssetDrawer("assets");
                      void confirmAssetsAndPrepareImages({
                        episodeIndexOverride: episodeIndex,
                      });
                      toast.message("已标记重锚开链", {
                        description: "设定图就绪后可再续拍本场。",
                      });
                    },
                  },
                });
                pushDebug("continuation:chain-cap", {
                  level: "warn",
                  detail: `${measured.sceneKey}:depth=${measured.depth}`,
                });
                break outer;
              }
            }
            const keyartExpectedTotal = countExpectedManhuaKeyartShots(
              workingBlocks,
              episodeIndex,
            );
            const keyartProgressZh = () => {
              const counts = countManhuaKeyartProgress(
                workingBlocks,
                episodeIndex,
                getBlockEpisodeIndex,
                keyartExpectedTotal,
              );
              return {
                counts,
                text: formatManhuaKeyartProgressZh(counts, episodeIndex),
              };
            };
            const result = await runManhuaDramaFactoryPipeline({
              deps: runDeps,
              blocks: workingBlocks,
              edges: workingEdges,
              untilStage,
              episodeIndex,
              forceFromStage,
              targetBlockIds: opts?.targetBlockIds,
              fragmentShotIndex,
              shotContinuity,
              skipDone: true,
              overwriteKeyarts: opts?.overwriteKeyarts === true,
              signal: ac.signal,
              onBlocksChange: (next) => {
                workingBlocks = next;
                // 出一张立刻上屏；存盘防抖，避免每张都同步写 localStorage 卡顿
                flushSync(() => {
                  setBlocks(next);
                });
                if (factorySaveTimer != null) window.clearTimeout(factorySaveTimer);
                factorySaveTimer = window.setTimeout(() => {
                  factorySaveTimer = undefined;
                  setEdges((eds) => {
                    workingEdges = eds;
                    saveCanvasState(next, eds);
                    return eds;
                  });
                }, 450);
              },
              onStageStart: (id, index, total, label) => {
                if (stageStartedAtRef.current != null) {
                  pushDebug("factoryStage:donePrev", {
                    level: "ok",
                    ms: Date.now() - stageStartedAtRef.current,
                  });
                }
                stageStartedAtRef.current = Date.now();
                const stageBlock = workingBlocks.find((b) => b.id === id);
                const videoModel =
                  stageBlock?.kind === "video"
                    ? String(stageBlock.videoModel || "seedance-2.0-fast")
                    : "—";
                const stillRefs =
                  stageBlock?.kind === "video"
                    ? [
                        stageBlock.refImageUrl,
                        ...(stageBlock.editFusionUrls || []),
                      ].filter(Boolean).length
                    : 0;
                // 关键静帧：只显示「已成功出图张数」，绝不用流水线 16/17 冒充进度
                if (label === MANHUA_FACTORY_STAGE_LABEL_ZH.keyart || id.startsWith("keyart-")) {
                  const { counts, text } = keyartProgressZh();
                  setFactoryProgress(text);
                  pushDebug("factoryStage:start", {
                    detail: `ep${episodeIndex} · keyart done=${counts.done}/${counts.total} fail=${counts.failed} · batch=${index + 1}/${total} · id=${id}`,
                  });
                  return;
                }
                setFactoryProgress(
                  fragmentPad
                    ? `第${episodeIndex}集 · 第${fragmentPad}段 · ${index + 1}/${total} · ${label}`
                    : `第${episodeIndex}集 · ${index + 1}/${total} · ${label}`,
                );
                pushDebug("factoryStage:start", {
                  detail: `ep${episodeIndex} · seg=${fragmentPad || "—"} · ${index + 1}/${total} · ${label} · videoModel=${videoModel} · stillRefs=${stillRefs} · id=${id}`,
                });
                toast.message(`第${episodeIndex}集 ${index + 1}/${total}`, {
                  description:
                    videoModel !== "—"
                      ? `${label} · ${videoModel}`
                      : label,
                });
              },
              onStageDone: (id, _index, _total, label) => {
                if (label === MANHUA_FACTORY_STAGE_LABEL_ZH.keyart || id.startsWith("keyart-")) {
                  setFactoryProgress(keyartProgressZh().text);
                  return;
                }
                setFactoryProgress(`第${episodeIndex}集 · 已完成 · ${label}`);
              },
              onStageError: (id, label, message) => {
                if (label === MANHUA_FACTORY_STAGE_LABEL_ZH.keyart || id.startsWith("keyart-")) {
                  setFactoryProgress(keyartProgressZh().text);
                  pushDebug("factoryStage:error", {
                    level: "warn",
                    detail: `ep${episodeIndex} · ${id} · ${message.slice(0, 160)}`,
                  });
                  return;
                }
                setFactoryProgress(`第${episodeIndex}集 · ${label}失败`);
              },
              onStageSkip: (_id, label) => {
                if (label === MANHUA_FACTORY_STAGE_LABEL_ZH.keyart) {
                  setFactoryProgress(keyartProgressZh().text);
                } else {
                  setFactoryProgress(`第${episodeIndex}集 · 跳过已完成 · ${label}`);
                }
                pushDebug("factoryStage:skip", {
                  level: "warn",
                  detail: `ep${episodeIndex} · ${label}`,
                });
              },
              onStageRetry: (_id, label, attempt, message) => {
                if (label === MANHUA_FACTORY_STAGE_LABEL_ZH.keyart) {
                  setFactoryProgress(`${keyartProgressZh().text} · 重试 ${attempt}`);
                } else {
                  setFactoryProgress(`第${episodeIndex}集 · 重试 ${attempt} · ${label}`);
                }
                pushDebug("factoryStage:retry", {
                  level: "warn",
                  detail: `ep${episodeIndex} · ${label} · attempt=${attempt} · ${message.slice(0, 160)}`,
                });
                toast.message(`瞬时失败，自动重试 ${attempt}`, {
                  description: `${label}：${formatManhuaFactoryUserError(message).slice(0, 120)}`,
                });
              },
            });
            workingBlocks = result.blocks;
            completed += result.completedIds.length;
            skipped += result.skippedIds.length;
            if (stageStartedAtRef.current != null) {
              pushDebug("factoryStage:donePrev", {
                level: "ok",
                ms: Date.now() - stageStartedAtRef.current,
              });
              stageStartedAtRef.current = null;
            }
            // 单镜/单片段失败不拦后续镜——继续出齐本集分镜；但必须立刻用人话提示（不靠 debug）
            if (result.errors.length) {
              lastError = result.errors[0]!;
              const rawDetail = result.errors
                .map((e) => `${e.id}:${e.message}`)
                .join(" · ");
              pushDebug("factoryRun:shotError", {
                level: "warn",
                detail: rawDetail.slice(0, 280),
              });
              const stageZh = manhuaFactoryStageLabelFromBlockId(lastError.id);
              const friendly = formatManhuaFactoryUserError(lastError.message);
              const failN = result.errors.length;
              const keyartFail =
                failN > 1 && result.errors.every((e) => e.id.startsWith("keyart-"));
              toast.error(
                keyartFail ? `关键静帧 ${failN} 张未出成` : `${stageZh}未完成`,
                {
                  description: friendly,
                },
              );
            }
          }
        }
        const userStopped =
          ac.signal.aborted || lastError?.message === "已取消";
        if (userStopped) {
          pushDebug("factoryRun:aborted", {
            level: "warn",
            ms: Date.now() - runStartedAt,
            detail: `completed=${completed} skipped=${skipped}`,
          });
          toast.message(
            `已中断生成（完成 ${completed}` +
              (skipped ? `、跳过 ${skipped}` : "") +
              "）",
            { description: "已完成片段保留；可改资产/画风后继续测，不必重跑整条。" },
          );
        } else if (lastError && completed === 0) {
          const errStage = stageKeyFromBlockId(lastError.id);
          const stageZh =
            (errStage && MANHUA_FACTORY_STAGE_LABEL_ZH[errStage]) ||
            manhuaFactoryStageLabelFromBlockId(lastError.id);
          const friendly = formatManhuaFactoryUserError(lastError.message || "");
          pushDebug("factoryRun:error", {
            level: "error",
            ms: Date.now() - runStartedAt,
            detail: `${errStage || "unknown"} · ${lastError.message || ""}`,
          });
          toast.error(`${stageZh}失败`, { description: friendly });
        } else if (lastError) {
          const friendly = formatManhuaFactoryUserError(lastError.message);
          pushDebug("factoryRun:partial", {
            level: "warn",
            ms: Date.now() - runStartedAt,
            detail: `completed=${completed} skipped=${skipped} · ${lastError.message}`,
          });
          toast.message(
            `已跑完可跑节点：新跑 ${completed}` + (skipped ? ` · 跳过 ${skipped}` : ""),
            {
              description: `部分未完成：${friendly}。可单独重出失败步骤。`,
            },
          );
        } else {
          pushDebug("factoryRun:ok", {
            level: "ok",
            ms: Date.now() - runStartedAt,
            detail: `completed=${completed} skipped=${skipped}`,
          });
          toast.success(`漫剧工厂完成：新跑 ${completed}` + (skipped ? ` · 跳过 ${skipped}` : ""));
        }
        setFactoryProgress("");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "漫剧工厂失败";
        const userStopped = ac.signal.aborted || msg === "已取消";
        pushDebug(userStopped ? "factoryRun:aborted" : "factoryRun:exception", {
          level: userStopped ? "warn" : "error",
          ms: Date.now() - runStartedAt,
          detail: msg,
        });
        if (userStopped) {
          toast.message("已中断生成", {
            description: "已完成片段保留；可改设定后继续测。",
          });
        } else {
          toast.error("生成失败", {
            description: formatManhuaFactoryUserError(msg),
          });
        }
        setFactoryProgress("");
      } finally {
        flushFactorySave();
        abortRef.current = null;
        stageStartedAtRef.current = null;
        setFactoryBusy(false);
      }
    },
    [
      blocks,
      edges,
      ensureStudioSpawned,
      factoryBusy,
      factoryTopic,
      factorySceneId,
      factoryAncientArchetypeIds,
      factoryArtStyleId,
      factoryPropIds,
      factoryGenreId,
      factoryIdentityLockZh,
      factoryReverseMode,
      factoryPathAnnotation,
      customAssetRefs,
      recommendedScene?.id,
      castBundle.identityLockZh,
      projectBible?.assetCanon,
      writerFocusEpisode,
      runDeps,
      resolveRunEpisodeIndexes,
      pushDebug,
      selectedCharacterIds,
      selectedCraftShotIds,
      selectedMotionIds,
      selectedPathRecipeIds,
      selectedNarrativeLightingIds,
      selectedMaleHairstyleIds,
      selectedMaleMicroIds,
      selectedPromoLayoutIds,
      selectedActionRecipeIds,
      selectedCineVocabIds,
      factoryCineVocabLocale,
      selectedWardrobeIds,
      shotContinuity,
      chainIgnoreByScene,
      confirmAssetsAndPrepareImages,
    ],
  );

  const handleRetakeClip = useCallback(
    (clipBlockId: string, variable: ManhuaRetakeVariable) => {
      if (factoryBusy) {
        toast.message("请等待当前生成结束");
        return;
      }
      const hit = blocks.find((b) => b.id === clipBlockId);
      if (!hit) {
        toast.message("找不到成片节点");
        return;
      }
      const episodeIndex = getBlockEpisodeIndex(hit) ?? writerFocusEpisode;
      const localFrag = resolveClipLocalSegmentIndex(hit.id, hit.prompt, episodeIndex);
      const attempt = Math.max(1, Math.floor((hit.manhuaRetake?.attempt || 0) + 1));
      setBlocks((prev) => {
        const next = prev.map((b) => {
          if (b.id !== clipBlockId) return b;
          return {
            ...b,
            prompt: patchPromptForRetakeVariable(b.prompt, variable, attempt),
            status: "idle" as const,
            error: undefined,
            manhuaClipQuality: undefined,
            outputUrl: undefined,
            outputUrls: [],
            lastFrameUrl: undefined,
            manhuaRetake: { variable, attempt, maxAttempts: 3 },
          };
        });
        setEdges((eds) => {
          saveCanvasState(next, eds);
          return eds;
        });
        return next;
      });
      toast.message("按建议单变量重拍", { description: "只改一项，正在重出片段…" });
      setFactoryRunScope("focus");
      ensureStudioSpawned(factoryTopic);
      void runFactory("clip", {
        forceFromStage: "clip",
        episodeIndexes: [episodeIndex],
        fragmentShotIndexes: [localFrag],
        targetBlockIds: [clipBlockId],
      });
    },
    [
      factoryBusy,
      blocks,
      writerFocusEpisode,
      factoryTopic,
      ensureStudioSpawned,
      runFactory,
    ],
  );

  const handleReplaceCharacterVoiceAudio = useCallback(
    (input: { characterTag: string; audioUrl: string; labelZh?: string }) => {
      const characterTag = String(input.characterTag || "").trim();
      const audioUrl = String(input.audioUrl || "").trim();
      if (!characterTag || !/^https:\/\//i.test(audioUrl)) return;
      setCharacterVoiceLocks((prev) => {
        const existing = prev.find((x) => x.characterTag === characterTag);
        const lock: ManhuaCharacterVoiceLock = {
          id: existing?.id || makeManhuaCharacterVoiceLockId(),
          characterTag,
          characterId: existing?.characterId,
          labelZh: String(input.labelZh || existing?.labelZh || characterTag).trim().slice(0, 40),
          audioUrl,
          sourceVideoUrl: existing?.sourceVideoUrl,
          sourceClipId: existing?.sourceClipId,
          startSec: existing?.startSec,
          durationSec: existing?.durationSec,
          createdAt: Date.now(),
        };
        return normalizeManhuaCharacterVoiceLocks([
          ...prev.filter((x) => x.characterTag !== characterTag),
          lock,
        ]);
      });
    },
    [],
  );

  const resumeFromFailure = useCallback(() => {
    const episodeIndexes = resolveRunEpisodeIndexes();
    const forceFromStageByEpisode: Partial<Record<number, ManhuaFactoryStageKey>> = {};
    const toRun: number[] = [];
    for (const ep of episodeIndexes) {
      const stage = resolveFactoryResumeStage(blocks, ep);
      if (!stage) continue;
      forceFromStageByEpisode[ep] = stage;
      toRun.push(ep);
    }
    if (!toRun.length) {
      toast.message(
        episodeIndexes.length > 1
          ? `第 ${episodeIndexes.join("、")} 集链路都已完成，无需续跑`
          : `第${episodeIndexes[0] ?? writerFocusEpisode}集链路都已完成，无需续跑`,
      );
      return;
    }
    const summary = toRun
      .map((ep) => `第${ep}集·${MANHUA_FACTORY_STAGE_LABEL_ZH[forceFromStageByEpisode[ep]!]}`)
      .join("；");
    toast.message(`按集续跑：${summary}`);
    void runFactory("clip", { forceFromStageByEpisode, episodeIndexes: toRun });
  }, [blocks, runFactory, resolveRunEpisodeIndexes, writerFocusEpisode]);

  /** 工作台模式即沉浸三栏（不要求已确认；未确认时灰掉生成，题材从顶栏「改题材」进） */
  const immersiveWorkbench =
    canvasMode === "manhua" && manhuaUiMode === "workbench";

  return (
    <div
      className={
        immersiveWorkbench
          ? "flex h-dvh flex-col overflow-hidden bg-transparent text-white"
          : "min-h-dvh bg-transparent text-white"
      }
    >
      <Navbar />
      <main
        className={
          immersiveWorkbench
            ? "flex min-h-0 flex-1 flex-col overflow-hidden px-0 pb-0 pt-16"
            : "px-4 pb-10 pt-24 md:px-6"
        }
      >
        <div
          className={
            immersiveWorkbench
              ? "mx-auto flex min-h-0 w-full max-w-none flex-1 flex-col"
              : "mx-auto max-w-[1920px]"
          }
        >
          <div
            className={
              immersiveWorkbench
                ? "mb-0 flex min-h-0 flex-1 flex-col px-3 py-1 md:px-4"
                : "mb-5"
            }
          >
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
              {immersiveWorkbench ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-white/45">
                  <span className="font-medium text-white/70">剧本工作室</span>
                  <span className="text-white/20">·</span>
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-white/75"
                    onClick={() => {
                      setImmersiveExtrasOpen(true);
                      window.setTimeout(() => {
                        document
                          .getElementById("manhua-factory-zone")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 40);
                    }}
                  >
                    改题材
                  </button>
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-white/75"
                    onClick={() => {
                      setImmersiveExtrasOpen(true);
                      window.setTimeout(() => {
                        document
                          .getElementById("manhua-clip-dock-zone")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 40);
                    }}
                  >
                    成片坞
                  </button>
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-white/75"
                    onClick={() => {
                      setImmersiveExtrasOpen(false);
                      setManhuaUiMode("form");
                    }}
                  >
                    经典表单
                  </button>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
                  {canvasMode === "manhua" ? (
                    <>
                      <Clapperboard className="h-3.5 w-3.5" />
                      漫剧创作
                    </>
                  ) : canvasMode === "freeform" ? (
                    <>
                      <LayoutTemplate className="h-3.5 w-3.5" />
                      自由画布
                    </>
                  ) : (
                    <>
                      <Clapperboard className="h-3.5 w-3.5" />
                      创作画布
                    </>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {canShowCanvasDebug ? (
                  <button
                    type="button"
                    onClick={() => setDebugMode((v) => !v)}
                    className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
                      debugMode
                        ? "border-[#49e6ff]/30 bg-[rgba(73,230,255,0.12)] text-[#8cefff]"
                        : "border-white/10 bg-white/5 text-[#b7add8] hover:bg-white/10"
                    }`}
                  >
                    {debugMode ? "Debug On" : "Debug Off"}
                  </button>
                ) : null}
                {canvasMode !== "pick" ? (
                  <button
                    type="button"
                    onClick={() => selectCanvasMode("pick")}
                    className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    切换模式
                  </button>
                ) : null}
              </div>
            </div>
            {canShowCanvasDebug && debugMode ? (
              immersiveWorkbench ? (
                <ManhuaFactoryDebugPanel
                  overlay
                  enabled={debugMode}
                  entries={debugLog}
                  injectSummary={debugInjectSummary}
                  onClear={() => setDebugLog([])}
                />
              ) : (
                <div className="mt-4">
                  <ManhuaFactoryDebugPanel
                    enabled={debugMode}
                    entries={debugLog}
                    injectSummary={debugInjectSummary}
                    onClear={() => setDebugLog([])}
                  />
                </div>
              )
            ) : null}
            {!(
              canvasMode === "manhua" &&
              writerConfirmed &&
              manhuaUiMode === "workbench"
            ) ? (
              <>
                <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">
                  {canvasMode === "manhua"
                    ? "漫剧创作"
                    : canvasMode === "freeform"
                      ? "自由画布"
                      : "创作画布"}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-white/65">
                  {canvasMode === "pick"
                    ? "先选工作方式：连载短剧走漫剧工作流；单次图/视频/文案任务走自由画布。"
                    : canvasMode === "manhua"
                      ? "引导路径：题材 → 编剧确认 → 自动套造型 → 工作台 → 多镜静帧 → 成片 → 成片坞合成。"
                      : "文生图 / 文生视频 / 图生视频、提文字、文案整理等简单任务，多节点自由接线，不铺漫剧流水线。"}
                </p>
              </>
            ) : null}

            {/* 沉浸工作台：去掉路径轨，避免仍像引导长页 */}
            {canvasMode === "manhua" && !immersiveWorkbench ? (
              <ManhuaGuidedPathRail
                variant={
                  writerConfirmed && manhuaUiMode === "workbench" ? "compact" : "full"
                }
                progress={{
                  hasTopic: Boolean(factoryTopic.trim()),
                  hasWriterPack: Boolean(writerPack),
                  writerConfirmed: Boolean(writerConfirmed),
                  hasCast: Boolean(
                    selectedCharacterIds.length ||
                      factoryAncientArchetypeIds.length ||
                      customAssetRefs.some((r) => r.role === "character") ||
                      writerConfirmed,
                  ),
                  assetsReady: evaluateManhuaAssetImageGate({
                    characterIds: selectedCharacterIds,
                    ancientArchetypeIds: factoryAncientArchetypeIds,
                    sceneId:
                      projectBible?.assetCanon?.episodeMainSceneId[writerFocusEpisode] ||
                      factorySceneId ||
                      recommendedScene?.id ||
                      "",
                    artStyleId: factoryArtStyleId,
                    topic: factoryTopic,
                    customRefs: customAssetRefs,
                    assetCanon: projectBible?.assetCanon,
                    episodeIndex: writerFocusEpisode,
                    assetBlocks: blocks.filter(
                      (b) => b.id.startsWith("charsheet-") || b.id.startsWith("sceneplate-"),
                    ),
                  }).ready,
                  hasFactoryChain: blocks.some((b) =>
                    MANHUA_FACTORY_STAGE_ORDER.some((s) => b.id.startsWith(`${s}-`)),
                  ),
                  hasKeyart: blocks.some(
                    (b) =>
                      stageKeyFromBlockId(b.id) === "keyart" &&
                      Boolean(b.outputUrl || b.outputUrls?.[0]),
                  ),
                  hasClip: blocks.some(
                    (b) =>
                      (stageKeyFromBlockId(b.id) === "clip" ||
                        stageKeyFromBlockId(b.id) === "omni_edit") &&
                      Boolean(b.outputUrl || b.outputUrls?.[0]),
                  ),
                  hasFinalVideo: Boolean(finalAssembleVideoUrl),
                }}
                onStepClick={(stepId) => {
                  if (stepId === "card" || stepId === "cast") setManhuaAssetDrawer("characters");
                  if (stepId === "wb" || stepId === "keyart" || stepId === "clip") {
                    setManhuaUiMode("workbench");
                  }
                }}
                onNextActionClick={(stepId) => {
                  // 剧情包已出未确认：下一步直接确认并滚到工作台（少一次找按钮）
                  if (stepId === "writer" && writerPack && !writerConfirmed) {
                    confirmWriterToDirector();
                    setManhuaUiMode("workbench");
                    setImmersiveExtrasOpen(false);
                    // confirmWriterToDirector 已切到资产设定；勿再强制进分镜
                    window.setTimeout(() => {
                      document.querySelector("#manhua-workbench-shell")?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }, 80);
                    return;
                  }
                  if (stepId === "card" || stepId === "cast") setManhuaAssetDrawer("characters");
                  if (stepId === "wb" || stepId === "keyart" || stepId === "clip") {
                    setManhuaUiMode("workbench");
                  }
                  if (stepId === "preview" || stepId === "clip") {
                    /* scroll handled by rail */
                  }
                }}
                busyLabel={
                  assembleBusy
                    ? "正在合成长片与配乐"
                    : factoryBusy
                      ? "工厂出片进行中"
                      : writerBusy
                        ? "编剧室扩写中"
                        : null
                }
                onStopBusy={factoryBusy ? stopFactory : undefined}
              />
            ) : null}

            {canvasMode === "pick" ? (
              <div className="mt-6 grid max-w-3xl gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => selectCanvasMode("manhua")}
                  className="rounded-2xl border border-emerald-400/35 bg-gradient-to-b from-emerald-500/15 to-transparent p-5 text-left transition hover:border-emerald-300/50 hover:from-emerald-500/25"
                >
                  <div className="flex items-center gap-2 text-base font-semibold text-emerald-50">
                    <Clapperboard className="h-5 w-5" />
                    漫剧创作
                  </div>
                  <p className="mt-3 text-[13px] leading-6 text-white/60">
                    引导式路径：题材 → 编剧确认 → 自动套造型 → 工作台出片 → 成片坞合成。适合竖屏连载短剧。
                  </p>
                  <span className="mt-4 inline-block text-[12px] font-medium text-emerald-200/90">进入引导式漫剧 →</span>
                </button>
                <button
                  type="button"
                  onClick={() => selectCanvasMode("freeform")}
                  className="rounded-2xl border border-sky-400/35 bg-gradient-to-b from-sky-500/15 to-transparent p-5 text-left transition hover:border-sky-300/50 hover:from-sky-500/25"
                >
                  <div className="flex items-center gap-2 text-base font-semibold text-sky-50">
                    <LayoutTemplate className="h-5 w-5" />
                    自由画布
                  </div>
                  <p className="mt-3 text-[13px] leading-6 text-white/60">
                    不展开漫剧流水线。文本 / 图片 / 视频节点自由连线，按任务跑——文生图、文生视频、图生视频、提文字、文案整理等。
                  </p>
                  <span className="mt-4 inline-block text-[12px] font-medium text-sky-200/90">打开自由画布 →</span>
                </button>
              </div>
            ) : null}

            {canvasMode === "manhua" ? (
            <>
            {/* 工作台主屏：沉浸三栏（未确认也可进壳；题材从顶栏「改题材」） */}
            {manhuaUiMode === "workbench" &&
            !(immersiveWorkbench && immersiveExtrasOpen) ? (
              <div
                id="manhua-workbench-zone"
                className={
                  immersiveWorkbench
                    ? // 吃满页头以下剩余视口，禁止再用 100dvh 死高与上方 Debug/工具条叠算
                      "relative min-h-0 w-full flex-1 overflow-hidden"
                    : "-mx-3 scroll-mt-24 overflow-x-auto px-3"
                }
              >
                <ManhuaScriptWorkbench
                  immersive={immersiveWorkbench}
                  blocks={blocks}
                  topic={factoryTopic}
                  shotContinuity={shotContinuity}
                  onShotContinuityChange={(next) => {
                    const saved = saveManhuaShotContinuityPrefs(next);
                    setShotContinuity(saved);
                  }}
                  seriesTitle={writerPack?.seriesTitle || projectBible?.seriesTitle}
                  logline={writerPack?.logline || projectBible?.logline}
                  outlineEpisodes={(writerPack?.episodes || []).map((ep) => ({
                    index: ep.index,
                    title: ep.title || `第${ep.index}集`,
                  }))}
                  episodeCount={writerEpisodeCount}
                  focusEpisode={writerFocusEpisode}
                  onFocusEpisode={setWriterFocusEpisode}
                  characterIds={selectedCharacterIds}
                  ancientArchetypeIds={factoryAncientArchetypeIds}
                  sceneId={factorySceneId || recommendedScene?.id}
                  propIds={factoryPropIds}
                  artStyleLabelZh={getManhuaArtStylePreset(factoryArtStyleId).labelZh}
                  projectBibleSummary={summarizeManhuaProjectBible(projectBible)}
                  assetCanon={projectBible?.assetCanon}
                  viralTemplateLabelZh={
                    selectedViralTemplate
                      ? `${selectedViralTemplate.nameZh}（${selectedViralTemplate.laneZh}）`
                      : undefined
                  }
                  bibleBoundEpisodes={projectBible?.cast.boundEpisodeIndexes}
                  pathTrackLabelZh={pathTrackStatus.labelZh}
                  narrativeLightingLabelZh={narrativeLightingLabelZh}
                  pathAnnotation={factoryPathAnnotation}
                  pathRecipeId={factoryPathRecipeId}
                  actionRecipeId={factoryActionRecipeId}
                  onPathAnnotationChange={setFactoryPathAnnotation}
                  onPathRecipeIdChange={(id) => {
                    setPathRecipeManual(true);
                    setFactoryPathRecipeId(id);
                  }}
                  onActionRecipeIdChange={(id) => {
                    setActionRecipeManual(true);
                    setFactoryActionRecipeId(id);
                  }}
                  translateMotionZh={translateMotionZh}
                  finalVideoUrl={finalAssembleVideoUrl}
                  factoryBusy={factoryBusy || assembleBusy}
                  factoryProgress={
                    assembleBusy ? "正在合成长片与配乐…" : factoryProgress || undefined
                  }
                  onStopFactory={factoryBusy ? stopFactory : undefined}
                  canRun={Boolean(directorUnlocked || writerConfirmed)}
                  writerPackReady={Boolean(writerPack && writerPackLooksReady(writerPack))}
                  onConfirmOutline={() => {
                    confirmWriterToDirector();
                  }}
                  artStyleId={factoryArtStyleId}
                  onArtStyleChange={(id) => {
                    setFactoryArtStyleId(id);
                    setArtStyleManual(true);
                  }}
                  assetsSkipped={assetsSkipped}
                  onAssetsSkippedChange={setAssetsSkipped}
                  onConfirmAssetsAndPrepareImages={confirmAssetsAndPrepareImages}
                  onRegenerateAssetsFromScript={() =>
                    void confirmAssetsAndPrepareImages({ forceRegenerate: true })
                  }
                  assetScriptStaleHintZh={assetScriptAlign.hintZh}
                  stylePack={stylePack}
                  onStylePackChange={setStylePack}
                  customAssetRefs={customAssetRefs}
                  characterLookSets={characterLookSets}
                  onCharacterLookSetsChange={setCharacterLookSets}
                  segmentLookBindings={segmentLookBindings}
                  onSegmentLookBindingsChange={setSegmentLookBindings}
                  characterVoiceLocks={characterVoiceLocks}
                  onExtractCharacterVoice={async ({
                    clipId,
                    characterTag,
                    labelZh,
                    startSec,
                    durationSec,
                  }) => {
                    const clip = blocks.find((b) => b.id === clipId);
                    const videoUrl = String(
                      clip?.outputUrl || clip?.outputUrls?.[0] || "",
                    ).trim();
                    if (!clip || !/^https:\/\//i.test(videoUrl)) {
                      toast.message("请先选出片成功的段成片");
                      return;
                    }
                    try {
                      toast.message("正在提取声线…", {
                        description: `${characterTag} · 约数秒`,
                      });
                      const out = await extractManhuaClipAudio({
                        videoUrl,
                        startSec,
                        durationSec,
                      });
                      const lock: ManhuaCharacterVoiceLock = {
                        id: makeManhuaCharacterVoiceLockId(),
                        characterTag,
                        labelZh: labelZh || characterTag,
                        audioUrl: out.audioUrl,
                        sourceVideoUrl: videoUrl,
                        sourceClipId: clipId,
                        startSec: out.startSec,
                        durationSec: out.durationSec,
                        createdAt: Date.now(),
                      };
                      setCharacterVoiceLocks((prev) =>
                        normalizeManhuaCharacterVoiceLocks([
                          ...prev.filter((x) => x.characterTag !== characterTag),
                          lock,
                        ]),
                      );
                      toast.message("声线已锁定", {
                        description: `${characterTag} 已挂参考音，后续成片自动带入`,
                      });
                    } catch (e) {
                      toast.message(
                        e instanceof Error ? e.message : "声线提取失败",
                      );
                    }
                  }}
                  onRemoveCharacterVoice={(id) => {
                    setCharacterVoiceLocks((prev) =>
                      prev.filter((x) => x.id !== id),
                    );
                  }}
                  onUploadCustomAssets={uploadCustomAssetFiles}
                  onCustomAssetRoleChange={setCustomAssetRole}
                  onCustomAssetDutyChange={setCustomAssetDuty}
                  onSegmentIntentChange={handleSegmentIntentChange}
                  deliveryPackage={deliveryPackage}
                  onDeliveryPackageChange={(next) =>
                    setDeliveryPackage(
                      normalizeManhuaDeliveryPackage(next, {
                        seriesTitle: writerPack?.seriesTitle || factoryTopic,
                      }),
                    )
                  }
                  cineVocabLocale={factoryCineVocabLocale}
                  onCineVocabLocaleChange={setFactoryCineVocabLocale}
                  onRetakeClip={handleRetakeClip}
                  onRemoveCustomAsset={removeCustomAssetRef}
                  onGenerateCustomAssetFromLibrary={generateCustomAssetFromLibrary}
                  shareAssetToLibrary={shareAssetToLibrary}
                  onShareAssetToLibraryChange={setShareAssetToLibrary}
                  assetShareBilling={assetShareBillingUi}
                  workflowPhase={workflowPhase}
                  onWorkflowPhaseChange={setWorkflowPhase}
                  onOpenCharacterCard={() => setManhuaAssetDrawer("characters")}
                  onOpenAssetWall={() => setManhuaAssetDrawer("assets")}
                  onAdvisorApplySync={(sync) => {
                    const ep = writerFocusEpisode;
                    handleBlocksChange((prev) =>
                      prev.map((b) => {
                        if ((getBlockEpisodeIndex(b) ?? 1) !== ep) return b;
                        const stage = stageKeyFromBlockId(b.id);
                        if (stage === "story" && sync.storyText) {
                          return {
                            ...b,
                            outputText: sync.storyText,
                            status: "done" as const,
                          };
                        }
                        if (stage === "beats" && sync.beatsMarkdown) {
                          return {
                            ...b,
                            outputText: sync.beatsMarkdown,
                            status: "done" as const,
                          };
                        }
                        if (stage === "reverse" && sync.beatsMarkdown) {
                          const reverseBody = [
                            sync.scriptText && `## 剧本\n${sync.scriptText}`,
                            sync.beatsMarkdown,
                          ]
                            .filter(Boolean)
                            .join("\n\n");
                          return {
                            ...b,
                            outputText: reverseBody,
                            status: "done" as const,
                          };
                        }
                        return b;
                      }),
                    );
                  }}
                  onAdvisorUpdateBeatsText={(text) => {
                    const ep = writerFocusEpisode;
                    handleBlocksChange((prev) =>
                      prev.map((b) => {
                        if ((getBlockEpisodeIndex(b) ?? 1) !== ep) return b;
                        const stage = stageKeyFromBlockId(b.id);
                        if (stage !== "beats" && stage !== "reverse") return b;
                        return { ...b, outputText: text, status: "done" as const };
                      }),
                    );
                  }}
                  onAdvisorUpdateStoryText={(text) => {
                    const ep = writerFocusEpisode;
                    handleBlocksChange((prev) =>
                      prev.map((b) => {
                        if ((getBlockEpisodeIndex(b) ?? 1) !== ep) return b;
                        if (stageKeyFromBlockId(b.id) !== "story") return b;
                        return { ...b, outputText: text, status: "done" as const };
                      }),
                    );
                  }}
                  onUpsertShotAngles={(angles) => {
                    const ep = writerFocusEpisode;
                    handleBlocksChange((prev) =>
                      prev.map((b) => {
                        if ((getBlockEpisodeIndex(b) ?? 1) !== ep) return b;
                        const stage = stageKeyFromBlockId(b.id);
                        if (stage !== "reverse" && stage !== "beats") return b;
                        const base = b.outputText || b.prompt || "";
                        return {
                          ...b,
                          outputText: upsertShotAngleSection(base, angles),
                          status: "done" as const,
                        };
                      }),
                    );
                  }}
                  onUpsertShotDialogues={(dialogues) => {
                    const ep = writerFocusEpisode;
                    handleBlocksChange((prev) =>
                      prev.map((b) => {
                        if ((getBlockEpisodeIndex(b) ?? 1) !== ep) return b;
                        const stage = stageKeyFromBlockId(b.id);
                        if (stage !== "reverse" && stage !== "beats") return b;
                        const base = b.outputText || b.prompt || "";
                        return {
                          ...b,
                          outputText: upsertShotDialogueSection(base, dialogues),
                          status: "done" as const,
                        };
                      }),
                    );
                  }}
                  onFocusBlock={(id) => {
                    openManhuaFactoryCanvas(id);
                  }}
                  previewCanvasToolbar={
                    <label className="inline-flex items-center gap-1 text-[10px] text-white/45">
                      呈现
                      <select
                        value={manhuaCanvasPresentation}
                        onChange={(e) =>
                          setManhuaCanvasPresentation(e.target.value as "media" | "all")
                        }
                        className="rounded-md border border-white/12 bg-black/40 px-1.5 py-0.5 text-[10px] text-white/85"
                      >
                        <option value="media">图视频</option>
                        <option value="all">全部节点</option>
                      </select>
                    </label>
                  }
                  previewCanvas={
                    <div className="absolute inset-0 overflow-hidden">
                      <FreeformCanvas
                        fillContainer
                        blocks={blocks}
                        edges={edges}
                        onBlocksChange={handleBlocksChange}
                        onEdgesChange={handleEdgesChange}
                        runDeps={runDeps}
                        focusBlockId={focusBlockId}
                        onFocusBlockConsumed={() => setFocusBlockId(null)}
                        presentation={manhuaCanvasPresentation === "media" ? "media" : "full"}
                        focusEpisode={writerFocusEpisode}
                        spawnKinds={
                          manhuaCanvasPresentation === "media" ? ["image", "video"] : undefined
                        }
                        characterVoiceLocks={characterVoiceLocks}
                        onReplaceCharacterVoiceAudio={handleReplaceCharacterVoiceAudio}
                      />
                    </div>
                  }
                  onSpawnAndRunClip={() => {
                    setFactoryRunScope("focus");
                    ensureStudioSpawned(factoryTopic);
                    void runFactory("clip", { episodeIndexes: [writerFocusEpisode] });
                  }}
                  onGenerateAllEpisodeKeyarts={() => {
                    const sceneId =
                      projectBible?.assetCanon?.episodeMainSceneId[writerFocusEpisode] ||
                      factorySceneId ||
                      recommendedScene?.id ||
                      "";
                    const gate = evaluateManhuaAssetImageGate({
                      characterIds: selectedCharacterIds,
                      ancientArchetypeIds: factoryAncientArchetypeIds,
                      sceneId,
                      artStyleId: factoryArtStyleId,
                      customRefs: customAssetRefs,
                      assetCanon: projectBible?.assetCanon,
                      episodeIndex: writerFocusEpisode,
                      assetBlocks: blocks.filter(
                        (b) => b.id.startsWith("charsheet-") || b.id.startsWith("sceneplate-"),
                      ),
                    });
                    if (!gate.ready) {
                      toast.message(gate.hintZh || "请先准备人物与场景参考", {
                        description: gate.viaWriterCanon
                          ? "请先出齐剧本表角色图与本集主场景图。"
                          : "可上传勾选或基于库参考生成；库内仅为参考。",
                      });
                      setWorkflowPhase("assets");
                      setManhuaAssetDrawer(!gate.castLocked ? "characters" : "assets");
                      return;
                    }
                    setFactoryRunScope("focus");
                    ensureStudioSpawned(factoryTopic);
                    // 出图前把角色/场景/服装/运镜锁进每镜静帧提示词
                    setBlocks((prev) => {
                      const next = applyFactoryPrefsToBlocks(prev, {
                        craftShotIds: selectedCraftShotIds,
                        motionPromptIds: selectedMotionIds,
                        pathCameraRecipeIds: selectedPathRecipeIds,
                        pathAnnotationJson: factoryPathAnnotation,
                        narrativeLightingIds: selectedNarrativeLightingIds,
                        maleHairstyleIds: selectedMaleHairstyleIds,
                        maleMicroExpressionIds: selectedMaleMicroIds,
                        promoCoverLayoutIds: selectedPromoLayoutIds,
                        actionCameraRecipeIds: selectedActionRecipeIds,
                        cineVocabIds: selectedCineVocabIds,
                        cineVocabLocale: factoryCineVocabLocale,
                        wardrobePropContinuityIds: selectedWardrobeIds,
                        sceneId,
                        propIds: factoryPropIds,
                        genreId: factoryGenreId || undefined,
                        characterIds: selectedCharacterIds,
                        ancientArchetypeIds: factoryAncientArchetypeIds,
                        identityLockZh: factoryIdentityLockZh || castBundle.identityLockZh,
                        artStyleId: factoryArtStyleId,
                        videoReverseOutputMode: factoryReverseMode,
                        customRefs: customAssetRefs,
                        assetCanon: projectBible?.assetCanon,
                      });
                      setEdges((eds) => {
                        saveCanvasState(next, eds);
                        return eds;
                      });
                      // 用刷新后的 next 计数，避免闭包旧 blocks 导致「跳过张数」不准
                      const epKeys = next.filter(
                        (b) =>
                          b.id.startsWith("keyart-") &&
                          (getBlockEpisodeIndex(b) ?? 1) === writerFocusEpisode,
                      );
                      const already = epKeys.filter((b) =>
                        Boolean(b.outputUrl || b.outputUrls?.[0]),
                      ).length;
                      const expected = Math.max(
                        epKeys.length,
                        countExpectedManhuaKeyartShots(next, writerFocusEpisode),
                      );
                      if (already > 0) {
                        const need = Math.max(0, expected - already);
                        queueMicrotask(() => {
                          toast.message(
                            need > 0
                              ? `已出 ${already}/${expected} 张将跳过，本次补 ${need} 张失败/空白`
                              : `已出 ${already}/${expected} 张将跳过；本集静帧已齐`,
                            {
                              description: "要从头覆盖全部静帧，请用「重出静帧」。",
                            },
                          );
                        });
                      }
                      return next;
                    });
                    void runFactory("keyart", {
                      episodeIndexes: [writerFocusEpisode],
                    });
                  }}
                  onGenerateFragment={({ shotIndex }) => {
                    const pad = String(shotIndex).padStart(2, "0");
                    toast.message(`生成第 ${pad} 段成片`, {
                      description: "缺段内静帧时只补本段，不整集重跑。",
                    });
                    setFactoryRunScope("focus");
                    ensureStudioSpawned(factoryTopic);
                    void runFactory("clip", {
                      episodeIndexes: [writerFocusEpisode],
                      fragmentShotIndex: shotIndex,
                    });
                  }}
                  onEnsureSegmentClips={() => {
                    setBlocks((prev) => {
                      const sheetUrls = collectManhuaCharacterSheetUrlById(
                        prev,
                        projectBible?.assetCanon,
                      );
                      const epBody =
                        writerPack?.episodes.find((e) => e.index === writerFocusEpisode)?.body ||
                        "";
                      const segmentPlan = parseManhuaEpisodeSegmentPlanFromMarkdown(epBody);
                      const layoutOpts = {
                        assetCanon: projectBible?.assetCanon,
                        characterSheetUrlById: sheetUrls,
                        customRefs: customAssetRefs,
                        segmentPlan: segmentPlan.segments.length ? segmentPlan : null,
                        characterLookSets,
                        segmentLookBindings,
                      };
                      const ensured = ensureManhuaFragmentClips(
                        prev,
                        edges,
                        writerFocusEpisode,
                        layoutOpts,
                      );
                      const next = layoutManhuaEpisodeReadableChain(
                        ensured.blocks,
                        writerFocusEpisode,
                        layoutOpts,
                      );
                      setEdges(() => {
                        saveCanvasState(next, ensured.edges);
                        return ensured.edges;
                      });
                      return next;
                    });
                  }}
                  onReviewClipPromptsOnCanvas={(opts) => {
                    const wantSeg = Math.max(1, opts?.segmentIndex ?? 1);
                    let focusId = "";
                    setBlocks((prev) => {
                      const sheetUrls = collectManhuaCharacterSheetUrlById(
                        prev,
                        projectBible?.assetCanon,
                      );
                      const epBody =
                        writerPack?.episodes.find((e) => e.index === writerFocusEpisode)?.body ||
                        "";
                      const segmentPlan = parseManhuaEpisodeSegmentPlanFromMarkdown(epBody);
                      const layoutOpts = {
                        assetCanon: projectBible?.assetCanon,
                        characterSheetUrlById: sheetUrls,
                        customRefs: customAssetRefs,
                        segmentPlan: segmentPlan.segments.length ? segmentPlan : null,
                        characterLookSets,
                        segmentLookBindings,
                      };
                      const ensured = ensureManhuaFragmentClips(
                        prev,
                        edges,
                        writerFocusEpisode,
                        layoutOpts,
                      );
                      const next = layoutManhuaEpisodeReadableChain(
                        ensured.blocks,
                        writerFocusEpisode,
                        layoutOpts,
                      );
                      setEdges(() => {
                        saveCanvasState(next, ensured.edges);
                        return ensured.edges;
                      });
                      const epClips = next.filter(
                        (b) =>
                          String(b.id || "").startsWith("clip-") &&
                          (getBlockEpisodeIndex(b) ?? 1) === writerFocusEpisode,
                      );
                      focusId =
                        epClips.find(
                          (b) => resolveClipSegmentIndex(b.id, b.prompt) === wantSeg,
                        )?.id ||
                        epClips[0]?.id ||
                        "";
                      return next;
                    });
                    // 等 layout 写入后再 focus，才能滚到真实坐标并高亮
                    window.setTimeout(() => {
                      if (focusId) openManhuaFactoryCanvas(focusId);
                      else openManhuaFactoryCanvas();
                    }, 120);
                  }}
                  onUpdateClipPrompt={(clipId, prompt) => {
                    setBlocks((prev) => {
                      const next = prev.map((b) =>
                        b.id === clipId ? { ...b, prompt, error: undefined } : b,
                      );
                      setEdges((eds) => {
                        saveCanvasState(next, eds);
                        return eds;
                      });
                      return next;
                    });
                  }}
                  onLayoutReadableChain={() => {
                    setBlocks((prev) => {
                      const sheetUrls = collectManhuaCharacterSheetUrlById(
                        prev,
                        projectBible?.assetCanon,
                      );
                      const epBody =
                        writerPack?.episodes.find((e) => e.index === writerFocusEpisode)?.body ||
                        "";
                      const segmentPlan = parseManhuaEpisodeSegmentPlanFromMarkdown(epBody);
                      const layoutOpts = {
                        assetCanon: projectBible?.assetCanon,
                        characterSheetUrlById: sheetUrls,
                        customRefs: customAssetRefs,
                        segmentPlan: segmentPlan.segments.length ? segmentPlan : null,
                        characterLookSets,
                        segmentLookBindings,
                      };
                      const ensured = ensureManhuaFragmentClips(
                        prev,
                        edges,
                        writerFocusEpisode,
                        layoutOpts,
                      );
                      const next = layoutManhuaEpisodeReadableChain(
                        ensured.blocks,
                        writerFocusEpisode,
                        layoutOpts,
                      );
                      setEdges(() => {
                        saveCanvasState(next, ensured.edges);
                        return ensured.edges;
                      });
                      return next;
                    });
                    toast.message("已对齐画布竖排模块", {
                      description: "资产带（含@编号与定妆特写·道具子号）→ 静帧每列约5镜 → 段成片同理分列",
                    });
                  }}
                  onGenerateMissingFragments={(segmentIndexes) => {
                    if (!segmentIndexes.length) {
                      toast.message("本集段成片已齐，无需补跑");
                      return;
                    }
                    if (
                      !window.confirm(
                        `将依次生成第${writerFocusEpisode}集缺段：${segmentIndexes
                          .map((n) => String(n).padStart(2, "0"))
                          .join("、")}。继续？`,
                      )
                    ) {
                      return;
                    }
                    setFactoryRunScope("focus");
                    ensureStudioSpawned(factoryTopic);
                    void runFactory("clip", {
                      episodeIndexes: [writerFocusEpisode],
                      fragmentShotIndexes: segmentIndexes,
                    });
                  }}
                  onResumeFromFailure={() => {
                    const onCanvas = Array.from(
                      new Set(
                        blocks
                          .map((b) => getBlockEpisodeIndex(b))
                          .filter((n): n is number => n != null),
                      ),
                    ).sort((a, b) => a - b);
                    const forceFromStageByEpisode: Partial<Record<number, ManhuaFactoryStageKey>> =
                      {};
                    const toRun: number[] = [];
                    for (const ep of onCanvas.length ? onCanvas : [writerFocusEpisode]) {
                      const stage = resolveFactoryResumeStage(blocks, ep);
                      if (!stage) continue;
                      forceFromStageByEpisode[ep] = stage;
                      toRun.push(ep);
                    }
                    if (!toRun.length) {
                      toast.message("各集链路都已完成，无需续跑");
                      return;
                    }
                    toast.message(
                      `按集续跑：${toRun
                        .map(
                          (ep) =>
                            `第${ep}集·${MANHUA_FACTORY_STAGE_LABEL_ZH[forceFromStageByEpisode[ep]!]}`,
                        )
                        .join("；")}`,
                    );
                    void runFactory("clip", { forceFromStageByEpisode, episodeIndexes: toRun });
                  }}
                  onRerunKeyartsFromReverse={() => {
                    if (
                      !window.confirm(
                        `将从编导反推重跑第${writerFocusEpisode}集静帧（覆盖右栏旧图）。继续？`,
                      )
                    ) {
                      return;
                    }
                    setFactoryRunScope("focus");
                    ensureStudioSpawned(factoryTopic);
                    toast.message(`第${writerFocusEpisode}集 · 从反推覆盖重出全部静帧`);
                    void runFactory("keyart", {
                      forceFromStage: "reverse",
                      episodeIndexes: [writerFocusEpisode],
                      overwriteKeyarts: true,
                    });
                  }}
                  onRerunKeyartShot={(blockId, shotIndex) => {
                    if (
                      !window.confirm(
                        `只重跑第${writerFocusEpisode}集第${shotIndex}镜静帧；其他镜头保留。继续？`,
                      )
                    ) {
                      return;
                    }
                    setFactoryRunScope("focus");
                    ensureStudioSpawned(factoryTopic);
                    toast.message(`第${writerFocusEpisode}集 · 单独重出第${shotIndex}镜`);
                    void runFactory("keyart", {
                      forceFromStage: "keyart",
                      episodeIndexes: [writerFocusEpisode],
                      targetBlockIds: [blockId],
                      // 名单镜：允许覆盖该镜已有图
                      overwriteKeyarts: false,
                    });
                  }}
                  dockSelectedIds={dockSelectedIds}
                  onDockSelectedIdsChange={setDockSelectedIds}
                  onAcceptClipDespiteQc={(clipBlockId) => {
                    setBlocks((prev) => {
                      const next = prev.map((b) => {
                        if (b.id !== clipBlockId || !b.manhuaClipQuality) return b;
                        return {
                          ...b,
                          manhuaClipQuality: {
                            ...b.manhuaClipQuality,
                            userAcceptedDespiteQc: true,
                          },
                          error: b.manhuaClipQuality.summary
                            ? `已采用（质检未过）：${b.manhuaClipQuality.summary}`
                            : "已采用（质检未过）",
                        };
                      });
                      setEdges((eds) => {
                        saveCanvasState(next, eds);
                        return eds;
                      });
                      return next;
                    });
                    toast.message("已采用此片", {
                      description: "可在成片坞勾选并参与长片合成。",
                    });
                  }}
                  onApplyClipEditTrim={(clipBlockId, trim) => {
                    setBlocks((prev) => {
                      const next = prev.map((b) =>
                        b.id === clipBlockId ? { ...b, manhuaEditTrim: trim } : b,
                      );
                      setEdges((eds) => {
                        saveCanvasState(next, eds);
                        return eds;
                      });
                      return next;
                    });
                  }}
                />
                {!immersiveWorkbench ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-white/40">
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-white/70"
                      onClick={() =>
                        document
                          .getElementById("manhua-factory-zone")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" })
                      }
                    >
                      改题材 / 编剧室
                    </button>
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-white/70"
                      onClick={() => setManhuaUiMode("form")}
                    >
                      切经典表单编导
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* 沉浸主屏时默认藏长页；点「改题材/成片坞」再展开 */}
            <div
              id="manhua-post-workbench"
              className={
                immersiveWorkbench && !immersiveExtrasOpen
                  ? "hidden"
                  : immersiveWorkbench
                    ? "border-t border-white/10 bg-[#070a10] px-4 py-4 md:px-6"
                    : undefined
              }
            >
            {immersiveWorkbench && immersiveExtrasOpen ? (
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[12px] text-white/55">编剧室 · 成片坞</span>
                <button
                  type="button"
                  className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/5"
                  onClick={() => setImmersiveExtrasOpen(false)}
                >
                  回到剧本工作室
                </button>
              </div>
            ) : null}

            {/* ① 题材 + 编剧室（确认后默认收起；沉浸工作台时压到主屏下方） */}
            <div
              id="manhua-factory-zone"
              className={`mt-2 scroll-mt-44 rounded-2xl border border-cyan-400/15 bg-gradient-to-b from-[#0c1520] via-[#0a0e18]/90 to-transparent p-4 md:p-5 ${
                writerConfirmed && manhuaUiMode === "workbench"
                  ? "max-w-3xl opacity-80"
                  : "max-w-3xl"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white/90">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-400/90 text-[11px] font-bold text-black">
                    1–2
                  </span>
                  题材 · 编剧室
                  {writerConfirmed ? (
                    <span className="rounded-full border border-emerald-400/35 bg-emerald-500/12 px-2 py-0.5 text-[10px] font-medium text-emerald-100">
                      已确认
                    </span>
                  ) : null}
                </div>
                <span className="text-[11px] text-white/40">
                  {writerConfirmed
                    ? "已收起 · 点下方展开可改题材"
                    : "主路径：题材扩写 · 次要：导入已有剧本"}
                </span>
              </div>
              <details className="mt-2" open={!writerConfirmed}>
                <summary
                  className={
                    writerConfirmed
                      ? "cursor-pointer text-[11px] text-cyan-200/75 hover:text-cyan-100"
                      : "list-none text-[0px] leading-none [&::-webkit-details-marker]:hidden"
                  }
                >
                  {writerConfirmed ? "展开编剧室（改题材 / 重扩写）" : "\u00a0"}
                </summary>
                <div className={writerConfirmed ? "mt-3" : "mt-1"}>
              <label className="block text-[11px] text-white/45">题材</label>
              <input
                value={factoryTopic}
                onChange={(e) => {
                  setFactoryTopic(e.target.value);
                  setWriterConfirmed(false);
                }}
                disabled={writerBusy || factoryBusy}
                placeholder="例：女主权谋翻盘的情感连载，宫墙内外步步为营"
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-3 text-[15px] text-white placeholder:text-white/30 outline-none focus:border-emerald-400/55 focus:ring-1 focus:ring-emerald-400/25 disabled:opacity-50"
              />
              <label className="mt-3 block text-[11px] text-white/45">补充条件（三到五句）</label>
              <textarea
                value={writerBrief}
                onChange={(e) => {
                  setWriterBrief(e.target.value);
                  setWriterConfirmed(false);
                }}
                disabled={writerBusy || factoryBusy}
                rows={4}
                placeholder={"例：\n主角隐忍多年后归来\n对手是旧日盟友\n每集结尾必须留下未揭的局"}
                className="mt-1 w-full resize-y rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-sm leading-6 text-white placeholder:text-white/30 outline-none focus:border-emerald-400/55 disabled:opacity-50"
              />
              <div className="mt-3" data-manhua-viral-template>
                <label className="block text-[11px] text-white/45">节奏模板（可选）</label>
                <p className="mt-0.5 text-[10px] leading-4 text-white/35">
                  审定骨架：前 3 秒钩子 + 约 75–90 秒节拍格；只借结构，不写外部剧名。不选则按题材自由扩写。
                </p>
                <div className="mt-2 space-y-2">
                  {viralTemplateGrouped.map((group) => (
                    <div key={group.laneZh}>
                      <div className="mb-1 text-[10px] font-semibold text-white/40">
                        {group.laneZh}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.items.map((tpl) => {
                          const on = viralTemplateId === tpl.id;
                          return (
                            <button
                              key={tpl.id}
                              type="button"
                              disabled={writerBusy || factoryBusy}
                              title={tpl.summaryZh}
                              onClick={() => {
                                setViralTemplateId((prev) => (prev === tpl.id ? "" : tpl.id));
                                setWriterConfirmed(false);
                              }}
                              className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] disabled:opacity-50 ${
                                on
                                  ? "border-amber-300/45 bg-amber-500/20 text-amber-50"
                                  : "border-white/12 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]"
                              }`}
                            >
                              <div className="font-semibold">{tpl.nameZh}</div>
                              <div className="mt-0.5 max-w-[11rem] truncate text-[9px] text-white/40">
                                {tpl.hook3sZh}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {selectedViralTemplate ? (
                  <p className="mt-1.5 text-[10px] text-amber-100/70">
                    已选「{selectedViralTemplate.nameZh}」· 扩写时注入节拍与密度建议
                  </p>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-2.5">
                <div>
                  <label className="block text-[11px] text-white/45">集数</label>
                  <select
                    value={writerEpisodeCount}
                    onChange={(e) => setWriterEpisodeCount(clampWriterEpisodeCount(e.target.value))}
                    disabled={writerBusy || factoryBusy}
                    className="mt-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                  >
                    {Array.from(
                      { length: MANHUA_WRITER_EPISODE_MAX - MANHUA_WRITER_EPISODE_MIN + 1 },
                      (_, i) => MANHUA_WRITER_EPISODE_MIN + i,
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n} 集{n === MANHUA_WRITER_EPISODE_DEFAULT ? "（默认）" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    disabled={writerBusy || factoryBusy}
                    onClick={() => void expandWriterRoom()}
                    title={
                      writerPack
                        ? "重新扩写将覆盖本机与云端旧剧情包，不再保留旧备份"
                        : undefined
                    }
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold disabled:opacity-50 ${
                      writerPack
                        ? "border-white/15 bg-white/[0.05] text-white/70 hover:bg-white/[0.08]"
                        : "border-cyan-300/45 bg-gradient-to-b from-cyan-400/30 to-cyan-600/25 text-cyan-50"
                    }`}
                  >
                    {writerBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {writerPack ? "重新扩写" : "扩写剧情"}
                  </button>
                  {writerPack ? (
                    <p className="max-w-[16rem] text-[10px] leading-snug text-white/40">
                      重扩写以新剧本为准，旧稿不再备份。
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={writerBusy || factoryBusy || !writerPack}
                  onClick={() => {
                    confirmWriterToDirector();
                    setManhuaUiMode("workbench");
                    setImmersiveExtrasOpen(false);
                    // 先进资产设定改人物/场景/道具，再进分镜
                    window.setTimeout(() => {
                      document.querySelector("#manhua-workbench-zone")?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }, 80);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold disabled:opacity-50 ${
                    writerPack && !writerConfirmed
                      ? "border-cyan-300/50 bg-gradient-to-b from-cyan-400/35 to-cyan-600/30 text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.12)]"
                      : "border-sky-400/35 bg-sky-500/15 text-sky-50 hover:bg-sky-500/25"
                  }`}
                >
                  {writerConfirmed ? "已确认 · 先调资产" : "确认并进入资产设定"}
                </button>
                {writerConfirmBlockers.length > 0 && !writerConfirmed ? (
                  <div
                    data-manhua-writer-confirm-blockers
                    className="basis-full rounded-xl border border-amber-400/35 bg-amber-500/12 px-3 py-2 text-[11px] leading-relaxed text-amber-50/95"
                  >
                    <div className="font-semibold text-amber-50">
                      卡在「编剧确认」· 请先处理下列问题再点确认
                    </div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-50/80">
                      {writerConfirmBlockers.map((err) => (
                        <li key={err}>{err}</li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-[10px] text-amber-100/55">
                      常见原因：对白未用直角引号「」或可拍表缺「对白」行。可点「重新扩写」后再确认。
                    </p>
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={writerBusy || factoryBusy || !writerPack}
                  onClick={confirmWriterSeriesSpawn}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/60 hover:bg-white/[0.08] disabled:opacity-50"
                >
                  按集铺板（最多 {MANHUA_SERIES_SPAWN_MAX}）
                </button>
                <button
                  type="button"
                  disabled={writerBusy || factoryBusy}
                  onClick={() => {
                    setDirectorUnlocked(true);
                    setWriterConfirmed(false);
                    toast.message("已解锁编导区（未带连载剧情包）");
                  }}
                  className="text-[11px] text-white/35 underline-offset-2 hover:text-white/65 hover:underline"
                >
                  跳过连载扩写
                </button>
              </div>

              <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                <summary className="cursor-pointer list-none text-[11px] font-medium text-white/55 marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-1.5">
                    <FileUp className="h-3.5 w-3.5 text-white/40" />
                    已有正版剧本？导入文本（粘贴 / .txt / .md）
                  </span>
                </summary>
                <div className="mt-2 border-t border-white/8 pt-2">
                  <p className="text-[10px] leading-5 text-white/40">
                    次要入口，不跑扩写。请自行确保版权合规。正文需含「第1集」「第2集」等分集标记，或粘贴平台扩写格式。
                  </p>
                  <textarea
                    value={writerImportDraft}
                    onChange={(e) => setWriterImportDraft(e.target.value)}
                    disabled={writerBusy || factoryBusy}
                    rows={5}
                    placeholder={"例：\n# 剧名\n\n第1集 标题\n本集剧情…\n片尾钩子：…\n\n第2集 标题\n…"}
                    className="mt-2 w-full resize-y rounded-xl border border-white/12 bg-black/45 px-3 py-2 text-[12px] leading-5 text-white placeholder:text-white/28 outline-none focus:border-white/25 disabled:opacity-50"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={writerBusy || factoryBusy || !writerImportDraft.trim()}
                      onClick={() => importWriterRoomFromText(writerImportDraft)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/[0.1] disabled:opacity-50"
                    >
                      导入为剧情包
                    </button>
                    <button
                      type="button"
                      disabled={writerBusy || factoryBusy}
                      onClick={() => writerImportFileRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-3 py-1.5 text-[11px] text-white/60 hover:bg-white/[0.06] disabled:opacity-50"
                    >
                      选择文件
                    </button>
                    <input
                      ref={writerImportFileRef}
                      type="file"
                      accept=".txt,.md,.markdown,text/plain,text/markdown"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        e.target.value = "";
                        void onWriterImportFile(file);
                      }}
                    />
                    {writerImportDraft.trim() ? (
                      <button
                        type="button"
                        disabled={writerBusy || factoryBusy}
                        onClick={() => setWriterImportDraft("")}
                        className="text-[10px] text-white/35 underline-offset-2 hover:text-white/60 hover:underline"
                      >
                        清空粘贴区
                      </button>
                    ) : null}
                  </div>
                </div>
              </details>

              {writerBusy ? (
                <div className="mt-3 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[11px] font-medium text-cyan-50">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在扩写连载剧情包…
                  </div>
                  {writerPack ? (
                    <p className="mt-1.5 text-[10px] leading-relaxed text-cyan-50/70">
                      下方仍是旧稿，成功后才会覆盖；若超过约 5 分钟无结果会自动解锁，请再点「重新扩写」。
                    </p>
                  ) : null}
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-cyan-400/70 to-teal-300/80" />
                  </div>
                </div>
              ) : null}

              {writerPack ? (
                <div
                  className={`mt-4 rounded-xl border p-3 ${
                    writerConfirmed
                      ? "border-emerald-400/25 bg-emerald-500/[0.06]"
                      : "border-cyan-400/25 bg-cyan-500/[0.07]"
                  }`}
                >
                  {!writerConfirmed ? (
                    <div className="mb-2 rounded-lg border border-cyan-400/30 bg-cyan-500/12 px-2.5 py-1.5 text-[10px] font-medium text-cyan-50">
                      剧情包已就绪 · 请点上方主按钮「确认并进入资产设定」
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-white">{writerPack.seriesTitle}</div>
                    {writerPack.logline ? (
                      <div className="text-[11px] text-white/50">{writerPack.logline}</div>
                    ) : null}
                    {writerConfirmed ? (
                      <span className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100">
                        已确认
                      </span>
                    ) : (
                      <span className="rounded-md border border-amber-400/35 bg-amber-500/12 px-2 py-0.5 text-[10px] text-amber-50">
                        待确认
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {writerPack.episodes.map((ep) => (
                      <button
                        key={ep.index}
                        type="button"
                        onClick={() => setWriterFocusEpisode(ep.index)}
                        className={`rounded-md border px-2 py-0.5 text-[10px] ${
                          writerFocusEpisode === ep.index
                            ? "border-sky-400/40 bg-sky-500/15 text-sky-50"
                            : "border-white/10 text-white/55 hover:border-white/25"
                        }`}
                      >
                        第{ep.index}集
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const ep =
                      writerPack.episodes.find((e) => e.index === writerFocusEpisode) ||
                      writerPack.episodes[0];
                    if (!ep) return null;
                    return (
                      <div className="mt-3 space-y-2 text-xs leading-6 text-white/75">
                        <div className="font-medium text-white/90">
                          第{ep.index}集 · {ep.title}
                        </div>
                        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap">{ep.body}</div>
                        <div className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-2 text-amber-50/90">
                          <span className="font-semibold">片尾钩子 · </span>
                          {ep.endHook || "（未解析到，请重新扩写）"}
                        </div>
                      </div>
                    );
                  })()}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[11px] text-white/40 hover:text-white/65">
                      人物 / 道具 / 场景表
                    </summary>
                    <div className="mt-2 max-h-48 space-y-2 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5 text-white/60">
                      <div>{writerPack.charactersMd}</div>
                      <div>{writerPack.propsMd}</div>
                      <div>{writerPack.locationsMd}</div>
                    </div>
                  </details>
                </div>
              ) : null}
                </div>
              </details>
            </div>

            {/* 工作台模式下资产进左栏「本案资产」，不再叠一条 CastStrip 占屏 */}
            {manhuaUiMode !== "workbench" || !writerConfirmed ? (
              <ManhuaCastStrip
                characterIds={selectedCharacterIds}
                ancientArchetypeIds={factoryAncientArchetypeIds}
                sceneId={factorySceneId || recommendedScene?.id}
                propIds={factoryPropIds}
                writerConfirmed={writerConfirmed}
                artStyleLabelZh={getManhuaArtStylePreset(factoryArtStyleId).labelZh}
                onOpenCharacters={() => setManhuaAssetDrawer("characters")}
                onOpenAssets={() => setManhuaAssetDrawer("assets")}
              />
            ) : null}

            {/* 未确认编剧时：仍显示模式切换；确认后工作台已提到路径下方主屏 */}
            {!(writerConfirmed && manhuaUiMode === "workbench") ? (
              <div className="mt-3 flex max-w-[1920px] flex-wrap items-center gap-2">
                <span className="text-[11px] text-white/45">生产主界面</span>
                <div className="inline-flex rounded-lg border border-white/10 bg-black/35 p-0.5">
                  <button
                    type="button"
                    onClick={() => setManhuaUiMode("workbench")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                      manhuaUiMode === "workbench"
                        ? "bg-cyan-500/25 text-cyan-50"
                        : "text-white/50 hover:text-white/75"
                    }`}
                  >
                    剧本工作台
                  </button>
                  <button
                    type="button"
                    onClick={() => setManhuaUiMode("form")}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                      manhuaUiMode === "form"
                        ? "bg-white/15 text-white/90"
                        : "text-white/50 hover:text-white/75"
                    }`}
                  >
                    经典表单编导
                  </button>
                </div>
              </div>
            ) : null}

            {/* sticky 推进条：集×阶段即时可见；节点画布默认收起，排错时展开 */}
            <div className="mt-3 max-w-[1920px]">
              <ManhuaLiveProgressBoard
                blocks={blocks}
                focusEpisode={writerFocusEpisode}
                factoryBusy={factoryBusy || assembleBusy}
                factoryProgress={
                  assembleBusy ? "正在合成长片与配乐…" : factoryProgress || undefined
                }
                onStopFactory={factoryBusy ? stopFactory : undefined}
                onFocusEpisode={(ep) => {
                  setWriterFocusEpisode(ep);
                  setManhuaUiMode("workbench");
                }}
                onFocusBlock={(id) => openManhuaFactoryCanvas(id)}
              />
              {/* 沉浸三栏右栏已挂画布时不再挂第二份，避免双实例状态分裂 */}
              {!(immersiveWorkbench && !immersiveExtrasOpen) ? (
                <details
                  id="manhua-factory-canvas-details"
                  className="mt-3 overflow-hidden rounded-2xl border border-white/12 bg-[#080b12]"
                >
                  <summary className="cursor-pointer list-none px-3 py-2 text-[12px] font-semibold text-white/75 marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      本集静帧 / 成片画布
                      <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-normal text-white/40">
                        第{writerFocusEpisode}集 · 默认只看图视频
                      </span>
                      {factoryBusy ? (
                        <span className="text-[11px] font-normal text-amber-100/85">
                          {factoryProgress || "运行中…"}
                        </span>
                      ) : null}
                    </span>
                  </summary>
                  <div id="freeform-canvas-zone" className="scroll-mt-44 border-t border-white/10">
                    <div className="flex flex-wrap items-center gap-2 border-b border-white/8 px-3 py-2">
                      <label className="text-[10px] text-white/45">
                        呈现
                        <select
                          value={manhuaCanvasPresentation}
                          onChange={(e) =>
                            setManhuaCanvasPresentation(e.target.value as "media" | "all")
                          }
                          className="ml-1.5 rounded-md border border-white/12 bg-black/40 px-2 py-1 text-[11px] text-white/85"
                        >
                          <option value="media">仅图片与视频 + 提示词</option>
                          <option value="all">全部节点（含文本链）</option>
                        </select>
                      </label>
                      <span className="text-[10px] text-white/30">
                        文本大纲 / 节拍仍在工厂后台跑，不占主画布
                      </span>
                    </div>
                    <div className="min-h-[360px] md:min-h-[480px]">
                      <FreeformCanvas
                        blocks={blocks}
                        edges={edges}
                        onBlocksChange={handleBlocksChange}
                        onEdgesChange={handleEdgesChange}
                        runDeps={runDeps}
                        focusBlockId={focusBlockId}
                        onFocusBlockConsumed={() => setFocusBlockId(null)}
                        presentation={manhuaCanvasPresentation === "media" ? "media" : "full"}
                        focusEpisode={writerFocusEpisode}
                        spawnKinds={
                          manhuaCanvasPresentation === "media" ? ["image", "video"] : undefined
                        }
                        characterVoiceLocks={characterVoiceLocks}
                        onReplaceCharacterVoiceAudio={handleReplaceCharacterVoiceAudio}
                      />
                    </div>
                  </div>
                </details>
              ) : null}
            </div>

            {/* 角色库 / 资产墙：抽屉，不长期占主流程 */}
            {manhuaAssetDrawer ? (
              <div className="fixed inset-0 z-[80] flex justify-end bg-black/55 backdrop-blur-[2px]">
                <button
                  type="button"
                  className="absolute inset-0 cursor-default"
                  aria-label="关闭资产抽屉"
                  onClick={() => setManhuaAssetDrawer(null)}
                />
                <aside className="relative z-[81] flex h-full w-full max-w-3xl flex-col border-l border-cyan-400/20 bg-gradient-to-b from-[#0c1520] to-[#0a0e18] shadow-2xl">
                  <div className="flex items-center justify-between border-b border-cyan-400/15 px-4 py-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white/90">
                        {manhuaAssetDrawer === "characters" ? "角色库 · 画风" : "资产墙 · 场景道具"}
                        <span className="rounded-full border border-cyan-400/30 bg-cyan-500/12 px-1.5 py-0.5 text-[9px] font-medium text-cyan-100/85">
                          步骤 3–4
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-white/40">
                        手选始终覆盖自动推荐；确认编剧后写入专案设定并绑定各集
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setManhuaAssetDrawer(null)}
                      className="rounded-lg border border-white/15 p-1.5 text-white/70 hover:bg-white/10"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {manhuaAssetDrawer === "characters" ? (
                      <ManhuaCharacterGallery
                        femaleId={factoryFemaleId}
                        maleId={factoryMaleId}
                        femaleAutoApplied={femaleAutoApplied}
                        maleAutoApplied={maleAutoApplied}
                        artStyleId={factoryArtStyleId}
                        artStyleAutoApplied={artStyleAutoApplied}
                        disabled={factoryBusy}
                        topicHint={[factoryGenreLabel, factoryTopic].filter(Boolean).join(" ")}
                        ancientArchetypeIds={factoryAncientArchetypeIds}
                        castLane={castBundle.lane}
                        reasonZh={`${castBundle.reasonZh}；画风可自选仿真人或 CG（题材仅软推荐）${
                          castHardApplyReady
                            ? selectedCharacterIds.length || factoryAncientArchetypeIds.length
                              ? "；角色/场景/道具已按剧本预填，点选可改。"
                              : "；已确认编剧，可改角色与画风后再进分镜。"
                            : "；先扩写并确认剧本后，会预填造型（当前为软预览）。"
                        }`}
                        onSelectFemale={(id) => {
                          setFemaleLeadManual(true);
                          setFactoryFemaleId(id);
                        }}
                        onSelectMale={(id) => {
                          setMaleLeadManual(true);
                          setFactoryMaleId(id);
                        }}
                        onSelectArtStyle={(id) => {
                          setArtStyleManual(true);
                          setFactoryArtStyleId(id);
                        }}
                        onGenerateSameLayout={spawnSameLayoutSheet}
                        onToggleAncientArchetype={(id) => {
                          setAncientManual(true);
                          setFactoryAncientArchetypeIds((prev) => {
                            if (prev.includes(id)) return prev.filter((x) => x !== id);
                            return [...prev, id].slice(-2);
                          });
                        }}
                        onClearManual={() => {
                          setFemaleLeadManual(false);
                          setMaleLeadManual(false);
                          setArtStyleManual(false);
                          setAncientManual(false);
                          setWardrobeManual(false);
                          setPropManual(false);
                        }}
                      />
                    ) : (
                      <ManhuaAssetWall
                        femaleId={factoryFemaleId}
                        maleId={factoryMaleId}
                        sceneId={factorySceneId || recommendedScene?.id}
                        propIds={factoryPropIds}
                        topic={factoryTopic}
                        genreId={factoryGenreId}
                        artStyleId={factoryArtStyleId}
                        disabled={factoryBusy}
                        onSelectFemale={(id) => {
                          setFemaleLeadManual(true);
                          setFactoryFemaleId(id);
                        }}
                        onSelectMale={(id) => {
                          setMaleLeadManual(true);
                          setFactoryMaleId(id);
                        }}
                        onSelectScene={(id) => {
                          setSceneManual(true);
                          setFactorySceneId(id);
                        }}
                        onToggleProp={(id) => {
                          setPropManual(true);
                          setFactoryPropIds((prev) => {
                            if (prev.includes(id)) return prev.filter((x) => x !== id);
                            return [...prev, id].slice(-4);
                          });
                        }}
                      />
                    )}
                  </div>
                </aside>
              </div>
            ) : null}

            {/* ③ 编导工厂：经典表单（工作台模式下收起，专家控件仍可切回） */}
            {manhuaUiMode === "form" ? (
            <div
              className={`mt-4 max-w-3xl rounded-2xl border p-4 md:p-5 ${
                directorUnlocked || writerConfirmed
                  ? "border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent"
                  : "border-white/5 bg-white/[0.02] opacity-70"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-white/90">③ 编导分镜</div>
                <span className="text-[11px] text-white/40">
                  {directorUnlocked || writerConfirmed
                    ? "节拍 · 灯光运镜 · 静帧 · 成片"
                    : "请先在编剧室确认，或点「跳过连载扩写」"}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-md">
                <div>
                  <label className="block text-[11px] text-white/45">剧种（已铺板可同步）</label>
                  <select
                    value={factoryGenreId}
                    onChange={(e) => {
                      const next = e.target.value;
                      setFactoryGenreId(next);
                      if (!sceneManual) {
                        const rec = recommendManhuaSceneIdFromTopic({
                          genreId: next || undefined,
                          topic: factoryTopic,
                        });
                        setFactorySceneId(rec.sceneId || "");
                      }
                    }}
                    disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none focus:border-white/25 disabled:opacity-50"
                  >
                    <option value="">自动</option>
                    {genreOptions.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.labelZh}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-white/45">
                    场景（推荐单一）
                    {sceneManual ? (
                      <button
                        type="button"
                        className="ml-2 text-emerald-300/90 underline-offset-2 hover:underline"
                        onClick={() => setSceneManual(false)}
                      >
                        恢复自动推荐
                      </button>
                    ) : null}
                  </label>
                  <select
                    value={factorySceneId}
                    onChange={(e) => {
                      setSceneManual(true);
                      setFactorySceneId(e.target.value);
                    }}
                    disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none focus:border-white/25 disabled:opacity-50"
                  >
                    <option value="">
                      {recommendedScene
                        ? `推荐 · ${String(recommendedScene.no).padStart(2, "0")} ${recommendedScene.nameZh}`
                        : "按题材自动推荐一条"}
                    </option>
                    {sceneOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {String(s.no).padStart(2, "0")} {s.nameZh}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {recommendedScene ? (
                <p className="mt-1.5 text-[10px] text-emerald-200/75">
                  场景推荐：{String(recommendedScene.no).padStart(2, "0")} {recommendedScene.nameZh}
                  {sceneAutoApplied ? " ·自动" : sceneManual ? " ·手选" : ""}
                </p>
              ) : null}

              {/* 主区只留：手法 + 运镜工作台；其余进折叠，降低侧栏密度 */}
              <div className="mt-3 max-w-md space-y-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="block text-[11px] text-white/45">拍摄手法</label>
                    {craftAutoApplied ? (
                      <span className="rounded-md border border-emerald-400/35 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] text-emerald-100">
                        已自动
                      </span>
                    ) : null}
                    {craftShotManual ? (
                      <button
                        type="button"
                        disabled={factoryBusy}
                        onClick={() => setCraftShotManual(false)}
                        className="text-[10px] text-sky-200/80 underline-offset-2 hover:underline disabled:opacity-40"
                      >
                        恢复推荐
                      </button>
                    ) : null}
                  </div>
                  <select
                    value={factoryCraftShotId}
                    onChange={(e) => {
                      setCraftShotManual(true);
                      setFactoryCraftShotId(e.target.value);
                    }}
                    disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                    className="mt-1 w-full rounded-lg border border-violet-400/25 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none focus:border-violet-300/40 disabled:opacity-50"
                  >
                    <option value="">不指定</option>
                    {craftShotGrouped.map((g) => (
                      <optgroup key={g.category} label={g.label}>
                        {g.items.map((e) => (
                          <option key={e.id} value={e.id}>
                            {String(e.no).padStart(2, "0")} {e.nameZh}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <ManhuaPathCameraAnnotatePanel
                  imageUrl={keyArtPreviewUrl || undefined}
                  value={factoryPathAnnotation}
                  recipeId={factoryPathRecipeId}
                  actionRecipeId={factoryActionRecipeId}
                  disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                  onChange={setFactoryPathAnnotation}
                  onRecipeIdChange={(id) => {
                    setPathRecipeManual(true);
                    setFactoryPathRecipeId(id);
                  }}
                  onActionRecipeIdChange={(id) => {
                    setActionRecipeManual(true);
                    setFactoryActionRecipeId(id);
                  }}
                  translateMotionZh={translateMotionZh}
                />
                <p className="text-[10px] text-white/35">
                  {!pathRecipeManual || !actionRecipeManual
                    ? "已按题材/本集剧情自动带入运镜与动作轨迹（打斗、比赛、多人、肢体移位等，可改）。"
                    : ""}
                  {recommendedPath.reasonZh}
                  {recommendedAction.reasonZh ? ` · ${recommendedAction.reasonZh}` : ""}
                </p>

                <div className="rounded-lg border border-white/10 bg-white/[0.02]">
                  <button
                    type="button"
                    onClick={() => setFactoryAdvancedOpen((v) => !v)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-medium text-white/70 hover:bg-white/[0.04]"
                  >
                    <span>进阶（灯光·造型·宣发·词条·动效）</span>
                    <span className="text-white/40">{factoryAdvancedOpen ? "收起" : "展开"}</span>
                  </button>
                  {factoryAdvancedOpen ? (
                    <div className="space-y-3 border-t border-white/8 px-3 py-3">
                      <div>
                        <label className="block text-[11px] text-white/45">叙事灯光</label>
                        <select
                          value={factoryNarrativeLightingId}
                          onChange={(e) => {
                            setNarrativeLightingManual(true);
                            setFactoryNarrativeLightingId(e.target.value);
                          }}
                          disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                          className="mt-1 w-full rounded-lg border border-amber-400/25 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                        >
                          <option value="">不指定</option>
                          {listNarrativeLighting().map((e) => (
                            <option key={e.id} value={e.id}>
                              {String(e.no).padStart(2, "0")} {e.nameZh}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-[10px] text-amber-100/60">
                          {recommendedNarrativeLighting.reasonZh}
                        </p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] text-white/45">男发</label>
                          <select
                            value={factoryMaleHairstyleId}
                            onChange={(e) => setFactoryMaleHairstyleId(e.target.value)}
                            disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                          >
                            <option value="">不指定</option>
                            {listMaleHairstylePresets().map((e) => (
                              <option key={e.id} value={e.id}>
                                {String(e.no).padStart(2, "0")} {e.nameZh}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-white/45">微表情</label>
                          <select
                            value={factoryMaleMicroId}
                            onChange={(e) => {
                              setMaleMicroManual(true);
                              setFactoryMaleMicroId(e.target.value);
                            }}
                            disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                          >
                            <option value="">不指定</option>
                            {listMaleMicroExpressions().map((e) => (
                              <option key={e.id} value={e.id}>
                                {String(e.no).padStart(2, "0")} {e.nameZh}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-white/45">宣发封面</label>
                        <select
                          value={factoryPromoLayoutId}
                          onChange={(e) => setFactoryPromoLayoutId(e.target.value)}
                          disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                          className="mt-1 w-full rounded-lg border border-fuchsia-400/25 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                        >
                          <option value="">不铺宣发封面</option>
                          {listPromoCoverLayouts().map((e) => (
                            <option key={e.id} value={e.id}>
                              {String(e.no).padStart(2, "0")} {e.nameZh}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] text-white/45">运镜词条</label>
                          <select
                            value={factoryCineVocabId}
                            onChange={(e) => setFactoryCineVocabId(e.target.value)}
                            disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                          >
                            <option value="">不指定</option>
                            {MANHUA_CINE_VOCAB_BANK.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.zh}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-white/45">词条语言</label>
                          <select
                            value={factoryCineVocabLocale}
                            onChange={(e) =>
                              setFactoryCineVocabLocale(e.target.value as ManhuaCineVocabLocale)
                            }
                            disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                          >
                            {(
                              Object.keys(MANHUA_CINE_VOCAB_LOCALE_LABEL_ZH) as ManhuaCineVocabLocale[]
                            ).map((loc) => (
                              <option key={loc} value={loc}>
                                {MANHUA_CINE_VOCAB_LOCALE_LABEL_ZH[loc]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-white/45">服装道具连续</label>
                          <select
                            value={factoryWardrobeId}
                            onChange={(e) => {
                              setWardrobeManual(true);
                              setFactoryWardrobeId(e.target.value);
                            }}
                            disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                          >
                            <option value="">不指定</option>
                            {listWardrobePropContinuity().map((e) => (
                              <option key={e.id} value={e.id}>
                                {String(e.no).padStart(2, "0")} {e.nameZh}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] text-white/45">反推档</label>
                          <select
                            value={factoryReverseMode}
                            onChange={(e) =>
                              setFactoryReverseMode(e.target.value as VideoReverseOutputMode)
                            }
                            disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                          >
                            <option value="zh">完整中文八维</option>
                            <option value="compact">精简档</option>
                            <option value="en">English</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-white/45">包装动效</label>
                          <select
                            value={factoryMotionId}
                            onChange={(e) => {
                              setMotionManual(true);
                              setFactoryMotionId(e.target.value);
                            }}
                            disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                          >
                            <option value="">不指定</option>
                            {motionGrouped.map((g) => (
                              <optgroup key={g.category} label={g.label}>
                                {g.items.map((e) => (
                                  <option key={e.id} value={e.id}>
                                    {String(e.no).padStart(2, "0")} {e.nameZh}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-white/8 pt-3">
                {stageChipStatus.map((s) => (
                  <span
                    key={s.stage}
                    className={`rounded-md border px-2 py-0.5 text-[10px] tracking-wide ${
                      s.status === "done"
                        ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-100"
                        : s.status === "running"
                          ? "border-sky-400/35 bg-sky-500/12 text-sky-100"
                          : s.status === "error"
                            ? "border-red-400/35 bg-red-500/12 text-red-100"
                            : "border-white/10 bg-white/[0.03] text-white/45"
                    }`}
                  >
                    {s.label}
                  </span>
                ))}
                {factoryProgress ? (
                  <span className="ml-auto text-[11px] text-sky-200/85">{factoryProgress}</span>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-white/55">
                <span>运行范围</span>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="factory-run-scope"
                    checked={factoryRunScope === "focus"}
                    onChange={() => setFactoryRunScope("focus")}
                    className="accent-sky-400"
                  />
                  当前焦点集（第{writerFocusEpisode}集）
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="factory-run-scope"
                    checked={factoryRunScope === "dock"}
                    onChange={() => setFactoryRunScope("dock")}
                    className="accent-amber-400"
                  />
                  成片坞已勾选集
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-50 hover:bg-rose-500/25 disabled:opacity-50"
                  onClick={() => {
                    const continuity = writerPack
                      ? resolveManhuaEpisodeSpawnContinuity(writerPack.episodes, writerFocusEpisode)
                      : {
                          episodeIndex: writerFocusEpisode,
                          episodeTitle: undefined as string | undefined,
                          endingHook: undefined as string | undefined,
                          previousEndingHook: undefined as string | undefined,
                          previouslyOnRecap: undefined as string | undefined,
                        };
                    const focusCtx =
                      writerPack && writerConfirmed
                        ? composeWriterPackFactoryContext(writerPack, continuity.episodeIndex)
                        : writerContext;
                    const spawned = spawnManhuaDramaStudio({
                      originX: 60,
                      originY: 80 + Math.max(0, continuity.episodeIndex - 1) * 420,
                      topic: factoryTopic,
                      seriesTitle: writerPack?.seriesTitle,
                      genreId: factoryGenreId || undefined,
                      sceneId: factorySceneId || undefined,
                      propIds: factoryPropIds,
                      characterIds: selectedCharacterIds,
                      ancientArchetypeIds: factoryAncientArchetypeIds,
                      identityLockZh: factoryIdentityLockZh || castBundle.identityLockZh,
                      artStyleId: factoryArtStyleId,
                      motionPromptIds: selectedMotionIds,
                      craftShotIds: selectedCraftShotIds,
                      pathCameraRecipeIds: selectedPathRecipeIds,
                      pathAnnotationJson: factoryPathAnnotation,
                      narrativeLightingIds: selectedNarrativeLightingIds,
                      maleHairstyleIds: selectedMaleHairstyleIds,
                      maleMicroExpressionIds: selectedMaleMicroIds,
                      promoCoverLayoutIds: selectedPromoLayoutIds,
                      actionCameraRecipeIds: selectedActionRecipeIds,
                      cineVocabIds: selectedCineVocabIds,
            cineVocabLocale: factoryCineVocabLocale,
                      wardrobePropContinuityIds: selectedWardrobeIds,
                      videoReverseOutputMode: factoryReverseMode,
                      customRefs: customAssetRefs,
                      assetCanon: projectBible?.assetCanon,
                      writerContext: focusCtx,
                      includeDirectorCraft: true,
                      episodeIndex: continuity.episodeIndex,
                      episodeTitle: continuity.episodeTitle,
                      endingHook: continuity.endingHook,
                      previousEndingHook: continuity.previousEndingHook,
                      previouslyOnRecap: continuity.previouslyOnRecap,
                    });
                    if (spawned.genreInferred && spawned.resolvedGenreId && !factoryGenreId) {
                      setFactoryGenreId(spawned.resolvedGenreId);
                    }
                    if (spawned.resolvedSceneId && !factorySceneId) {
                      setFactorySceneId(spawned.resolvedSceneId);
                    }
                    const hasOtherEpisodes = blocks.some((b) => {
                      const ep = getBlockEpisodeIndex(b);
                      return ep != null && ep !== continuity.episodeIndex;
                    });
                    if (hasOtherEpisodes) {
                      const merged = replaceManhuaEpisodeChain(
                        blocks,
                        edges,
                        spawned,
                        continuity.episodeIndex,
                      );
                      setBlocks(merged.blocks);
                      setEdges(merged.edges);
                      saveCanvasState(merged.blocks, merged.edges);
                      remapDockSelectionAfterSpawn(merged.blocks, continuity.episodeIndex);
                      toast.success(`已重铺第${continuity.episodeIndex}集节点（其它集保留）`);
                    } else {
                      setBlocks(spawned.blocks);
                      setEdges(spawned.edges);
                      saveCanvasState(spawned.blocks, spawned.edges);
                      remapDockSelectionAfterSpawn(spawned.blocks, continuity.episodeIndex);
                      toast.success("已铺好编导节点（含视频改写）");
                    }
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  铺节点
                </button>
                <button
                  type="button"
                  disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 hover:bg-emerald-500/30 disabled:opacity-50"
                  onClick={() => void runFactory("reverse")}
                >
                  {factoryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  自动跑到反推
                </button>
                <button
                  type="button"
                  disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/35 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-50"
                  onClick={() => void runFactory("keyart")}
                >
                  {factoryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  跑到静帧
                </button>
                <button
                  type="button"
                  disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
                  onClick={() => void runFactory("clip", { forceFromStage: "reverse" })}
                >
                  从反推续跑
                </button>
                <button
                  type="button"
                  disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-orange-400/35 bg-orange-500/15 px-3 py-2 text-xs font-semibold text-orange-50 hover:bg-orange-500/25 disabled:opacity-50"
                  onClick={resumeFromFailure}
                >
                  从失败处续跑
                </button>
                {factoryBusy ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-red-400/40 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/25"
                    onClick={stopFactory}
                    title="立刻中断，不必跑完整条链"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                    中断生成
                  </button>
                ) : null}
              </div>
            </div>
            ) : null}

            <div id="manhua-clip-dock-zone" className="mt-4 max-w-4xl scroll-mt-44">
              <ManhuaClipDock
                blocks={blocks}
                topic={factoryTopic}
                seriesTitle={writerPack?.seriesTitle}
                characterIds={selectedCharacterIds}
                artStyleId={factoryArtStyleId}
                sceneId={factorySceneId || recommendedScene?.id}
                writerPackMarkdown={writerConfirmed ? writerPack?.rawMarkdown : undefined}
                selectedIds={dockSelectedIds}
                onSelectedIdsChange={setDockSelectedIds}
                assembleBusy={assembleBusy}
                finalVideoUrl={finalAssembleVideoUrl}
                onAssembleFinal={(clips) => void assembleManhuaFinal(clips)}
                deliveryPackage={deliveryPackage}
                cineVocabIds={selectedCineVocabIds}
                factoryBusy={factoryBusy}
                onRetakeClip={handleRetakeClip}
                onAcceptClipDespiteQc={(clipBlockId) => {
                  setBlocks((prev) => {
                    const next = prev.map((b) => {
                      if (b.id !== clipBlockId || !b.manhuaClipQuality) return b;
                      return {
                        ...b,
                        manhuaClipQuality: {
                          ...b.manhuaClipQuality,
                          userAcceptedDespiteQc: true,
                        },
                        error: b.manhuaClipQuality.summary
                          ? `已采用（质检未过）：${b.manhuaClipQuality.summary}`
                          : "已采用（质检未过）",
                      };
                    });
                    setEdges((eds) => {
                      saveCanvasState(next, eds);
                      return eds;
                    });
                    return next;
                  });
                  setDockSelectedIds((prev) => {
                    const next = new Set(prev);
                    next.add(clipBlockId);
                    return next;
                  });
                  toast.message("已采用此片", {
                    description: "可参与长片合成。",
                  });
                }}
                onGoWorkbench={() => {
                  setManhuaUiMode("workbench");
                  setImmersiveExtrasOpen(false);
                  window.setTimeout(() => {
                    document.querySelector("#manhua-workbench-zone")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }, 60);
                }}
                onSelectEpisode={(ep) => {
                  setWriterFocusEpisode(ep);
                  setManhuaUiMode("workbench");
                  setImmersiveExtrasOpen(false);
                }}
                onFocusBlock={(id) => {
                  const hit = blocks.find((b) => b.id === id);
                  const ep = hit ? getBlockEpisodeIndex(hit) : null;
                  if (ep != null) setWriterFocusEpisode(ep);
                  setImmersiveExtrasOpen(true);
                  openManhuaFactoryCanvas(id);
                }}
              />
            </div>
            </div>
            </>
            ) : null}
          </div>

          {canvasMode === "freeform" ? (
          <div id="freeform-canvas-zone" className="scroll-mt-24">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-semibold text-white/85">自由画布</div>
              <span className="text-[11px] text-white/40">
                多任务节点自由接线 · 文生图 / 视频 / 提文字 / 文案
              </span>
            </div>
          <FreeformCanvas
            blocks={blocks}
            edges={edges}
            onBlocksChange={handleBlocksChange}
            onEdgesChange={handleEdgesChange}
            runDeps={runDeps}
            focusBlockId={focusBlockId}
            onFocusBlockConsumed={() => setFocusBlockId(null)}
            characterVoiceLocks={characterVoiceLocks}
            onReplaceCharacterVoiceAudio={handleReplaceCharacterVoiceAudio}
          />
          </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
