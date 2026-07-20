import type { LucideIcon } from "lucide-react";
import { Clapperboard, FileText, Image as ImageIcon, LayoutTemplate, Video } from "lucide-react";
import type { ManhuaClipQualityReport } from "@shared/manhuaClipQuality";

export type CanvasBlockKind = "text" | "image" | "video" | "copy_organize" | "video_reverse";

/** 画布文本主力：GPT-5.6 Sol / Terra；Gemini 仅保留选项（知识截止约 2025-01-01，偏旧）。 */
export type CanvasTextModel =
  | "gpt-5.6-sol"
  | "gpt-5.6-terra"
  | "gemini-3.1-pro"
  | "gpt-5.5"
  | "gpt-5.4";

export const DEFAULT_CANVAS_TEXT_MODEL: CanvasTextModel = "gpt-5.6-sol";

const CANVAS_TEXT_MODEL_IDS: CanvasTextModel[] = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gemini-3.1-pro",
  "gpt-5.5",
  "gpt-5.4",
];

export function normalizeCanvasTextModel(raw: unknown): CanvasTextModel {
  const key = String(raw || "").trim();
  if ((CANVAS_TEXT_MODEL_IDS as string[]).includes(key)) return key as CanvasTextModel;
  // 旧画布别名
  if (key === "gpt56sol" || key === "gpt-5.6") return "gpt-5.6-sol";
  if (key === "gpt56terra") return "gpt-5.6-terra";
  return DEFAULT_CANVAS_TEXT_MODEL;
}
export type CanvasImageModel = "nano-banana-2" | "gpt-image-2";
export type CanvasVideoModel = "gemini-omni-flash" | "seedance-2.0";
/** 文生图 vs 改图（EvoLink image_urls edit） */
export type CanvasImageMode = "generate" | "edit";

export type CanvasBlockStatus = "idle" | "running" | "done" | "error";

export type CanvasAssetKind = "image" | "video" | "document";

export type CanvasUploadedAsset = {
  id: string;
  url: string;
  previewUrl: string;
  fileName: string;
  gcsUri?: string;
  kind?: CanvasAssetKind;
  mimeType?: string;
};

export type CanvasUploadFailure = {
  fileName: string;
  error: string;
};

export type CanvasUploadPhase = "idle" | "uploading" | "done" | "error";

/** 画布上传：input accept + 用户可见格式说明 */
export const CANVAS_UPLOAD_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/quicktime,video/webm,.pdf,.txt,.md,.markdown,.heic,.heif";

export const CANVAS_UPLOAD_FORMAT_HINT =
  "支持 JPG / PNG / WebP / GIF / HEIC、MP4 / MOV / WebM；文档 PDF / TXT / MD（供文本·整理文案方块引用）";

export type CanvasImageBatchCount = 1 | 2 | 4;

export const CANVAS_BLOCK_DEFAULT_WIDTH = 420;
export const CANVAS_BLOCK_DEFAULT_HEIGHT = 360;
export const CANVAS_BLOCK_MIN_WIDTH = 300;
export const CANVAS_BLOCK_MIN_HEIGHT = 220;
export const CANVAS_BLOCK_MAX_WIDTH = 960;
export const CANVAS_BLOCK_MAX_HEIGHT = 800;

