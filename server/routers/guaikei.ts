import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { guaikeiNewRequestSchema, guaikeiSettingsSchema, guaikeiWindowSchema } from "@shared/guaikei";
import { guaikeiService } from "../growth/guaikei/service";
import { readGuaikeiBalance } from "../growth/guaikei/balance";
import { guaikeiAutomation } from "../growth/guaikei/automation";

// 共用付费Token仅供管理员使用；不继承监管角色的其他运维权限。
const paidResearchProcedure = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "付费数据采集仅限管理员" });
  return next({ ctx });
});
export const guaikeiRouter = router({
  balance: paidResearchProcedure.query(() => readGuaikeiBalance()),
  settings: paidResearchProcedure.query(() => guaikeiAutomation.settings()),
  saveSettings: paidResearchProcedure.input(guaikeiSettingsSchema).mutation(({ctx,input}) => guaikeiAutomation.save(ctx.user.id,input)),
  quote: paidResearchProcedure.input(guaikeiNewRequestSchema).query(({ input }) => guaikeiService.quote(input)),
  list: paidResearchProcedure.query(({ ctx }) => guaikeiService.list(ctx.user.id)),
  get: paidResearchProcedure.input(z.object({ id: z.string().uuid(), windowDays: guaikeiWindowSchema.default(15) })).query(({ ctx, input }) => guaikeiService.get(ctx.user.id, input.id, input.windowDays)),
  submit: paidResearchProcedure.input(z.object({ request: guaikeiNewRequestSchema, requestId: z.string().uuid(), confirmedReservedCents: z.number().int().min(0), refresh: z.boolean().default(false) }))
    .mutation(({ ctx, input }) => guaikeiService.submit(ctx.user.id, input.request, input.requestId, input.confirmedReservedCents, input.refresh)),
  poll: paidResearchProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ ctx, input }) => guaikeiService.poll(ctx.user.id, input.id)),
});
