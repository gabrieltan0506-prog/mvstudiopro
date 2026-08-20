/**
 * 对白配音主路:百炼直连 qwen-audio-3.0-tts-plus(2026-08-19 实弹破解,细节见知识库/成功接线手册 §1)。
 * OpenRouter 版(qwenDialogueTts.ts)自此降为备胎。
 *
 * 与备胎的三点不同:
 * 1. voice 必带全前缀 `qwen-audio-3.0-tts-plus-{后缀}`(597 席目录 server/data/qwenTtsPlusVoices.json);
 * 2. instruction 中文情绪指令实测有效(「醉酒中年男人绝望嘶吼,带哭腔」级别的指令直接写);
 * 3. 上游返回的是会过期的 OSS URL,拿到必须立即转存 GCS,任何持久引用只认 gcsUri。
 *
 * 情绪指令的副作用是时长拉长,因此管道内置 silenceremove 修边(-45dB)并回报时长;
 * 超秒位预算时给出 atempo 建议值(上限 1.15,再高会毁音色)。
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";
import voiceCatalogRaw from "../data/qwenTtsPlusVoices.json";

const execFileAsync = promisify(execFile);

export const BAILIAN_TTS_MODEL = "qwen-audio-3.0-tts-plus";
const VOICE_PREFIX = `${BAILIAN_TTS_MODEL}-`;
/** atempo 超过这个值音色开始明显发飘,宁可回炉重写台词 */
export const MAX_ATEMPO_SUGGESTION = 1.15;

export type QwenTtsVoice = {
  suffix: string;
  name: string;
  gender: "男" | "女";
  age: number;
  trait: string;
  scene: string;
};

export const QWEN_TTS_VOICE_CATALOG = voiceCatalogRaw as QwenTtsVoice[];

/** 《雷击》选角三席(用户 0819 拍板),平台「配音」环节的默认预设样板 */
export const LEIJI_VOICE_PRESETS = {
  男主: { voiceSuffix: "longlanjunrui", note: "43 岁浑厚沉稳,认罪戏配「绝望嘶吼带哭腔」指令" },
  林晚: { voiceSuffix: "longyingfengmu", note: "28 岁客观冷静,低稳台词" },
  播报: { voiceSuffix: "longluliuche", note: "34 岁标准播音,通讯器/系统音" },
} as const;

export type VoiceFilter = {
  gender?: "男" | "女";
  minAge?: number;
  maxAge?: number;
  /** 特质模糊匹配,如「浑厚」「威严」「播音」 */
  trait?: string;
  /** 场景模糊匹配,如「日常对话」「新闻播报」 */
  scene?: string;
};

/** 选角过滤:平台配音 UI 的数据源,过滤逻辑与知识库表一致 */
export function filterVoices(filter: VoiceFilter): QwenTtsVoice[] {
  return QWEN_TTS_VOICE_CATALOG.filter((v) => {
    if (filter.gender && v.gender !== filter.gender) return false;
    if (filter.minAge != null && v.age < filter.minAge) return false;
    if (filter.maxAge != null && v.age > filter.maxAge) return false;
    if (filter.trait && !v.trait.includes(filter.trait)) return false;
    if (filter.scene && !v.scene.includes(filter.scene)) return false;
    return true;
  });
}

export type BailianTtsInput = {
  text: string;
  /** 597 席目录里的后缀,内部自动拼全前缀;传入带全前缀的完整名也接受 */
  voiceSuffix: string;
  /** 中文情绪指令,可空 */
  instruction?: string;
  seed?: number;
  /** 台词的秒位预算;给了就在结果里回报是否超支及 atempo 建议 */
  budgetSeconds?: number;
  /** 默认 true:silenceremove 修边(-45dB 首尾) */
  trimSilence?: boolean;
};

export type BailianTtsResult = {
  audioUrl: string;
  gcsUri: string;
  bytes: number;
  voice: string;
  durationSeconds: number;
  /** budgetSeconds 给定且超支时给出;超过 MAX_ATEMPO_SUGGESTION 则为 null=建议改词 */
  atempoSuggestion: number | null;
  overBudget: boolean;
};

