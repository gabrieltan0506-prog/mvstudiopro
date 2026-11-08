/**
 * 数字人「补充画面覆盖 / 回切」轨（B-roll overlay track）。
 *
 * 这是叠在口播母轨之上的独立画面轨，不是人物分段 clips 的一部分：
 * - 口播母轨（批准的配音、人物分段、字幕、混音）一律不动；
 * - 覆盖段只替换画面，成片音轨始终来自口播母轨，素材自带音轨丢弃；
 * - 客户端只提交 assetId + 时间；服务端用 loadOwnedStockAsset 取 gcsUri/时长/类型为准。
 */
import { z } from "zod";

export const DIGITAL_HUMAN_OVERLAY_MODES = ["overlay", "cutaway"] as const;
export type DigitalHumanOverlayMode = (typeof DIGITAL_HUMAN_OVERLAY_MODES)[number];
export const DIGITAL_HUMAN_OVERLAY_MODE_LABEL: Record<DigitalHumanOverlayMode, string> = {
  overlay: "画面覆盖（口播声继续）",
  cutaway: "回切（覆盖后标注回到人物）",
};
/** 单条覆盖最短时长（秒），过短的闪切不可读。 */
export const DIGITAL_HUMAN_OVERLAY_MIN_SEC = 0.5;
/** 照片没有自身时长：放置时给固定展示时长，可在范围内调整。 */
export const DIGITAL_HUMAN_PHOTO_OVERLAY_SEC = 3;
export const DIGITAL_HUMAN_PHOTO_OVERLAY_MIN_SEC = 1;
export const DIGITAL_HUMAN_PHOTO_OVERLAY_MAX_SEC = 10;
/** 视频素材放置时的默认取段上限。 */
export const DIGITAL_HUMAN_VIDEO_OVERLAY_DEFAULT_SEC = 4;
export const DIGITAL_HUMAN_OVERLAY_MAX_COUNT = 20;
const EPS = 1 / 1000;

const assetId = z.string().regex(/^sf_[0-9a-f]{48}$/);
const sec = z.number().finite().min(0).max(1800);

/** 提交给最终合成的覆盖段：只有素材编号与时间，不带任何地址。 */
export const digitalHumanOverlaySchema = z.object({
  assetId,
  startSec: sec,
  durationSec: z.number().finite().min(DIGITAL_HUMAN_OVERLAY_MIN_SEC).max(1800),
  sourceInSec: sec,
  mode: z.enum(DIGITAL_HUMAN_OVERLAY_MODES),
  /** 回切点备注（仅 cutaway 有意义），如「回到人物讲结论」。 */
  returnNote: z.string().trim().max(200).optional(),
}).strict();
export type DigitalHumanOverlay = z.infer<typeof digitalHumanOverlaySchema>;

/**
 * 草稿里保存的覆盖段：在提交形状上附带采用时的展示信息（类型、素材时长、署名）。
 * 单项宽松（编辑中允许暂时无效），跨项规则在提交前由 digitalHumanOverlayIssues 校验。
 * 不保存签名地址；服务端不信任这里的 kind/sourceDurationSec，只以 loadOwnedStockAsset 为准。
 */
export const digitalHumanOverlayDraftSchema = z.object({
  assetId,
  startSec: z.number().finite().min(0).max(1800),
  durationSec: z.number().finite().min(0).max(1800),
  sourceInSec: z.number().finite().min(0).max(1800),
  mode: z.enum(DIGITAL_HUMAN_OVERLAY_MODES),
  returnNote: z.string().max(200).optional(),
  kind: z.enum(["video", "photo"]),
  sourceDurationSec: z.number().positive().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  attribution: z.string().max(400),
  pageUrl: z.string().url().max(1000).optional(),
}).strict();
export type DigitalHumanOverlayDraft = z.infer<typeof digitalHumanOverlayDraftSchema>;

export type DigitalHumanOverlayAssetFacts = { kind: "video" | "photo"; durationSec?: number };
export type DigitalHumanOverlayIssue = { index?: number; message: string };

