/**
 * 对白配音 · 百炼直连（新加坡套餐优先 → 北京套餐 fallback）。
 *
 * ⚠️ **本模块目前是后台准备层，没有客户端入口。**
 * `manhuaDialogueTtsPreview` 路由存在，但 client/ 里没有调用者；
 * `assertDialogueAudioAccepted` 同样只有定义、无生产调用点 ——
 * 因为对白音频真正的消费端是「进 reference_audios」，
 * 而那条链路要等配音卡做出来才存在。
 *
 * 硬接一个假的消费端只会造出另一个壳。配音卡另开 PR，
 * 届时 assertDialogueAudioAccepted 必须接在组装 reference_audios 之前。
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
import {
  QWEN_TTS_VOICE_CATALOG,
  buildQwenTtsVoiceId,
} from "../../shared/qwenTtsVoiceCatalog.js";

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

/**
 * 已入库的 597 席音色（`shared/qwenTtsVoiceCatalog.ts`）。
 * 上一版任何字符串都自动加前缀就送上游，等于没校验 —— 拼错一个字母，
 * 要等异步返回才知道白花一次。
 */
const CATALOG_VOICES = new Set(
  QWEN_TTS_VOICE_CATALOG.map((e) => buildQwenTtsVoiceId("plus", e.suffix)),
);

/** 只放真实验证过的系统短名；`/_v\d/` 那种形状匹配会放行任意乱写 */
const VERIFIED_SHORT_VOICES = new Set([
  "longanhuan_v3.6",
  "longhongyanxuan_v3.6",
  "longweijuquan_v3.6",
  "longfushanmu_v3.6",
]);

/** voice 参数补全＋校验：597 席带完整前缀，系统短名走白名单 */
export function normalizeBailianTtsVoice(voice: string): string {
  const v = String(voice || "").trim();
  if (!v) throw new Error("对白配音缺少 voice");
  if (VERIFIED_SHORT_VOICES.has(v)) return v;
  const full = v.startsWith(BAILIAN_TTS_VOICE_PREFIX) ? v : `${BAILIAN_TTS_VOICE_PREFIX}${v}`;
  if (!CATALOG_VOICES.has(full)) {
    throw new Error(`voice 不在已入库音色目录：${v}`);
  }
  return full;
}

export type BailianTtsRequest = {
  text: string;
  voice: string;
  /** 情绪与语气的中文指令，例如「压低声音，带着颤抖」 */
  instructionZh?: string;
  /** 固定则可复现；上一版路由收了却没往下传，被静默丢弃 */
  seed?: number;
};

