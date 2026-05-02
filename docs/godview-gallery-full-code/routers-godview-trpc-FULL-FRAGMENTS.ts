/**
 * 归档说明：以下片段为 `server/routers.ts` 中已落盘实现的**完整可复制代码**。
 * 实际位置（约略行号，随仓库变动）：
 * - `mvAnalysis.generateGodViewChapterPosters`：约 2897–2941 行
 * - `deepResearch.status` 的 return 对象：约 6266–6292 行（含 `strategicImagesTrialWatermark`）
 *
 * 请勿直接 import 本文件；合并时请粘贴进 `server/routers.ts` 的 `mvAnalysis` / `deepResearch` router。
 */

// ═══════════════════════════════════════════════════════════════════════════
// 片段 A：mvAnalysis.generateGodViewChapterPosters（完整）
// ═══════════════════════════════════════════════════════════════════════════

    /**
     * GodView 研报完成后：按章节一键生成「战略扉页」竖版海报（STRATEGIC / gpt-image-2 + Imagen 兜底）。
     * 不扣积分；水印严格跟随该任务的 `strategicImagesTrialWatermark`（首购尝鲜），不信任客户端传参绕过。
     */
    generateGodViewChapterPosters: protectedProcedure
      .input(z.object({
        jobId: z.string().min(1),
        chapters: z.array(z.object({
          id: z.string().min(1).max(128),
          title: z.string().min(1).max(220),
          context: z.string().max(2500).optional(),
        })).min(1).max(24),
      }))
      .mutation(async ({ input, ctx }) => {
        const { readJob } = await import("./services/deepResearchService");
        const job = await readJob(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        if (job.userId !== String(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        const allowed = new Set(["completed", "awaiting_review"]);
        if (!allowed.has(job.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "研报未完成，无法生成扉页" });
        }
        const md = String(job.reportMarkdown || "").trim();
        if (md.length < 40) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "报告正文不可用" });
        }
        const isTrial = !!job.strategicImagesTrialWatermark;
        const { generateImageGpt2WithImagenFallback } = await import("./services/proxyImageService");
        const results: { id: string; title: string; url: string | null }[] = [];
        for (const ch of input.chapters) {
          const ctxText = String(ch.context || "").trim() || ch.title;
          const url = await generateImageGpt2WithImagenFallback({
            title: ch.title,
            copywriting: ctxText,
            mode: "STRATEGIC",
            isTrial,
          });
          results.push({ id: ch.id, title: ch.title, url });
        }
        const okCount = results.filter((r) => r.url).length;
        if (okCount === 0) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "扉页生成失败（生图服务不可用）" });
        }
        return { ok: true as const, totalCost: 0 as const, results, isTrial };
      }),

// ═══════════════════════════════════════════════════════════════════════════
// 片段 B：deepResearch.status（完整 procedure 块）
// ═══════════════════════════════════════════════════════════════════════════

    status: protectedProcedure
      .input(z.object({ jobId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const { readJob } = await import("./services/deepResearchService");
        const job = await readJob(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        if (job.userId !== String(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        return {
          jobId: job.jobId,
          status: job.status,
          progress: job.progress || "",
          reportMarkdown: job.reportMarkdown || null,
          error: job.error || null,
          errorDetail: (job as any).errorDetail || null,
          createdAt: job.createdAt,
          completedAt: job.completedAt || null,
          planText: job.planText || null,
          planInteractionId: job.planInteractionId || null,
          interactionId: job.interactionId || null,
          creditsUsed: typeof job.creditsUsed === "number" ? job.creditsUsed : null,
          /** 首购尝鲜：与 deepResearch 内嵌配图 / 封面一致的试读水印策略 */
          strategicImagesTrialWatermark: !!(job as { strategicImagesTrialWatermark?: boolean }).strategicImagesTrialWatermark,
          // 真信号：心跳 / 更新时间，让前端展示真实推演进度
          updatedAt: (job as any).updatedAt || (job as any).lastHeartbeatAt || null,
          lastHeartbeatAt: (job as any).lastHeartbeatAt || null,
        };
      }),