export function resolveVoiceName(voiceSuffix: string): string {
  const s = String(voiceSuffix || "").trim();
  if (!s) throw new Error("voiceSuffix 为空");
  return s.startsWith(VOICE_PREFIX) || s.startsWith("longanhuan_") ? s : VOICE_PREFIX + s;
}

async function probeDurationSeconds(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath,
  ]);
  const d = Number(String(stdout).trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error("ffprobe 无法读取合成音频时长");
  return d;
}

/**
 * 合成一句对白:百炼直连 → 转存 GCS → (默认)silenceremove 修边 → 时长回报。
 * 错误文案不携带签名 URL 与密钥。
 */
export async function synthesizeBailianDialogue(
  params: BailianTtsInput,
): Promise<BailianTtsResult> {
  const apiKey = String(process.env.WAN_OFFICIAL_API_KEY || "").trim();
  const base = String(process.env.WAN_OFFICIAL_BASE || "").trim().replace(/\/+$/, "");
  if (!apiKey || !base) throw new Error("WAN_OFFICIAL_API_KEY / WAN_OFFICIAL_BASE 未配置");

  const text = String(params.text || "").trim();
  if (!text) throw new Error("对白文本为空");
  const voice = resolveVoiceName(params.voiceSuffix);

  const input: Record<string, unknown> = { text: text.slice(0, 4000), voice };
  const instruction = String(params.instruction || "").trim();
  if (instruction) input.instruction = instruction;

  const body: Record<string, unknown> = { model: BAILIAN_TTS_MODEL, input };
  if (Number.isFinite(params.seed)) {
    (body as { parameters?: unknown }).parameters = { seed: Math.floor(Number(params.seed)) };
  }

  const response = await fetch(`${base}/api/v1/services/audio/tts/SpeechSynthesizer`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    output?: { audio?: { url?: string } };
    code?: string;
    message?: string;
  } | null;
  const ossUrl = payload?.output?.audio?.url;
  if (!response.ok || !ossUrl) {
    const code = payload?.code || `HTTP ${response.status}`;
    const msg = (payload?.message || "").slice(0, 200);
    throw new Error(`百炼 TTS 上游失败 ${code}:${msg}`);
  }

  // OSS URL 会过期:拿到立即取字节,绝不把它存进任何持久字段
  const rawAudio = Buffer.from(await (await fetch(ossUrl)).arrayBuffer());
  if (!rawAudio.length) throw new Error("百炼 TTS 返回空音频");

  let finalAudio = rawAudio;
  let durationSeconds = 0;
  const tmpDir = await mkdtemp(path.join(tmpdir(), "bailian-tts-"));
  try {
    const rawPath = path.join(tmpDir, "raw.wav");
    await writeFile(rawPath, rawAudio);
    if (params.trimSilence !== false) {
      const trimmedPath = path.join(tmpDir, "trimmed.mp3");
      await execFileAsync("ffmpeg", [
        "-y", "-i", rawPath,
        "-af",
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05," +
          "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse",
        "-codec:a", "libmp3lame", "-b:a", "192k",
        trimmedPath,
      ]);
      finalAudio = await readFile(trimmedPath);
      durationSeconds = await probeDurationSeconds(trimmedPath);
    } else {
      durationSeconds = await probeDurationSeconds(rawPath);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  const budget = Number(params.budgetSeconds);
  const overBudget = Number.isFinite(budget) && budget > 0 && durationSeconds > budget;
  let atempoSuggestion: number | null = null;
  if (overBudget) {
    const ratio = durationSeconds / budget;
    atempoSuggestion = ratio <= MAX_ATEMPO_SUGGESTION ? Math.round(ratio * 100) / 100 : null;
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  const { gcsUri } = await uploadBufferToGcs({
    objectName: `manhua-dialogue-tts/bailian/${stamp}/${voice}-${rand}.mp3`,
    buffer: finalAudio,
    contentType: "audio/mpeg",
  });
  const audioUrl = signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);

  return {
    audioUrl,
    gcsUri,
    bytes: finalAudio.length,
    voice,
    durationSeconds: Math.round(durationSeconds * 1000) / 1000,
    atempoSuggestion,
    overBudget,
  };
}
