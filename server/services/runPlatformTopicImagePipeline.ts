/**
 * 平台单帧生图（英文化 → **Vertex Nano Banana 2** 為主；暫不調 GPT‑Image‑2；失敗則版式 NB2）——供 tRPC / jobs worker 共用。
 */
import { eq } from "drizzle-orm";
import * as db from "../db";
import { patchJobRunningProgress } from "../jobs/repository.js";
import {
  type PlatformImagePromptTranslator,
  type PlatformTopicBatchSceneDiversity,
} from "./geminiPlatformCompositeTranslation.js";
import {
  appendStagingCoverToFlowLog,
  buildCoverChineseBlobForStaging,
  finalizeCoverChineseStagingForTranslation,
  persistCoverChineseStagingToRunningJob,
} from "./platformImageChineseStaging.js";
import { estimateCoverCtrBand } from "../../shared/platformTitleVariants.js";
import { platformFlowLogTimestamp } from "../utils/platformFlowLogTimestamp.js";

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
  /** 監管：`coverProEngine` 為舊別名時視為強制 NB2；其餘豎封像素見 env `PLATFORM_TOPIC_COVER_PIXEL_ENGINE`（含 Imagen 路徑）。 */
  coverProEngine?: "nano_banana_2" | "nano_banana_pro";
  /**
   * 管理員於 Platform 頁開啟並經 tRPC/job 為 true 時；與環境 `PLATFORM_TOPIC_COVER_DEEP_RESEARCH_PRO` / `PLATFORM_COVER_DEEP_RESEARCH_PRO` **OR**：
   * 任一為真即跑步驟 0.5 Interactions DR-Pro（失敗則忽略，主鏈路照舊）。
   */
  enableTopicCoverDeepResearchPro?: boolean;
  /**
   * 可選第二條選題（由 job `drProSecondarySceneId` 等服端填入）：啟用 DR-Pro 時跑 **雙條** Interaction（內部並行 + 失敗條可再試）；
   * **僅當兩條均**產出有效簡報時才注入主條 DR；**任一條失敗/逾時**則**整段不注入** DR，改由主選題快照語境 + GPT 5.4（不採單條殘報）。
   */
  drProSecondaryCoverInputs?: { topicHook: string; context?: string };
  /**
   * 批量同窗（如一鍵多選題）：**不同選題，建議採用不同場景**；傳 `slotIndex`/`slotTotal` 則注入對應軟提示（例：四個選題→四個不同場景）。
   */
  batchSceneDiversity?: PlatformTopicBatchSceneDiversity;
  /**
   * 可選：與當前快照 **platformsKey** 對齊的 trendStore **高互動樣本**簡中摘要（服端注入；非帳號實測 CTR）。
   */
  trendEngagementVisualBrief?: string;
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
  const legacyCoverNb2 =
    input.coverProEngine === "nano_banana_2" || input.coverProEngine === "nano_banana_pro";
  const coverPixelEngineOverride = legacyCoverNb2 ? ("nano_banana_2" as const) : undefined;
  const title = String(input.topicHook || "").trim().slice(0, 80);
  const sid = String(input.sceneId ?? "").trim();
  void input.imagePromptTranslator;
  const isGraphic = input.format === "图文";
  const creationIdOut = input.creationIdOut ?? undefined;
  const database = await db.getDb();
  const { userCreations } = await import("../../drizzle/schema-creations.js");

  const {
    buildPlatformTopicReferenceGeminiTask,
    extractChineseVisualBrief,
    resolveVertexCoverTranslationModelName,
    translatePlatformTopicCoverToEnglishVertexOnly,
  } = await import("./geminiPlatformCompositeTranslation.js");
  const coverTranslatorLogLabel = `Vertex · ${resolveVertexCoverTranslationModelName()}（英文化，无 OpenAI）`;
  const {
    buildCoverTaskInputFromPipeline,
    isPlatformCoverAgenticBrainEnabled,
    runAgenticCoverStrategist,
  } = await import("./agenticCoverWorkflow.js");
  const {
    isTopicCoverDeepResearchProEnabled,
    runCoverDeepResearchBriefPreferDual,
  } = await import("./coverDeepResearchProBrief.js");
  const { buildImagePromptStats, generatePlatformTopicCoverNanoBanana2FromEnglishPrompt } = await import(
    "./proxyImageService.js",
  );

  const trendBrief = String(input.trendEngagementVisualBrief || "").trim();
  const userContext = String(input.context || "").trim();
  const ctxStr = [trendBrief, userContext].filter(Boolean).join("\n\n");
  const coverPersona = String(input.coverPersonaContext || "").trim();
  const briefSource = [coverPersona, String(input.topicHook || "").trim(), ctxStr].filter(Boolean).join("\n\n");

  const topicImageCondenseLog: string[] = [];
  const { flushNow: flushTopicImageProgress } = attachTopicImageProgressWriter(
    topicImageCondenseLog,
    input.progressJobId ?? null,
  );

  try {
    topicImageCondenseLog.push(
      `${platformFlowLogTimestamp()}  ──────── 单张「${String(input.topicHook || title || "Untitled").slice(0, 48)}」· sceneId=${sid || "N/A"} ────────`,
    );
    topicImageCondenseLog.push(
      `${platformFlowLogTimestamp()}  [主路径] Vertex 英文化 → 豎封像素（${coverPixelEngineOverride ?? "env PLATFORM_TOPIC_COVER_PIXEL_ENGINE"}）· 无版式二次生圖`,
    );

    if (trendBrief) {
      topicImageCondenseLog.push(
        `${platformFlowLogTimestamp()}  [语境增强] 已注入 trendStore 高互动样本摘要（${trendBrief.length} 字，对齐缩略图钩子；非实测 CTR）`,
      );
    }

    let promptStats: ImagePromptStats = {
      translatedPromptChars: 0,
      translatedPromptWords: 0,
    };
    let fallbackUsed = false;
    let imageUrl: string | null = null;

    let strategistChinesePrompt: string | null = null;
    if (isPlatformCoverAgenticBrainEnabled()) {
      topicImageCondenseLog.push(
        `${platformFlowLogTimestamp()}  [步骤0·企划大脑] PLATFORM_COVER_AGENTIC_BRAIN 开启 → Vertex 中文企划（失败则降级原链路）`,
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
              `${platformFlowLogTimestamp()}  [步骤0] headline=${String(so.coverHeadline || "").slice(0, 28)} · rationale=${String(
                so.designRationale || "",
              ).slice(0, 96)}`,
            );
          }
        }
      } catch (e: unknown) {
        topicImageCondenseLog.push(
          `${platformFlowLogTimestamp()}  [步骤0] 异常（忽略）: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const drFromAdminRequest = Boolean(input.enableTopicCoverDeepResearchPro);
    const drFromEnv = isTopicCoverDeepResearchProEnabled();
    const runCoverDrPro = drFromAdminRequest || drFromEnv;
    if (runCoverDrPro) {
      topicImageCondenseLog.push(
        `${platformFlowLogTimestamp()}  [步骤0.5·DR-Pro] 管理员入参=${drFromAdminRequest ? "开启" : "关闭"} · 环境全局=${drFromEnv ? "开启" : "关闭"} → Interactions Deep Research Pro 简报（失败则忽略，主链路照旧）`,
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
            `${platformFlowLogTimestamp()}  [步骤0.5·DR-Pro] 副選題與主選題相同，略過雙條並行 · 僅單條 Interaction`,
          );
        }
        const drBrief = await runCoverDeepResearchBriefPreferDual(drTask, drTaskSecondary, topicImageCondenseLog, {
          drBriefProduct: "platform_cover",
        });
        if (drBrief?.trim()) {
          const tag = "【DeepResearch Pro·优化后的简体封面生图提示词】";
          strategistChinesePrompt = strategistChinesePrompt?.trim()
            ? `${strategistChinesePrompt.trim()}\n\n${tag}\n${drBrief.trim()}`
            : `${tag}\n${drBrief.trim()}`;
        }
      } catch (e: unknown) {
        topicImageCondenseLog.push(
          `${platformFlowLogTimestamp()}  [步骤0.5] 异常（忽略）: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (runCoverDrPro) {
      topicImageCondenseLog.push(
        `${platformFlowLogTimestamp()}  [管线·阶段顺序] A/Deep Research Pro 段已结束（见上方 [步骤0.5·DR-Pro] 明细）→ B/Vertex 英文化（步骤1 及以下）`,
      );
    } else {
      topicImageCondenseLog.push(
        `${platformFlowLogTimestamp()}  [管线·阶段顺序] 未启用 A/Deep Research Pro（管理员入参与环境均为关）→ 直接 B/Vertex 英文化`,
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
          batchSceneDiversity: input.batchSceneDiversity,
        });
        topicImageCondenseLog.push(
          `${platformFlowLogTimestamp()}  [步骤1] 调用 ${coverTranslatorLogLabel} 生成英文 prompt …`,
        );
        const englishPrompt = await translatePlatformTopicCoverToEnglishVertexOnly(
          geminiTask,
          topicImageCondenseLog,
        );
        topicImageCondenseLog.push(`${platformFlowLogTimestamp()}  [步骤1] 完成 · 英文 prompt 约 ${englishPrompt.length} 字符`);
        const trimmedEn = String(englishPrompt || "").trim();
        if (!trimmedEn) {
          topicImageCondenseLog.push(`${platformFlowLogTimestamp()}  [步骤1] 翻译结果为空（不注入模版英文）`);
          throw new Error("英文 prompt 为空");
        }
        topicImageCondenseLog.push(
          `${platformFlowLogTimestamp()}  [步骤1b] 无智能提炼 · 英文化原文直接进封面像素链路（NB2 / Imagen 由 PLATFORM_TOPIC_COVER_PIXEL_ENGINE 决定，chars=${trimmedEn.length}）`,
        );
        const safePrompt = trimmedEn;
        promptStats = buildImagePromptStats(safePrompt);
        topicImageCondenseLog.push(
          `${platformFlowLogTimestamp()}  [统计] englishPrompt=${promptStats.translatedPromptChars} chars/${promptStats.translatedPromptWords} words`,
        );
        topicImageCondenseLog.push(
          `${platformFlowLogTimestamp()}  [步骤2] 竖封像素（NB2 与 Imagen Ultra 并存，见 flowLog · PLATFORM_TOPIC_COVER_PIXEL_ENGINE）…`,
        );
        imageUrl = await generatePlatformTopicCoverNanoBanana2FromEnglishPrompt({
          englishPrompt: safePrompt,
          flowLog: topicImageCondenseLog,
          coverPixelEngine: coverPixelEngineOverride,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        topicImageCondenseLog.push(`${platformFlowLogTimestamp()}  [步骤1/2] 主路径异常: ${msg}`);
        if (topicImageCondenseLog.length > 0) {
          console.warn(`[runPlatformTopicImagePipeline] topic image flowLog:\n${topicImageCondenseLog.join("\n")}`);
        }
        console.warn(
          `[runPlatformTopicImagePipeline] ${isGraphic ? "图文封面式" : "短视频分镜单帧"} 主路径失败:`,
          e instanceof Error ? e.message : e,
        );
      }
      if (!imageUrl) {
        topicImageCondenseLog.push(
          `${platformFlowLogTimestamp()}  [步骤3] 主路径无图 · 已關閉二次兜底 · 本条失败`,
        );
      }
    } catch (e: unknown) {
      console.error("[runPlatformTopicImagePipeline] 未捕获异常:", e);
      imageUrl = null;
    }

    const newJobMetaBase = input.newJobMetaBase;

    if (!imageUrl) {
      topicImageCondenseLog.push(`${platformFlowLogTimestamp()}  ✗ 本条结束：仍无 URL`);
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
      `${platformFlowLogTimestamp()}  [预估] ${coverClickEstimate.labelZh}（规则分数=${coverClickEstimate.score}，非实测CTR）`,
    );

    topicImageCondenseLog.push(`${platformFlowLogTimestamp()}  ✓ 本条结束：已得到 imageUrl`);
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
