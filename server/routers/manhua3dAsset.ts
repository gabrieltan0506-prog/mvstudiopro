/**
 * PR-3 · Lux3D 资产链路由：capability / import / getStatus / listByJob / adopt。
 * 鉴权与错误映射跟 routers/manhua3d.ts 同风格（adminProcedure = admin + supervisor）。
 * 没有任何入口会向 Lux3D 提交生成任务。
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc.js";
import {
  MANHUA_3D_ASSET_AXES,
  MANHUA_3D_ASSET_SOURCES,
  MANHUA_3D_ASSET_UNITS,
} from "../../shared/manhua3dAsset.js";
import {
  adoptManhua3dAsset,
  getManhua3dAsset,
  getManhua3dLux3dCapability,
  importManhua3dAsset,
  listManhua3dAssetsForJob,
} from "../services/manhua3dAssetTask.js";

const sourceJobId = z.string().trim().regex(/^m3d_[a-zA-Z0-9_.-]{1,150}$/, "来源任务身份无效");
const assetId = z.string().trim().regex(/^m3da_[a-zA-Z0-9_.-]{1,150}$/, "资产身份无效");

export function mapManhua3dAssetError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (message === "manhua3d_asset_store_unavailable") {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "三维资产存储暂不可用，请稍后再试" });
  }
  if (message === "manhua3d_asset_source_missing") {
    throw new TRPCError({ code: "NOT_FOUND", message: "本人已完成的三维任务或来源回执不存在，不能导入" });
  }
  if (message === "manhua3d_asset_not_found") {
    throw new TRPCError({ code: "NOT_FOUND", message: "三维资产记录不存在" });
  }
  if (message === "manhua3d_asset_forbidden") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只能操作本人的三维资产" });
  }
  if (message === "manhua3d_asset_not_verified") {
    throw new TRPCError({ code: "CONFLICT", message: "资产尚未通过校验（缺单位/轴向或被拒），不能采用" });
  }
  if (message === "invalid_manhua_3d_asset_input") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "三维资产导入参数无效" });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "三维资产处理失败，请稍后再试" });
}

export const manhua3dAssetRouter = router({
  /** 真实不可用态：无凭证 / 适配器未接。永远不代表可提交生成。 */
  capability: adminProcedure.query(() => getManhua3dLux3dCapability()),

  import: adminProcedure
    .input(
      z.object({
        sourceJobId,
        assetRef: z.string().trim().min(1).max(160),
        units: z.enum(MANHUA_3D_ASSET_UNITS).optional(),
        axis: z.enum(MANHUA_3D_ASSET_AXES).optional(),
        source: z.enum(MANHUA_3D_ASSET_SOURCES).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await importManhua3dAsset({ userId: ctx.user.id, ...input });
      } catch (error) {
        return mapManhua3dAssetError(error);
      }
    }),

  getStatus: adminProcedure.input(z.object({ assetId })).query(async ({ ctx, input }) => {
    try {
      const asset = await getManhua3dAsset(input.assetId, ctx.user.id);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "三维资产记录不存在" });
      return asset;
    } catch (error) {
      return mapManhua3dAssetError(error);
    }
  }),

  listByJob: adminProcedure.input(z.object({ sourceJobId })).query(async ({ ctx, input }) => {
    try {
      return await listManhua3dAssetsForJob(input.sourceJobId, ctx.user.id);
    } catch (error) {
      return mapManhua3dAssetError(error);
    }
  }),

  adopt: adminProcedure.input(z.object({ assetId })).mutation(async ({ ctx, input }) => {
    try {
      return await adoptManhua3dAsset(input.assetId, ctx.user.id);
    } catch (error) {
      return mapManhua3dAssetError(error);
    }
  }),
});
