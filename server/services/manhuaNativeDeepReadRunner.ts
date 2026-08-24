/**
 * 原生视频精读 · 生产执行器（0824 从旁路脚本迁入）。
 *
 * 0823 旁路实测：262 秒素材 → 6 段 → 95 个镜头，$0.566，全部 finish=stop。
 * 与抽帧链路的根本差别：运镜、转场、力度是**帧与帧之间的差分**，
 * 不存在于任何单帧里 —— 抽帧在采样那一刻就丢了，模型再强也补不回来。
 *
 * ⚠️ 默认关闭（MANHUA_NATIVE_DEEP_READ=1 才启用）。
 * 唤醒档第 14 节要求：先跑 10 集旁路、四项判定全过，才允许切生产。
 */
import crypto from "node:crypto";
import https from "node:https";
import { execFile } from "node:child_process";
import { readFileSync, statSync, unlinkSync } from "node:fs";
import {
  mapNativeDeepReadSegments,
  type NativeDeepReadOutput,
} from "../../shared/manhuaNativeDeepRead.js";

/** 生产开关：未开时学习链路完全走原有抽帧，零行为变化 */
export function isManhuaNativeDeepReadEnabled(): boolean {
  return String(process.env.MANHUA_NATIVE_DEEP_READ || "").trim() === "1";
}

const NATIVE_GENERATION_PATH = "/api/v1/services/aigc/multimodal-generation/generation";

/**
 * 端点与 key 必须配对，且**套餐优先**。
 *
 * 套餐额度已付费且不用即归零，而 WAN_OFFICIAL（`sk-ws-`）扣的是充值余额。
 * 0823 全天的精读走的都是后者，套餐买了五天一次没用上 —— 这里默认选套餐，
 * 只有套餐没配时才回落按量，避免接线时又悄悄落回扣钱那条。
 */
export function resolveNativeDeepReadCredentials(): { apiKey: string; endpoint: string; usingPlan: boolean } {
  const planKey = String(process.env.WAN_PLAN_API_KEY || "").trim();
  const planBase = String(process.env.WAN_PLAN_BASE || "https://token-plan.cn-beijing.maas.aliyuncs.com")
    .trim()
    .replace(/\/$/, "");
  if (planKey) {
    return { apiKey: planKey, endpoint: `${planBase}${NATIVE_GENERATION_PATH}`, usingPlan: true };
  }
  return {
    apiKey: String(process.env.WAN_OFFICIAL_API_KEY || "").trim(),
    endpoint: `https://dashscope.aliyuncs.com${NATIVE_GENERATION_PATH}`,
    usingPlan: false,
  };
}

export type NativeDeepReadExecutionCredentials = {
  apiKey: string;
  endpoint: string;
  usingPlan?: boolean;
};

/**
 * 凭证最终裁决：**成对给或都不给**，且按量通道不许自动接管。
 *
 * 原来允许只传 apiKey 或只传 endpoint —— 那会把套餐 key 拼到公共 dashscope 端点
 * （401），或把按量 key 拼到套餐端点。更糟的是套餐临时缺配时**自动回落按量**，
 * 只打一行日志：计划里报的是套餐额度，实际扣的是充值余额，
 * 而发车检查单在这一步之后，拦不住。
 */
export function resolveNativeDeepReadExecutionCredentials(params: {
  apiKey?: string;
  endpoint?: string;
}): NativeDeepReadExecutionCredentials {
  const explicitKey = String(params.apiKey || "").trim();
  const explicitEndpoint = String(params.endpoint || "").trim();

  if (Boolean(explicitKey) !== Boolean(explicitEndpoint)) {
    throw new Error("原生精读自定义凭证必须同时提供 apiKey 与 endpoint");
  }

  if (explicitKey && explicitEndpoint) {
    const url = new URL(explicitEndpoint);
    if (url.protocol !== "https:") {
      throw new Error("原生精读 endpoint 必须使用 HTTPS");
    }
    return { apiKey: explicitKey, endpoint: explicitEndpoint, usingPlan: undefined };
  }

  const resolved = resolveNativeDeepReadCredentials();
  if (!resolved.apiKey) {
    throw new Error("原生精读缺少 API key");
  }
  if (
    !resolved.usingPlan
    && String(process.env.MANHUA_NATIVE_DEEP_READ_ALLOW_PAYG || "").trim() !== "1"
  ) {
    throw new Error(
      "套餐通道未配置，已停止原生精读；如确认使用按量通道，请显式配置 MANHUA_NATIVE_DEEP_READ_ALLOW_PAYG=1",
    );
  }
  return resolved;
}