export type CanvasBlock = {
  id: string;
  kind: CanvasBlockKind;
  x: number;
  y: number;
  width: number;
  height: number;
  prompt: string;
  textModel: CanvasTextModel;
  imageModel: CanvasImageModel;
  videoModel: CanvasVideoModel;
  aspectRatio: "9:16" | "16:9";
  /** 图片方块：文生图 / 改图（需参考图） */
  imageMode: CanvasImageMode;
  /** 图片方块一次生成张数 */
  imageBatchCount: CanvasImageBatchCount;
  /**
   * 微调/改图：局部遮罩 PNG 公网 URL（透明=可改，不透明=保留）。
   * 由画笔工具导出并上传后写入。
   */
  editMaskUrl?: string;
  /**
   * 微调/改图：额外融合参考图 URL（不含底图；与底图合计最多 16 张）。
   * 通常从 uploadedAssets 勾选。
   */
  editFusionUrls?: string[];
  /** 本地上传素材（可多张，供下游文本/视频引用） */
  uploadedAssets: CanvasUploadedAsset[];
  /** 最近一次批量上传的失败项（便于在方块内展示） */
  uploadFailures?: CanvasUploadFailure[];
  /** 上传阶段（写入 block 以便顶栏/持久化可见，不依赖组件本地 state） */
  uploadPhase?: CanvasUploadPhase;
  uploadProgressDone?: number;
  uploadProgressTotal?: number;
  uploadStatusMessage?: string;
  parentId?: string;
  refImageUrl?: string;
  refVideoUrl?: string;
  outputText?: string;
  outputUrl?: string;
  /** 图片批量输出 URL 列表 */
  outputUrls: string[];
  status: CanvasBlockStatus;
  error?: string;
  /** 编导反推输出档：zh | en | compact */
  videoReverseOutputMode?: "zh" | "en" | "compact";
  /** 连载集号（多集铺板时挂在链上各节点，可序列化） */
  episodeIndex?: number;
  /** 本集标题（坞列表 / story 注释用） */
  episodeTitle?: string;
  /** 路径运镜配方 id（视频节点 I2V 优先） */
  pathCameraRecipeId?: string;
  /** 静帧路径标注 JSON（视频节点 I2V 优先于配方） */
  pathAnnotationJson?: unknown;
  /**
   * 漫剧成片智能质检（软拦）：failed 默认可预览、不进成片坞；
   * 用户「仍采用」后 quality.userAcceptedDespiteQc=true 才可合成。
   */
  manhuaClipQuality?: ManhuaClipQualityReport;
};

export type CanvasEdge = { fromId: string; toId: string };

export const CANVAS_KIND_META: Record<
  CanvasBlockKind,
  { label: string; hint: string; icon: LucideIcon; color: string }
> = {
  text: {
    label: "文本生成",
    hint: "脚本、旁白、品牌文案",
    icon: FileText,
    color: "from-violet-500/30 to-indigo-600/10",
  },
  image: {
    label: "图片生成",
    hint: "封面、海报、插图（JSON 导演中台→LLM 翻译后生图）",
    icon: ImageIcon,
    color: "from-emerald-500/30 to-teal-600/10",
  },
  video: {
    label: "视频生成",
    hint: "Gemini Omini / Seedance：有参考图时自动做运镜+微动+氛围减法",
    icon: Video,
    color: "from-sky-500/30 to-cyan-600/10",
  },
  copy_organize: {
    label: "整理文案",
    hint: "结构化提纲与发布稿",
    icon: LayoutTemplate,
    color: "from-amber-500/30 to-orange-600/10",
  },
  video_reverse: {
    label: "编导分镜/反推",
    hint: "有片拉片 / 无片按节拍补全编导分镜+微动句",
    icon: Clapperboard,
    color: "from-rose-500/30 to-fuchsia-600/10",
  },
};

export const TEXT_MODEL_OPTIONS: Array<{ id: CanvasTextModel; label: string }> = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol（主力）" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro（旧）" },
  { id: "gpt-5.5", label: "GPT 5.5" },
  { id: "gpt-5.4", label: "GPT 5.4" },
];

export const IMAGE_MODEL_OPTIONS: Array<{ id: CanvasImageModel; label: string }> = [
  { id: "gpt-image-2", label: "GPT-Image-2（默认·官方）" },
  { id: "nano-banana-2", label: "Nano Banana 2（手选省钱 / 失败回退）" },
];

export const VIDEO_MODEL_OPTIONS: Array<{ id: CanvasVideoModel; label: string }> = [
  { id: "gemini-omni-flash", label: "默认成片引擎" },
  { id: "seedance-2.0", label: "高画质成片（预留·完工验收）" },
];

export const SPAWN_KIND_OPTIONS: Array<{ kind: CanvasBlockKind; label: string; hint: string }> = [
  { kind: "text", label: "文本生成", hint: "脚本、广告词、品牌文案" },
  { kind: "image", label: "图片生成", hint: "JSON 导演中台→生图" },
  { kind: "video", label: "视频生成", hint: "Seedance/Omini · I2V 微动公式" },
  { kind: "video_reverse", label: "编导分镜/反推", hint: "有片拉片 / 无片按节拍补全" },
  { kind: "copy_organize", label: "整理文案", hint: "结构化发布稿" },
];

