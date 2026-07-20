/**
 * 剧本工作台：左=本集资产 · 中=片段脚本+多镜 · 右=预览 · 底=集/分镜时间线
 * 数据接工厂节点；反推后按镜展开多张静帧。
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
  X,
} from "lucide-react";
import type { CanvasBlock } from "@/lib/canvasTypes";
import {
  getBlockEpisodeIndex,
  MANHUA_FACTORY_STAGE_LABEL_ZH,
  stageKeyFromBlockId,
} from "@/lib/canvasDramaStudio";
import { getManhuaCharacterById, getManhuaCharacterPreviewUrl } from "@shared/manhuaCharacterAssetLibrary";
import { getAncientArchetypeById } from "@shared/manhuaAncientArchetypeLibrary";
import { getManhuaSceneTemplate } from "@shared/manhuaSceneAssetLibrary";
import {
  getManhuaDemoAsset,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssetsForSceneTemplate,
} from "@shared/manhuaScenePropDemoCatalog";
import {
  parseWorkbenchShotsFromText,
  resolveKeyartShotIndex,
  resolveWorkbenchShotAssetMount,
  workbenchShotTotalSec,
  type ManhuaWorkbenchShot,
} from "@shared/manhuaScriptWorkbench";
import type { ManhuaPathAnnotation } from "@shared/manhuaPathCameraAnnotate";
import { MANHUA_DRAFT_RETENTION_HINT_ZH } from "@shared/manhuaCloudDraft";
import ManhuaPathCameraAnnotatePanel from "@/components/ManhuaPathCameraAnnotatePanel";

type WorkflowPhaseId = "outline" | "assets" | "storyboard";

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
  canRun?: boolean;
  /** 剧情包已出、尚未确认编剧 */
  writerPackReady?: boolean;
  onConfirmOutline?: () => void;
  /** 资产缺图跳过（父级持久化） */
  assetsSkipped?: boolean;
  onAssetsSkippedChange?: (skipped: boolean) => void;
  /** 三阶段（父级可持久化） */
  workflowPhase?: WorkflowPhaseId;
  onWorkflowPhaseChange?: (phase: WorkflowPhaseId) => void;
  onOpenCharacterCard?: () => void;
  onOpenAssetWall?: () => void;
  /** 生成当前选中片段（该镜静帧若缺则先出 + 该片段成片） */
  onSpawnAndRunClip?: () => void;
  onGenerateFragment?: (opts: {
    shotIndex: number;
    keyartId?: string;
    clipId?: string;
  }) => void;
  /** 本集所有缺成片/质检失败的片段依次生成 */
  onGenerateMissingFragments?: (shotIndexes: number[]) => void;
  /** 成片坞已勾选集：静帧+成片连跑 */
  onRunFullAuto?: () => void;
  onResumeFromFailure?: () => void;
  /** 从编导反推强制重跑本集静帧（覆盖旧图；工作台主路径入口） */
  onRerunKeyartsFromReverse?: () => void;
  /** 只重跑当前分镜静帧，保留同集其他已完成镜头。 */
  onRerunKeyartShot?: (blockId: string, shotIndex: number) => void;
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
  canRun,
  writerPackReady,
  onConfirmOutline,
  assetsSkipped: assetsSkippedProp,
  onAssetsSkippedChange,
  workflowPhase: workflowPhaseProp,
  onWorkflowPhaseChange,
  onOpenCharacterCard,
  onOpenAssetWall,
  onSpawnAndRunClip,
  onGenerateFragment,
  onGenerateMissingFragments,
  onRunFullAuto,
  onResumeFromFailure,
  onRerunKeyartsFromReverse,
  onRerunKeyartShot,
  onFocusBlock,
  immersive = false,
  previewCanvas,
  previewCanvasToolbar,
  shotContinuity,
  onShotContinuityChange,
}: Props) {
  const dockCanvas = Boolean(previewCanvas);
  const continuity = shotContinuity || {
    keyartFromPrevStill: true,
    clipFromPrevTail: true,
  };
  const [shotIndex, setShotIndex] = useState(0);
  /** 中栏：分镜列表 | 运镜画板（主路径可见） */
  const [scriptTab, setScriptTab] = useState<"shots" | "path">("shots");
  /**
   * 右栏本集画布：未出片默认开；有成片后自动收起让出检查空间；用户可再开。
   * 镜头一多时避免画布长期占满右栏。
   */
  const [canvasDockOpen, setCanvasDockOpen] = useState(true);
  /** 运镜静帧画板：同样不常占位，有成片后默认收起 */
  const [pathBoardOpen, setPathBoardOpen] = useState(true);
  /** 胶片多选：生成所选 */
  const [selectedShotIndexes, setSelectedShotIndexes] = useState<number[]>([]);
  /** 资产缺图时可跳过进分镜（对标 C2）；可由父级持久化 */
  const [assetsSkippedLocal, setAssetsSkippedLocal] = useState(false);
  const assetsSkipped = assetsSkippedProp ?? assetsSkippedLocal;
  const setAssetsSkipped = (next: boolean) => {
    if (assetsSkippedProp === undefined) setAssetsSkippedLocal(next);
    onAssetsSkippedChange?.(next);
  };
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
            resolveKeyartShotIndex(a.id, a.prompt) - resolveKeyartShotIndex(b.id, b.prompt) ||
            a.id.localeCompare(b.id),
        ),
    [blocks, focusEpisode],
  );
  const keyart = episodeKeyarts[0];
  const legacyClip = blockByStage(blocks, focusEpisode, "clip");
  const story = blockByStage(blocks, focusEpisode, "story");

  const shots: ManhuaWorkbenchShot[] = useMemo(() => {
    const fromReverse = parseWorkbenchShotsFromText(reverse?.outputText || reverse?.prompt);
    if ((reverse?.outputText || "").trim()) return fromReverse;
    const fromBeats = parseWorkbenchShotsFromText(beats?.outputText || beats?.prompt);
    if (fromBeats.length >= 2 && (beats?.outputText || "").trim()) return fromBeats;
    return fromBeats;
  }, [beats?.outputText, beats?.prompt, reverse?.outputText, reverse?.prompt]);

  const totalSec = workbenchShotTotalSec(shots);
  const activeShot = shots[Math.min(shotIndex, Math.max(0, shots.length - 1))] || shots[0];
  const activeShotNo = activeShot?.index ?? 1;
  // 严格按镜号对齐：禁止用「列表第 N 张」顶替，避免剧本与静帧错位
  const activeKeyart =
    episodeKeyarts.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === activeShotNo) ||
    (activeShotNo === 1 ? keyart : undefined);
  const activeClip =
    episodeClips.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === activeShotNo) ||
    (activeShotNo === 1 ? legacyClip : undefined);
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

  const runGenerateFragment = () => {
    if (onGenerateFragment) {
      onGenerateFragment({
        shotIndex: activeShotNo,
        keyartId: activeKeyart?.id,
        clipId: activeClip?.id || clip?.id,
      });
      return;
    }
    onSpawnAndRunClip?.();
  };

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
    return filmstripShots
      .filter((shot) => {
        const shotClip =
          episodeClips.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === shot.index) ||
          (shot.index === 1 ? legacyClip : undefined);
        const playable = Boolean(mediaUrl(shotClip));
        const failed = shotClip?.manhuaClipQuality?.status === "failed";
        return !playable || failed;
      })
      .map((shot) => shot.index);
  }, [filmstripShots, episodeClips, legacyClip]);
  const selectedSorted = useMemo(
    () => [...selectedShotIndexes].sort((a, b) => a - b),
    [selectedShotIndexes],
  );
  const toggleShotSelected = (shotIndex: number) => {
    setSelectedShotIndexes((prev) =>
      prev.includes(shotIndex) ? prev.filter((n) => n !== shotIndex) : [...prev, shotIndex],
    );
  };
  const hasCastAssets = Boolean(
    characters.length || archetypes.length || scene || props.length,
  );
  const outlineComplete = Boolean(canRun);
  const assetsComplete = hasCastAssets || assetsSkipped;
  /** 未确认大纲，或资产未齐且未跳过 → 禁止空跑分镜成片 */
  const canGenerateFragment = outlineComplete && assetsComplete;
  const fragmentGateHint = !outlineComplete
    ? "请先确认剧本大纲"
    : !assetsComplete
      ? "请先完成资产设定，或跳过缺图后继续"
      : null;

  const stageStrip = useMemo(() => {
    const stages = ["story", "bible", "beats", "reverse", "keyart", "clip"] as const;
    return stages.map((stage) => {
      if (stage === "keyart") {
        const has = episodeKeyarts.some((b) => Boolean(mediaUrl(b)));
        return {
          stage,
          label: MANHUA_FACTORY_STAGE_LABEL_ZH[stage],
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
  }, [blocks, focusEpisode, episodeKeyarts, episodeClips, activeKeyart?.id, activeClip?.id, legacyClip?.id]);
  const workflowPhases = useMemo(() => {
    const byStage = new Map(stageStrip.map((item) => [item.stage, item]));
    // 阿硕 C2：大纲确认 → 资产（可跳过缺图）→ 分镜三栏主屏
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
        complete: Boolean(byStage.get("clip")?.has),
      },
    ];
    return definitions.map((phase, index) => ({
      ...phase,
      index: index + 1,
      current: phase.id === activePhase,
    }));
  }, [stageStrip, outlineComplete, assetsComplete, activePhase]);

  useEffect(() => {
    if (!outlineComplete && activePhase !== "outline") {
      setActivePhase("outline");
    }
  }, [outlineComplete, activePhase]);

  const selectPhase = (phase: WorkflowPhaseId) => {
    if (phase === "storyboard" && !outlineComplete) {
      setActivePhase("outline");
      return;
    }
    if (phase === "storyboard" && !assetsComplete) {
      setActivePhase("assets");
      return;
    }
    if (phase === "assets" && !outlineComplete) {
      setActivePhase("outline");
      return;
    }
    setActivePhase(phase);
  };

  const enterStoryboard = () => {
    if (!outlineComplete) {
      setActivePhase("outline");
      return;
    }
    if (!assetsComplete) {
      setAssetsSkipped(true);
    }
    setActivePhase("storyboard");
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
                第{focusEpisode}集 · {shots.length} 片段 · 约 {totalSec}s
                {artStyleLabelZh ? ` · ${artStyleLabelZh}` : ""}
              </span>
            </div>
            {immersive ? (
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/35">
                <span className="text-white/50">本集资产</span>
                <span aria-hidden>｜</span>
                <span className="text-white/50">片段脚本</span>
                <span aria-hidden>｜</span>
                <span className="text-white/50">{dockCanvas ? "本集画布" : "视频结果"}</span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-manhua-action="generate-fragment"
            disabled={!canGenerateFragment || factoryBusy || activePhase !== "storyboard"}
            onClick={runGenerateFragment}
            className="inline-flex items-center gap-1 rounded-lg border border-cyan-300/45 bg-gradient-to-b from-cyan-400/30 to-cyan-600/25 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 disabled:opacity-45"
            title={
              fragmentGateHint ||
              `只生成当前片段 ${String(activeShotNo).padStart(2, "0")}（该镜静帧+成片）`
            }
          >
            <Play className="h-3.5 w-3.5" />
            {factoryBusy ? "生成中…" : `生成片段 ${String(activeShotNo).padStart(2, "0")}`}
          </button>
          {onGenerateMissingFragments && selectedSorted.length > 0 ? (
            <button
              type="button"
              data-manhua-action="generate-selected-fragments"
              disabled={!canGenerateFragment || factoryBusy || activePhase !== "storyboard"}
              onClick={() => onGenerateMissingFragments(selectedSorted)}
              className="rounded-lg border border-cyan-300/35 bg-cyan-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-45"
              title={`依次生成已勾选片段：${selectedSorted.map((n) => String(n).padStart(2, "0")).join("、")}`}
            >
              生成所选 {selectedSorted.length}
            </button>
          ) : null}
          {onGenerateMissingFragments && missingFragmentIndexes.length > 0 ? (
            <button
              type="button"
              data-manhua-action="generate-missing-fragments"
              disabled={!canGenerateFragment || factoryBusy || activePhase !== "storyboard"}
              onClick={() => onGenerateMissingFragments(missingFragmentIndexes)}
              className="rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold text-white/75 hover:bg-white/[0.08] disabled:opacity-45"
              title={`依次生成缺成片/质检失败的片段：${missingFragmentIndexes.map((n) => String(n).padStart(2, "0")).join("、")}`}
            >
              生成缺片 {missingFragmentIndexes.length}
            </button>
          ) : null}
          {onRerunKeyartsFromReverse ? (
            <button
              type="button"
              data-manhua-action="rerun-keyarts"
              disabled={!canGenerateFragment || factoryBusy || activePhase !== "storyboard"}
              onClick={() => onRerunKeyartsFromReverse()}
              title="从编导反推重跑本集多镜静帧，覆盖右栏旧图"
              className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-amber-50 hover:bg-amber-500/25 disabled:opacity-45"
            >
              重出静帧
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
                title="B：下一镜成片承接上一镜成片末段"
              >
                成片←上镜
              </button>
            </div>
          ) : null}
          {onRunFullAuto ? (
            <button
              type="button"
              disabled={!canGenerateFragment || factoryBusy}
              onClick={() => onRunFullAuto()}
              className="rounded-lg border border-white/12 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.06] disabled:opacity-45"
            >
              全自动
            </button>
          ) : null}
          {onResumeFromFailure ? (
            <button
              type="button"
              disabled={!canGenerateFragment || factoryBusy}
              onClick={() => onResumeFromFailure()}
              title="仅从失败/未完成节点接着跑；已出的错图不会重做"
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
      {outlineComplete && !assetsComplete ? (
        <div className="shrink-0 border-b border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-50/90">
          资产未齐：请先选角色/场景，或在「资产设定」跳过缺图后再出片
        </div>
      ) : null}
      {outlineComplete && assetsSkipped && !hasCastAssets && activePhase === "storyboard" ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-400/20 bg-amber-500/[0.08] px-3 py-1.5 text-[11px] text-amber-50/85">
          <span>已跳过资产缺图，成片可能缺角色/场景一致性</span>
          <button
            type="button"
            data-manhua-action="goto-assets-from-banner"
            onClick={() => setActivePhase("assets")}
            className="shrink-0 rounded border border-amber-300/35 px-2 py-0.5 text-[10px] font-semibold text-amber-50 hover:bg-amber-500/20"
          >
            回去补资产
          </button>
        </div>
      ) : null}
      {canGenerateFragment && factoryBusy ? (
        <div
          data-manhua-status="running"
          className="shrink-0 border-b border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {factoryProgress?.trim() ? factoryProgress : "生成中…"}
          </div>
        </div>
      ) : null}

      <div
        data-manhua-workflow-rail
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/10 bg-white/[0.018] px-3 py-1.5"
      >
        <span className="mr-1 shrink-0 text-[9px] font-semibold tracking-[0.14em] text-white/30">
          工作流
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
              className={`flex min-w-[130px] flex-1 items-center gap-2 rounded-md border px-2.5 py-1 text-left ${
                phase.complete
                  ? "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-50"
                  : phase.current
                    ? "border-cyan-400/45 bg-cyan-500/[0.12] text-cyan-50"
                    : "border-white/10 bg-white/[0.025] text-white/40"
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                  phase.complete
                    ? "bg-emerald-400 text-emerald-950"
                    : phase.current
                      ? "bg-cyan-300 text-cyan-950"
                      : "bg-white/10 text-white/45"
                }`}
              >
                {phase.complete ? <CheckCircle2 className="h-3 w-3" /> : phase.index}
              </span>
              <span className="truncate text-[10px] font-semibold">{phase.label}</span>
              <span className="ml-auto shrink-0 text-[8px] opacity-60">
                {phase.complete ? "已完成" : phase.current ? "当前" : "待开始"}
              </span>
            </button>
            {index < workflowPhases.length - 1 ? (
              <span aria-hidden className="h-px w-3 shrink-0 bg-white/15" />
            ) : null}
          </div>
        ))}
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
          data-manhua-assets-skipped={assetsSkipped ? "true" : "false"}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6"
        >
          <div className="mx-auto max-w-4xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold text-white/90">资产设定</div>
                <p className="mt-1 text-[11px] leading-5 text-white/45">
                  先备角色与场景；缺图可跳过，稍后再补。刷新后仍保留跳过状态。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onOpenCharacterCard?.()}
                  className="rounded-lg border border-white/12 px-2.5 py-1.5 text-[11px] text-white/70 hover:bg-white/[0.06]"
                >
                  角色库
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAssetWall?.()}
                  className="rounded-lg border border-white/12 px-2.5 py-1.5 text-[11px] text-white/70 hover:bg-white/[0.06]"
                >
                  资产墙
                </button>
                {assetsSkipped ? (
                  <button
                    type="button"
                    data-manhua-action="unskip-assets"
                    onClick={() => setAssetsSkipped(false)}
                    className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-white/65 hover:bg-white/[0.06]"
                  >
                    撤销跳过
                  </button>
                ) : null}
                <button
                  type="button"
                  data-manhua-action="skip-assets"
                  disabled={!outlineComplete}
                  onClick={enterStoryboard}
                  className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-amber-50 disabled:opacity-45"
                >
                  {hasCastAssets ? "进入分镜视频" : "跳过缺图并继续"}
                </button>
              </div>
            </div>

            <div
              data-manhua-asset-ready
              className="mt-3 flex flex-wrap gap-1.5 text-[10px]"
            >
              <span
                className={`rounded-md border px-2 py-0.5 ${
                  characters.length || archetypes.length
                    ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-50"
                    : "border-white/10 bg-white/[0.03] text-white/40"
                }`}
              >
                角色{" "}
                {characters.length || archetypes.length
                  ? `已选 ${(characters.length || 0) + (archetypes.length || 0)}`
                  : "未选"}
                {archetypes.length ? " · 含文案造型" : ""}
              </span>
              <span
                className={`rounded-md border px-2 py-0.5 ${
                  scene
                    ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-50"
                    : "border-white/10 bg-white/[0.03] text-white/40"
                }`}
              >
                场景 {scene ? "已选" : "未选"}
                {scene && !sceneDemos.length ? " · 缺示意封面" : ""}
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
                  assetsSkipped
                    ? "border-amber-400/40 bg-amber-500/15 text-amber-50"
                    : assetsComplete
                      ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-50"
                      : "border-rose-400/30 bg-rose-500/10 text-rose-50"
                }`}
              >
                {assetsSkipped ? "已跳过缺图" : assetsComplete ? "可进分镜" : "未齐"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-white/70">
                  <span>角色 · {(characters.length || 0) + (archetypes.length || 0)}</span>
                  <span className="text-[9px] font-normal text-white/35">
                    {characters.length || archetypes.length ? "已选" : "缺"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {characters.map((c) => (
                    <button
                      key={c!.id}
                      type="button"
                      onClick={() => onOpenCharacterCard?.()}
                      className="overflow-hidden rounded-lg border border-white/12 bg-black/40 text-left"
                    >
                      <img
                        src={getManhuaCharacterPreviewUrl(c!.id)}
                        alt=""
                        className="aspect-square w-full object-cover object-top"
                        loading="lazy"
                      />
                      <div className="truncate px-1 py-0.5 text-[9px] text-white/80">
                        {c!.nameZh}
                      </div>
                    </button>
                  ))}
                  {archetypes.map((a) => (
                    <div
                      key={a!.id}
                      className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-1.5 py-2 text-[9px] text-amber-50"
                    >
                      {a!.nameZh}
                    </div>
                  ))}
                  {!characters.length && !archetypes.length ? (
                    <button
                      type="button"
                      onClick={() => onOpenCharacterCard?.()}
                      className="col-span-3 rounded-lg border border-dashed border-white/15 px-2 py-6 text-[10px] text-white/40"
                    >
                      尚未选角色 · 点开角色库
                    </button>
                  ) : null}
                </div>
              </section>
              <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 text-[11px] font-semibold text-white/70">场景</div>
                {scene ? (
                  <div className="overflow-hidden rounded-lg border border-white/12">
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
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenAssetWall?.()}
                    className="w-full rounded-lg border border-dashed border-white/15 px-2 py-8 text-[10px] text-white/40"
                  >
                    尚未选场景 · 点开资产墙
                  </button>
                )}
              </section>
              <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 text-[11px] font-semibold text-white/70">
                  道具 · {props.length}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {props.map((p) => (
                    <button
                      key={p!.id}
                      type="button"
                      onClick={() => onOpenAssetWall?.()}
                      className="overflow-hidden rounded-lg border border-white/12 bg-black/40 text-left"
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
                      道具可选 · 缺图可跳过
                    </button>
                  ) : null}
                </div>
              </section>
            </div>
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
            <div className="text-[12px] font-semibold text-white/85">
              片段 {String(Math.min(shotIndex + 1, Math.max(shots.length, 1))).padStart(2, "0")}
              {story?.episodeTitle ? ` · ${story.episodeTitle}` : ""}
              <span className="ml-2 font-normal text-white/40">
                {activeShot?.durationSec ?? 5}s · 镜 {activeShot?.index ?? "—"}/{shots.length || 1}
              </span>
            </div>
            <div className="flex gap-1 rounded-lg border border-white/10 bg-black/30 p-0.5">
              <button
                type="button"
                data-manhua-script-tab="shots"
                onClick={() => setScriptTab("shots")}
                className={`rounded-md px-2.5 py-1 text-[10px] font-semibold ${
                  scriptTab === "shots"
                    ? "bg-white/12 text-white"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                分镜
              </button>
              <button
                type="button"
                data-manhua-script-tab="path"
                onClick={() => setScriptTab("path")}
                className={`rounded-md px-2.5 py-1 text-[10px] font-semibold ${
                  scriptTab === "path"
                    ? "bg-sky-500/25 text-sky-50"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                运镜
              </button>
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

              <div className="mt-2 shrink-0 text-[11px] font-semibold text-white/70">
                分镜（{shots.length}）· 当前第 {activeShot?.index ?? "—"} 镜
              </div>
              <div className="mt-1.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                {shots.map((shot, i) => {
                  const on = i === Math.min(shotIndex, shots.length - 1);
                  const shotKey =
                    episodeKeyarts.find(
                      (b) => resolveKeyartShotIndex(b.id, b.prompt) === shot.index,
                    ) || episodeKeyarts[i];
                  const thumb = mediaUrl(shotKey);
                  return (
                    <div
                      key={shot.index}
                      data-manhua-shot={shot.index}
                      data-manhua-active={on ? "true" : "false"}
                      data-manhua-keyart-url={thumb || ""}
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
                        <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/50">
                          {thumb ? (
                            <img src={thumb} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[9px] text-white/30">
                              {String(shot.index).padStart(2, "0")}
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
                          <div className="mt-0.5 text-[10px] text-cyan-100/70">{shot.cameraZh}</div>
                          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/70">
                            {shot.actionZh}
                          </div>
                        </div>
                      </button>
                      {shotKey?.id && onRerunKeyartShot ? (
                        <button
                          type="button"
                          data-manhua-action="rerun-shot"
                          disabled={!canGenerateFragment || factoryBusy}
                          onClick={() => onRerunKeyartShot(shotKey.id, shot.index)}
                          className="flex w-11 shrink-0 flex-col items-center justify-center gap-1 border-l border-white/10 text-[9px] text-amber-100/75 hover:bg-amber-500/10 disabled:opacity-35"
                          title={`只重出第 ${shot.index} 镜，保留其他镜头`}
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
                先出静帧 → 切「运镜」画蓝/红线 → 顶栏「生成片段」。只跑当前镜，其他片段保留。
              </p>
            </>
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
                  尚无本片段静帧。可先「生成片段」出静帧，或切回分镜点「单镜」重出。
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
              ) : clipQuality?.status === "failed" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/45 bg-rose-500/15 px-2 py-0.5 text-[9px] font-semibold text-rose-100">
                  <AlertTriangle className="h-3 w-3" />
                  质检未通过
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
              className={`flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-lg border bg-black ${
                finalVideoUrl || previewIsVideo
                  ? "border-cyan-400/45"
                  : factoryBusy
                    ? "border-amber-400/35"
                    : "border-white/12"
              }`}
            >
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
                      : "点「生成」后，静帧 / 成片在此预览"}
                </div>
              )}
            </div>
          ) : null}
          <div
            data-manhua-clip-quality={clipQuality?.status || "idle"}
            className={`mt-2 shrink-0 rounded-lg border px-2.5 py-2 ${
              clipQuality?.status === "passed"
                ? "border-emerald-400/25 bg-emerald-500/[0.07]"
                : clipQuality?.status === "failed"
                  ? "border-rose-400/30 bg-rose-500/[0.08]"
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
                      clipQuality.status === "passed" ? "可进入成片坞" : "已拦截"
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
                          ? "bg-rose-500/12 text-rose-100"
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
              <p className="mt-1.5 line-clamp-3 text-[9px] leading-relaxed text-rose-100/75">
                {clipQuality.summary}
                {/文字|设定卡|姓名条|字幕|重出静帧/.test(clipQuality.summary || "")
                  ? " → 请先重出静帧再生成片段。"
                  : ""}
              </p>
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
                disabled={!canGenerateFragment || factoryBusy}
                onClick={() => onRerunKeyartsFromReverse()}
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
                  缺 {missingFragmentIndexes.length} 片
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
                  onClick={() => setSelectedShotIndexes(missingFragmentIndexes)}
                  className="rounded border border-white/12 px-1.5 py-0.5 text-[9px] text-white/55 hover:bg-white/[0.06] disabled:opacity-35"
                >
                  勾选缺片
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
              const shotKey =
                episodeKeyarts.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === shot.index) ||
                episodeKeyarts[i];
              const shotClip =
                episodeClips.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === shot.index) ||
                (shot.index === 1 ? legacyClip : undefined);
              const thumb = mediaUrl(shotKey);
              const clipPassed =
                shotClip?.status === "done" &&
                shotClip.manhuaClipQuality?.status === "passed" &&
                Boolean(mediaUrl(shotClip));
              const clipFailed = shotClip?.manhuaClipQuality?.status === "failed";
              const statusLabel = clipPassed
                ? "成片"
                : clipFailed
                  ? "质检失败"
                  : thumb
                    ? "静帧"
                    : "待出";
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
                          : clipFailed
                            ? "border-rose-400/40"
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
                      clipPassed ? "clip" : clipFailed ? "qc-failed" : thumb ? "keyart" : "idle"
                    }
                    onClick={() => setShotIndex(i)}
                    className="block w-full text-left"
                  >
                    <div className="aspect-video bg-black/70">
                      {thumb ? (
                        <img src={thumb} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-0.5 text-white/30">
                          <span className="text-[11px] font-semibold">
                            {String(shot.index).padStart(2, "0")}
                          </span>
                          <span className="text-[8px]">待出</span>
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
                                : "bg-black/65 text-white/55"
                        }`}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-1 py-0.5 text-[9px] text-white/65">
                      <span>片段 {String(shot.index).padStart(2, "0")}</span>
                      <span className="text-white/40">{dur.toFixed(1)}s</span>
                    </div>
                  </button>
                  {needsRetry && onGenerateFragment ? (
                    <button
                      type="button"
                      data-manhua-action="retry-fragment"
                      data-manhua-retry-shot={shot.index}
                      disabled={!canGenerateFragment || factoryBusy || activePhase !== "storyboard"}
                      onClick={() => {
                        setShotIndex(i);
                        onGenerateFragment({
                          shotIndex: shot.index,
                          keyartId: shotKey?.id,
                          clipId: shotClip?.id,
                        });
                      }}
                      className="w-full border-t border-white/10 bg-white/[0.04] py-0.5 text-[8px] font-semibold text-cyan-100/80 hover:bg-cyan-500/15 disabled:opacity-35"
                      title={`只重跑片段 ${String(shot.index).padStart(2, "0")}`}
                    >
                      重跑此片
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
