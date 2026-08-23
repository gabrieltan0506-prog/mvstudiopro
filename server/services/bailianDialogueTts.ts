/**
 * 对白配音 · 百炼直连（新加坡套餐优先 → 北京套餐 fallback）。
 *
 * 与既有的 `qwenDialogueTts.ts`（走 OpenRouter）并存而非替换：
 * OpenRouter 那条只收五个标准字段，**情绪靠内联方括号标签**；
 * 百炼直连能用 `input.instruction` 中文指令，且吃套餐额度不扣充值余额。
 *
 * ⚠️ 两条通路的情绪写法**互斥，不能混**：
 *   OpenRouter  → `[angry]` `[whispers]` 内联标签
 *   百炼直连    → `input.instruction` 中文指令；
 *                 **英文方括号标签会 411**（cosyvoice 引擎直接拒），
 *                 写进 text 里不只是不生效，是整单失败。
 *
 * 路由（用户 0824 定）：
 *   ① DASHSCOPE_SG_PLAN_KEY  + token-plan.ap-southeast-1.maas.aliyuncs.com
 *   ② WAN_PLAN_API_KEY       + token-plan.cn-beijing.maas.aliyuncs.com
 * key 与 base **必须配对**：套餐 key 打工作空间域是 401 InvalidApiKey（0823 实测）。
 */
export const BAILIAN_TTS_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";
export const BAILIAN_TTS_MODEL = "qwen-audio-3.0-tts-plus";

/** 597 席音色的 voice 参数必带完整前缀；系统音色另有 longanhuan_v3.6 式短名 */
export const BAILIAN_TTS_VOICE_PREFIX = `${BAILIAN_TTS_MODEL}-`;

export type BailianTtsRegion = "singapore" | "beijing";

export type BailianTtsCredential = {
  region: BailianTtsRegion;
  apiKey: string;
  endpoint: string;
};

/**
 * 按优先级列出可用凭证。**新加坡在前**（用户 0823 定：配音一律走新加坡）。
 *
 * 只返回配齐了 key 的区；一个都没有时返回空数组，由调用方明确失败——
 * 不静默回落到按量通道（那会扣充值余额，而计划报的是套餐）。
 */
export function listBailianTtsCredentials(): BailianTtsCredential[] {
  const out: BailianTtsCredential[] = [];
  const sgKey = String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim();
  if (sgKey) {
    const sgBase = String(
      process.env.DASHSCOPE_SG_PLAN_BASE || "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
    )
      .trim()
      .replace(/\/$/, "");
    out.push({ region: "singapore", apiKey: sgKey, endpoint: `${sgBase}${BAILIAN_TTS_PATH}` });
  }
  const bjKey = String(process.env.WAN_PLAN_API_KEY || "").trim();
  if (bjKey) {
    const bjBase = String(
      process.env.WAN_PLAN_BASE || "https://token-plan.cn-beijing.maas.aliyuncs.com",
    )
      .trim()
      .replace(/\/$/, "");
    out.push({ region: "beijing", apiKey: bjKey, endpoint: `${bjBase}${BAILIAN_TTS_PATH}` });
  }
  return out;
}

/**
 * 方括号情绪标签检测。
 *
 * 百炼这条通路上它不是「不生效」而是 **411 整单失败**，
 * 所以在发请求之前拦下来，并告诉调用方改用 instruction。
 */
export function assertNoBracketEmotionTags(text: string): void {
  const hit = String(text || "").match(/\[[a-zA-Z][a-zA-Z\s_-]{1,30}\]/);
  if (hit) {
    throw new Error(
      `百炼直连不收英文方括号情绪标签（会 411），检测到 ${hit[0]}；情绪请改走 instruction 中文指令`,
    );
  }
}

/** voice 参数补全：597 席要带完整模型前缀，系统短名（含 _v）原样透传 */
export function normalizeBailianTtsVoice(voice: string): string {
  const v = String(voice || "").trim();
  if (!v) throw new Error("对白配音缺少 voice");
  if (v.startsWith(BAILIAN_TTS_VOICE_PREFIX)) return v;
  // longanhuan_v3.6 这类系统音色是独立命名，不加前缀
  if (/_v\d/.test(v)) return v;
  return `${BAILIAN_TTS_VOICE_PREFIX}${v}`;
}

export type BailianTtsRequest = {
  text: string;
  voice: string;
  /** 情绪与语气的中文指令，例如「压低声音，带着颤抖」 */
  instructionZh?: string;
};

export function buildBailianTtsBody(req: BailianTtsRequest): Record<string, unknown> {
  const text = String(req.text || "").trim();
  if (!text) throw new Error("对白配音缺少文本");
  assertNoBracketEmotionTags(text);
  const instruction = String(req.instructionZh || "").trim();
  if (instruction) assertNoBracketEmotionTags(instruction);
  return {
    model: BAILIAN_TTS_MODEL,
    input: {
      text,
      voice: normalizeBailianTtsVoice(req.voice),
      ...(instruction ? { instruction } : {}),
    },
  };
}

/* ────────────────────────── 真实合成 ────────────────────────── */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";
import {
  checkManhuaDialogueVoice,
  type ManhuaVoiceGateVerdict,
} from "../../shared/manhuaDialogueVoiceGate.js";

const execFileAsync = promisify(execFile);