export function makeCanvasBlockId(prefix = "block") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultCanvasBlock(kind: CanvasBlockKind, x: number, y: number, parentId?: string): CanvasBlock {
  return {
    id: makeCanvasBlockId(kind),
    kind,
    x,
    y,
    parentId,
    prompt:
      kind === "copy_organize"
        ? "把以下零散要点整理成小红书发布稿 + 封面主副标 + 2×4 分镜提纲…"
        : kind === "text"
          ? "写一段 15 秒竖屏短视频旁白，语气自然、有钩子。"
          : kind === "image"
            ? "电影感竖屏封面，主体清晰，留白适合放标题。"
            : kind === "video_reverse"
              ? "反推分镜表与 Seedance 微动句；成稿去导演名。可先上传 ≤120s 参考短片。"
              : "镜头缓慢推进，主体动作自然，电影级光影。",
    textModel: DEFAULT_CANVAS_TEXT_MODEL,
    /** 官方 GPT-Image-2 主路径；手选 NB2 省钱直走，未选手选时失败可回退 NB2 */
    imageModel: "gpt-image-2",
    videoModel: "gemini-omni-flash",
    aspectRatio: "9:16",
    imageMode: "generate",
    width: CANVAS_BLOCK_DEFAULT_WIDTH,
    height: CANVAS_BLOCK_DEFAULT_HEIGHT,
    imageBatchCount: 1,
    uploadedAssets: [],
    outputUrls: [],
    status: "idle",
  };
}

export function normalizeCanvasBlock(block: CanvasBlock): CanvasBlock {
  const rawVideoModel = block.videoModel as string | undefined;
  const videoModel: CanvasVideoModel =
    rawVideoModel === "seedance-2.0"
      ? "seedance-2.0"
      : rawVideoModel === "veo-3.1"
        ? "gemini-omni-flash"
        : rawVideoModel === "gemini-omni-flash"
          ? "gemini-omni-flash"
          : "gemini-omni-flash";

  return {
    ...block,
    textModel: normalizeCanvasTextModel(block.textModel),
    videoModel,
    imageMode: block.imageMode === "edit" ? "edit" : "generate",
    width: block.width ?? CANVAS_BLOCK_DEFAULT_WIDTH,
    height: block.height ?? CANVAS_BLOCK_DEFAULT_HEIGHT,
    imageBatchCount: block.imageBatchCount ?? 1,
    editMaskUrl: block.editMaskUrl,
    editFusionUrls: Array.isArray(block.editFusionUrls)
      ? block.editFusionUrls.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 15)
      : [],
    uploadedAssets: block.uploadedAssets ?? [],
    uploadFailures: block.uploadFailures ?? [],
    uploadPhase: block.uploadPhase ?? "idle",
    uploadProgressDone: block.uploadProgressDone,
    uploadProgressTotal: block.uploadProgressTotal,
    uploadStatusMessage: block.uploadStatusMessage,
    outputUrls: block.outputUrls?.length
      ? block.outputUrls
      : block.outputUrl
        ? [block.outputUrl]
        : [],
    videoReverseOutputMode:
      block.videoReverseOutputMode === "en" || block.videoReverseOutputMode === "compact"
        ? block.videoReverseOutputMode
        : block.videoReverseOutputMode === "zh"
          ? "zh"
          : undefined,
    episodeIndex:
      typeof block.episodeIndex === "number" && Number.isFinite(block.episodeIndex) && block.episodeIndex >= 1
        ? Math.floor(block.episodeIndex)
        : undefined,
    episodeTitle: block.episodeTitle ? String(block.episodeTitle).trim().slice(0, 120) || undefined : undefined,
  };
}

export function resolveBlockHandoffText(block: CanvasBlock): string {
  const output = block.outputText?.trim();
  if (output) return output;
  return block.prompt?.trim() || "";
}

