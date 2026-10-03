import { z } from "zod";
import { readNovelWorkspaceReceipt } from "../services/novelWorkspaceTest";
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
