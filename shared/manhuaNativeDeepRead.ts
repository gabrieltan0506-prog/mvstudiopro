/**
 * 原生视频精读产出 → 模板卡的适配器。
 *
 * 上游形状来自 0823 实跑（qwen3.8-max 直读抖音 CDN，逐镜六栏），
 * 每段一条记录，`text` 里是模型返回的 JSON 字符串：
 *
 * ```
 * { seg, startSec, endSec, hint, usage, finish, shots, text }
 *                                                       └→ { shots[], beatStructureZh,
 *                                                            moodArcZh, reusableZh, genPromptHintZh }
 * ```
 *
 * 实测规模：262 秒素材 → 6 段 → 95 个镜头（`~/Downloads/2026Aug23/学习产出/deep-6seg.json`）。
 *
 * ⚠️ 本模块只做「解析与映射」。**接进学习服务主流程是另一件事**——
 * 生产链路目前仍走抽帧（frame_vision_deterministic），原生精读还没接进去。
 */
import { z } from "zod";
import type { ManhuaViralTemplateBeat } from "./manhuaViralTemplateBank.js";

const shotSchema = z
  .object({
    startSec: z.number().min(0),
    endSec: z.number().min(0),
    shotSizeZh: z.string().trim().optional(),
    angleZh: z.string().trim().optional(),
    cameraMoveZh: z.string().trim().optional(),
    lightingZh: z.string().trim().optional(),
    actionZh: z.string().trim().default(""),
    transitionInZh: z.string().trim().optional(),
  })
  .passthrough();

export const nativeDeepReadSegmentSchema = z
  .object({
    shots: z.array(shotSchema).default([]),
    beatStructureZh: z.string().trim().default(""),
    moodArcZh: z.string().trim().optional(),
    reusableZh: z.string().trim().optional(),
    genPromptHintZh: z.string().trim().optional(),
  })
  .passthrough();

export type NativeDeepReadSegment = z.infer<typeof nativeDeepReadSegmentSchema>;

export type NativeDeepReadOutput = {
  beatGrid: ManhuaViralTemplateBeat[];
  reusableZh?: string;
  genPromptHintZh?: string;
  /** 解析到的段数与镜头总数，供落库时记进 provenance */
  segmentCount: number;
  shotCount: number;
  /** 被丢弃的段数：failed / finish=length / 非法 JSON —— producer 必须检查 */
  failedSegmentCount: number;
  /** 被丢弃的镜头数：动作或节奏结构为空。**不写「未标注」占位**，空就是没学到 */
  droppedCount: number;
  /** 是否触顶 128 被抽稀 —— 触顶说明学习产出超出模板承载，需人工确认 */
  truncated: boolean;
};

/** beatGrid 硬上限，与 manhuaViralTemplateBank 的解析上限一致 */
export const NATIVE_DEEP_READ_MAX_BEATS = 128;

const cut = (v: string | undefined, max: number): string | undefined => {
  const t = String(v || "").trim().slice(0, max);
  return t || undefined;
};

/**
 * 逐段解析 → 拼成完整 beatGrid。
 *
 * `atSec` 用**全片绝对秒**（段起点 + 镜内相对秒），否则多段拼起来时间戳会重叠，
 * 编剧注入时按 atSec 排序就乱了。
 */
export function mapNativeDeepReadSegments(rows: readonly unknown[]): NativeDeepReadOutput {
  const parsed = rows.map((row) => {
    const outer = (row || {}) as {
      text?: unknown;
      startSec?: unknown;
      failed?: unknown;
      finish?: unknown;
    };
    if (outer.failed) return null;
    // finish=length 表示上游被截断，这一段的镜头必然不全，整段丢弃比留半截安全
    if (String(outer.finish || "") === "length") return null;
    const rawInner = typeof outer.text === "string" ? safeJson(outer.text) : outer.text;
    if (!rawInner) return null;
    const seg = nativeDeepReadSegmentSchema.safeParse(rawInner);
    if (!seg.success) return null;
    return { seg: seg.data, offsetSec: Math.max(0, Math.floor(Number(outer.startSec) || 0)) };
  });
  const ok = parsed.filter(Boolean) as Array<{ seg: NativeDeepReadSegment; offsetSec: number }>;

  let droppedCount = 0;
  const allBeats: ManhuaViralTemplateBeat[] = ok.flatMap(({ seg, offsetSec }) => {
    const conflictZh = String(seg.beatStructureZh || "").trim().slice(0, 40);
    return seg.shots.flatMap((shot) => {
      const visualZh = String(shot.actionZh || "").trim().slice(0, 80);
      // 空值不写「未标注」占位：占位会让下游以为学到了东西，实际是空的
      if (!conflictZh || !visualZh) {
        droppedCount += 1;
        return [];
      }
      const start = offsetSec + Math.floor(Number(shot.startSec) || 0);
      const end = offsetSec + Math.floor(Number(shot.endSec) || 0);
      return [
        {
          atSec: Math.max(0, start),
          endSec: end > start ? end : undefined,
          conflictZh,
          visualZh,
          shotSizeZh: cut(shot.shotSizeZh, 16),
          angleZh: cut(shot.angleZh, 16),
          cameraMoveZh: cut(shot.cameraMoveZh, 60),
          lightingZh: cut(shot.lightingZh, 60),
          transitionInZh: cut(shot.transitionInZh, 20),
        } satisfies ManhuaViralTemplateBeat,
      ];
    });
  });

  // 触顶不静默取前 128（那等于只保留全片前段）：等距抽稀并标记，让 producer 决定
  const truncated = allBeats.length > NATIVE_DEEP_READ_MAX_BEATS;
  const beatGrid = truncated
    ? Array.from({ length: NATIVE_DEEP_READ_MAX_BEATS }, (_, i) =>
        allBeats[Math.round((i * (allBeats.length - 1)) / (NATIVE_DEEP_READ_MAX_BEATS - 1))]!,
      )
    : allBeats;

  const joinField = (pick: (s: NativeDeepReadSegment) => string | undefined) =>
    cut(
      ok
        .map(({ seg }) => String(pick(seg) || "").trim())
        .filter(Boolean)
        .join("；"),
      600,
    );

  return {
    beatGrid,
    reusableZh: joinField((s) => s.reusableZh),
    genPromptHintZh: joinField((s) => s.genPromptHintZh),
    segmentCount: ok.length,
    shotCount: beatGrid.length,
    failedSegmentCount: rows.length - ok.length,
    droppedCount,
    truncated,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // 模型偶尔裹 Markdown 围栏，剥掉再试一次
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}
