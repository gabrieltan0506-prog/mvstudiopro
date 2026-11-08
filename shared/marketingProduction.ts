/**
 * 营销 / 知识口播「制作稿 → 段落时间线 → 成片」最小接线（2026-11-08）。
 *
 * 营销规划与素材分析的产物都是 Markdown 正文，没有逐段结构；这里只补一个纯函数转换：
 * 制作稿（口播/分镜文字）→ 段落（口播 + 画面提示 + 预估时长），每段绑定一个画面来源：
 * - source=stock：共用素材面板采用的本人图库资产（purpose=marketing, usage=insert），
 *   只存 assetId 引用与署名证据，不存签名地址/第三方直链；
 * - source=upload：用户自己上传的产品素材（本人 uploads/u<id>/ 对象）。
 * 配音复用 canvasAudio.generateDialogue；导出复用后期工坊既有动作：
 * 每段 bgm_mount（画面 + 本段配音）→ 一次 concat（按配音时长取段 + 同步字幕）。
 * 不新建工作流、不改 TTS/定价；本文件只做形状、校验与任务参数推导。
 */
import { z } from "zod";
import {
  PEXELS_LICENSE,
  isStockAssetInsertable,
  stockAttributionText,
  type StockFootageAssetView,
} from "./stockFootage";

export const MARKETING_PRODUCTION_VERSION = 1 as const;
/** 与后期拼接单次上限一致（concatParamsSchema clips ≤ 12）。 */
export const MARKETING_PRODUCTION_MAX_SEGMENTS = 12;
/** 中文口播常规语速（字/秒），只用于预估与素材时长筛选，成片以实测配音为准。 */
export const MARKETING_NARRATION_CHARS_PER_SEC = 4.5;
/** 配音后保留的画面余量（秒），避免最后一个字被硬切。 */
export const MARKETING_SEGMENT_TAIL_SEC = 0.3;
export const MARKETING_NARRATION_MAX_CHARS = 4000;

export const MARKETING_OUTPUT_SIZE = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
} as const;
export type MarketingOrientation = keyof typeof MARKETING_OUTPUT_SIZE;

const STOCK_ASSET_ID_RE = /^sf_[0-9a-f]{48}$/;
/** 取段至少保留秒数（与后期 concat 取段下限一致）。 */
export const MARKETING_TRIM_MIN_SEC = 0.1;

