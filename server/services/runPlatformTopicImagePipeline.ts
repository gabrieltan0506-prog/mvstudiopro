/**
 * 平台单帧生图（GPT 5.4 → GPT-IMAGE-2 → 兜底）——供 tRPC 同步调用与 jobs worker 共用，避免重复实现。
 */
import { eq } from "drizzle-orm";
import * as db from "../db";
import { patchJobRunningProgress } from "../jobs/repository.js";
import {
  type PlatformImagePromptTranslator,
} from "./geminiPlatformCompositeTranslation.js";
import {
  appendStagingCoverToFlowLog,
  buildCoverChineseBlobForStaging,
  finalizeCoverChineseStagingForTranslation,
  persistCoverChineseStagingToRunningJob,
} from "./platformImageChineseStaging.js";
import { estimateCoverCtrBand } from "../../shared/platformTitleVariants.js";

/** 與 repository patch 截斷一致，避免單欄位過大 */
const FLOW_LOG_DB_CAP = 240;

function attachTopicImageProgressWriter(
  flowLog: string[],
  jobId: string | null | undefined,
): { flushNow: () => Promise<void> } {
  if (!jobId) {
    return { flushNow: async () => {} };
  }
  const debounceMs = 800;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const writeBody = async () => {
    await patchJobRunningProgress(jobId, {
      imageGenFlowLog: flowLog.slice(-FLOW_LOG_DB_CAP),
      progressUpdatedAt: new Date().toISOString(),
    });
  };
  const schedule = () => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void writeBody();
    }, debounceMs);
  };
  const origPush = flowLog.push.bind(flowLog);
  flowLog.push = (...items: string[]) => {
    const r = origPush(...items);
    schedule();
    return r;
  };
  return {
    flushNow: async () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      await writeBody();
    },
  };
}

function classifyPlatformTopicFrameStatus(url: string | null | undefined): "completed" | "failed" | "timeout" {
  const u = String(url ?? "").trim();
  if (!u) return "failed";
  const l = u.toLowerCase();
  if (l.includes("timeout")) return "timeout";
  if (l.includes("error")) return "failed";
  return "completed";
}

export type ImagePromptStats = {
  translatedPromptChars: number;
  translatedPromptWords: number;
  condensedPromptChars: number;
  condensedPromptWords: number;
  condenseTriggered: boolean;
};

export type RunPlatformTopicImagePipelineInput = {
  topicHook: string;
  format?: "短视频" | "图文";
  context?: string;
  coverPersonaContext?: string;
  sceneId?: string;
  /** 與 topicHook 同源的開場鉤子（簡中），供點擊率檔位估計 */
  appealHook?: string;
  /** @deprecated 封面單幀英文化**固定 GPT 5.4**；保留欄位僅兼容舊 job 入參，會被忽略。 */
  imagePromptTranslator?: PlatformImagePromptTranslator;
  creationIdOut: number | null | undefined;
  isFreeRetry: boolean;
  newJobMetaBase: Record<string, unknown>;
  /** 異步 jobs worker 傳 job.id：管線執行中節流寫入 jobs.output.imageGenFlowLog，前端輪詢可見步驟 */
  progressJobId?: string | null;
  /** 管理員專用：單幀主生圖改為 Vertex Nano Banana 2（9:16 · 官方 API；與主路徑共用光影語彙）。`nano_banana_pro` 為舊別名，行為相同。 */
  coverProEngine?: "nano_banana_2" | "nano_banana_pro";
  /**
   * 管理員於 Platform 頁開啟並經 tRPC/job 為 true；與環境 `PLATFORM_TOPIC_COVER_DEEP_RESEARCH_PRO` / `PLATFORM_COVER_DEEP_RESEARCH_PRO` **OR**：任一為真即跑步驟 0.5。
   */
  enableTopicCoverDeepResearchPro?: boolean;
  /**
   * 可選第二條選題（由 job `drProSecondarySceneId` 等服端填入）：啟用 DR-Pro 時跑 **雙條** Interaction（內部並行 + 失敗條可再試）；
   * **僅當兩條均**產出有效簡報時才注入主條 DR；**任一條失敗/逾時**則**整段不注入** DR，改由主選題快照語境 + GPT 5.4（不採單條殘報）。
   */
  drProSecondaryCoverInputs?: { topicHook: string; context?: string };
};