/**
 * 量有效人声时长。
 *
 * **不能拿容器总时长冒充** —— 补过静音的音频容器达标而人声没变。
 * 这里用 ffmpeg silencedetect 把静音段总长扣掉，剩下的才算发声。
 */
export async function measureDialogueVoiced(
  filePath: string,
  abortSignal?: AbortSignal,
): Promise<{ totalSec: number; voicedSec: number }> {
  const { stdout: durOut } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { timeout: 60_000, signal: abortSignal },
  );
  const totalSec = Number(String(durOut).trim()) || 0;

  // silencedetect 走 stderr；-40dB / 0.2s 是对白的常用阈值
  let stderr = "";
  try {
    await execFileAsync(
      "ffmpeg",
      ["-v", "info", "-i", filePath, "-af", "silencedetect=noise=-40dB:d=0.2", "-f", "null", "-"],
      { timeout: 120_000, signal: abortSignal },
    );
  } catch (e) {
    stderr = String((e as { stderr?: string }).stderr || "");
  }
  let silentTotal = 0;
  const re = /silence_duration:\s*([\d.]+)/g;
  for (let m = re.exec(stderr); m; m = re.exec(stderr)) silentTotal += Number(m[1]) || 0;
  const voicedSec = Math.max(0, totalSec - silentTotal);
  return { totalSec, voicedSec };
}

export type BailianDialogueResult = {
  audioUrl: string;
  gcsUri: string;
  bytes: number;
  voice: string;
  region: BailianTtsRegion;
  totalSec: number;
  voicedSec: number;
  /** 有效人声门禁结论；**ok=false 的音频不许进视频模型** */
  gate: ManhuaVoiceGateVerdict;
};

/**
 * 合成一段对白：新加坡套餐优先，失败回落北京套餐。
 *
 * 回落只针对**请求本身失败**（网络/5xx/凭证）。参数错误（4xx）不回落——
 * 换个区一样错，只会白花第二次。
 */
export async function synthesizeBailianDialogue(
  req: BailianTtsRequest,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<BailianDialogueResult> {
  const body = buildBailianTtsBody(req);
  const creds = listBailianTtsCredentials();
  if (!creds.length) {
    throw new Error("对白配音缺少套餐凭证（DASHSCOPE_SG_PLAN_KEY 或 WAN_PLAN_API_KEY）");
  }

  let lastErr: unknown = null;
  for (const cred of creds) {
    try {
      const res = await fetch(cred.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cred.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: opts.abortSignal,
      });
      const text = await res.text();
      if (!res.ok) {
        // 4xx 是参数问题，换区还是错；只有 5xx / 网络问题才值得回落
        if (res.status < 500) {
          throw new Error(`对白配音参数错误 HTTP ${res.status}：${text.slice(0, 200)}`);
        }
        lastErr = new Error(`${cred.region} HTTP ${res.status}：${text.slice(0, 160)}`);
        continue;
      }
      const json = JSON.parse(text) as { output?: { audio?: { url?: string } } };
      const audioUrl = String(json.output?.audio?.url || "").trim();
      if (!audioUrl) throw new Error("对白配音返回里没有 output.audio.url");

      // 阿里 OSS 直链有 expires_at，必须即取即转 GCS
      const got = await fetch(audioUrl, { signal: opts.abortSignal });
      if (!got.ok) throw new Error(`取回配音音频失败 HTTP ${got.status}`);
      const audio = Buffer.from(await got.arrayBuffer());
      if (!audio.length) throw new Error("配音音频为空");

      const voice = String((body.input as Record<string, unknown>).voice);
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const rand = Math.random().toString(36).slice(2, 8);
      const { gcsUri } = await uploadBufferToGcs({
        objectName: `manhua-dialogue-tts/${stamp}/${voice}-${rand}.mp3`,
        buffer: audio,
        contentType: "audio/mpeg",
      });

      // 量测跑在本地临时文件上，量完即删
      const dir = await mkdtemp(path.join(tmpdir(), "mvtts-"));
      const local = path.join(dir, "a.mp3");
      let measured = { totalSec: 0, voicedSec: 0 };
      try {
        await writeFile(local, audio);
        measured = await measureDialogueVoiced(local, opts.abortSignal);
      } catch (e) {
        // 量不到就不能放行：硬指标是「有效人声 ≥2.5s」，量不到＝无法证明达标
        console.warn("[bailianTts] 有效人声量测失败：", e instanceof Error ? e.message : e);
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
      const gate: ManhuaVoiceGateVerdict = measured.totalSec
        ? checkManhuaDialogueVoice(measured)
        : {
            ok: false,
            reasonZh: "未能量测有效人声",
            actionZh: "确认运行环境有 ffmpeg/ffprobe 后重量测；量不到不得放行进视频模型",
          };

      return {
        audioUrl: signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600),
        gcsUri,
        bytes: audio.length,
        voice,
        region: cred.region,
        totalSec: measured.totalSec,
        voicedSec: measured.voicedSec,
        gate,
      };
    } catch (e) {
      if (opts.abortSignal?.aborted) throw e;
      // 参数错误不再换区重试，直接抛
      if (e instanceof Error && /参数错误|没有 output|为空/.test(e.message)) throw e;
      lastErr = e;
    }
  }
  throw new Error(
    `对白配音全部通道失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}
