import { createReadStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { stat, statfs } from "node:fs/promises";
import { MANHUA_LOCAL_VIDEO_MAX_BYTES } from "../../shared/manhuaLocalVideoUpload";
import { createHash, randomUUID } from "node:crypto";
import type { Manhua0996Playback } from "../../shared/manhuaLearn0996Source";
import { dispatchHeavyMedia } from "../jobs/heavyMediaQueue";
import {
  heavyMediaCallbackCommand,
  requireHeavyMediaContext,
  shouldDispatchHeavyMedia,
} from "../jobs/heavyMediaContext";
import { uploadStreamToGcs, signGsUriV4ReadUrl } from "./gcs";

/** Copies bytes, never a volume path. Hash identity survives machine replacement. */
export async function stageHeavyMediaFile(
  file: string,
  signal?: AbortSignal
): Promise<string> {
  const { userId } = requireHeavyMediaContext();
  const before = await stat(file);
  if (before.size <= 0 || before.size > MANHUA_LOCAL_VIDEO_MAX_BYTES)
    throw new Error("Staged source exceeds the existing upload limit");
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    signal?.throwIfAborted();
    digest.update(chunk);
  }
  const after = await stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    throw new Error("媒体源在备料时发生变化");
  const objectName = `heavy-media-sources/u${userId}/${digest.digest("hex")}.mp4`;
  const result = await uploadStreamToGcs({
    objectName,
    stream: Readable.toWeb(
      createReadStream(file)
    ) as ReadableStream<Uint8Array>,
    contentLength: before.size,
    contentType: "video/mp4",
    signal,
  });
  const uploaded = await stat(file);
  if (uploaded.size !== before.size || uploaded.mtimeMs !== before.mtimeMs)
    throw new Error("媒体源在上传时发生变化");
  return result.gcsUri;
}

/** Only output-free media inspection. No shell, arbitrary executable, cookies or file output. */
export function assertHeavyLearnCommand(
  command: string,
  args: string[]
): asserts command is "ffprobe" | "ffmpeg" | "yt-dlp" {
  if (!["ffprobe", "ffmpeg", "yt-dlp"].includes(command))
    throw new Error("Unsupported learning media executable");
  if (
    args.some(value =>
      /cookie|authorization|--exec|--config|--plugin|--batch|--netrc|--proxy|--output|--paths/i.test(
        value
      )
    )
  ) {
    throw new Error(
      "Credentials and arbitrary execution are forbidden in media tasks"
    );
  }
  if (
    command === "yt-dlp" &&
    !args.some(value =>
      ["-J", "--dump-single-json", "--dump-json", "-j"].includes(value)
    )
  ) {
    throw new Error("Only metadata inspection is allowed");
  }
  if (
    command === "ffmpeg" &&
    (args[args.length - 1] !== "-" ||
      !args.some((v, i) => v === "-f" && args[i + 1] === "null"))
  ) {
    throw new Error("Only null-output decoding is allowed");
  }
  if (
    args.some(value =>
      /^(?:file:|concat:|subfile:|crypto:|pipe:|\/|\.\.?\/)/i.test(value)
    )
  ) {
    throw new Error("Local media paths cannot cross machines");
  }
}
export async function dispatchLearnCommand(
  command: string,
  args: string[],
  options: {
    timeout?: number;
    maxBuffer?: number;
    signal?: AbortSignal;
  }
) {
  const forwarded = [...args];
  const marker = forwarded.indexOf("--mvstudio-cookie-candidate");
  let cookieCandidate: number | undefined;
  if (marker >= 0) {
    cookieCandidate = Number(forwarded[marker + 1]);
    if (
      !Number.isInteger(cookieCandidate) ||
      cookieCandidate < 0 ||
      cookieCandidate > 10
    )
      throw new Error("Invalid cookie candidate");
    forwarded.splice(marker, 2);
  }
  assertHeavyLearnCommand(command, forwarded);
  const request = {
    kind: "learn_command" as const,
    command,
    args: forwarded,
    cookieCandidate,
    timeoutMs: options.timeout,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
  };
  const callback = heavyMediaCallbackCommand.getStore();
  const result = callback
    ? await callback(request)
    : await dispatchHeavyMedia<
        import("../jobs/heavyMediaQueue").HeavyCommandResult
      >(request, { signal: options.signal });
  if ("executionError" in result && result.executionError)
    throw Object.assign(new Error(String(result.executionError)), {
      stdout: result.stdout,
      stderr: result.stderr,
    });
  return result;
}
export async function dispatchLocalVideoProbe(
  file: string,
  signal?: AbortSignal
) {
  const source = await stageHeavyMediaFile(file, signal);
  return dispatchHeavyMedia<number>(
    { kind: "local_probe", source },
    { signal }
  );
}

