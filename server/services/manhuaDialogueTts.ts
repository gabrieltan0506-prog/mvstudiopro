/**
 * 对白配音一体化：TTS（Qwen-Audio 3.0 TTS Plus 经 OpenRouter）→ 变声打指纹（内嵌，
 * 2026-08-15 用户拍板：出对白时就过 ffmpeg，量产零手工）→ GCS 签名 URL，
 * 产物可直接进 SD2.5 参考音频 / characterVoiceLocks.audioUrl。
 *
 * 变声档位（同日预演实锤）：
 * - 商用声库原始波形会触发上游「声音版权保护」拒单，必须打指纹后再喂；
 * - 男声 asetrate 降 3%（老年角色 8%）自然；
 * - 女声高基频经 asetrate 会出卡通音——须走 rubberband 保共振峰降调（服务器 ffmpeg
 *   带 librubberband，编译配置核过）。
 *
 * 字段纪律（2026-08-12 拍板）：TTS 只传 model/input/voice/response_format/seed 五字段，
 * 情绪靠 input 内联标签（[sad]/[whispers]/[gasp]…）。
 * 错误文案不携带任何签名 URL 或密钥（execFile 教训同款纪律）。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";

const run = promisify(execFile);

const OPENROUTER_TTS_ENDPOINT = "https://openrouter.ai/api/v1/audio/speech";
export const MANHUA_DIALOGUE_TTS_MODEL = "qwen/qwen-audio-3.0-tts-plus";

/** 变声档：male=asetrate −3%；elder=asetrate −8%；female=rubberband 保共振峰 −3%；none=原声（内部试听用，勿直喂视频引擎） */
export type DialogueVoiceFingerprint = "male" | "elder" | "female" | "none";

export function buildFingerprintAudioFilter(profile: DialogueVoiceFingerprint): string | null {
  switch (profile) {
    case "male":
      return "asetrate=42777,aresample=44100,atempo=1.0309";
    case "elder":
      return "asetrate=40572,aresample=44100,atempo=1.0870";
    case "female":
      // 保共振峰降调：高基频声线用 asetrate 会出卡通音（2026-08-15 预演实锤）
      return "rubberband=pitch=0.97";
    case "none":
      return null;
  }
}

export type ManhuaDialogueLineInput = {
  /** 台词文本，情绪标签内联（[sad]/[gasp]…） */
  text: string;
  /** 音色包 voice id（如 longanlufeng / longanlingxin；白名单外 id 直接透传） */
  voice: string;
  fingerprint: DialogueVoiceFingerprint;
  /** 固定可复现 */
  seed?: number;
};

export type ManhuaDialogueLineResult = {
  audioUrl: string;
  gcsUri: string;
  bytes: number;
  voice: string;
  fingerprint: DialogueVoiceFingerprint;
};

/** 单句对白：TTS → 指纹变声 → GCS，产物即视频引擎可用 */
export async function synthesizeManhuaDialogueLine(
  input: ManhuaDialogueLineInput,
): Promise<ManhuaDialogueLineResult> {
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY 未配置");
  const text = String(input.text || "").trim();
  if (!text) throw new Error("对白文本为空");
  const voice = String(input.voice || "").trim();
  if (!voice) throw new Error("未指定音色");

  const body: Record<string, unknown> = {
    model: MANHUA_DIALOGUE_TTS_MODEL,
    input: text.slice(0, 4000),
    voice,
    response_format: "mp3",
  };
  if (Number.isFinite(input.seed)) body.seed = Math.floor(Number(input.seed));

  const res = await fetch(OPENROUTER_TTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://www.mvstudiopro.com",
      "X-OpenRouter-Title": "MVStudioPro",
    },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`对白配音上游失败 HTTP ${res.status}`);
  }
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`对白配音产物过小（${buf.length} bytes）`);

  const filter = buildFingerprintAudioFilter(input.fingerprint);
  if (filter) {
    const dir = await mkdtemp(join(tmpdir(), "dtts-"));
    try {
      const src = join(dir, "src.mp3");
      const dst = join(dir, "dst.mp3");
      await writeFile(src, buf);
      await run("ffmpeg", ["-y", "-i", src, "-af", filter, "-b:a", "128k", dst]);
      buf = await readFile(dst);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const up = await uploadBufferToGcs({
    objectName: `manhua-dialogue-tts/${Date.now()}-${voice}-${input.fingerprint}.mp3`,
    buffer: buf,
    contentType: "audio/mpeg",
  });
  const audioUrl = await signGsUriV4ReadUrl(up.gcsUri);
  return { audioUrl, gcsUri: up.gcsUri, bytes: buf.length, voice, fingerprint: input.fingerprint };
}

export type ManhuaDialogueTrackLine = ManhuaDialogueLineInput & {
  /** 台词起点（秒，铺轨精确到毫秒） */
  atSec: number;
};

/**
 * 整镜配音轨：逐句合成（已内嵌指纹）→ 按秒位铺进等长单轨（空隙静音）→ GCS。
 * 纪律（2026-08-15 预演实锤）：一镜多句必须单轨秒级铺位，多句塞一条短音频会串音；
 * 首句 atSec 建议 ≥1.5（开头留跑道，引擎锁定参考前会即兴“卡通音”）。
 */
export async function synthesizeManhuaDialogueTrack(input: {
  lines: ManhuaDialogueTrackLine[];
  /** 轨道总长（秒）= 视频时长 */
  durationSec: number;
}): Promise<{ trackUrl: string; gcsUri: string; bytes: number; lines: ManhuaDialogueLineResult[] }> {
  const lines = (input.lines || []).filter((l) => String(l.text || "").trim());
  if (!lines.length) throw new Error("配音轨没有台词");
  const durationSec = Math.max(2, Math.min(30, Math.floor(input.durationSec)));

  const results: ManhuaDialogueLineResult[] = [];
  const dir = await mkdtemp(join(tmpdir(), "dtrack-"));
  try {
    const args: string[] = ["-y"];
    const delays: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const r = await synthesizeManhuaDialogueLine(line);
      results.push(r);
      const { buffer } = await import("./gcs.js").then((m) =>
        m.downloadGcsObject({ gcsUri: r.gcsUri }),
      );
      const p = join(dir, `L${i}.mp3`);
      await writeFile(p, buffer);
      args.push("-i", p);
      const ms = Math.max(0, Math.round(Number(line.atSec) * 1000));
      delays.push(`[${i}]adelay=${ms}|${ms}[a${i}]`);
    }
    const mixInputs = lines.map((_, i) => `[a${i}]`).join("");
    const filter = `${delays.join(";")};${mixInputs}amix=inputs=${lines.length}:normalize=0,apad=whole_dur=${durationSec}[out]`;
    const dst = join(dir, "track.mp3");
    args.push("-filter_complex", filter, "-map", "[out]", "-t", String(durationSec), "-b:a", "160k", dst);
    await run("ffmpeg", args);
    const buf = await readFile(dst);
    const up = await uploadBufferToGcs({
      objectName: `manhua-dialogue-tts/track-${Date.now()}-${durationSec}s.mp3`,
      buffer: buf,
      contentType: "audio/mpeg",
    });
    return {
      trackUrl: await signGsUriV4ReadUrl(up.gcsUri),
      gcsUri: up.gcsUri,
      bytes: buf.length,
      lines: results,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
