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