/**
 * 服务端下载超时约 120 秒、CDN 实测 1.56 MB/s → 单片体积上限取 90MB 留一半余量。
 *
 * ⚠️ 此前这个常量只声明、全文件零处读取 —— 文档里写的「单片上限 90MB」
 * 在代码里根本不存在。下面的 assert 才是真正生效的那道闸。
 */
const PIECE_SIZE_CAP_BYTES = 90 * 1024 * 1024;
/** 响应体上限：模型异常时可能吐超大 body，不设限会把内存吃干 */
const NATIVE_RESPONSE_CAP_BYTES = 4 * 1024 * 1024;

export function assertNativeDeepReadPieceSize(size: number): void {
  // CDN 抖动时会切出 0 字节或异常小的文件，模型收到会报 Invalid video file
  if (!Number.isFinite(size) || size < 100_000) {
    throw new Error(`切片仅 ${size} 字节`);
  }
  if (size > PIECE_SIZE_CAP_BYTES) {
    throw new Error(`切片超过 ${Math.round(PIECE_SIZE_CAP_BYTES / 1024 / 1024)}MB 处理上限`);
  }
}
function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("已取消");
}

/**
 * 可被中止的重试等待。
 *
 * 原来是裸 `setTimeout`：用户点了停止，还要空等 5 或 15 秒才反应，
 * 而且醒来后照样进下一次切片。
 */
export function waitNativeDeepReadRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** 抖音地址约 8 分钟失效；每片重新解析，不复用 */
const RESOLVE_TTL_MS = 6 * 60_000;

export type NativeDeepReadSegmentSpec = {
  /** 全片绝对秒 */
  startSec: number;
  endSec: number;
  /** 给模型的段落提示（来自粗读 hotspots 的 whyZh） */
  hintZh?: string;
};

export type NativeDeepReadRunResult = NativeDeepReadOutput & {
  /** 实际计费用量，供 provenance 落库 */
  usage: { inputTokens: number; outputTokens: number; costCny: number };
  attemptedSegments: number;
  /** 这一轮是否吃的套餐额度；false 表示扣了充值余额，对账要看这个 */
  usingPlanQuota?: boolean;
  /** 真跑的模型名，落 provenance 用（不让入库端自己再写一遍常量） */
  model: string;
};

export type NativeDeepReadRunError = Error & {
  /** 中止前已取得用量回执的成本；当前在途请求可能尚无回执。 */
  nativeDeepReadCostCny?: number;
};

/** 精读模型名：**只在这里写一次**，provenance 记的必须是真跑的这个 */
export const NATIVE_DEEP_READ_MODEL = "qwen3.8-max";

/** 北京百炼单价（¥/M token），套餐 key 走同一端点 */
const PRICE_IN_PER_M = 12;
const PRICE_OUT_PER_M = 36;

function run(
  cmd: string,
  args: string[],
  timeoutMs = 600_000,
  abortSignal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) =>
    // signal 直通：取消时 ffmpeg 会被杀掉，否则一段 18 分钟的切片要跑完才停
    execFile(
      cmd,
      args,
      { maxBuffer: 1 << 28, timeout: timeoutMs, signal: abortSignal },
      (err, stdout, stderr) =>
        err ? reject(new Error(String(stderr || err).slice(0, 300))) : resolve(stdout),
    ),
  );
}

/**
 * Node 内置 fetch（undici）headersTimeout 写死 300 秒且不可覆盖，
 * 而单次精读实测 159–272 秒、长片粗读到过 473 秒 —— 必须手写请求自控超时。
 */
function postLong(
  body: unknown,
  apiKey: string,
  endpoint: string,
  timeoutMs = 1_800_000,
  abortSignal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint);
    const payload = Buffer.from(JSON.stringify(body));
    let settled = false;
    let receivedBytes = 0;
    // socket idle timeout 只管「多久没数据」；服务端细水长流地吐能绕过它，
    // 所以另设一道总时限
    const totalTimer = setTimeout(
      () => req.destroy(new Error("原生精读请求超过总时限")),
      timeoutMs,
    );
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      fn();
    };
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        signal: abortSignal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": payload.length,
        },
      },
      (res) => {
        let d = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          receivedBytes += Buffer.byteLength(c);
          if (receivedBytes > NATIVE_RESPONSE_CAP_BYTES) {
            req.destroy(new Error("原生精读响应超过处理上限"));
            return;
          }
          d += c;
        });
        res.on("end", () => finish(() => resolve({ status: res.statusCode || 0, text: d })));
      },
    );
    req.setTimeout(120_000, () => req.destroy(new Error("原生精读连接长时间无数据")));
    req.on("error", (e) => finish(() => reject(e)));
    req.write(payload);
    req.end();
  });
}

