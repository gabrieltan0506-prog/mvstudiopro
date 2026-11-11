/**
 * 拉片 → 自由画布交接稿。沿用「爆款复刻 → 画布」的现成交接方式
 * （`remixProductionHandoff.ts` 按用户分键暂存 + `/canvas?from=…` + 画布顶部「采用」横幅，见 `RemixProductionImport.tsx`），
 * 区别只有两点：
 *   - 存 sessionStorage（同标签页跳转即用即弃），不占本机稿件库已接近上限的 localStorage；
 *   - 只存提示词与片段地址（附 gs:// 对象地址供画布按既有做法续签），不存媒体本体、不存 base64。
 * 本文件不依赖画布类型，拉片页可以轻量引用；建方块在 `videoBreakdownCanvasBlocks.ts`。
 */
import { z } from "zod";
import { formatVideoBreakdownRecreatePrompt, type VideoBreakdown } from "@shared/videoBreakdown";
import { gsUriFromSignedGcsUrl } from "@shared/manhuaMultiview";
import { buildVideoBreakdownBgmPrompt } from "@shared/videoBreakdownBgm";
import { formatVideoBreakdownRemakePrompt, videoBreakdownRemakeInputSchema, type VideoBreakdownRemakeInput } from "@shared/videoBreakdownRemake";
import { formatClock, segmentHeading } from "./videoBreakdownView";

export const VIDEO_BREAKDOWN_CANVAS_FROM = "lapian";
export const videoBreakdownCanvasHandoffKey = (userId: number | string) => `mvsp-lapian-canvas-v1:${userId}`;

const httpsUrl = z.string().trim().url().max(4096).refine(value => value.startsWith("https://"), "只接受 https 地址");

export const videoBreakdownCanvasHandoffSchema = z.object({
  v: z.literal(1),
  /** recreate = 复刻这支片；remake = 用这套拍法创作新片（主体/场景已换成用户的）。 */
  mode: z.enum(["recreate", "remake"]),
  remake: videoBreakdownRemakeInputSchema.optional(),
  jobId: z.string().trim().min(1).max(128),
  createdAt: z.string().max(40),
  items: z.array(z.object({
    segmentIndex: z.number().int().min(0).max(199),
    heading: z.string().trim().min(1).max(120),
    rangeLabel: z.string().max(40),
    prompt: z.string().trim().min(1).max(12000),
    clip: z.object({ url: httpsUrl, gcsUri: z.string().max(1024).optional(), fileName: z.string().max(200) }).strict().optional(),
  }).strict()).min(1).max(200),
  bgmPrompt: z.string().trim().max(12000).optional(),
}).strict();
export type VideoBreakdownCanvasHandoff = z.infer<typeof videoBreakdownCanvasHandoffSchema>;

/** 组交接稿：按段序；片段为空的段只带提示词；配乐提示词只在整片送入时带。 */
export function buildVideoBreakdownCanvasHandoff(input: {
  jobId: string;
  result: VideoBreakdown;
  clipUrls?: readonly string[];
  segmentIndexes: readonly number[];
  includeBgm: boolean;
  /** 给了就是「创作新片」模式：提示词换主体/场景，片段只作动作/运镜参考。 */
  remake?: VideoBreakdownRemakeInput;
  now?: Date;
}): VideoBreakdownCanvasHandoff {
  const remake = input.remake ? videoBreakdownRemakeInputSchema.parse(input.remake) : undefined;
  const wanted = new Set(input.segmentIndexes);
  const items = [...input.result.segments]
    .sort((a, b) => a.index - b.index)
    .filter(segment => wanted.has(segment.index))
    .map(segment => {
      const url = String(input.clipUrls?.[segment.index] || "").trim();
      const gcsUri = url ? gsUriFromSignedGcsUrl(url) : "";
      return {
        segmentIndex: segment.index,
        heading: segmentHeading(segment).slice(0, 120),
        rangeLabel: `${formatClock(segment.startSec)}–${formatClock(segment.endSec)}`,
        prompt: remake ? formatVideoBreakdownRemakePrompt(segment, remake) : formatVideoBreakdownRecreatePrompt(segment),
        ...(url.startsWith("https://")
          ? { clip: { url, ...(gcsUri ? { gcsUri } : {}), fileName: `拉片片段${segment.index + 1}-${segment.title}`.slice(0, 180) + ".mp4" } }
          : {}),
      };
    });
  if (!items.length) throw new Error("没有可送入画布的分段。");
  return videoBreakdownCanvasHandoffSchema.parse({
    v: 1,
    mode: remake ? "remake" : "recreate",
    ...(remake ? { remake } : {}),
    jobId: input.jobId,
    createdAt: (input.now || new Date()).toISOString(),
    items,
    ...(input.includeBgm ? { bgmPrompt: buildVideoBreakdownBgmPrompt(input.result) } : {}),
  });
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveVideoBreakdownCanvasHandoff(storage: KeyValueStorage, userId: number | string, handoff: VideoBreakdownCanvasHandoff): void {
  const json = JSON.stringify(videoBreakdownCanvasHandoffSchema.parse(handoff));
  try {
    storage.setItem(videoBreakdownCanvasHandoffKey(userId), json);
  } catch {
    throw new Error("浏览器暂存空间不足，未能送入画布；可先复制提示词手动粘贴。");
  }
  if (storage.getItem(videoBreakdownCanvasHandoffKey(userId)) !== json) throw new Error("送入画布的内容未完整保存，请重试。");
}

export function readVideoBreakdownCanvasHandoff(storage: KeyValueStorage, userId: number | string): VideoBreakdownCanvasHandoff | null {
  const raw = storage.getItem(videoBreakdownCanvasHandoffKey(userId));
  return raw ? videoBreakdownCanvasHandoffSchema.parse(JSON.parse(raw)) : null;
}

export function clearVideoBreakdownCanvasHandoff(storage: KeyValueStorage, userId: number | string): void {
  try { storage.removeItem(videoBreakdownCanvasHandoffKey(userId)); } catch { /* 交接稿只是暂存，删不掉不影响画布。 */ }
}

export function videoBreakdownCanvasHref(): string {
  return `/canvas?from=${VIDEO_BREAKDOWN_CANVAS_FROM}`;
}
