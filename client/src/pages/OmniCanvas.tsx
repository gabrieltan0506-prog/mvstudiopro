import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Navbar from "@/components/Navbar";
import FreeformCanvas from "@/components/canvas/FreeformCanvas";
import ManhuaClipDock from "@/components/canvas/ManhuaClipDock";
import type { CanvasBlock, CanvasEdge } from "@/lib/canvasTypes";
import { defaultCanvasBlock, makeCanvasBlockId, normalizeCanvasBlock } from "@/lib/canvasTypes";
import { runCanvasBlock, type CanvasRunDeps } from "@/lib/canvasRunBlock";
import { cropManhuaSheet2x2 } from "@/lib/manhuaSheetCropApi";
import type { ManhuaSceneTileSlot } from "@shared/manhuaSceneTilePick";
import {
  evaluateManhuaAssetImageGate,
  manhuaHeroFaceSheetId,
  planManhuaAssetImageSpawns,
  seedIdFromManhuaSheetBlockId,
} from "@shared/manhuaAssetImageGate";
import {
  applyManhuaRerunCompilePatch,
  compileManhuaAssetSheetPromptForRerun,
  isManhuaAssetSheetBlockId,
  isManhuaClipBlockId,
  shouldRecompileManhuaBlockOnRerun,
} from "@shared/manhuaCanvasRerunCompile";
import {
  directorBoardHttpsByEpisode,
  loadManhuaDirectorBoardMainByEpisode,
  normalizeDirectorBoardMainByEpisode,
  saveManhuaDirectorBoardMainByEpisode,
  type ManhuaDirectorBoardMainByEpisode,
} from "@/lib/manhuaDirectorBoardStore";
import { MANHUA_PROP_SHAPE_LOOKUP_MAX } from "@shared/manhuaPropShapeHint";
import { recommendApprovedManhuaViralTemplate } from "@shared/manhuaViralTemplateBank";
import {
  buildManhuaCustomAssetGenFromLibraryPrompt,
  countManhuaUnclassifiedCustomAssetRefs,
  defaultManhuaCustomAssetRefDuty,
  makeManhuaCustomAssetId,
  MANHUA_CUSTOM_ASSET_REFS_MAX,
  normalizeManhuaCustomAssetRefs,
  upsertGeneratedManhuaCustomAssetRef,
  type ManhuaCustomAssetRef,
  type ManhuaCustomAssetRefDuty,
  type ManhuaCustomAssetRole,
} from "@shared/manhuaCustomAssetRefs";
import {
  collectStaleAssetSheetBlockIds,
  evaluateManhuaAssetScriptAlignment,
  fingerprintManhuaWriterAssetCanon,
  planManhuaSheetAdoptions,
  purgeStaleCustomAssetRefsForCanon,
} from "@shared/manhuaAssetScriptSync";
import { resolveManhuaCustomAssetSeed } from "@shared/manhuaCustomAssetSeed";
import { absolutizeManhuaAssetUrl } from "@shared/manhuaKeyartEditFusion";
import {
  buildManhuaAssetLockRegistry,
  buildManhuaAssetPathById,
  buildManhuaAssetTileUrlsById,
  type ManhuaMentionCandidate,
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
import {
  anonymizeManhuaLibraryLabelZh,
  decideManhuaAssetRecycle,
  type ManhuaAssetRecycleRole,
} from "@shared/manhuaAssetRecycle";
import {
  MANHUA_ASSET_STASH_STORAGE_KEY,
  mergeManhuaAssetStash,
  parseManhuaAssetStash,
  type ManhuaAssetStashEntry,
  type ManhuaAssetStashRole,
} from "@shared/manhuaAssetStash";
import { uploadCanvasFilesParallel } from "@/lib/canvasUpload";
import { resolveOmniMaterialUrl } from "@/lib/omniCanvasApi";
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
  collectManhuaPropImageUrlById,
  collectManhuaEpisodeSegmentPromptsForVoiceGate,
  countExpectedManhuaKeyartShots,
  queuedManhuaKeyartBlocks,
  resolveManhuaCanvasClipVideoModel,
  resolveManhuaClipRelatedAssetNodeIds,
  runManhuaDramaFactoryPipeline,
  sanitizeManhuaClipBlocksPrompts,
  sanitizeManhuaRecapUpstreamLinks,
  spawnManhuaDramaStudio,
  spawnManhuaDramaStudioSeries,
  stageKeyFromBlockId,
  stripManhuaFactoryCanvasArtifacts,
  stripManhuaSeriesAssetsForNewProject,
  syncManhuaClipAssetEdges,
  type ManhuaFactoryStageKey,
} from "@/lib/canvasDramaStudio";
import { layoutManhuaCanvasBlocks, MANHUA_CANVAS_LAYOUT } from "@/lib/manhuaCanvasLayout";
import {
  collectManhuaClipDockItems,
  episodeIndexesFromDockSelection,
} from "@/lib/manhuaProjectExport";
import {
  confirmManhuaSeriesSwitchWithBackup,
  downloadManhuaSeriesSwitchBackup,
  inspectManhuaSeriesSwitchRisk,
} from "@/lib/manhuaSeriesSwitchGate";
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
import { getManhuaDemoAsset } from "@shared/manhuaScenePropDemoCatalog";
import {
  buildManhuaProjectBible,
  summarizeManhuaProjectBible,
  type ManhuaProjectBible,
} from "@shared/manhuaProjectBible";
import {
  detectManhuaCanonWriterDrift,
  evaluateWriterPackAssetAndDensity,
  formatWriterAssetCanonFactoryAddon,
  formatWriterAssetCanonIdentityLock,
} from "@shared/manhuaWriterAssetCanon";
import {
  healManhuaWriterSessionCanonDrift,
  loadManhuaWriterSessionFromStorage,
  saveManhuaWriterSessionToStorage,
} from "@shared/manhuaWriterSession";
import {
  makeManhuaCharacterVoiceLockId,
  normalizeManhuaCharacterVoiceLocks,
  type ManhuaCharacterVoiceLock,
} from "@shared/manhuaCharacterVoiceLock";
import {
  normalizeManhuaAudioReferenceLock,
  type ManhuaAudioReferenceLock,
} from "@shared/manhuaAudioReferenceLock";
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
  cacheCanvasMediaToLocalStore,
  rehydrateBlocksFromLocalMedia,
  scheduleCacheCanvasMediaToLocalStore,
} from "@/lib/manhuaLocalMediaStore";
import {
  MANHUA_CLIP_AUTO_DOWNLOAD_HINT_ZH,
  collectPendingClipAutoDownloads,
  runPendingClipAutoDownloads,
} from "@/lib/manhuaClipAutoDownload";
import {
  loadManhuaShotContinuityPrefs,
  saveManhuaShotContinuityPrefs,
  type ManhuaShotContinuityPrefs,
} from "@shared/manhuaShotContinuity";
import { MANHUA_ASSEMBLE_MUSIC_DURATION_SEC } from "@shared/manhuaFinalAssemble";
import { buildManhuaAssembleJobInput } from "@shared/manhuaAssembleJobInput";
import ManhuaCharacterGallery from "@/components/ManhuaCharacterGallery";
import ManhuaGuidedPathRail from "@/components/ManhuaGuidedPathRail";
import ManhuaCastStrip from "@/components/ManhuaCastStrip";
import ManhuaLiveProgressBoard from "@/components/ManhuaLiveProgressBoard";
import ManhuaScriptWorkbench from "@/components/ManhuaScriptWorkbench";
import ManhuaAssetWall from "@/components/ManhuaAssetWall";
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";
import { createJobSameOrigin, pollJobUntilTerminal } from "@/lib/jobs";
import { buildCanvasGptImage2JobInput } from "@shared/canvasGptImage2JobInput";
import {
  manhuaAssetStandardizeCredits,
  type ManhuaAssetStandardizeQuality,
} from "@shared/manhuaAssetStandardize";
import {
  CRAFT_SHOT_BANK,
  CRAFT_SHOT_CATEGORY_LABEL_ZH,
  getCraftShotById,
  recommendCraftShotFromTopic,
  type CraftShotCategory,
} from "@shared/craftShotBank";
import {
  getPathCameraRecipeById,
  recommendPathCameraFromTopic,
} from "@shared/manhuaPathCameraRecipeBank";
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
import {
  getActionCameraRecipeById,
  recommendActionCameraFromTopic,
} from "@shared/manhuaActionCameraRecipeBank";
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
  MANHUA_EPISODE_LENGTH_TIERS,
  MANHUA_EPISODE_LENGTH_TIER_DEFAULT,
  type ManhuaEpisodeLengthTierId,
  getManhuaEpisodeLengthTier,
  parseManhuaEpisodeSegmentPlanFromMarkdown,
  upsertManhuaSegmentCastInMarkdown,
  upsertManhuaSegmentIntentInMarkdown,
} from "@shared/manhuaEpisodeSegmentPlan";
import {
  patchPromptForRetakeVariable,
  type ManhuaRetakeVariable,
} from "@shared/manhuaDirectingWorkflow";
import { listWardrobePropContinuity } from "@shared/manhuaWardrobePropContinuity";
import ManhuaPathRecipePicker from "@/components/ManhuaPathRecipePicker";
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
  spliceManhuaWriterPackFromEpisode,
  writerPackLooksReady,
  type ManhuaWriterPack,
} from "@shared/manhuaWriterRoom";
import {
  hasManhuaSeedanceLayoutChoice,
  MANHUA_SEEDANCE_LAYOUT_CHOICES,
  migrateRetiredManhuaLayoutVideoModel,
  manhuaSeedanceLayoutPinsSegmentTable,
  resolveManhuaFactoryDefaultVideoModel,
  resolveManhuaSeedanceLayoutProfile,
  type ManhuaSeedanceLayoutVideoModel,
} from "@shared/manhuaSeedanceLayout";
import {
  resolveSeedance25Access,
  SEEDANCE_25_PAID_ONLY_LABEL_ZH,
} from "@shared/seedance25Access";
import { useAuth } from "@/_core/hooks/useAuth";
import { hasSupervisorAccess } from "@/lib/supervisorAccess";
import {
  MANHUA_WRITER_EXPAND_CREDITS_PER_EPISODE,
  MANHUA_WRITER_EXPAND_TIERS,
  type ManhuaWriterExpandTierId,
} from "@shared/manhuaWriterExpandPricing";
import {
  canvasVideoClipCredits,
  manhuaEpisodeTotalCredits,
} from "@shared/canvasGenerationPricing";
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


/** 已确认会跨专案复活的三件都市演示道具；未知 id 视为用户自有资产，不误删。 */
const LEGACY_GHOST_DEMO_PROP_IDS = new Set([
  "demo_prop_romance_ring_box",
  "demo_prop_romance_lipstick",
  "demo_prop_romance_handkerchief",
]);

/**
 * 古风专案里过滤掉「现代演示道具」残留（丝绒戒指盒 romance/同款口红 romance/
 * 绣帕信物 intrigue——用户点名的幽灵三件套均在此列）。
 * 只过滤已确认的演示 id；查不到目录的 id（用户自有资产）一律保留，不误伤。
 */
function stripUrbanDemoPropIds(ids: string[]): string[] {
  return (ids || []).filter((id) => !LEGACY_GHOST_DEMO_PROP_IDS.has(id));
}

function manhuaAssetSelectionScopeKey(
  topic: string,
  canon: Parameters<typeof fingerprintManhuaWriterAssetCanon>[0],
): string {
  return `${String(topic || "").trim().slice(0, 80)}::${fingerprintManhuaWriterAssetCanon(canon)}`;
}