/** OSS V1 签名：Fly 上没装 ali-oss，用内置 crypto 手写（PUT/预签名GET/DELETE 三个动作已验） */
function ossSign(verb: string, key: string, contentType: string, date: string): string {
  const bucket = String(process.env.OSS_BUCKET || "").trim();
  const sk = String(process.env.OSS_ACCESS_KEY_SECRET || "").trim();
  return crypto
    .createHmac("sha1", sk)
    .update([verb, "", contentType, date, `/${bucket}/${key}`].join("\n"), "utf8")
    .digest("base64");
}

function ossHost(): string {
  return `${String(process.env.OSS_BUCKET || "").trim()}.${String(process.env.OSS_ENDPOINT || "").trim()}`;
}

function ossPut(key: string, buf: Buffer, contentType = "video/mp4", abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    const req = https.request(
      {
        hostname: ossHost(),
        path: `/${encodeURI(key)}`,
        method: "PUT",
        signal: abortSignal,
        headers: {
          Date: date,
          "Content-Type": contentType,
          "Content-Length": buf.length,
          Authorization: `OSS ${String(process.env.OSS_ACCESS_KEY_ID || "").trim()}:${ossSign("PUT", key, contentType, date)}`,
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () =>
          (res.statusCode || 0) < 300
            ? resolve()
            : reject(new Error(`oss_put_failed:${res.statusCode}:${d.slice(0, 200)}`)),
        );
      },
    );
    req.setTimeout(1_800_000, () => req.destroy(new Error("oss upload timeout")));
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

/**
 * 阅后即焚：删失败不阻断（桶侧另有 1 天生命周期兜底）。
 * 加 30 秒总时限——清理步骤挂住会把整轮精读拖死在 finally 里。
 */
function ossDelete(key: string): Promise<void> {
  return new Promise((resolve) => {
    const date = new Date().toUTCString();
    const guard = setTimeout(() => {
      try { req.destroy(); } catch { /* 已结束 */ }
      resolve();
    }, 30_000);
    const done = () => { clearTimeout(guard); resolve(); };
    const req = https.request(
      {
        hostname: ossHost(),
        path: `/${encodeURI(key)}`,
        method: "DELETE",
        headers: {
          Date: date,
          Authorization: `OSS ${String(process.env.OSS_ACCESS_KEY_ID || "").trim()}:${ossSign("DELETE", key, "", date)}`,
        },
      },
      (res) => {
        res.resume();
        res.on("end", done);
      },
    );
    req.on("error", done);
    req.end();
  });
}

export function ossSignedUrl(key: string, expireSec = 7200): string {
  const bucket = String(process.env.OSS_BUCKET || "").trim();
  const ak = String(process.env.OSS_ACCESS_KEY_ID || "").trim();
  const sk = String(process.env.OSS_ACCESS_KEY_SECRET || "").trim();
  const expires = Math.floor(Date.now() / 1000) + expireSec;
  const sig = crypto
    .createHmac("sha1", sk)
    .update(["GET", "", "", String(expires), `/${bucket}/${key}`].join("\n"), "utf8")
    .digest("base64");
  const q = new URLSearchParams({ OSSAccessKeyId: ak, Expires: String(expires), Signature: sig });
  return `https://${ossHost()}/${encodeURI(key)}?${q}`;
}

export function buildNativeDeepReadPrompt(lenSec: number, hintZh?: string): string {
  const hint = String(hintZh || "").trim();
  return `你是漫剧成片的「导演手法」分析师。这是一个 ${lenSec} 秒的高潮片段${hint ? `（${hint}）` : ""}，抽帧间隔 0.5 秒，画面细节充足。

**重点是拍法，不是剧情。** 只返回一个 JSON，不要 Markdown 围栏：
{
 "shots":[{"startSec":整数,"endSec":整数,
   "shotSizeZh":"景别：极特写/特写/近景/中景/全景/大远景",
   "angleZh":"机位：平视/仰拍/俯拍/过肩/主观",
   "cameraMoveZh":"运镜：方向与速度，例「1.2秒内从中景推到面部特写」「快速右摇」；看不出运动写「固定机位」",
   "lightingZh":"光影：光位、色调、明暗对比",
   "actionZh":"这一镜的可拍动作",
   "transitionInZh":"进入这一镜的转场：硬切/闪白/黑场/遮挡转场/叠化"}],
 "beatStructureZh":"节奏结构：憋了几秒、第几秒爆、爆后怎么收",
 "moodArcZh":"情绪推进：起点→转折秒位→终点",
 "reusableZh":"可复用手法（脱离本剧剧情，写成通用做法）",
 "genPromptHintZh":"若用 AI 生成类似片段，画面提示词该写哪几个要素"
}
硬约束：
1. shots 覆盖 0 到 ${lenSec} 秒。
2. cameraMoveZh 只写真看到的运动，禁止套「镜头拉远」这类无依据说法。
3. reusableZh 必须脱离具体剧情。
4. 不写外部平台剧名、商标、原台词原文。`;
}

/** 按体积挑 format：同为 720p，h264 是 477MB 而 bytevc1 只有 225MB —— 不能按 height 排 */
export function pickSmallestVideoFormat(
  formats: ReadonlyArray<Record<string, unknown>>,
): { url: string; sizeMB: number } | null {
  const candidates = formats
    .filter((f) => String(f.format_id || "").startsWith("bytevc1_540p"))
    .map((f) => ({
      url: String(f.url || ""),
      size: Number(f.filesize || f.filesize_approx || 0),
    }))
    .filter((f) => f.url)
    .sort((a, b) => (a.size || 9e15) - (b.size || 9e15));
  const best = candidates[0];
  return best ? { url: best.url, sizeMB: best.size / 1048576 } : null;
}

/**
 * 解析该集的 CDN 节点副本：**只拿地址，不下载** —— 模型自己去 CDN 拉流。
 *
 * 原先这段只存在于 `scripts/manhua-native-deep-read-batch.mts`。接进生产链时
 * 若在 service 里再写一遍，「挑 format 按体积不按 height」这个口径就有了两处实现，
 * 改一处漏一处就是不报错的暗雷（判据收口与探针纪律）。所以抽到这里，脚本改引用。
 *
 * `abortSignal` 必须直通：否则用户中止时会卡在 yt-dlp 解析上等它自己结束。
 */
export async function resolveNativeDeepReadNodeUrls(
  sourceUrl: string,
  abortSignal?: AbortSignal,
): Promise<string[]> {
  const url = String(sourceUrl || "").trim();
  if (!url) throw new Error("缺少可解析的剧集地址");
  const cookie = String(process.env.DOUYIN_COOKIE || "").trim();
  const stdout = await run(
    "yt-dlp",
    ["-J", "--no-warnings", ...(cookie ? ["--add-header", `Cookie:${cookie}`] : []), url],
    120_000,
    abortSignal,
  );
  const info = JSON.parse(stdout) as { formats?: Array<Record<string, unknown>> };
  const best = pickSmallestVideoFormat(info.formats || []);
  if (!best) throw new Error("未解析到可用的 540p 档");
  return [best.url];
}

/** 切片：-ss 在 -i 之前是 input seeking，走 Range 只拉需要的段；-c copy 不转码 */
async function cutSegment(
  url: string,
  startSec: number,
  lenSec: number,
  localPath: string,
  abortSignal?: AbortSignal,
): Promise<number> {
  await run("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "-ss", String(startSec), "-i", url,
    "-t", String(lenSec), "-c", "copy", localPath,
  ], 600_000, abortSignal);
  const size = statSync(localPath).size;
  assertNativeDeepReadPieceSize(size);
  return size;
}