/** 签名绑定出口：取得媒体地址也在工作机执行，凭证不进入队列。 */
export async function dispatchLearnSourcePlayback(
  sourceUrl: string,
  signal?: AbortSignal,
): Promise<Manhua0996Playback> {
  signal?.throwIfAborted();
  // 每次显式刷新独立身份；同次入队后的轮询仍沿用原任务，不能复用重启前的签名。
  const request = { kind: "learn_source" as const, sourceUrl, refreshId: randomUUID() };
  const callback = heavyMediaCallbackCommand.getStore();
  const result = callback
    ? await callback(request)
    : await dispatchHeavyMedia<import("../jobs/heavyMediaQueue").HeavyCommandResult>(request, { signal });
  signal?.throwIfAborted();
  if (result.executionError) throw new Error(result.executionError);
  let playback: Manhua0996Playback;
  try {
    playback = JSON.parse(result.stdout) as Manhua0996Playback;
  } catch {
    throw new Error("工作机返回的媒体来源回执不是有效 JSON");
  }
  if (!playback || !Array.isArray(playback.playbackUrls) || !playback.playbackUrls.length
    || !playback.playbackUrls.every(url => typeof url === "string" && url.startsWith("https://"))
    || !playback.playbackUrls.includes(playback.playbackUrl)
    || typeof playback.referer !== "string" || !Array.isArray(playback.markers)) {
    throw new Error("工作机返回的媒体来源回执不完整");
  }
  return playback;
}
export { shouldDispatchHeavyMedia, signGsUriV4ReadUrl };

/** Download only our staged object, stream to disk, and verify the content-addressed source. */
export async function materializeHeavyMediaSource(
  uri: string,
  work: (file: string) => Promise<unknown>
) {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { createWriteStream } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { pipeline } = await import("node:stream/promises");
  const { heavyMediaSignal } = await import("../jobs/heavyMediaContext");
  const { getGcsBucketName } = await import("./gcs");
  const owner = requireHeavyMediaContext();
  const prefix = `gs://${getGcsBucketName()}/heavy-media-sources/u${owner.userId}/`;
  if (
    !uri.startsWith(prefix) ||
    !/^[a-f0-9]{64}\.mp4$/.test(uri.slice(prefix.length))
  )
    throw new Error("Invalid staged media source");
  const expected = uri.slice(prefix.length, -4);
  const dir = await mkdtemp(`${tmpdir()}/heavy-source-`);
  const file = `${dir}/source.mp4`;
  const signal = heavyMediaSignal.getStore();
  try {
    const response = await fetch(signGsUriV4ReadUrl(uri, 3600), {
      signal,
      redirect: "error",
    });
    if (!response.ok || !response.body)
      throw new Error("Staged source unavailable");
    const declared = Number(response.headers.get("content-length") || 0);
    const available = await statfs(dir);
    if (
      declared > MANHUA_LOCAL_VIDEO_MAX_BYTES ||
      available.bavail * available.bsize <
        (declared || MANHUA_LOCAL_VIDEO_MAX_BYTES) + 128 * 1024 * 1024
    ) {
      await response.body.cancel();
      throw new Error("Staged source exceeds media/disk limits");
    }
    const hash = createHash("sha256");
    let received = 0;
    const checked = new Transform({
      transform(chunk, _encoding, done) {
        received += chunk.length;
        if (received > MANHUA_LOCAL_VIDEO_MAX_BYTES)
          return done(
            new Error("Staged source exceeds the existing upload limit")
          );
        hash.update(chunk);
        done(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream
      ),
      checked,
      createWriteStream(file, { flags: "wx" }),
      { signal }
    );
    if (declared && received !== declared)
      throw new Error("Staged source byte count mismatch");
    if (hash.digest("hex") !== expected)
      throw new Error("Staged source integrity mismatch");
    return await work(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 当前截图与报告重处理复用备料回调，不排到占用中的父任务后面。 */
export async function dispatchLearnWork<T>(work: import("../jobs/heavyMediaQueue").HeavyLearnWork, signal?: AbortSignal,
  onEvents?: (events: import("../jobs/heavyMediaQueue").HeavyLearnEvent[]) => Promise<void>): Promise<T> {
  signal?.throwIfAborted();
  const request = { kind: "learn_work" as const, work, requestId: randomUUID() };
  const callback = heavyMediaCallbackCommand.getStore();
  let delivered = 0;
  const result = callback ? await callback(request, onEvents) : await dispatchHeavyMedia<import("../jobs/heavyMediaQueue").HeavyCommandResult>(request, {
    signal, onProgress: onEvents ? async value => {
      const events = value.operationEvents ?? [];
      if (events.length > delivered) { await onEvents(events.slice(delivered)); delivered = events.length; }
    } : undefined,
  });
  signal?.throwIfAborted();
  if (result.executionError) throw new Error(result.executionError);
  return JSON.parse(result.stdout) as T;
}
