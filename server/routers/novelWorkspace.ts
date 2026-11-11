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
    .input(
      z
        .object({
          requestId: z.string().uuid(),
          baseText: z.string().trim().min(80).max(NOVEL_IMITATION_BASE_MAX_CHARS),
          /** 底稿文件名 / 标题：只写进该用户的私有拆解证据，不进公共参考模板。 */
          baseTitle: z.string().trim().max(200).optional(),
          modelPreference: novelModelSchema.optional(),
        })
        .strict()
    )
    .mutation(({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      return runNovelImitationSkeleton(ctx.user.id, input);
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
      return runNovelWorkspaceTest(ctx.user.id, input);
    }),
});