/**
 * 跑一段精读。
 *
 * 重试顺序是 0823 的实测结论：**先换同 format 的下一个 CDN 节点副本**（零成本、立刻），
 * 三个 host 都挂才重新解析地址（要走一整轮 yt-dlp）。
 * 段 C 那次连挂两次，本来换个 host 就能过。
 */
async function runOneSegment(params: {
  nodeUrls: string[];
  refreshNodes: () => Promise<string[]>;
  spec: NativeDeepReadSegmentSpec;
  apiKey: string;
  endpoint: string;
  tmpDir: string;
  abortSignal?: AbortSignal;
}): Promise<{ row: Record<string, unknown> | null; usage: { inputTokens: number; outputTokens: number } }> {
  const { spec } = params;
  const lenSec = Math.max(1, Math.round(spec.endSec - spec.startSec));
  const localPath = `${params.tmpDir}/ndr_${spec.startSec}_${lenSec}.mp4`;
  const objectKey = `deep-read/${Date.now()}_${crypto.randomUUID()}_${Math.max(0, Math.floor(spec.startSec))}.mp4`;
  let nodes = params.nodeUrls;

  let cut = false;
  for (let attempt = 1; attempt <= 3 && !cut; attempt++) {
    if (params.abortSignal?.aborted) throw new Error("已取消");
    try {
      if (attempt === 3) nodes = await params.refreshNodes();
      if (!nodes.length) throw new Error("未解析到可用媒体节点");
      await cutSegment(
        nodes[(attempt - 1) % nodes.length]!,
        spec.startSec,
        lenSec,
        localPath,
        // 原实现漏了这一项：cutSegment 接了参数，调用处没传，等于没接
        params.abortSignal,
      );
      cut = true;
    } catch (e) {
      // 中止必须原样抛出。原来它被当成普通切片错误：等 5/15 秒再重试，
      // 三次之后还返回 { row: null } —— 用户点了停止，看到的是「这段没学到」
      if (params.abortSignal?.aborted) {
        try { unlinkSync(localPath); } catch { /* 本就不存在 */ }
        throw abortReason(params.abortSignal);
      }
      if (attempt >= 3) {
        console.warn(`[nativeDeepRead] 段 ${spec.startSec}-${spec.endSec}s 三次切片全败：${String((e as Error).message).slice(0, 120)}`);
        // 失败也可能留下 0 字节或半截文件，不清会在 /tmp 里越堆越多
        try { unlinkSync(localPath); } catch { /* 本就不存在 */ }
        return { row: null, usage: { inputTokens: 0, outputTokens: 0 } };
      }
      await waitNativeDeepReadRetry([0, 5_000, 15_000][attempt]!, params.abortSignal);
    }
  }

  let uploaded = false;
  try {
    // ossPut 原先在 try 之外：它一失败，本地切片就永远留在 /tmp
    await ossPut(objectKey, readFileSync(localPath), "video/mp4", params.abortSignal);
    uploaded = true;

    const res = await postLong(
      {
        model: NATIVE_DEEP_READ_MODEL,
        input: {
          messages: [
            {
              role: "user",
              content: [
                { video: ossSignedUrl(objectKey), fps: 2.0 },
                { text: buildNativeDeepReadPrompt(lenSec, spec.hintZh) },
              ],
            },
          ],
        },
        parameters: { modalities: ["text"], enable_thinking: true, max_frames: 2000, max_tokens: 60_000 },
      },
      params.apiKey,
      params.endpoint,
      1_800_000,
      params.abortSignal,
    );
    if (res.status >= 300) throw new Error(`native_deep_read_http_${res.status}:${res.text.slice(0, 200)}`);
    const json = JSON.parse(res.text) as {
      usage?: { input_tokens?: number; output_tokens?: number };
      output?: { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> };
    };
    const choice = json.output?.choices?.[0];
    const content = choice?.message?.content;
    const text = Array.isArray(content)
      ? content.map((x) => String((x as { text?: unknown }).text || "")).join("")
      : String(content || "");
    return {
      row: {
        startSec: spec.startSec,
        endSec: spec.endSec,
        finish: choice?.finish_reason,
        text,
      },
      usage: {
        inputTokens: Number(json.usage?.input_tokens) || 0,
        outputTokens: Number(json.usage?.output_tokens) || 0,
      },
    };
  } finally {
    // 本地临时文件无论走哪条路都要删
    try { unlinkSync(localPath); } catch { /* 本就不存在 */ }
    // 阅后即焚：产出已在返回值里，OSS 上不留素材。没传上去就不用删
    if (uploaded) await ossDelete(objectKey);
  }
}

