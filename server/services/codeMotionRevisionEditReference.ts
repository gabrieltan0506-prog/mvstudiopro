import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetchPostProdSourceToFile, runMediaTool } from "./postProduction";
import { getGcsBucketName, uploadBufferToGcsIfAbsent } from "./gcs";
import { registerCanvasMediaOwner } from "./canvasMediaOwnership";
import type { CodeMotionStoreDeps } from "./codeMotionStore";

export type EditProviderReference = {
  videoUri: string;
  sha256: string;
  duration: number;
  width: number;
  height: number;
  rawUri: string;
  rawSha256: string;
  rawDuration: number;
  strategy: "hold-last-frame" | "trim-to-selected-scene";
};

/** This is the formal provider preflight, not a repair applied only to probes. */
export async function prepareCodeMotionEditReference(
  userId: string,
  projectId: string,
  uri: string,
  raw: { sha256: string; duration: number; width: number; height: number },
  nominalDuration: number,
  tier: "free" | "paid",
  storage: CodeMotionStoreDeps
): Promise<EditProviderReference | undefined> {
  const min = tier === "free" ? 2 : 4,
    max = tier === "free" ? 15 : 30;
  if (!Number.isFinite(raw.duration) || raw.duration <= 0)
    throw Error("原片缺少有效视频时长");
  if (raw.duration >= min && raw.duration <= max) return undefined;
  if (nominalDuration < min || nominalDuration > max)
    throw Error("所选镜头不在编辑模型的有效时长内");
  const strategy =
    raw.duration < min ? "hold-last-frame" : "trim-to-selected-scene";
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        rawSha256: raw.sha256,
        nominalDuration,
        tier,
        strategy,
      })
    )
    .digest("hex");
  const name = `code-motion/u${userId}/production/${projectId}/edit-references/${key}.json`;
  const existing = await storage.read(name);
  if (existing) {
    const ref = JSON.parse(existing.body.toString()) as EditProviderReference;
    if (
      ref.rawUri !== uri ||
      ref.rawSha256 !== raw.sha256 ||
      ref.rawDuration !== raw.duration ||
      ref.strategy !== strategy ||
      Math.abs(ref.duration - nominalDuration) > 1 / 30
    )
      throw Error("编辑参考片回执不一致，未占用修改次数");
    return ref;
  }
  const dir = await mkdtemp(path.join(tmpdir(), "ink-edit-reference-"));
  try {
    const input = path.join(dir, "raw.mp4"),
      output = path.join(dir, "reference.mp4"),
      signal = AbortSignal.timeout(120000);
    await fetchPostProdSourceToFile(uri, input, {
      signal,
      maxBytes: 150_000_000,
    });
    if (
      createHash("sha256")
        .update(await readFile(input))
        .digest("hex") !== raw.sha256
    )
      throw Error("编辑原片在预检期间发生变化");
    // No paid upscale. Pad odd edges by at most one pixel for yuv420p; no invented motion.
    await runMediaTool(
      "ffmpeg",
      [
        "-y",
        "-nostdin",
        "-i",
        input,
        "-map",
        "0:v:0",
        "-an",
        "-vf",
        `tpad=stop_mode=clone:stop_duration=${Math.max(0, nominalDuration - raw.duration)},fps=30,trim=duration=${nominalDuration},setpts=PTS-STARTPTS,pad=ceil(iw/2)*2:ceil(ih/2)*2`,
        "-frames:v",
        String(Math.round(nominalDuration * 30)),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        output,
      ],
      signal
    );
    const probe = JSON.parse(
      (
        await runMediaTool(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            output,
          ],
          signal
        )
      ).stdout
    );
    const stream = probe.streams?.find(
        (s: { codec_type: string }) => s.codec_type === "video"
      ),
      duration = Number(stream?.duration ?? probe.format?.duration);
    if (
      !stream ||
      !Number.isFinite(duration) ||
      Math.abs(duration - nominalDuration) > 1 / 30
    )
      throw Error("编辑参考片未达到供應商输入时长，未占用修改次数");
    const bytes = await readFile(output),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    const objectName = `post-prod/${userId}/code-motion/${projectId}/edit-reference/${sha256}.mp4`;
    await uploadBufferToGcsIfAbsent({
      objectName,
      buffer: bytes,
      contentType: "video/mp4",
      signal,
    });
    const owner = await registerCanvasMediaOwner({
      objectPath: objectName,
      ownerUserId: Number(userId),
      source: "code-motion-video-edit-reference",
    });
    if (owner !== "created" && owner !== "alreadyOwned")
      throw Error("编辑参考片归属尚未登记");
    const result: EditProviderReference = {
      videoUri: `gs://${getGcsBucketName()}/${objectName}`,
      sha256,
      duration,
      width: Number(stream.width),
      height: Number(stream.height),
      rawUri: uri,
      rawSha256: raw.sha256,
      rawDuration: raw.duration,
      strategy,
    };
    const body = Buffer.from(JSON.stringify(result));
    try {
      await storage.write(name, body, "0");
    } catch (error) {
      const winner = await storage.read(name);
      if (!winner || !winner.body.equals(body)) throw error;
    }
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
