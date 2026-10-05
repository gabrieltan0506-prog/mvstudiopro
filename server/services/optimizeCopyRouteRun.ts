import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import type { ManhuaWriterModel } from "../../shared/manhuaWriterModels";
import type { ManhuaWriterEpisode } from "../../shared/manhuaWriterRoom";
import { buildManhuaStoryboardTemplateReference } from "./manhuaTemplateAdvisorReference";
import { CREDIT_COSTS } from "../plans";
import { getCredits, deductCredits } from "../credits";
export type OptimizeCopyRouteInput = {
 writerModel?: ManhuaWriterModel; publicTemplateId?: string; templateReferences?: ManhuaWriterEpisode["templateReferences"];
 factoryTextStage?: "story" | "assets" | "beats";
 sourceText: string; optimizationBrief?: string; visionContext?: string; includeLiveTrends?: boolean;
 liveTrendWindowDays?: number; modelName?: string; enabledSkillIds?: string[]; allowBloggerTitle?: boolean; storyboardCandidate?: boolean;
};
/** 原文案入口计费、技能与失败退款共用，异步任务不另造扣费规则。 */
export async function runOptimizeCustomCopyForUser(input: OptimizeCopyRouteInput, user: {id:number;role:string}, onUpstreamBytes?: (bytes:number)=>Promise<void>) {

        const userId = user.id;
        // 模板解析在扣费前完成。使用原模板卡和原格式化器，不以编号或静态词库代替能力。
        let templateAddon = "";
        let appliedTemplates: Awaited<ReturnType<typeof buildManhuaStoryboardTemplateReference>>["appliedTemplates"] | undefined;
        const factoryText = input.storyboardCandidate || input.factoryTextStage;
        if (factoryText) {
          if (!input.writerModel || !["glm", "deepseek"].includes(input.writerModel)) throw new TRPCError({ code: "BAD_REQUEST", message: "请重新选择创作模型，未提交分镜。" });
        }
        if (input.storyboardCandidate || input.factoryTextStage && input.templateReferences !== undefined) {
          try {
            const references = await buildManhuaStoryboardTemplateReference(input.templateReferences);
            templateAddon = references.text;
            appliedTemplates = references.appliedTemplates;
          } catch (error) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "本集模板参考无效，未提交分镜。" });
          }
        }
        const isAdminUser = user.role === "admin" || user.role === "supervisor";
        const cost = CREDIT_COSTS.platformOptimizeCustomCopy;
        let creditsCharged = false;

        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < cost) {
            throw new TRPCError({
              code: "PAYMENT_REQUIRED",
              message: `Credits 不足，深度优化文案需要 ${cost} 点（当前可用：${creditsInfo.totalAvailable}）`,
            });
          }
          await deductCredits(
            userId,
            "platformOptimizeCustomCopy",
            "自定义文案 · 深度优化",
          );
          creditsCharged = true;
        }

        try {
          if (factoryText) {
            const { createManhuaWriterModelCall } = await import("./manhuaWriterModelRun");
            const modelCall = createManhuaWriterModelCall(userId, randomUUID(), input.writerModel!);
            const prompt = [input.sourceText, input.optimizationBrief || "", templateAddon,
              templateAddon ? "只采用所选模板中适合本集的创作方法；当前已确认正文和本次要求优先，不引入模板来源人物或剧情。" : "当前已确认正文和本次要求优先，保留人物身份与关键因果。",
              input.storyboardCandidate ? "沿上文原分镜表合同返回完整Markdown。" : "沿上文本阶段的原输出合同返回完整Markdown。"].filter(Boolean).join("\n\n");
            const output = await modelCall(prompt, false, input.factoryTextStage || "storyboard", { onBytes: onUpstreamBytes });
            if (!output.text.trim()) throw new Error("创作结果为空，原稿保留");
            return { success: true as const, cost: isAdminUser ? 0 : cost,
              result: { summary: input.storyboardCandidate ? "文字分镜" : "工厂文字创作", optimizedMarkdown: output.text, titles: [] as string[], hooks: [] as string[], platformNotes: [] as Array<{platform:string;angle:string;copySnippet:string}> },
              appliedTemplates, model: output.model };
          }
          const platformSkillsPrompt = await (async () => {
            try {
              const { resolvePlatformSkillsPrompt } = await import("./platformSkillsService.js");
              return await resolvePlatformSkillsPrompt({
                userId,
                enabledSkillIds: Array.isArray(input.enabledSkillIds) ? input.enabledSkillIds : null,
                allowBloggerTitle: Boolean(input.allowBloggerTitle),
                routeContext: `${input.optimizationBrief || ""}\n${String(input.sourceText || "").slice(0, 2500)}`,
                sheetKind: "unknown",
              });
            } catch {
              return "";
            }
          })();

          const { optimizeCustomCopy } = await import("./platformOptimizeCustomCopy");
          const result = await optimizeCustomCopy({
            sourceText: input.sourceText,
            optimizationBrief: input.optimizationBrief,
            visionContext: input.visionContext,
            includeLiveTrends: input.includeLiveTrends,
            liveTrendWindowDays: input.liveTrendWindowDays,
            platformSkillsPrompt: platformSkillsPrompt || undefined,
            modelName: input.modelName,
          });

          return {
            success: true as const,
            cost: isAdminUser ? 0 : cost,
            result,
          };
        } catch (error) {
          if (creditsCharged) {
            const { refundCredits } = await import("../credits.js");
            await refundCredits(userId, cost, "platformOptimizeCustomCopy 深度优化失败退还").catch(
              (refundErr: unknown) => {
                console.error("[optimizeCustomCopy] refund failed:", refundErr);
              },
            );
          }
          const { OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE } = await import(
            "./platformOptimizeCustomCopy.js"
          );
          const rawMessage = error instanceof Error ? error.message : String(error);
          const isCapacity = rawMessage === OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE;
          throw new TRPCError({
            code: isCapacity ? "SERVICE_UNAVAILABLE" : "INTERNAL_SERVER_ERROR",
            message: isCapacity
              ? `${OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE}${creditsCharged ? "（积分已退回）" : ""}`
              : rawMessage.includes("is not valid JSON")
                ? `${OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE}${creditsCharged ? "（积分已退回）" : ""}`
                : rawMessage || `文案优化失败${creditsCharged ? "，积分已退回" : ""}，请稍后重试`,
          });
        }
}
