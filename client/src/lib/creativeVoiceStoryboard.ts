import { resolveUrlForLocalPersist } from "./manhuaLocalMediaStore";
import type { CanvasBlock, CanvasEdge } from "./canvasTypes";

export type VoiceStoryboardCandidate = {
  id: string;
  scope: string;
  episode: number;
  source: string;
  status: "pending" | "ready" | "failed";
  text?: string;
  blocks?: CanvasBlock[];
  edges?: CanvasEdge[];
  error?: string;
  question?: string;
  upstreamTaskId?: string;
  upstreamStatus?: "running" | "succeeded" | "failed";
};

/** 缓存显示地址与持久化指针沿原媒体库身份比较，真正换稿或换素材仍会冲突。 */
function normalizeSource(value: unknown): unknown {
  if (typeof value === "string") {
    if (/^(?:blob:|local-media:|https?:|\/assets\/|\/manhua-)/.test(value)) return resolveUrlForLocalPersist(value) || value;
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeSource);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([key, item]) =>
    item !== undefined && !(key === "uploadFailures" && Array.isArray(item) && !item.length)
  ).map(([key, item]) => [key, normalizeSource(item)]));
}
export function normalizeVoiceStoryboardSource(source: string): string {
  try {
    const parsed = JSON.parse(source);
    if (typeof parsed.body === "string") {
      try { parsed.body = JSON.parse(parsed.body); } catch { /* 旧纯文本正文保持原字。 */ }
    }
    return JSON.stringify(normalizeSource(parsed));
  } catch { return source; }
}
export function voiceStoryboardSource(blocks: CanvasBlock[], edges: CanvasEdge[], body: string): string {
  return normalizeVoiceStoryboardSource(JSON.stringify({ blocks, edges, body }));
}

export function saveVoiceStoryboard(storage: Pick<Storage, "setItem" | "getItem">, key: string, candidate: VoiceStoryboardCandidate): void {
  const json = JSON.stringify(candidate);
  storage.setItem(key, json);
  if (storage.getItem(key) !== json) throw new Error("分镜候选未完整保存，原稿未修改。");
}

export function requireVoiceStoryboardCandidate(candidate: VoiceStoryboardCandidate | null, scope: string, episode: number, source: string): VoiceStoryboardCandidate & { text: string; blocks: CanvasBlock[]; edges: CanvasEdge[] } {
  if (!candidate || candidate.scope !== scope || candidate.episode !== episode || candidate.status !== "ready" || !candidate.text?.trim() || !candidate.blocks?.length || !candidate.edges) throw new Error("没有当前作品本集可采用的完整分镜候选。");
  if (normalizeVoiceStoryboardSource(candidate.source) !== normalizeVoiceStoryboardSource(source)) throw new Error("候选生成后原稿或画布已变化，未覆盖新版本；请先核对候选。");
  return candidate as VoiceStoryboardCandidate & { text: string; blocks: CanvasBlock[]; edges: CanvasEdge[] };
}

/** 仅失败回执允许主动另开尝试；原请求完整归档后才解除本机阻断。 */
export function archiveFailedVoiceStoryboard(storage: Pick<Storage,"setItem"|"getItem"|"removeItem">, key: string, id: string): void {
  const raw = storage.getItem(key);
  const candidate: VoiceStoryboardCandidate | null = raw ? JSON.parse(raw) : null;
  if (!candidate || candidate.id !== id || candidate.status !== "pending" || !candidate.error || candidate.text || candidate.upstreamStatus !== "failed") throw new Error("原请求未失败或已有待保全结果，不能重新生成。");
  saveVoiceStoryboard(storage, `${key}:history:${candidate.id}`, candidate);
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("原请求记录未解除，不能重新生成。");
}
