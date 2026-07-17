import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import FreeformCanvas from "@/components/canvas/FreeformCanvas";
import type { CanvasBlock, CanvasEdge } from "@/lib/canvasTypes";
import { normalizeCanvasBlock } from "@/lib/canvasTypes";
import type { CanvasRunDeps } from "@/lib/canvasRunBlock";
import {
  MANHUA_FACTORY_STAGE_LABEL_ZH,
  MANHUA_FACTORY_STAGE_ORDER,
  applyFactoryPrefsToBlocks,
  applyTopicToFactoryStory,
  resolveFactoryResumeStage,
  runManhuaDramaFactoryPipeline,
  spawnManhuaDramaStudio,
  stageKeyFromBlockId,
  type ManhuaFactoryStageKey,
} from "@/lib/canvasDramaStudio";
import {
  listScreenwriterGenres,
  MANHUA_SCENE_GENRE_LABEL_ZH,
  recommendManhuaSceneIdFromTopic,
} from "@shared/screenwriterGenreTemplates";
import { getManhuaSceneTemplate, listManhuaScenes } from "@shared/manhuaSceneAssetLibrary";
import {
  getManhuaCharacterById,
  listManhuaCharactersByGender,
  recommendManhuaCharactersFromTopic,
} from "@shared/manhuaCharacterAssetLibrary";
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
import type { VideoReverseOutputMode } from "@shared/videoReversePrompt";
import {
  MANHUA_WRITER_EPISODE_DEFAULT,
  MANHUA_WRITER_EPISODE_MAX,
  MANHUA_WRITER_EPISODE_MIN,
  buildManhuaWriterExpandPrompt,
  clampWriterEpisodeCount,
  composeWriterPackFactoryContext,
  parseManhuaWriterPack,
  writerPackLooksReady,
  type ManhuaWriterPack,
} from "@shared/manhuaWriterRoom";
import { trpc } from "@/lib/trpc";
import { Clapperboard, Loader2, Play, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";

function extractGeminiScriptText(json: unknown): string {
  const j = json as {
    text?: string;
    raw?: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  };
  return String(j?.raw?.candidates?.[0]?.content?.parts?.[0]?.text || j?.text || "").trim();
}

const LS_KEY = "mv-freeform-canvas-v1";

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

export default function OmniCanvas() {
  const initial = useMemo(() => loadCanvasState(), []);
  const [blocks, setBlocks] = useState<CanvasBlock[]>(initial.blocks);
  const [edges, setEdges] = useState<CanvasEdge[]>(initial.edges);
  const [factoryBusy, setFactoryBusy] = useState(false);
  const [factoryTopic, setFactoryTopic] = useState("");
  const [factoryGenreId, setFactoryGenreId] = useState("");
  const [factorySceneId, setFactorySceneId] = useState("");
  /** 手选场景后不再被题材自动覆盖（⑤D） */
  const [sceneManual, setSceneManual] = useState(false);
  const [factoryFemaleId, setFactoryFemaleId] = useState("");
  const [factoryMaleId, setFactoryMaleId] = useState("");
  /** 用户手选后不再被题材自动覆盖（4.B） */
  const [femaleLeadManual, setFemaleLeadManual] = useState(false);
  const [maleLeadManual, setMaleLeadManual] = useState(false);
  const [factoryMotionId, setFactoryMotionId] = useState("");
  const [factoryCraftShotId, setFactoryCraftShotId] = useState("");
  /** 手选手法后不再被题材自动覆盖 */
  const [craftShotManual, setCraftShotManual] = useState(false);
  const [motionManual, setMotionManual] = useState(false);
  const [factoryReverseMode, setFactoryReverseMode] = useState<VideoReverseOutputMode>("zh");
  const [factoryProgress, setFactoryProgress] = useState<string>("");
  const [writerBrief, setWriterBrief] = useState("");
  const [writerEpisodeCount, setWriterEpisodeCount] = useState(MANHUA_WRITER_EPISODE_DEFAULT);
  const [writerBusy, setWriterBusy] = useState(false);
  const [writerPack, setWriterPack] = useState<ManhuaWriterPack | null>(null);
  const [writerConfirmed, setWriterConfirmed] = useState(false);
  const [writerFocusEpisode, setWriterFocusEpisode] = useState(1);
  const [directorUnlocked, setDirectorUnlocked] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const genreOptions = useMemo(() => listScreenwriterGenres({ onlyReady: true }), []);
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

  const femaleLeadOptions = useMemo(() => listManhuaCharactersByGender("female"), []);
  const maleLeadOptions = useMemo(() => listManhuaCharactersByGender("male"), []);
  const recommendedLeads = useMemo(
    () => recommendManhuaCharactersFromTopic(factoryTopic),
    [factoryTopic],
  );
  const selectedFemale = useMemo(
    () => (factoryFemaleId ? getManhuaCharacterById(factoryFemaleId) : null),
    [factoryFemaleId],
  );
  const selectedMale = useMemo(
    () => (factoryMaleId ? getManhuaCharacterById(factoryMaleId) : null),
    [factoryMaleId],
  );
  const femaleAutoApplied =
    !femaleLeadManual && Boolean(factoryFemaleId) && factoryFemaleId === recommendedLeads.femaleId;
  const maleAutoApplied =
    !maleLeadManual && Boolean(factoryMaleId) && factoryMaleId === recommendedLeads.maleId;

  useEffect(() => {
    if (!femaleLeadManual && recommendedLeads.femaleId) {
      setFactoryFemaleId(recommendedLeads.femaleId);
    }
    if (!maleLeadManual && recommendedLeads.maleId) {
      setFactoryMaleId(recommendedLeads.maleId);
    }
  }, [recommendedLeads.femaleId, recommendedLeads.maleId, femaleLeadManual, maleLeadManual]);

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

  /** 已铺工厂板时：手法/动效/场景/反推档（已铺可同步）变更同步进节点，不必整板重铺（短防抖） */
  useEffect(() => {
    const hasFactory = blocks.some((b) => MANHUA_FACTORY_STAGE_ORDER.some((s) => b.id.startsWith(`${s}-`)));
    if (!hasFactory || factoryBusy) return;
    const timer = window.setTimeout(() => {
      setBlocks((prev) => {
        const next = applyFactoryPrefsToBlocks(prev, {
          craftShotIds: selectedCraftShotIds,
          motionPromptIds: selectedMotionIds,
          sceneId: factorySceneId || undefined,
          genreId: factoryGenreId || undefined,
          characterIds: selectedCharacterIds,
          videoReverseOutputMode: factoryReverseMode,
        });
        const changed = next.some((b, i) => {
          const p = prev[i];
          return (
            !p ||
            p.prompt !== b.prompt ||
            p.videoReverseOutputMode !== b.videoReverseOutputMode
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
    factorySceneId,
    factoryGenreId,
    factoryFemaleId,
    factoryMaleId,
    factoryReverseMode,
    selectedCraftShotIds,
    selectedMotionIds,
    selectedCharacterIds,
  ]);
  const motionGrouped = useMemo(() => {
    const cats: MotionPromptCategory[] = ["logo", "product_ad", "data", "caption"];
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

  const runDeps = useMemo<CanvasRunDeps>(
    () => ({
      optimizeCopy: async ({ sourceText, optimizationBrief }) => {
        const res = await optimizeCopyMutation.mutateAsync({ sourceText, optimizationBrief });
        return res.result.optimizedMarkdown;
      },
    }),
    [optimizeCopyMutation],
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
    return MANHUA_FACTORY_STAGE_ORDER.map((stage) => {
      const b = blocks.find((x) => x.id.startsWith(`${stage}-`));
      return {
        stage,
        label: MANHUA_FACTORY_STAGE_LABEL_ZH[stage],
        status: b?.status || ("idle" as const),
      };
    });
  }, [blocks]);

  const ensureStudioSpawned = useCallback(
    (topic?: string) => {
      const hasFactory = ["story", "bible", "beats"].every((s) =>
        blocks.some((b) => b.id.startsWith(`${s}-`)),
      );
      if (hasFactory) {
        const nextBlocks = topic ? applyTopicToFactoryStory(blocks, topic) : blocks;
        if (topic) {
          setBlocks(nextBlocks);
          saveCanvasState(nextBlocks, edges);
        }
        return { blocks: nextBlocks, edges };
      }
      const spawned = spawnManhuaDramaStudio({
        originX: 60,
        originY: 80,
        topic,
        genreId: factoryGenreId || undefined,
        sceneId: factorySceneId || undefined,
        characterIds: selectedCharacterIds,
        motionPromptIds: selectedMotionIds,
        craftShotIds: selectedCraftShotIds,
        videoReverseOutputMode: factoryReverseMode,
        writerContext,
        includeDirectorCraft: Boolean(writerContext) || directorUnlocked,
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
      setBlocks(spawned.blocks);
      setEdges(spawned.edges);
      saveCanvasState(spawned.blocks, spawned.edges);
      return spawned;
    },
    [
      blocks,
      edges,
      factoryGenreId,
      factorySceneId,
      selectedCharacterIds,
      selectedMotionIds,
      selectedCraftShotIds,
      factoryReverseMode,
      writerContext,
      directorUnlocked,
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
      const prompt = buildManhuaWriterExpandPrompt({ topic, brief, episodeCount: count });
      const resp = await fetch("/api/google?op=geminiScript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model: "gemini-3.1-pro-preview" }),
      });
      const json = await resp.json();
      if (!resp.ok || !json?.ok) {
        throw new Error(String(json?.error || json?.message || "扩写失败，请稍后重试"));
      }
      const text = extractGeminiScriptText(json);
      if (text.length < 80) throw new Error("扩写结果过短，请再试一次");
      const pack = parseManhuaWriterPack(text, count);
      if (!writerPackLooksReady(pack)) {
        toast.message("已生成草稿，建议检查每集片尾钩子是否完整");
      }
      setWriterPack(pack);
      setWriterFocusEpisode(1);
      toast.success(`已扩写 ${pack.episodes.length} 集剧情，确认后再进入编导`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "扩写失败");
    } finally {
      setWriterBusy(false);
    }
  }, [factoryTopic, writerBrief, writerEpisodeCount]);

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
    const spawned = spawnManhuaDramaStudio({
      originX: 60,
      originY: 80,
      topic: factoryTopic.trim() || writerPack.seriesTitle,
      genreId: factoryGenreId || undefined,
      sceneId: factorySceneId || undefined,
      characterIds: selectedCharacterIds,
      motionPromptIds: selectedMotionIds,
      craftShotIds: selectedCraftShotIds,
      videoReverseOutputMode: factoryReverseMode,
      writerContext: composeWriterPackFactoryContext(writerPack, writerFocusEpisode),
      includeDirectorCraft: true,
    });
    if (spawned.genreInferred && spawned.resolvedGenreId && !factoryGenreId) {
      setFactoryGenreId(spawned.resolvedGenreId);
    }
    setBlocks(spawned.blocks);
    setEdges(spawned.edges);
    saveCanvasState(spawned.blocks, spawned.edges);
    toast.success("已确认剧情，编导分镜链路已就绪");
  }, [
    writerPack,
    factoryTopic,
    selectedCharacterIds,
    selectedMotionIds,
    selectedCraftShotIds,
    factoryReverseMode,
    factoryGenreId,
    factorySceneId,
    writerFocusEpisode,
  ]);

  const stopFactory = useCallback(() => {
    abortRef.current?.abort();
    toast.message("正在取消漫剧工厂…");
  }, []);

  const runFactory = useCallback(
    async (untilStage: ManhuaFactoryStageKey, opts?: { forceFromStage?: ManhuaFactoryStageKey }) => {
      if (factoryBusy) return;
      const ac = new AbortController();
      abortRef.current = ac;
      setFactoryBusy(true);
      setFactoryProgress("准备中…");
      try {
        const spawned = ensureStudioSpawned(factoryTopic);
        toast.message(
          untilStage === "reverse"
            ? "漫剧工厂：故事→角色→节拍→反推"
            : untilStage === "keyart"
              ? "漫剧工厂：跑到关键静帧"
              : "漫剧工厂全自动：含静帧 + Seedance（约 15s）",
        );
        const result = await runManhuaDramaFactoryPipeline({
          deps: runDeps,
          blocks: spawned.blocks,
          edges: spawned.edges,
          untilStage,
          forceFromStage: opts?.forceFromStage,
          skipDone: true,
          signal: ac.signal,
          onBlocksChange: (next) => {
            setBlocks(next);
            setEdges((eds) => {
              saveCanvasState(next, eds);
              return eds;
            });
          },
          onStageStart: (_id, index, total, label) => {
            setFactoryProgress(`${index + 1}/${total} · ${label}`);
            toast.message(`工厂 ${index + 1}/${total}`, { description: label });
          },
          onStageSkip: (_id, label) => {
            setFactoryProgress(`跳过已完成 · ${label}`);
          },
          onStageRetry: (_id, label, attempt, message) => {
            setFactoryProgress(`重试 ${attempt} · ${label}`);
            toast.message(`瞬时失败，自动重试 ${attempt}`, {
              description: `${label}：${message.slice(0, 120)}`,
            });
          },
        });
        if (result.errors.length) {
          const errStage = stageKeyFromBlockId(result.errors[0]!.id);
          toast.error(
            `完成 ${result.completedIds.length} 段` +
              (result.skippedIds.length ? `、跳过 ${result.skippedIds.length}` : "") +
              `，中断于${errStage ? MANHUA_FACTORY_STAGE_LABEL_ZH[errStage] : "未知"}：${result.errors[0]?.message || ""}`,
          );
        } else {
          toast.success(
            `漫剧工厂完成：新跑 ${result.completedIds.length}` +
              (result.skippedIds.length ? ` · 跳过 ${result.skippedIds.length}` : ""),
          );
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
    [ensureStudioSpawned, factoryBusy, factoryTopic, runDeps],
  );

  const resumeFromFailure = useCallback(() => {
    const stage = resolveFactoryResumeStage(blocks);
    if (!stage) {
      toast.message("六段都已完成，无需续跑");
      return;
    }
    toast.message(`从「${MANHUA_FACTORY_STAGE_LABEL_ZH[stage]}」续跑`);
    void runFactory("clip", { forceFromStage: stage });
  }, [blocks, runFactory]);

  return (
    <div className="min-h-dvh bg-transparent text-white">
      <Navbar />
      <main className="px-4 pb-10 pt-24 md:px-6">
        <div className="mx-auto max-w-[1920px]">
          <div className="mb-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
              <Clapperboard className="h-3.5 w-3.5" />
              自由画布 · 编剧室 · 编导分镜
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Gemini Omini 创作画布</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-white/65">
              先扩写连载剧情并确认人物场景，再进入编导分镜与成片。每集片尾都会留钩子。
            </p>

            {/* ① 编剧室 */}
            <div className="mt-5 max-w-3xl rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-transparent p-4 md:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-white/90">① 编剧室</div>
                <span className="text-[11px] text-white/40">题材 + 三到五句条件 → 连载剧情包</span>
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

            {/* ② 编导工厂：确认或跳过后解锁 */}
            <div
              className={`mt-4 max-w-3xl rounded-2xl border p-4 md:p-5 ${
                directorUnlocked || writerConfirmed
                  ? "border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent"
                  : "border-white/5 bg-white/[0.02] opacity-70"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-white/90">② 编导分镜</div>
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

              <div className="mt-3 space-y-2 sm:max-w-md">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-white/55">男女主（角色库）</span>
                  {(femaleAutoApplied || maleAutoApplied) && (
                    <span className="rounded-md border border-emerald-400/35 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] text-emerald-100">
                      已按题材自动套用 · 可更换
                    </span>
                  )}
                  {(femaleLeadManual || maleLeadManual) && (
                    <button
                      type="button"
                      disabled={factoryBusy}
                      onClick={() => {
                        setFemaleLeadManual(false);
                        setMaleLeadManual(false);
                      }}
                      className="text-[10px] text-sky-200/80 underline-offset-2 hover:underline disabled:opacity-40"
                    >
                      恢复自动推荐
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div
                    className={`rounded-lg border px-2.5 py-2 ${
                      femaleAutoApplied
                        ? "border-cyan-400/40 bg-cyan-500/8"
                        : "border-cyan-400/20 bg-black/40"
                    }`}
                  >
                    <label className="block text-[11px] text-cyan-200/70">女主（已铺可同步）</label>
                    <select
                      value={factoryFemaleId}
                      onChange={(e) => {
                        setFemaleLeadManual(true);
                        setFactoryFemaleId(e.target.value);
                      }}
                      disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                      className="mt-1 w-full rounded-md border border-white/10 bg-black/50 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-cyan-300/40 disabled:opacity-50"
                    >
                      <option value="">不指定</option>
                      {femaleLeadOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nameZh} · {c.jobZh}
                        </option>
                      ))}
                    </select>
                    {selectedFemale ? (
                      <p className="mt-1.5 text-[10px] leading-snug text-cyan-100/70">
                        {selectedFemale.temperamentTags.join(" · ")}
                        {femaleAutoApplied ? " · 自动" : femaleLeadManual ? " · 手选" : ""}
                      </p>
                    ) : null}
                  </div>
                  <div
                    className={`rounded-lg border px-2.5 py-2 ${
                      maleAutoApplied
                        ? "border-amber-400/40 bg-amber-500/8"
                        : "border-amber-400/20 bg-black/40"
                    }`}
                  >
                    <label className="block text-[11px] text-amber-200/70">男主（已铺可同步）</label>
                    <select
                      value={factoryMaleId}
                      onChange={(e) => {
                        setMaleLeadManual(true);
                        setFactoryMaleId(e.target.value);
                      }}
                      disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                      className="mt-1 w-full rounded-md border border-white/10 bg-black/50 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-amber-300/40 disabled:opacity-50"
                    >
                      <option value="">不指定</option>
                      {maleLeadOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nameZh} · {c.jobZh}
                        </option>
                      ))}
                    </select>
                    {selectedMale ? (
                      <p className="mt-1.5 text-[10px] leading-snug text-amber-100/70">
                        {selectedMale.temperamentTags.join(" · ")}
                        {maleAutoApplied ? " · 自动" : maleLeadManual ? " · 手选" : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
                <p className="text-[10px] leading-snug text-emerald-200/75">
                  {recommendedLeads.reasonZh}
                  {selectedCharacterIds.length
                    ? "；已选将注入「角色卡」节点（外形锚点 + 提示词）。"
                    : ""}
                </p>
              </div>

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

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={factoryBusy || !(directorUnlocked || writerConfirmed)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-50 hover:bg-rose-500/25 disabled:opacity-50"
                  onClick={() => {
                    const spawned = spawnManhuaDramaStudio({
                      originX: 60,
                      originY: 80,
                      topic: factoryTopic,
                      genreId: factoryGenreId || undefined,
                      sceneId: factorySceneId || undefined,
                      characterIds: selectedCharacterIds,
                      motionPromptIds: selectedMotionIds,
                      craftShotIds: selectedCraftShotIds,
                      videoReverseOutputMode: factoryReverseMode,
                      writerContext,
                      includeDirectorCraft: true,
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
                    toast.success("已铺好编导节点（含视频改写）");
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
            </p>
          </div>

          <FreeformCanvas
            blocks={blocks}
            edges={edges}
            onBlocksChange={handleBlocksChange}
            onEdgesChange={handleEdgesChange}
            runDeps={runDeps}
          />
        </div>
      </main>
    </div>
  );
}