/** 入点/出点校验：0 ≤ in < out ≤ 素材时长，且至少 0.1 秒；合法返回 null。 */
export function marketingTrimIssue(trim: { inSec: number; outSec: number }, durationSec: number): string | null {
  const { inSec, outSec } = trim;
  if (!Number.isFinite(inSec) || !Number.isFinite(outSec) || !Number.isFinite(durationSec) || durationSec <= 0) return "选段数值无效";
  if (inSec < 0) return "入点不能小于 0 秒";
  if (outSec <= inSec) return "出点必须晚于入点";
  if (outSec > durationSec + 1e-3) return `出点超出素材时长 ${durationSec.toFixed(1)} 秒`;
  if (outSec - inSec < MARKETING_TRIM_MIN_SEC - 1e-9) return "选段至少保留 0.1 秒";
  return null;
}
const USER_UPLOAD_GS_RE = /^gs:\/\/[^/]+\/uploads\/u\d+\/[^?#]+$/;

const stockVisualSchema = z.object({
  source: z.literal("stock"),
  assetId: z.string().regex(STOCK_ASSET_ID_RE),
  durationSec: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  attribution: z.string().min(1).max(400),
  evidence: z.object({
    provider: z.string().min(1).max(40),
    providerAssetId: z.string().min(1).max(40),
    pageUrl: z.string().url(),
    authorName: z.string().max(300),
    authorUrl: z.string().url().optional(),
    licenseName: z.string().max(100),
    licenseUrl: z.string().url(),
  }).strict(),
  adoptedAt: z.string().max(64),
  /**
   * 抽屉里选定的入点/出点（素材自身时间轴，秒）。缺省 = 从 0 秒起取（旧草稿兼容）。
   * 导出时真实消费：bgm_mount 的 entrySec = inSec（配音从入点开始贴），concat 的 trims.startSec = inSec。
   */
  trim: z.object({ inSec: z.number().finite().min(0), outSec: z.number().finite().positive() }).strict().optional(),
}).strict().superRefine((visual, ctx) => {
  const issue = visual.trim ? marketingTrimIssue(visual.trim, visual.durationSec) : null;
  if (issue) ctx.addIssue({ code: "custom", path: ["trim"], message: issue });
});

const uploadVisualSchema = z.object({
  source: z.literal("upload"),
  gcsUri: z.string().regex(USER_UPLOAD_GS_RE).max(2048),
  fileName: z.string().min(1).max(200),
  mimeType: z.string().regex(/^video\//).max(100),
  durationSec: z.number().positive(),
}).strict();

export const marketingVisualSchema = z.discriminatedUnion("source", [stockVisualSchema, uploadVisualSchema]);
export type MarketingVisual = z.infer<typeof marketingVisualSchema>;
export type MarketingStockVisual = z.infer<typeof stockVisualSchema>;
export type MarketingUploadVisual = z.infer<typeof uploadVisualSchema>;

const VOICE_STATUSES = ["submitted", "running", "succeeded", "failed", "unknown"] as const;
export const marketingVoiceSchema = z.object({
  billingRequestId: z.string().uuid(),
  voice: z.string().min(1).max(80),
  /** 提交时的口播原文；与段落现稿不一致即视为过期，需要重新配音。 */
  narration: z.string().max(MARKETING_NARRATION_MAX_CHARS),
  status: z.enum(VOICE_STATUSES),
  jobId: z.string().max(80).optional(),
  gcsUri: z.string().regex(/^gs:\/\/[^/]+\/.+/).max(2048).optional(),
  durationSec: z.number().positive().optional(),
  creditsCost: z.number().nonnegative().optional(),
  message: z.string().max(500).optional(),
}).strict();
export type MarketingVoice = z.infer<typeof marketingVoiceSchema>;

export const marketingSegmentSchema = z.object({
  segmentId: z.string().min(1).max(64),
  narration: z.string().max(MARKETING_NARRATION_MAX_CHARS),
  visualHint: z.string().max(500),
  estimatedSec: z.number().positive(),
  visual: marketingVisualSchema.optional(),
  voice: marketingVoiceSchema.optional(),
}).strict();
export type MarketingSegment = z.infer<typeof marketingSegmentSchema>;

const POST_JOB_STATUSES = ["submitting", "queued", "running", "succeeded", "failed"] as const;
export const marketingPostJobSchema = z.object({
  /** 提交参数指纹；绑定或配音变化后指纹不同，旧任务不再被采用。 */
  key: z.string().min(1).max(20_000),
  status: z.enum(POST_JOB_STATUSES),
  jobId: z.string().max(80).optional(),
  gcsUri: z.string().max(2048).optional(),
  durationSec: z.number().nonnegative().optional(),
  error: z.string().max(500).optional(),
}).strict();
export type MarketingPostJob = z.infer<typeof marketingPostJobSchema>;

export const marketingProductionDraftSchema = z.object({
  version: z.literal(MARKETING_PRODUCTION_VERSION),
  draftId: z.string().uuid(),
  orientation: z.enum(["portrait", "landscape"]),
  scriptText: z.string().max(40_000),
  voiceId: z.string().max(80).optional(),
  segments: z.array(marketingSegmentSchema).max(MARKETING_PRODUCTION_MAX_SEGMENTS),
  mounts: z.record(z.string(), marketingPostJobSchema),
  final: marketingPostJobSchema.optional(),
  updatedAt: z.string().max(64),
}).strict();
export type MarketingProductionDraft = z.infer<typeof marketingProductionDraftSchema>;

export function newMarketingProductionDraft(draftId: string, now = new Date().toISOString()): MarketingProductionDraft {
  return { version: MARKETING_PRODUCTION_VERSION, draftId, orientation: "portrait", scriptText: "", segments: [], mounts: {}, updatedAt: now };
}

/** 刷新恢复：本地/云端读回的草稿必须整体合法，否则不采用（返回 null，由调用方保留原文导出）。 */
export function parseMarketingProductionDraft(raw: unknown): MarketingProductionDraft | null {
  const parsed = marketingProductionDraftSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function marketingProductionScopeKey(draftId: string): string {
  return `marketing:${draftId}`;
}

// ---------------------------------------------------------------- 制作稿 → 段落

/** 口播字数（汉字逐字、英文按词、数字串算一个词）。 */
export function narrationUnits(text: string): number {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const words = (text.replace(/[㐀-鿿豈-﫿]/g, " ").match(/[A-Za-z0-9]+(?:['.-][A-Za-z0-9]+)*/g) || []).length;
  return cjk + words;
}

export function estimateNarrationSec(text: string): number {
  const units = narrationUnits(text);
  return Math.max(1, Math.round((units / MARKETING_NARRATION_CHARS_PER_SEC) * 10) / 10);
}

const SECTION_HEADING_RE = /^(#{1,6})\s*(.+?)\s*#*$/;
const SCRIPT_HEADING_WORDS = /(口播|脚本|分镜|台词|旁白|配音稿|视频稿)/;

/**
 * 从完整方案 Markdown 里取「口播/脚本/分镜」小节；找不到返回空串（不把整份方案当口播稿）。
 * 只取第一个匹配小节，直到同级或更高级标题为止。
 */
export function extractMarketingScriptSection(markdown: string): string {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(SECTION_HEADING_RE);
    if (!heading || !SCRIPT_HEADING_WORDS.test(heading[2])) continue;
    const level = heading[1].length;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].match(SECTION_HEADING_RE);
      if (next && next[1].length <= level) break;
      body.push(lines[j]);
    }
    const text = body.join("\n").trim();
    if (text) return text;
  }
  return "";
}

/** 段落起始标记：「第1段/镜头2/分镜3/场景4/Shot 5/1. /一、/【开场】」等。 */
const SEGMENT_MARKER_RE = /^\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:\*\*)?\s*(?:(?:第\s*[0-9一二三四五六七八九十]+\s*(?:段|镜|幕|场|部分)|(?:镜头|分镜|段落|场景|shot|scene)\s*[0-9一二三四五六七八九十]+|[0-9]{1,2}\s*[.、)）]|[一二三四五六七八九十]{1,3}\s*、|【[^】]{1,16}】)\s*(?:\*\*)?\s*[:：.、\-—]?\s*)/i;
const NARRATION_LABEL_RE = /^\s*(?:[-*]\s*)?(?:\*\*)?\s*(?:口播|台词|旁白|配音|文案|讲述|解说|字幕)\s*(?:\*\*)?\s*[:：]\s*/;
const VISUAL_LABEL_RE = /^\s*(?:[-*]\s*)?(?:\*\*)?\s*(?:画面|镜头画面|画面建议|视觉|素材|镜头)\s*(?:\*\*)?\s*[:：]\s*/;
const META_LABEL_RE = /^\s*(?:[-*]\s*)?(?:\*\*)?\s*(?:时长|景别|运镜|音乐|音效|BGM|转场|备注)\s*(?:\*\*)?\s*[:：]/i;

function cleanInline(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^["“「『]+|["”」』]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** narration=显式标注的口播；loose=段内未标注正文（段内没有显式口播时才算口播，避免把段落标题读进配音）。 */
type RawSegment = { narration: string[]; visual: string[]; loose?: string[] };

const TABLE_NARRATION_HEADER_RE = /(口播|台词|旁白|配音|文案|解说|字幕)/;
const TABLE_VISUAL_HEADER_RE = /(画面|镜头内容|视觉|素材)/;

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cleanInline(cell.replace(/<br\s*\/?>/gi, " ")));
}

/** Markdown 分镜表（| 镜号 | 画面 | 口播 |）→ 段落；没有口播列返回 null。 */
function parseScriptTable(lines: string[]): RawSegment[] | null {
  const rows = lines.filter(line => /^\s*\|.*\|\s*$/.test(line));
  if (rows.length < 3) return null;
  const isSeparator = (row: string) => /^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{0,}:?\s*$/.test(row);
  const headerIndex = rows.findIndex((row, i) => i + 1 < rows.length && isSeparator(rows[i + 1]));
  if (headerIndex < 0) return null;
  const header = splitTableRow(rows[headerIndex]);
  const narrationCol = header.findIndex(cell => TABLE_NARRATION_HEADER_RE.test(cell));
  const visualCol = header.findIndex((cell, i) => i !== narrationCol && TABLE_VISUAL_HEADER_RE.test(cell));
  if (narrationCol < 0) return null;
  const out: RawSegment[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (isSeparator(row)) continue;
    const cells = splitTableRow(row);
    out.push({ narration: [cells[narrationCol] || ""].filter(Boolean), visual: visualCol >= 0 && cells[visualCol] ? [cells[visualCol]] : [] });
  }
  return out;
}

function splitLongParagraph(text: string, maxUnits = 80): string[] {
  const sentences = text.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    if (current && narrationUnits(current + s) > maxUnits) { chunks.push(current); current = s; }
    else current += s;
  }
  if (current) chunks.push(current);
  return chunks;
}

export type MarketingSegmentationResult =
  | { ok: true; segments: MarketingSegment[]; droppedVisualOnly: number }
  | { ok: false; error: string };

/**
 * 制作稿 → 段落时间线。三种写法都接受：
 * 1) 带段落标记（第N段/镜头N/1./【开场】）且段内用「口播：」「画面：」标注；
 * 2) 带段落标记但不标注，段内正文都算口播；
 * 3) 没有标记：按空行分段，只有一段时按句子切成约 80 字一段。
 * 超过 12 段明确拒绝（后期拼接上限），不静默截断。
 */
export function segmentMarketingScript(
  text: string,
  opts: { idPrefix?: string } = {},
): MarketingSegmentationResult {
  const source = String(text || "").replace(/\r\n?/g, "\n").replace(/```[a-z]*\n?/gi, "").trim();
  if (!source) return { ok: false, error: "制作稿为空，请先粘贴或带入口播/分镜稿。" };
  const lines = source.split("\n");
  const hasMarkers = lines.some(line => SEGMENT_MARKER_RE.test(line));
  const raws: RawSegment[] = [];

  const table = parseScriptTable(lines);
  if (table) {
    raws.push(...table);
  } else if (hasMarkers) {
    let current: RawSegment | null = null;
    for (const line of lines) {
      if (!line.trim() || /^\s*(?:---+|\*\*\*+)\s*$/.test(line)) continue;
      if (SECTION_HEADING_RE.test(line) && !SEGMENT_MARKER_RE.test(line)) continue;
      let rest = line;
      if (SEGMENT_MARKER_RE.test(line)) {
        current = { narration: [], visual: [], loose: [] };
        raws.push(current);
        rest = line.replace(SEGMENT_MARKER_RE, "");
      }
      if (!current) continue; // 首个标记之前的说明文字不进入时间线
      // 一行里可能同时写「画面：… 口播：…」
      const inlineNarr = rest.match(/(?:口播|台词|旁白|配音)\s*[:：]\s*(.+)$/);
      const inlineVisual = rest.match(/(?:画面|镜头画面|画面建议)\s*[:：]\s*(.+?)(?=(?:口播|台词|旁白|配音)\s*[:：]|$)/);
      if (inlineNarr && inlineVisual && !NARRATION_LABEL_RE.test(rest)) {
        current.visual.push(cleanInline(inlineVisual[1]));
        current.narration.push(cleanInline(inlineNarr[1]));
        continue;
      }
      if (VISUAL_LABEL_RE.test(rest)) current.visual.push(cleanInline(rest.replace(VISUAL_LABEL_RE, "")));
      else if (NARRATION_LABEL_RE.test(rest)) current.narration.push(cleanInline(rest.replace(NARRATION_LABEL_RE, "")));
      else if (META_LABEL_RE.test(rest)) continue;
      else if (cleanInline(rest)) current.loose!.push(cleanInline(rest));
    }
  } else {
    const paragraphs = source.split(/\n\s*\n/).map(p => cleanInline(p.replace(/\n/g, " "))).filter(Boolean);
    const chunks = paragraphs.length > 1 ? paragraphs : splitLongParagraph(paragraphs[0] || "");
    for (const chunk of chunks) {
      if (VISUAL_LABEL_RE.test(chunk)) { raws.push({ narration: [], visual: [cleanInline(chunk.replace(VISUAL_LABEL_RE, ""))] }); continue; }
      raws.push({ narration: [cleanInline(chunk.replace(NARRATION_LABEL_RE, ""))], visual: [] });
    }
  }

  const normalized = raws.map(r => ({ narration: r.narration.length ? r.narration : (r.loose || []), visual: r.visual }));
  const usable = normalized.filter(r => r.narration.join("").trim());
  const droppedVisualOnly = raws.length - usable.length;
  if (!usable.length) return { ok: false, error: "没有识别到口播文字。请用「口播：」标注每段要说的话。" };
  if (usable.length > MARKETING_PRODUCTION_MAX_SEGMENTS)
    return { ok: false, error: `识别到 ${usable.length} 段，单条成片最多 ${MARKETING_PRODUCTION_MAX_SEGMENTS} 段，请合并相邻段落后再转换。` };
  const prefix = opts.idPrefix || "seg";
  const segments: MarketingSegment[] = [];
  for (let i = 0; i < usable.length; i++) {
    const narration = usable[i].narration.filter(Boolean).join("");
    if (narration.length > MARKETING_NARRATION_MAX_CHARS) return { ok: false, error: `第 ${i + 1} 段口播超过 ${MARKETING_NARRATION_MAX_CHARS} 字，请拆分。` };
    segments.push({
      segmentId: `${prefix}_${i + 1}`,
      narration,
      visualHint: usable[i].visual.filter(Boolean).join("；").slice(0, 500),
      estimatedSec: estimateNarrationSec(narration),
    });
  }
  return { ok: true, segments, droppedVisualOnly };
}

/** 重新转换后沿用口播一字不差的旧段落的画面与配音（不重复扣费、不丢绑定）。 */
export function carryOverSegmentBindings(previous: MarketingSegment[], next: MarketingSegment[]): MarketingSegment[] {
  const pool = [...previous];
  return next.map(segment => {
    const index = pool.findIndex(old => old.narration === segment.narration);
    if (index < 0) return segment;
    const [old] = pool.splice(index, 1);
    return { ...segment, ...(old.visual ? { visual: old.visual } : {}), ...(old.voice ? { voice: old.voice } : {}) };
  });
}

/** 素材面板搜索词：优先画面提示，其次口播前 20 字。 */
export function marketingStockQuery(segment: Pick<MarketingSegment, "visualHint" | "narration">): string {
  const base = (segment.visualHint || segment.narration).replace(/[，。！？、；：,.!?;:"“”'‘’（）()【】\[\]]+/g, " ").trim();
  return Array.from(base).slice(0, 20).join("").trim() || "product";
}

// ---------------------------------------------------------------- 画面绑定

/**
 * 共用素材抽屉 onPick / 面板 onAdopted → 段落画面。只收营销 insert 视频，持久化不含签名地址。
 * trim 为抽屉选定的入点/出点；非法选段直接拒绝（不悄悄夹取）。
 */
export function stockVisualFromAsset(asset: StockFootageAssetView, trim?: { inSec: number; outSec: number }): MarketingStockVisual {
  if (!STOCK_ASSET_ID_RE.test(asset.assetId)) throw new Error("图库素材编号无效");
  if (asset.purpose !== "marketing") throw new Error("该素材不是为营销口播采用的，请在本段重新采用");
  if (!isStockAssetInsertable(asset) || asset.usage !== "insert") throw new Error("该素材是参考用途，不能直接入片");
  if (asset.kind !== "video") throw new Error("口播成片的段落画面需要视频素材");
  if (!asset.durationSec || asset.durationSec <= 0) throw new Error("图库视频缺少时长信息，无法排进时间线");
  const trimIssue = trim ? marketingTrimIssue(trim, asset.durationSec) : null;
  if (trimIssue) throw new Error(trimIssue);
  const roundedTrim = trim ? { inSec: roundMs(trim.inSec), outSec: Math.min(roundMs(trim.outSec), asset.durationSec) } : undefined;
  return {
    source: "stock",
    assetId: asset.assetId,
    durationSec: asset.durationSec,
    width: asset.width,
    height: asset.height,
    attribution: stockAttributionText(asset.source),
    evidence: {
      provider: asset.source.provider,
      providerAssetId: asset.source.providerAssetId,
      pageUrl: asset.source.pageUrl,
      authorName: asset.source.author.name,
      ...(asset.source.author.url ? { authorUrl: asset.source.author.url } : {}),
      licenseName: asset.source.license.name || PEXELS_LICENSE.name,
      licenseUrl: asset.source.license.url || PEXELS_LICENSE.url,
    },
    adoptedAt: asset.adoptedAt,
    ...(roundedTrim ? { trim: roundedTrim } : {}),
  };
}

function roundMs(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}

/** 画面在素材自身时间轴上的起点（入点）；无选段从 0 秒起。 */
export function marketingVisualStartSec(visual: MarketingVisual): number {
  return visual.source === "stock" && visual.trim ? visual.trim.inSec : 0;
}

/** 选定窗口（入点→出点）；无选段 = 整条素材。 */
export function marketingVisualWindow(visual: MarketingVisual): { inSec: number; outSec: number } {
  return visual.source === "stock" && visual.trim ? visual.trim : { inSec: 0, outSec: visual.durationSec };
}

/** 用户上传的产品视频 → 段落画面。只认服务端生成的本人上传对象名（uploads/u<id>/…）。 */
export function uploadVisualFromFile(input: { gcsUri: string; fileName: string; mimeType: string; durationSec: number }): MarketingUploadVisual {
  const gcsUri = String(input.gcsUri || "").trim();
  if (!USER_UPLOAD_GS_RE.test(gcsUri) || gcsUri.includes("..")) throw new Error("上传素材地址无效，请重新上传");
  if (!/^video\//.test(input.mimeType)) throw new Error("段落画面请上传视频（MP4/MOV/WebM）");
  if (!Number.isFinite(input.durationSec) || input.durationSec <= 0) throw new Error("无法读取视频时长，请换一个文件");
  return { source: "upload", gcsUri, fileName: String(input.fileName || "产品素材").slice(0, 200), mimeType: input.mimeType, durationSec: input.durationSec };
}

/** 后期任务里的画面引用：图库用 stock:assetId（服务端按归属核对），上传用 gs://。 */
export function marketingVisualRef(visual: MarketingVisual): string {
  return visual.source === "stock" ? `stock:${visual.assetId}` : visual.gcsUri;
}

// ---------------------------------------------------------------- 配音

export function marketingVoiceReady(segment: MarketingSegment): segment is MarketingSegment & { voice: MarketingVoice & { gcsUri: string; durationSec: number } } {
  const v = segment.voice;
  return Boolean(v && v.status === "succeeded" && v.gcsUri && v.durationSec && v.narration === segment.narration);
}

export function marketingVoicePending(segment: MarketingSegment): boolean {
  const s = segment.voice?.status;
  return s === "submitted" || s === "running" || s === "unknown";
}

/**
 * 这段画面实际入片秒数（从入点算起）：配音时长 + 余量。
 * - 配音落在选段内：不越过出点（也不越过素材本身）；
 * - 配音长于选段：从入点顺延到配音结束 + 余量（不越过素材本身），界面用 marketingTrimOverrunSec 提示；
 * - 入点之后剩余素材短于配音：返回 null（导出前拦截）。
 */
export function marketingSegmentClipSec(segment: MarketingSegment): number | null {
  if (!segment.visual || !marketingVoiceReady(segment)) return null;
  const voice = segment.voice.durationSec;
  const start = marketingVisualStartSec(segment.visual);
  const available = segment.visual.durationSec - start;
  if (available + 1e-6 < voice) return null;
  const window = marketingVisualWindow(segment.visual);
  const windowSec = window.outSec - start;
  const cap = voice <= windowSec + 1e-6 ? Math.min(windowSec, available) : available;
  return roundMs(Math.min(cap, voice + MARKETING_SEGMENT_TAIL_SEC));
}

/** 配音长于所选窗口时，成片从出点继续顺延的秒数（0 = 未越过出点）。 */
export function marketingTrimOverrunSec(segment: MarketingSegment): number {
  if (!segment.visual || segment.visual.source !== "stock" || !segment.visual.trim) return 0;
  const clip = marketingSegmentClipSec(segment);
  if (clip == null) return 0;
  const over = segment.visual.trim.inSec + clip - segment.visual.trim.outSec;
  return over > 1e-3 ? roundMs(over) : 0;
}

/** 抽屉的目标时长：本段已有有效配音用实测时长，否则用口播预估。 */
export function marketingSegmentTargetSec(segment: MarketingSegment): number {
  return marketingVoiceReady(segment) ? segment.voice.durationSec : segment.estimatedSec;
}

/** 抽屉自动关键词的原文：画面提示 + 口播（上限 1000 字，与关键词接口一致）。 */
export function marketingStockSourceText(segment: Pick<MarketingSegment, "visualHint" | "narration">): string {
  return [segment.visualHint ? `画面：${segment.visualHint}` : "", segment.narration ? `口播：${segment.narration}` : ""]
    .filter(Boolean).join("\n").slice(0, 1000);
}

/** 段落标题：画面提示优先，其次口播前 16 字。 */
export function marketingSegmentTitle(segment: Pick<MarketingSegment, "visualHint" | "narration">): string {
  const base = (segment.visualHint || segment.narration).replace(/\s+/g, " ").trim();
  const chars = Array.from(base);
  return chars.length > 16 ? `${chars.slice(0, 16).join("")}…` : base || "未命名段落";
}

/** 有上限的并发执行（整稿找素材：最多 3 段同时检索）；结果与输入同序，单项失败不影响其他项。 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { ok: true, value: await run(items[index], index) }; }
      catch (error) { results[index] = { ok: false, error }; }
    }
  };
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

export type MarketingVoiceTrackState = { tone: "ready" | "pending" | "stale" | "failed" | "empty"; label: string };

/** 旁白轨状态（时间线与段落行共用一套口径）。 */
export function marketingVoiceTrackState(segment: MarketingSegment): MarketingVoiceTrackState {
  const voice = segment.voice;
  if (!voice) return { tone: "empty", label: "待配音" };
  if (voice.narration !== segment.narration) return { tone: "stale", label: "口播已改，需重配" };
  if (marketingVoiceReady(segment)) return { tone: "ready", label: `已配音 ${segment.voice.durationSec.toFixed(1)} 秒` };
  if (voice.status === "failed") return { tone: "failed", label: "配音未成功" };
  if (voice.status === "unknown") return { tone: "pending", label: "配音待核对" };
  if (voice.status === "succeeded") return { tone: "pending", label: "配音回执待补全" };
  return { tone: "pending", label: "配音生成中" };
}

/** 时间线排布用的段落时长：有效配音按实测，否则按口播预估。 */
export function marketingTimelineSec(segment: MarketingSegment): number {
  return marketingSegmentTargetSec(segment);
}

// ---------------------------------------------------------------- 导出

export function auditMarketingExport(draft: MarketingProductionDraft): string[] {
  const issues: string[] = [];
  if (!draft.segments.length) issues.push("还没有段落，请先把制作稿转换为段落时间线。");
  draft.segments.forEach((segment, i) => {
    const label = `第 ${i + 1} 段`;
    if (!segment.visual) issues.push(`${label}：还没有画面（采用图库素材或上传产品视频）。`);
    if (!segment.voice) issues.push(`${label}：还没有配音。`);
    else if (marketingVoicePending(segment)) issues.push(`${label}：配音仍在处理，请稍后刷新。`);
    else if (segment.voice.status === "failed") issues.push(`${label}：配音未成功，请重新生成。`);
    else if (segment.voice.narration !== segment.narration) issues.push(`${label}：口播已修改，请重新配音。`);
    else if (!segment.voice.gcsUri || !segment.voice.durationSec) issues.push(`${label}：配音回执缺少音频或时长，请查询原任务。`);
    if (segment.visual && marketingVoiceReady(segment)) {
      const start = marketingVisualStartSec(segment.visual);
      const available = segment.visual.durationSec - start;
      if (available + 1e-6 < segment.voice.durationSec)
        issues.push(start > 0
          ? `${label}：画面从第 ${start.toFixed(1)} 秒起只剩 ${available.toFixed(1)} 秒，短于配音 ${segment.voice.durationSec.toFixed(1)} 秒，请提前入点、换更长的素材或拆分口播。`
          : `${label}：画面 ${segment.visual.durationSec.toFixed(1)} 秒短于配音 ${segment.voice.durationSec.toFixed(1)} 秒，请换更长的素材或拆分口播。`);
    }
  });
  return issues;
}

export type MarketingMountInput = {
  action: "bgm_mount";
  scopeKey: string;
  params: {
    videoUri: string; bgmUri: string; bgmVolume: number; entrySec: number; bgmSeekSec: number;
    bgmDurationSec: number; fadeInSec: number; fadeOutSec: number; duckUnderDialogue: boolean;
  };
};

/**
 * 第一步：每段把配音贴到画面上（复用 bgm_mount；配音满音量、不做避让、不淡入淡出）。
 * 有选段时配音从入点进场（entrySec = inSec），第二步 concat 再从入点取段，配音与所选画面对齐。
 */
export function marketingMountInput(draft: MarketingProductionDraft, segment: MarketingSegment): MarketingMountInput {
  if (!segment.visual || !marketingVoiceReady(segment)) throw new Error("本段画面或配音尚未就绪");
  return {
    action: "bgm_mount",
    scopeKey: marketingProductionScopeKey(draft.draftId),
    params: {
      videoUri: marketingVisualRef(segment.visual),
      bgmUri: segment.voice.gcsUri,
      bgmVolume: 1,
      entrySec: marketingVisualStartSec(segment.visual),
      bgmSeekSec: 0,
      bgmDurationSec: segment.voice.durationSec,
      fadeInSec: 0,
      fadeOutSec: 0,
      duckUnderDialogue: false,
    },
  };
}

export function marketingMountKey(draft: MarketingProductionDraft, segment: MarketingSegment): string {
  return JSON.stringify(marketingMountInput(draft, segment));
}

/** 段落的贴装任务是否可直接复用（已成功且指纹一致）。 */
export function marketingMountDone(draft: MarketingProductionDraft, segment: MarketingSegment): boolean {
  const job = draft.mounts[segment.segmentId];
  if (!job || job.status !== "succeeded" || !job.gcsUri) return false;
  try { return job.key === marketingMountKey(draft, segment); } catch { return false; }
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(r, 3)}`;
}

/** 字幕按标点切成短句（每行约 16 字），在本段配音时长内按字数比例分配。 */
export function splitSubtitleLines(text: string, maxUnits = 16): string[] {
  const parts = (text.match(/[^，。！？；、,!?;]+[，。！？；、,!?;]*/g) || [text]).map(p => p.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const part of parts) {
    const clean = part.replace(/[，。；、,;]+$/, "");
    if (!clean) continue;
    if (narrationUnits(clean) <= maxUnits) { lines.push(clean); continue; }
    const chars = Array.from(clean);
    for (let i = 0; i < chars.length; i += maxUnits) lines.push(chars.slice(i, i + maxUnits).join(""));
  }
  return lines.length ? lines : [text.trim()].filter(Boolean);
}

export function buildMarketingSubtitleSrt(cues: Array<{ text: string; voiceSec: number; clipSec: number }>): string {
  const blocks: string[] = [];
  let offset = 0;
  let n = 1;
  for (const cue of cues) {
    const lines = splitSubtitleLines(cue.text);
    const total = lines.reduce((sum, line) => sum + Math.max(1, narrationUnits(line)), 0);
    let t = offset;
    for (const line of lines) {
      const d = (cue.voiceSec * Math.max(1, narrationUnits(line))) / total;
      blocks.push(`${n++}\n${srtTime(t)} --> ${srtTime(Math.min(t + d, offset + cue.clipSec))}\n${line}\n`);
      t += d;
    }
    offset += cue.clipSec;
  }
  return blocks.join("\n");
}

export type MarketingConcatInput = {
  action: "concat";
  scopeKey: string;
  params: {
    clips: string[];
    trims: Array<{ startSec: number; endSec: number }>;
    subtitleSrt: string;
    width: number; height: number; fps: number;
  };
};

/** 第二步：所有段落贴装成功后，按配音时长取段拼接 + 同步字幕（复用 concat）。 */
export function marketingConcatInput(draft: MarketingProductionDraft): MarketingConcatInput {
  const issues = auditMarketingExport(draft);
  if (issues.length) throw new Error(issues[0]);
  const clips: string[] = [];
  const trims: Array<{ startSec: number; endSec: number }> = [];
  const cues: Array<{ text: string; voiceSec: number; clipSec: number }> = [];
  for (const [i, segment] of Array.from(draft.segments.entries())) {
    if (!marketingMountDone(draft, segment)) throw new Error(`第 ${i + 1} 段的配音贴装尚未完成`);
    const clipSec = marketingSegmentClipSec(segment);
    if (!clipSec || !marketingVoiceReady(segment) || !segment.visual) throw new Error(`第 ${i + 1} 段时长无效`);
    const mount = draft.mounts[segment.segmentId];
    const startSec = marketingVisualStartSec(segment.visual);
    // 贴装产物有实测时长时以它为准（素材元数据可能略长于实片），不越界取段
    if (mount.durationSec != null && startSec + segment.voice.durationSec > mount.durationSec + 1e-3)
      throw new Error(`第 ${i + 1} 段画面实际只有 ${mount.durationSec.toFixed(2)} 秒，入点后不足以放下配音，请重新选段（入点前移）`);
    const endSec = mount.durationSec != null ? Math.min(startSec + clipSec, mount.durationSec) : startSec + clipSec;
    clips.push(mount.gcsUri!);
    trims.push({ startSec, endSec: roundMs(endSec) });
    cues.push({ text: segment.narration, voiceSec: segment.voice.durationSec, clipSec: roundMs(endSec - startSec) });
  }
  const size = MARKETING_OUTPUT_SIZE[draft.orientation];
  return {
    action: "concat",
    scopeKey: marketingProductionScopeKey(draft.draftId),
    params: { clips, trims, subtitleSrt: buildMarketingSubtitleSrt(cues), width: size.width, height: size.height, fps: 30 },
  };
}

export function marketingFinalDone(draft: MarketingProductionDraft): boolean {
  if (!draft.final || draft.final.status !== "succeeded" || !draft.final.gcsUri) return false;
  try { return draft.final.key === JSON.stringify(marketingConcatInput(draft)); } catch { return false; }
}

export type MarketingExportStep =
  | { kind: "blocked"; issues: string[] }
  | { kind: "wait"; reason: string }
  | { kind: "mount"; segmentIds: string[] }
  | { kind: "concat" }
  | { kind: "done" };

/** 导出编排的下一步（纯判定，界面与轮询按它推进；刷新后从草稿状态直接续上）。 */
export function nextMarketingExportStep(draft: MarketingProductionDraft): MarketingExportStep {
  const issues = auditMarketingExport(draft);
  if (issues.length) return { kind: "blocked", issues };
  const pendingMounts: string[] = [];
  for (const segment of draft.segments) {
    if (marketingMountDone(draft, segment)) continue;
    const job = draft.mounts[segment.segmentId];
    const key = marketingMountKey(draft, segment);
    if (job && job.key === key && ["submitting", "queued", "running"].includes(job.status))
      return { kind: "wait", reason: "配音贴装处理中" };
    pendingMounts.push(segment.segmentId);
  }
  if (pendingMounts.length) return { kind: "mount", segmentIds: pendingMounts };
  if (marketingFinalDone(draft)) return { kind: "done" };
  // 拼接参数可能因贴装实测时长不足而无法生成：作为阻断项返回，不能在渲染期抛错。
  let key: string;
  try { key = JSON.stringify(marketingConcatInput(draft)); }
  catch (error) { return { kind: "blocked", issues: [error instanceof Error ? error.message : String(error)] }; }
  if (draft.final && draft.final.key === key && ["submitting", "queued", "running"].includes(draft.final.status))
    return { kind: "wait", reason: "成片拼接处理中" };
  return { kind: "concat" };
}

/** 后期任务查询结果 → 草稿任务状态（只认产物 gcsUri，签名地址不入稿）。 */
export function applyPostProdJobResult(job: MarketingPostJob, response: { status?: unknown; output?: unknown; error?: unknown } | null | undefined): MarketingPostJob {
  if (!response) return job;
  const status = String(response.status || "");
  const output = response.output && typeof response.output === "object" ? response.output as Record<string, unknown> : {};
  if (status === "succeeded") {
    const gcsUri = typeof output.gcsUri === "string" ? output.gcsUri : undefined;
    if (!gcsUri) return { ...job, status: "failed", error: "任务已完成但缺少产物地址" };
    const durationSec = typeof output.durationSec === "number" ? output.durationSec : undefined;
    return { ...job, status: "succeeded", gcsUri, ...(durationSec != null ? { durationSec } : {}), error: undefined };
  }
  if (status === "failed") return { ...job, status: "failed", error: typeof response.error === "string" ? response.error.slice(0, 500) : "后期任务未成功" };
  if (status === "running") return { ...job, status: "running" };
  return { ...job, status: "queued" };
}

/**
 * 提交请求已发出但没拿到 jobId（断线/刷新）时，按 scopeKey + 动作 + 画面来源从本人任务列表找回，
 * 不重复入队。只采用最新一条完全匹配的任务。
 */
export function findRecoveredPostProdJob(
  rows: Array<{ jobId?: unknown; action?: unknown; scopeKey?: unknown; sourceVideoUris?: unknown; createdAt?: unknown }>,
  expected: { scopeKey: string; action: "bgm_mount" | "concat"; sourceVideoUris: string[] },
): string | null {
  const match = rows.filter(row => row && row.action === expected.action && row.scopeKey === expected.scopeKey
    && Array.isArray(row.sourceVideoUris) && row.sourceVideoUris.length === expected.sourceVideoUris.length
    && row.sourceVideoUris.every((uri, i) => uri === expected.sourceVideoUris[i]) && typeof row.jobId === "string");
  if (!match.length) return null;
  match.sort((a, b) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime());
  return match[0].jobId as string;
}

/** 成片说明：图库素材逐条署名 + 授权链接；用户上传素材单独列出（两种来源不混写）。 */
export function marketingCreditLines(draft: MarketingProductionDraft): { stock: string[]; uploads: string[] } {
  const stock = new Map<string, string>();
  const uploads = new Set<string>();
  for (const segment of draft.segments) {
    const visual = segment.visual;
    if (!visual) continue;
    if (visual.source === "stock") stock.set(visual.assetId, `${visual.attribution}（${visual.evidence.pageUrl}，${visual.evidence.licenseName} ${visual.evidence.licenseUrl}）`);
    else uploads.add(visual.fileName);
  }
  return { stock: Array.from(stock.values()), uploads: Array.from(uploads) };
}

// ---------------------------------------------------------------- 配音回执（复用 canvasAudio.generateDialogue / getDialogue）

export type MarketingDialogueRequest = {
  billingRequestId: string; input: string; voice: string; speakerZh: string; speakerId: string; voiceStateZh: string;
};

/** 本段配音请求：口播原文整段送 TTS（不截断、不改写），speakerId 绑定草稿与段落。 */
export function marketingDialogueRequest(draft: Pick<MarketingProductionDraft, "draftId">, segment: MarketingSegment, voice: string, billingRequestId: string): MarketingDialogueRequest {
  const input = segment.narration.trim();
  if (!input) throw new Error("本段没有口播文字");
  if (!voice.trim()) throw new Error("请先选择配音声线");
  return { billingRequestId, input, voice: voice.trim(), speakerZh: "口播讲述者", speakerId: `mk-${draft.draftId}-${segment.segmentId}`.slice(0, 120), voiceStateZh: "" };
}

/** generateDialogue/getDialogue 回执 → 段落配音状态。只存 gcsUri（不存签名地址）；reconcile_manual 记作 unknown 待查询。 */
export function marketingVoiceFromDialogue(
  previous: MarketingVoice,
  response: { jobId?: unknown; status?: unknown; creditsCost?: unknown; message?: unknown; result?: { gcsUri?: unknown; durationSec?: unknown } | null } | null | undefined,
): MarketingVoice {
  if (!response) return previous;
  const raw = String(response.status || "");
  const status: MarketingVoice["status"] = raw === "succeeded" ? "succeeded" : raw === "failed" ? "failed" : raw === "running" ? "running" : "unknown";
  const gcsUri = typeof response.result?.gcsUri === "string" && /^gs:\/\/[^/]+\/.+/.test(response.result.gcsUri) ? response.result.gcsUri : undefined;
  const durationSec = typeof response.result?.durationSec === "number" && response.result.durationSec > 0 ? response.result.durationSec : undefined;
  return {
    ...previous,
    status: status === "succeeded" && !gcsUri ? "unknown" : status,
    ...(typeof response.jobId === "string" ? { jobId: response.jobId.slice(0, 80) } : {}),
    ...(gcsUri ? { gcsUri } : {}),
    ...(durationSec ? { durationSec } : {}),
    ...(typeof response.creditsCost === "number" ? { creditsCost: response.creditsCost } : {}),
    ...(typeof response.message === "string" ? { message: response.message.slice(0, 500) } : {}),
  };
}

/** 本机草稿键（按登录用户隔离；云端任务记录仍是任务真源，本机只存编号与绑定）。 */
export function marketingProductionStorageKey(userKey: string): string {
  return `mvs.marketingProduction.v1:${userKey}`;
}
