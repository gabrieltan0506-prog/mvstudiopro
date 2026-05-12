/**
 * 平台单帧生图（英文化預設 **Vertex gemini-3.1-pro-preview** → **GPT-IMAGE-2** → 兜底）——供 tRPC 同步调用与 jobs worker 共用。
 */
import { eq } from "drizzle-orm";
import * as db from "../db";
import { patchJobRunningProgress } from "../jobs/repository.js";
import {
  type PlatformImagePromptTranslator,
} from "./geminiPlatformCompositeTranslation.js";
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
  /** 強化划停與主標衝擊（與「超高點擊率封面」加購一致） */
  highFeedCtrBoost?: boolean;
  /** 英文化引擎；未傳時預設 `vertex_gemini_3_1_pro_preview`（Vertex · gemini-3.1-pro-preview）。 */
  imagePromptTranslator?: PlatformImagePromptTranslator;
  creationIdOut: number | null | undefined;
  isFreeRetry: boolean;
  newJobMetaBase: Record<string, unknown>;
  /** 異步 jobs worker 傳 job.id：管線執行中節流寫入 jobs.output.imageGenFlowLog，前端輪詢可見步驟 */
  progressJobId?: string | null;
  /** 管理員專用：單幀主生圖改為 Vertex Nano Banana 2（9:16 · 官方 API；與主路徑共用光影語彙）。`nano_banana_pro` 為舊別名，行為相同。 */
  coverProEngine?: "nano_banana_2" | "nano_banana_pro";
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
  const imagePromptTranslator: PlatformImagePromptTranslator =
    input.imagePromptTranslator ?? "vertex_gemini_3_1_pro_preview";
  const translatorLogLabel =
    imagePromptTranslator === "vertex_gemini_3_1_pro_preview"
      ? "Vertex gemini-3.1-pro-preview"
      : imagePromptTranslator === "vertex_gemini_3_flash_preview"
        ? "Vertex Gemini 3 Flash（JSON）"
        : "GPT 5.4（OpenAI）";
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
  let copywriting = [
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
    if (input.highFeedCtrBoost) {
      topicImageCondenseLog.push(
        `${new Date().toISOString()}  [超高点击率] 前置：Deep Research Pro（agent=gemini-deep-research-pro-preview）竞品清洗 · 本地轮询默认上限约 8 分钟，失败则回退原语境`,
      );
    }

    let briefForExtract = briefSource;
    if (input.highFeedCtrBoost) {
      try {
        const { runCoverCompetitorDeepResearchBrief } = await import("./deepResearchService.js");
        const drBrief = await runCoverCompetitorDeepResearchBrief({
          topicHook: String(input.topicHook || "").trim(),
          appealHook: String(input.appealHook || "").trim(),
          context: ctxStr,
          format: isGraphic ? "图文" : "短视频",
          flowLog: topicImageCondenseLog,
          progressJobId: input.progressJobId ?? null,
        });
        if (drBrief && drBrief.trim().length > 0) {
          briefForExtract = [briefSource, "【Deep Research Pro · 竞品清洗补充】", drBrief.trim()].join("\n\n");
          copywriting = [
            coverPersona ? `【封面身份锚点】\n${coverPersona}` : "",
            [input.topicHook, ctxStr, `【Deep Research Pro · 竞品清洗】\n${drBrief.trim()}`].filter(Boolean).join("\n\n"),
          ]
            .filter(Boolean)
            .join("\n\n");
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        topicImageCondenseLog.push(
          `${new Date().toISOString()}  [Deep Research Pro] 未捕获异常，已回退原语境：${msg.slice(0, 200)}`,
        );
      }
    }

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

    try {
      try {
        const zhBrief =
          (await extractChineseVisualBrief(briefForExtract, topicImageCondenseLog)) || briefForExtract.slice(0, 2000);
        const geminiTask = buildPlatformTopicReferenceGeminiTask({
          topicHook: input.topicHook,
          context: zhBrief,
          variant: isGraphic ? "graphic" : "video",
          coverPersonaContext: coverPersona || undefined,
          highFeedCtrBoost: Boolean(input.highFeedCtrBoost),
        });
        const fallbackZhPayload = [
          `【选题钩子】${String(input.topicHook || "").trim()}`,
          coverPersona ? `【出镜人设】\n${coverPersona}` : "",
          `【中文视觉骨架与语境】\n${zhBrief}`,
          `【版式】${isGraphic ? "竖版 9:16 单张信息流封面（GPT-IMAGE-2）" : "竖版 9:16 多分镜参考条（GPT-IMAGE-2）"}`,
          input.highFeedCtrBoost ? "【强化】超高点击率向：划停、主标冲击" : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const condenseTranslator =
          imagePromptTranslator === "vertex_gemini_3_1_pro_preview" ? ("gpt54" as const) : imagePromptTranslator;
        topicImageCondenseLog.push(
          `${new Date().toISOString()}  [步骤1] 调用 ${translatorLogLabel} 生成英文 prompt …`,
        );
        const englishPrompt = await callGemini31ProForImagePrompt(geminiTask, {
          translator: imagePromptTranslator,
          flowLog: topicImageCondenseLog,
          pipelineStatCtx: { pipeline: "topic_cover" },
          gemini31ProFailureFallbackChinesePayload:
            imagePromptTranslator === "vertex_gemini_3_1_pro_preview" ? fallbackZhPayload : undefined,
        });
        topicImageCondenseLog.push(`${new Date().toISOString()}  [步骤1] 完成 · 英文 prompt 约 ${englishPrompt.length} 字符`);
        topicImageCondenseLog.push(`${new Date().toISOString()}  [步骤1b] Prompt 智能提炼（如需）…`);
        const trimmedEn = String(englishPrompt || "").trim();
        if (!trimmedEn) {
          topicImageCondenseLog.push(`${new Date().toISOString()}  [步骤1] 翻译结果为空（不注入模版英文）`);
          throw new Error("英文 prompt 为空");
        }
        const safePrompt = await condenseImagePromptIfNeeded(trimmedEn, {
          translator: condenseTranslator,
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
