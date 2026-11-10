import type { Express } from "express";
import { appRouter } from "../routers";
import { createContext } from "../_core/context";
import { knowledgePublicationPublicError } from "../../shared/knowledgePublicationPublic";

const PROVIDER_NAME_RE = /gemini|glm|deepseek|seedance|evolink|byteplus|vertex|openrouter|qwen|gpt|claude|z-ai|flash|\bpro\b/i;
/** 发往浏览器的各跳标签：含模型/通道名即换成中性说法；空标签保持为空。 */
export function neutralAdvisorStreamLabel(label?: string): string {
  const text = String(label || "").trim();
  return text && PROVIDER_NAME_RE.test(text) ? "创作顾问" : text;
}

/** 流式入口复用原问答事务；额度、确认、幂等、退款与恢复只有一份实现。 */
export function registerManhuaAdvisorStream(app: Express) {
  app.post("/api/manhua-advisor/stream", async (req, res) => {
    const ctx = await createContext({ req, res, info: undefined as never });
    if (!ctx.user) {
      res.status(ctx.authUnavailable ? 503 : 401).json({ message: ctx.authUnavailable ? "登录服务暂时不可用，请稍后重试原问题" : "请先登录" });
      return;
    }
    if (!req.is("application/json") || (!req.body?.manhuaContext && !req.body?.knowledgePublicationContext)) {
      res.status(400).json({ message: "请从漫剧创作顾问提交当前项目问题" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    let connected = true;
    res.once("close", () => { connected = false; });
    const send = (event: string, data: unknown) => {
      if (connected && !res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (connected && !res.destroyed && !res.writableEnded) res.write(": heartbeat\n\n");
    }, 15_000);
    try {
      // 前台零技术泄漏：各跳标签若带模型/通道名，一律换成中性说法再发往浏览器（增量正文不动）。
      ctx.advisorStream = (event, text) => {
        if (req.body?.knowledgePublicationContext) return;
        send(event, { text: event === "reset" ? neutralAdvisorStreamLabel(text) : text || "" });
      };
      // 断开浏览器只停止发送；事务继续落库，刷新后用原请求编号恢复，不重新扣费。
      const result = await appRouter.createCaller(ctx).mvAnalysis.askPlatformSkillQa(req.body);
      if (req.body?.knowledgePublicationContext) {
        const { modelName: _privateModel, ...publicResult } = result;
        send("result", publicResult);
      } else send("result", result);
    } catch (error) {
      // 前台只给业务提示；服务端日志保留真实原因（含根因链），排查不再只看到兜底文案。
      if (req.body?.knowledgePublicationContext) {
        const cause = error instanceof Error && error.cause instanceof Error ? ` ← ${error.cause.message}` : "";
        console.warn("[knowledgePublication] 顾问流失败：", String(error instanceof Error ? error.message : error).replace(/(?:https?|gs):\/\/\S+/g, "[地址]").slice(0, 800) + cause.slice(0, 400));
      }
      send("error", req.body?.knowledgePublicationContext ? knowledgePublicationPublicError(error) : { message: error instanceof Error ? error.message : "顾问暂时无法回答，请恢复原问题" });
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  });
}
