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
  recommendManhuaCharactersFromTopic,
  type ManhuaArtStyleId,
  type ManhuaCharacterGender,
} from "@shared/manhuaCharacterAssetLibrary";
import ManhuaCharacterGallery from "@/components/ManhuaCharacterGallery";
import ManhuaAssetWall from "@/components/ManhuaAssetWall";
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
import {
  listPathCameraRecipes,
  recommendPathCameraFromTopic,
} from "@shared/manhuaPathCameraRecipeBank";
import {
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
import type { ManhuaPathAnnotation } from "@shared/manhuaPathCameraAnnotate";
import ManhuaPathCameraAnnotatePanel from "@/components/ManhuaPathCameraAnnotatePanel";
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
import { trpc } from "@/lib/trpc";
import { Clapperboard, LayoutTemplate, Loader2, Play, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";

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

export default function OmniCanvas() {
  const initial = useMemo(() => loadCanvasState(), []);
  const initialFactoryPrefs = useMemo(() => loadFactoryCharacterPrefs(), []);
  const [blocks, setBlocks] = useState<CanvasBlock[]>(initial.blocks);
  const [edges, setEdges] = useState<CanvasEdge[]>(initial.edges);
  const [factoryBusy, setFactoryBusy] = useState(false);
  const [factoryTopic, setFactoryTopic] = useState(initialFactoryPrefs.topic || "");
  const [factoryGenreId, setFactoryGenreId] = useState("");
  const [factorySceneId, setFactorySceneId] = useState("");
  /** 资产墙点选的道具示范（最多 4） */
  const [factoryPropIds, setFactoryPropIds] = useState<string[]>([]);
  /** 手选场景后不再被题材自动覆盖（⑤D） */
  const [sceneManual, setSceneManual] = useState(false);
  const [factoryFemaleId, setFactoryFemaleId] = useState(initialFactoryPrefs.femaleId || "");
  const [factoryMaleId, setFactoryMaleId] = useState(initialFactoryPrefs.maleId || "");
  /** 用户手选后不再被题材自动覆盖（4.B） */
  const [femaleLeadManual, setFemaleLeadManual] = useState(Boolean(initialFactoryPrefs.femaleLeadManual));
  const [maleLeadManual, setMaleLeadManual] = useState(Boolean(initialFactoryPrefs.maleLeadManual));
  const [factoryArtStyleId, setFactoryArtStyleId] = useState<ManhuaArtStyleId>(
    initialFactoryPrefs.artStyleId || DEFAULT_MANHUA_ART_STYLE_ID,
  );
  const [artStyleManual, setArtStyleManual] = useState(Boolean(initialFactoryPrefs.artStyleManual));
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
  const [factoryReverseMode, setFactoryReverseMode] = useState<VideoReverseOutputMode>("zh");
  const [factoryProgress, setFactoryProgress] = useState<string>("");
  const [writerBrief, setWriterBrief] = useState("");
  const [writerEpisodeCount, setWriterEpisodeCount] = useState(MANHUA_WRITER_EPISODE_DEFAULT);
  const [writerBusy, setWriterBusy] = useState(false);
  const [writerPack, setWriterPack] = useState<ManhuaWriterPack | null>(null);
  const [writerConfirmed, setWriterConfirmed] = useState(false);
  const [writerFocusEpisode, setWriterFocusEpisode] = useState(1);
  const [directorUnlocked, setDirectorUnlocked] = useState(false);
  /** 工厂运行范围：焦点集（默认）或成片坞已勾选集 */
  const [factoryRunScope, setFactoryRunScope] = useState<"focus" | "dock">("focus");
  const [dockSelectedIds, setDockSelectedIds] = useState<Set<string>>(() => new Set());
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasWorkspaceMode>(() => loadCanvasWorkspaceMode());
  const abortRef = useRef<AbortController | null>(null);

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

  const recommendedLeads = useMemo(
    () => recommendManhuaCharactersFromTopic(factoryTopic),
    [factoryTopic],
  );
  const femaleAutoApplied =
    !femaleLeadManual && Boolean(factoryFemaleId) && factoryFemaleId === recommendedLeads.femaleId;
  const maleAutoApplied =
    !maleLeadManual && Boolean(factoryMaleId) && factoryMaleId === recommendedLeads.maleId;
  const recommendedArtStyle = useMemo(
    () => recommendManhuaArtStyleFromTopic(factoryTopic),
    [factoryTopic],
  );
  const artStyleAutoApplied =
    !artStyleManual && factoryArtStyleId === recommendedArtStyle.artStyleId;

  useEffect(() => {
    if (!femaleLeadManual && recommendedLeads.femaleId) {
      setFactoryFemaleId(recommendedLeads.femaleId);
    }
    if (!maleLeadManual && recommendedLeads.maleId) {
      setFactoryMaleId(recommendedLeads.maleId);
    }
  }, [recommendedLeads.femaleId, recommendedLeads.maleId, femaleLeadManual, maleLeadManual]);

  useEffect(() => {
    if (!artStyleManual) {
      setFactoryArtStyleId(recommendedArtStyle.artStyleId);
    }
  }, [recommendedArtStyle.artStyleId, artStyleManual]);

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
      sheet.imageModel = "nano-banana-2";
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

  useEffect(() => {
    if (!pathRecipeManual && recommendedPath.recipeId) {
      setFactoryPathRecipeId(recommendedPath.recipeId);
    }
  }, [recommendedPath.recipeId, pathRecipeManual]);

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
          sceneId: factorySceneId || undefined,
          propIds: factoryPropIds,
          genreId: factoryGenreId || undefined,
          characterIds: selectedCharacterIds,
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
    factorySceneId,
    factoryPropIds,
    factoryGenreId,
    factoryFemaleId,
    factoryMaleId,
    factoryArtStyleId,
    factoryReverseMode,
    selectedCraftShotIds,
    selectedMotionIds,
    selectedPathRecipeIds,
    selectedNarrativeLightingIds,
    selectedMaleHairstyleIds,
    selectedMaleMicroIds,
    selectedPromoLayoutIds,
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

  const runDeps = useMemo<CanvasRunDeps>(
    () => ({
      optimizeCopy: async ({ sourceText, optimizationBrief, modelName }) => {
        const res = await optimizeCopyMutation.mutateAsync({
          sourceText,
          optimizationBrief,
          modelName,
        });
        return res.result.optimizedMarkdown;
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
    [optimizeCopyMutation, getSignedUrlMutation],
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
      const spawned = spawnManhuaDramaStudio({
        originX: 60,
        originY: 80 + Math.max(0, continuity.episodeIndex - 1) * 420,
        topic,
        seriesTitle: writerPack?.seriesTitle,
        genreId: factoryGenreId || undefined,
        sceneId: factorySceneId || undefined,
        propIds: factoryPropIds,
        characterIds: selectedCharacterIds,
        artStyleId: factoryArtStyleId,
        motionPromptIds: selectedMotionIds,
        craftShotIds: selectedCraftShotIds,
        pathCameraRecipeIds: selectedPathRecipeIds,
        pathAnnotationJson: factoryPathAnnotation,
        narrativeLightingIds: selectedNarrativeLightingIds,
        maleHairstyleIds: selectedMaleHairstyleIds,
        maleMicroExpressionIds: selectedMaleMicroIds,
        promoCoverLayoutIds: selectedPromoLayoutIds,
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
      selectedCharacterIds,
      selectedMotionIds,
      selectedCraftShotIds,
      selectedPathRecipeIds,
      factoryPathAnnotation,
      selectedNarrativeLightingIds,
      selectedMaleHairstyleIds,
      selectedMaleMicroIds,
      selectedPromoLayoutIds,
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
    try {
      const count = clampWriterEpisodeCount(writerEpisodeCount);
      const designInject = [
        buildMaleHairstyleInjectBlock(selectedMaleHairstyleIds),
        buildMaleMicroExpressionInjectBlock(selectedMaleMicroIds),
      ]
        .filter(Boolean)
        .join("\n\n");
      const mergedBrief = [brief, designInject].filter(Boolean).join("\n\n");
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
      toast.success(`已扩写 ${pack.episodes.length} 集剧情（GPT-5.6 Pro），确认后再进入编导`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "扩写失败");
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
  ]);

  const confirmWriterToDirector = useCallback(() => {
    if (!writerPack || !writerPackLooksReady(writerPack)) {
      toast.error("请先扩写并检查剧情包是否完整");
      return;
    }
    setWriterConfirmed(true);
    setDirectorUnlocked(true);
    if (!factoryTopic.trim()) {
      setFactoryTopic(writerPack.seriesTitle || writerPack.logline || "连载短剧");
    }
    const continuity = resolveManhuaEpisodeSpawnContinuity(writerPack.episodes, writerFocusEpisode);
    const spawned = spawnManhuaDramaStudio({
      originX: 60,
      originY: 80 + Math.max(0, continuity.episodeIndex - 1) * 420,
      topic: factoryTopic.trim() || writerPack.seriesTitle,
      seriesTitle: writerPack.seriesTitle,
      genreId: factoryGenreId || undefined,
      sceneId: factorySceneId || undefined,
      propIds: factoryPropIds,
      characterIds: selectedCharacterIds,
      artStyleId: factoryArtStyleId,
      motionPromptIds: selectedMotionIds,
      craftShotIds: selectedCraftShotIds,
      pathCameraRecipeIds: selectedPathRecipeIds,
      pathAnnotationJson: factoryPathAnnotation,
      narrativeLightingIds: selectedNarrativeLightingIds,
      maleHairstyleIds: selectedMaleHairstyleIds,
      maleMicroExpressionIds: selectedMaleMicroIds,
      promoCoverLayoutIds: selectedPromoLayoutIds,
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
    toast.success(
      tips.length
        ? `已确认剧情，焦点集编导链已就绪（含${tips.join("·")}）`
        : "已确认剧情，编导分镜链路已就绪（焦点集）",
    );
  }, [
    writerPack,
    factoryTopic,
    selectedCharacterIds,
    selectedMotionIds,
    selectedCraftShotIds,
    factoryArtStyleId,
    factoryReverseMode,
    factoryGenreId,
    factorySceneId,
    factoryPropIds,
    writerFocusEpisode,
    blocks,
    edges,
    remapDockSelectionAfterSpawn,
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
    if (!factoryTopic.trim()) {
      setFactoryTopic(writerPack.seriesTitle || writerPack.logline || "连载短剧");
    }
    const spawned = spawnManhuaDramaStudioSeries({
      originX: 60,
      originY: 80,
      topic: factoryTopic.trim() || writerPack.seriesTitle,
      seriesTitle: writerPack.seriesTitle,
      genreId: factoryGenreId || undefined,
      sceneId: factorySceneId || undefined,
      propIds: factoryPropIds,
      characterIds: selectedCharacterIds,
      artStyleId: factoryArtStyleId,
      motionPromptIds: selectedMotionIds,
      craftShotIds: selectedCraftShotIds,
      pathCameraRecipeIds: selectedPathRecipeIds,
      pathAnnotationJson: factoryPathAnnotation,
      narrativeLightingIds: selectedNarrativeLightingIds,
      maleHairstyleIds: selectedMaleHairstyleIds,
      maleMicroExpressionIds: selectedMaleMicroIds,
      promoCoverLayoutIds: selectedPromoLayoutIds,
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
    selectedCharacterIds,
    selectedMotionIds,
    selectedCraftShotIds,
    factoryArtStyleId,
    factoryReverseMode,
    factoryGenreId,
    factorySceneId,
    factoryPropIds,
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
              setFactoryProgress(`第${episodeIndex}集 · ${index + 1}/${total} · ${label}`);
              toast.message(`第${episodeIndex}集 ${index + 1}/${total}`, { description: label });
            },
            onStageSkip: (_id, label) => {
              setFactoryProgress(`第${episodeIndex}集 · 跳过已完成 · ${label}`);
            },
            onStageRetry: (_id, label, attempt, message) => {
              setFactoryProgress(`第${episodeIndex}集 · 重试 ${attempt} · ${label}`);
              toast.message(`瞬时失败，自动重试 ${attempt}`, {
                description: `${label}：${message.slice(0, 120)}`,
              });
            },
          });
          workingBlocks = result.blocks;
          completed += result.completedIds.length;
          skipped += result.skippedIds.length;
          if (result.errors.length) {
            lastError = result.errors[0]!;
            break;
          }
        }
        if (lastError) {
          const errStage = stageKeyFromBlockId(lastError.id);
          toast.error(
            `完成 ${completed} 段` +
              (skipped ? `、跳过 ${skipped}` : "") +
              `，中断于${errStage ? MANHUA_FACTORY_STAGE_LABEL_ZH[errStage] : "未知"}：${lastError.message || ""}`,
          );
        } else {
          toast.success(`漫剧工厂完成：新跑 ${completed}` + (skipped ? ` · 跳过 ${skipped}` : ""));
        }
        setFactoryProgress("");
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "漫剧工厂失败");
        setFactoryProgress("");
      } finally {
        abortRef.current = null;
        setFactoryBusy(false);
      }
    },
    [ensureStudioSpawned, factoryBusy, factoryTopic, runDeps, resolveRunEpisodeIndexes],
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
            <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">
              {canvasMode === "manhua" ? "漫剧创作" : canvasMode === "freeform" ? "自由画布" : "创作画布"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-white/65">
              {canvasMode === "pick"
                ? "先选工作方式：连载短剧走漫剧工作流；单次图/视频/文案任务走自由画布。"
                : canvasMode === "manhua"
                  ? "编剧室扩写 → 确认后铺板 → 静帧与成片。画布区承载工厂节点，可按集续跑。"
                  : "文生图 / 文生视频 / 图生视频、提文字、文案整理等简单任务，多节点自由接线，不铺漫剧流水线。"}
            </p>

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
                    展开完整工作流：题材扩写（GPT-5.6 Pro）→ 编导确认 → 铺板跑静帧与成片。适合竖屏连载短剧。
                  </p>
                  <span className="mt-4 inline-block text-[12px] font-medium text-emerald-200/90">进入漫剧工作流 →</span>
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
            {/* ① 编剧室 */}
            <div
              id="manhua-factory-zone"
              className="mt-5 max-w-3xl scroll-mt-28 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-transparent p-4 md:p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-white/90">① 编剧室 · 漫剧工厂</div>
                <span className="text-[11px] text-white/40">题材 + 条件 → GPT-5.6 Pro 连载包</span>
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
              <div className="mt-3 flex flex-wrap items-end gap-3">
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
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/20 px-3.5 py-2 text-xs font-semibold text-emerald-50 hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  {writerBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  扩写剧情
                </button>
                <button
                  type="button"
                  disabled={writerBusy || factoryBusy || !writerPack}
                  onClick={confirmWriterToDirector}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-sky-400/35 bg-sky-500/15 px-3.5 py-2 text-xs font-semibold text-sky-50 hover:bg-sky-500/25 disabled:opacity-50"
                >
                  确认并进入编导
                </button>
                <button
                  type="button"
                  disabled={writerBusy || factoryBusy || !writerPack}
                  onClick={confirmWriterSeriesSpawn}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-violet-400/35 bg-violet-500/15 px-3.5 py-2 text-xs font-semibold text-violet-50 hover:bg-violet-500/25 disabled:opacity-50"
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
                  className="text-[11px] text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
                >
                  跳过连载扩写
                </button>
              </div>

              {writerPack ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-white">{writerPack.seriesTitle}</div>
                    {writerPack.logline ? (
                      <div className="text-[11px] text-white/50">{writerPack.logline}</div>
                    ) : null}
                    {writerConfirmed ? (
                      <span className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100">
                        已确认
                      </span>
                    ) : null}
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

            {/* ② 角色卡：始终可预览/换人/选画风（不烧 token；不依赖编剧解锁） */}
            <div className="mt-4 max-w-4xl rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent p-4 md:p-5">
              {factoryGenreId ? (
                <p className="mb-3 text-[10px] leading-snug text-white/45">
                  题材已选：角色与画风会软推荐；手选后点「恢复自动推荐」可再跟题材走。切换题材不烧 token。
                </p>
              ) : (
                <p className="mb-3 text-[10px] leading-snug text-white/40">
                  可先选上方题材，再在此换人/定画风；未选题材时也可自由点选角色库。
                </p>
              )}
              <ManhuaCharacterGallery
                femaleId={factoryFemaleId}
                maleId={factoryMaleId}
                femaleAutoApplied={femaleAutoApplied}
                maleAutoApplied={maleAutoApplied}
                artStyleId={factoryArtStyleId}
                artStyleAutoApplied={artStyleAutoApplied}
                disabled={factoryBusy}
                topicHint={[factoryGenreLabel, factoryTopic].filter(Boolean).join(" ")}
                reasonZh={`${recommendedLeads.reasonZh}；${recommendedArtStyle.reasonZh}${
                  selectedCharacterIds.length
                    ? "；已选将在「铺编导节点」时注入角色卡。预览/换人/画风/铺同版式节点均不烧 token。"
                    : "；预览与换人不烧 token。"
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
                onClearManual={() => {
                  setFemaleLeadManual(false);
                  setMaleLeadManual(false);
                  setArtStyleManual(false);
                }}
              />

              <div className="mt-4">
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
                    setFactoryPropIds((prev) => {
                      if (prev.includes(id)) return prev.filter((x) => x !== id);
                      return [...prev, id].slice(-4);
                    });
                  }}
                />
              </div>
            </div>

            {/* ③ 编导工厂：确认或跳过后解锁 */}
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
                <p className="mt-1.5 text-[10px] leading-snug text-emerald-200/80">
                  当前推荐主场景：{String(recommendedScene.no).padStart(2, "0")} {recommendedScene.nameZh}
                  {sceneAutoApplied ? " ·自动" : sceneManual ? " ·手选" : ""}
                  {recommendedSceneRec.reasonZh ? ` · ${recommendedSceneRec.reasonZh}` : ""}
                  （未手选时自动套；已铺板更换会同步进节点，可下拉手选）
                </p>
              ) : (
                <p className="mt-1.5 text-[10px] text-white/35">
                  填写题材或选手动剧种后，将按关键词自动推荐一条主场景（如「秘境」→ 洞府）。
                </p>
              )}

              <div className="mt-3 max-w-md space-y-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="block text-[11px] text-white/45">拍摄手法（已铺可同步）（可选 · 1 条）</label>
                    {craftAutoApplied ? (
                      <span className="rounded-md border border-emerald-400/35 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] text-emerald-100">
                        已按题材自动套用
                      </span>
                    ) : null}
                    {craftShotManual ? (
                      <button
                        type="button"
                        disabled={factoryBusy}
                        onClick={() => setCraftShotManual(false)}
                        className="text-[10px] text-sky-200/80 underline-offset-2 hover:underline disabled:opacity-40"
                      >
                        恢复自动推荐
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
                  <p className="mt-1 text-[10px] leading-snug text-violet-100/70">
                    {recommendedCraft.reasonZh}
                    {selectedCraftShot
                      ? ` · 当前「${selectedCraftShot.nameZh}」${craftAutoApplied ? "·自动" : craftShotManual ? "·手选" : ""}`
                      : ""}
                    ；注入节拍 / 反推 / 静帧。
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] text-white/45">路径运镜配方（可选 · 1 条）</label>
                  <select
                    value={factoryPathRecipeId}
                    onChange={(e) => {
                      setPathRecipeManual(true);
                      setFactoryPathRecipeId(e.target.value);
                    }}
                    disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                    className="mt-1 w-full rounded-lg border border-cyan-400/25 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none focus:border-cyan-300/40 disabled:opacity-50"
                  >
                    <option value="">不指定</option>
                    {listPathCameraRecipes().map((e) => (
                      <option key={e.id} value={e.id}>
                        {String(e.no).padStart(2, "0")} {e.nameZh}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-cyan-100/60">{recommendedPath.reasonZh}</p>
                </div>
                <ManhuaPathCameraAnnotatePanel
                  imageUrl={keyArtPreviewUrl || undefined}
                  value={factoryPathAnnotation}
                  recipeId={factoryPathRecipeId}
                  disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                  onChange={setFactoryPathAnnotation}
                  onRecipeIdChange={(id) => {
                    setPathRecipeManual(true);
                    setFactoryPathRecipeId(id);
                  }}
                />
                <div>
                  <label className="block text-[11px] text-white/45">叙事灯光（可选 · 1 条）</label>
                  <select
                    value={factoryNarrativeLightingId}
                    onChange={(e) => {
                      setNarrativeLightingManual(true);
                      setFactoryNarrativeLightingId(e.target.value);
                    }}
                    disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                    className="mt-1 w-full rounded-lg border border-amber-400/25 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none focus:border-amber-300/40 disabled:opacity-50"
                  >
                    <option value="">不指定</option>
                    {listNarrativeLighting().map((e) => (
                      <option key={e.id} value={e.id}>
                        {String(e.no).padStart(2, "0")} {e.nameZh} · {e.stageZh}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-amber-100/60">{recommendedNarrativeLighting.reasonZh}</p>
                </div>
                <div>
                  <label className="block text-[11px] text-white/45">男发预设（可选 · 注入圣经）</label>
                  <select
                    value={factoryMaleHairstyleId}
                    onChange={(e) => setFactoryMaleHairstyleId(e.target.value)}
                    disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none focus:border-white/25 disabled:opacity-50"
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
                  <label className="block text-[11px] text-white/45">男生微表情（可选）</label>
                  <select
                    value={factoryMaleMicroId}
                    onChange={(e) => {
                      setMaleMicroManual(true);
                      setFactoryMaleMicroId(e.target.value);
                    }}
                    disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none focus:border-white/25 disabled:opacity-50"
                  >
                    <option value="">不指定</option>
                    {listMaleMicroExpressions().map((e) => (
                      <option key={e.id} value={e.id}>
                        {String(e.no).padStart(2, "0")} {e.nameZh}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-white/35">{recommendedMaleMicro.reasonZh}</p>
                </div>
                <div>
                  <label className="block text-[11px] text-white/45">宣发封面构图（可选 · 额外节点）</label>
                  <select
                    value={factoryPromoLayoutId}
                    onChange={(e) => setFactoryPromoLayoutId(e.target.value)}
                    disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                    className="mt-1 w-full rounded-lg border border-fuchsia-400/25 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none focus:border-fuchsia-300/40 disabled:opacity-50"
                  >
                    <option value="">不铺宣发封面</option>
                    {listPromoCoverLayouts().map((e) => (
                      <option key={e.id} value={e.id}>
                        {String(e.no).padStart(2, "0")} {e.nameZh}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-fuchsia-100/55">人景双重曝光等构图；不改六栏分镜主路径。</p>
                </div>
                <div>
                  <label className="block text-[11px] text-white/45">反推输出档</label>
                  <select
                    value={factoryReverseMode}
                    onChange={(e) => setFactoryReverseMode(e.target.value as VideoReverseOutputMode)}
                    disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none focus:border-white/25 disabled:opacity-50"
                  >
                    <option value="zh">完整中文八维</option>
                    <option value="compact">精简档</option>
                    <option value="en">English</option>
                  </select>
                  <p className="mt-1 text-[10px] text-white/30">写入编导反推节点输出结构。</p>
                </div>
                <div>
                  <label className="block text-[11px] text-white/45">包装动效（已铺可同步）（可选 · 1 条）</label>
                  <select
                    value={factoryMotionId}
                    onChange={(e) => {
                      setMotionManual(true);
                      setFactoryMotionId(e.target.value);
                    }}
                    disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white/90 outline-none focus:border-white/25 disabled:opacity-50"
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
                  <p className="mt-1 text-[10px] leading-snug text-white/45">
                    {recommendedMotion.reasonZh}
                    {motionManual ? " · 手选锁定" : ""}
                    ；注入微动成片 / 视频改写。
                  </p>
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
                      artStyleId: factoryArtStyleId,
                      motionPromptIds: selectedMotionIds,
                      craftShotIds: selectedCraftShotIds,
                      pathCameraRecipeIds: selectedPathRecipeIds,
                      pathAnnotationJson: factoryPathAnnotation,
                      narrativeLightingIds: selectedNarrativeLightingIds,
                      maleHairstyleIds: selectedMaleHairstyleIds,
                      maleMicroExpressionIds: selectedMaleMicroIds,
                      promoCoverLayoutIds: selectedPromoLayoutIds,
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

            <p className="mt-3 max-w-3xl text-[11px] leading-5 text-amber-100/70">
              <span className="font-semibold text-amber-100/90">Seedance 2.5 Coming soon</span>
              {" · "}
              文生 / 图生 / 参考生已就绪，待开放；当前 Seedance 2.0（默认 15s）。
              {" · "}
              工程包导出为素材 zip，不含自动拼接长片。
            </p>

            <div className="mt-4 max-w-3xl">
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
              <div className="text-sm font-semibold text-white/85">
                {canvasMode === "manhua" ? "工厂画布节点" : "自由画布"}
              </div>
              <span className="text-[11px] text-white/40">
                {canvasMode === "manhua"
                  ? "漫剧流水线铺出的节点 · 可点选聚焦"
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
