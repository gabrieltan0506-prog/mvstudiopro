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
  /** 原始提交关系不随候选重建改变。 */
  requestSource?: string;
  requestInput?: unknown;
  resultState?: "returned" | "failed" | "unknown";
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

/** 旧同步候选只有完整 text；不能继续依赖旧异步 taskId 才允许恢复。 */
export function voiceStoryboardResultState(candidate: VoiceStoryboardCandidate): "returned" | "failed" | "unknown" {
  if (candidate.text?.trim() || candidate.resultState === "returned" || candidate.upstreamStatus === "succeeded") return "returned";
  if (candidate.resultState === "failed" || candidate.upstreamStatus === "failed") return "failed";
  return "unknown";
}

/** 已知终态先完整归档才能解除阻断；未知/在途请求不能借此重复收费。 */
export function archiveVoiceStoryboard(storage: Pick<Storage,"setItem"|"getItem"|"removeItem">, key: string, id: string, scope: string): void {
  const raw = storage.getItem(key);
  const candidate: VoiceStoryboardCandidate | null = raw ? JSON.parse(raw) : null;
  if (!candidate || candidate.id !== id || candidate.scope !== scope || voiceStoryboardResultState(candidate) === "unknown") throw new Error("原请求归属不符或结果未知，不能解除后重新生成。");
  saveVoiceStoryboard(storage, `${key}:history:${candidate.id}:archived:${crypto.randomUUID()}`, candidate);
  if (storage.getItem(key) !== raw) throw new Error("原请求已变化，归档保留但未解除当前请求。");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("原请求记录未解除，不能重新生成。");
}