function buildCanvasIncomingMap(
  blocks: CanvasBlock[],
  edges: Array<{ fromId: string; toId: string }>,
): Map<string, string[]> {
  const blockIds = new Set(blocks.map((b) => b.id));
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (!blockIds.has(edge.fromId) || !blockIds.has(edge.toId)) continue;
    incoming.set(edge.toId, [...(incoming.get(edge.toId) ?? []), edge.fromId]);
  }
  return incoming;
}

function getCanvasDirectPredecessors(
  blockId: string,
  blockMap: Map<string, CanvasBlock>,
  incoming: Map<string, string[]>,
): string[] {
  const preds = [...(incoming.get(blockId) ?? [])];
  const parentId = blockMap.get(blockId)?.parentId;
  if (parentId && parentId !== blockId && blockMap.has(parentId)) {
    preds.push(parentId);
  }
  return Array.from(new Set(preds));
}

/**
 * 沿连线图递归收集所有上游方块 id（含多级 A→B→C… 与 parentId 链），
 * 返回拓扑序：最远上游在前，直接相邻上游在后。
 */
export function collectUpstreamBlockIds(
  blockId: string,
  blocks: CanvasBlock[],
  edges: Array<{ fromId: string; toId: string }>,
): string[] {
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  if (!blockMap.has(blockId)) return [];

  const incoming = buildCanvasIncomingMap(blocks, edges);
  const ordered: string[] = [];
  const visited = new Set<string>();

  const dfsUpstream = (id: string, stack: Set<string>) => {
    if (stack.has(id)) return;
    if (visited.has(id)) return;
    stack.add(id);

    for (const pred of getCanvasDirectPredecessors(id, blockMap, incoming)) {
      dfsUpstream(pred, stack);
    }

    stack.delete(id);
    if (!visited.has(id)) {
      visited.add(id);
      ordered.push(id);
    }
  };

  for (const pred of getCanvasDirectPredecessors(blockId, blockMap, incoming)) {
    dfsUpstream(pred, new Set());
  }

  return ordered;
}

export type CanvasUpstreamHandoffItem = {
  blockId: string;
  kind: CanvasBlockKind;
  text: string;
};

/** 收集所有上游方块可传递内容（outputText 优先，否则 prompt）。 */
export function collectUpstreamHandoff(
  blockId: string,
  blocks: CanvasBlock[],
  edges: Array<{ fromId: string; toId: string }>,
): CanvasUpstreamHandoffItem[] {
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const seenText = new Set<string>();
  const items: CanvasUpstreamHandoffItem[] = [];

  for (const upstreamId of collectUpstreamBlockIds(blockId, blocks, edges)) {
    const block = blockMap.get(upstreamId);
    if (!block) continue;
    const text = resolveBlockHandoffText(block);
    if (!text || seenText.has(text)) continue;
    seenText.add(text);
    items.push({ blockId: upstreamId, kind: block.kind, text });
  }

  return items;
}

export function collectUpstreamTexts(
  blockId: string,
  blocks: CanvasBlock[],
  edges: Array<{ fromId: string; toId: string }>,
): string[] {
  return collectUpstreamHandoff(blockId, blocks, edges).map((item) => item.text);
}

/** 仅图片可进多模态 vision；文档/视频绝不能误标为 image/* */
export function isCanvasVisionImageAsset(asset: CanvasUploadedAsset): boolean {
  if (asset.kind === "document" || asset.kind === "video") return false;
  if (asset.kind === "image") return true;
  const name = `${asset.fileName || ""} ${asset.url || ""}`;
  if (/\.(pdf|txt|md|markdown)(\?|$)/i.test(name)) return false;
  if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(name)) return false;
  if (/\.(png|jpe?g|webp|gif|heic|heif)(\?|$)/i.test(name)) return true;
  if (asset.mimeType?.startsWith("image/")) return true;
  return false;
}

export function isCanvasDocumentAsset(asset: CanvasUploadedAsset): boolean {
  if (asset.kind === "document") return true;
  if (asset.kind === "image" || asset.kind === "video") return false;
  const name = `${asset.fileName || ""} ${asset.url || ""}`;
  if (/\.(pdf|txt|md|markdown)(\?|$)/i.test(name)) return true;
  if (asset.mimeType === "application/pdf" || asset.mimeType?.startsWith("text/")) return true;
  return false;
}

