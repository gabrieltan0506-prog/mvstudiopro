import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
/** ws 运行时已是项目依赖；显式声明本模块用到的接口，避免把凭证注入浏览器SDK。 */
export interface VoiceSocket extends EventEmitter {
  readyState: number; bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}
export interface VoiceSocketServer extends EventEmitter {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, cb: (ws: VoiceSocket) => void): void;
  close(): void;
}
const runtime = createRequire(import.meta.url)("ws") as {
  new(url: string, options: { headers: Record<string, string>; handshakeTimeout: number; maxPayload: number }): VoiceSocket;
  WebSocketServer: new(options: { noServer: boolean; maxPayload: number }) => VoiceSocketServer;
};
export const createVoiceSocket = (url: string, headers: Record<string, string>) => new runtime(url, { headers, handshakeTimeout: 15000, maxPayload: 2 * 1024 * 1024 });
export const createVoiceSocketServer = () => new runtime.WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
