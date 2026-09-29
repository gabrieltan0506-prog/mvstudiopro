import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { withLongJobsFlyDirect, flyHealthProbeOriginForUrl } from "./longJobsFlyOrigin";
import { withFlyHealthGate } from "./flyHealthGate";

type Input = inferRouterInputs<AppRouter>["mvAnalysis"]["askPlatformSkillQa"];
type Result = inferRouterOutputs<AppRouter>["mvAnalysis"]["askPlatformSkillQa"];

/** 只提取可读字符串的已收到部分，未闭合的转义留待下一块；绝不把它当作可应用候选。 */
export function partialJsonString(text: string, key: string): string {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(text);
  if (!match) return "";
  let out = "";
  for (let i = match.index + match[0].length; i < text.length; i++) {
    const c = text[i];
    if (c === '"') break;
    if (c !== "\\") { out += c; continue; }
    if (++i >= text.length) break;
    const e = text[i];
    if (e === "u") {
      const hex = text.slice(i + 1, i + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16)); i += 4;
    } else {
      const decoded: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };
      if (!(e in decoded)) break;
      out += decoded[e];
    }
  }
  return out;
}
export function readableAdvisorStream(raw: string, previs: boolean): string {
  const answer = partialJsonString(raw, "answer");
  return previs ? partialJsonString(answer, "summaryZh") : answer;
}

export async function streamManhuaAdvisor(input: Input, onText: (text: string) => void, onModel?: (label: string) => void): Promise<Result> {
  const url = withLongJobsFlyDirect("/api/manhua-advisor/stream");
  const response = await withFlyHealthGate(flyHealthProbeOriginForUrl(url), () => fetch(url, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(input),
  }));
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || `顾问连接失败（${response.status}），请恢复原问题`);
  }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("顾问流式连接未建立，请恢复原问题");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", raw = "";
  let result: Result | undefined;
  const handle = (frame: string) => {
    const lines = frame.split("\n");
    const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
    const payload = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!payload) return;
    const data = JSON.parse(payload);
    if (event === "error") throw new Error(data.message || "顾问返回失败，请恢复原问题");
    if (event === "reset") { raw = ""; onText(""); if (typeof data.text === "string" && data.text) onModel?.(data.text); }
    if (event === "delta") { raw += String(data.text || ""); if (raw.length > 4 * 1024 * 1024) throw new Error("顾问输出超过处理范围，请恢复原问题"); onText(readableAdvisorStream(raw, Boolean(input.manhuaContext?.previsEdit))); }
    if (event === "result") {
      if (typeof data.answer !== "string" || !data.answer.trim() || typeof data.remainingFreeToday !== "number") throw new Error("顾问回执不完整，请恢复原问题");
      result = data;
    }
  };
  try {
    while (!result) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) { handle(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
      if (done) break;
    }
    if (!result) throw new Error("连接中断，尚未收到完整回执；请恢复原问题，不要重复提交");
    return result;
  } finally { await reader.cancel().catch(() => undefined); }
}
