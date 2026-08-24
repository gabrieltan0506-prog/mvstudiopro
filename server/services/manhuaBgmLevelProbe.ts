/**
 * 逐 0.5 秒量 BGM 电平 —— 卡点表的第一步，**纯 ffmpeg 零付费**。
 *
 * ⚠️ 必须一格一格单独量（`-ss t -t 0.5` ＋ `volumedetect`）。
 * **不能用 astats 的累积统计**：那是从头到当前的平均值，不是瞬时值，
 * 拿它做卡点表会全盘错位（skill 里记着这一脚）。
 *
 * 量出来的是客观事实（peak/mean/谷底），不是「这里比较激昂」——
 * 卡点表四列里「BGM 事件」那列要的就是这个。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BgmLevelSample } from "../../shared/manhuaBeatTable.js";

const execFileAsync = promisify(execFile);

/** 窗口 0.5 秒：再细意义不大，再粗对不准击点 */
export const BGM_LEVEL_WINDOW_SEC = 0.5;

function parseDb(stderr: string, key: "max_volume" | "mean_volume"): number {
  const m = stderr.match(new RegExp(`${key}:\\s*(-?[\\d.]+) dB`));
  return m ? Number(m[1]) : -91;
}

/** 并发上限：Fly 机器只有 2 核，开太多反而互相抢；3–4 是实测甜区 */
const BGM_LEVEL_CONCURRENCY = 4;

export async function probeBgmLevels(
  filePath: string,
  opts: { totalSec: number; abortSignal?: AbortSignal } = { totalSec: 0 },
): Promise<BgmLevelSample[]> {
  const total = Math.max(0, Number(opts.totalSec) || 0);
  if (!total) return [];

  /**
   * 逐 0.5 秒**独立**量测（口径不能改回 astats 累积值——那是从头到当前的平均，
   * 拿它做卡点表会全盘错位）。但独立不等于串行：360 秒的曲子＝720 个窗口，
   * 一个一个起进程要跑到墙钟结束，任务已付费却拿不到结构。
   * 故改成受控并发池，结果最后按 atSec 排序还原顺序。
   */
  const starts: number[] = [];
  for (let t = 0; t < total; t += BGM_LEVEL_WINDOW_SEC) starts.push(t);

  const out: BgmLevelSample[] = [];
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= starts.length) return;
      const t = starts[i]!;
      if (opts.abortSignal?.aborted) throw new Error("已取消");
      let stderr = "";
      try {
        // volumedetect 的结果写在 stderr；成功那次也要读（TTS 那边栽过一次）
        const r = await execFileAsync(
          "ffmpeg",
          [
            "-hide_banner", "-nostdin",
            "-ss", t.toFixed(2), "-t", String(BGM_LEVEL_WINDOW_SEC),
            "-i", filePath, "-af", "volumedetect", "-f", "null", "-",
          ],
          { timeout: 30_000, signal: opts.abortSignal },
        );
        stderr = String(r.stderr || "");
      } catch (e) {
        // 中止必须往外抛，不能当成「这一格量不到」吞掉
        if (opts.abortSignal?.aborted) throw new Error("已取消");
        stderr = String((e as { stderr?: string }).stderr || "");
      }
      out.push({
        atSec: Math.round(t * 100) / 100,
        peakDb: parseDb(stderr, "max_volume"),
        meanDb: parseDb(stderr, "mean_volume"),
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(BGM_LEVEL_CONCURRENCY, starts.length) }, () => worker()),
  );
  out.sort((a, b) => a.atSec - b.atSec);
  return out;
}