export type RunPlatformTopicImagePipelineResult = {
  success: boolean;
  imageUrl: string | null;
  url: string | null;
  freeRetryApplied: boolean;
  creationId: number | undefined;
  imageGenFlowLog: string[];
  imagePromptStats: ImagePromptStats;
  fallbackUsed: boolean;
  /** 基於主句+鉤子的規則估計（非實測 CTR） */
  coverClickEstimate?: {
    band: "high" | "medium";
    score: number;
    labelZh: string;
  };
};

export async function runPlatformTopicImagePipeline(
  input: RunPlatformTopicImagePipelineInput,
): Promise<RunPlatformTopicImagePipelineResult> {
  const useVertexNb2Cover =
    input.coverProEngine === "nano_banana_2" || input.coverProEngine === "nano_banana_pro";
  const title = String(input.topicHook || "").trim().slice(0, 80);
  const sid = String(input.sceneId ?? "").trim();
  void input.imagePromptTranslator;
  const imagePromptTranslator: PlatformImagePromptTranslator = "gpt54";
  const translatorLogLabel = "GPT 5.4（OpenAI）";
  const isGraphic = input.format === "图文";
  const mode = isGraphic ? "GRAPHIC" : "STORYBOARD";
  const creationIdOut = input.creationIdOut ?? undefined;
  const database = await db.getDb();
  const { userCreations } = await import("../../drizzle/schema-creations.js");

  const {
    buildPlatformTopicReferenceGeminiTask,
    callGemini31ProForImagePrompt,
    extractChineseVisualBrief,
  } = await import("./geminiPlatformCompositeTranslation.js");
  const {
    buildCoverTaskInputFromPipeline,
    isPlatformCoverAgenticBrainEnabled,
    runAgenticCoverStrategist,
  } = await import("./agenticCoverWorkflow.js");
  const {
    isTopicCoverDeepResearchProEnabled,
    runCoverDeepResearchBriefPreferDual,
  } = await import("./coverDeepResearchProBrief.js");
  const {
    buildImagePromptStats,
    generateImageGpt2WithImagenFallback,
    generateGptImage2FromRawEnglishPrompt,
    condenseImagePromptIfNeeded,
    generatePlatformTopicCoverNanoBanana2FromEnglishPrompt,
    generatePlatformTopicTypographyNanoBanana2Only,
  } = await import("./proxyImageService.js");

  const ctxStr = String(input.context || "").trim();
  const coverPersona = String(input.coverPersonaContext || "").trim();
  const briefSource = [coverPersona, String(input.topicHook || "").trim(), ctxStr].filter(Boolean).join("\n\n");
  const copywriting = [
    coverPersona ? `【封面身份锚点】\n${coverPersona}` : "",
    ctxStr ? `${input.topicHook}\n${ctxStr}` : input.topicHook,
  ]
    .filter(Boolean)
    .join("\n\n");

  const topicImageCondenseLog: string[] = [];
  const { flushNow: flushTopicImageProgress } = attachTopicImageProgressWriter(
    topicImageCondenseLog,
    input.progressJobId ?? null,
  );

  try {
    topicImageCondenseLog.push(
      `${new Date().toISOString()}  ──────── 单张「${String(input.topicHook || title || "Untitled").slice(0, 48)}」· sceneId=${sid || "N/A"} ────────`,
    );
    topicImageCondenseLog.push(
      `${new Date().toISOString()}  [主路径] buildPlatformTopicReferenceGeminiTask（variant=${isGraphic ? "graphic" : "video"}）→ callGemini31ProForImagePrompt(${translatorLogLabel}) → ${
        useVertexNb2Cover
          ? "Vertex Nano Banana 2（9:16·2K）→ 无图则 GPT-IMAGE-2 · 仍无图则版式+NB2"
          : "generateGptImage2FromRawEnglishPrompt 9:16"
      }`,
    );
    topicImageCondenseLog.push(
      `${new Date().toISOString()}  说明: ${
        useVertexNb2Cover
          ? "监管 Vertex 封面：英文化 GPT 5.4；出图主路径 Nano Banana 2（2K）→ 无图则 fal→OhMyGPT→NB2（标准链）→ 仍无图则版式+NB2"
          : "中文语境供翻译模型吸收；产出一条英文视觉指令；GPT-IMAGE-2 只读英文；画内简中字由英文指令约束"
      }`,
    );

    let promptStats: ImagePromptStats = {
      translatedPromptChars: 0,
      translatedPromptWords: 0,
      condensedPromptChars: 0,
      condensedPromptWords: 0,
      condenseTriggered: false,
    };
    let fallbackUsed = false;
    let imageUrl: string | null = null;
    /** 步骤1 成功后写入，供步骤3 NB2 失败后走 GPT-IMAGE-2（同一条英文 prompt） */
    let lastSafePrompt: string | null = null;

    let strategistChinesePrompt: string | null = null;
    if (isPlatformCoverAgenticBrainEnabled()) {
      topicImageCondenseLog.push(
        `${new Date().toISOString()}  [步骤0·企划大脑] PLATFORM_COVER_AGENTIC_BRAIN 开启 → Vertex 中文企划（失败则降级原链路）`,
      );
      try {
        const taskIn = buildCoverTaskInputFromPipeline({
          topicHook: input.topicHook,
          format: input.format,
          context: ctxStr,
          coverPersonaContext: coverPersona,
        });
        const so = await runAgenticCoverStrategist(taskIn, topicImageCondenseLog);
        if (so?.rawImagePrompt?.trim()) {
          strategistChinesePrompt = so.rawImagePrompt.trim();
          if (so.coverHeadline || so.designRationale) {
            topicImageCondenseLog.push(
              `${new Date().toISOString()}  [步骤0] headline=${String(so.coverHeadline || "").slice(0, 28)} · rationale=${String(
                so.designRationale || "",
              ).slice(0, 96)}`,
            );
          }
        }
      } catch (e: unknown) {
        topicImageCondenseLog.push(
          `${new Date().toISOString()}  [步骤0] 异常（忽略）: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const drFromAdminRequest = Boolean(input.enableTopicCoverDeepResearchPro);
    const drFromEnv = isTopicCoverDeepResearchProEnabled();
    const runCoverDrPro = drFromAdminRequest || drFromEnv;
    if (runCoverDrPro) {
      topicImageCondenseLog.push(
        `${new Date().toISOString()}  [步骤0.5·DR-Pro] 管理员入参=${drFromAdminRequest ? "开启" : "关闭"} · 环境全局=${drFromEnv ? "开启" : "关闭"} → Interactions Deep Research Pro 简报（失败则忽略，主链路照旧）`,
      );
      try {
        const drTask = buildCoverTaskInputFromPipeline({
          topicHook: input.topicHook,
          format: input.format,
          context: ctxStr,
          coverPersonaContext: coverPersona,
        });
        const secIn = input.drProSecondaryCoverInputs;
        const primaryHookNorm = String(input.topicHook || "").trim();
        const secondaryHookNorm = String(secIn?.topicHook || "").trim();
        const drTaskSecondary =
          secIn && secondaryHookNorm && secondaryHookNorm !== primaryHookNorm
            ? buildCoverTaskInputFromPipeline({
                topicHook: secIn.topicHook,
                format: input.format,
                context: String(secIn.context || "").trim(),
                coverPersonaContext: coverPersona,
              })
            : null;
        if (secIn && !drTaskSecondary && secondaryHookNorm) {
          topicImageCondenseLog.push(
            `${new Date().toISOString()}  [步骤0.5·DR-Pro] 副選題與主選題相同，略過雙條並行 · 僅單條 Interaction`,
          );
        }
        const drBrief = await runCoverDeepResearchBriefPreferDual(
          drTask,
          drTaskSecondary,
          topicImageCondenseLog,
        );
        if (drBrief?.trim()) {
          const tag = "【DeepResearch Pro·优化后的简体封面生图提示词】";
          strategistChinesePrompt = strategistChinesePrompt?.trim()
            ? `${strategistChinesePrompt.trim()}\n\n${tag}\n${drBrief.trim()}`
            : `${tag}\n${drBrief.trim()}`;
        }
      } catch (e: unknown) {
        topicImageCondenseLog.push(
          `${new Date().toISOString()}  [步骤0.5] 异常（忽略）: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const phaseOrderTs = new Date().toISOString();
    if (runCoverDrPro) {
      topicImageCondenseLog.push(
        `${phaseOrderTs}  [管线·阶段顺序] A/Deep Research Pro 段已结束（见上方 [步骤0.5·DR-Pro] 明细）→ B/GPT 5.4 英文化（步骤1 及以下）`,
      );
    } else {
      topicImageCondenseLog.push(
        `${phaseOrderTs}  [管线·阶段顺序] 未启用 A/Deep Research Pro（管理员入参与环境均为关）→ 直接 B/GPT 5.4 英文化`,
      );
    }

    try {
      try {
        const { blob: blobForStaging, provenance: stagingProv } = await buildCoverChineseBlobForStaging({
          strategistCombinedBlock: strategistChinesePrompt ?? "",
          baseContextZh: ctxStr,
          briefSource,
          extractChineseVisualBrief,
          flowLog: topicImageCondenseLog,
          maxChars: 6500,
        });

        const staging = finalizeCoverChineseStagingForTranslation({
          topicHookZh: String(input.topicHook || "").trim() || title,
          optimizedChineseBlob: blobForStaging,
          provenance: stagingProv,
          maxBlobChars: 6500,
        });
        appendStagingCoverToFlowLog(topicImageCondenseLog, staging);

        void persistCoverChineseStagingToRunningJob(input.progressJobId ?? null, staging);

        const geminiTask = buildPlatformTopicReferenceGeminiTask({
          topicHook: staging.topicHookZh,
          context: staging.optimizedChineseBlob,
          variant: isGraphic ? "graphic" : "video",
          coverPersonaContext: coverPersona || undefined,
        });
        topicImageCondenseLog.push(
          `${new Date().toISOString()}  [步骤1] 调用 ${translatorLogLabel} 生成英文 prompt …`,
        );
        const englishPrompt = await callGemini31ProForImagePrompt(geminiTask, {
          translator: imagePromptTranslator,
          flowLog: topicImageCondenseLog,
          pipelineStatCtx: { pipeline: "topic_cover" },
        });
        topicImageCondenseLog.push(`${new Date().toISOString()}  [步骤1] 完成 · 英文 prompt 约 ${englishPrompt.length} 字符`);
        topicImageCondenseLog.push(`${new Date().toISOString()}  [步骤1b] Prompt 智能提炼（如需）…`);
        const trimmedEn = String(englishPrompt || "").trim();
        if (!trimmedEn) {
          topicImageCondenseLog.push(`${new Date().toISOString()}  [步骤1] 翻译结果为空（不注入模版英文）`);
          throw new Error("英文 prompt 为空");
        }
        const safePrompt = await condenseImagePromptIfNeeded(trimmedEn, {
          translator: imagePromptTranslator,
          flowLog: topicImageCondenseLog,
        });
        lastSafePrompt = String(safePrompt || "").trim() || null;
        promptStats = buildImagePromptStats(englishPrompt || "", safePrompt || "");
        topicImageCondenseLog.push(
          `${new Date().toISOString()}  [统计] translated=${promptStats.translatedPromptChars} chars/${promptStats.translatedPromptWords} words · condensed=${promptStats.condensedPromptChars} chars/${promptStats.condensedPromptWords} words · condenseTriggered=${promptStats.condenseTriggered}`,
        );
        if (useVertexNb2Cover) {
          topicImageCondenseLog.push(
            `${new Date().toISOString()}  [步骤2-NB2] Vertex Nano Banana 2 · 9:16 · GPT-IMAGE-2 同款比例锁 + 共用光影（非 OhMyGPT）…`,
          );
          imageUrl = await generatePlatformTopicCoverNanoBanana2FromEnglishPrompt({
            englishPrompt: safePrompt,
            flowLog: topicImageCondenseLog,
          });
        } else {
          topicImageCondenseLog.push(`${new Date().toISOString()}  [步骤2] 调用 GPT-IMAGE-2（子步骤见下组日志）…`);
          imageUrl = await generateGptImage2FromRawEnglishPrompt({
            englishPrompt: safePrompt,
            aspectRatio: "9:16",
            gcsSubdir: "platform_topic_reference",
            flowLog: topicImageCondenseLog,
          });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        topicImageCondenseLog.push(`${new Date().toISOString()}  [步骤1/2] 主路径异常: ${msg}`);
        if (topicImageCondenseLog.length > 0) {
          console.warn(`[runPlatformTopicImagePipeline] condenseImagePromptIfNeeded flowLog:\n${topicImageCondenseLog.join("\n")}`);
        }
        console.warn(
          `[runPlatformTopicImagePipeline] ${isGraphic ? "图文封面式" : "短视频分镜单帧"} 主路径失败:`,
          e instanceof Error ? e.message : e,
        );
      }
      if (!imageUrl) {
        try {
          fallbackUsed = true;
          if (useVertexNb2Cover) {
            if (lastSafePrompt) {
              topicImageCondenseLog.push(
                `${new Date().toISOString()}  [步骤3a] NB2 主路径无图 → fal→OhMyGPT GPT-IMAGE-2 链 · 9:16 · english prompt 沿用步骤1…`,
              );
              imageUrl = await generateGptImage2FromRawEnglishPrompt({
                englishPrompt: lastSafePrompt,
                aspectRatio: "9:16",
                gcsSubdir: "platform_topic_reference",
                flowLog: topicImageCondenseLog,
              });
            }
            if (!imageUrl) {
              topicImageCondenseLog.push(
                `${new Date().toISOString()}  [步骤3b] 仍无图 → 版式 prompt + Vertex Nano Banana 2（2K）…`,
              );
              imageUrl = await generatePlatformTopicTypographyNanoBanana2Only({
                title: title || "Content",
                copywriting,
                mode,
                isTrial: false,
                flowLog: topicImageCondenseLog,
              });
            }
          } else {
            topicImageCondenseLog.push(
              `${new Date().toISOString()}  [步骤3] 主路径无图 → generateImageGpt2WithImagenFallback（Typography / Nano Banana 2 版式兜底）`,
            );
            const primaryHook = String(input.topicHook || "").trim().slice(0, 72);
            topicImageCondenseLog.push(
              `${new Date().toISOString()}  [步骤3·契約] 版式兜底仅为**本选题**一张竖版 9:16（非整页 2×4 宽幅）；语境锚点=主选题${
                primaryHook ? `「${primaryHook}${primaryHook.length >= 72 ? "…" : ""}」` : "（无标题）"
              }；副选题 DR-Pro 不会并入版式 copywriting`,
            );
            imageUrl = await generateImageGpt2WithImagenFallback({
              title: title || "Content",
              copywriting,
              mode,
              isTrial: false,
              flowLog: topicImageCondenseLog,
            });
          }
        } catch (e) {
          topicImageCondenseLog.push(`${new Date().toISOString()}  [步骤3] 兜底异常: ${e instanceof Error ? e.message : String(e)}`);
          console.warn(`[runPlatformTopicImagePipeline] 兜底异常:`, e instanceof Error ? e.message : e);
          imageUrl = null;
        }
      }
    } catch (e: unknown) {
      console.error("[runPlatformTopicImagePipeline] 未捕获异常:", e);
      imageUrl = null;
    }

    const newJobMetaBase = input.newJobMetaBase;

    if (!imageUrl) {
      topicImageCondenseLog.push(`${new Date().toISOString()}  ✗ 本条结束：仍无 URL`);
      if (creationIdOut != null && database) {
        try {
          await database
            .update(userCreations)
            .set({
              status: "failed",
              outputUrl: null,
              updatedAt: new Date(),
              metadata: JSON.stringify({
                ...newJobMetaBase,
                platformFreeRetryLastError: "empty_output",
                imagePromptStats: promptStats,
                fallbackUsed,
              }),
            })
            .where(eq(userCreations.id, creationIdOut));
        } catch (e) {
          console.warn(`[runPlatformTopicImagePipeline] mark failed ${creationIdOut}:`, e);
        }
      }
      return {
        success: false,
        imageUrl: null,
        url: null,
        freeRetryApplied: input.isFreeRetry,
        creationId: creationIdOut,
        imageGenFlowLog: topicImageCondenseLog,
        imagePromptStats: promptStats,
        fallbackUsed,
      };
    }

    const appealForCtr = String(input.appealHook || "").trim();
    const coverClickEstimate = estimateCoverCtrBand(String(input.topicHook || "").trim(), appealForCtr);
    topicImageCondenseLog.push(
      `${new Date().toISOString()}  [预估] ${coverClickEstimate.labelZh}（规则分数=${coverClickEstimate.score}，非实测CTR）`,
    );

    topicImageCondenseLog.push(`${new Date().toISOString()}  ✓ 本条结束：已得到 imageUrl`);
    const finalStatus = classifyPlatformTopicFrameStatus(imageUrl);
    if (creationIdOut != null && database) {
      try {
        await database
          .update(userCreations)
          .set({
            status: finalStatus,
            outputUrl: imageUrl,
            updatedAt: new Date(),
            metadata: JSON.stringify({
              ...newJobMetaBase,
              resolvedFrameStatus: finalStatus,
              imagePromptStats: promptStats,
              fallbackUsed,
              coverClickEstimate,
            }),
          })
          .where(eq(userCreations.id, creationIdOut));
      } catch (e) {
        console.warn("[runPlatformTopicImagePipeline] update platform_topic_frame failed:", e);
      }
    }

    return {
      success: true,
      imageUrl,
      url: imageUrl,
      freeRetryApplied: input.isFreeRetry,
      creationId: creationIdOut,
      imageGenFlowLog: topicImageCondenseLog,
      imagePromptStats: promptStats,
      fallbackUsed,
      coverClickEstimate,
    };
  } finally {
    await flushTopicImageProgress();
  }
}
