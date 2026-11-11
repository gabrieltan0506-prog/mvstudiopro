/**
 * 模板学习 · 拉片式派生视图接口（站长专用）。
 * 权限与模板学习现有接口（renderEpisodeReport / getApprovedOwnerDetail）同一判定：仅站点拥有者（OWNER_OPEN_ID）。
 * 不扣费、不新增计价项；镜头构造表与分段由前端用同一份 shared 纯函数从已加载的卡上计算，这里只做需要模型或媒体的部分。
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { resolveSiteOwnerOnlyAllowed } from "../services/access-policy";

const templateId = z.string().regex(/^tpl_[a-z0-9_-]{1,60}$/i);
const segmentIndex = z.number().int().min(0).max(999);

function assertSiteOwner(user: { openId?: string | null }) {
  if (!resolveSiteOwnerOnlyAllowed(user)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅站点拥有者可查看模板学习拉片视图" });
  }
}

async function mapErrors<T>(run: () => Promise<T>): Promise<T> {
  const { ManhuaTemplateLapianError } = await import("../services/manhuaTemplateLapianService");
  try {
    return await run();
  } catch (error) {
    if (error instanceof ManhuaTemplateLapianError) throw new TRPCError({ code: error.code, message: error.message });
    throw error;
  }
}

export const manhuaTemplateLapianRouter = router({
  /** 段复刻提示词：已缓存直接返回；generate=true 时才调用文字模型并缓存（点开某段才生成）。 */
  segmentPrompt: protectedProcedure
    .input(z.object({ templateId, segmentIndex, generate: z.boolean() }).strict())
    .mutation(async ({ ctx, input }) => {
      assertSiteOwner(ctx.user);
      const svc = await import("../services/manhuaTemplateLapianService");
      return mapErrors(() => svc.getManhuaTemplateLapianSegmentPrompt(input));
    }),

  /** 全集视觉基因六维 + 复刻要点：generate=true 时一次汇总并缓存。 */
  genes: protectedProcedure
    .input(z.object({ templateId, generate: z.boolean() }).strict())
    .mutation(async ({ ctx, input }) => {
      assertSiteOwner(ctx.user);
      const svc = await import("../services/manhuaTemplateLapianService");
      return mapErrors(() => svc.getManhuaTemplateLapianGenes(input));
    }),

  /** 可播放片段：源分片仍在 GCS 才裁切，返回 15 分钟签名地址；不在则说明原因。 */
  segmentClip: protectedProcedure
    .input(z.object({ templateId, segmentIndex }).strict())
    .mutation(async ({ ctx, input }) => {
      assertSiteOwner(ctx.user);
      const svc = await import("../services/manhuaTemplateLapianService");
      return mapErrors(() => svc.getManhuaTemplateLapianSegmentClip(input));
    }),
});
