import type { LucideIcon } from "lucide-react";
import { FileText, Image as ImageIcon, LayoutTemplate, Video } from "lucide-react";

export type CanvasBlockKind = "text" | "image" | "video" | "copy_organize";

export type CanvasTextModel = "gemini-3.1-pro" | "gpt-5.5" | "gpt-5.4";
export type CanvasImageModel = "nano-banana-2" | "gpt-image-2";
export type CanvasVideoModel = "veo-3.1" | "gemini-omni-flash" | "seedance-2.0";

export type CanvasBlockStatus = "idle" | "running" | "done" | "error";

export type CanvasUploadedAsset = {
  id: string;
  url: string;
  previewUrl: string;
  fileName: string;
  gcsUri?: string;
};

export type CanvasImageBatchCount = 1 | 2 | 4;

export type CanvasBlock = {
  id: string;
  kind: CanvasBlockKind;
  x: number;
  y: number;
  prompt: string;
  textModel: CanvasTextModel;
  imageModel: CanvasImageModel;
  videoModel: CanvasVideoModel;
  aspectRatio: "9:16" | "16:9";
  /** 图片方块一次生成张数 */
  imageBatchCount: CanvasImageBatchCount;
  /** 本地上传素材（可多张，供下游文本/视频引用） */
  uploadedAssets: CanvasUploadedAsset[];
  parentId?: string;
  refImageUrl?: string;
  refVideoUrl?: string;
  outputText?: string;
  outputUrl?: string;
  /** 图片批量输出 URL 列表 */
  outputUrls: string[];
  status: CanvasBlockStatus;
  error?: string;
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
    hint: "封面、海报、插图",
    icon: ImageIcon,
    color: "from-emerald-500/30 to-teal-600/10",
  },
  video: {
    label: "视频生成",
    hint: "图生视频 / 文生视频",
    icon: Video,
    color: "from-sky-500/30 to-cyan-600/10",
  },
  copy_organize: {
    label: "整理文案",
    hint: "结构化提纲与发布稿",
    icon: LayoutTemplate,
    color: "from-amber-500/30 to-orange-600/10",
  },
};

export const TEXT_MODEL_OPTIONS: Array<{ id: CanvasTextModel; label: string }> = [
  { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
  { id: "gpt-5.5", label: "GPT 5.5" },
  { id: "gpt-5.4", label: "GPT 5.4" },
];

export const IMAGE_MODEL_OPTIONS: Array<{ id: CanvasImageModel; label: string }> = [
  { id: "nano-banana-2", label: "Nano Banana 2" },
  { id: "gpt-image-2", label: "GPT-Image-2" },
];

export const VIDEO_MODEL_OPTIONS: Array<{ id: CanvasVideoModel; label: string }> = [
  { id: "veo-3.1", label: "Veo 3.1" },
  { id: "gemini-omni-flash", label: "Gemini Omni Flash" },
  { id: "seedance-2.0", label: "Seedance 2.0" },
];

export const SPAWN_KIND_OPTIONS: Array<{ kind: CanvasBlockKind; label: string; hint: string }> = [
  { kind: "text", label: "文本生成", hint: "脚本、广告词、品牌文案" },
  { kind: "image", label: "图片生成", hint: "生成插图、海报、封面" },
  { kind: "video", label: "视频生成", hint: "图生视频 / 文生视频" },
  { kind: "copy_organize", label: "整理文案", hint: "结构化 Markdown 发布稿" },
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
            : "镜头缓慢推进，主体动作自然，电影级光影。",
    textModel: "gemini-3.1-pro",
    imageModel: "nano-banana-2",
    videoModel: "gemini-omni-flash",
    aspectRatio: "9:16",
    imageBatchCount: 1,
    uploadedAssets: [],
    outputUrls: [],
    status: "idle",
  };
}

export function normalizeCanvasBlock(block: CanvasBlock): CanvasBlock {
  return {
    ...block,
    imageBatchCount: block.imageBatchCount ?? 1,
    uploadedAssets: block.uploadedAssets ?? [],
    outputUrls: block.outputUrls?.length
      ? block.outputUrls
      : block.outputUrl
        ? [block.outputUrl]
        : [],
  };
}

export function collectVisionImages(
  blockId: string,
  blocks: CanvasBlock[],
  edges: Array<{ fromId: string; toId: string }>,
): Array<{ url: string; gcsUri?: string; mimeType?: string }> {
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const items: Array<{ url: string; gcsUri?: string; mimeType?: string }> = [];

  const addAsset = (asset: CanvasUploadedAsset) => {
    const key = asset.gcsUri || asset.url;
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push({ url: asset.url, gcsUri: asset.gcsUri, mimeType: asset.fileName.match(/\.png$/i) ? "image/png" : "image/jpeg" });
  };

  const addUrl = (url: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    items.push({ url });
  };

  const self = blockMap.get(blockId);
  for (const asset of self?.uploadedAssets ?? []) addAsset(asset);

  for (const edge of edges.filter((e) => e.toId === blockId)) {
    const up = blockMap.get(edge.fromId);
    if (!up) continue;
    for (const asset of up.uploadedAssets ?? []) addAsset(asset);
    if (up.outputUrls?.length) {
      for (const u of up.outputUrls) addUrl(u);
    } else if (up.outputUrl) {
      addUrl(up.outputUrl);
    }
    if (up.refImageUrl) addUrl(up.refImageUrl);
  }

  return items;
}

export function collectUpstreamTexts(
  blockId: string,
  blocks: CanvasBlock[],
  edges: Array<{ fromId: string; toId: string }>,
): string[] {
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const texts: string[] = [];
  for (const edge of edges.filter((e) => e.toId === blockId)) {
    const up = blockMap.get(edge.fromId);
    if (up?.outputText?.trim()) texts.push(up.outputText.trim());
  }
  const parent = blockMap.get(blockId)?.parentId
    ? blockMap.get(blockMap.get(blockId)!.parentId!)
    : undefined;
  if (parent?.outputText?.trim()) texts.unshift(parent.outputText.trim());
  return texts;
}
