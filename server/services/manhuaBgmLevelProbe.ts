/**
 * 逐 0.5 秒量 BGM 电平，供变体客观比较与后续卡点表使用。
 *
 * 每一格都用独立的 `-ss/-t + volumedetect`，不能改成 astats 累积统计：
 * 累积均值无法表示某一时刻的击点或谷底。独立量测用受控并发池执行，避免
 * 360 秒音频串行启动 720 次 ffmpeg 后撞穿任务墙钟。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BgmLevelSample } from "../../shared/manhuaBeatTable.js";

const execFileAsync = promisify(execFile);

export const BGM_LEVEL_WINDOW_SEC = 0.5;
export const BGM_LEVEL_CONCURRENCY = 4;

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("已取消");
}

export function parseBgmVolumeDb(
  stderr: string,
  key: "max_volume" | "mean_volume"
): number {
  const matched = String(stderr).match(
    new RegExp(`${key}:\\s*(-?[\\d.]+) dB`, "i")
  );
  const value = matched ? Number(matched[1]) : Number.NaN;
  return Number.isFinite(value) ? value : -91;
}

export async function probeBgmLevels(
  filePath: string,
  opts: { totalSec: number; abortSignal?: AbortSignal } = { totalSec: 0 }
): Promise<BgmLevelSample[]> {
  const totalSec = Math.max(0, Number(opts.totalSec) || 0);
  if (!totalSec) return [];
  if (opts.abortSignal?.aborted) throw abortError(opts.abortSignal);

  const starts: number[] = [];
  for (let atSec = 0; atSec < totalSec; atSec += BGM_LEVEL_WINDOW_SEC) {
    starts.push(atSec);
  }

  const samples: BgmLevelSample[] = [];
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= starts.length) return;
      if (opts.abortSignal?.aborted) throw abortError(opts.abortSignal);
      const atSec = starts[index]!;

      let stderr = "";
      try {
        const result = await execFileAsync(
          "ffmpeg",
          [
            "-hide_banner",
            "-nostdin",
            "-ss",
            atSec.toFixed(2),
            "-t",
            String(BGM_LEVEL_WINDOW_SEC),
            "-i",
            filePath,
            "-af",
            "volumedetect",
            "-f",
            "null",
            "-",
          ],
          { timeout: 30_000, signal: opts.abortSignal }
        );
        stderr = String(result.stderr || "");
      } catch (error) {
        if (opts.abortSignal?.aborted) throw abortError(opts.abortSignal);
        // volumedetect 即便进程非零退出也常把有效量测写在 stderr。
        stderr = String((error as { stderr?: unknown }).stderr || "");
      }

      samples.push({
        atSec: Math.round(atSec * 100) / 100,
        peakDb: parseBgmVolumeDb(stderr, "max_volume"),
        meanDb: parseBgmVolumeDb(stderr, "mean_volume"),
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(BGM_LEVEL_CONCURRENCY, starts.length) }, () =>
      worker()
    )
  );
  samples.sort((left, right) => left.atSec - right.atSec);
  return samples;
}
