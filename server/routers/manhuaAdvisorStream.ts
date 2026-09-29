import type { Express } from "express";
import { appRouter } from "../routers";
import { createContext } from "../_core/context";

/** 流式入口复用原问答事务；额度、确认、幂等、退款与恢复只有一份实现。 */
export function registerManhuaAdvisorStream(app: Express) {
  app.post("/api/manhua-advisor/stream", async (req, res) => {
    const ctx = await createContext({ req, res, info: undefined as never });
    if (!ctx.user) {
      res.status(ctx.authUnavailable ? 503 : 401).json({ message: ctx.authUnavailable ? "登录服务暂时不可用，请稍后重试原问题" : "请先登录" });
      return;
    }
    if (!req.is("application/json") || !req.body?.manhuaContext) {
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
      ctx.advisorStream = (event, text) => send(event, { text: text || "" });
      // 断开浏览器只停止发送；事务继续落库，刷新后用原请求编号恢复，不重新扣费。
      const result = await appRouter.createCaller(ctx).mvAnalysis.askPlatformSkillQa(req.body);
      send("result", result);
    } catch (error) {
      send("error", { message: error instanceof Error ? error.message : "顾问暂时无法回答，请恢复原问题" });
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  });
}
