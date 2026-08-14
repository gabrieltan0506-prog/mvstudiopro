/**
 * 漫剧节奏模板：动态提案 / 批准进库 / 合并列表（GCS ∪ 种子库）。
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { resolvePlatformSupervisorOpsAllowed } from "../services/access-policy";

function assertSupervisorOps(
  user: { role?: string | null },
  supervisorToken?: string | null,
) {
  if (!resolvePlatformSupervisorOpsAllowed(user, supervisorToken)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "需要监管权限",
    });
  }
}

export const manhuaViralTemplateRouter = router({
  /**
   * 编剧室 / 已登录：GCS approved 列表（出厂种子已清空；GCS 失败时返回空组，前端有空态）。
   * 具名保护（2026-08-15 用户拍板：学习模板只有监管可见全貌）：普通用户拿匿名化功能卡——
   * 剧名 nameZh 换成「赛道·爆款节奏 N号」，sourceRefs/provenance 一律剥除；
   * 节拍网格等功能字段保留，编剧室骨架建议照常可用。监管带 token 走原样全量。
   */
  listApproved: protectedProcedure
    .input(z.object({ supervisorToken: z.string().max(512).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const { listMergedApprovedManhuaViralTemplatesGrouped } = await import(
          "../services/manhuaViralTemplateStore"
        );
        const groups = await listMergedApprovedManhuaViralTemplatesGrouped();
        if (resolvePlatformSupervisorOpsAllowed(ctx.user, input?.supervisorToken)) {
          return { groups };
        }
        return {
          groups: groups.map((g) => ({
            laneZh: g.laneZh,
            items: g.items
              .slice()
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((c, i) => ({
                ...c,
                nameZh: `${g.laneZh}·爆款节奏 ${i + 1} 号`,
                sourceRefs: [],
                provenance: undefined,
              })),
          })),
        };
      } catch (e) {
        console.warn(
          "[manhuaViralTemplate.listApproved] gcs failed, return empty:",
          e instanceof Error ? e.message : e,
        );
        return { groups: [] };
      }
    }),

  /** 监管：待审提案（GCS proposals，含已批准副本） */
  listProposals: protectedProcedure
    .input(z.object({ supervisorToken: z.string().max(512).optional() }).optional())
    .query(async ({ ctx, input }) => {
      assertSupervisorOps(ctx.user, input?.supervisorToken);
      const { listGcsManhuaViralProposals } = await import("../services/manhuaViralTemplateStore");
      const items = await listGcsManhuaViralProposals();
      return {
        items: items.map((c) => ({
          id: c.id,
          nameZh: c.nameZh,
          laneZh: c.laneZh,
          summaryZh: c.summaryZh,
          hook3sZh: c.hook3sZh,
          status: c.status,
          updatedAt: c.updatedAt,
        })),
      };
    }),

  /** 监管：明文批准进库 → GCS approved（不改 TypeScript 种子数组） */
  approve: protectedProcedure
    .input(
      z.object({
        id: z.string().max(64).optional(),
        card: z.record(z.string(), z.any()).optional(),
        supervisorToken: z.string().max(512).optional(),
        /** 须为 true，表示用户明文确认批准 */
        confirmApprove: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertSupervisorOps(ctx.user, input.supervisorToken);
      if (!input.id && !input.card) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请提供提案 id 或完整卡片" });
      }
      try {
        const { approveManhuaViralTemplate } = await import("../services/manhuaViralTemplateStore");
        const card = await approveManhuaViralTemplate({
          id: input.id,
          card: input.card,
        });
        return { ok: true as const, card };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: msg.slice(0, 200) || "批准失败",
        });
      }
    }),

  /** 调试用：仅 adminProcedure 角色可读 GCS approved 原始列表 */
  listApprovedGcsOnly: adminProcedure.query(async () => {
    const { listGcsManhuaViralApproved } = await import("../services/manhuaViralTemplateStore");
    return { items: await listGcsManhuaViralApproved() };
  }),

  /** 监管：查看合集学习进度与分集摘要（网页即时展示） */
  getSeriesLearnSnapshot: protectedProcedure
    .input(
      z.object({
        seriesKey: z.string().min(4).max(64),
        supervisorToken: z.string().max(512).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertSupervisorOps(ctx.user, input.supervisorToken);
      const { getManhuaSeriesLearnSnapshot } = await import(
        "../services/manhuaTemplateLearnService"
      );
      return getManhuaSeriesLearnSnapshot(input.seriesKey);
    }),
});
