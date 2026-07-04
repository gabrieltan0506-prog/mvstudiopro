export type GrowthCampJobTimingInput = {
  /** 参考视频时长（秒）；无视频时传 0 */
  durationSeconds?: number;
  /** Platform 素材区轻量路径（跳过口播/BGM 多 pass） */
  platformAssetLite?: boolean;
  assetKind: "video" | "image";
};

const MS = 1000;
const MIN = 60 * MS;

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 客户端 pollJobUntilTerminal 上限：随视频时长弹性伸缩，不写死 35 分钟。
 *
 * Platform 轻量参考视频：约 5min 起 + 每视频分钟 45s，上限 25min。
 * 成长营完整管线：约 10min 起 + 每视频分钟 90s，上限 45min。
 * 纯图片：固定 8min（与时长无关）。
 */
export function resolveGrowthCampJobMaxWaitMs(input: GrowthCampJobTimingInput): number {
  if (input.assetKind === "image") {
    // GPT-5.5 图片视觉分析实测常需 10-15 分钟；提升至 20 分钟避免轮询超时报错
    return 20 * MIN;
  }

  const durationSec = Math.max(0, Number(input.durationSeconds) || 0);
  const durationMin = durationSec / 60;

  if (input.platformAssetLite) {
    const ms = (5 * MIN + durationMin * 60 * MS) | 0;
    return clamp(8 * MIN, 25 * MIN, ms);
  }

  const ms = (10 * MIN + durationMin * 90 * MS) | 0;
  return clamp(12 * MIN, 45 * MIN, ms);
}

/** Worker 端 withTimeout：比客户端多 ~15% + 60s，避免客户端先超时而 Job 仍 running */
export function resolveGrowthCampJobServerTimeoutMs(input: GrowthCampJobTimingInput): number {
  const clientMs = resolveGrowthCampJobMaxWaitMs(input);
  return Math.round(clientMs * 1.15 + MIN);
}

/** @deprecated 请用 resolveGrowthCampJobMaxWaitMs；保留作绝对上限参考 */
export const GROWTH_CAMP_JOB_MAX_WAIT_CAP_MS = 45 * MIN;
