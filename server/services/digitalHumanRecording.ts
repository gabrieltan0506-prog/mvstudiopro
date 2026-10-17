import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import { fetchPostProdSourceToFile, probeAudio } from "./postProduction";

/** 只检查本人的已上传原声，不合成、不改声道、不收取配音费用。 */
export async function inspectDigitalHumanNarration(userId: string, source: string) {
  const ownedSource = await resolveRegisteredPostProdMediaSource({ userId, source });
  const signal = AbortSignal.timeout(60_000);
  const dir = await mkdtemp(join(tmpdir(), "dh-recording-check-"));
  try {
    const file = join(dir, "recording");
    await fetchPostProdSourceToFile(ownedSource, file, { signal, maxBytes: 60 * 1024 * 1024, budget: { remainingBytes: 60 * 1024 * 1024 } });
    const durationSec = await probeAudio(file, signal);
    if (durationSec < 3 || durationSec > 300) throw new Error("完整旁白须为3秒至5分钟，原文件未改动");
    return { source: ownedSource, durationSec };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
