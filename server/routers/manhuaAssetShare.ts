/**
 * 漫剧资产静帧：授权进库半价 + 匿名社区参考库。
 * 兑换码/赠送积分：原价 + 强制入库。
 */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { manhuaCommunityAssets } from "../../drizzle/schema-manhua-community-assets";
import {
  deductCreditsAmount,
  estimateRemainingGiftedCredits,
  refundCreditsForDeductAmount,
} from "../credits";
import {
  resolveManhuaAssetStillBilling,
  type ManhuaAssetStillRole,
} from "../../shared/manhuaAssetSharePricing";
import { quoteManhuaAssetRegenCredits } from "../../shared/manhuaAssetRegenRequest";
import { generateGptImage2FromRawEnglishPrompt } from "../services/proxyImageService";
import { lookupManhuaPropShapeHintsZh } from "../services/manhuaPropShapeLookup";
import { MANHUA_PROP_SHAPE_LOOKUP_MAX } from "../../shared/manhuaPropShapeHint";

function makePublicId(): string {
  return `cma_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const roleSchema = z.enum(["character", "scene", "prop"]);

export const manhuaAssetShareRouter = router({
  /** 询价 + 赠送积分是否阻断半价（需登录） */
  quote: protectedProcedure
    .input(z.object({ shareToLibrary: z.boolean() }))
    .query(async ({ ctx, input }) => {
      const remainingGiftedCredits = await estimateRemainingGiftedCredits(
        ctx.user.id,
      );
      const billing = resolveManhuaAssetStillBilling({
        shareRequested: input.shareToLibrary,
        remainingGiftedCredits,
      });
      return {
        ...billing,
        shareRequested: input.shareToLibrary,
        remainingGiftedCredits,
        shareToLibrary: billing.contribute,
      };
    }),

  /** 生成资产静帧：扣费 → 生图 →（按计价规则）匿名进库 */
  generateAssetStill: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(8).max(8000),
        role: roleSchema,
        shareToLibrary: z.boolean(),
        labelZh: z.string().max(80).optional(),
        aspectRatio: z.enum(["9:16", "16:9"]).optional(),
        referenceImageUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const remainingGiftedCredits = await estimateRemainingGiftedCredits(
        ctx.user.id,
      );
      const billing = resolveManhuaAssetStillBilling({
        shareRequested: input.shareToLibrary,
        remainingGiftedCredits,
      });
      const cost = billing.credits;
      const contribute = billing.contribute;
      const role = input.role as ManhuaAssetStillRole;

      let deduct: Awaited<ReturnType<typeof deductCreditsAmount>>;
      try {
        const desc = billing.giftedBlocksHalfPrice
          ? `漫剧资产图·${role}·兑换码积分原价进库`
          : billing.halfPriceApplied
            ? `漫剧资产图·${role}·授权进库半价`
            : `漫剧资产图·${role}`;
        deduct = await deductCreditsAmount(
          ctx.user.id,
          cost,
          "manhuaAssetStill",
          desc,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "积分不足";
        throw new TRPCError({ code: "PAYMENT_REQUIRED", message: msg });
      }
      if (!deduct.success) {
        throw new TRPCError({
          code: "PAYMENT_REQUIRED",
          message: "积分不足，请充值后再生成资产图",
        });
      }

      const refs = input.referenceImageUrl ? [input.referenceImageUrl] : undefined;
      try {
        const imageUrl = await generateGptImage2FromRawEnglishPrompt({
          englishPrompt: input.prompt,
          aspectRatio: input.aspectRatio === "16:9" ? "16:9" : "9:16",
          gcsSubdir: "manhua-asset-still",
          referenceImageUrls: refs,
          generalImageEdit: Boolean(refs?.length),
          imageLane: "asset",
        });
        if (!imageUrl) {
          await refundCreditsForDeductAmount(
            ctx.user.id,
            "漫剧资产图生成失败退还",
            deduct,
            "manhuaAssetStill",
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "资产图生成失败，积分已退还",
          });
        }

        let communityPublicId: string | null = null;
        if (contribute) {
          const db = await getDb();
          if (db) {
            const publicId = makePublicId();
            await db.insert(manhuaCommunityAssets).values({
              publicId,
              role,
              imageUrl,
              labelZh: String(input.labelZh || "").trim().slice(0, 80) || null,
              contributorUserId: ctx.user.id,
            });
            communityPublicId = publicId;
          }
        }

        return {
          imageUrl,
          creditsCharged: deduct.cost,
          shareToLibrary: contribute,
          halfPriceApplied: billing.halfPriceApplied,
          giftedBlocksHalfPrice: billing.giftedBlocksHalfPrice,
          communityPublicId,
          role,
          noticeZh: billing.noticeZh,
        };
      } catch (e: unknown) {
        if (e instanceof TRPCError) throw e;
        await refundCreditsForDeductAmount(
          ctx.user.id,
          "漫剧资产图异常退还",
          deduct,
          "manhuaAssetStill",
        );
        const msg = e instanceof Error ? e.message : "资产图生成失败";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: /积分已退还/.test(msg) ? msg : `${msg}（积分已退还）`,
        });
      }
    }),

  /**
   * 自动入库：资产图生成成功后，去名匿名收录进公有参考库（用户 2026-07-29 口径「直接自动入库」）。
   * 不额外扣费（生成时已计价）；同一 imageUrl 去重，避免重出/重扫时重复入库。
   * 半成品由客户端 `decideManhuaAssetRecycle` 拦掉，不会调到这里。
   */
  contributeToLibrary: protectedProcedure
    .input(
      z.object({
        role: roleSchema,
        imageUrl: z.string().url(),
        labelZh: z.string().max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { ok: false as const, publicId: null as string | null, deduped: false };
      const existing = await db
        .select({ publicId: manhuaCommunityAssets.publicId })
        .from(manhuaCommunityAssets)
        .where(eq(manhuaCommunityAssets.imageUrl, input.imageUrl))
        .limit(1);
      if (existing.length) {
        return { ok: true as const, publicId: existing[0]!.publicId, deduped: true };
      }
      const publicId = makePublicId();
      await db.insert(manhuaCommunityAssets).values({
        publicId,
        role: input.role as ManhuaAssetStillRole,
        imageUrl: input.imageUrl,
        labelZh: String(input.labelZh || "").trim().slice(0, 80) || null,
        contributorUserId: ctx.user.id,
      });
      return { ok: true as const, publicId, deduped: false };
    }),

  /**
   * 重出设定图的**扣费**（不生图）。
   *
   * 生图必须走画布的「入队 + 轮询」长任务：同步 tRPC 打 GPT-Image-2 会撞网关 120s 上限，
   * 实测 502 ROUTER_EXTERNAL_TARGET_ERROR，图没出、旧图还被清了。所以这里只管钱。
   * 调用时机是**出图成功之后**——没拿到图就不收，也就不需要退款通道（省掉可被刷的退款口）。
   *
   * 计价（用户 2026-07-29 定）：与「用库内资产」同档，1 张 15、2 张 20，超出每张 +5；
   * 不吃授权进库半价那套（本就是低档价）。
   */
  chargeAssetRegen: protectedProcedure
    .input(
      z.object({
        role: roleSchema,
        /** 本次重出的真实张数，用于 15/20 分档 */
        tileCount: z.number().int().min(1).max(24),
        mode: z.enum(["redraw", "library"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cost = quoteManhuaAssetRegenCredits(input.tileCount);
      const role = input.role as ManhuaAssetStillRole;
      try {
        const deduct = await deductCreditsAmount(
          ctx.user.id,
          cost,
          "manhuaAssetStill",
          input.mode === "library"
            ? `漫剧资产图·${role}·用库内资产（${input.tileCount} 张）`
            : `漫剧资产图·${role}·重出（${input.tileCount} 张）`,
        );
        return { creditsCharged: deduct.cost, role, tileCount: input.tileCount };
      } catch (e: unknown) {
        throw new TRPCError({
          code: "PAYMENT_REQUIRED",
          message: e instanceof Error ? e.message : "积分不足",
        });
      }
    }),

  /** 匿名社区参考库（不含贡献者信息） */
  listCommunity: publicProcedure
    .input(
      z
        .object({
          role: roleSchema.optional(),
          limit: z.number().int().min(1).max(48).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db)
        return {
          items: [] as Array<{
            publicId: string;
            role: string;
            imageUrl: string;
            labelZh: string;
          }>,
        };
      const limit = input?.limit ?? 24;
      const role = input?.role;
      const rows = role
        ? await db
            .select({
              publicId: manhuaCommunityAssets.publicId,
              role: manhuaCommunityAssets.role,
              imageUrl: manhuaCommunityAssets.imageUrl,
              labelZh: manhuaCommunityAssets.labelZh,
            })
            .from(manhuaCommunityAssets)
            .where(eq(manhuaCommunityAssets.role, role))
            .orderBy(desc(manhuaCommunityAssets.createdAt))
            .limit(limit)
        : await db
            .select({
              publicId: manhuaCommunityAssets.publicId,
              role: manhuaCommunityAssets.role,
              imageUrl: manhuaCommunityAssets.imageUrl,
              labelZh: manhuaCommunityAssets.labelZh,
            })
            .from(manhuaCommunityAssets)
            .orderBy(desc(manhuaCommunityAssets.createdAt))
            .limit(limit);
      return {
        items: rows.map((r) => ({
          publicId: r.publicId,
          role: r.role,
          imageUrl: r.imageUrl,
          labelZh: String(r.labelZh || "").trim() || "社区参考",
        })),
      };
    }),

  /**
   * 道具实物形制联网核对：出图前问一句该器物长什么样，查不到的键不返回。
   * 形制不许前台自己编——画错朝笏这类事故要退款（用户 2026-07-29）。
   */
  lookupPropShapes: protectedProcedure
    .input(
      z.object({
        namesZh: z.array(z.string().min(1).max(40)).min(1).max(MANHUA_PROP_SHAPE_LOOKUP_MAX),
      }),
    )
    .mutation(async ({ input }) => {
      const hints = await lookupManhuaPropShapeHintsZh(input.namesZh);
      return { hints };
    }),
});
