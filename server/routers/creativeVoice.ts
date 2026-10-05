import type { Server } from "node:http";
import type { Request } from "express";
import { sdk } from "../_core/sdk";
import { creativeVoiceInputSchema, voiceNeedsExtended, type CreativeVoiceEvent } from "../../shared/creativeVoice";
import { connectCreativeVoiceWithFallback } from "../services/creativeVoiceFallback";
import { connectVoiceTransport, type CreativeVoiceSession } from "../services/creativeVoiceTransport";
import { createVoiceSocketServer } from "../services/creativeVoiceSocket";
export function allowedVoiceOrigin(raw: string | undefined, production = process.env.NODE_ENV === "production"): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return ["https://mvstudiopro.com", "https://www.mvstudiopro.com", "https://api.mvstudiopro.com"].includes(url.origin)
      || (!production && ["localhost", "127.0.0.1"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol));
  } catch { return false; }
}
export function registerCreativeVoice(server: Server) {
  const wss = createVoiceSocketServer();
  const activeUsers = new Set<number>();
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.split("?")[0] !== "/api/creative-voice/socket") return;
    if (!allowedVoiceOrigin(req.headers.origin)) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    const deadline = setTimeout(() => socket.destroy(), 15000);
    void (async () => {
      const user = await sdk.authenticateRequest(req as Request, { silentMissing: true });
      if (socket.destroyed) return;
      if (!["admin", "supervisor"].includes(user.role) || activeUsers.has(user.id)) {
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return;
      }
      try { wss.handleUpgrade(req, socket, head, client => {
        activeUsers.add(user.id);
        let latestTypedRequest = "";
        const readTools = new Set<string>();
        const operationKeys = new Map<string,string>();
        const repeatedReads = new Map<string, { text: string; count: number }>();
        let starting = false, upstream: CreativeVoiceSession | undefined, stopped = false;
        let lastActivity = Date.now(), lastFrame = 0, windowStart = Date.now(), bytesInWindow = 0;
        const cancel = new AbortController();
        const toolIds = new Set<string>(); const pendingTools = new Map<string, string>();
        const send = (event: CreativeVoiceEvent) => {
          if (client.readyState !== 1) return;
          if (client.bufferedAmount > 1024 * 1024) { stop(); return; }
          client.send(JSON.stringify(event));
        };
        const stop = () => {
          if (stopped) return; stopped = true; clearInterval(idle); cancel.abort(); upstream?.close();
          activeUsers.delete(user.id); client.close(1000, "stopped");
        };
        const idle = setInterval(() => {
          if (!pendingTools.size && Date.now() - lastActivity > 90000) { send({ type: "status", text: "空闲连接已关闭，可重新开始" }); stop(); }
        }, 5000);
        client.on("close", stop); client.on("error", stop);
        client.on("message", (bytes: Buffer) => {
          if (stopped) return;
          const now = Date.now();
          if (now - windowStart >= 1000) { windowStart = now; bytesInWindow = 0; }
          bytesInWindow += bytes.length;
          if (bytesInWindow > 600000) { send({ type: "error", text: "输入过快，连接已停止" }); stop(); return; }
          let raw: unknown;
          try { raw = JSON.parse(bytes.toString()); } catch { stop(); return; }
          const parsed = creativeVoiceInputSchema.safeParse(raw);
          if (!parsed.success) { send({ type: "error", text: "语音输入格式不正确，已停止" }); stop(); return; }
          const msg = parsed.data; lastActivity = now;
          if (msg.type === "stop") { stop(); return; }
          if (msg.type === "start") {
            if (starting) { send({ type: "error", text: "此连接已开始，请先结束" }); return; }
            starting = true;
            void connectCreativeVoiceWithFallback({ extended: voiceNeedsExtended(msg.purpose), signal: cancel.signal,
              onRoute: (plan, fallback) => send({ type: "route", route: plan.route, model: plan.model, fallback }),
              connect: (plan, signal) => connectVoiceTransport({ plan, signal, context: msg.context,
                onEvent: event => {
                  lastActivity = Date.now();
                  if (event.type === "text" && event.role === "user") repeatedReads.clear();
                  if (event.type === "toolRejected") {
                    if (toolIds.has(event.id)) return; toolIds.add(event.id);
                    upstream?.send({toolResponse:{functionResponses:[{id:event.id,name:event.name,response:{error:event.text}}]}}); return;
                  }
                  if (event.type === "tool" || event.type === "workflow" || event.type === "mediaEdit" || event.type === "filmReview" || event.type === "novelEdit" || event.type === "production") {
                    if (toolIds.has(event.id)) return;
                    if (pendingTools.size) {
                      upstream?.send({ toolResponse: { functionResponses: [{ id: event.id, name: event.type === "tool" ? "askCreativeAdvisor" : event.type === "mediaEdit" ? "proposeMediaEdit" : event.type === "filmReview" ? "reviewFilm" : event.type === "novelEdit" ? "novelText" : event.type === "production" ? "creativeProduction" : "creativeWorkflow", response: { error: "已有顾问任务正在处理，请等待结果，不要重复提交。" } }] } }); return;
                    }
                    const reading = (event.type === "workflow" || event.type === "production") && event.action.action === "inspect";
                    if (reading) readTools.add(event.id);
                    if (event.type === "production") operationKeys.set(event.id, JSON.stringify(event.action));
                    toolIds.add(event.id); pendingTools.set(event.id, event.type === "tool" ? "askCreativeAdvisor" : event.type === "mediaEdit" ? "proposeMediaEdit" : event.type === "filmReview" ? "reviewFilm" : event.type === "novelEdit" ? "novelText" : event.type === "production" ? "creativeProduction" : "creativeWorkflow");
                  }
                  send(event);
                }, onEnded: stop }),
            }).then(result => {
              if (stopped) { result.session.close(); return; }
              upstream = result.session; send({ type: "status", text: "已连接，可以说话或分享画面", ready: true });
            }).catch(() => { if (!stopped) { send({ type: "error", text: "语音服务未能建立连接，请核对服务或余额；尚未开始传送本轮音画。" }); stop(); } });
            return;
          }
          if (!upstream) { send({ type: "error", text: "请等待语音连接完成" }); return; }
          if (msg.type === "toolResult") {
            const name = pendingTools.get(msg.id); if (!name) return; pendingTools.delete(msg.id);
            let resultText: unknown = msg.text;
            const operationKey = operationKeys.get(msg.id); operationKeys.delete(msg.id);
            const reading = readTools.delete(msg.id);
            if (!reading && operationKey) {
              const key = `operation:${operationKey}`;
              const old = repeatedReads.get(key);
              const count = old?.text === msg.text ? old.count + 1 : 1;
              repeatedReads.set(key, {text:msg.text,count});
              if (count >= 3) { send({type:"error",text:"语音顾问重复操作且结果没有变化，已停止连接避免空耗；已有任务继续，不会自动重送。"}); stop(); return; }
            }
            if (reading) {
              const old = repeatedReads.get(name);
              const count = old?.text === msg.text ? old.count + 1 : 1;
              repeatedReads.set(name, { text: msg.text, count });
              if (count >= 3) { send({type:"error",text:"语音顾问重复读取相同状态，已停止本次连接以避免空耗；未自动重送生成任务，已有结果保留。"}); stop(); return; }
              if (count === 2) resultText = "页面状态与刚才相同，已读取完整资料。请执行本轮明确要求或说明阻断，不要再次inspect；需要用户确认时打开既有确认流程。";
              else {
                // Return structured tool data rather than repeatedly escaped JSON strings.
                try {
                  const value = JSON.parse(msg.text);
                  if (value && typeof value === "object" && !Array.isArray(value)) {
                    if (typeof value.context === "string") { try { value.context = JSON.parse(value.context); } catch { /* Plain context stays text. */ } }
                    resultText = value;
                  }
                } catch { /* Plain tool receipts stay text. */ }
              }
            }
            upstream.send({ toolResponse: { functionResponses: [{ id: msg.id, name, response: { result: resultText, ...(latestTypedRequest ? { currentUserRequest: latestTypedRequest } : {}) } }] } });
          }
          // Typed requests are complete conversation turns, not an unordered realtime stream.
          if (msg.type === "text") {
            latestTypedRequest = msg.text; repeatedReads.clear();
            upstream.send({ clientContent: { turns: [{ role: "user", parts: [{ text: msg.text }] }], turnComplete: true } });
          }
          if (msg.type === "audio") { latestTypedRequest = ""; upstream.send({ realtimeInput: { audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" } } }); }
          if (msg.type === "audioEnd") upstream.send({ realtimeInput: { audioStreamEnd: true } });
          if (msg.type === "frame") {
            if (now - lastFrame < 1000) return;
            const data = Buffer.from(msg.data, "base64");
            if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) { stop(); return; }
            lastFrame = now;
            upstream.send({ realtimeInput: { text: msg.still ? `用户分享静态分镜或资产「${msg.source}」，不是影片时间点。` : `用户分享播放器「${msg.source}」当前时间 ${msg.atSec.toFixed(2)} 秒，随后发送本时点画面。` } });
            upstream.send({ realtimeInput: { video: { data: msg.data, mimeType: "image/jpeg" } } });
          }
        });
      }); } catch { activeUsers.delete(user.id); socket.destroy(); }
    })().catch(() => { if (!socket.destroyed) socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n"); }).finally(() => clearTimeout(deadline));
  });
  server.once("close", () => wss.close());
}