/**
 * 段规格前置校验：**在 resolveNodes 与任何网络动作之前**。
 *
 * 秒位反了、NaN、重复段，走到 ffmpeg 才炸就已经解析过地址、可能已经切过片；
 * 重复段更糟——同一段跑两遍，钱花两次、卡里镜头还重复。
 */
export function validateNativeDeepReadSegments(
  segments: readonly NativeDeepReadSegmentSpec[],
): NativeDeepReadSegmentSpec[] {
  if (!segments.length) throw new Error("原生精读没有可执行片段");
  if (segments.length > 32) throw new Error("原生精读单次最多处理32段");

  const seen = new Set<string>();
  return segments.map((segment, index) => {
    const startSec = Number(segment.startSec);
    const endSec = Number(segment.endSec);
    if (
      !Number.isFinite(startSec)
      || !Number.isFinite(endSec)
      || startSec < 0
      || endSec <= startSec
    ) {
      throw new Error(`原生精读第${index + 1}段秒位无效`);
    }
    const key = `${startSec}:${endSec}`;
    if (seen.has(key)) throw new Error(`原生精读存在重复片段：${key}`);
    seen.add(key);
    return { ...segment, startSec, endSec };
  });
}

/**
 * 对若干爆点段做精读，返回可直接写进模板卡的 beatGrid 与两栏。
 *
 * ⚠️ 调用方必须检查 failedSegmentCount / droppedCount / truncated ——
 * 静默少几个镜头比整体失败更难发现。
 */
