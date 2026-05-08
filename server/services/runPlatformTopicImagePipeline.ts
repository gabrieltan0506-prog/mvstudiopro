/**
 * 平台单帧生图（GPT 5.4 → GPT-IMAGE-2 → 兜底）——供 tRPC 同步调用与 jobs worker 共用，避免重复实现。
 */
import { eq } from "drizzle-orm";
import * as db from "../db";
import { patchJobRunningProgress } from "../jobs/repository.js";
import {
  resolveVertexFlashTranslationModelName,
  type PlatformImagePromptTranslator,
} from "./geminiPlatformCompositeTranslation.js";

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
  /** 英文化：預設 GPT 5.4；Vertex 供 Debug/對照（需 GCP 憑證）。 */
  imagePromptTranslator?: PlatformImagePromptTranslator;
  creationIdOut: number | null | undefined;
  isFreeRetry: boolean;
  newJobMetaBase: Record<string, unknown>;
  /** 異步 jobs worker 傳 job.id：管線執行中節流寫入 jobs.output.imageGenFlowLog，前端輪詢可見步驟 */
  progressJobId?: string | null;
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
};

export async function runPlatformTopicImagePipeline(
  input: RunPlatformTopicImagePipelineInput,
): Promise<RunPlatformTopicImagePipelineResult> {
  const title = String(input.topicHook || "").trim().slice(0, 80);
  const sid = String(input.sceneId ?? "").trim();
  const imagePromptTranslator: PlatformImagePromptTranslator = input.imagePromptTranslator ?? "gpt54";
  const translatorLogLabel =
    imagePromptTranslator === "vertex_gemini_31_pro_preview"
      ? `Vertex @google/genai · ${resolveVertexFlashTranslationModelName()} · us-central1（JSON）`
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
  const { buildImagePromptStats, generateImageGpt2WithImagenFallback, generateGptImage2FromRawEnglishPrompt, condenseImagePromptIfNeeded } =
    await import("./proxyImageService.js");

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
      `${new Date().toISOString()}  [主路径] buildPlatformTopicReferenceGeminiTask（variant=${isGraphic ? "graphic" : "video"}）→ callGemini31ProForImagePrompt(${translatorLogLabel}) → generateGptImage2FromRawEnglishPrompt 9:16`,
    );
    topicImageCondenseLog.push(
      `${new Date().toISOString()}  说明: 中文语境供翻译模型吸收；产出一条英文视觉指令；GPT-IMAGE-2 只读英文；画内简中字由英文指令约束`,
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

    try {
      try {
        const geminiTask = buildPlatformTopicReferenceGeminiTask({
          topicHook: input.topicHook,
          context: (await extractChineseVisualBrief(briefSource, topicImageCondenseLog)) || briefSource.slice(0, 2000),
          variant: isGraphic ? "graphic" : "video",
          coverPersonaContext: coverPersona || undefined,
        });
        topicImageCondenseLog.push(
          `${new Date().toISOString()}  [步骤1] 调用 ${translatorLogLabel} 生成英文 prompt …`,
        );
        const englishPrompt = await callGemini31ProForImagePrompt(geminiTask, {
          translator: imagePromptTranslator,
          flowLog: topicImageCondenseLog,
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
        promptStats = buildImagePromptStats(englishPrompt || "", safePrompt || "");
        topicImageCondenseLog.push(
          `${new Date().toISOString()}  [统计] translated=${promptStats.translatedPromptChars} chars/${promptStats.translatedPromptWords} words · condensed=${promptStats.condensedPromptChars} chars/${promptStats.condensedPromptWords} words · condenseTriggered=${promptStats.condenseTriggered}`,
        );
        topicImageCondenseLog.push(`${new Date().toISOString()}  [步骤2] 调用 GPT-IMAGE-2（子步骤见下组日志）…`);
        imageUrl = await generateGptImage2FromRawEnglishPrompt({
          englishPrompt: safePrompt,
          aspectRatio: "9:16",
          gcsSubdir: "platform_topic_reference",
          flowLog: topicImageCondenseLog,
        });
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
    };
  } finally {
    await flushTopicImageProgress();
  }
}