/**
 * 覆盖轨校验（纯函数，客户端、schema、服务端共用）：
 * 落在口播总时长内、互不重叠、视频选段不超素材时长、照片固定展示时长且无入点。
 * 不给 assetFacts 时只校验时间轴（schema 层不知道素材类型）。
 */
export function digitalHumanOverlayIssues(
  overlays: ReadonlyArray<Pick<DigitalHumanOverlay, "assetId" | "startSec" | "durationSec" | "sourceInSec">>,
  totalSec: number,
  assetFacts?: (assetId: string) => DigitalHumanOverlayAssetFacts | undefined,
): DigitalHumanOverlayIssue[] {
  const issues: DigitalHumanOverlayIssue[] = [];
  if (overlays.length > DIGITAL_HUMAN_OVERLAY_MAX_COUNT) issues.push({ message: `补充画面最多${DIGITAL_HUMAN_OVERLAY_MAX_COUNT}条` });
  if (!Number.isFinite(totalSec) || totalSec <= 0) {
    if (overlays.length) issues.push({ message: "尚无批准的口播总时长，不能放置补充画面" });
    return issues;
  }
  overlays.forEach((o, index) => {
    const n = index + 1;
    if (!(o.durationSec >= DIGITAL_HUMAN_OVERLAY_MIN_SEC)) issues.push({ index, message: `第${n}条补充画面短于${DIGITAL_HUMAN_OVERLAY_MIN_SEC}秒` });
    if (o.startSec < 0 || o.startSec + o.durationSec > totalSec + EPS) issues.push({ index, message: `第${n}条补充画面超出口播总时长（${totalSec.toFixed(2)}秒）` });
    if (o.sourceInSec < 0) issues.push({ index, message: `第${n}条素材入点不能为负` });
    if (!assetFacts) return;
    const facts = assetFacts(o.assetId);
    if (!facts) { issues.push({ index, message: `第${n}条素材未采用或不属于本人` }); return; }
    if (facts.kind === "photo") {
      if (o.sourceInSec !== 0) issues.push({ index, message: `第${n}条是照片，素材入点须为0` });
      if (o.durationSec < DIGITAL_HUMAN_PHOTO_OVERLAY_MIN_SEC - EPS || o.durationSec > DIGITAL_HUMAN_PHOTO_OVERLAY_MAX_SEC + EPS)
        issues.push({ index, message: `第${n}条照片展示时长须在${DIGITAL_HUMAN_PHOTO_OVERLAY_MIN_SEC}–${DIGITAL_HUMAN_PHOTO_OVERLAY_MAX_SEC}秒之间` });
    } else if (!facts.durationSec || !(facts.durationSec > 0)) {
      issues.push({ index, message: `第${n}条视频素材缺少时长，不能确认选段` });
    } else if (o.sourceInSec + o.durationSec > facts.durationSec + EPS) {
      issues.push({ index, message: `第${n}条选段（入点${o.sourceInSec}秒+${o.durationSec}秒）超过素材时长${facts.durationSec}秒` });
    }
  });
  const order = overlays.map((o, index) => ({ index, start: o.startSec, end: o.startSec + o.durationSec })).sort((a, b) => a.start - b.start);
  for (let i = 1; i < order.length; i++) {
    if (order[i].start < order[i - 1].end - EPS)
      issues.push({ index: order[i].index, message: `第${order[i].index + 1}条与第${order[i - 1].index + 1}条补充画面时间重叠` });
  }
  return issues;
}

export function assertDigitalHumanOverlays(...args: Parameters<typeof digitalHumanOverlayIssues>): void {
  const issues = digitalHumanOverlayIssues(...args);
  if (issues.length) throw new Error(issues.map(i => i.message).join("；"));
}

/**
 * 采用素材后在口播时间轴上找第一个放得下的空档：优先 preferredStartSec，之后顺延。
 * 照片给固定展示时长；视频默认取素材开头最多4秒（并不超过素材时长）。
 */
