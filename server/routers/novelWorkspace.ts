import {
  writeNovelWorkspaceBackup,
  listNovelWorkspaceBackups,
  readNovelWorkspaceBackup,
} from "../services/novelWorkspaceBackup";
import { z } from "zod";
import {
  readNovelWorkspaceReceipt,
  readSavedNovelRaw,
  recoverSavedNovelChapter,
  listRecoverableNovelChapters,
} from "../services/novelWorkspaceTest";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { novelTestInputSchema } from "../../shared/novelWorkspace";
import { runNovelWorkspaceTest, runNovelImitationSkeleton } from "../services/novelWorkspaceTest";
import { deleteNovelImitationLibraryEntry, listNovelImitationLibrary } from "../services/novelImitationLibrary";
import { novelModelSchema } from "../../shared/novelWorkspace";
import { NOVEL_IMITATION_BASE_MAX_CHARS } from "../../shared/novelImitationPrompt";
export function assertNovelTestRole(role: string) {
  if (role !== "admin" && role !== "supervisor")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "小说改编当前仅开放管理者测试",
    });
}
const imitationSkeletonInputSchema = z
  .object({
    requestId: z.string().uuid(),
    baseText: z.string().trim().min(80).max(NOVEL_IMITATION_BASE_MAX_CHARS),
    /** 底稿文件名 / 标题：只写进该用户的私有拆解证据，不进公共参考模板。 */
    baseTitle: z.string().trim().max(200).optional(),
    modelPreference: novelModelSchema.optional(),
  })
  .strict();
export const novelWorkspaceRouter = router({
  backup: protectedProcedure
    .input(z.object({ workspaceJson: z.string().max(30_000_000) }))
    .mutation(({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      return writeNovelWorkspaceBackup(ctx.user.id, input.workspaceJson);
    }),
  listBackups: protectedProcedure.query(({ ctx }) => {
    assertNovelTestRole(ctx.user.role);
    return listNovelWorkspaceBackups(ctx.user.id);
  }),
  readBackup: protectedProcedure
    .input(z.object({ backupId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      return readNovelWorkspaceBackup(ctx.user.id, input.backupId);
    }),
  recoverableChapters: protectedProcedure
    .input(z.object({ roundId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      return listRecoverableNovelChapters(ctx.user.id, input.roundId);
    }),
  recoverSavedChapter: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      return recoverSavedNovelChapter(ctx.user.id, input.requestId);
    }),
  savedRaw: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      return readSavedNovelRaw(ctx.user.id, input.requestId);
    }),
  receipt: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      return readNovelWorkspaceReceipt(ctx.user.id, input.requestId);
    }),
  /** 爆款仿写：底稿结构拆解（同一底稿按内容摘要与线路缓存，不重复拆）。 */
  imitationSkeleton: protectedProcedure
    .input(imitationSkeletonInputSchema)
    .mutation(({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      return runNovelImitationSkeleton(ctx.user.id, input);
    }),
  /**
   * 底稿结构拆解（后台任务，1112）：发起即返回任务标识与分片进度；同一账号 + 底稿 + 线路复用进行中 / 已完成任务。
   * 上面的同步接口保留，兼容已缓存的旧前端。
   */
  imitationSkeletonStart: protectedProcedure
    .input(imitationSkeletonInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      const { novelImitationSkeletonTasks } = await import("../services/novelImitationSkeletonTasks");
      return novelImitationSkeletonTasks().start(ctx.user.id, input);
    }),
  /** 只返回本人任务；未知（含服务重启后）返回 missing，前台用同一底稿重新发起。 */
  imitationSkeletonStatus: protectedProcedure
    .input(z.object({ taskId: z.string().regex(/^[0-9a-f]{32}$/) }).strict())
    .query(async ({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      const { novelImitationSkeletonTasks } = await import("../services/novelImitationSkeletonTasks");
      return novelImitationSkeletonTasks().status(ctx.user.id, input.taskId) ?? { status: "missing" as const, taskId: input.taskId };
    }),
  /** 拆书参考模板（公共库）：所有登录用户可读；不返回上传者与底稿溯源字段。 */
  imitationLibrary: protectedProcedure.query(() => listNovelImitationLibrary()),
  /** 删除公共库里的一条：仅管理员。 */
  deleteImitationLibrary: adminProcedure
    .input(z.object({ id: z.string().trim().min(1).max(80) }).strict())
    .mutation(({ input }) => deleteNovelImitationLibraryEntry(input.id)),
  generate: protectedProcedure
    .input(novelTestInputSchema)
    .mutation(({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      return runNovelWorkspaceTest(ctx.user.id, input, { role: ctx.user.role });
    }),
  /** 创意环节：本作品已用次数与下一次价格（前两次免费，第三次起每次 20 积分；计次存服务端）。 */
  creativePremiseUsage: protectedProcedure
    .input(z.object({ workId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      const { defaultNovelCreativePremiseBillingDeps, readNovelCreativePremiseUsage } = await import(
        "../services/novelCreativePremiseBilling"
      );
      return readNovelCreativePremiseUsage(ctx.user.id, input.workId, ctx.user.role, defaultNovelCreativePremiseBillingDeps());
    }),
});
