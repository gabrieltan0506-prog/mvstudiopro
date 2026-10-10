import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  CODE_MOTION_AUDIO_MAX_BYTES,
  CODE_MOTION_AUDIO_MAX_SECONDS,
  codeMotionAudioSchema,
  codeMotionAudioSourceSchema,
  validateCodeMotionAudio,
  type CodeMotionAudio,
  type CodeMotionAudioSource,
} from "../../shared/codeMotionAudio";
import {
  getGcsBucketName,
  inspectGcsObjectBounded,
  uploadBufferToGcsIfAbsent,
} from "./gcs";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import {
  fetchPostProdSourceToFile,
  probeAudio,
  runMediaTool,
} from "./postProduction";
import { AUDIO_SAMPLE_RATE, audioSamples } from "./audioTimelineRender";

type AudioInfo = {
  duration: number;
  mimeType: CodeMotionAudioSource["mimeType"];
  extension: string;
};
const extensions: Record<CodeMotionAudioSource["mimeType"], string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
};

/** 只接收音频容器；附带封面可保留，实际视频轨拒绝进入原声素材。 */
export function detectCodeMotionAudioFormat(
  raw: unknown
): Omit<AudioInfo, "duration"> {
  const probe = raw as {
    format?: { format_name?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      disposition?: { attached_pic?: number };
    }>;
  };
  const streams = probe?.streams ?? [];
  const tracks = streams.filter(track => track.codec_type === "audio");
  if (
    tracks.length !== 1 ||
    streams.some(
      track =>
        track.codec_type === "video" && track.disposition?.attached_pic !== 1
    )
  )
    throw new Error(
      "请选择含一条有效音轨的音频文件，不支持视频文件或多音轨容器"
    );
  const formats = (probe.format?.format_name ?? "").split(",");
  const codec = tracks[0].codec_name ?? "";
  let mimeType: AudioInfo["mimeType"] | undefined;
  if (formats.includes("mp3") && codec === "mp3") mimeType = "audio/mpeg";
  if (formats.includes("wav") && /^(pcm_|adpcm_)/.test(codec))
    mimeType = "audio/wav";
  if (formats.includes("mov") && ["aac", "alac", "mp3"].includes(codec))
    mimeType = "audio/mp4";
  if (formats.includes("webm") && ["opus", "vorbis"].includes(codec))
    mimeType = "audio/webm";
  if (!mimeType)
    throw new Error("实际音频格式不受支持，请上传 MP3、WAV、M4A 或 WebM");
  return { mimeType, extension: extensions[mimeType] };
}

/** 复用后期解码器取得样本时长，兼容浏览器录音没有容器时长及 MP3 编码延迟。 */
async function decodeAudio(
  source: string,
  decoded: string,
  signal: AbortSignal
): Promise<AudioInfo> {
  const probe = await runMediaTool(
    "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      source,
    ],
    signal
  );
  const format = detectCodeMotionAudioFormat(JSON.parse(probe.stdout));
  await runMediaTool(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-nostdin",
      "-xerror",
      "-protocol_whitelist",
      "file",
      "-i",
      source,
      "-map",
      "0:a:0",
      "-vn",
      "-ar",
      String(AUDIO_SAMPLE_RATE),
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      "-t",
      String(CODE_MOTION_AUDIO_MAX_SECONDS + 0.1),
      decoded,
    ],
    signal
  );
  const duration = await probeAudio(decoded, signal);
  if (duration > CODE_MOTION_AUDIO_MAX_SECONDS)
    throw new Error("单个音源不得超过 180 秒，请先裁剪");
  return { ...format, duration };
}