function visionMimeForAsset(asset: CanvasUploadedAsset): string {
  if (asset.mimeType?.startsWith("image/")) return asset.mimeType;
  const name = asset.fileName || "";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.gif$/i.test(name)) return "image/gif";
  return "image/jpeg";
}

function appendVisionFromBlock(
  block: CanvasBlock,
  seen: Set<string>,
  items: Array<{ url: string; gcsUri?: string; mimeType?: string }>,
) {
  const addAsset = (asset: CanvasUploadedAsset) => {
    if (!isCanvasVisionImageAsset(asset)) return;
    const key = asset.gcsUri || asset.url;
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push({
      url: asset.url,
      gcsUri: asset.gcsUri,
      mimeType: visionMimeForAsset(asset),
    });
  };

  const addUrl = (url: string) => {
    if (!url || seen.has(url)) return;
    // 生成结果若是视频 URL，勿当 vision 图
    if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) return;
    seen.add(url);
    items.push({ url });
  };

  for (const asset of block.uploadedAssets ?? []) addAsset(asset);
  if (block.outputUrls?.length) {
    for (const u of block.outputUrls) addUrl(u);
  } else if (block.outputUrl) {
    addUrl(block.outputUrl);
  }
  if (block.refImageUrl) addUrl(block.refImageUrl);
}

function appendDocumentsFromBlock(
  block: CanvasBlock,
  seen: Set<string>,
  items: CanvasUploadedAsset[],
) {
  for (const asset of block.uploadedAssets ?? []) {
    if (!isCanvasDocumentAsset(asset)) continue;
    const key = asset.gcsUri || asset.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(asset);
  }
}

/** 本块 + 上游链上的文档素材（TXT/MD/PDF），供文本·整理文案读取正文 */
export function collectDocumentAssets(
  blockId: string,
  blocks: CanvasBlock[],
  edges: Array<{ fromId: string; toId: string }>,
): CanvasUploadedAsset[] {
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const items: CanvasUploadedAsset[] = [];

  const self = blockMap.get(blockId);
  if (self) appendDocumentsFromBlock(self, seen, items);

  for (const upstreamId of collectUpstreamBlockIds(blockId, blocks, edges)) {
    const upstream = blockMap.get(upstreamId);
    if (upstream) appendDocumentsFromBlock(upstream, seen, items);
  }

  return items;
}

export function collectVisionImages(
  blockId: string,
  blocks: CanvasBlock[],
  edges: Array<{ fromId: string; toId: string }>,
): Array<{ url: string; gcsUri?: string; mimeType?: string }> {
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const items: Array<{ url: string; gcsUri?: string; mimeType?: string }> = [];

  const self = blockMap.get(blockId);
  if (self) appendVisionFromBlock(self, seen, items);

  for (const upstreamId of collectUpstreamBlockIds(blockId, blocks, edges)) {
    const upstream = blockMap.get(upstreamId);
    if (upstream) appendVisionFromBlock(upstream, seen, items);
  }

  return items;
}

/** 沿连线 BFS 找最近一级上游的图片/视频输出，供图生图、图生视频作参考。 */
export function resolveNearestUpstreamImageUrl(
  blockId: string,
  blocks: CanvasBlock[],
  edges: Array<{ fromId: string; toId: string }>,
): string | undefined {
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const incoming = buildCanvasIncomingMap(blocks, edges);

  const pickFromBlock = (block: CanvasBlock): string | undefined =>
    block.outputUrls?.find(Boolean) || block.outputUrl || block.refImageUrl;

  const queue: string[] = getCanvasDirectPredecessors(blockId, blockMap, incoming);
  const seen = new Set<string>([blockId]);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);

    const block = blockMap.get(id);
    if (!block) continue;

    const url = pickFromBlock(block);
    if (url) return url;

    for (const pred of getCanvasDirectPredecessors(id, blockMap, incoming)) {
      if (!seen.has(pred)) queue.push(pred);
    }
  }

  return undefined;
}
