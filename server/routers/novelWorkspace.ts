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
import { router, protectedProcedure } from "../_core/trpc";
import { novelTestInputSchema } from "../../shared/novelWorkspace";
import { runNovelWorkspaceTest } from "../services/novelWorkspaceTest";
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
  generate: protectedProcedure
    .input(novelTestInputSchema)
    .mutation(({ ctx, input }) => {
      assertNovelTestRole(ctx.user.role);
      return runNovelWorkspaceTest(ctx.user.id, input);
    }),
});
