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
  /** 编剧室 / 已登录：合并后的 approved 列表（失败时服务端仍尽量返回种子库） */
  listApproved: protectedProcedure.query(async () => {
    try {
      const { listMergedApprovedManhuaViralTemplatesGrouped } = await import(
        "../services/manhuaViralTemplateStore"
      );
      return { groups: await listMergedApprovedManhuaViralTemplatesGrouped() };
    } catch (e) {
      const { listApprovedManhuaViralTemplatesGrouped } = await import(
        "../../shared/manhuaViralTemplateBank.js"
      );
      console.warn(
        "[manhuaViralTemplate.listApproved] fallback seed:",
        e instanceof Error ? e.message : e,
      );
      return { groups: listApprovedManhuaViralTemplatesGrouped() };
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
});
