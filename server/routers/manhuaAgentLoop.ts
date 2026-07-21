/**
 * tRPC: 创作顾问会话（代理 Python sidecar；sidecar 不可用时降级）。
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  bindManhuaAgentSession,
  callManhuaAgentSidecar,
  consumeManhuaAgentPendingAction,
  getManhuaAgentSessionOwner,
  isManhuaAgentSidecarConfigured,
  listManhuaAgentPendingActions,
} from "../services/manhuaAgentLoopBridge";
import {
  mapAdvisorPlanToWorkbenchSync,
  type ManhuaAdvisorPlanExport,
} from "../../shared/manhuaAgentLoopSync";

export const manhuaAgentLoopRouter = router({
  status: protectedProcedure.query(() => ({
    available: isManhuaAgentSidecarConfigured(),
    labelZh: "创作顾问",
  })),

  createSession: protectedProcedure
    .input(
      z
        .object({
          idea: z.string().max(8000).optional(),
          userRequirement: z.string().max(4000).optional(),
          style: z.string().max(500).optional(),
          projectName: z.string().max(64).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isManhuaAgentSidecarConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "创作顾问暂不可用，请使用工作台一键工厂",
        });
      }
      const result = await callManhuaAgentSidecar<{
        ok?: boolean;
        session?: { session_id?: string; sessionId?: string };
      }>("/session", {
        method: "POST",
        body: {
          idea: input?.idea || "",
          userRequirement: input?.userRequirement || "",
          style: input?.style || "",
          projectName: input?.projectName || "",
        },
      });
      if (!result.ok) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "创作顾问暂时连不上，请稍后重试或使用一键工厂",
        });
      }
      const sessionId = String(
        result.data.session?.session_id || result.data.session?.sessionId || "",
      );
      if (!sessionId) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "会话创建失败" });
      }
      bindManhuaAgentSession(ctx.user.id, sessionId);
      return { sessionId, available: true };
    }),

  getSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1).max(128) }))
    .query(async ({ ctx, input }) => {
      const owner = getManhuaAgentSessionOwner(input.sessionId);
      if (owner != null && owner !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
      }
      if (!isManhuaAgentSidecarConfigured()) {
        return {
          available: false as const,
          session: null,
          sync: null,
          pendingActions: listManhuaAgentPendingActions(input.sessionId),
        };
      }
      const result = await callManhuaAgentSidecar<{
        ok?: boolean;
        session?: Record<string, unknown>;
        plan?: ManhuaAdvisorPlanExport;
      }>(`/session/${encodeURIComponent(input.sessionId)}`);
      if (!result.ok) {
        if (result.status === 404) {
          throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
        }
        return {
          available: false as const,
          session: null,
          sync: null,
          pendingActions: listManhuaAgentPendingActions(input.sessionId),
        };
      }
      bindManhuaAgentSession(ctx.user.id, input.sessionId);
      const sync = mapAdvisorPlanToWorkbenchSync(result.data.plan);
      return {
        available: true as const,
        session: result.data.session || null,
        sync,
        pendingActions: listManhuaAgentPendingActions(input.sessionId),
      };
    }),

  chat: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1).max(128),
        message: z.string().min(1).max(12000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const owner = getManhuaAgentSessionOwner(input.sessionId);
      if (owner != null && owner !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
      }
      if (!isManhuaAgentSidecarConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "创作顾问暂不可用，请使用工作台一键工厂",
        });
      }
      bindManhuaAgentSession(ctx.user.id, input.sessionId);
      const result = await callManhuaAgentSidecar<{
        ok?: boolean;
        assistant?: string;
        plan?: ManhuaAdvisorPlanExport;
        toolResults?: unknown[];
        session?: Record<string, unknown>;
      }>("/chat", {
        method: "POST",
        body: { sessionId: input.sessionId, message: input.message, resume: true },
      });
      if (!result.ok) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "创作顾问回复失败，请稍后重试",
        });
      }
      const sync = mapAdvisorPlanToWorkbenchSync(result.data.plan);
      return {
        assistant: String(result.data.assistant || ""),
        sync,
        toolResults: result.data.toolResults || [],
        session: result.data.session || null,
        pendingActions: listManhuaAgentPendingActions(input.sessionId),
      };
    }),

  runIdeaPlan: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1).max(128).optional(),
        idea: z.string().min(1).max(8000),
        userRequirement: z.string().max(4000).optional(),
        style: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isManhuaAgentSidecarConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "创作顾问暂不可用，请使用工作台一键工厂",
        });
      }
      const result = await callManhuaAgentSidecar<{
        ok?: boolean;
        sessionId?: string;
        assistant?: string;
        plan?: ManhuaAdvisorPlanExport;
      }>("/run-idea2video-plan", {
        method: "POST",
        body: {
          sessionId: input.sessionId,
          idea: input.idea,
          userRequirement: input.userRequirement || "",
          style: input.style || "竖屏漫剧，电影感连贯",
        },
      });
      if (!result.ok) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "规划失败，请稍后重试或使用一键工厂",
        });
      }
      const sessionId = String(result.data.sessionId || input.sessionId || "");
      if (sessionId) bindManhuaAgentSession(ctx.user.id, sessionId);
      return {
        sessionId,
        assistant: String(result.data.assistant || ""),
        sync: mapAdvisorPlanToWorkbenchSync(result.data.plan),
        pendingActions: sessionId ? listManhuaAgentPendingActions(sessionId) : [],
      };
    }),

  consumePendingAction: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1).max(128),
        actionId: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const owner = getManhuaAgentSessionOwner(input.sessionId);
      if (owner != null && owner !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
      }
      const action = consumeManhuaAgentPendingAction(input.sessionId, input.actionId);
      if (!action) {
        throw new TRPCError({ code: "NOT_FOUND", message: "动作不存在或已处理" });
      }
      return { action };
    }),
});
