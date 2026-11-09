/**
 * MV 本段歌词自动识别（1109）：Gemini 听高光区间，逐句给唱词文本与起止秒（两跳：Vertex → EvoLink）。
 * 结果只是「待确认版」：用户逐句改字、改起止、增删后确认，演唱段的 {} 对白秒锁只读确认版。
 * 证据：canvas-music-mv/lyrics/<userId>/<requestId>/ 下 slice/request/raw/decoded/parsed/rejected/hop-used 永久保存。
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execHeavyMedia } from "./heavyMediaProcess";
import { geminiAudioJsonWithFallback } from "../gemini-audio";
import { downloadGcsObject, getGcsBucketName, uploadBufferToGcsIfAbsent } from "./gcs";
import {
  musicMvLyricLineIssues,
  musicMvLyricLineSchema,
  type MusicMvLyricLine,
  type MusicMvLyricTable,
} from "../../shared/canvasMusicMv";

export const MV_LYRIC_TABLE_PROMPT = (range: { startSec: number; endSec: number }, lyricsHint?: string) =>
  `你是歌曲听写员。所附音频是一首歌 ${range.startSec}–${range.endSec} 秒的片段（片段内 0 秒＝歌曲 ${range.startSec} 秒）。
逐句听写其中实际唱出的唱词（主唱与清晰可辨的和声都算），每句给片段内的起止秒（startSec 为该句第一个字开口，endSec 为最后一个字收声，保留两位小数）。
规则：只写真的唱出来的字，听不清的字用「□」占位，不臆造；纯器乐、哼唱无字的部分不出句；句按时间先后排列且不重叠；一句不超过一个呼吸乐句。
${lyricsHint?.trim() ? `用户提供的整首歌词仅用于校对用字（以实际唱出的为准，不要补写片段外的句子）：\n${lyricsHint.trim().slice(0, 6000)}\n` : ""}只返回 JSON：{"lines":[{"text":"唱词","startSec":0.00,"endSec":0.00}]}`;

const NATIVE_SCHEMA = {
  type: "OBJECT",
  properties: {
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { text: { type: "STRING" }, startSec: { type: "NUMBER" }, endSec: { type: "NUMBER" } },
        required: ["text", "startSec", "endSec"],
      },
    },
  },
  required: ["lines"],
};

/** 片段内秒 → 歌曲绝对秒，并做严格校验（写坏即抛，交下一跳）。 */
export function parseRecognizedLyricLines(decoded: unknown, range: { startSec: number; endSec: number }): MusicMvLyricLine[] {
  const rows = (decoded as { lines?: unknown })?.lines;
  if (!Array.isArray(rows)) throw new Error("缺少 lines 数组");
  const len = range.endSec - range.startSec;
  const lines = rows.map((row, i) => {
    const r = row as { text?: unknown; startSec?: unknown; endSec?: unknown };
    const start = Number(r.startSec);
    const end = Number(r.endSec);
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error(`第${i + 1}句时间不是数字`);
    if (start < -0.05 || end > len + 0.05) throw new Error(`第${i + 1}句时间 ${start}–${end} 超出片段 0–${len} 秒`);
    return musicMvLyricLineSchema.parse({
      text: String(r.text ?? "").trim(),
      startSec: Math.round((range.startSec + Math.max(0, start)) * 100) / 100,
      endSec: Math.round((range.startSec + Math.min(len, end)) * 100) / 100,
    });
  });
  const issues = musicMvLyricLineIssues(lines, range);
  if (issues.length) throw new Error(issues.join("；"));
  return lines;
}

export type RecognizeLyricTableInput = {
  requestId: string;
  audio: { id: string; gcsUri?: string; url: string };
  range: { startSec: number; endSec: number };
  lyricsHint?: string;
};

export async function recognizeMusicMvLyricTable(
  userId: number,
  input: RecognizeLyricTableInput,
  deps: {
    readSong?: (audio: RecognizeLyricTableInput["audio"]) => Promise<Buffer>;
    listen?: typeof geminiAudioJsonWithFallback;
  } = {},
): Promise<MusicMvLyricTable> {
  const prefix = `canvas-music-mv/lyrics/${userId}/${input.requestId}`;
  const bucket = getGcsBucketName();
  const save = async (name: string, value: unknown) => {
    const buffer = Buffer.from(JSON.stringify(value));
    await uploadBufferToGcsIfAbsent({ bucket, objectName: `${prefix}/${name}.json`, buffer, contentType: "application/json" });
  };
  const readSong = deps.readSong ?? (async (audio: RecognizeLyricTableInput["audio"]) =>
    audio.gcsUri ? (await downloadGcsObject({ gcsUri: audio.gcsUri })).buffer : Buffer.from(await (await fetch(audio.url)).arrayBuffer()));
  const dir = await mkdtemp(path.join(tmpdir(), "mv-lyric-"));
  try {
    const src = path.join(dir, "song");
    const out = path.join(dir, "slice.mp3");
    await writeFile(src, await readSong(input.audio));
    await execHeavyMedia("ffmpeg", ["-y", "-v", "error", "-ss", String(input.range.startSec), "-to", String(input.range.endSec), "-i", src, "-ac", "1", "-ar", "32000", "-b:a", "64k", out], { timeout: 60_000 });
    const slice = await readFile(out);
    await uploadBufferToGcsIfAbsent({ bucket, objectName: `${prefix}/slice.mp3`, buffer: slice, contentType: "audio/mpeg" });
    await save("request", { userId, ...input, sliceSha256: createHash("sha256").update(slice).digest("hex"), sliceBytes: slice.length });
    const listen = deps.listen ?? geminiAudioJsonWithFallback;
    const result = await listen({
      audioBase64: slice.toString("base64"),
      mimeType: "audio/mpeg",
      prompt: MV_LYRIC_TABLE_PROMPT(input.range, input.lyricsHint),
      nativeSchema: NATIVE_SCHEMA,
      schemaName: "music_mv_lyric_table",
      validate: decoded => parseRecognizedLyricLines(decoded, input.range),
      save,
    });
    const table: MusicMvLyricTable = {
      requestId: input.requestId,
      audioId: input.audio.id,
      range: { startSec: input.range.startSec, endSec: input.range.endSec },
      status: "pending",
      lines: result.value,
      recognizedBy: { channel: result.channel, model: result.model },
      evidencePrefix: `gs://${bucket}/${prefix}`,
    };
    await save("table-pending", table);
    return table;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
