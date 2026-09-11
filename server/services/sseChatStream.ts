/**
 * SSE 流式对话的共用读取器：把 `text/event-stream` 还原成**与非流式逐字同形**的 JSON 字符串，
 * 上游解析、usage 折算、finish_reason 判定都不用改，只换传输方式。
 *
 * 出处是漫剧学习链（bailianChat）0830 起的全链流式实弹，所有护栏都是踩出来的：
 * 非流式在 EvoLink 侧撞 Cloudflare 首字节 ~100 秒上限（HTTP 524），在 DashScope 侧撞
 * undici 写死的 300 秒 headersTimeout；开流后响应头立刻回、字节持续流出，两个计时器都不触发。
 * 0911 起知识卡读档链 / 派生 / 挑页 / 经济档 JSON 也共用这一份（用户令：全部改流式）。
 */
/**
 * 0905 实锤：EvoLink 整形流把正文吐完后连接挂着不发结束帧，链路干等到 30 分钟档才切档。
 * 任何一次 read() 超过 GLM_STREAM_IDLE_TIMEOUT_MS（用户 0905 定 10 分钟）没有新字节，就判本档失败（抛错→网关层按链序切下一档）。
 */
export const GLM_STREAM_IDLE_TIMEOUT_MS = 10 * 60_000;
export async function readWithIdleTimeout<T>(
  reader: { read(): Promise<T>; cancel(reason?: unknown): Promise<void> },
  idleMs = GLM_STREAM_IDLE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reader.cancel("idle").catch(() => undefined);
      reject(new Error(`上游流 ${Math.round(idleMs / 1000)} 秒无数据，判本档失败并切下一档`));
    }, idleMs);
  });
  try {
    return await Promise.race([reader.read(), idle]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 严格完整性模式（0911 终审 P1）：只有本次新接流式的四条链启用，漫剧学习链维持旧契约。
 * 旧契约只管「把 delta 拼起来」，中途 error 帧 / 畸形业务帧 / 没有结束帧就 EOF 这三种断流
 * 都会带着**半截正文**返回，下游看「有正文、JSON 能解析、节数够」就当成稿——这正是要堵的口子。
 */
export type SseReadOptions = {
  /** 断流一律判失败（抛错→网关层换下一跳），不把半截正文当成功 */
  strictCompletion?: boolean;
};

/** 成功的结束原因：只有这些才算生成正常收口 */
const SSE_SUCCESS_FINISH_REASONS = new Set(["stop", "end_turn", "eos", "complete"]);

/** 断流错误统一带这个标记，便于上层分类（可恢复 → 换下一跳） */
export class SseIncompleteStreamError extends Error {
  readonly code = "sse_incomplete_stream";
  constructor(
    message: string,
    /** 断流前已经收到的证据：不写成成品，只进日志与错误回执 */
    readonly evidence: {
      model?: string;
      provider?: string;
      usage?: Record<string, unknown>;
      finishReason?: string | null;
      partialChars: number;
    },
  ) {
    super(message);
    this.name = "SseIncompleteStreamError";
  }
}

export async function readGlmSseStream(
  body: ReadableStream<Uint8Array>,
  maxResponseBytes?: number,
  options: SseReadOptions = {},
): Promise<string> {
  const strict = options.strictCompletion === true;
  const cap = Math.max(
    1_024,
    Math.min(16 * 1024 * 1024, Math.floor(Number(maxResponseBytes) || 4 * 1024 * 1024)),
  );
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason: string | null = null;
  let usage: Record<string, unknown> | undefined;
  let model = "";
  let provider = "";
  let rawBytes = 0;
  /**
   * 🔴 上限必须按**还原后的正文**算，不能按原始 SSE 字节（0830 审查 P0）：
   * SSE 每个 token 一帧、每帧带 `data: ` 前缀与完整 chunk 信封，实测放大约 275 倍。
   * 按原始字节算 → 默认 4 MiB 只够约 15,000 token，而整形链要 131,072 ——
   * 会在跑了二三十分钟、两档全烧之后，被自己的上限掐断。
   * 原始字节另设一条宽得多的护栏，只防真·失控流。
   */
  const rawCap = Math.max(cap * 64, 64 * 1024 * 1024);
  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let chunk: {
      model?: string;
      provider?: string;
      error?: unknown;
      choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
      usage?: Record<string, unknown>;
    };
    try {
      chunk = JSON.parse(payload);
    } catch {
      // 注：**不是**半包重试——半包由下面 lines.pop() 留到下一轮处理。
      // 这里丢弃的是心跳、注释行等不可解析内容。
      parseFailures += 1;
      // 严格模式：业务 data 帧解析不了就判失败——悄悄丢帧会拼出**缺字**的正文，
      // 而缺字正文照样能过 JSON 解析与节数检查（终审 P1）。
      // SSE 注释（以 ":" 开头）与空行在上面就被 `startsWith("data:")` 挡掉了，不会走到这里。
      if (strict) throw incomplete(`上游流出现无法解析的数据帧：${payload.slice(0, 120)}`);
      return;
    }
    // 0911 审查 P2：OpenRouter 在 200 + SSE 下会把上游错误当成 {"error":…} 帧发回，
    // 不抛出去就变成「空正文」，四条链各报自己的模糊错误、看不到真实原因
    if (chunk.error && typeof chunk.error === "object") {
      sawErrorFrame = true;
      throw incomplete(`上游流内错误：${JSON.stringify(chunk.error).slice(0, 200)}`);
    }
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === "string") content += delta;
    if (Buffer.byteLength(content) > cap) throw new Error("GLM 链响应超过处理上限");
    const fr = chunk.choices?.[0]?.finish_reason;
    if (fr) finishReason = String(fr);
    if (chunk.usage) usage = chunk.usage;
    if (chunk.model) model = String(chunk.model);
    // provider 在流式路曾整个丢失（审查 P1）：回执里「上游是谁」会静默变空白。
    if (chunk.provider) provider = String(chunk.provider);
  };
  let parseFailures = 0;
  let sawErrorFrame = false;
  const incomplete = (message: string) =>
    new SseIncompleteStreamError(message, {
      model: model || undefined,
      provider: provider || undefined,
      usage,
      finishReason,
      partialChars: content.length,
    });
  try {
    for (;;) {
      const { done, value } = await readWithIdleTimeout(reader);
      if (done) break;
      rawBytes += value.byteLength;
      if (rawBytes > rawCap) throw new Error("GLM 链响应超过处理上限");
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) handleLine(line);
    }
    // 🔴 收尾（审查 P1）：末帧后若不带换行，它会留在 buffer 里永不解析——
    // 正文能拿到，但 finish_reason 变 null、usage 变 undefined：
    // requireFinishReasonStop 会把成功的产出判死，账本同时静默归零。
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
  } finally {
    // 超限抛错时若不释放，这条响应体永远读不完、连接不归池（审查 P1）。
    await reader.cancel().catch(() => undefined);
  }
  if (!content && parseFailures > 0) {
    throw new Error(`GLM 链流式响应无法解析（${parseFailures} 帧解析失败）`);
  }
  /**
   * 严格模式的完整性门禁（终审 P1）：`[DONE]` 本身不证明生成成功，
   * 必须真见到成功的 finish_reason。缺失＝连接在结束帧之前断了，
   * length / max_tokens ＝预算耗尽的半截稿，两者都不许当成品交出去。
   */
  if (strict) {
    if (sawErrorFrame) throw incomplete("上游流以错误帧结束");
    if (!finishReason) throw incomplete("上游流没有结束帧就断开（已收正文视为半截，不予采信）");
    if (!SSE_SUCCESS_FINISH_REASONS.has(String(finishReason))) {
      throw incomplete(`上游流非正常结束：finish_reason=${finishReason}`);
    }
  }
  return JSON.stringify({
    model: model || undefined,
    provider: provider || undefined,
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage,
  });
}

/**
 * 按**响应类型**判断要不要走 SSE 读取器：只看自己发了 `stream: true` 是不够的——
 * 上游忽略该参数直接回普通 JSON 时，用 SSE 读取器会读出空正文并静默交白卷（0830 审查）。
 */
export function isSseResponse(res: { headers?: { get?: (name: string) => string | null } }): boolean {
  const get = res?.headers?.get;
  const contentType = typeof get === "function" ? String(get.call(res.headers, "content-type") || "") : "";
  return /text\/event-stream/i.test(contentType);
}