export function buildBailianTtsBody(req: BailianTtsRequest): Record<string, unknown> {
  const text = String(req.text || "").trim();
  if (!text) throw new Error("对白配音缺少文本");
  assertNoBracketEmotionTags(text);
  const instruction = String(req.instructionZh || "").trim();
  if (instruction) assertNoBracketEmotionTags(instruction);
  if (req.seed != null && (!Number.isInteger(req.seed) || req.seed < 0 || req.seed > 65535)) {
    throw new Error("seed 必须是 0–65535 的整数");
  }
  return {
    model: BAILIAN_TTS_MODEL,
    input: {
      text,
      voice: normalizeBailianTtsVoice(req.voice),
      ...(instruction ? { instruction } : {}),
      // seed 是该端点 input 的属性（0–65535），不是顶层 parameters。
      // 上一版类推自原生精读的 parameters —— 那是另一种接口，不能套用。
      ...(Number.isInteger(req.seed) ? { seed: req.seed } : {}),
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
export function sumSilenceDuration(stderr: string): number {
  let total = 0;
  const re = /silence_duration:\s*([\d.]+)/g;
  for (let m = re.exec(stderr); m; m = re.exec(stderr)) total += Number(m[1]) || 0;
  return total;
}

/**
 * 量有效人声时长。
 *
 * ⚠️ **上一版是错的，而且错得没有症状**：silencedetect 的输出写在
 * `ffmpeg -f null -` **成功那一次**的 stderr 里（真 ffmpeg 复现：exit=0，
 * stderr 里两条 silence_duration 共 2.0 秒），而代码只在 catch 里读 stderr。
 * 于是 silentTotal 恒为 0、voicedSec 恒等于 totalSec ——
 * 3 秒容器里只有 1 秒人声也会被判成 3 秒放行，2.5 秒硬闸完全失效。
 *
 * 现在从**成功结果**里读 stderr。量不到时长直接抛，不返回可疑数字。
 */
export async function measureDialogueVoiced(
  filePath: string,
  abortSignal?: AbortSignal,
): Promise<{ totalSec: number; voicedSec: number }> {
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);

  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { signal },
  );
  const totalSec = Number(String(stdout).trim());
  if (!Number.isFinite(totalSec) || totalSec <= 0) {
    throw new Error("ffprobe 未返回有效音频时长");
  }

  const { stderr } = await execFileAsync(
    "ffmpeg",
    ["-v", "info", "-i", filePath, "-af", "silencedetect=noise=-40dB:d=0.2", "-f", "null", "-"],
    { signal },
  );

  const voicedSec = Math.max(0, totalSec - sumSilenceDuration(String(stderr)));
  return { totalSec, voicedSec };
}

export type BailianDialogueResult = {
  /**
   * accepted 才有生产用地址。
   *
   * 上一版门禁判 false 之后**照样上传、照样返回正式 gcsUri** ——
   * 闸只是个标签，调用方拿到地址就能直接喂视频模型，
   * 「有效人声 ≥2.5s」的硬指标形同虚设。
   */
  status: "accepted" | "rejected";
  audioUrl: string | null;
  gcsUri: string | null;
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
type BailianAudioTicket = { region: BailianTtsRegion; audioUrl: string };

/**
 * 只做一件事：**拿到第一张成功的取件票**。
 *
 * 上一版把「发请求 → 取音频 → 上传 GCS → ffmpeg 量测 → 签名」全包在
 * 区域循环的同一个 try 里。新加坡已经 HTTP 200 之后，只要取件、GCS、
 * ffmpeg 或签名任一步失败，就会拿北京凭证**再合成一次** ——
 * 那不是通道回落，是同一句话付两次钱。
 *
 * 4xx 不回落：参数错误换个区一样错，只会白花第二次。
 */
async function requestBailianAudioTicket(
  body: Record<string, unknown>,
  creds: readonly BailianTtsCredential[],
  abortSignal?: AbortSignal,
): Promise<BailianAudioTicket> {
  let lastError: unknown = null;
  for (const cred of creds) {
    try {
      const signal = abortSignal
        ? AbortSignal.any([abortSignal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000);
      const response = await fetch(cred.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${cred.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      const payload = (await response.json().catch(() => null)) as {
        output?: { audio?: { url?: string } };
        message?: string;
      } | null;
      if (response.status >= 400 && response.status < 500) {
        throw new Error(
          `对白配音参数未通过 HTTP ${response.status}：${String(payload?.message || "").slice(0, 160)}`,
        );
      }
      if (!response.ok) {
        lastError = new Error(`${cred.region} HTTP ${response.status}`);
        continue;
      }
      const audioUrl = String(payload?.output?.audio?.url || "").trim();
      if (!audioUrl) throw new Error("对白配音返回缺少音频地址");
      return { region: cred.region, audioUrl };
    } catch (e) {
      if (abortSignal?.aborted) throw e;
      if (e instanceof Error && /参数未通过|缺少音频地址/.test(e.message)) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("对白配音通道均未完成");
}

/**
 * 合成一段对白：新加坡套餐优先，失败回落北京套餐。
 *
 * **回落只覆盖取件那一步**；下载、量测、上传都在循环之外，只跑一次。
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

  const ticket = await requestBailianAudioTicket(body, creds, opts.abortSignal);

  // ── 以下只执行一次，失败不再触发第二次合成 ──
  const fetchSignal = opts.abortSignal
    ? AbortSignal.any([opts.abortSignal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);
  const got = await fetch(ticket.audioUrl, { signal: fetchSignal });
  if (!got.ok) throw new Error(`取回配音音频失败 HTTP ${got.status}`);
  const audio = await readAudioWithLimit(got, MAX_DIALOGUE_AUDIO_BYTES);

  const voice = String((body.input as Record<string, unknown>).voice);
  const dir = await mkdtemp(path.join(tmpdir(), "mvtts-"));
  const local = path.join(dir, "a.mp3");
  try {
    await writeFile(local, audio);
    const measured = await measureDialogueVoiced(local, opts.abortSignal);
    const gate = checkManhuaDialogueVoice(measured);

    // 不合格**不上传、不给地址**：拿不到 gcsUri 就没法误喂视频模型
    if (!gate.ok) {
      return {
        status: "rejected",
        audioUrl: null,
        gcsUri: null,
        bytes: audio.length,
        voice,
        region: ticket.region,
        totalSec: measured.totalSec,
        voicedSec: measured.voicedSec,
        gate,
      };
    }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.random().toString(36).slice(2, 8);
    const { gcsUri } = await uploadBufferToGcs({
      objectName: `manhua-dialogue-tts/${stamp}/${voice}-${rand}.mp3`,
      buffer: audio,
      contentType: "audio/mpeg",
    });

    return {
      status: "accepted",
      audioUrl: signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600),
      gcsUri,
      bytes: audio.length,
      voice,
      region: ticket.region,
      totalSec: measured.totalSec,
      voicedSec: measured.voicedSec,
      gate,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 进视频参考音频前的**二次断言**。
 *
 * 门禁在合成端拦一次不够：调用方可能拿的是缓存、是别处传来的记录。
 * 视频那一步是不可逆的（对白进片就烧死了），所以再验一次。
 */
export function assertDialogueAudioAccepted(input: {
  status?: string;
  gate?: { ok?: boolean };
  gcsUri?: string | null;
}): asserts input is { status: "accepted"; gate: { ok: true }; gcsUri: string } {
  if (
    input.status !== "accepted"
    || input.gate?.ok !== true
    || !String(input.gcsUri || "").trim()
  ) {
    throw new Error("对白音频未通过有效人声检查，不能进入视频参考音频");
  }
}

/** 单段对白上限：32MB 足够，超了说明上游给错了东西 */
const MAX_DIALOGUE_AUDIO_BYTES = 32 * 1024 * 1024;

/** 流式累计字节，不先整体 arrayBuffer 再检查 —— 那时内存已经吃进去了 */
async function readAudioWithLimit(res: Response, maxBytes: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`配音音频超过 ${maxBytes} 字节上限`);
    return buf;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`配音音频超过 ${maxBytes} 字节上限`);
    }
    chunks.push(Buffer.from(value));
  }
  if (!total) throw new Error("配音音频为空");
  return Buffer.concat(chunks);
}
