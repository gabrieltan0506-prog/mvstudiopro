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

const DASHSCOPE_NATIVE_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

/** 服务端下载超时约 120 秒、CDN 实测 1.56 MB/s → 单片体积上限取 90MB 留一半余量 */
const PIECE_SIZE_CAP_MB = 90;
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
};

/** 北京百炼单价（¥/M token），套餐 key 走同一端点 */
const PRICE_IN_PER_M = 12;
const PRICE_OUT_PER_M = 36;

function run(cmd: string, args: string[], timeoutMs = 600_000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 1 << 28, timeout: timeoutMs }, (err, stdout, stderr) =>
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
  timeoutMs = 1_800_000,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(DASHSCOPE_NATIVE_ENDPOINT);
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": payload.length,
        },
      },
      (res) => {
        let d = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, text: d }));
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("socket idle timeout")));
    req.on("error", reject);
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

function ossPut(key: string, buf: Buffer, contentType = "video/mp4"): Promise<void> {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    const req = https.request(
      {
        hostname: ossHost(),
        path: `/${encodeURI(key)}`,
        method: "PUT",
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

/** 阅后即焚：删失败不阻断（桶侧另有 1 天生命周期兜底） */
function ossDelete(key: string): Promise<void> {
  return new Promise((resolve) => {
    const date = new Date().toUTCString();
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
        res.on("end", () => resolve());
      },
    );
    req.on("error", () => resolve());
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

/** 切片：-ss 在 -i 之前是 input seeking，走 Range 只拉需要的段；-c copy 不转码 */
async function cutSegment(
  url: string,
  startSec: number,
  lenSec: number,
  localPath: string,
): Promise<number> {
  await run("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "-ss", String(startSec), "-i", url,
    "-t", String(lenSec), "-c", "copy", localPath,
  ]);
  const size = statSync(localPath).size;
  // CDN 抖动时会切出 0 字节或异常小的文件，模型收到会报 Invalid video file
  if (size < 100_000) throw new Error(`切片仅 ${size} 字节`);
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
  tmpDir: string;
  abortSignal?: AbortSignal;
}): Promise<{ row: Record<string, unknown> | null; usage: { inputTokens: number; outputTokens: number } }> {
  const { spec } = params;
  const lenSec = Math.max(1, Math.round(spec.endSec - spec.startSec));
  const localPath = `${params.tmpDir}/ndr_${spec.startSec}_${lenSec}.mp4`;
  const objectKey = `deep-read/${Date.now()}_${spec.startSec}.mp4`;
  let nodes = params.nodeUrls;

  let cut = false;
  for (let attempt = 1; attempt <= 3 && !cut; attempt++) {
    if (params.abortSignal?.aborted) throw new Error("已取消");
    try {
      if (attempt === 3) nodes = await params.refreshNodes();
      await cutSegment(nodes[(attempt - 1) % nodes.length]!, spec.startSec, lenSec, localPath);
      cut = true;
    } catch (e) {
      if (attempt >= 3) {
        console.warn(`[nativeDeepRead] 段 ${spec.startSec}-${spec.endSec}s 三次切片全败：${String((e as Error).message).slice(0, 120)}`);
        return { row: null, usage: { inputTokens: 0, outputTokens: 0 } };
      }
      await new Promise((r) => setTimeout(r, [0, 5000, 15000][attempt]!));
    }
  }

  await ossPut(objectKey, readFileSync(localPath));
  try { unlinkSync(localPath); } catch { /* 本地临时文件，删不掉不阻断 */ }

  try {
    const res = await postLong(
      {
        model: "qwen3.8-max",
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
    // 阅后即焚：产出已在返回值里，OSS 上不留素材
    await ossDelete(objectKey);
  }
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
  apiKey: string;
  tmpDir?: string;
  abortSignal?: AbortSignal;
}): Promise<NativeDeepReadRunResult> {
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

  for (const spec of params.segments) {
    if (params.abortSignal?.aborted) throw new Error("已取消");
    // 地址约 8 分钟失效，跨段时先看是否过期
    if (Date.now() - resolvedAt > RESOLVE_TTL_MS) await refreshNodes();
    const { row, usage } = await runOneSegment({
      nodeUrls: nodes,
      refreshNodes,
      spec,
      apiKey: params.apiKey,
      tmpDir,
      abortSignal: params.abortSignal,
    });
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    if (row) rows.push(row);
  }

  const mapped = mapNativeDeepReadSegments(rows);
  return {
    ...mapped,
    // rows 里已剔除切片失败的段，这里补回真实失败数
    failedSegmentCount: params.segments.length - mapped.segmentCount,
    attemptedSegments: params.segments.length,
    usage: {
      inputTokens,
      outputTokens,
      costCny:
        (inputTokens * PRICE_IN_PER_M) / 1e6 + (outputTokens * PRICE_OUT_PER_M) / 1e6,
    },
  };
}

export type { NativeDeepReadOutput };
