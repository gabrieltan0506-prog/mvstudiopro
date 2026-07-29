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
   * 重出设定图：用户写明哪里要改进，按修订后的提示词重画。
   *
   * 计价与常规资产图不同（用户 2026-07-29 定）：走「用库内资产」同档——1 张 15、2 张 20，
   * 超出每张 +5；不吃授权进库半价那套（本来就已经是低档价）。重出成功后照旧匿名进库。
   */
  regenerateAssetStill: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(8).max(8000),
        role: roleSchema,
        /** 本次重出的张数，用于 15/20 分档 */
        tileCount: z.number().int().min(1).max(24),
        labelZh: z.string().max(80).optional(),
        aspectRatio: z.enum(["9:16", "16:9"]).optional(),
        /** 旧图或库里挑的那张：当垫图，避免重画时身份漂走 */
        referenceImageUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cost = quoteManhuaAssetRegenCredits(input.tileCount);
      const role = input.role as ManhuaAssetStillRole;
      let deduct: Awaited<ReturnType<typeof deductCreditsAmount>>;
      try {
        deduct = await deductCreditsAmount(
          ctx.user.id,
          cost,
          "manhuaAssetStill",
          `漫剧资产图·${role}·重出（${input.tileCount} 张）`,
        );
      } catch (e: unknown) {
        throw new TRPCError({
          code: "PAYMENT_REQUIRED",
          message: e instanceof Error ? e.message : "积分不足",
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
        });
        if (!imageUrl) {
          await refundCreditsForDeductAmount(
            ctx.user.id,
            "漫剧资产图重出失败退还",
            deduct,
            "manhuaAssetStill",
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "资产图重出失败，积分已退还",
          });
        }
        // 重出成品照旧匿名进库（生成时已计价，入库不再收费）；同 URL 去重
        const db = await getDb();
        if (db) {
          const existing = await db
            .select({ publicId: manhuaCommunityAssets.publicId })
            .from(manhuaCommunityAssets)
            .where(eq(manhuaCommunityAssets.imageUrl, imageUrl))
            .limit(1);
          if (!existing.length) {
            await db.insert(manhuaCommunityAssets).values({
              publicId: makePublicId(),
              role,
              imageUrl,
              labelZh: String(input.labelZh || "").trim().slice(0, 80) || null,
              contributorUserId: ctx.user.id,
            });
          }
        }
        return {
          imageUrl,
          creditsCharged: deduct.cost,
          role,
          tileCount: input.tileCount,
        };
      } catch (e: unknown) {
        if (e instanceof TRPCError) throw e;
        await refundCreditsForDeductAmount(
          ctx.user.id,
          "漫剧资产图重出异常退还",
          deduct,
          "manhuaAssetStill",
        );
        const msg = e instanceof Error ? e.message : "资产图重出失败";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: /积分已退还/.test(msg) ? msg : `${msg}（积分已退还）`,
        });
      }
    }),

  /**
   * 换用公有库里那张：不生图，但照收费——拿走的是别人贡献的成品。
   * 只扣费并回报单价，图片写回哪个位置由客户端处理。
   */
  useLibraryAsset: protectedProcedure
    .input(
      z.object({
        role: roleSchema,
        imageUrl: z.string().url(),
        tileCount: z.number().int().min(1).max(24),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cost = quoteManhuaAssetRegenCredits(input.tileCount);
      const deduct = await deductCreditsAmount(
        ctx.user.id,
        cost,
        "manhuaAssetStill",
        `漫剧资产图·${input.role}·用库内资产（${input.tileCount} 张）`,
      ).catch((e: unknown) => {
        throw new TRPCError({
          code: "PAYMENT_REQUIRED",
          message: e instanceof Error ? e.message : "积分不足",
        });
      });
      return {
        ok: true as const,
        imageUrl: input.imageUrl,
        creditsCharged: deduct.cost,
        role: input.role as ManhuaAssetStillRole,
      };
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
});
