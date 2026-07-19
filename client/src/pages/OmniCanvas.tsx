import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import FreeformCanvas from "@/components/canvas/FreeformCanvas";
import ManhuaClipDock from "@/components/canvas/ManhuaClipDock";
import type { CanvasBlock, CanvasEdge } from "@/lib/canvasTypes";
import { defaultCanvasBlock, makeCanvasBlockId, normalizeCanvasBlock } from "@/lib/canvasTypes";
import type { CanvasRunDeps } from "@/lib/canvasRunBlock";
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
  runManhuaDramaFactoryPipeline,
  sanitizeManhuaRecapUpstreamLinks,
  spawnManhuaDramaStudio,
  spawnManhuaDramaStudioSeries,
  stageKeyFromBlockId,
  type ManhuaFactoryStageKey,
} from "@/lib/canvasDramaStudio";
import {
  collectManhuaClipDockItems,
  episodeIndexesFromDockSelection,
} from "@/lib/manhuaProjectExport";
import { shouldAttachManhuaPreviouslyOn } from "@shared/manhuaEpisodeRecap";
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
  loadManhuaWriterSessionFromStorage,
  saveManhuaWriterSessionToStorage,
} from "@shared/manhuaWriterSession";
import {
  MANHUA_ASSEMBLE_MUSIC_DURATION_SEC,
  summarizeManhuaPathTrackStatus,
} from "@shared/manhuaFinalAssemble";
import { buildManhuaAssembleJobInput } from "@shared/manhuaAssembleJobInput";
import ManhuaCharacterGallery from "@/components/ManhuaCharacterGallery";
import ManhuaGuidedPathRail from "@/components/ManhuaGuidedPathRail";
import ManhuaCastStrip from "@/components/ManhuaCastStrip";
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
import { MANHUA_CINE_VOCAB_BANK } from "@shared/manhuaCineVocabBank";
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
  writerPackLooksReady,
  type ManhuaWriterPack,
} from "@shared/manhuaWriterRoom";
import { useAuth } from "@/_core/hooks/useAuth";
import { hasSupervisorAccess } from "@/lib/supervisorAccess";
import {
  MANHUA_SCREENWRITER_TERRA_MODEL,
  MANHUA_SCREENWRITER_TRANSLATE_BRIEF,
} from "@shared/manhuaScreenwriterTranslate";
import { trpc } from "@/lib/trpc";
import { Clapperboard, LayoutTemplate, Loader2, Play, Sparkles, Square, X } from "lucide-react";
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
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ blocks, edges }));
  } catch {
    /* ignore quota */
  }
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
  const [edges, setEdges] = useState<CanvasEdge[]>(initial.edges);
  const [factoryBusy, setFactoryBusy] = useState(false);
  /** 剧本工作台（逼近竞品壳）优先；可切回下方长表单编导 */
  const [manhuaUiMode, setManhuaUiMode] = useState<"workbench" | "form">(
    () => initialWriterSession?.manhuaUiMode || "workbench",
  );
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
  const [factoryWardrobeId, setFactoryWardrobeId] = useState(
    () => bootCast?.wardrobePropContinuityIds[0] || "",
  );
  const [factoryReverseMode, setFactoryReverseMode] = useState<VideoReverseOutputMode>("zh");
  /** 侧栏进阶下拉默认折叠，降低信息密度 */
  const [factoryAdvancedOpen, setFactoryAdvancedOpen] = useState(false);
  const [factoryProgress, setFactoryProgress] = useState<string>("");
  const [writerBrief, setWriterBrief] = useState(() => initialWriterSession?.brief || "");
  const [writerEpisodeCount, setWriterEpisodeCount] = useState(() =>
    clampWriterEpisodeCount(initialWriterSession?.episodeCount ?? MANHUA_WRITER_EPISODE_DEFAULT),
  );
  const [writerBusy, setWriterBusy] = useState(false);
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
  /** 工厂运行范围：焦点集（默认）或成片坞已勾选集 */
  const [factoryRunScope, setFactoryRunScope] = useState<"focus" | "dock">("focus");
  const [dockSelectedIds, setDockSelectedIds] = useState<Set<string>>(() => new Set());
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasWorkspaceMode>(() => loadCanvasWorkspaceMode());
  const [assembleBusy, setAssembleBusy] = useState(false);
  const [finalAssembleVideoUrl, setFinalAssembleVideoUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chargeWorkflowStepMutation = trpc.workflow.chargeStep.useMutation();
  const refundWorkflowStepMutation = trpc.workflow.refundStep.useMutation();

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
      const originX = blocks.reduce((m, b) => Math.max(m, b.x + b.width), 60) + 40;
      const originY = 120;
      const sheet = defaultCanvasBlock("image", originX, originY);
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

  const recommendedPath = useMemo(
    () => recommendPathCameraFromTopic(factoryTopic),
    [factoryTopic],
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
    () => recommendActionCameraFromTopic(factoryTopic),
    [factoryTopic],
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
    });
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
      `imageEngine: gpt-image-2-2026-04-21 (pinned) · nano-banana-2 fallback`,
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
          wardrobePropContinuityIds: selectedWardrobeIds,
          sceneId: factorySceneId || undefined,
          propIds: factoryPropIds,
          genreId: factoryGenreId || undefined,
          characterIds: selectedCharacterIds,
          ancientArchetypeIds: factoryAncientArchetypeIds,
          identityLockZh: factoryIdentityLockZh || castBundle.identityLockZh,
          artStyleId: factoryArtStyleId,
          videoReverseOutputMode: factoryReverseMode,
        });
        const changed = next.some((b, i) => {
          const p = prev[i];
          return (
            !p ||
            p.prompt !== b.prompt ||
            p.videoReverseOutputMode !== b.videoReverseOutputMode ||
            p.pathCameraRecipeId !== b.pathCameraRecipeId ||
            p.pathAnnotationJson !== b.pathAnnotationJson
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
    return composeWriterPackFactoryContext(writerPack, writerFocusEpisode);
  }, [writerConfirmed, writerPack, writerFocusEpisode]);

  const optimizeCopyMutation = trpc.mvAnalysis.optimizeCustomCopy.useMutation();
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

  const runDeps = useMemo<CanvasRunDeps>(
    () => ({
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
            if (!canRetry) throw e;
            await new Promise((r) => setTimeout(r, 1200 * attempt));
          }
        }
        throw lastErr instanceof Error ? lastErr : new Error("optimizeCopy failed");
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
    [optimizeCopyMutation, getSignedUrlMutation, debugMode, pushDebug],
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
        setEdges((edges) => {
          saveCanvasState(resolved, edges);
          return edges;
        });
        return resolved;
      });
    },
    [],
  );

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
          ? composeWriterPackFactoryContext(writerPack, continuity.episodeIndex)
          : writerContext;
      const hardCast =
        writerConfirmed || directorUnlocked
          ? resolveHardCastForSpawn({
              topicOverride: topic || factoryTopic,
              charactersMd: writerPack?.charactersMd,
            })
          : null;
      const spawned = spawnManhuaDramaStudio({
        originX: 60,
        originY: 80 + Math.max(0, continuity.episodeIndex - 1) * 420,
        topic,
        seriesTitle: writerPack?.seriesTitle,
        genreId: factoryGenreId || undefined,
        sceneId: factorySceneId || undefined,
        propIds: hardCast?.propIds ?? factoryPropIds,
        characterIds: hardCast?.characterIds ?? selectedCharacterIds,
        ancientArchetypeIds: hardCast?.ancientArchetypeIds ?? factoryAncientArchetypeIds,
        identityLockZh: hardCast?.identityLockZh || factoryIdentityLockZh || castBundle.identityLockZh,
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
        wardrobePropContinuityIds: hardCast?.wardrobePropContinuityIds ?? selectedWardrobeIds,
        videoReverseOutputMode: factoryReverseMode,
        writerContext: focusCtx,
        includeDirectorCraft: Boolean(focusCtx) || directorUnlocked,
        episodeIndex: continuity.episodeIndex,
        episodeTitle: continuity.episodeTitle,
        endingHook: continuity.endingHook,
        previousEndingHook: continuity.previousEndingHook,
        previouslyOnRecap: continuity.previouslyOnRecap,
      });
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
      writerContext,
      directorUnlocked,
      writerConfirmed,
      writerPack,
      writerFocusEpisode,
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
    setWriterBusy(true);
    setWriterConfirmed(false);
    setProjectBible(null);
    const t0 = Date.now();
    const count = clampWriterEpisodeCount(writerEpisodeCount);
    const designInject = [
      buildMaleHairstyleInjectBlock(selectedMaleHairstyleIds),
      buildMaleMicroExpressionInjectBlock(selectedMaleMicroIds),
    ]
      .filter(Boolean)
      .join("\n\n");
    const mergedBrief = [brief, designInject].filter(Boolean).join("\n\n");
    const reqPreview = `topic=${topic}\nepisodes=${count}\nbrief:\n${mergedBrief.slice(0, 4000)}`;
    pushDebug("expandWriterPack:start", {
      detail: `topicLen=${topic.length} briefLen=${brief.length} episodes=${count}`,
      request: reqPreview,
    });
    try {
      const res = await expandWriterMutation.mutateAsync({
        topic,
        brief: mergedBrief || undefined,
        episodeCount: count,
      });
      const pack = res.pack;
      if (!res.ready && !writerPackLooksReady(pack)) {
        toast.message("已生成草稿，建议检查每集片尾钩子是否完整");
      }
      setWriterPack(pack);
      setWriterFocusEpisode(1);
      const epDigest = pack.episodes
        .map((ep) => `第${ep.index}集·${ep.title || ""}：${String(ep.endHook || "").slice(0, 80)}`)
        .join("\n");
      pushDebug("expandWriterPack:ok", {
        level: "ok",
        ms: Date.now() - t0,
        detail: `${pack.seriesTitle || "—"} · ${pack.episodes.length}ep · ready=${Boolean(res.ready)}`,
        request: reqPreview,
        response: `${pack.seriesTitle || ""}\n${pack.logline || ""}\n${epDigest}`.slice(0, 8000),
      });
      toast.success(`已扩写 ${pack.episodes.length} 集剧情，确认后再进入编导`);
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
    expandWriterMutation,
    selectedMaleHairstyleIds,
    selectedMaleMicroIds,
    pushDebug,
  ]);

  const confirmWriterToDirector = useCallback(() => {
    if (!writerPack || !writerPackLooksReady(writerPack)) {
      toast.error("请先扩写并检查剧情包是否完整");
      return;
    }
    setWriterConfirmed(true);
    setDirectorUnlocked(true);
    const topicForSpawn = factoryTopic.trim() || writerPack.seriesTitle || writerPack.logline || "连载短剧";
    if (!factoryTopic.trim()) {
      setFactoryTopic(topicForSpawn);
    }
    // 1423：确认瞬间按剧本硬套 Cast，再铺板
    const hardCast = resolveHardCastForSpawn({
      topicOverride: topicForSpawn,
      charactersMd: writerPack.charactersMd,
    });
    const sceneForBible = factorySceneId || recommendedScene?.id || "";
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
        identityLockZh: hardCast.identityLockZh,
      },
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
    setProjectBible(bible);
    const continuity = resolveManhuaEpisodeSpawnContinuity(writerPack.episodes, writerFocusEpisode);
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
      identityLockZh: hardCast.identityLockZh,
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
      wardrobePropContinuityIds: hardCast.wardrobePropContinuityIds,
      videoReverseOutputMode: factoryReverseMode,
      writerContext: composeWriterPackFactoryContext(writerPack, continuity.episodeIndex),
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
    const next = hasOtherEpisodes
      ? replaceManhuaEpisodeChain(blocks, edges, spawned, continuity.episodeIndex)
      : spawned;
    setBlocks(next.blocks);
    setEdges(next.edges);
    saveCanvasState(next.blocks, next.edges);
    remapDockSelectionAfterSpawn(next.blocks, continuity.episodeIndex);
    const tips = [
      continuity.previousEndingHook ? "上集钩子" : null,
      continuity.previouslyOnRecap ? "前情提要" : null,
    ].filter(Boolean);
    pushDebug("confirmWriterToDirector", {
      level: "ok",
      detail: `ep=${continuity.episodeIndex} · ${summarizeManhuaProjectBible(bible)} · props=${hardCast.propIds.join(",") || "—"}`,
    });
    setManhuaUiMode("workbench");
    toast.success(
      tips.length
        ? `已确认剧情并生成专案设定；第${continuity.episodeIndex}集编导链就绪（含${tips.join("·")}）`
        : `已确认剧情并生成专案设定；第${continuity.episodeIndex}集编导链就绪`,
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
    remapDockSelectionAfterSpawn,
    pushDebug,
  ]);

  const confirmWriterSeriesSpawn = useCallback(() => {
    if (!writerPack || !writerPackLooksReady(writerPack)) {
      toast.error("请先扩写并检查剧情包是否完整");
      return;
    }
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
    const sceneForBible = factorySceneId || recommendedScene?.id || "";
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
          identityLockZh: hardCast.identityLockZh,
        },
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
      }),
    );
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
      identityLockZh: hardCast.identityLockZh,
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
      wardrobePropContinuityIds: hardCast.wardrobePropContinuityIds,
      videoReverseOutputMode: factoryReverseMode,
      episodes: episodes.map((ep) => ({
        index: ep.index,
        title: ep.title,
        endHook: ep.endHook,
        body: ep.body,
      })),
      writerContextForEpisode: (ep) => composeWriterPackFactoryContext(writerPack, ep.index),
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
    abortRef.current?.abort();
    toast.message("正在取消漫剧工厂…");
  }, []);

  const runFactory = useCallback(
    async (
      untilStage: ManhuaFactoryStageKey,
      opts?: {
        forceFromStage?: ManhuaFactoryStageKey;
        /** 按集各自续跑起点；优先于 forceFromStage */
        forceFromStageByEpisode?: Partial<Record<number, ManhuaFactoryStageKey>>;
        /** 覆盖运行范围解析出的集号列表 */
        episodeIndexes?: number[];
      },
    ) => {
      if (factoryBusy) return;
      const ac = new AbortController();
      abortRef.current = ac;
      setFactoryBusy(true);
      setFactoryProgress("准备中…");
      const runStartedAt = Date.now();
      pushDebug("factoryRun:start", {
        detail: `until=${untilStage} · force=${opts?.forceFromStage || "—"}`,
      });
      try {
        const spawned = ensureStudioSpawned(factoryTopic);
        const cleanedGraph = sanitizeManhuaRecapUpstreamLinks(spawned.blocks, spawned.edges);
        let workingBlocks = cleanedGraph.blocks;
        let workingEdges = cleanedGraph.edges;
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
        toast.message(
          untilStage === "reverse"
            ? `漫剧工厂：故事→角色→节拍→反推（第 ${episodeIndexes.join("、")} 集）`
            : untilStage === "keyart"
              ? `漫剧工厂：跑到关键静帧（第 ${episodeIndexes.join("、")} 集）`
              : `漫剧工厂全自动：含静帧 + Seedance（第 ${episodeIndexes.join("、")} 集）`,
        );
        let completed = 0;
        let skipped = 0;
        let lastError: { id: string; message: string } | null = null;
        for (const episodeIndex of episodeIndexes) {
          if (ac.signal.aborted) break;
          setFactoryProgress(`第${episodeIndex}集 · 准备…`);
          const forceFromStage =
            opts?.forceFromStageByEpisode?.[episodeIndex] ?? opts?.forceFromStage;
          const result = await runManhuaDramaFactoryPipeline({
            deps: runDeps,
            blocks: workingBlocks,
            edges: workingEdges,
            untilStage,
            episodeIndex,
            forceFromStage,
            skipDone: true,
            signal: ac.signal,
            onBlocksChange: (next) => {
              workingBlocks = next;
              setBlocks(next);
              setEdges((eds) => {
                workingEdges = eds;
                saveCanvasState(next, eds);
                return eds;
              });
            },
            onStageStart: (_id, index, total, label) => {
              if (stageStartedAtRef.current != null) {
                pushDebug("factoryStage:donePrev", {
                  level: "ok",
                  ms: Date.now() - stageStartedAtRef.current,
                });
              }
              stageStartedAtRef.current = Date.now();
              setFactoryProgress(`第${episodeIndex}集 · ${index + 1}/${total} · ${label}`);
              pushDebug("factoryStage:start", {
                detail: `ep${episodeIndex} · ${index + 1}/${total} · ${label}`,
              });
              toast.message(`第${episodeIndex}集 ${index + 1}/${total}`, { description: label });
            },
            onStageSkip: (_id, label) => {
              setFactoryProgress(`第${episodeIndex}集 · 跳过已完成 · ${label}`);
              pushDebug("factoryStage:skip", { level: "warn", detail: `ep${episodeIndex} · ${label}` });
            },
            onStageRetry: (_id, label, attempt, message) => {
              setFactoryProgress(`第${episodeIndex}集 · 重试 ${attempt} · ${label}`);
              pushDebug("factoryStage:retry", {
                level: "warn",
                detail: `ep${episodeIndex} · ${label} · attempt=${attempt} · ${message.slice(0, 160)}`,
              });
              toast.message(`瞬时失败，自动重试 ${attempt}`, {
                description: `${label}：${message.slice(0, 120)}`,
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
          if (result.errors.length) {
            lastError = result.errors[0]!;
            break;
          }
        }
        if (lastError) {
          const errStage = stageKeyFromBlockId(lastError.id);
          pushDebug("factoryRun:error", {
            level: "error",
            ms: Date.now() - runStartedAt,
            detail: `${errStage || "unknown"} · ${lastError.message || ""}`,
          });
          toast.error(
            `完成 ${completed} 段` +
              (skipped ? `、跳过 ${skipped}` : "") +
              `，中断于${errStage ? MANHUA_FACTORY_STAGE_LABEL_ZH[errStage] : "未知"}：${lastError.message || ""}`,
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
        pushDebug("factoryRun:exception", {
          level: "error",
          ms: Date.now() - runStartedAt,
          detail: msg,
        });
        toast.error(msg);
        setFactoryProgress("");
      } finally {
        abortRef.current = null;
        stageStartedAtRef.current = null;
        setFactoryBusy(false);
      }
    },
    [
      ensureStudioSpawned,
      factoryBusy,
      factoryTopic,
      runDeps,
      resolveRunEpisodeIndexes,
      pushDebug,
      selectedCharacterIds,
      selectedPathRecipeIds,
      selectedActionRecipeIds,
    ],
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

  return (
    <div className="min-h-dvh bg-transparent text-white">
      <Navbar />
      <main className="px-4 pb-10 pt-24 md:px-6">
        <div className="mx-auto max-w-[1920px]">
          <div className="mb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
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
              <div className="mt-4">
                <ManhuaFactoryDebugPanel
                  enabled={debugMode}
                  entries={debugLog}
                  injectSummary={debugInjectSummary}
                  onClear={() => setDebugLog([])}
                />
              </div>
            ) : null}
            <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">
              {canvasMode === "manhua" ? "漫剧创作" : canvasMode === "freeform" ? "自由画布" : "创作画布"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-white/65">
              {canvasMode === "pick"
                ? "先选工作方式：连载短剧走漫剧工作流；单次图/视频/文案任务走自由画布。"
                : canvasMode === "manhua"
                  ? "引导式路径：题材 → 编剧确认 → 自动套造型 → 工作台 → 静帧 → 成片 → 成片坞合成。按步骤走即可验收。"
                  : "文生图 / 文生视频 / 图生视频、提文字、文案整理等简单任务，多节点自由接线，不铺漫剧流水线。"}
            </p>

            {canvasMode === "manhua" ? (
              <ManhuaGuidedPathRail
                progress={{
                  hasTopic: Boolean(factoryTopic.trim()),
                  hasWriterPack: Boolean(writerPack),
                  writerConfirmed: Boolean(writerConfirmed),
                  hasCast: Boolean(
                    selectedCharacterIds.length ||
                      factoryAncientArchetypeIds.length ||
                      writerConfirmed,
                  ),
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
                    window.setTimeout(() => {
                      document.querySelector("#manhua-workbench-zone")?.scrollIntoView({
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
            {/* ① 题材 + 编剧室 */}
            <div
              id="manhua-factory-zone"
              className="mt-2 max-w-3xl scroll-mt-44 rounded-2xl border border-cyan-400/15 bg-gradient-to-b from-[#0c1520] via-[#0a0e18]/90 to-transparent p-4 md:p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white/90">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-400/90 text-[11px] font-bold text-black">
                    1–2
                  </span>
                  题材 · 编剧室
                </div>
                <span className="text-[11px] text-white/40">填题材 → 扩写确认 → 再进工作台</span>
              </div>
              <label className="mt-3 block text-[11px] text-white/45">题材</label>
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
                <button
                  type="button"
                  disabled={writerBusy || factoryBusy}
                  onClick={() => void expandWriterRoom()}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold disabled:opacity-50 ${
                    writerPack
                      ? "border-white/15 bg-white/[0.05] text-white/70 hover:bg-white/[0.08]"
                      : "border-cyan-300/45 bg-gradient-to-b from-cyan-400/30 to-cyan-600/25 text-cyan-50"
                  }`}
                >
                  {writerBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {writerPack ? "重新扩写" : "扩写剧情"}
                </button>
                <button
                  type="button"
                  disabled={writerBusy || factoryBusy || !writerPack}
                  onClick={() => {
                    confirmWriterToDirector();
                    setManhuaUiMode("workbench");
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
                  {writerConfirmed ? "已确认 · 回工作台" : "确认并进入工作台"}
                </button>
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

              {writerBusy ? (
                <div className="mt-3 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[11px] font-medium text-cyan-50">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在扩写连载剧情包…
                  </div>
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
                      剧情包已就绪 · 请点上方主按钮「确认并进入工作台」
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

            <div className="mt-3 flex max-w-6xl flex-wrap items-center gap-2">
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
              <span className="text-[10px] text-white/35">
                默认工作台 · 经典表单仅专家微调（灯光/运镜库等）
              </span>
            </div>

            {manhuaUiMode === "workbench" ? (
              <div id="manhua-workbench-zone" className="max-w-6xl scroll-mt-44">
                <ManhuaScriptWorkbench
                  blocks={blocks}
                  topic={factoryTopic}
                  seriesTitle={writerPack?.seriesTitle || projectBible?.seriesTitle}
                  episodeCount={writerEpisodeCount}
                  focusEpisode={writerFocusEpisode}
                  onFocusEpisode={setWriterFocusEpisode}
                  characterIds={selectedCharacterIds}
                  ancientArchetypeIds={factoryAncientArchetypeIds}
                  sceneId={factorySceneId || recommendedScene?.id}
                  propIds={factoryPropIds}
                  artStyleLabelZh={getManhuaArtStylePreset(factoryArtStyleId).labelZh}
                  projectBibleSummary={summarizeManhuaProjectBible(projectBible)}
                  bibleBoundEpisodes={projectBible?.cast.boundEpisodeIndexes}
                  pathTrackLabelZh={pathTrackStatus.labelZh}
                  narrativeLightingLabelZh={narrativeLightingLabelZh}
                  finalVideoUrl={finalAssembleVideoUrl}
                  factoryBusy={factoryBusy || assembleBusy}
                  factoryProgress={
                    assembleBusy ? "正在合成长片与配乐…" : factoryProgress || undefined
                  }
                  canRun={Boolean(directorUnlocked || writerConfirmed)}
                  onOpenCharacterCard={() => setManhuaAssetDrawer("characters")}
                  onOpenAssetWall={() => setManhuaAssetDrawer("assets")}
                  onFocusBlock={(id) => {
                    setFocusBlockId(id);
                    document
                      .getElementById("freeform-canvas-zone")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  onSpawnAndRunClip={() => {
                    setFactoryRunScope("focus");
                    ensureStudioSpawned(factoryTopic);
                    void runFactory("clip", { episodeIndexes: [writerFocusEpisode] });
                  }}
                  onRunFullAuto={() => {
                    if (!window.confirm("将按成片坞已勾选集跑完整链路（静帧 + 成片），耗时与积分较高。继续？")) {
                      return;
                    }
                    setFactoryRunScope("dock");
                    ensureStudioSpawned(factoryTopic);
                    const items = collectManhuaClipDockItems(blocks);
                    const eps = episodeIndexesFromDockSelection(items, dockSelectedIds);
                    void runFactory("clip", {
                      episodeIndexes: eps.length ? eps : [writerFocusEpisode],
                    });
                  }}
                  onResumeFromFailure={() => {
                    // 工作台：扫画布各集，不依赖异步 setScope
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
                        reasonZh={`${castBundle.reasonZh}；${recommendedArtStyle.reasonZh}${
                          castHardApplyReady
                            ? selectedCharacterIds.length || factoryAncientArchetypeIds.length
                              ? "；已按剧本硬套，将在铺板注入原型/服装/道具。点选可微调。"
                              : "；已确认编剧，可点选微调角色/画风。"
                            : "；主路径 1423：先扩写并确认编剧，再按剧本自动套造型（当前为软预览）。"
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
                      wardrobePropContinuityIds: selectedWardrobeIds,
                      videoReverseOutputMode: factoryReverseMode,
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
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/35 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-50 hover:bg-amber-500/25 disabled:opacity-50"
                  onClick={() => {
                    if (!window.confirm("将跑完整链路（静帧 + 成片），耗时与积分较高。继续？")) return;
                    void runFactory("clip");
                  }}
                >
                  {factoryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  全自动到成片
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
                  >
                    <Square className="h-3.5 w-3.5" />
                    取消
                  </button>
                ) : null}
              </div>
            </div>
            ) : null}

            <p className="mt-3 max-w-4xl text-[11px] leading-5 text-white/40">
              更高画质档位即将开放 · 文生 / 图生 / 参考生已就绪，待开放；当前成片默认约 15s。
              {" · "}
              各集成片就绪后，在下方成片坞一键合成长片（含配乐）。
            </p>

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
                onGoWorkbench={() => {
                  setManhuaUiMode("workbench");
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
                }}
                onFocusBlock={(id) => {
                  setFocusBlockId(id);
                  const hit = blocks.find((b) => b.id === id);
                  const ep = hit ? getBlockEpisodeIndex(hit) : null;
                  if (ep != null) setWriterFocusEpisode(ep);
                }}
              />
            </div>
            </>
            ) : null}
          </div>

          {canvasMode === "manhua" || canvasMode === "freeform" ? (
          <div id="freeform-canvas-zone" className="scroll-mt-24">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white/85">
                {canvasMode === "manhua" ? (
                  <>
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-[10px] font-bold text-white/50">
                      板
                    </span>
                    工厂画布节点
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-normal text-white/40">
                      专家视图
                    </span>
                  </>
                ) : (
                  "自由画布"
                )}
              </div>
              <span className="text-[11px] text-white/40">
                {canvasMode === "manhua"
                  ? "节点明细 · 日常请用上方工作台与成片坞；此处可聚焦排错"
                  : "多任务节点自由接线 · 文生图 / 视频 / 提文字 / 文案"}
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
          />
          </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
