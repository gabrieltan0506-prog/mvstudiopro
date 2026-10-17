import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchPostProdSourceToFile,
  probe,
  probeAudio,
  uploadResult,
} from "./postProduction";

export class DigitalHumanOmniOutputQualityError extends Error {}

/** 只下载核验并保存供应商原片，不转码、不补帧、不以放大冒充原生尺寸。 */
export async function saveDigitalHumanOmniOutput(
  userId: number,
  source: string,
  expectedDuration: number
) {
  const dir = await mkdtemp(join(tmpdir(), "dh-omni-output-"));
  const signal = AbortSignal.timeout(180_000);
  try {
    const file = join(dir, "original.mp4");
    const bytes = await fetchPostProdSourceToFile(source, file, {
      signal,
      maxBytes: 512 * 1024 * 1024,
    });
    if (bytes <= 0)
      throw new DigitalHumanOmniOutputQualityError(
        "供应商原片为空，已保留原任务供核对"
      );
    let video: Awaited<ReturnType<typeof probe>>;
    let audioDuration: number;
    try {
      video = await probe(file, signal);
      if (!video.hasAudio) throw new Error("原片没有音轨");
      audioDuration = await probeAudio(file, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new DigitalHumanOmniOutputQualityError(
        "原片音画结构不可用，已保留原任务供核对"
      );
    }
    if (
      !video.width ||
      !video.height ||
      !Number.isFinite(video.durationSec) ||
      !Number.isFinite(audioDuration) ||
      video.durationSec < expectedDuration - 0.15 ||
      audioDuration < expectedDuration - 0.15 ||
      video.durationSec > expectedDuration + 2
    )
      throw new DigitalHumanOmniOutputQualityError(
        "原片音画时长或内容结构未通过核验，已保留原任务供核对"
      );
    return {
      ...(await uploadResult({
        filePath: file,
        userId: String(userId),
        kind: "dh-omni",
        ext: "mp4",
        contentType: "video/mp4",
        signal,
      })),
      width: video.width,
      height: video.height,
      durationSec: video.durationSec,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
