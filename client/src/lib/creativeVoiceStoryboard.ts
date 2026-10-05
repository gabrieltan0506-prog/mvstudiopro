import { getBlockEpisodeIndex, runManhuaDramaFactoryPipeline, resolveShotsForEpisodeKeyartsResult, expandManhuaShotKeyartsAfterReverse } from "./canvasDramaStudio";
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
};

/** 候选绑定完整画布和当前正文，任何编辑都会要求重新核对，不能覆盖新稿。 */
export function voiceStoryboardSource(blocks: CanvasBlock[], edges: CanvasEdge[], body: string): string {
  return JSON.stringify({ blocks, edges, body });
}

export function saveVoiceStoryboard(storage: Pick<Storage, "setItem" | "getItem">, key: string, candidate: VoiceStoryboardCandidate): void {
  const json = JSON.stringify(candidate);
  storage.setItem(key, json);
  if (storage.getItem(key) !== json) throw new Error("分镜候选未完整保存，原稿未修改。");
}

export function requireVoiceStoryboardCandidate(candidate: VoiceStoryboardCandidate | null, scope: string, episode: number, source: string): VoiceStoryboardCandidate & { text: string; blocks: CanvasBlock[]; edges: CanvasEdge[] } {
  if (!candidate || candidate.scope !== scope || candidate.episode !== episode || candidate.status !== "ready" || !candidate.text?.trim() || !candidate.blocks?.length || !candidate.edges) throw new Error("没有当前作品本集可采用的完整分镜候选。");
  if (candidate.source !== source) throw new Error("候选生成后原稿或画布已变化，未覆盖新版本；请先核对候选。");
  return candidate as VoiceStoryboardCandidate & { text: string; blocks: CanvasBlock[]; edges: CanvasEdge[] };
}

/** 仅运行本集文字反推；模型结果通过原分镜校验后，才产生可采用的图数据。 */
export async function generateVoiceStoryboardGraph(input: {
  graph: {blocks: CanvasBlock[]; edges: CanvasEdge[]}; episode: number; body: string; question: string;
  deps: Parameters<typeof runManhuaDramaFactoryPipeline>[0]["deps"];
  ensureOptions: Parameters<typeof runManhuaDramaFactoryPipeline>[0]["ensureOptions"];
  signal: AbortSignal;
}): Promise<{text: string; blocks: CanvasBlock[]; edges: CanvasEdge[]}> {
  const {graph, episode, body, question, deps, ensureOptions, signal} = input;
  const reverse = graph.blocks.find(b => !b.archivedFromPreviousScript && b.id.startsWith("reverse-") && (getBlockEpisodeIndex(b) ?? 1) === episode);
  if (!reverse) throw new Error("本集分镜生产节点未就绪，未提交。");
  const prepared = graph.blocks.map(b => b.id === reverse.id ? {...b, prompt:`${b.prompt}\n\n【本次用户分镜要求】\n${question}\n【本集已确认正文】\n${body}\n以本集已确认正文为准，输出完整分镜，不只给建议。`, outputText:undefined, status:"idle" as const, error:undefined} : b);
  const result = await runManhuaDramaFactoryPipeline({deps,blocks:prepared,edges:graph.edges,untilStage:"reverse",episodeIndex:episode,targetBlockIds:[reverse.id],forceFromStage:"reverse",skipDone:false,maxRetries:0,stopOnError:true,ensureOptions,signal});
  const produced = result.blocks.find(b => b.id === reverse.id);
  const text = produced?.outputText?.trim();
  if (result.errors.length || !result.completedIds.includes(reverse.id) || !text || !produced) throw new Error(result.errors.map(e=>e.message).join("；") || "未取得完整分镜，原稿保留。");
  const parsed = resolveShotsForEpisodeKeyartsResult([produced], episode);
  if (parsed.isFallback || parsed.sourceErrors.length || !parsed.shots.length) throw new Error("本次分镜输出不完整或秒位无效，原稿保留。");
  // 消费者优先读 beats；新反推与节拍必须指向同一份已验证输出。
  const coherent = result.blocks.map(b => b.id.startsWith("beats-") && (getBlockEpisodeIndex(b) ?? 1) === episode ? {...b,outputText:text,status:"done" as const,error:undefined} : b);
  const expanded = expandManhuaShotKeyartsAfterReverse(coherent, graph.edges, reverse.id, ensureOptions);
  // 旧流水线末尾会布局整张画布；语音本集候选不能改动其他集的位置或内容。
  const belongs = (b: CanvasBlock) => (getBlockEpisodeIndex(b) ?? 1) === episode;
  const original = new Map(graph.blocks.map(b => [b.id,b]));
  const blocks = expanded.blocks.filter(b => original.has(b.id) || belongs(b)).map(b => belongs(b) ? b : original.get(b.id)!);
  const selectedIds = new Set(blocks.filter(belongs).map(b=>b.id));
  const touches = (e: CanvasEdge) => selectedIds.has(e.fromId) || selectedIds.has(e.toId);
  const edges = [...graph.edges.filter(e=>!touches(e)),...expanded.edges.filter(touches)];
  return {blocks,edges,text};
}
