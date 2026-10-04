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
                  if (event.type === "toolRejected") {
                    if (toolIds.has(event.id)) return; toolIds.add(event.id);
                    upstream?.send({toolResponse:{functionResponses:[{id:event.id,name:event.name,response:{error:event.text}}]}}); return;
                  }
                  if (event.type === "tool" || event.type === "workflow" || event.type === "mediaEdit" || event.type === "filmReview" || event.type === "novelEdit" || event.type === "production") {
                    if (toolIds.has(event.id)) return;
                    if (pendingTools.size) {
                      upstream?.send({ toolResponse: { functionResponses: [{ id: event.id, name: event.type === "tool" ? "askCreativeAdvisor" : event.type === "mediaEdit" ? "proposeMediaEdit" : event.type === "filmReview" ? "reviewFilm" : event.type === "novelEdit" ? "novelText" : event.type === "production" ? "creativeProduction" : "creativeWorkflow", response: { error: "已有顾问任务正在处理，请等待结果，不要重复提交。" } }] } }); return;
                    }
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
            upstream.send({ toolResponse: { functionResponses: [{ id: msg.id, name, response: { result: msg.text } }] } });
          }
          if (msg.type === "text") upstream.send({ realtimeInput: { text: msg.text } });
          if (msg.type === "audio") upstream.send({ realtimeInput: { audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" } } });
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