export default function OmniCanvas() {
  const { user } = useAuth({ redirectOnUnauthenticated: false });
  const [supervisorAccess] = useState(() => hasSupervisorAccess());
  const canShowCanvasDebug =
    supervisorAccess || user?.role === "admin" || user?.role === "supervisor";
  /** 成片·加长门禁：与服务端 resolveSeedance25Access 同口径，工厂批量段成片也要吃到 plan+role */
  const subscriptionQuery = trpc.stripe.getSubscription.useQuery(undefined, { retry: false });
  const userPlan = (subscriptionQuery.data?.plan || "free") as string;
  const userRole = user?.role ?? null;
  const seedance25Gate = resolveSeedance25Access({ plan: userPlan, role: userRole });
  const canUseSeedance25 = seedance25Gate.allowed;
  const factoryDefaultVideoModel = resolveManhuaFactoryDefaultVideoModel({
    plan: userPlan,
    role: userRole,
  });
  const writerLayoutChoices = MANHUA_SEEDANCE_LAYOUT_CHOICES.filter(
    (c) => c.videoModel !== "seedance-2.5" || canUseSeedance25,
  );
  /** toast/title 用：动态拼引擎档名，新增档位自动带上，不用再手改文案 */
  const writerLayoutChoiceLabelsZh = writerLayoutChoices
    .map((c) => c.labelZh.replace("成片·", ""))
    .join(" / ");
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
  /** 资产暂存区条数（清图/重出前存的，可救回）；boot 时从本地读 */
  const [assetStashCount, setAssetStashCount] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    try {
      return parseManhuaAssetStash(
        window.localStorage.getItem(MANHUA_ASSET_STASH_STORAGE_KEY),
      ).length;
    } catch {
      return 0;
    }
  });
  /** 确认编剧后的专案 Bible（系列级真相；≠ 工厂节点 bible-*） */
  const [projectBible, setProjectBible] = useState<ManhuaProjectBible | null>(() => bootBible);
  /** 集号 → 导演板裁后主画面（长期 gcsUri + 现签 url） */
  const [directorBoardMainByEpisode, setDirectorBoardMainByEpisode] =
    useState<ManhuaDirectorBoardMainByEpisode>(loadManhuaDirectorBoardMainByEpisode);
  const resignedBoardGcsUriRef = useRef<Set<string>>(new Set());
  /** 出片/ensure 用的 HTTPS map（由 gcsUri 现签或缓存 url） */
  const directorBoardUrlByEpisode = useMemo(
    () => directorBoardHttpsByEpisode(directorBoardMainByEpisode),
    [directorBoardMainByEpisode],
  );
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
  const [factoryCraftShotId, setFactoryCraftShotId] = useState("");
  /** 手选手法后不再被题材自动覆盖 */
  const [craftShotManual, setCraftShotManual] = useState(false);
  const [factoryPathRecipeId, setFactoryPathRecipeId] = useState("");
  const [pathRecipeManual, setPathRecipeManual] = useState(false);
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
  /** 可拍表点名的角色在资产库找不到：成片会喂错脸，出片门禁据此拦下 */
  const [segmentCastMismatch, setSegmentCastMismatch] = useState<{
    segmentIndexes: number[];
    castNames: string[];
  } | null>(null);
  /** 有人在场却一张角色垫图都没绑上：成片不锁脸，每段一张新面孔 */
  const [segmentNoFaceLock, setSegmentNoFaceLock] = useState<{
    segmentIndexes: number[];
    castNames: string[];
  } | null>(null);
  const [writerBrief, setWriterBrief] = useState(() => initialWriterSession?.brief || "");
  const [viralTemplateId, setViralTemplateId] = useState(
    () => String(initialWriterSession?.viralTemplateId || "").trim(),
  );
  const [writerEpisodeCount, setWriterEpisodeCount] = useState(() =>
    clampWriterEpisodeCount(initialWriterSession?.episodeCount ?? MANHUA_WRITER_EPISODE_DEFAULT),
  );
  /** 扩写引擎档位：四档，默认优秀；前台只显示档名，不出现模型名 */
  const [writerExpandTier, setWriterExpandTier] = useState<ManhuaWriterExpandTierId>("excellent");
  /** 失败/丢响应后同参数重试复用请求键；成功后清空，下一次主动扩写重新计费。 */
  const writerExpandRetryRef = useRef<{ signature: string; requestId: string } | null>(null);
  /** 单集时长档位：段长恒定 15s，切档只改一集几段（2.5 时由成片引擎覆盖） */
  const [writerLengthTierId, setWriterLengthTierId] = useState<ManhuaEpisodeLengthTierId>(
    MANHUA_EPISODE_LENGTH_TIER_DEFAULT,
  );
  /** 开场成片引擎：决定扩写段数与铺板 clip.videoModel；无会话时按权限预选默认档 */
  const [writerVideoModel, setWriterVideoModel] = useState<ManhuaSeedanceLayoutVideoModel | "">(
    // 已下线引擎（Happy Horse）迁到等价档，不认得的留空等用户选
    () => migrateRetiredManhuaLayoutVideoModel(initialWriterSession?.videoModel),
  );
  /**
   * 这个选型是「用户/会话真选的」还是「界面自动预选的默认档」。
   *
   * 下游 `ensureManhuaFragmentClips` 把显式选型当成「盖过存量段节点」的授权，
   * 而无会话选型时界面会自动预选 mini——若把自动值也当显式，打开一张历史 2.5 画布
   * 就会被静默改档：段表 4→6、上游换成 mini、扣费口径跟着变。自动预选不算数，
   * 那时让存量节点上盖着的引擎说话。
   */
  const [writerVideoModelPicked, setWriterVideoModelPicked] = useState(() =>
    Boolean(migrateRetiredManhuaLayoutVideoModel(initialWriterSession?.videoModel)),
  );
  /** 只有真选过才向下游透传；否则交给存量节点的既有引擎 */
  const explicitWriterVideoModel = writerVideoModelPicked ? writerVideoModel : "";

  // 订阅/角色到位后：无会话选型时预选权限许可的默认档；会话里若是无权限的 2.5 则降级
  useEffect(() => {
    if (subscriptionQuery.isLoading) return;
    setWriterVideoModel((prev) => {
      if (!prev) return factoryDefaultVideoModel;
      if (prev === "seedance-2.5" && !canUseSeedance25) {
        return factoryDefaultVideoModel;
      }
      return prev;
    });
  }, [subscriptionQuery.isLoading, factoryDefaultVideoModel, canUseSeedance25]);
  const writerLayoutProfile = resolveManhuaSeedanceLayoutProfile(
    // 界面口径跟着界面上高亮的那一档走，与「是否算显式选型」无关
    writerVideoModel || undefined,
    writerLengthTierId,
  );
  /**
   * 改写起点：0 = 全部重写；否则只重写第 N 集起（可再指定集内第几段）。
   * 已出片的段落按付费资产处理——起点之前一律不动，起点之后归档不删除。
   */
  const [writerFromEpisode, setWriterFromEpisode] = useState(0);
  const [writerFromSegment, setWriterFromSegment] = useState(1);
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
  // 一键清空面板：备份下载默认勾选，避免用户手滑清空却没留备份
  const [showClearSeriesConfirm, setShowClearSeriesConfirm] = useState(false);
  const [clearSeriesWithBackup, setClearSeriesWithBackup] = useState(true);
  const [writerFocusEpisode, setWriterFocusEpisode] = useState(() =>
    Math.max(1, Math.floor(Number(initialWriterSession?.focusEpisode) || 1)),
  );
  /** 折叠起来的集：多集铺开后画布会很长，折叠让它只占一行高度 */
  const [collapsedManhuaEpisodes, setCollapsedManhuaEpisodes] = useState<Set<number>>(
    () => new Set(),
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
  /**
   * 长期资产的签名 url 会过期（如道具拼板切图，7 天）。有 gcsUri 的条目，
   * 每次这份草稿加载/变动时现签一次刷新 url——不在这里刷，等到真正点「生成」
   * 时才发现 403 就晚了。按 gcsUri 去重，避免刚刷完又把自己刷一遍死循环。
   */
  const resignedPropGcsUriRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const stale = customAssetRefs.filter(
      (r) => r.gcsUri && !resignedPropGcsUriRef.current.has(r.gcsUri),
    );
    if (!stale.length) return;
    let cancelled = false;
    void (async () => {
      const resolved = await Promise.all(
        stale.map(async (r) => {
          try {
            const url = await resolveOmniMaterialUrl(r.gcsUri!);
            return { id: r.id, gcsUri: r.gcsUri!, url };
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const byId = new Map<string, string>();
      for (const r of resolved) {
        if (!r) continue;
        resignedPropGcsUriRef.current.add(r.gcsUri);
        byId.set(r.id, r.url);
      }
      if (!byId.size) return;
      setCustomAssetRefs((prev) =>
        prev.map((r) => (byId.has(r.id) ? { ...r, url: byId.get(r.id)! } : r)),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [customAssetRefs]);
  /** 导演板签名 url 过期：有 gcsUri 则现签刷新 */
  useEffect(() => {
    const stale = Object.entries(directorBoardMainByEpisode).filter(
      ([, e]) => e?.gcsUri && !resignedBoardGcsUriRef.current.has(e.gcsUri),
    );
    if (!stale.length) return;
    let cancelled = false;
    void (async () => {
      const resolved: Array<{ ep: number; gcsUri: string; url: string }> = [];
      for (const [k, e] of stale) {
        const ep = Number(k);
        const gcsUri = String(e?.gcsUri || "").trim();
        if (!Number.isFinite(ep) || !gcsUri) continue;
        try {
          const url = await resolveOmniMaterialUrl(gcsUri);
          resolved.push({ ep, gcsUri, url });
        } catch {
          /* 保持旧 url，下次再试 */
        }
      }
      if (cancelled || !resolved.length) return;
      setDirectorBoardMainByEpisode((prev) => {
        const next = { ...prev };
        for (const r of resolved) {
          resignedBoardGcsUriRef.current.add(r.gcsUri);
          next[r.ep] = { gcsUri: r.gcsUri, url: r.url };
        }
        saveManhuaDirectorBoardMainByEpisode(next);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [directorBoardMainByEpisode]);
  /**
   * 上传入口已统一（唯一入口 uploadCustomAssetFiles 强制先选分类），新上传
   * 不会再产生 role="unset"；但老草稿可能存着历史未归类图，不能静默丢弃——
   * 打开草稿时提一句，剩下的分类/删除仍走「待归类」栏位里的按钮。
   */
  const unclassifiedMigrationToastedRef = useRef(false);
  useEffect(() => {
    if (unclassifiedMigrationToastedRef.current) return;
    const n = countManhuaUnclassifiedCustomAssetRefs(customAssetRefs);
    if (n <= 0) return;
    unclassifiedMigrationToastedRef.current = true;
    toast.message(`有 ${n} 张未归类图，请归类或删除`, {
      description: "在「我的资产」的「待归类」栏位里点人物/场景/服装/道具归类，或直接删除。",
    });
  }, [customAssetRefs]);
  const [characterVoiceLocks, setCharacterVoiceLocks] = useState<ManhuaCharacterVoiceLock[]>(() =>
    normalizeManhuaCharacterVoiceLocks(initialWriterSession?.characterVoiceLocks),
  );
  const [audioReferenceLock, setAudioReferenceLock] = useState<ManhuaAudioReferenceLock | null>(
    () => normalizeManhuaAudioReferenceLock(initialWriterSession?.audioReferenceLock),
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
  /** 重出 / 换库图的扣费（按库档 15/20）；生图仍走画布长任务，别用同步接口撞网关 120s */
  const chargeAssetRegenMutation = trpc.manhuaAssetShare.chargeAssetRegen.useMutation();
  /** 道具实物形制联网核对：出图前问一句该器物长什么样（查不到就不写，绝不猜） */
  const lookupPropShapesMutation = trpc.manhuaAssetShare.lookupPropShapes.useMutation();
  /** 重出弹框里「从库里挑一张」的候选；按类拉取 */
  const [libraryPickerRole, setLibraryPickerRole] =
    useState<ManhuaCustomAssetRole | null>(null);
  const libraryPickerQuery = trpc.manhuaAssetShare.listCommunity.useQuery(
    {
      role:
        libraryPickerRole === "scene"
          ? "scene"
          : libraryPickerRole === "character"
            ? "character"
            : "prop",
      limit: 24,
    },
    { enabled: Boolean(libraryPickerRole), staleTime: 30_000 },
  );
  const contributeToLibraryMutation =
    trpc.manhuaAssetShare.contributeToLibrary.useMutation();
  const contributeToLibraryRef = useRef(contributeToLibraryMutation.mutateAsync);
  useEffect(() => {
    contributeToLibraryRef.current = contributeToLibraryMutation.mutateAsync;
  }, [contributeToLibraryMutation.mutateAsync]);
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

    // 古风题材：确认前也清掉残留都市角色卡（防 localStorage/prefs 污染）。
    // 道具同理——propManual 豁免只该保护「本专案手选」，不该保护跨专案的
    // 都市演示道具残留（幽灵三件套），按 demo 目录 lane 精准过滤、不误伤自有资产
    if (castBundle.lane === "ancient") {
      setFactoryFemaleId("");
      setFactoryMaleId("");
      setFemaleLeadManual(false);
      setMaleLeadManual(false);
      setFactoryPropIds((prev) => {
        const kept = stripUrbanDemoPropIds(prev);
        return kept.length === prev.length ? prev : kept;
      });
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
        // manual 豁免不保护跨专案都市演示道具残留（幽灵三件套）
        const propIds = propManual ? stripUrbanDemoPropIds(factoryPropIds) : bundle.propIds;
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
        audioReferenceLock,
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
    audioReferenceLock,
    shareAssetToLibrary,
    viralTemplateId,
    stylePack,
  ]);

  const applyCloudDraftToUi = useCallback((draft: ManhuaCloudDraftPayload) => {
    // 云草稿常把一周前的旧 bible 回灌，盖掉本地已换角的新剧本 → 换角漂移时弃用旧 bible。
    const healed = healManhuaWriterSessionCanonDrift(draft.writerSession);
    const session = healed.session ?? draft.writerSession;
    if (healed.healed) {
      toast.warning("检测到剧本已换角，旧角色设定图不再沿用；请重新「确认并进入资产设定」按现稿重建角色");
    }
    // 引擎从会话带进节点：云端 block 不落 videoModel，不传就一律退成 fast（改价改段长）
    const nextBlocks = cloudDraftBlocksToCanvas(draft.canvas.blocks, {
      videoModel: migrateRetiredManhuaLayoutVideoModel(session.videoModel),
    });
    const nextEdges = draft.canvas.edges as CanvasEdge[];
    setBlocks(nextBlocks);
    setEdges(nextEdges);
    // 云端仍是 https：旁路写入本机库，并尽量立刻用本机 blob 回灌显示
    scheduleCacheCanvasMediaToLocalStore(nextBlocks);
    void (async () => {
      await cacheCanvasMediaToLocalStore(nextBlocks);
      const hydrated = await rehydrateBlocksFromLocalMedia(nextBlocks);
      setBlocks((cur) => {
        // 仅当用户尚未改稿时回灌，避免覆盖新出图
        const sameLen = cur.length === nextBlocks.length;
        const sameIds =
          sameLen && cur.every((b, i) => b.id === nextBlocks[i]?.id);
        return sameIds ? hydrated : cur;
      });
    })();
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
    setAudioReferenceLock(
      normalizeManhuaAudioReferenceLock(session.audioReferenceLock),
    );
    setCharacterLookSets(normalizeManhuaCharacterLookSets(session.characterLookSets));
    setSegmentLookBindings(
      normalizeManhuaSegmentLookBindings(session.segmentLookBindings),
    );
    setStylePack(session.stylePack ?? null);
    setShareAssetToLibrary(Boolean(session.shareAssetToLibrary));
    setViralTemplateId(String(session.viralTemplateId || "").trim());
    {
      // 已下线引擎先迁到等价档（Happy Horse → 2.0-fast），别让它经由「不认得」滑到 2.5
      const v = migrateRetiredManhuaLayoutVideoModel(session.videoModel);
      setWriterVideoModel(
        v
          ? v === "seedance-2.5" && !canUseSeedance25
            ? factoryDefaultVideoModel
            : v
          : factoryDefaultVideoModel,
      );
      // 会话里存过选型才算数；没有就是界面自动预选，不能拿去盖存量段节点
      setWriterVideoModelPicked(Boolean(v));
    }
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
    const restoredScope = String(prefs.assetSelectionScopeKey || "").trim();
    const sessionScope = manhuaAssetSelectionScopeKey(
      session.topic || "",
      session.projectBible?.assetCanon,
    );
    const sameAssetSelectionScope = Boolean(restoredScope && restoredScope === sessionScope);
    if (Array.isArray(prefs.customAssetRefs)) {
      setCustomAssetRefs(normalizeManhuaCustomAssetRefs(prefs.customAssetRefs));
    }
    if (prefs.directorBoardMainByEpisode) {
      setDirectorBoardMainByEpisode(
        normalizeDirectorBoardMainByEpisode(prefs.directorBoardMainByEpisode),
      );
    }
    // 跨专案幽灵防线（用户实测「清都清不掉」的根）：恢复数据里旧都市专案的
    // 库选角/道具/manual 标志，会在每次登录云同步时无条件写回，把种子库 CP
    //（沈清辞/傅临渊）与都市演示道具复活到古风专案。守卫口径：会话 cast 已是
    // ancient 时，都市选角与其 manual 豁免一律不恢复；道具按 demo 目录 lane 过滤。
    const restoredCastLane = session.projectBible?.cast?.lane;
    const restoreUrbanLeads = restoredCastLane !== "ancient";
    if (restoreUrbanLeads) {
      if (typeof prefs.femaleId === "string") setFactoryFemaleId(prefs.femaleId);
      if (typeof prefs.maleId === "string") setFactoryMaleId(prefs.maleId);
    } else {
      // 不能只“跳过恢复”：当前 React state 可能仍是启动时从旧 LS 读出的都市种子。
      setFactoryFemaleId("");
      setFactoryMaleId("");
      setFemaleLeadManual(false);
      setMaleLeadManual(false);
    }
    if (typeof prefs.artStyleId === "string") {
      setFactoryArtStyleId(prefs.artStyleId as ManhuaArtStyleId);
    }
    if (restoreUrbanLeads && prefs.femaleLeadManual != null) {
      setFemaleLeadManual(Boolean(prefs.femaleLeadManual));
    }
    if (restoreUrbanLeads && prefs.maleLeadManual != null) {
      setMaleLeadManual(Boolean(prefs.maleLeadManual));
    }
    if (prefs.artStyleManual != null) setArtStyleManual(Boolean(prefs.artStyleManual));
    const cast = session.projectBible?.cast;
    const restoredPropIds = cast?.propIds?.length
      ? cast.lane === "ancient" && !sameAssetSelectionScope
        ? cast.propIds.filter((id) => !getManhuaDemoAsset(id))
        : cast.lane === "ancient"
          ? stripUrbanDemoPropIds(cast.propIds)
          : cast.propIds
      : [];
    if (cast) {
      if (cast.sceneId) setFactorySceneId(cast.sceneId);
      setFactoryPropIds(restoredPropIds);
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
    // 胜出草稿补写本机时也必须用同一份清洗结果；写回原始 draft 会在下一次
    // 刷新时把刚从 UI 清掉的都市选角/manual/道具再次复活。
    const repairedWriterSession =
      cast && session.projectBible
        ? {
            ...session,
            projectBible: {
              ...session.projectBible,
              cast: { ...cast, propIds: restoredPropIds },
            },
          }
        : session;
    const repairedFactoryPrefs = restoreUrbanLeads
      ? prefs
      : {
          ...prefs,
          femaleId: "",
          maleId: "",
          femaleLeadManual: false,
          maleLeadManual: false,
        };
    repairLocalFromCloudDraft({
      ...draft,
      writerSession: repairedWriterSession,
      factoryPrefs: repairedFactoryPrefs,
    });
  }, [canUseSeedance25, factoryDefaultVideoModel]);


  /** 手动备份（用户拍板：只有用户点上传才存云） */
  const latestDraftSnapshotRef = useRef<Parameters<typeof buildLocalCloudDraftSnapshot>[0] | null>(null);
  const [cloudBackupBusy, setCloudBackupBusy] = useState<null | "upload" | "restore">(null);
  const uploadCloudBackupNow = useCallback(async () => {
    if (cloudBackupBusy) return;
    const snap = latestDraftSnapshotRef.current;
    if (!snap) {
      toast.error("当前没有可备份的工作区内容");
      return;
    }
    setCloudBackupBusy("upload");
    try {
      await syncCloudDraftPayload(buildLocalCloudDraftSnapshot(snap));
      toast.success("已上传备份到云端");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "备份上传失败，请稍后重试");
    } finally {
      setCloudBackupBusy(null);
    }
  }, [cloudBackupBusy, syncCloudDraftPayload]);
  const restoreCloudBackupNow = useCallback(async () => {
    if (cloudBackupBusy) return;
    setCloudBackupBusy("restore");
    try {
      // 回填前强制取最新云备份，别用登录时的旧缓存
      const fresh = await cloudDraftQuery.refetch();
      const draft = fresh.data?.draft;
      if (!draft) {
        toast.error("云端没有备份可回填");
        return;
      }
      const at = String(draft.clientUpdatedAt || "").slice(0, 16) || "未知时间";
      if (
        !window.confirm(
          `将用云端备份（${at}）覆盖当前工作区，本机未上传的改动会丢失。确定回填？`,
        )
      ) {
        return;
      }
      applyCloudDraftToUi(draft);
      toast.success("已从云端备份回填");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "回填失败，请稍后重试");
    } finally {
      setCloudBackupBusy(null);
    }
  }, [cloudBackupBusy, cloudDraftQuery, applyCloudDraftToUi]);

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
      // 备份手动化（用户 2026-08-10 拍板）：云端较新也**绝不自动覆盖本机**——
      // 用户正在生图/出片/精修时被静默回填，一切成果变泡影（实际发生过）。
      // 只提示有备份可回填，恢复动作交给顶栏「回填备份」按钮（带确认）。
      toast.message(
        `云端有较新备份（${String(choice.draft.clientUpdatedAt).slice(0, 16)}）。如需恢复请点顶栏「回填备份」；当前工作区不受影响。`,
      );
      pushDebug("cloudDraft:hydrate-skip-auto", {
        level: "ok",
        detail: `cloud newer · blocks=${choice.draft.canvas.blocks.length} · at=${choice.draft.clientUpdatedAt}`,
      });
    } else if (choice.source === "local") {
      // 备份手动化：本机较新也不再自动上传——上传只走「上传备份」按钮
      // 本机读失败键再尽力写一次
      persistManhuaDraftLocally({
        writerSession: choice.draft.writerSession,
        blocks: cloudDraftBlocksToCanvas(choice.draft.canvas.blocks, {
          videoModel: migrateRetiredManhuaLayoutVideoModel(
            choice.draft.writerSession?.videoModel,
          ),
        }),
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
      directorBoardMainByEpisode,
      assetSelectionScopeKey: manhuaAssetSelectionScopeKey(factoryTopic, projectBible?.assetCanon),
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
      audioReferenceLock,
      characterLookSets,
      segmentLookBindings,
      stylePack,
      shareAssetToLibrary,
      viralTemplateId,
      // 只存真选过的档。存自动预选值会让下次打开时把它当显式选型，
      // 一张历史 2.5 画布重开两次就被静默改成 mini
      videoModel: explicitWriterVideoModel,
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
    // 手动上传按钮从这个 ref 取当前工作区快照
    latestDraftSnapshotRef.current = { writerSession, blocks, edges, factoryPrefs, clientUpdatedAt };

    // 备份手动化（用户 2026-08-10 拍板）：防抖自动上传拆除——云备份只在用户
    // 点「上传备份」时发生。本机 persistManhuaDraftLocally 双写保留（防刷新丢失，
    // 那是本地工作区不是云备份）。
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
    audioReferenceLock,
    characterLookSets,
    segmentLookBindings,
    stylePack,
    shareAssetToLibrary,
    directorBoardMainByEpisode,
    viralTemplateId,
    explicitWriterVideoModel,
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
      `lighting: ${selectedNarrativeLightingIds.join(",") || "—"}`,
      `maleHair/micro: ${selectedMaleHairstyleIds.join(",") || "—"} / ${selectedMaleMicroIds.join(",") || "—"}`,
      `cineVocab: ${selectedCineVocabIds.join(",") || "—"}`,
      `wardrobe: ${selectedWardrobeIds.join(",") || "—"}`,
      `promo: ${selectedPromoLayoutIds.join(",") || "—"}`,
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
    selectedNarrativeLightingIds,
    selectedMaleHairstyleIds,
    selectedMaleMicroIds,
    selectedCineVocabIds,
    selectedWardrobeIds,
    selectedPromoLayoutIds,    factoryReverseMode,
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
          craftShotIds: selectedCraftShotIds,          pathCameraRecipeIds: selectedPathRecipeIds,
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
    factoryCraftShotId,    factoryPathRecipeId,
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
    selectedCraftShotIds,    selectedPathRecipeIds,
    selectedNarrativeLightingIds,
    selectedMaleHairstyleIds,
    selectedMaleMicroIds,
    selectedPromoLayoutIds,
    selectedActionRecipeIds,
    selectedCineVocabIds,
    selectedWardrobeIds,
    selectedCharacterIds,
  ]);
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

  /**
   * canon↔现剧本人物表 漂移：已锁 bible 是旧剧本角色，但剧本已换角。
   * 此时「按剧本重出」仍会用旧 canon 出旧角色——给出明确警示与正确路径。
   */
  const canonWriterDriftHintZh = useMemo(() => {
    const drift = detectManhuaCanonWriterDrift(
      projectBible?.assetCanon,
      writerPack?.charactersMd,
    );
    if (!drift.drifted) return "";
    const oldNames = drift.onlyInBible.slice(0, 4).join("、") || drift.bibleCast.slice(0, 4).join("、");
    const newNames = drift.writerCast.slice(0, 4).join("、");
    return `已锁定的角色设定图还停在旧剧本（${oldNames}），但现在的剧本主角是（${newNames}）。此时点「按剧本重出设定图」仍会出旧角色。请先把每集可拍表补齐「意图」等字段、让剧本过门禁，再点上方「确认并进入资产设定」按新剧本重建角色，才会出对人。`;
  }, [projectBible?.assetCanon, writerPack?.charactersMd]);

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
  const manhuaViralTemplatesQuery = trpc.manhuaViralTemplate.listApproved.useQuery(undefined, {
    staleTime: 60_000,
    retry: 1,
  });
  const approvedViralTemplateCards = useMemo(
    () => (manhuaViralTemplatesQuery.data?.groups || []).flatMap((group) => group.items),
    [manhuaViralTemplatesQuery.data?.groups],
  );
  const selectedViralTemplate = useMemo(
    () => approvedViralTemplateCards.find((card) => card.id === viralTemplateId) || null,
    [approvedViralTemplateCards, viralTemplateId],
  );
  const recommendedViralTemplate = useMemo(
    () =>
      recommendApprovedManhuaViralTemplate(
        approvedViralTemplateCards,
        `${factoryTopic}\n${writerBrief}`,
      ),
    [approvedViralTemplateCards, factoryTopic, writerBrief],
  );
  useEffect(() => {
    if (!manhuaViralTemplatesQuery.isSuccess || !viralTemplateId) return;
    if (!approvedViralTemplateCards.some((card) => card.id === viralTemplateId)) {
      setViralTemplateId("");
    }
  }, [approvedViralTemplateCards, manhuaViralTemplatesQuery.isSuccess, viralTemplateId]);
  const getSignedUrlMutation = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const splitPropSheetMutation = trpc.mvAnalysis.splitManhuaPropSheet.useMutation();
  const cropDirectorBoardMutation = trpc.mvAnalysis.cropManhuaDirectorBoardMain.useMutation();
  const buildDirectorBoardPromptMutation =
    trpc.mvAnalysis.buildManhuaDirectorBoardPrompt.useMutation();
  const [assetZipBusy, setAssetZipBusy] = useState(false);
  const [assetStandardizeBusyId, setAssetStandardizeBusyId] = useState<string | null>(null);

  const pathTrackLabelZh = useMemo(() => {
    const path = getPathCameraRecipeById(selectedPathRecipeIds[0]);
    const action = getActionCameraRecipeById(selectedActionRecipeIds[0]);
    const picks = [path ? `路径·${path.nameZh}` : "", action ? `动作·${action.nameZh}` : ""].filter(
      Boolean,
    );
    return picks.length ? picks.join(" + ") : "未选运镜配方 · 按剧本时间轴推进";
  }, [selectedPathRecipeIds, selectedActionRecipeIds]);
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
        // 沉浸态下坞是 display:none，先切开 extras 再滚
        setImmersiveExtrasOpen(true);
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

  /** 仅出片后台：id→垫图 path 与四视角切片，绝不写入节点提示词 */
  const manhuaAssetMaps = useMemo(() => {
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
      propImageUrlById: collectManhuaPropImageUrlById(customAssetRefs, projectBible?.assetCanon),
    });
    return {
      registry: reg,
      pathById: buildManhuaAssetPathById(reg),
      tileUrlsById: buildManhuaAssetTileUrlsById(reg),
    };
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

  /**
   * 画布成片节点的 @ 面板数据源：与工作台同一资产真源（manhuaAssetMaps 的 registry），
   * 缩略图取槽位图 URL；点了没出图的候选 → 走工作台同一条补图链路。
   */
  const manhuaCanvasMention = useMemo(() => {
    const registry = manhuaAssetMaps.registry;
    /**
     * 缩略图用全量 id→path（pathById 不过滤协议）：槽位图大量是同源相对路径
     * （/api/…、/growth/…），只收 https 会把它们全滤掉、面板一排灰。
     * logical:// 这类不可渲染的协议才排除。
     */
    const thumbUrlByAssetId: Record<string, string> = {};
    for (const [id, p] of Object.entries(manhuaAssetMaps.pathById)) {
      const path = String(p || "").trim();
      if (id && path && !path.startsWith("logical://")) thumbUrlByAssetId[id] = path;
    }
    for (const r of customAssetRefs) {
      const id = String(r?.id || "").trim();
      const url = String(r?.url || "").trim();
      if (id && url) thumbUrlByAssetId[id] = url;
    }
    return {
      registry,
      assetCanon: projectBible?.assetCanon ?? null,
      thumbUrlByAssetId,
      onRequestGenerateAsset: (c: ManhuaMentionCandidate) => {
        toast.info(`「${c.labelZh}」还没有定妆图`, {
          description: "正在按剧本补这一张，出图后回来敲 @ 就能挂上",
        });
        void confirmAssetsAndPrepareImages?.();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manhuaAssetMaps, customAssetRefs, projectBible?.assetCanon]);

  const runDeps = useMemo<CanvasRunDeps>(
    () => ({
      userId: user?.id ? String(user.id) : "",
      userPlan,
      userRole,
      characterVoiceLocks,
      audioReferenceLock,
      manhuaAssetPathById: manhuaAssetMaps.pathById,
      manhuaAssetTileUrlsById: manhuaAssetMaps.tileUrlsById,
      manhuaDirectorBoardUrlByEpisode: directorBoardUrlByEpisode,
      manhuaWriterVideoModel: explicitWriterVideoModel || undefined,
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
      userPlan,
      userRole,
      characterVoiceLocks,
      audioReferenceLock,
      manhuaAssetMaps,
      directorBoardUrlByEpisode,
      explicitWriterVideoModel,
    ],
  );

  const setDirectorBoardMainForEpisode = useCallback(
    (episodeIndex: number, entry: { gcsUri: string; url?: string } | null) => {
      const ep = Math.max(1, Math.floor(episodeIndex) || 1);
      setDirectorBoardMainByEpisode((prev) => {
        const next = { ...prev };
        if (!entry || (!entry.gcsUri && !entry.url)) delete next[ep];
        else {
          next[ep] = {
            gcsUri: String(entry.gcsUri || "").trim(),
            ...(entry.url ? { url: String(entry.url).trim() } : {}),
          };
          if (next[ep]!.gcsUri) resignedBoardGcsUriRef.current.delete(next[ep]!.gcsUri);
        }
        saveManhuaDirectorBoardMainByEpisode(next);
        return next;
      });
    },
    [],
  );

  const ingestDirectorBoardFile = useCallback(
    async (episodeIndex: number, file: File) => {
      const ep = Math.max(1, Math.floor(episodeIndex) || 1);
      const { uploadOneCanvasAsset } = await import("@/lib/canvasUpload");
      const asset = await uploadOneCanvasAsset({
        file,
        index: Date.now() % 1000,
        getSignedUploadUrl: (input) => getSignedUrlMutation.mutateAsync(input),
      });
      const boardUrl = String(asset.url || "").trim();
      if (!/^https?:\/\//i.test(boardUrl)) throw new Error("导演板上传失败");
      const cropped = await cropDirectorBoardMutation.mutateAsync({ boardUrl });
      const mainUrl = String(cropped?.url || "").trim();
      const gcsUri = String(cropped?.gcsUri || "").trim();
      if (!/^https?:\/\//i.test(mainUrl)) throw new Error("导演板裁切未返回主画面地址");
      if (!/^gs:\/\//i.test(gcsUri)) throw new Error("导演板裁切未返回长期存储地址");
      setDirectorBoardMainForEpisode(ep, { gcsUri, url: mainUrl });
      toast.success(`第${ep}集导演板已裁切并接入成片垫图`);
      return mainUrl;
    },
    [cropDirectorBoardMutation, getSignedUrlMutation, setDirectorBoardMainForEpisode],
  );

  /** 方案 B：拼导演板出图提示词并复制，用户自行出图后再「上传导演板」裁切入库 */
  const copyDirectorBoardPrompt = useCallback(async () => {
    const ep = writerFocusEpisode;
    const epMeta = writerPack?.episodes.find((e) => e.index === ep);
    const epBody = epMeta?.body || "";
    const segmentPlan = parseManhuaEpisodeSegmentPlanFromMarkdown(epBody);
    if (!segmentPlan.segments.length) {
      toast.error("本集可拍表为空，无法拼导演板提示词");
      return;
    }
    const res = await buildDirectorBoardPromptMutation.mutateAsync({
      episodeNumber: ep,
      episodeTitleZh: String(epMeta?.title || "").trim(),
      segments: segmentPlan.segments.map((s) => ({
        index: s.index,
        intentZh: s.intentZh,
        dialogueZh: s.dialogueZh,
        performanceZh: s.performanceZh,
        sceneZh: s.sceneZh,
        paletteZh: s.paletteZh,
        castZh: s.castZh,
        wardrobePropZh: s.wardrobePropZh,
        lightingCameraZh: s.lightingCameraZh,
      })),
    });
    const textPrompt = String(res?.promptZh || "").trim();
    if (!textPrompt) throw new Error("导演板提示词为空");
    await navigator.clipboard.writeText(textPrompt);
    toast.success("已复制导演板提示词", {
      description: "请先出齐定妆/场景/道具，再出导演板整版图，最后点「上传导演板」裁切接入。",
    });
  }, [writerFocusEpisode, writerPack, buildDirectorBoardPromptMutation]);

  /** 见下方赋值处：ZIP 导入要先写剧本，但剧本导入函数定义在后面，用 ref 转一手 */
  const importWriterFromTextRef = useRef<((raw: string) => Promise<void>) | null>(null);

  const importAssetZipFile = useCallback(
    async (file: File) => {
      setAssetZipBusy(true);
      try {
        const { uploadOneCanvasAsset } = await import("@/lib/canvasUpload");
        const { importManhuaAssetZipFile } = await import("@/lib/manhuaAssetZipImport");
        const result = await importManhuaAssetZipFile({
          file,
          getSignedUploadUrl: (input) => getSignedUrlMutation.mutateAsync(input),
          uploadOne: async (f, index) => {
            const asset = await uploadOneCanvasAsset({
              file: f,
              index,
              getSignedUploadUrl: (input) => getSignedUrlMutation.mutateAsync(input),
            });
            return { url: asset.url, gcsUri: asset.gcsUri };
          },
        });
        /**
         * 剧本必须**先于**资产写入。
         *
         * `importWriterRoomFromText` 里 `setCustomAssetRefs([])` /
         * `setDirectorBoardMainByEpisode({})` 是无条件执行的（换剧要清旧资产），
         * 所以「先挂资产再导剧本」会把刚导进来的资产整批清掉——2026-08-09 用户实际踩到，
         * 被迫把 50MB 的包重传一次。顺序在这里锁死，用户就不必知道有这个坑。
         */
        let scriptImported = 0;
        const bestScript = result.scripts[0];
        if (bestScript) {
          const ok =
            !writerPack ||
            window.confirm(
              `资产包里带着剧本（${bestScript.path.split("/").pop()}，正文约 ${bestScript.charCount} 字、对白 ${bestScript.dialogueCount} 句）。\n\n` +
                "导入它会替换当前剧本。取消则只挂资产、不动剧本。是否导入？",
            );
          if (ok) {
            await importWriterFromTextRef.current?.(bestScript.text);
            scriptImported = 1;
          }
        }
        if (result.addedRefs.length) {
          setCustomAssetRefs((prev) =>
            normalizeManhuaCustomAssetRefs([...prev, ...result.addedRefs]),
          );
        }
        // 报成功入库数，不报尝试数：裁切失败还说「导演板 6 集」等于骗自己
        const failedBoardEpisodes: number[] = [];
        let boardsIngested = 0;
        for (const board of result.directorBoards) {
          try {
            const cropped = await cropDirectorBoardMutation.mutateAsync({
              boardUrl: board.boardUrl,
            });
            const mainUrl = String(cropped?.url || "").trim();
            const gcsUri = String(cropped?.gcsUri || "").trim();
            if (/^https?:\/\//i.test(mainUrl) && /^gs:\/\//i.test(gcsUri)) {
              setDirectorBoardMainForEpisode(board.episodeIndex, { gcsUri, url: mainUrl });
              boardsIngested += 1;
            } else {
              failedBoardEpisodes.push(board.episodeIndex);
            }
          } catch (e) {
            console.warn("[zip] director board crop failed", e);
            failedBoardEpisodes.push(board.episodeIndex);
          }
        }
        const boardDescZh = result.directorBoards.length
          ? `导演板 ${boardsIngested}/${result.directorBoards.length} 集`
          : "导演板 0 集";
        const scriptDescZh = result.scripts.length
          ? scriptImported
            ? ` · 剧本已导入（${result.scripts.length} 份中取对白最全的一份）`
            : ` · 识别到 ${result.scripts.length} 份剧本（未导入）`
          : "";
        toast.success("资产包已导入", {
          description: `参考图 ${result.addedRefs.length} 张（待确认 ${result.quarantinedCount}） · ${boardDescZh} · 跳过 ${result.skippedCount} · 去重 ${result.droppedDupes}${scriptDescZh}`,
        });
        if (failedBoardEpisodes.length) {
          toast.error("部分导演板未接入", {
            description: `第 ${failedBoardEpisodes.sort((a, b) => a - b).join("、")} 集裁切失败，这些集成片将缺导演板垫图；可在工作台单独上传。`,
          });
        }
      } finally {
        setAssetZipBusy(false);
      }
    },
    // writerPack 只用来判断「要不要问用户确认替换」；剧本导入函数走 ref，不进依赖
    [cropDirectorBoardMutation, getSignedUrlMutation, setDirectorBoardMainForEpisode, writerPack],
  );

  /**
   * 画布节点重跑：设定图走编剧表重编译；成片走 ensureManhuaFragmentClips 重铺 prompt。
   * 旧产物进 outputUrls 暂存，避免「按钮转了但吃旧稿」。
   */
  const compileManhuaRerun = useCallback(
    async (block: CanvasBlock) => {
      if (!shouldRecompileManhuaBlockOnRerun(block.id)) return null;
      const ep = getBlockEpisodeIndex(block) ?? writerFocusEpisode;
      if (isManhuaAssetSheetBlockId(block.id)) {
        const compiled = compileManhuaAssetSheetPromptForRerun(block, {
          assetCanon: projectBible?.assetCanon,
          episodeIndex: ep,
          topic: factoryTopic,
          artStyleId: projectBible?.cast?.artStyleId || factoryArtStyleId,
          customRefs: customAssetRefs,
          characterIds: projectBible?.cast?.characterIds,
          ancientArchetypeIds: projectBible?.cast?.ancientArchetypeIds,
          sceneId: factorySceneId || projectBible?.cast?.sceneId,
          assetBlocks: blocks
            .filter(
              (b) =>
                b.id.startsWith("charsheet-") ||
                b.id.startsWith("sceneplate-") ||
                b.id.startsWith("propsheet-") ||
                b.id.startsWith("propplate-"),
            )
            .map((b) => ({
              id: b.id,
              outputUrl: b.outputUrl,
              outputUrls: b.outputUrls,
            })),
        });
        if (!compiled) {
          throw new Error("无法按当前编剧表重编译本设定图，请走工作台「重出」");
        }
        return {
          ...applyManhuaRerunCompilePatch(compiled),
          changed: compiled.changed,
          beforePrompt: compiled.beforePrompt,
          afterPrompt: compiled.afterPrompt,
        };
      }
      if (isManhuaClipBlockId(block.id)) {
        const sheetUrls = collectManhuaCharacterSheetUrlById(blocks, projectBible?.assetCanon);
        const epBody =
          writerPack?.episodes.find((e) => e.index === ep)?.body || "";
        const segmentPlan = parseManhuaEpisodeSegmentPlanFromMarkdown(epBody);
        const ensured = ensureManhuaFragmentClips(blocks, edges, ep, {
          assetCanon: projectBible?.assetCanon,
          characterSheetUrlById: sheetUrls,
          propImageUrlById: collectManhuaPropImageUrlById(
            customAssetRefs,
            projectBible?.assetCanon,
          ),
          customRefs: customAssetRefs,
          segmentPlan: segmentPlan.segments.length ? segmentPlan : null,
          characterLookSets,
          segmentLookBindings,
          directorBoardUrlByEpisode,
          videoModel: explicitWriterVideoModel || undefined,
        });
        const fresh = ensured.blocks.find((b) => b.id === block.id);
        if (!fresh?.prompt?.trim()) {
          throw new Error("无法重算本段成片提示词，请先「审阅成片提示词」铺段");
        }
        const beforePrompt = String(block.prompt || "");
        const afterPrompt = fresh.prompt.trim();
        const compiled = {
          prompt: afterPrompt,
          beforePrompt,
          afterPrompt,
          stashOutputUrls: Array.from(
            new Set(
              [block.outputUrl, ...(block.outputUrls || [])].filter(Boolean) as string[],
            ),
          ).slice(0, 8),
          changed: beforePrompt.trim() !== afterPrompt,
        };
        return {
          ...applyManhuaRerunCompilePatch(compiled),
          changed: compiled.changed,
          beforePrompt,
          afterPrompt,
        };
      }
      return null;
    },
    [
      blocks,
      edges,
      writerFocusEpisode,
      projectBible,
      factoryTopic,
      factoryArtStyleId,
      factorySceneId,
      customAssetRefs,
      writerPack,
      characterLookSets,
      segmentLookBindings,
      directorBoardUrlByEpisode,
      explicitWriterVideoModel,
    ],
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

  // 进页一次：清掉历史成片节点里误写的网址（裸奔）+ 本机媒体库回灌
  useEffect(() => {
    let cancelled = false;
    setBlocks((cur) => {
      const cleaned = sanitizeManhuaClipBlocksPrompts(cur);
      if (cleaned === cur) return cur;
      setEdges((edges) => {
        saveCanvasState(cleaned, edges);
        return edges;
      });
      return cleaned;
    });
    void (async () => {
      const boot = blocksRef.current;
      scheduleCacheCanvasMediaToLocalStore(boot);
      await cacheCanvasMediaToLocalStore(boot);
      if (cancelled) return;
      const hydrated = await rehydrateBlocksFromLocalMedia(blocksRef.current);
      if (cancelled) return;
      setBlocks((cur) => {
        // 指针/过期 https → blob:；若无变化则保持引用
        let changed = cur.length !== hydrated.length;
        if (!changed) {
          for (let i = 0; i < cur.length; i++) {
            if (
              cur[i]?.outputUrl !== hydrated[i]?.outputUrl ||
              cur[i]?.refImageUrl !== hydrated[i]?.refImageUrl
            ) {
              changed = true;
              break;
            }
          }
        }
        if (!changed) return cur;
        setEdges((edges) => {
          saveCanvasState(hydrated, edges);
          return edges;
        });
        return hydrated;
      });
    })();
    return () => {
      cancelled = true;
    };
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

  /** 成片新出完 → 强制自动下载到本机（云端不成片仓） */
  const clipAutoDlPrevRef = useRef<CanvasBlock[] | null>(null);
  const clipAutoDlQueueRef = useRef(Promise.resolve());
  useEffect(() => {
    const prev = clipAutoDlPrevRef.current;
    clipAutoDlPrevRef.current = blocks;
    if (prev == null) return; // 首帧只建基线，避免打开旧稿连下历史片
    const seriesTitle =
      String(writerPack?.seriesTitle || "").trim() ||
      String(factoryTopic || "").trim() ||
      "漫剧";
    const pending = collectPendingClipAutoDownloads({
      prev,
      next: blocks,
      seriesTitle,
    });
    if (!pending.length) return;
    clipAutoDlQueueRef.current = clipAutoDlQueueRef.current
      .then(async () => {
        const r = await runPendingClipAutoDownloads(pending);
        if (r.attempted <= 0) return;
        if (r.ok > 0 || r.fallback > 0) {
          toast.success(
            r.attempted === 1
              ? "成片已自动下载到本机"
              : `已自动下载 ${r.ok + r.fallback} 段成片到本机`,
            { description: MANHUA_CLIP_AUTO_DOWNLOAD_HINT_ZH },
          );
        }
        if (r.failed > 0 && r.ok + r.fallback === 0) {
          toast.error("成片自动下载失败", {
            description: "请点预览旁「下载」手动保存到本机，勿只靠页面预览。",
          });
        } else if (r.failed > 0) {
          toast.message("部分成片需手动下载", {
            description: "请点预览旁「下载」补存失败的段。",
          });
        }
      })
      .catch(() => undefined);
  }, [blocks, writerPack?.seriesTitle, factoryTopic]);

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
        artStyleId: factoryArtStyleId,        craftShotIds: selectedCraftShotIds,
        pathCameraRecipeIds: selectedPathRecipeIds,
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
        // 补铺新一集时不能用自动预选值：第 1 集已在跑 2.5 的项目会被拽回 mini，
        // 段表 4→6、扣费口径跟着变。用户没真选过就跟画布上已有的档走。
        videoModel: resolveManhuaCanvasClipVideoModel(
          blocks,
          explicitWriterVideoModel || undefined,
        ) as CanvasBlock["videoModel"],
      });
      spawned = {
        ...spawned,
        blocks: layoutManhuaEpisodeReadableChain(spawned.blocks, writerFocusEpisode, {
          assetCanon: projectBible?.assetCanon,
          characterSheetUrlById: collectManhuaCharacterSheetUrlById(
            spawned.blocks,
            projectBible?.assetCanon,
          ),
          propImageUrlById: collectManhuaPropImageUrlById(customAssetRefs, projectBible?.assetCanon),
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
      selectedCharacterIds,      selectedCraftShotIds,
      selectedPathRecipeIds,
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
      explicitWriterVideoModel,
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
    if (!hasManhuaSeedanceLayoutChoice(writerVideoModel)) {
      toast.error(`请先选择成片引擎（${writerLayoutChoiceLabelsZh}）`);
      return;
    }
    /** 立刻收窄为成片三选一，避免 async/state 下空串回流导致 tsc 失败 */
    const selectedVideoModel: ManhuaSeedanceLayoutVideoModel = writerVideoModel;
    /** 全量换剧：先备份旧专案（剧本+付费设定图），再清空，避免新旧串味 */
    const fullSeriesSwitch = !(writerFromEpisode > 0);
    let clearSeriesAssetsAfterBackup = false;
    if (fullSeriesSwitch) {
      const risk = inspectManhuaSeriesSwitchRisk({
        writerPack,
        blocks,
        customAssetRefs,
      });
      const allowed = await confirmManhuaSeriesSwitchWithBackup({
        risk,
        download: () =>
          downloadManhuaSeriesSwitchBackup({
            writerPack,
            topic,
            // 备份只用先前剧名；题材框若已改成新剧，不得盖掉备份名
            previousSeriesTitle: writerPack?.seriesTitle || undefined,
            incomingSeriesTitle: topic && topic !== writerPack?.seriesTitle ? topic : undefined,
            blocks,
            customAssetRefs,
            characterIds: selectedCharacterIds,
            artStyleId: factoryArtStyleId,
            sceneId: factorySceneId || undefined,
          }),
        onBackupOk: (r) => {
          toast.success(`先前专案备份已下载：${r.filename}`);
        },
        onBackupFail: (msg) => {
          toast.error(`备份失败，已中止换剧：${msg}`);
        },
      });
      if (!allowed) return;
      clearSeriesAssetsAfterBackup = risk.needsBackup;
    } else if (writerPack) {
      const ok = window.confirm(
        "局部改写将覆盖起点之后的剧情；起点之前的剧本与已出片资产会保留。是否继续？",
      );
      if (!ok) return;
    }
    setWriterBusy(true);
    setWriterConfirmed(false);
    setDirectorUnlocked(false);
    setProjectBible(null);
    setCustomAssetRefs([]);
    setDirectorBoardMainByEpisode({});
    saveManhuaDirectorBoardMainByEpisode({});
    setWriterConfirmBlockers([]);
    const t0 = Date.now();
    const count = clampWriterEpisodeCount(writerEpisodeCount);
    const designInject = [
      buildMaleHairstyleInjectBlock(selectedMaleHairstyleIds),
      buildMaleMicroExpressionInjectBlock(selectedMaleMicroIds),
    ]
      .filter(Boolean)
      .join("\n\n");
    const mergedBrief = [brief, designInject].filter(Boolean).join("\n\n");
    const reqPreview = `topic=${topic}\nepisodes=${count}\nbrief:\n${mergedBrief.slice(0, 4000)}\nviralTemplate=${viralTemplateId || "off"}\nvideoModel=${selectedVideoModel}`;
    pushDebug("expandWriterPack:start", {
      detail: `topicLen=${topic.length} briefLen=${brief.length} episodes=${count} overwriteOld=1 viralTemplate=${viralTemplateId || "off"} videoModel=${selectedVideoModel}`,
      request: reqPreview,
    });
    /** 服务端 300s；客户端略宽一点，超时必须解锁，避免旧稿挂着却一直「正在扩写」 */
    const EXPAND_CLIENT_TIMEOUT_MS = 320_000;
    const expandSignature = JSON.stringify({
      topic,
      mergedBrief,
      count,
      writerExpandTier,
      viralTemplateId,
      writerLengthTierId,
      selectedVideoModel,
      writerFromEpisode,
      writerFromSegment,
    });
    const expandRequestId =
      writerExpandRetryRef.current?.signature === expandSignature
        ? writerExpandRetryRef.current.requestId
        : crypto.randomUUID();
    writerExpandRetryRef.current = { signature: expandSignature, requestId: expandRequestId };
    try {
      const res = await Promise.race([
        expandWriterMutation.mutateAsync({
          topic,
          brief: mergedBrief || undefined,
          episodeCount: count,
          tier: writerExpandTier,
          requestId: expandRequestId,
          viralTemplateId: viralTemplateId || undefined,
          lengthTierId: writerLengthTierId,
          videoModel: selectedVideoModel,
          fromEpisode: writerFromEpisode || undefined,
          fromSegment: writerFromEpisode > 0 ? writerFromSegment : undefined,
          lockedEpisodeBody:
            writerFromEpisode > 0 && writerFromSegment > 1
              ? writerPack?.episodes.find((e) => e.index === writerFromEpisode)?.body ||
                undefined
              : undefined,
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            reject(new Error("剧情扩写超时，请稍后重试（旧稿未改动）"));
          }, EXPAND_CLIENT_TIMEOUT_MS);
        }),
      ]);
      writerExpandRetryRef.current = null;
      // 局部改写：保留集沿用旧正文，资产表按名取并集，新角色照样进表
      const pack = spliceManhuaWriterPackFromEpisode(
        writerPack,
        res.pack,
        writerFromEpisode,
      );
      if (isPlaceholderSeriesTitle(pack.seriesTitle)) {
        const fallback = deriveSeriesTitleFromTopic(topic);
        if (fallback) pack.seriesTitle = fallback;
      }
      if (!res.ready && !writerPackLooksReady(pack)) {
        toast.message("已生成草稿，建议检查每集片尾钩子是否完整");
      }
      // 新剧情包不应继续展示旧静帧/成片/多集坞（云草稿残留）
      let cleaned = stripManhuaFactoryCanvasArtifacts(blocks, edges, {
        fromEpisode: writerFromEpisode || undefined,
        fromSegment: writerFromEpisode > 0 ? writerFromSegment : undefined,
      });
      if (clearSeriesAssetsAfterBackup) {
        const seriesCleared = stripManhuaSeriesAssetsForNewProject(
          cleaned.blocks,
          cleaned.edges,
        );
        cleaned = {
          ...cleaned,
          blocks: seriesCleared.blocks,
          edges: seriesCleared.edges,
          removedCount: cleaned.removedCount + seriesCleared.removedCount,
        };
      }
      const cleanedTouched =
        cleaned.removedCount > 0 ||
        cleaned.archivedCount > 0 ||
        clearSeriesAssetsAfterBackup;
      const nextBlocks = cleanedTouched ? cleaned.blocks : blocks;
      const nextEdges = cleanedTouched ? cleaned.edges : edges;
      if (cleanedTouched) {
        if (abortRef.current) abortRef.current.abort();
        setBlocks(nextBlocks);
        setEdges(nextEdges);
        saveCanvasState(nextBlocks, nextEdges);
        setDockSelectedIds(new Set());
        setWorkflowPhase("outline");
      }
      setWriterPack(pack);
      setWriterFocusEpisode(writerFromEpisode || 1);
      setWriterConfirmBlockers([]);
      // 新剧本立刻落盘并覆盖本机+云端旧稿，避免刷新后又被旧云草稿盖回
      const clientUpdatedAt = new Date().toISOString();
      setCharacterVoiceLocks([]);
      setAudioReferenceLock(null);
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
        audioReferenceLock: null as ManhuaAudioReferenceLock | null,
        shareAssetToLibrary,
        viralTemplateId,
        videoModel: selectedVideoModel,
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
        directorBoardMainByEpisode: {} as ManhuaDirectorBoardMainByEpisode,
      };
      persistManhuaDraftLocally({
        writerSession,
        blocks: nextBlocks,
        edges: nextEdges,
        factoryPrefs,
        clientUpdatedAt,
      });
      // 备份手动化：扩写完成也不自动上云——用户点「上传备份」才存
      const epDigest = pack.episodes
        .map((ep) => `第${ep.index}集·${ep.title || ""}：${String(ep.endHook || "").slice(0, 80)}`)
        .join("\n");
      pushDebug("expandWriterPack:ok", {
        level: "ok",
        ms: Date.now() - t0,
        detail: `${pack.seriesTitle || "—"} · ${pack.episodes.length}ep · ready=${Boolean(res.ready)} · clearedFactory=${cleaned.removedCount} · archivedPaid=${cleaned.archivedCount} · overwritten=1 · viralTemplate=${viralTemplateId || "off"} · videoModel=${selectedVideoModel}`,
        request: reqPreview,
        response: `${pack.seriesTitle || ""}\n${pack.logline || ""}\n${epDigest}`.slice(0, 8000),
      });
      const layoutHint =
        res.layout?.labelZh && res.layout?.segmentCount
          ? `（${res.layout.labelZh} · ${res.layout.segmentCount}×${res.layout.durationSecPerSegment}s）`
          : "";
      const costHint = `本次扣 ${res.creditsCost} 积分`;
      const templateHint = res.appliedTemplate?.nameZh
        ? ` · 已应用剧情增强「${res.appliedTemplate.nameZh}」`
        : "";
      toast.success(
        cleaned.removedCount > 0 || cleaned.archivedCount > 0
          ? `已扩写 ${pack.episodes.length} 集${layoutHint}：新剧本已覆盖旧稿；旧工厂链已清${
              cleaned.archivedCount > 0
                ? `，${cleaned.archivedCount} 个已出图/已出片节点转为存档保留（不进新剧本垫图）`
                : ""
            } · ${costHint}${templateHint}`
          : `已扩写 ${pack.episodes.length} 集${layoutHint}：新剧本已覆盖本机与云端旧稿 · ${costHint}${templateHint}`,
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
    writerLengthTierId,
    writerVideoModel,
    writerFromEpisode,
    writerFromSegment,
    viralTemplateId,
    writerExpandTier,
    customAssetRefs,
    selectedCharacterIds,
    factorySceneId,
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

  const importWriterRoomFromText = useCallback(
    async (raw: string) => {
      const text = String(raw || "").trim();
      if (!text) {
        toast.error("请先粘贴剧本，或选择 .txt / .md 文件");
        return;
      }
      const risk = inspectManhuaSeriesSwitchRisk({
        writerPack,
        blocks,
        customAssetRefs,
      });
      const incomingSeriesTitle =
        (text.match(/##\s*系列标题\s*\n+\s*([^\n#]+)/)?.[1] || "").trim() ||
        (text.match(/系列[：:]\s*([^\n]+)/)?.[1] || "").trim() ||
        undefined;
      const allowed = await confirmManhuaSeriesSwitchWithBackup({
        risk,
        download: () =>
          downloadManhuaSeriesSwitchBackup({
            writerPack,
            topic: factoryTopic.trim() || undefined,
            previousSeriesTitle: writerPack?.seriesTitle || undefined,
            incomingSeriesTitle,
            blocks,
            customAssetRefs,
            characterIds: selectedCharacterIds,
            artStyleId: factoryArtStyleId,
            sceneId: factorySceneId || undefined,
          }),
        onBackupOk: (r) => {
          toast.success(`先前专案备份已下载：${r.filename}`);
        },
        onBackupFail: (msg) => {
          toast.error(`备份失败，已中止导入：${msg}`);
        },
      });
      if (!allowed) return;

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
      let cleaned = stripManhuaFactoryCanvasArtifacts(blocks, edges);
      if (risk.needsBackup) {
        const seriesCleared = stripManhuaSeriesAssetsForNewProject(
          cleaned.blocks,
          cleaned.edges,
        );
        cleaned = {
          ...cleaned,
          blocks: seriesCleared.blocks,
          edges: seriesCleared.edges,
          removedCount: cleaned.removedCount + seriesCleared.removedCount,
        };
      }
      if (
        cleaned.removedCount > 0 ||
        cleaned.archivedCount > 0 ||
        risk.needsBackup
      ) {
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
      setCustomAssetRefs([]);
      // 导入新剧本：清掉库选角残留——「当前出演人物」以剧本人物表为准，
      // 旧系列/默认原型不得继续占位（2026-08-10 用户点名 bug）
      setFactoryFemaleId("");
      setFactoryMaleId("");
      setFemaleLeadManual(false);
      setMaleLeadManual(false);
      setDirectorBoardMainByEpisode({});
      saveManhuaDirectorBoardMainByEpisode({});
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
        risk.needsBackup
          ? `已导入 ${res.pack.episodes.length} 集《${res.pack.seriesTitle}》；旧专案已备份并清空设定，避免串味`
          : `已导入 ${res.pack.episodes.length} 集《${res.pack.seriesTitle}》，确认后再进入编导`,
      );
    },
    [
      factoryTopic,
      writerEpisodeCount,
      writerPack,
      blocks,
      edges,
      customAssetRefs,
      selectedCharacterIds,
      factoryArtStyleId,
      factorySceneId,
      pushDebug,
    ],
  );

  /**
   * 供 ZIP 导入回调调用。
   *
   * ZIP 导入（importAssetZipFile）定义在本函数之前，不能把它写进依赖数组——
   * 依赖数组在渲染时立即求值，那时这个 const 还在 TDZ 里会直接抛错。用 ref 转一手。
   */
  importWriterFromTextRef.current = importWriterRoomFromText;

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
        await importWriterRoomFromText(text);
      } catch {
        toast.error("读取文件失败，请改用粘贴导入");
      }
    },
    [importWriterRoomFromText],
  );

  const backupCurrentSeriesProject = useCallback(async () => {
    const risk = inspectManhuaSeriesSwitchRisk({
      writerPack,
      blocks,
      customAssetRefs,
    });
    if (!risk.needsBackup) {
      toast.message("当前没有可备份的剧本或已出图资产");
      return;
    }
    try {
      const r = await downloadManhuaSeriesSwitchBackup({
        writerPack,
        topic: factoryTopic.trim() || undefined,
        previousSeriesTitle: writerPack?.seriesTitle || undefined,
        // 手动备份：题材框若已改成新剧名，禁止拿它当备份名
        incomingSeriesTitle:
          factoryTopic.trim() &&
          factoryTopic.trim() !== String(writerPack?.seriesTitle || "").trim()
            ? factoryTopic.trim()
            : undefined,
        blocks,
        customAssetRefs,
        characterIds: selectedCharacterIds,
        artStyleId: factoryArtStyleId,
        sceneId: factorySceneId || undefined,
      });
      toast.success(`已下载先前专案备份：${r.filename}（${r.okCount} 项）`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "备份失败");
    }
  }, [
    writerPack,
    blocks,
    customAssetRefs,
    factoryTopic,
    selectedCharacterIds,
    factoryArtStyleId,
    factorySceneId,
  ]);

  /**
   * 一键清空：跟「导入新剧本」共用同一段清空逻辑，但不依赖导入新文本触发——
   * 用户单纯想清掉旧设定/残留占位符，不必先粘一份新剧本才能清空。
   * 备份是否下载交给面板上的勾选框（默认勾选），不再用 window.confirm 两连问。
   */
  const clearCurrentSeriesProject = useCallback(async (withBackup: boolean) => {
    const risk = inspectManhuaSeriesSwitchRisk({ writerPack, blocks, customAssetRefs });
    if (!risk.needsBackup) {
      toast.message("当前没有可清空的剧本或已出图资产");
      setShowClearSeriesConfirm(false);
      return;
    }
    if (withBackup) {
      try {
        const r = await downloadManhuaSeriesSwitchBackup({
          writerPack,
          topic: factoryTopic.trim() || undefined,
          previousSeriesTitle: writerPack?.seriesTitle || undefined,
          blocks,
          customAssetRefs,
          characterIds: selectedCharacterIds,
          artStyleId: factoryArtStyleId,
          sceneId: factorySceneId || undefined,
          // 一键清空不是「换新剧」，没有 incoming 剧名要保护，跳过追问先前剧名
          askPreviousTitle: false,
        });
        toast.success(`已备份并清空：${r.filename}`);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "备份失败，已中止清空");
        return;
      }
    }
    let cleaned = stripManhuaFactoryCanvasArtifacts(blocks, edges);
    const seriesCleared = stripManhuaSeriesAssetsForNewProject(cleaned.blocks, cleaned.edges);
    cleaned = {
      ...cleaned,
      blocks: seriesCleared.blocks,
      edges: seriesCleared.edges,
      removedCount: cleaned.removedCount + seriesCleared.removedCount,
    };
    if (abortRef.current) abortRef.current.abort();
    setBlocks(cleaned.blocks);
    setEdges(cleaned.edges);
    saveCanvasState(cleaned.blocks, cleaned.edges);
    setDockSelectedIds(new Set());
    setWorkflowPhase("outline");
    setWriterPack(null);
    setWriterConfirmed(false);
    setProjectBible(null);
    setCustomAssetRefs([]);
    setDirectorBoardMainByEpisode({});
    saveManhuaDirectorBoardMainByEpisode({});
    setWriterFocusEpisode(1);
    setWriterImportDraft("");
    setWriterConfirmBlockers([]);
    if (!withBackup) {
      toast.success("旧专案已清空（未下载备份）");
    }
    setShowClearSeriesConfirm(false);
  }, [
    writerPack,
    blocks,
    edges,
    customAssetRefs,
    factoryTopic,
    selectedCharacterIds,
    factoryArtStyleId,
    factorySceneId,
  ]);

  // 返回是否确认成功：调用方据此决定是否切视图（失败时 extras 已被切开展示门禁红字，勿再关）
  const confirmWriterToDirector = useCallback((): boolean => {
    if (!writerPack || !writerPackLooksReady(writerPack)) {
      toast.error("请先扩写或导入剧本，并检查剧情包是否完整");
      return false;
    }
    if (!hasManhuaSeedanceLayoutChoice(writerVideoModel)) {
      toast.error(`请先选择成片引擎（${writerLayoutChoiceLabelsZh}）`);
      return false;
    }
    const densityGate = evaluateWriterPackAssetAndDensity({
      charactersMd: writerPack.charactersMd,
      propsMd: writerPack.propsMd,
      locationsMd: writerPack.locationsMd,
      episodes: writerPack.episodes,
      targetSec: writerLayoutProfile.targetSec,
      segmentCount: writerLayoutProfile.segmentCount,
      durationSecPerSegment: writerLayoutProfile.durationSecPerSegment,
      segmentMin: writerLayoutProfile.segmentMin,
      segmentMax: writerLayoutProfile.segmentMax,
    });
    if (!densityGate.ok) {
      setWriterConfirmBlockers(densityGate.errors.slice(0, 6));
      // 红字横幅渲染在 extras 视图里；沉浸工作台下若不切开，用户只能看到截断的
      // toast，门禁就成了「看不见原因的死路」。切开并滚到横幅。
      setImmersiveExtrasOpen(true);
      window.setTimeout(() => {
        document
          .querySelector("[data-manhua-writer-confirm-blockers]")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
      toast.error("剧本未过密度/资产表门禁", {
        description: densityGate.errors.slice(0, 4).join("；"),
      });
      pushDebug("confirmWriterToDirector", {
        level: "warn",
        detail: densityGate.errors.join(" | ").slice(0, 500),
      });
      return false;
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
      artStyleId: factoryArtStyleId,      craftShotIds: selectedCraftShotIds,
      pathCameraRecipeIds: selectedPathRecipeIds,
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
      // 用刚算出的 canon，不能读 projectBible——上一行的 setState 本轮还没生效，
      // 首次确认编剧时它还是 null，等于 assetCanon 传了 undefined
      assetCanon: canon,
      writerContext: composeWriterPackFactoryContext(writerPack, continuity.episodeIndex, {
        assetCanonAddonZh: formatWriterAssetCanonFactoryAddon(canon, continuity.episodeIndex),
      }),
      includeDirectorCraft: true,
      episodeIndex: continuity.episodeIndex,
      episodeTitle: continuity.episodeTitle,
      endingHook: continuity.endingHook,
      previousEndingHook: continuity.previousEndingHook,
      previouslyOnRecap: continuity.previouslyOnRecap,
      videoModel: hasManhuaSeedanceLayoutChoice(writerVideoModel)
        ? (writerVideoModel as CanvasBlock["videoModel"])
        : undefined,
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
    // 确认剧本只进资产设定阶段，不再自动出图（2026-08-10 用户明令拿掉：
    // 出图是付费动作，且用户常有现成资产 ZIP 可导入——自动触发等于未经同意扣费/烧上游。
    // 生成设定图一律由用户在资产设定页显式点击触发）
    setWorkflowPhase("assets");
    toast.success(
      `已确认剧情并锁定编剧表（${tips.join("·")}${
        purgedRefs.removedCount > 0 ? `·已清旧设定图${purgedRefs.removedCount}` : ""
      }）。可导入现成资产 ZIP，或手动点击生成设定图（生成将扣费）。`,
    );
    return true;
  }, [
    writerPack,
    factoryTopic,
    writerVideoModel,
    writerLayoutProfile,
    resolveHardCastForSpawn,
    recommendedScene?.id,
    femaleLeadManual,
    maleLeadManual,
    ancientManual,
    artStyleManual,
    sceneManual,
    propManual,
    wardrobeManual,
    selectedCraftShotIds,
    selectedPathRecipeIds,
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
    if (!hasManhuaSeedanceLayoutChoice(writerVideoModel)) {
      toast.error(`请先选择成片引擎（${writerLayoutChoiceLabelsZh}）`);
      return;
    }
    const selectedVideoModel: ManhuaSeedanceLayoutVideoModel = writerVideoModel;
    const densityGate = evaluateWriterPackAssetAndDensity({
      charactersMd: writerPack.charactersMd,
      propsMd: writerPack.propsMd,
      locationsMd: writerPack.locationsMd,
      episodes: writerPack.episodes,
      targetSec: writerLayoutProfile.targetSec,
      segmentCount: writerLayoutProfile.segmentCount,
      durationSecPerSegment: writerLayoutProfile.durationSecPerSegment,
      segmentMin: writerLayoutProfile.segmentMin,
      segmentMax: writerLayoutProfile.segmentMax,
    });
    if (!densityGate.ok) {
      setWriterConfirmBlockers(densityGate.errors.slice(0, 6));
      // 同 confirmWriterToDirector：沉浸态下切开 extras，让门禁原因可见
      setImmersiveExtrasOpen(true);
      window.setTimeout(() => {
        document
          .querySelector("[data-manhua-writer-confirm-blockers]")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
      toast.error("剧本未过密度/资产表门禁", {
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
      artStyleId: factoryArtStyleId,      craftShotIds: selectedCraftShotIds,
      pathCameraRecipeIds: selectedPathRecipeIds,
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
      // 同 confirmWriterToDirector：读 state 会拿到本轮还没更新的旧值
      assetCanon: canon,
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
      videoModel: selectedVideoModel,
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
      `已按集铺板 ${spawned.episodeCount} 行链（${writerLayoutProfile.labelZh} · ${writerLayoutProfile.segmentCount}×${writerLayoutProfile.durationSecPerSegment}s；上集钩子已注入；第3集起含前情提要片头；坞已预勾选可跑）`,
    );
  }, [
    writerPack,
    factoryTopic,
    writerVideoModel,
    writerLayoutProfile,
    resolveHardCastForSpawn,
    recommendedScene?.id,
    femaleLeadManual,
    maleLeadManual,
    ancientManual,
    artStyleManual,
    sceneManual,
    propManual,
    wardrobeManual,
    writerFocusEpisode,    selectedCraftShotIds,
    selectedPathRecipeIds,
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

  /**
   * 道具拼板拆分导入：一张图里挤了 N 件道具，切成单件图分别进「我的道具」，
   * 而不是整张拼板当一件参考图喂给融图模型（模型只能靠文字猜哪个是哪个）。
   */
  const importPropSheetFile = useCallback(
    async (file: File) => {
      if (!/^image\//i.test(file.type)) {
        toast.message("请选择图片文件");
        return;
      }
      try {
        const { assets, failed } = await uploadCanvasFilesParallel({
          files: [file],
          getSignedUploadUrl: (input) => getSignedUrlMutation.mutateAsync(input),
        });
        const sheetUrl = assets.find((a) => a.kind === "image" && /^https:\/\//i.test(a.url))?.url;
        if (!sheetUrl) {
          toast.error("拼板上传失败", { description: failed[0]?.error || "请重试" });
          return;
        }
        const res = await splitPropSheetMutation.mutateAsync({ sheetUrl });
        const added: ManhuaCustomAssetRef[] = res.items.map((item) => ({
          id: makeManhuaCustomAssetId(),
          url: item.url,
          // 长期资产存 gcsUri：item.url 是 7 天签名链接，过期后单靠它再也签不出新链接；
          // 有 gcsUri 才能在任意时刻现签（见下方 resign effect）。
          gcsUri: item.gcsUri,
          role: "prop" as const,
          labelZh: (item.note ? `${item.name}（${item.note}）` : item.name).slice(0, 40),
          source: "upload" as const,
        }));
        setCustomAssetRefs((prev) => normalizeManhuaCustomAssetRefs([...prev, ...added]));
        toast.message(`已拆出 ${added.length} 件道具单件图`, {
          description: res.titlesFromCache
            ? "标题读取自缓存，未重复调用识图。已归入「我的道具」，可改名。"
            : "已归入「我的道具」，可改名；读不出标题的按编号占位。",
        });
      } catch (e: unknown) {
        toast.error("拼板拆分失败", {
          description: e instanceof Error ? e.message : "请稍后重试",
        });
      }
    },
    [getSignedUrlMutation, splitPropSheetMutation],
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

  /**
   * 手动改名：自动识别只求 95%，剩下认错/认不出的（阿咎_半身、s05_xx 前缀）
   * 由用户改成与剧本表一致的名字，labelMatchesName 即命中，门禁与认领同步解锁。
   */
  const setCustomAssetLabel = useCallback((id: string, labelZh: string) => {
    const label = String(labelZh || "").trim().slice(0, 40);
    setCustomAssetRefs((prev) =>
      normalizeManhuaCustomAssetRefs(
        prev.map((r) => (r.id === id ? { ...r, labelZh: label || undefined } : r)),
      ),
    );
  }, []);

  const setCustomAssetClaims = useCallback((id: string, anchorIds: string[]) => {
    const claimedAnchorIds = Array.from(
      new Set(anchorIds.map((v) => String(v || "").trim()).filter(Boolean)),
    ).slice(0, 24);
    setCustomAssetRefs((prev) =>
      normalizeManhuaCustomAssetRefs(
        prev.map((r) =>
          r.id === id ? { ...r, claimedAnchorIds, claimSource: "manual" as const } : r,
        ),
      ),
    );
  }, []);

  const acceptCustomAssetReview = useCallback((id: string) => {
    setCustomAssetRefs((prev) =>
      normalizeManhuaCustomAssetRefs(
        prev.map((r) =>
          r.id === id ? { ...r, reviewStatus: "accepted" as const, qualityIssues: [] } : r,
        ),
      ),
    );
  }, []);

  const standardizeCustomAsset = useCallback(
    async (id: string, quality: ManhuaAssetStandardizeQuality) => {
      if (assetStandardizeBusyId) return;
      const ref = customAssetRefs.find((item) => item.id === id);
      if (!ref) return;
      const cost = manhuaAssetStandardizeCredits(quality);
      if (!window.confirm(`将调用 GPT-image-2 图片编辑，把这张图标准化为工作流可用资产。\n\n${quality}：${cost} 积分/张；失败自动退回。原图会保留。继续？`)) return;
      setAssetStandardizeBusyId(id);
      try {
        const claimedNames = (ref.claimedAnchorNamesZh || []).filter(Boolean).slice(0, 8);
        const multiPropSheet = ref.role === "prop" && claimedNames.length > 1;
        const rolePrompt =
          ref.role === "character"
            ? "保留同一人物的脸、年龄、发型、服装与身份特征，补全为单人竖版 2:3 资产照；头顶到胸口或全身完整可见，背景干净，不新增人物，不改变身份。"
            : ref.role === "scene"
              ? "保留同一地点的建筑、陈设、光线与时代信息，整理为干净的横版 3:2 场景空镜；画面无人脸特写，不改变地点。"
              : multiPropSheet
                ? `保留同一批道具（${claimedNames.join("、")}）的材质、颜色、形制与磨损，整理为横版等分资产拼板；每格只放一件道具，不新增品类。`
                : "保留同一件物品的材质、颜色、形制与磨损，整理为单件居中的竖版 2:3 道具设定图；不新增其他物品。";
        const aspectRatio = ref.role === "scene" || multiPropSheet ? "16:9" : "9:16";
        const { jobId } = await createJobSameOrigin({
          type: "image",
          userId: String(user?.id || ""),
          input: buildCanvasGptImage2JobInput({
            prompt: `${rolePrompt}\n禁止文字、标签、边框、水印、拼图和多宫格。`,
            aspectRatio,
            referenceImageUrls: [ref.url],
            generalImageEdit: true,
            providerOverride: "openai",
            imageLane: "asset",
            gcsSubdir: "manhua-asset-standardized",
            assetStandardizeQuality: quality,
            assetRefId: ref.id,
          }),
        });
        const job = await pollJobUntilTerminal(jobId, { maxWaitMs: 12 * 60_000, intervalMs: 2500 });
        if (job.status !== "succeeded") throw new Error(job.error || "资产标准化失败");
        const out = (job.output || {}) as { imageUrl?: string; imageUrls?: string[] };
        const imageUrl = String(out.imageUrl || out.imageUrls?.[0] || "").trim();
        if (!/^https:\/\//i.test(imageUrl)) throw new Error("资产标准化未返回有效图片");
        setCustomAssetRefs((prev) =>
          normalizeManhuaCustomAssetRefs([
            ...prev,
            {
              ...ref,
              id: makeManhuaCustomAssetId(),
              url: imageUrl,
              gcsUri: undefined,
              labelZh: `${ref.labelZh || "资产"}·标准化`,
              reviewStatus: "converted",
              qualityIssues: [],
              claimSource: "converted",
              source: "generated",
            },
          ]),
        );
        toast.success(`标准化完成 · 已扣 ${cost} 积分`, { description: "原图仍保留，新图已进入资产库。" });
      } catch (error) {
        toast.error("资产标准化失败", {
          description: error instanceof Error ? error.message : "已进入失败退分流程",
        });
      } finally {
        setAssetStandardizeBusyId(null);
      }
    },
    [assetStandardizeBusyId, customAssetRefs, user?.id],
  );

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

  const handleSegmentCastChange = useCallback(
    (segmentIndex: number, castZh: string) => {
      const cast = String(castZh || "").trim().slice(0, 80);
      const ep = writerFocusEpisode;
      setWriterPack((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          episodes: prev.episodes.map((e) =>
            e.index === ep
              ? {
                  ...e,
                  body: upsertManhuaSegmentCastInMarkdown(e.body || "", segmentIndex, cast),
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
          const updated = upsertManhuaSegmentCastInMarkdown(base, segmentIndex, cast);
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
  /** 清图/重出前把带成品图的资产块并入暂存区（本地持久，可救回） */
  const stashManhuaAssetBlocksBeforePurge = useCallback(
    (
      removed: CanvasBlock[],
      assetCanon?: NonNullable<typeof projectBible>["assetCanon"] | null,
    ) => {
      if (typeof window === "undefined") return;
      const incoming: Partial<ManhuaAssetStashEntry>[] = [];
      for (const b of removed) {
        const url = b.outputUrl || b.outputUrls?.[0];
        if (!url || !/^https:\/\//i.test(url)) continue;
        if (
          !b.id.startsWith("charsheet-") &&
          !b.id.startsWith("sceneplate-") &&
          !b.id.startsWith("propsheet-")
        ) {
          continue;
        }
        const role: ManhuaAssetStashRole = b.id.startsWith("sceneplate-")
          ? "scene"
          : b.id.startsWith("propsheet-")
            ? "prop"
            : "character";
        const seedId = seedIdFromManhuaSheetBlockId(b.id);
        const labelZh =
          (role === "character"
            ? assetCanon?.characters.find((c) => c.id === seedId || b.id.includes(c.id))?.nameZh
            : role === "prop"
              ? assetCanon?.props.find((p) => p.id === seedId || b.id.includes(p.id))?.nameZh
              : assetCanon?.locations.find((l) => l.id === seedId || b.id.includes(l.id))
                  ?.nameZh) || undefined;
        incoming.push({
          blockId: b.id,
          role,
          imageUrl: url,
          outputUrls: b.outputUrls,
          labelZh,
          prompt: b.prompt,
        });
      }
      if (!incoming.length) return;
      try {
        const prev = parseManhuaAssetStash(
          window.localStorage.getItem(MANHUA_ASSET_STASH_STORAGE_KEY),
        );
        const merged = mergeManhuaAssetStash(prev, incoming);
        window.localStorage.setItem(
          MANHUA_ASSET_STASH_STORAGE_KEY,
          JSON.stringify(merged),
        );
        setAssetStashCount(merged.length);
        toast.message(`已存入暂存区（${incoming.length} 张）`, {
          description: "万一清错了，可在资产设定点「暂存区恢复」找回",
        });
      } catch {
        /* 暂存失败不影响主流程 */
      }
    },
    [],
  );

  /**
   * 换用公有库里挑的那张：不生图，但照收费（拿走的是别人贡献的成品，用户 2026-07-29 口径）。
   * 扣费成功才把图写回该锚点的设定图节点；旧图先进暂存区，手滑了还能恢复。
   */
  const swapManhuaAssetSheetFromLibrary = useCallback(
    async (anchorId: string, libraryImageUrl?: string) => {
      const url = String(libraryImageUrl || "").trim();
      const anchor = String(anchorId || "").trim();
      if (!anchor || !/^https:\/\//i.test(url)) {
        toast.message("请先在库里点选一张");
        return;
      }
      if (!user?.id) {
        toast.message("请先登录后再使用库内资产");
        return;
      }
      const target = blocks.find(
        (b) =>
          (b.id.startsWith("charsheet-") ||
            b.id.startsWith("sceneplate-") ||
            b.id.startsWith("propsheet-")) &&
          b.id.includes(anchor) &&
          // 主角有全身与脸特写两块，换库图只落到主块，不动派生的脸
          !b.id.startsWith("charsheet-face-"),
      );
      if (!target) {
        toast.message("没找到这个资产的设定图节点");
        return;
      }
      const role: ManhuaAssetRecycleRole = target.id.startsWith("sceneplate-")
        ? "scene"
        : target.id.startsWith("propsheet-")
          ? "prop"
          : "character";
      try {
        const res = await chargeAssetRegenMutation.mutateAsync({
          role,
          tileCount: 1,
          mode: "library",
        });
        stashManhuaAssetBlocksBeforePurge([target], projectBible?.assetCanon);
        handleBlocksChange((prev) =>
          prev.map((b) =>
            b.id === target.id
              ? {
                  ...b,
                  outputUrl: url,
                  outputUrls: [],
                  status: "done" as const,
                  error: undefined,
                }
              : b,
          ),
        );
        openManhuaFactoryCanvas(target.id);
        toast.message("已换成库内资产", {
          description: `已扣 ${res.creditsCharged} 积分；原图已进暂存区，可恢复`,
        });
      } catch (e: unknown) {
        toast.error("换用库内资产失败", {
          description: e instanceof Error ? e.message : "请稍后重试",
        });
      }
    },
    [
      blocks,
      handleBlocksChange,
      openManhuaFactoryCanvas,
      projectBible?.assetCanon,
      stashManhuaAssetBlocksBeforePurge,
      chargeAssetRegenMutation,
      user?.id,
    ],
  );


  /** 从暂存区救回资产块：本地不存在的重新加回画布 */
  const restoreManhuaAssetsFromStash = useCallback(() => {
    if (typeof window === "undefined") return;
    const stash = parseManhuaAssetStash(
      window.localStorage.getItem(MANHUA_ASSET_STASH_STORAGE_KEY),
    );
    if (!stash.length) {
      toast.message("暂存区是空的");
      return;
    }
    setBlocks((prev) => {
      const haveIds = new Set(prev.map((b) => b.id));
      const haveUrls = new Set(
        prev.map((b) => b.outputUrl || b.outputUrls?.[0]).filter(Boolean) as string[],
      );
      const CHAR_Y = 80;
      const SCENE_Y = 520;
      const PROP_Y = 960;
      const GAP = 380;
      let c = 0;
      let s = 0;
      let p = 0;
      const revived: CanvasBlock[] = [];
      for (const e of stash) {
        if (haveIds.has(e.blockId) || haveUrls.has(e.imageUrl)) continue;
        const isScene = e.role === "scene";
        const isProp = e.role === "prop";
        const y = isScene ? SCENE_Y : isProp ? PROP_Y : CHAR_Y;
        const col = isScene ? s++ : isProp ? p++ : c++;
        const blk = defaultCanvasBlock("image", 60 + col * GAP, y);
        blk.id = e.blockId;
        blk.prompt = e.prompt || "";
        blk.aspectRatio = "9:16";
        blk.imageModel = "gpt-image-2";
        blk.imageMode = "generate";
        blk.outputUrl = e.imageUrl;
        if (e.outputUrls?.length) blk.outputUrls = e.outputUrls;
        blk.status = "done";
        blk.width = 360;
        blk.height = 400;
        revived.push(blk);
      }
      if (!revived.length) {
        toast.message("暂存区里的图当前都还在，无需恢复");
        return prev;
      }
      const next = [...prev, ...revived];
      saveCanvasState(next, edges);
      toast.success(`已从暂存区恢复 ${revived.length} 张`, {
        description: "重新敲 @ 即可把它们挂回段落",
      });
      return next;
    });
  }, [edges]);

  /** 清理暂存区：清空本地暂存的旧设定图（不影响画布现有图） */
  const clearManhuaAssetStash = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(MANHUA_ASSET_STASH_STORAGE_KEY);
    } catch {
      /* 忽略 */
    }
    setAssetStashCount(0);
    toast.message("已清理暂存区", {
      description: "暂存的旧设定图已清空；画布上现有的图不受影响",
    });
  }, []);

  /**
   * 已出图却没拿到 @ 槽位、且库还能装下的设定卡张数。
   * 按钮数字按「还能认领几张」报，避免库已满仍显示「认领 17 张」。
   */
  const unadoptedSheetCount = useMemo(() => {
    const plans = planManhuaSheetAdoptions({
      blocks,
      customRefs: customAssetRefs,
      assetCanon: projectBible?.assetCanon,
    });
    if (!plans.length) return 0;
    const room = Math.max(0, MANHUA_CUSTOM_ASSET_REFS_MAX - customAssetRefs.length);
    return Math.min(plans.length, room);
  }, [blocks, customAssetRefs, projectBible?.assetCanon]);

  /**
   * 重新认领本集设定图：把画布上已出图、却没进「我的角色 / 我的场景 / 我的道具」
   * 的设定卡挂回 @ 号。纯本地改绑，不重画、不扣积分。
   *
   * 留这个手动入口是因为认领一旦漏掉，症状是静帧里的人脸悄悄换人，
   * 门禁不报错、只有出完图才看得出来，用户需要一个能自己修的按钮。
   */
  const adoptEpisodeSheetsToMyLibrary = useCallback(async () => {
    const assetCanon = projectBible?.assetCanon;
    const plans = planManhuaSheetAdoptions({
      blocks,
      customRefs: customAssetRefs,
      assetCanon,
    });
    if (!plans.length) {
      toast.message("本集设定图都已挂上 @ 号，无需认领");
      return;
    }
    /**
     * 逐条累积在本地快照上，最后一次写回 state：
     * 报数要按真正进了库的张数，不能按 plans.length——从前容量满了照样报「已认领 17 张」，
     * 实际只挂上十一张，用户以为齐了，出静帧才发现有人没锁脸。
     */
    let nextRefs = customAssetRefs;
    for (const plan of plans) {
      let refUrl = plan.url;
      let tileUrls: Partial<Record<ManhuaSceneTileSlot, string>> | null = null;
      if (plan.layout === "grid2x2") {
        try {
          const tiles = await cropManhuaSheet2x2({
            sheetUrl: plan.url,
            objectPrefix: `manhua-scene-tiles/${plan.seedId}`,
          });
          tileUrls = Object.fromEntries(tiles.map((t) => [t.slot, t.url]));
          const main = tiles.find((t) => t.slot === "topLeft") || tiles[0];
          if (main?.url) refUrl = main.url;
        } catch {
          /* 切图失败就挂整张：总比这一集没垫图强 */
        }
      }
      const charDuty: "identity" | "look" = plan.blockId.startsWith("charsheet-face-")
        ? "identity"
        : blocks.some((b) => b.id === manhuaHeroFaceSheetId(plan.seedId))
          ? "look"
          : "identity";
      nextRefs = upsertGeneratedManhuaCustomAssetRef(nextRefs, {
        url: refUrl,
        role: plan.role,
        labelZh: plan.labelZh,
        seedLibraryId: plan.seedId,
        refDuty: plan.role === "character" ? charDuty : plan.role === "prop" ? "style" : "space",
        tileUrls,
      });
    }
    const adopted = Math.max(0, nextRefs.length - customAssetRefs.length);
    setCustomAssetRefs(nextRefs);
    if (!adopted) {
      toast.error("认领没能写进素材库", {
        description: "素材库可能已满，请先清掉用不到的参考图再试",
      });
      return;
    }
    const missed = plans.length - adopted;
    toast.success(`已认领 ${adopted} 张设定图`, {
      description: missed
        ? `还有 ${missed} 张没能挂上，素材库快满了，清掉用不到的参考图再点一次`
        : "已写进我的角色 / 我的场景 / 我的道具，静帧现在能锁到这些脸与场景",
    });
  }, [blocks, customAssetRefs, projectBible?.assetCanon]);

  const confirmAssetsAndPrepareImages = useCallback(
    async (opts?: {
      assetCanonOverride?: NonNullable<typeof projectBible>["assetCanon"];
      episodeIndexOverride?: number;
      topicOverride?: string;
      /** 清掉旧生成设定图并强制按现稿重出（重扩写/用户点「按剧本重出」） */
      forceRegenerate?: boolean;
      /**
       * 只补编剧表里的某一个资产（左栏「待生成」卡点击）。
       * 设了就不清旧图、不动其他资产、不跳阶段——只出这一张。
       */
      onlyAnchorId?: string;
      /**
       * 只补编剧表里这一批缺图的资产（「补齐 N 张」按钮）。
       * 与 onlyAnchorId 同性质：只出这几张、绝不清已出、不跳阶段——
       * 让「补齐 N 张」名副其实（N=真实要出的张数），根治误点清全量。
       */
      onlyAnchorIds?: string[];
      /**
       * 「重出本类 N 张」：这些 anchor 即使已有成品图，也按**新编译的提示词**重出。
       * 工作台「重出本类」走本路径重编译；画布节点重跑已接 compileManhuaRerun。
       * 与增量同性质：不清别的资产、不跳阶段。
       */
      regenerateAnchorIds?: string[];
      /** 用户在重出弹框写的「哪里要改进」；只压到重出那几张的提示词尾部 */
      regenerateNoteZh?: string;
    }) => {
      const assetCanon = opts?.assetCanonOverride ?? projectBible?.assetCanon;
      const episodeIndex = opts?.episodeIndexOverride ?? writerFocusEpisode;
      const topic = String(opts?.topicOverride || factoryTopic || "").trim();
      const forceRegenerate = Boolean(opts?.forceRegenerate);
      const onlyAnchorIdList = (opts?.onlyAnchorIds || [])
        .map((s) => String(s || "").trim())
        .filter(Boolean);
      const regenerateAnchorIds = (opts?.regenerateAnchorIds || [])
        .map((s) => String(s || "").trim())
        .filter(Boolean);
      const onlyAnchorId =
        String(opts?.onlyAnchorId || "").trim() || (onlyAnchorIdList.length === 1 ? onlyAnchorIdList[0]! : "");
      /** 增量补图/重出（单张或多张）：一律不清旧图、不跳阶段 */
      const isIncremental =
        Boolean(onlyAnchorId) || onlyAnchorIdList.length > 0 || regenerateAnchorIds.length > 0;
      /** 本轮限定处理的 anchor（补缺 + 重出合起来） */
      const scopedAnchorIds = Array.from(
        new Set(onlyAnchorIdList.concat(onlyAnchorId ? [onlyAnchorId] : []).concat(regenerateAnchorIds)),
      );
      const anchorIdMatch = (planId: string) =>
        scopedAnchorIds.length > 0 ? scopedAnchorIds.some((a) => planId.includes(a)) : true;
      /** 这张是否属于「已有图也要重出」 */
      const isRegenPlan = (planId: string) =>
        regenerateAnchorIds.some((a) => planId.includes(a));
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
        !isIncremental && (forceRegenerate || Boolean(assetCanon && !align.aligned));
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
          // 清图前先存进暂存区：误清/重出可救回（防「手贱」）
          stashManhuaAssetBlocksBeforePurge(
            canvasBlocks.filter((b) => removeIds.has(b.id)),
            assetCanon,
          );
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
      const ingestSheetToMyLibrary = async (
        plan: {
          id: string;
          kind: "charsheet" | "sceneplate" | "propsheet";
          labelZh: string;
          layout?: "single" | "grid2x2" | "heroFace" | "heroLook";
        },
        url: string | null | undefined,
      ) => {
        const u = String(url || "").trim();
        if (!/^https:\/\//i.test(u)) return;
        const seedLibraryId = seedIdFromManhuaSheetBlockId(plan.id);
        /**
         * 四视角拼板整张不能当垫图：模型会把四格读成四个不同地点。切开只把
         * 主视角挂成垫图；拼板本身仍留在节点输出里给人看。切失败就退回整张，
         * 总比这一集没场景垫图强。
         */
        let refUrl = u;
        let tileUrls: Partial<Record<ManhuaSceneTileSlot, string>> | null = null;
        if (plan.kind === "sceneplate" && plan.layout === "grid2x2") {
          try {
            const tiles = await cropManhuaSheet2x2({
              sheetUrl: u,
              objectPrefix: `manhua-scene-tiles/${seedLibraryId}`,
            });
            // 四格全存：段内按机位挑；url 取主视角当默认（建立镜头的纵深）
            tileUrls = Object.fromEntries(tiles.map((t) => [t.slot, t.url]));
            const main = tiles.find((t) => t.slot === "topLeft") || tiles[0];
            if (main?.url) refUrl = main.url;
          } catch (cropErr) {
            console.warn(
              `[canvas] scene sheet crop failed · ${
                cropErr instanceof Error ? cropErr.message.slice(0, 120) : "unknown"
              }`,
            );
          }
        }
        /**
         * 主角拆两张：大头照锁脸、全身照锁妆造，绑定句按这个职责分工写。
         * 同步既有节点时拿不到 layout，改看有没有同源大头照——有就说明
         * 这张是配套的全身照，否则是配角的单张定妆（仍算锁脸）。
         */
        const charDuty: "identity" | "look" = plan.id.startsWith("charsheet-face-")
          ? "identity"
          : plan.layout === "heroLook" ||
              blocks.some((b) => b.id === manhuaHeroFaceSheetId(seedLibraryId))
            ? "look"
            : "identity";
        const upsertInput = {
          url: refUrl,
          role:
            plan.kind === "charsheet"
              ? ("character" as const)
              : plan.kind === "propsheet"
                ? ("prop" as const)
                : ("scene" as const),
          labelZh: plan.labelZh,
          seedLibraryId,
          refDuty:
            plan.kind === "charsheet"
              ? charDuty
              : plan.kind === "propsheet"
                ? ("style" as const)
                : ("space" as const),
          tileUrls,
        };
        // 本地快照同步跟上：下面的门禁/对齐判断读的是 workingRefs，不是 React state
        workingRefs = upsertGeneratedManhuaCustomAssetRef(workingRefs, upsertInput);
        setCustomAssetRefs((prev) => upsertGeneratedManhuaCustomAssetRef(prev, upsertInput));
      };
      /**
       * 已有画布设定图 → 同步进「我的角色 / 我的场景 / 我的道具」分栏。
       *
       * 必须在每条路径开头都跑一次：只挂在「资产已齐 → 早退」那一支时，按剧本重出
       * 与增量补图全都绕过它，十张定妆只有最早那张拿到 @角色 槽位，其余人在静帧里
       * 锁不到脸——门禁只查节点有没有图，照样放行，钱花完才看出喂错了脸。
       */
      const syncExistingSheetsToMyLibrary = async () => {
        const adoptions = planManhuaSheetAdoptions({
          blocks: canvasBlocks,
          customRefs: workingRefs,
          assetCanon,
        });
        for (const plan of adoptions) {
          await ingestSheetToMyLibrary(
            {
              id: plan.blockId,
              kind: plan.kind,
              labelZh: plan.labelZh,
              layout: plan.layout,
            },
            plan.url,
          );
        }
        return adoptions.length;
      };
      // 先认领再判对齐：refs 缺人会让下面的门禁与「已齐」判断都基于残缺名单
      await syncExistingSheetsToMyLibrary();

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
        !isIncremental &&
        alignAfterPurge.aligned &&
        gate.ready &&
        hasEpisodeSheetMedia
      ) {
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

      /**
       * 道具形制先联网核对：朝笏被画成一张纸就是因为没人告诉模型它长什么样。
       * 查不到的道具照旧出图，只是少一行形制——不让检索挡住生成。
       */
      let propShapeHintsZh: Record<string, string> = {};
      const propNamesToLookup = (assetCanon?.props || [])
        .map((p) => String(p.nameZh || "").trim())
        .filter(Boolean)
        .slice(0, MANHUA_PROP_SHAPE_LOOKUP_MAX);
      if (propNamesToLookup.length) {
        try {
          setFactoryProgress("核对道具实物形制…");
          const res = await lookupPropShapesMutation.mutateAsync({ namesZh: propNamesToLookup });
          propShapeHintsZh = res.hints || {};
          pushDebug("propShapeLookup", {
            detail: `asked=${propNamesToLookup.length} · got=${Object.keys(propShapeHintsZh).length}`,
          });
        } catch (e: unknown) {
          console.warn("[propShapeLookup]", e instanceof Error ? e.message : String(e));
        }
      }
      const plannedAll = planManhuaAssetImageSpawns(gateInput, {
        // 单补/补齐时 gate 可能已 ready（其他资产齐），必须强制按剧本表出卡才拿得到这几张
        forceEpisodeSheets: forceRegenerate || !hasEpisodeSheetMedia || isIncremental,
        regenerateAnchorIds,
        regenerateNoteZh: opts?.regenerateNoteZh,
        propShapeHintsZh,
      });
      const plans = isIncremental
        ? plannedAll.filter((p) => anchorIdMatch(p.id))
        : plannedAll;
      /**
       * 重出档位按**真实张数**算，不按锚点数：主角一个人就有全身 + 脸特写两张，
       * 按锚点算会少收（2 张收成 15）。
       */
      const regenTileCount = Math.max(1, plans.filter((p) => isRegenPlan(p.id)).length);
      if (!plans.length) {
        toast.message(
          isIncremental
            ? "这几张暂时不在出图计划里（已有图或不出单件图），可在画布上点节点重出"
            : hasEpisodeSheetMedia
              ? gate.hintZh || "资产图未齐"
              : "暂无可生成的设定图：请确认剧本人物/场景表，或到「我的角色 / 我的场景」上传参考",
        );
        return;
      }

      const ac = new AbortController();
      abortRef.current = ac;
      setFactoryBusy(true);
      setFactoryProgress(
        isIncremental
          ? `补齐 ${plans.length} 张（${plans[0]?.labelZh || "设定图"}…）`
          : gate.viaWriterCanon
            ? "从剧本出角色/场景设定图…"
            : "准备角色/场景图…",
      );
      pushDebug("confirmAssetsFromScript:start", {
        detail: `plans=${plans.length} · viaCanon=${gate.viaWriterCanon} · missingCast=${gate.missingCastIds.length}`,
      });
      /** 重出但没出图的：结算时要排除（已把旧图放回，不能收钱） */
      const regenFailedIds = new Set<string>();
      try {
        let working = [...canvasBlocks];
        /**
         * 全画布统一排版：人物 / 道具 / 场景上下堆在最左，往右依次是
         * 静帧+导演版、成片提示词、出片。旧版只认角色和场景、各挤成一行，
         * 道具没人排，留在生成时的原始坐标上，画面就是一团乱。
         */
        working = layoutManhuaCanvasBlocks(working, {
          collapsedEpisodes: collapsedManhuaEpisodes,
        });
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
          /**
           * A：主角脸特写以同角色全身图为底图裁切放大（走 edit + refImageUrl），
           * 不再独立重画——独立两次生成连性别都能漂（陆清和曾「全身女·脸特写男」）。
           * 底图没出就跳过这张，绝不退回独立重画。
           */
          /** 重出前先抓住旧图：等下要当垫图，免得重画时身份漂走 */
          const prevSheetUrl = String(
            working.find((b) => b.id === plan.id)?.outputUrl ||
              working.find((b) => b.id === plan.id)?.outputUrls?.[0] ||
              "",
          ).trim();
          let deriveRefUrl = "";
          if (plan.deriveFromSheetId) {
            const src = working.find((b) => b.id === plan.deriveFromSheetId);
            deriveRefUrl = String(src?.outputUrl || src?.outputUrls?.[0] || "").trim();
            if (!deriveRefUrl) {
              toast.message(`跳过 ${plan.labelZh} 的脸特写`, {
                description: "全身图还没出，脸特写要以它为底图才不会漂脸",
              });
              continue;
            }
          }
          let block = working.find((b) => b.id === plan.id);
          if (!block) {
            // 落点交给统一排版算，这里给个占位坐标即可
            block = defaultCanvasBlock("image", MANHUA_CANVAS_LAYOUT.originX, MANHUA_CANVAS_LAYOUT.originY);
            block.id = plan.id;
            block.prompt = plan.prompt;
            block.aspectRatio = "9:16";
            block.imageModel = "gpt-image-2";
            block.imageMode = deriveRefUrl ? "edit" : "generate";
            block.refImageUrl = deriveRefUrl || undefined;
            block.width = 360;
            block.height = 400;
            working = layoutManhuaCanvasBlocks([...working, block], {
              collapsedEpisodes: collapsedManhuaEpisodes,
            });
            block = working.find((b) => b.id === plan.id)!;
          } else if (!(block.outputUrl || block.outputUrls?.[0]) || isRegenPlan(plan.id)) {
            // 已有图 + 指定重出 → 按新编译的提示词重跑（清掉旧产物，别让 UI 显示成已完成）
            block = {
              ...block,
              prompt: plan.prompt,
              status: "idle",
              error: undefined,
              ...(isRegenPlan(plan.id)
                ? { outputUrl: undefined, outputUrls: undefined }
                : {}),
              ...(deriveRefUrl
                ? { imageMode: "edit" as const, refImageUrl: deriveRefUrl }
                : {}),
            };
            working = working.map((b) => (b.id === plan.id ? block! : b));
          } else {
            await ingestSheetToMyLibrary(plan, block.outputUrl || block.outputUrls?.[0]);
            continue;
          }
          setBlocks(working);
          saveCanvasState(working, canvasEdges);
          if (i === 0) openManhuaFactoryCanvas(plan.id);
          const planKindZh =
            plan.kind === "charsheet" ? "角色图" : plan.kind === "propsheet" ? "道具图" : "场景图";
          setFactoryProgress(`${planKindZh} · ${plan.labelZh}`);
          toast.message(
            `${isRegenPlan(plan.id) ? "正在重出" : "正在出"}${planKindZh}：${plan.labelZh}`,
          );
          const regenRoleForBilling =
            plan.kind === "charsheet"
              ? ("character" as const)
              : plan.kind === "propsheet"
                ? ("prop" as const)
                : ("scene" as const);
          /**
           * 重出也走画布这条「入队 + 轮询」长任务：同步接口打 GPT-Image-2 会撞网关 120s
           * 上限（实测 502），图没出还把旧图清了。旧图当垫图，避免重画时身份漂走。
           */
          const out = await runCanvasBlock(
            runDeps,
            isRegenPlan(plan.id) && !deriveRefUrl && prevSheetUrl
              ? { ...block, imageMode: "edit" as const, refImageUrl: prevSheetUrl }
              : block,
            { visionImages: [], texts: [] },
          );
          const regenFailed =
            isRegenPlan(plan.id) && !(out.outputUrl || out.outputUrls?.[0]) && Boolean(prevSheetUrl);
          working = working.map((b) =>
            b.id === plan.id
              ? {
                  ...b,
                  ...out,
                  // 重出没出图就把旧图放回去：用户点的是「改进这张」，不该反被清成空卡
                  ...(regenFailed
                    ? { outputUrl: prevSheetUrl, outputUrls: [] as string[] }
                    : {}),
                  status:
                    out.outputUrl || out.outputUrls?.[0] || regenFailed
                      ? ("done" as const)
                      : ("error" as const),
                  error:
                    out.outputUrl || out.outputUrls?.[0] || regenFailed
                      ? undefined
                      : "角色/场景图未返回可用地址",
                }
              : b,
          );
          if (regenFailed) {
            regenFailedIds.add(plan.id);
            toast.error(`重出失败：${plan.labelZh}`, {
              description: "已保留原图，未扣积分。可改一下描述再试一次。",
            });
          }
          setBlocks(working);
          saveCanvasState(working, canvasEdges);
          const outUrl = out.outputUrl || out.outputUrls?.[0];
          await ingestSheetToMyLibrary(plan, outUrl);
          if (outUrl) {
            pushDebug("confirmAssetsFromScript:engine", {
              level: "ok",
              detail: `${plan.kind}:${plan.labelZh} · ${out.imageModel || "gpt-image-2"}`,
            });
            // 自动入库：出图成功 → 去名匿名进公有库（半成品被 decide 拦掉，不入库）
            const recycleRole: ManhuaAssetRecycleRole =
              plan.kind === "charsheet"
                ? "character"
                : plan.kind === "propsheet"
                  ? "prop"
                  : "scene";
            if (decideManhuaAssetRecycle({ hasImage: true }).recycle) {
              const canonProperNames = [
                ...(assetCanon?.characters ?? []).map((c) => c.nameZh),
                ...(assetCanon?.locations ?? []).map((l) => l.nameZh),
                ...(assetCanon?.props ?? []).map((p) => p.nameZh),
              ].filter(Boolean);
              const anonLabel = anonymizeManhuaLibraryLabelZh(
                plan.labelZh,
                canonProperNames,
                recycleRole,
              );
              void contributeToLibraryRef
                .current({ role: recycleRole, imageUrl: outUrl, labelZh: anonLabel })
                .catch(() => {
                  /* 入库失败不影响出图；静默 */
                });
            }
          }
        }
        /**
         * 重出扣费放在**出图之后**，按真实出图张数结算（1 张 15 / 2 张 20，超出每张 +5）。
         * 先扣后生成会在生图失败时留下一笔要退的账，退款接口一开就能被刷；没拿到图就不收，
         * 这条账最干净。补缺图不走这里（那条仍是原有计费路径）。
         */
        if (regenerateAnchorIds.length) {
          const paidPlans = plans.filter(
            (p) =>
              isRegenPlan(p.id) &&
              Boolean(
                working.find((b) => b.id === p.id)?.outputUrl ||
                  working.find((b) => b.id === p.id)?.outputUrls?.[0],
              ),
          );
          const paidTiles = paidPlans.filter((p) => !regenFailedIds.has(p.id)).length;
          if (paidTiles > 0) {
            const billRole =
              paidPlans[0]?.kind === "sceneplate"
                ? ("scene" as const)
                : paidPlans[0]?.kind === "propsheet"
                  ? ("prop" as const)
                  : ("character" as const);
            try {
              const charge = await chargeAssetRegenMutation.mutateAsync({
                role: billRole,
                tileCount: paidTiles,
                mode: "redraw",
              });
              toast.message(`重出完成 ${paidTiles} 张`, {
                description: `已扣 ${charge.creditsCharged} 积分`,
              });
            } catch (e: unknown) {
              toast.error("重出已完成，但扣费失败", {
                description: e instanceof Error ? e.message : "请检查积分余额",
              });
            }
          }
        }
        /**
         * readableChain 除了排版还负责给节点盖 @资产 标签，所以留着照跑；
         * 但坐标以统一排版为准——三套排位互相覆盖正是画布乱的根源，
         * 让 layoutManhuaCanvasBlocks 做最后一道，谁也别再改坐标。
         */
        working = layoutManhuaCanvasBlocks(
          layoutManhuaEpisodeReadableChain(working, writerFocusEpisode, {
            assetCanon: projectBible?.assetCanon,
            characterSheetUrlById: collectManhuaCharacterSheetUrlById(
              working,
              projectBible?.assetCanon,
            ),
            propImageUrlById: collectManhuaPropImageUrlById(customAssetRefs, projectBible?.assetCanon),
          }),
          { collapsedEpisodes: collapsedManhuaEpisodes },
        );
        setBlocks(working);
        saveCanvasState(working, canvasEdges);
        {
          const focusAssetId =
            // 增量补：镜头停在刚补的那张，别跳回第一个角色
            (isIncremental ? plans[0]?.id : "") ||
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
        if (isIncremental) {
          // 增量补不改阶段：用户只是回填缺图，不该被推进/推回
          const doneCount = plans.filter((p) =>
            Boolean(
              working.find((b) => b.id === p.id)?.outputUrl ||
                working.find((b) => b.id === p.id)?.outputUrls?.[0],
            ),
          ).length;
          toast.message(
            doneCount >= plans.length
              ? `已补齐 ${plans.length} 张`
              : `补齐 ${doneCount}/${plans.length} 张，没出的可再点一次`,
          );
          pushDebug("confirmAssetsFromScript:incremental", {
            level: doneCount >= plans.length ? "ok" : "warn",
            detail: `done=${doneCount}/${plans.length}`,
          });
        } else if (nextGate.ready) {
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
        if (!isIncremental) setWorkflowPhase("assets");
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
      stashManhuaAssetBlocksBeforePurge,
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
            craftShotIds: selectedCraftShotIds,            pathCameraRecipeIds: selectedPathRecipeIds,
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
              explicitWriterVideoModel || undefined,
            );
            const keyartProgressZh = () => {
              const counts = countManhuaKeyartProgress(
                // 只数这一轮真会跑的静帧：改选引擎后残留的旧节点若也计入，
                // 分母会被顶回 18、永远显示 12/18，与推进板和队列各说各话
                queuedManhuaKeyartBlocks(
                  workingBlocks,
                  episodeIndex,
                  explicitWriterVideoModel || undefined,
                ),
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
      customAssetRefs,
      recommendedScene?.id,
      castBundle.identityLockZh,
      projectBible?.assetCanon,
      writerFocusEpisode,
      runDeps,
      resolveRunEpisodeIndexes,
      pushDebug,
      selectedCharacterIds,
      selectedCraftShotIds,      selectedPathRecipeIds,
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

  /** 进工作台时若静帧仍是默认大卡，自动缩略竖排一次，右栏才能一眼看全 */
  const immersiveAutoCompactKeyRef = useRef("");
  useEffect(() => {
    if (!immersiveWorkbench) return;
    const key = `${writerFocusEpisode}`;
    const oversized = blocksRef.current.some((b) => {
      if ((getBlockEpisodeIndex(b) ?? 1) !== writerFocusEpisode) return false;
      const id = String(b.id || "");
      if (
        !id.startsWith("keyart-") &&
        !id.startsWith("clip-") &&
        !id.startsWith("charsheet-") &&
        !id.startsWith("sceneplate-")
      ) {
        return false;
      }
      return b.width > 220 || b.height > 280;
    });
    if (!oversized) return;
    if (immersiveAutoCompactKeyRef.current === key) return;
    immersiveAutoCompactKeyRef.current = key;
    setBlocks((prev) => {
      const sheetUrls = collectManhuaCharacterSheetUrlById(prev, projectBible?.assetCanon);
      return layoutManhuaEpisodeReadableChain(prev, writerFocusEpisode, {
        assetCanon: projectBible?.assetCanon,
        characterSheetUrlById: sheetUrls,
        propImageUrlById: collectManhuaPropImageUrlById(customAssetRefs, projectBible?.assetCanon),
        customRefs: customAssetRefs,
      });
    });
  }, [
    immersiveWorkbench,
    writerFocusEpisode,
    projectBible?.assetCanon,
    customAssetRefs,
  ]);

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
                {canvasMode === "manhua" ? (
                  <>
                    <button
                      type="button"
                      disabled={cloudBackupBusy != null || !cloudSyncReady || factoryBusy || writerBusy}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] text-white/70 hover:bg-white/10 disabled:opacity-40"
                      title="把当前工作区手动存到云端；系统不再自动备份"
                      onClick={() => void uploadCloudBackupNow()}
                    >
                      {cloudBackupBusy === "upload" ? "备份中…" : "上传备份"}
                    </button>
                    <button
                      type="button"
                      disabled={cloudBackupBusy != null || !cloudSyncReady || factoryBusy || writerBusy}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] text-white/70 hover:bg-white/10 disabled:opacity-40"
                      title="用云端备份覆盖当前工作区（会先确认）"
                      onClick={() => void restoreCloudBackupNow()}
                    >
                      {cloudBackupBusy === "restore" ? "回填中…" : "回填备份"}
                    </button>
                  </>
                ) : null}
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
                    // 失败时函数已切开 extras 展示门禁红字——这里绝不能再关（会盖回 display:none）
                    if (!confirmWriterToDirector()) return;
                    // 成功路径函数内部已切 workbench + 关 extras；这里只负责滚动
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
                  bibleBoundEpisodes={projectBible?.cast.boundEpisodeIndexes}
                  pathTrackLabelZh={pathTrackLabelZh}
                  narrativeLightingLabelZh={narrativeLightingLabelZh}
                  pathRecipeId={factoryPathRecipeId}
                  actionRecipeId={factoryActionRecipeId}
                  onPathRecipeIdChange={(id) => {
                    setPathRecipeManual(true);
                    setFactoryPathRecipeId(id);
                  }}
                  onActionRecipeIdChange={(id) => {
                    setActionRecipeManual(true);
                    setFactoryActionRecipeId(id);
                  }}
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
                  segmentCastMismatchHintZh={
                    segmentCastMismatch
                      ? `第 ${segmentCastMismatch.segmentIndexes.join("、")} 段的${
                          segmentCastMismatch.castNames.length
                            ? `「${segmentCastMismatch.castNames.slice(0, 4).join("、")}」`
                            : "角色"
                        }在已有资产里找不到对应的图，现在出片会拿别人的脸顶上。请先在资产设定按剧本重出角色图`
                      : null
                  }
                  segmentNoFaceLockHintZh={
                    segmentNoFaceLock
                      ? `第 ${segmentNoFaceLock.segmentIndexes.join("、")} 段还没绑上任何角色定妆图${
                          segmentNoFaceLock.castNames.length
                            ? `（本段有「${segmentNoFaceLock.castNames.slice(0, 4).join("、")}」出场）`
                            : ""
                        }，现在出片不锁脸，每段都会换一张脸。请先在资产设定点「生成全部」出齐定妆图`
                      : null
                  }
                  onConfirmAssetsAndPrepareImages={confirmAssetsAndPrepareImages}
                  assetStashCount={assetStashCount}
                  onRestoreAssetStash={restoreManhuaAssetsFromStash}
                  onAdoptEpisodeSheets={() => void adoptEpisodeSheetsToMyLibrary()}
                  unadoptedSheetCount={unadoptedSheetCount}
                  onClearAssetStash={clearManhuaAssetStash}
                  onGenerateCanonAssetSheet={({ anchorId }) =>
                    confirmAssetsAndPrepareImages({ onlyAnchorId: anchorId })
                  }
                  onFillPendingSheets={(anchorIds) =>
                    confirmAssetsAndPrepareImages({ onlyAnchorIds: anchorIds })
                  }
                  libraryPickerItems={libraryPickerQuery.data?.items || []}
                  onRequestLibraryPicker={(role) =>
                    setLibraryPickerRole(role === "wardrobe" ? "prop" : role)
                  }
                  onRegenerateSheets={async ({ anchorIds, noteZh, mode, libraryImageUrl }) => {
                    if (mode === "library") {
                      await swapManhuaAssetSheetFromLibrary(anchorIds[0] || "", libraryImageUrl);
                      return;
                    }
                    await confirmAssetsAndPrepareImages({
                      regenerateAnchorIds: anchorIds,
                      regenerateNoteZh: noteZh,
                    });
                  }}
                  onRegenerateAssetsFromScript={() =>
                    void confirmAssetsAndPrepareImages({ forceRegenerate: true })
                  }
                  onPurgeStaleAssets={() => {
                    const canon = projectBible?.assetCanon;
                    if (!canon) {
                      toast.error("请先确认剧本，再清理旧图");
                      return;
                    }
                    const purged = purgeStaleCustomAssetRefsForCanon(customAssetRefs, canon, {
                      forceAllGenerated: true,
                    });
                    setCustomAssetRefs(purged.refs);
                    toast.success(
                      `已清掉 ${purged.removedCount} 张旧生成图（未生成新图、不扣费）；手动上传的参考已保留`,
                    );
                  }}
                  assetScriptStaleHintZh={assetScriptAlign.hintZh}
                  canonWriterDriftHintZh={canonWriterDriftHintZh}
                  stylePack={stylePack}
                  onStylePackChange={setStylePack}
                  customAssetRefs={customAssetRefs}
                  characterLookSets={characterLookSets}
                  onCharacterLookSetsChange={setCharacterLookSets}
                  segmentLookBindings={segmentLookBindings}
                  onSegmentLookBindingsChange={setSegmentLookBindings}
                  characterVoiceLocks={characterVoiceLocks}
                  audioReferenceLock={audioReferenceLock}
                  onAudioReferenceLockChange={(next) =>
                    setAudioReferenceLock(normalizeManhuaAudioReferenceLock(next))
                  }
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
                  onImportPropSheetFile={importPropSheetFile}
                  onCustomAssetRoleChange={setCustomAssetRole}
                  onCustomAssetDutyChange={setCustomAssetDuty}
                  onCustomAssetLabelChange={setCustomAssetLabel}
                  onCustomAssetClaimsChange={setCustomAssetClaims}
                  onCustomAssetReviewAccept={acceptCustomAssetReview}
                  onStandardizeCustomAsset={standardizeCustomAsset}
                  assetStandardizeBusyId={assetStandardizeBusyId}
                  onSegmentIntentChange={handleSegmentIntentChange}
                  onSegmentCastChange={handleSegmentCastChange}
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
                  onOpenClipDock={() => {
                    // 坞在 extras 视图里；沉浸态必须先切开再滚，对 display:none 滚动无效
                    setImmersiveExtrasOpen(true);
                    window.setTimeout(() => {
                      document
                        .getElementById("manhua-clip-dock-zone")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }, 60);
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
                        manhuaMention={manhuaCanvasMention}
                        compileManhuaRerun={compileManhuaRerun}
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
                        craftShotIds: selectedCraftShotIds,                        pathCameraRecipeIds: selectedPathRecipeIds,
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
                      // 用刷新后的 next 计数，避免闭包旧 blocks 导致「跳过张数」不准；
                      // 只认这一轮会跑的静帧，否则改选引擎后残留的旧节点会让 toast 谎报还差几张
                      const epKeys = queuedManhuaKeyartBlocks(
                        next,
                        writerFocusEpisode,
                        explicitWriterVideoModel || undefined,
                      ).filter((b) => (getBlockEpisodeIndex(b) ?? 1) === writerFocusEpisode);
                      const already = epKeys.filter((b) =>
                        Boolean(b.outputUrl || b.outputUrls?.[0]),
                      ).length;
                      const expected = Math.max(
                        epKeys.length,
                        countExpectedManhuaKeyartShots(
                          next,
                          writerFocusEpisode,
                          explicitWriterVideoModel || undefined,
                        ),
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
                  directorBoardMainUrl={
                    directorBoardMainByEpisode[writerFocusEpisode]?.url ||
                    directorBoardUrlByEpisode[writerFocusEpisode] ||
                    null
                  }
                  directorBoardBusy={
                    cropDirectorBoardMutation.isPending || assetZipBusy
                  }
                  onIngestDirectorBoardFile={async (file) => {
                    await ingestDirectorBoardFile(writerFocusEpisode, file);
                  }}
                  onClearDirectorBoard={() =>
                    setDirectorBoardMainForEpisode(writerFocusEpisode, null)
                  }
                  onCopyDirectorBoardPrompt={() => copyDirectorBoardPrompt()}
                  onImportAssetZipFile={async (file) => {
                    await importAssetZipFile(file);
                  }}
                  assetZipBusy={assetZipBusy}
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
                        propImageUrlById: collectManhuaPropImageUrlById(
                          customAssetRefs,
                          projectBible?.assetCanon,
                        ),
                        customRefs: customAssetRefs,
                        segmentPlan: segmentPlan.segments.length ? segmentPlan : null,
                        characterLookSets,
                        segmentLookBindings,
                        directorBoardUrlByEpisode,
                        videoModel: explicitWriterVideoModel || undefined,
                      };
                      const ensured = ensureManhuaFragmentClips(
                        prev,
                        edges,
                        writerFocusEpisode,
                        layoutOpts,
                      );
                      setSegmentCastMismatch(ensured.assetMismatch);
                      setSegmentNoFaceLock(ensured.assetNoFaceLock);
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
                        propImageUrlById: collectManhuaPropImageUrlById(
                          customAssetRefs,
                          projectBible?.assetCanon,
                        ),
                        customRefs: customAssetRefs,
                        segmentPlan: segmentPlan.segments.length ? segmentPlan : null,
                        characterLookSets,
                        segmentLookBindings,
                        directorBoardUrlByEpisode,
                        videoModel: explicitWriterVideoModel || undefined,
                      };
                      const ensured = ensureManhuaFragmentClips(
                        prev,
                        edges,
                        writerFocusEpisode,
                        layoutOpts,
                      );
                      setSegmentCastMismatch(ensured.assetMismatch);
                      setSegmentNoFaceLock(ensured.assetNoFaceLock);
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
                      // 工作台敲 @ 锁人/场/道时，同步把对应资产节点接到这段成片
                      const fromIds = resolveManhuaClipRelatedAssetNodeIds({
                        clipPrompt: prompt,
                        blocks: next,
                        registry: manhuaAssetMaps.registry,
                      });
                      setEdges((eds) => {
                        const synced = syncManhuaClipAssetEdges(eds, clipId, fromIds);
                        saveCanvasState(next, synced);
                        return synced;
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
                        propImageUrlById: collectManhuaPropImageUrlById(
                          customAssetRefs,
                          projectBible?.assetCanon,
                        ),
                        customRefs: customAssetRefs,
                        segmentPlan: segmentPlan.segments.length ? segmentPlan : null,
                        characterLookSets,
                        segmentLookBindings,
                        directorBoardUrlByEpisode,
                        videoModel: explicitWriterVideoModel || undefined,
                      };
                      const ensured = ensureManhuaFragmentClips(
                        prev,
                        edges,
                        writerFocusEpisode,
                        layoutOpts,
                      );
                      setSegmentCastMismatch(ensured.assetMismatch);
                      setSegmentNoFaceLock(ensured.assetNoFaceLock);
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
                      description:
                        "资产带 → 静帧左→右多列竖排（缩略）→ 段成片另起横带；右栏可点「看全图」",
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
              <div
                className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2.5"
                data-manhua-series-switch-gate
              >
                <div className="text-[11px] font-semibold text-amber-50">
                  换新剧前请先备份「先前专案」
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-amber-50/75">
                  旧剧本与人物/场景/造型多为付费生成。备份文件请用先前剧名命名，不要用正要开的新剧名。
                  正确顺序：先下载备份 → 再清空 → 最后才导入或扩写新剧。
                </p>
                <button
                  type="button"
                  disabled={writerBusy || factoryBusy}
                  onClick={() => void backupCurrentSeriesProject()}
                  className="mt-2 inline-flex items-center rounded-lg border border-amber-300/40 bg-amber-500/20 px-2.5 py-1.5 text-[11px] font-medium text-amber-50 hover:bg-amber-500/30 disabled:opacity-50"
                >
                  立即下载先前专案备份
                </button>
                <button
                  type="button"
                  disabled={writerBusy || factoryBusy}
                  onClick={() => setShowClearSeriesConfirm((v) => !v)}
                  className="mt-2 ml-1.5 inline-flex items-center rounded-lg border border-white/20 bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-medium text-white/75 hover:bg-white/[0.1] disabled:opacity-50"
                >
                  一键清空当前专案
                </button>
                {showClearSeriesConfirm ? (
                  <div className="mt-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2.5">
                    <p className="text-[10px] leading-relaxed text-red-50/85">
                      将清空旧人物/场景/道具设定与工厂链，用来消掉残留的旧占位符或换一批全新设定。此操作不可撤销（除非先备份）。
                    </p>
                    <label className="mt-2 flex items-center gap-1.5 text-[11px] text-white/75">
                      <input
                        type="checkbox"
                        checked={clearSeriesWithBackup}
                        onChange={(e) => setClearSeriesWithBackup(e.target.checked)}
                        className="h-3.5 w-3.5 accent-red-400"
                      />
                      清空前先下载备份（默认勾选，建议保留）
                    </label>
                    <div className="mt-2 flex gap-1.5">
                      <button
                        type="button"
                        disabled={writerBusy || factoryBusy}
                        onClick={() => void clearCurrentSeriesProject(clearSeriesWithBackup)}
                        className="inline-flex items-center rounded-lg border border-red-300/40 bg-red-500/25 px-2.5 py-1.5 text-[11px] font-semibold text-red-50 hover:bg-red-500/35 disabled:opacity-50"
                      >
                        确认清空
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowClearSeriesConfirm(false)}
                        className="inline-flex items-center rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/[0.06]"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="mt-3" data-manhua-seedance-layout>
                <label className="block text-[11px] text-white/45">成片引擎（必选）</label>
                <p className="mt-0.5 text-[10px] leading-4 text-white/35">
                  先选再扩写：决定一集几段、每段几秒，并写入后续铺板。
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {writerLayoutChoices.map((c) => {
                    const on = writerVideoModel === c.videoModel;
                    /**
                     * 整集价必须跟着「单集时长」档走：2.0 / 2.0-fast 选长档是 12 段，
                     * 拿 choices 里的默认 6 段算会把 2064 印成 1032。钉死段表的档不受影响。
                     */
                    const cardSegmentCount = resolveManhuaSeedanceLayoutProfile(
                      c.videoModel,
                      writerLengthTierId,
                    ).segmentCount;
                    return (
                      <button
                        key={c.videoModel}
                        type="button"
                        disabled={writerBusy || factoryBusy}
                        title={c.layoutHintZh}
                        onClick={() => {
                          if (c.videoModel === "seedance-2.5" && !canUseSeedance25) {
                            toast.error(
                              seedance25Gate.message || SEEDANCE_25_PAID_ONLY_LABEL_ZH,
                            );
                            return;
                          }
                          setWriterVideoModel(c.videoModel);
                          setWriterVideoModelPicked(true);
                          setWriterConfirmed(false);
                        }}
                        className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] disabled:opacity-50 ${
                          on
                            ? "border-cyan-300/50 bg-cyan-500/20 text-cyan-50"
                            : "border-white/12 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]"
                        }`}
                      >
                        <div className="font-semibold">{c.labelZh}</div>
                        <div className="mt-0.5 max-w-[14rem] text-[9px] leading-snug text-white/40">
                          {c.layoutHintZh}
                        </div>
                        <div className="mt-0.5 text-[9px] leading-snug text-amber-200/60">
                          {canvasVideoClipCredits({
                            isEpisodeSegment: true,
                            videoModel: c.videoModel,
                          })}{" "}
                          积分/段 · 整集约{" "}
                          {manhuaEpisodeTotalCredits({
                            videoModel: c.videoModel,
                            segmentCount: cardSegmentCount,
                          })}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {hasManhuaSeedanceLayoutChoice(writerVideoModel) ? (
                  <p className="mt-1.5 text-[10px] text-cyan-100/70">
                    已选「{writerLayoutProfile.labelZh}」· {writerLayoutProfile.layoutHintZh}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[10px] text-amber-100/70">
                    尚未选择成片引擎，无法扩写或按集铺板。
                  </p>
                )}
              </div>
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
              <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-500/[0.05] p-3">
                <label className="block text-[11px] font-semibold text-cyan-50/80">
                  剧情增强（可选）
                </label>
                {recommendedViralTemplate && recommendedViralTemplate.id !== viralTemplateId ? (
                  <button
                    type="button"
                    disabled={writerBusy || factoryBusy}
                    onClick={() => {
                      setViralTemplateId(recommendedViralTemplate.id);
                      setWriterConfirmed(false);
                    }}
                    className="mt-1.5 rounded-lg border border-amber-300/25 bg-amber-400/10 px-2.5 py-1.5 text-[10px] font-semibold text-amber-100 hover:bg-amber-400/15 disabled:opacity-50"
                  >
                    推荐：{recommendedViralTemplate.nameZh}
                  </button>
                ) : null}
                <select
                  value={viralTemplateId}
                  onChange={(e) => {
                    setViralTemplateId(e.target.value);
                    setWriterConfirmed(false);
                  }}
                  disabled={writerBusy || factoryBusy || manhuaViralTemplatesQuery.isLoading}
                  className="mt-1.5 w-full rounded-lg border border-white/12 bg-black/50 px-2.5 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                >
                  <option value="">不使用剧情增强</option>
                  {(manhuaViralTemplatesQuery.data?.groups || []).map((group) => (
                    <optgroup key={group.laneZh} label={group.laneZh}>
                      {group.items.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.nameZh}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selectedViralTemplate ? (
                  <div className="mt-2 rounded-lg border border-cyan-200/15 bg-black/25 px-2.5 py-2 text-[10px] leading-4 text-white/60">
                    <div className="font-semibold text-cyan-50/85">
                      {selectedViralTemplate.nameZh} · {selectedViralTemplate.laneZh}
                    </div>
                    <div>{selectedViralTemplate.summaryZh}</div>
                    <div className="mt-1 text-amber-100/70">具体剧情由当前大模型自由发挥。</div>
                  </div>
                ) : manhuaViralTemplatesQuery.isSuccess && approvedViralTemplateCards.length === 0 ? (
                  <p className="mt-1.5 text-[10px] text-white/35">
                    暂无可用的剧情增强方案；垃圾、待审和已拒绝内容不会显示。
                  </p>
                ) : (
                  <p className="mt-1.5 text-[10px] text-white/35">
                    只增强开场、冲突和追更钩子；题材、人物和已锁剧情始终优先。
                  </p>
                )}
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
                {manhuaSeedanceLayoutPinsSegmentTable(writerVideoModel) ? (
                  <div>
                    <label className="block text-[11px] text-white/45">段落布局</label>
                    <div className="mt-1 rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-2.5 py-2 text-xs text-cyan-50/90">
                      {writerLayoutProfile.layoutHintZh}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] text-white/45">单集时长</label>
                    <select
                      value={writerLengthTierId}
                      onChange={(e) =>
                        setWriterLengthTierId(e.target.value as ManhuaEpisodeLengthTierId)
                      }
                      disabled={writerBusy || factoryBusy || !hasManhuaSeedanceLayoutChoice(writerVideoModel)}
                      className="mt-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                    >
                      {MANHUA_EPISODE_LENGTH_TIERS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.labelZh}（{t.segmentMin}–{t.segmentMax} 段）
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-[11px] text-white/45">改写范围</label>
                  <div className="mt-1 flex items-center gap-1.5">
                    <select
                      value={writerFromEpisode}
                      onChange={(e) => {
                        setWriterFromEpisode(Number(e.target.value) || 0);
                        setWriterFromSegment(1);
                      }}
                      disabled={writerBusy || factoryBusy || !writerPack}
                      className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                    >
                      <option value={0}>全部重写</option>
                      {Array.from({ length: writerEpisodeCount }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          第 {n} 集起
                        </option>
                      ))}
                    </select>
                    {writerFromEpisode > 0 ? (
                      <select
                        value={writerFromSegment}
                        onChange={(e) => setWriterFromSegment(Number(e.target.value) || 1)}
                        disabled={writerBusy || factoryBusy}
                        className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none disabled:opacity-50"
                      >
                        {Array.from(
                          { length: writerLayoutProfile.segmentMax },
                          (_, i) => i + 1,
                        ).map((n) => (
                          <option key={n} value={n}>
                            第 {n} 段起
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap gap-1">
                    {MANHUA_WRITER_EXPAND_TIERS.map((t) => {
                      const on = writerExpandTier === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={writerBusy || factoryBusy}
                          title={t.blurb}
                          onClick={() => setWriterExpandTier(t.id)}
                          className={`rounded-md border px-2 py-1 text-[10px] font-semibold disabled:opacity-50 ${
                            on
                              ? "border-cyan-300/45 bg-cyan-500/20 text-cyan-50"
                              : "border-white/12 bg-white/[0.03] text-white/60 hover:bg-white/[0.06]"
                          }`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] leading-snug text-white/40">
                    本次扣{" "}
                    {MANHUA_WRITER_EXPAND_CREDITS_PER_EPISODE[writerExpandTier] *
                      clampWriterEpisodeCount(writerEpisodeCount)}{" "}
                    积分
                  </p>
                  <button
                    type="button"
                    disabled={
                      writerBusy ||
                      factoryBusy ||
                      !hasManhuaSeedanceLayoutChoice(writerVideoModel)
                    }
                    onClick={() => void expandWriterRoom()}
                    title={
                      !hasManhuaSeedanceLayoutChoice(writerVideoModel)
                        ? "请先选择成片引擎"
                        : writerPack
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
                    // 失败时函数已切开 extras 展示门禁红字——这里绝不能再关
                    if (!confirmWriterToDirector()) return;
                    // 成功路径函数内部已切 workbench + 关 extras；这里只负责滚动
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
                {writerFromEpisode > 0 ? (
                  <div
                    data-manhua-partial-rewrite-note
                    className="basis-full rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-[11px] leading-relaxed text-sky-50/90"
                  >
                    局部改写：第 {writerFromEpisode} 集第 {writerFromSegment} 段之前的剧本、静帧、成片全部保留不动。
                    {writerFromSegment > 1
                      ? `会把第 ${writerFromEpisode} 集旧正文交回作为约束，要求前 ${writerFromSegment - 1} 段剧情不变；模型偶有出入，改完请核对这一集前段与已有成片是否还对得上。`
                      : "起点之后已出片的段落只归档、不删除，随时可在画布上找回。"}
                    {" "}剧本若新增了人物或场景，进资产设定时会按名点出缺图的那几个。
                  </div>
                ) : null}
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
                  disabled={
                    writerBusy ||
                    factoryBusy ||
                    !writerPack ||
                    !hasManhuaSeedanceLayoutChoice(writerVideoModel)
                  }
                  onClick={confirmWriterSeriesSpawn}
                  title={
                    !hasManhuaSeedanceLayoutChoice(writerVideoModel)
                      ? "请先选择成片引擎"
                      : undefined
                  }
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
                      onClick={() => void importWriterRoomFromText(writerImportDraft)}
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
                // 分母口径必须与工厂队列一致：自动预选不算数，否则历史 2.5 画布会按 mini 算张数
                videoModel={explicitWriterVideoModel || undefined}
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
                        manhuaMention={manhuaCanvasMention}
                        compileManhuaRerun={compileManhuaRerun}
                      />
                    </div>
                  </div>
                </details>
              ) : null}
            </div>


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

                <ManhuaPathRecipePicker
                  pathRecipeId={factoryPathRecipeId}
                  actionRecipeId={factoryActionRecipeId}
                  disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                  onPathRecipeIdChange={(id) => {
                    setPathRecipeManual(true);
                    setFactoryPathRecipeId(id);
                  }}
                  onActionRecipeIdChange={(id) => {
                    setActionRecipeManual(true);
                    setFactoryActionRecipeId(id);
                  }}
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
                      artStyleId: factoryArtStyleId,                      craftShotIds: selectedCraftShotIds,
                      pathCameraRecipeIds: selectedPathRecipeIds,
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
            manhuaMention={manhuaCanvasMention}
            compileManhuaRerun={compileManhuaRerun}
          />
          </div>
          ) : null}

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
        </div>
      </main>
    </div>
  );
}