export async function runManhuaNativeDeepRead(params: {
  resolveNodes: () => Promise<string[]>;
  segments: readonly NativeDeepReadSegmentSpec[];
  /** 缺省走 resolveNativeDeepReadCredentials()：套餐优先 */
  apiKey?: string;
  endpoint?: string;
  tmpDir?: string;
  abortSignal?: AbortSignal;
}): Promise<NativeDeepReadRunResult> {
  const validatedSegments = validateNativeDeepReadSegments(params.segments);
  const creds = resolveNativeDeepReadExecutionCredentials({
    apiKey: params.apiKey,
    endpoint: params.endpoint,
  });
  const apiKey = creds.apiKey;
  const endpoint = creds.endpoint;
  const tmpDir = params.tmpDir || "/tmp";
  let nodes = await params.resolveNodes();
  let resolvedAt = Date.now();
  const refreshNodes = async () => {
    nodes = await params.resolveNodes();
    resolvedAt = Date.now();
    return nodes;
  };

  const rows: Array<Record<string, unknown>> = [];
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for (const spec of validatedSegments) {
      if (params.abortSignal?.aborted) throw new Error("已取消");
      // 地址约 8 分钟失效，跨段时先看是否过期
      if (Date.now() - resolvedAt > RESOLVE_TTL_MS) await refreshNodes();
      try {
        const { row, usage } = await runOneSegment({
          nodeUrls: nodes,
          refreshNodes,
          spec,
          apiKey,
          endpoint,
          tmpDir,
          abortSignal: params.abortSignal,
        });
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        if (row) rows.push(row);
      } catch (error) {
        // 原先没有 catch：前 3 段付费成功、第 4 段 HTTP/JSON 失败，
        // 整体 reject，前 3 段的钱连同产出一起丢，也进不了逐集入库。
        // 改为停止后续段但把已完成的带回去，由入库门禁决定收不收。
        if (params.abortSignal?.aborted) throw error;
        console.warn(
          `[nativeDeepRead] 第 ${spec.startSec}-${spec.endSec}s 段未完成，停止后续段并保留已完成结果：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        break;
      }
    }
  } catch (error) {
    if (!params.abortSignal?.aborted) throw error;
    const stopped = (error instanceof Error ? error : new Error(String(error))) as NativeDeepReadRunError;
    stopped.nativeDeepReadCostCny =
      (inputTokens * PRICE_IN_PER_M) / 1e6 + (outputTokens * PRICE_OUT_PER_M) / 1e6;
    throw stopped;
  }

  const mapped = mapNativeDeepReadSegments(rows);
  return {
    ...mapped,
    // rows 里已剔除切片失败的段，这里补回真实失败数
    failedSegmentCount: validatedSegments.length - mapped.segmentCount,
    attemptedSegments: validatedSegments.length,
    model: NATIVE_DEEP_READ_MODEL,
    usingPlanQuota: creds.usingPlan,
    usage: {
      inputTokens,
      outputTokens,
      costCny:
        (inputTokens * PRICE_IN_PER_M) / 1e6 + (outputTokens * PRICE_OUT_PER_M) / 1e6,
    },
  };
}

export type { NativeDeepReadOutput };