export type CodeMotionAudioImportDeps = {
  resolve: typeof resolveRegisteredPostProdMediaSource;
  read(uri: string): Promise<Buffer>;
  inspect(bytes: Buffer): Promise<AudioInfo>;
  archive(objectName: string, bytes: Buffer, mime: string): Promise<string>;
};
const importDeps: CodeMotionAudioImportDeps = {
  resolve: resolveRegisteredPostProdMediaSource,
  async read(uri) {
    const chunks: Buffer[] = [];
    await inspectGcsObjectBounded({
      gcsUri: uri,
      maxBytes: CODE_MOTION_AUDIO_MAX_BYTES,
      timeoutMs: 60_000,
      onChunk: chunk => chunks.push(Buffer.from(chunk)),
    });
    return Buffer.concat(chunks);
  },
  async inspect(bytes) {
    const root = await mkdtemp(path.join(tmpdir(), "ink-audio-import-"));
    try {
      const source = path.join(root, "source");
      await writeFile(source, bytes);
      return await decodeAudio(
        source,
        path.join(root, "decoded.wav"),
        AbortSignal.timeout(90_000)
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  async archive(objectName, bytes, contentType) {
    const result = await uploadBufferToGcsIfAbsent({
      objectName,
      buffer: bytes,
      contentType,
      signal: AbortSignal.timeout(60_000),
    });
    if (!result.created)
      throw new Error("原声音源归档冲突，未覆盖任何已有文件");
    return `gs://${getGcsBucketName()}/${objectName}`;
  },
};

function ownerPrefix(userId: string, projectId: string) {
  if (!/^[1-9][0-9]*$/.test(userId)) throw new Error("音源账号无法确认");
  z.string().uuid().parse(projectId);
  return `post-prod/${userId}/code-motion/${projectId}/audio/`;
}

export async function importCodeMotionAudio(
  input: { userId: string; projectId: string; name: string; gcsUri: string },
  deps = importDeps
): Promise<CodeMotionAudioSource> {
  const prefix = ownerPrefix(input.userId, input.projectId);
  const name = z.string().trim().min(1).max(160).parse(input.name);
  if (!/\.(mp3|wav|m4a|webm)$/i.test(name))
    throw new Error("请选择 MP3、WAV、M4A 或 WebM 文件");
  const uri = await deps.resolve({
    userId: input.userId,
    source: input.gcsUri,
  });
  if (!/^gs:\/\/[^/]+\//.test(uri)) throw new Error("音源须通过站内上传后导入");
  const bytes = await deps.read(uri);
  if (!bytes.length || bytes.length > CODE_MOTION_AUDIO_MAX_BYTES)
    throw new Error("音源为空或超过 30 MB");
  const info = await deps.inspect(bytes);
  const id = randomUUID();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const result = codeMotionAudioSourceSchema.parse({
    id,
    name,
    gcsUri: `${uri.split("/").slice(0, 3).join("/")}/${prefix}${id}/${sha256}.${info.extension}`,
    duration: info.duration,
    mimeType: info.mimeType,
    sha256,
    bytes: bytes.length,
  });
  const archived = await deps.archive(
    `${prefix}${id}/${sha256}.${info.extension}`,
    bytes,
    info.mimeType
  );
  if (archived !== result.gcsUri) throw new Error("音源归档身份不一致，未采用");
  return result;
}

export type CodeMotionAudioOwnershipDeps = {
  resolve: typeof resolveRegisteredPostProdMediaSource;
};
export async function assertCodeMotionAudioOwnership(
  input: { userId: string; projectId: string; audio: CodeMotionAudio },
  deps: CodeMotionAudioOwnershipDeps = {
    resolve: resolveRegisteredPostProdMediaSource,
  }
) {
  const audio = codeMotionAudioSchema.parse(input.audio);
  const prefix = ownerPrefix(input.userId, input.projectId);
  for (const source of audio.sources) {
    const expected = `${prefix}${source.id}/${source.sha256}.${extensions[source.mimeType]}`;
    if (source.gcsUri.split("/").slice(3).join("/") !== expected)
      throw new Error("音源不属于当前账号和作品，或归档身份已被修改");
    if (
      (await deps.resolve({ userId: input.userId, source: source.gcsUri })) !==
      source.gcsUri
    )
      throw new Error("音源存储身份不一致");
  }
}

/** 以48kHz整数样本编排，淡入淡出在原片段上执行，不循环、不加速。 */
export function buildCodeMotionAudioMixArgs(
  raw: CodeMotionAudio,
  duration: number,
  decodedPaths: Map<string, string>,
  output: string,
  speechPath?: string
): string[] {
  const audio = codeMotionAudioSchema.parse(raw);
  const errors = validateCodeMotionAudio(audio, duration);
  if (errors.length) throw new Error(errors.join("；"));
  const args = ["-y", "-v", "error", "-nostdin"];
  for (const source of audio.sources) {
    const file = decodedPaths.get(source.id);
    if (!file) throw new Error("原声音源未解码，不能混音");
    args.push("-protocol_whitelist", "file", "-i", file);
  }
  if (speechPath) args.push("-protocol_whitelist", "file", "-i", speechPath);
  const total = audioSamples(duration);
  const filters = audio.audioTimeline.map((clip, i) => {
    const sourceIndex = audio.sources.findIndex(
      source => source.id === clip.sourceId
    );
    const start = audioSamples(clip.trimStart),
      end = audioSamples(clip.trimStart + clip.duration);
    const count = end - start;
    if (count <= 0) throw new Error("音频片段不足一个样本");
    if (audioSamples(clip.at) + count > total)
      throw new Error("音频片段取整后超出时间轴，不允许截断尾音");
    if (audioSamples(clip.fadeIn) + audioSamples(clip.fadeOut) > count)
      throw new Error("淡入淡出取整后超出音频片段");
    const chain = [
      `[${sourceIndex}:a:0]atrim=start_sample=${start}:end_sample=${end}`,
      "asetpts=PTS-STARTPTS",
      `volume=${clip.volume}`,
    ];
    if (clip.fadeIn)
      chain.push(`afade=t=in:ss=0:ns=${audioSamples(clip.fadeIn)}`);
    if (clip.fadeOut)
      chain.push(
        `afade=t=out:ss=${count - audioSamples(clip.fadeOut)}:ns=${audioSamples(clip.fadeOut)}`
      );
    chain.push(
      `adelay=${audioSamples(clip.at)}S:all=1`,
      `apad=whole_len=${total}`,
      `atrim=end_sample=${total}[a${i}]`
    );
    return chain.join(",");
  });
  const labels = audio.audioTimeline.map((_, i) => `[a${i}]`);
  if (speechPath) {
    filters.push(
      `[${audio.sources.length}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_len=${total},atrim=end_sample=${total}[speech]`
    );
    labels.push("[speech]");
  }
  filters.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0,alimiter=limit=0.95:level=0:latency=1,atrim=end_sample=${total}[out]`
  );
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[out]",
    "-vn",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    output
  );
  return args;
}

export type CodeMotionAudioRenderDeps = {
  ownership: typeof assertCodeMotionAudioOwnership;
  fetch: typeof fetchPostProdSourceToFile;
  decode: typeof decodeAudio;
  run: typeof runMediaTool;
  probe: typeof probeAudio;
};
const renderDeps: CodeMotionAudioRenderDeps = {
  ownership: assertCodeMotionAudioOwnership,
  fetch: fetchPostProdSourceToFile,
  decode: decodeAudio,
  run: runMediaTool,
  probe: probeAudio,
};

export async function renderCodeMotionAudio(
  input: {
    userId: string;
    projectId: string;
    audio: CodeMotionAudio;
    duration: number;
    root: string;
    speechPath?: string;
    signal: AbortSignal;
  },
  deps = renderDeps
) {
  input.signal.throwIfAborted();
  const audio = codeMotionAudioSchema.parse(input.audio);
  const errors = validateCodeMotionAudio(audio, input.duration);
  if (errors.length) throw new Error(errors.join("；"));
  await deps.ownership({
    userId: input.userId,
    projectId: input.projectId,
    audio,
  });
  const paths = new Map<string, string>();
  for (let index = 0; index < audio.sources.length; index++) {
    const source = audio.sources[index];
    input.signal.throwIfAborted();
    const file = path.join(input.root, `source-audio-${index}`),
      decoded = path.join(input.root, `source-audio-${index}.wav`);
    await deps.fetch(source.gcsUri, file, {
      signal: input.signal,
      maxBytes: CODE_MOTION_AUDIO_MAX_BYTES,
    });
    const bytes = await readFile(file);
    if (
      bytes.length !== source.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== source.sha256
    )
      throw new Error("原声音源内容与已确认版本不一致，未生成替代音轨");
    const actual = await deps.decode(file, decoded, input.signal);
    if (
      actual.mimeType !== source.mimeType ||
      Math.abs(actual.duration - source.duration) > 1 / AUDIO_SAMPLE_RATE + 1e-6
    )
      throw new Error("原声音源格式或实际时长与已确认版本不一致");
    paths.set(source.id, decoded);
  }
  const output = path.join(input.root, "ink-soundtrack.wav");
  await deps.run(
    "ffmpeg",
    buildCodeMotionAudioMixArgs(
      audio,
      input.duration,
      paths,
      output,
      input.speechPath
    ),
    input.signal
  );
  const duration = await deps.probe(output, input.signal);
  if (
    Math.abs(duration - audioSamples(input.duration) / AUDIO_SAMPLE_RATE) >
    1 / AUDIO_SAMPLE_RATE + 1e-6
  )
    throw new Error("混音实际时长不符，未采用视频");
  return {
    output,
    receipt: {
      duration,
      sampleRate: AUDIO_SAMPLE_RATE,
      sourceIds: audio.sources.map(source => source.id),
      sourceHashes: audio.sources.map(source => source.sha256),
      audioTimeline: audio.audioTimeline,
      includedSpeech: Boolean(input.speechPath),
    },
  };
}