export function placeDigitalHumanOverlay(
  existing: ReadonlyArray<Pick<DigitalHumanOverlay, "startSec" | "durationSec">>,
  asset: DigitalHumanOverlayAssetFacts,
  totalSec: number,
  preferredStartSec = 0,
): { startSec: number; durationSec: number; sourceInSec: number } {
  if (!Number.isFinite(totalSec) || totalSec <= 0) throw new Error("请先批准完整配音，再放置补充画面");
  if (existing.length >= DIGITAL_HUMAN_OVERLAY_MAX_COUNT) throw new Error(`补充画面最多${DIGITAL_HUMAN_OVERLAY_MAX_COUNT}条`);
  if (asset.kind === "video" && !(asset.durationSec && asset.durationSec > 0)) throw new Error("视频素材缺少时长，不能放置");
  const wanted = asset.kind === "photo"
    ? DIGITAL_HUMAN_PHOTO_OVERLAY_SEC
    : Math.min(DIGITAL_HUMAN_VIDEO_OVERLAY_DEFAULT_SEC, asset.durationSec!);
  const min = asset.kind === "photo" ? DIGITAL_HUMAN_PHOTO_OVERLAY_MIN_SEC : DIGITAL_HUMAN_OVERLAY_MIN_SEC;
  const busy = existing.map(o => ({ start: o.startSec, end: o.startSec + o.durationSec })).sort((a, b) => a.start - b.start);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const b of busy) { if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, totalSec) }); cursor = Math.max(cursor, b.end); }
  if (cursor < totalSec) gaps.push({ start: cursor, end: totalSec });
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const ordered = [...gaps.filter(g => g.end > preferredStartSec), ...gaps.filter(g => g.end <= preferredStartSec)];
  for (const g of ordered) {
    for (const start of preferredStartSec > g.start && preferredStartSec < g.end ? [preferredStartSec, g.start] : [g.start]) {
      const room = g.end - start;
      if (room + EPS >= min) return { startSec: round(start), durationSec: round(Math.min(wanted, room)), sourceInSec: 0 };
    }
  }
  throw new Error("口播时间轴上已没有足够空档放置这条补充画面");
}

/** 从草稿行取提交形状（丢弃展示字段）。 */
export function digitalHumanOverlayRequest(row: DigitalHumanOverlayDraft): DigitalHumanOverlay {
  return digitalHumanOverlaySchema.parse({
    assetId: row.assetId, startSec: row.startSec, durationSec: row.durationSec, sourceInSec: row.sourceInSec, mode: row.mode,
    ...(row.mode === "cutaway" && row.returnNote?.trim() ? { returnNote: row.returnNote.trim() } : {}),
  });
}

/**
 * 覆盖层 ffmpeg 滤镜：输入0为口播母轨画面（已标准化），输入1..n 为覆盖素材（调用方已用 -ss/-t 取段，照片 -loop 1）。
 * 只处理视频流：缩放/补边到成片画幅后按 startSec 延时叠加，覆盖结束即回到人物画面。所有参数均为受控数值。
 */
export function digitalHumanOverlayFilter(
  overlays: ReadonlyArray<Pick<DigitalHumanOverlay, "startSec" | "durationSec">>,
  width: number,
  height: number,
): string {
  if (!overlays.length) throw new Error("没有补充画面");
  const num = (v: number) => { if (!Number.isFinite(v) || v < 0) throw new Error("覆盖参数无效"); return v.toFixed(3); };
  const filters: string[] = [];
  let base = "[0:v]";
  overlays.forEach((o, i) => {
    const start = num(o.startSec), dur = num(o.durationSec), end = num(o.startSec + o.durationSec);
    filters.push(`[${i + 1}:v]trim=duration=${dur},setpts=PTS-STARTPTS,fps=30,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,setpts=PTS+${start}/TB[ov${i}]`);
    const out = i === overlays.length - 1 ? "[vout]" : `[base${i}]`;
    filters.push(`${base}[ov${i}]overlay=x=0:y=0:eof_action=pass:repeatlast=0:enable='between(t,${start},${end})'${out}`);
    base = `[base${i}]`;
  });
  return filters.join(";");
}
