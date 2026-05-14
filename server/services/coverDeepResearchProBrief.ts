/**
 * 選題視覺管線 · **步驟 0.5**（可選）
 *
 * **封面單幀**：`PLATFORM_TOPIC_COVER_DEEP_RESEARCH_PRO` 或 `PLATFORM_COVER_DEEP_RESEARCH_PRO`。
 * **2×4 分鏡 / 小紅書八格**：上述任一為真 **或** `PLATFORM_COMPOSITE_SHEET_DEEP_RESEARCH_PRO`，即可在對應管線啟用同一套 Interactions Deep Research Pro。
 *
 * 啟用時經 Gemini **Interactions API** 發起輕量 Deep Research agent，產出一小段 **简体** 並合入中文語境，再交既有 **GPT‑5.4 → 生圖**。
 *
 * - **認證**：`GEMINI_API_KEY`（與 {@link ./deepResearchService.ts} Deep Research Max 同源）
 * - **Agent ID**：優先 `PLATFORM_COVER_DEEP_RESEARCH_AGENT`；預設 **`deep-research-pro-preview`**
 *   （無日期後綴；若 Google 調整請用環境變數覆寫）。
 * - **時限**：`PLATFORM_COVER_DEEP_RESEARCH_PRO_TIMEOUT_MS`（預設 180000）
 * - **輪詢**：`PLATFORM_COVER_DR_POLL_INTERVAL_MS`（預設 6000；勿低於 Google 側節奏避免 429）
 */
import type { CoverTaskInput } from "./agenticCoverWorkflow.js";

const INTERACTIONS_BASE = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** 無日期後綴；可用 `PLATFORM_COVER_DEEP_RESEARCH_AGENT` 覆寫。 */
const DEFAULT_COVER_DR_AGENT = "deep-research-pro-preview";

function envFlagEnabled(name: string): boolean {
  const v = String(process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * **選題單帧封面管线**专用：与日後 `PLATFORM_COMPOSITE_*` 等开关分离，便于对照 A/B。
 */
export function isTopicCoverDeepResearchProEnabled(): boolean {
  return (
    envFlagEnabled("PLATFORM_TOPIC_COVER_DEEP_RESEARCH_PRO") || envFlagEnabled("PLATFORM_COVER_DEEP_RESEARCH_PRO")
  );
}

/**
 * **2×4 分鏡 / 小紅書八格**：與封面共用 topic env，或單獨設 `PLATFORM_COMPOSITE_SHEET_DEEP_RESEARCH_PRO`。
 */
export function isCompositeSheetDeepResearchProEnabled(): boolean {
  return envFlagEnabled("PLATFORM_COMPOSITE_SHEET_DEEP_RESEARCH_PRO") || isTopicCoverDeepResearchProEnabled();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveCoverDrAgent(): string {
  const a = String(
    process.env.PLATFORM_COVER_DEEP_RESEARCH_AGENT || process.env.PLATFORM_COVER_DR_AGENT || "",
  ).trim();
  return a || DEFAULT_COVER_DR_AGENT;
}

function resolveTimeoutMs(): number {
  const raw = process.env.PLATFORM_COVER_DEEP_RESEARCH_PRO_TIMEOUT_MS;
  let n = raw != null && String(raw).trim() !== "" ? Math.floor(Number(raw)) : NaN;

  let ms = Number.isFinite(n) && n > 0 ? n : 180_000;

  ms = Math.min(600_000, Math.max(30_000, ms));
  return ms;
}

function resolvePollMs(): number {
  const raw = process.env.PLATFORM_COVER_DR_POLL_INTERVAL_MS;
  let n = raw != null && String(raw).trim() !== "" ? Math.floor(Number(raw)) : NaN;
  let ms = Number.isFinite(n) && n >= 3000 ? n : 6000;

  ms = Math.min(30_000, Math.max(3000, ms));
  return ms;
}

/** 將 Agent 正文壓縮為可進英文化管道的純简体企劃段（不超長）。 */
function clipBrief(text: string, maxChars: number): string {
  const t = String(text || "").replace(/\r\n/g, "\n").trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n…(truncated)`;
}

const normCompact = (s: string): string =>
  String(s || "")
    .replace(/[\s\u3000]+/g, "")
    .trim();

/**
 * 捨棄與題/文無可追溯綁定的空泛發揮（聯網趨勢僅可作輔證，主體須來自已給標題與文案）。
 */
function passesCoverBriefTopicCopyAnchor(textRaw: string, task: CoverTaskInput): { ok: boolean; reason?: string } {
  const text = String(textRaw || "").trim();
  const normText = normCompact(text);

  const topic = String(task.topicTitle || "").trim();
  const topicNorm = normCompact(topic);

  if (text.length < 72) {
    return { ok: false, reason: `正文過短（${text.length} 字，建議≥72）` };
  }

  if (topicNorm.length >= 2) {
    if (topicNorm.length <= 36 && normText.includes(topicNorm)) {
      /* 選題字面命中 */
    } else {
      const tokenRun = [...topicNorm.match(/[\u4e00-\u9fff]{4}|[A-Za-z0-9]{4}/g) ?? []][0];
      const frag =
        tokenRun ||
        (topicNorm.length >= 6 ? topicNorm.slice(0, 6) : topicNorm.slice(0, Math.min(topicNorm.length, 4)));
      if (!normText.includes(frag)) {
        return { ok: false, reason: `未檢測到選題錨點「${frag}」——禁止換題發揮` };
      }
    }
  }

  const baseNorm = normCompact(task.baseCopywriting || "");
  if (baseNorm.length >= 24) {
    const head = baseNorm.slice(0, Math.min(baseNorm.length, 48));
    const m = head.match(/[\u4e00-\u9fff]{4,12}|[A-Za-z0-9]{6,}/);
    const fragCopy = (m?.[0] ?? head.slice(0, Math.min(head.length, 8))).slice(0, 12);
    if (fragCopy.length >= 4 && !normText.includes(fragCopy)) {
      return { ok: false, reason: `未檢測到文案錨點「${fragCopy}…」——須復用上下文具體信息` };
    }
  }

  return { ok: true };
}

function buildCoverBriefInteractionInput(task: CoverTaskInput): string {
  const tp = task.tenantProfile;
  const titleLine = task.topicTitle.trim().slice(0, 160);
  return `
【封面專任 · 請嚴格遵守 · 離題視同失敗】
【你的擅長】在**給定素材範圍內**優化「選題怎麼說更像封面鉤子」與「文案怎麼壓成可畫進圖的信息」，提煉懸念、反差、利益點與主視覺焦點；**不改命題換題**，只做表達與結構強化。
【你的任務】先基於優化結果，**只用簡體中文**輸出一整段可直接交下游翻譯的**高點擊率封面生圖提示詞**（＝視覺企劃段落）：要能指揮構圖、主體、光影、留白、簡中大標层级，不只是口頭點評。
【工作閉環】聯網僅可作同話題、同語境的高互動參考；最終段落必須體現**經你優化後的選題與文案**，落在一條连贯的简体「封面绘制指令」上（非白皮書）。

【忠實約束 — 缺一不可】
1. 全文必須**扣死**给定【選題標題】【基礎文案摘錄】中的具體主體、利益點或矛盾；禁止換成泛化行業雞湯或另一個話題。
2. 第一段**第一行（或第一句）**：必須用簡体字寫一行「錨定句」，明確復述本條視覺創意服務對象為「選題標題所指內容 + 上文案中的某一具體信息點」（可短句）。
3. 「聯網」僅可作**同話題语境**的趋势/視覺句法补强；不得引入與標題·文案無關的爆款梗或明星案例。
4. 禁止捏造與【基礎文案摘錄】相背的具體事實、數據或產品名；没有把握就写視覺層級的概括，不写假數字。
5. 输出只要**简体中文**連貫正文（無 JSON / 無markdown代碼欄）。
6. 字数 **280～950 字**；须覆盖：钩子反差／主視覺隱喻與主次关系／光影與主色調／簡中大標建議字形與層級；避免英文段落。
7. 文风：短句+可执行的畫面描述，让读者能想见**這條視頻/圖文封面**會長什么样。

上下文（你的全部依據來源）
——
【創作者 IP】行業：${tp.industry}；優勢：${tp.advantage}；視覺主軸：${tp.flagship}
【載體】${task.format}
【選題標題】${titleLine}
【基礎文案摘錄】
${task.baseCopywriting.slice(0, 5800)}
`.trim();
}

type PollOutputs = unknown[];

async function pollUntilComplete(opts: {
  interactionId: string;
  headers: Record<string, string>;
  deadlineMs: number;
  pollIntervalMs: number;
  signal?: AbortSignal;
  onPoll?: (elapsedSec: number) => void;
}): Promise<PollOutputs> {
  const pollStart = Date.now();
  let lastElapsed = -1;

  while (Date.now() - pollStart < opts.deadlineMs) {
    if (opts.signal?.aborted) {
      throw new Error(`cover_dr_pro：已中止 interactionId=${opts.interactionId}`);
    }

    await sleep(opts.pollIntervalMs);

    let pollJson: Record<string, unknown> = {};
    let rawPoll = "";
    const elapsed = Math.round((Date.now() - pollStart) / 1000);
    if (elapsed !== lastElapsed && opts.onPoll) {
      lastElapsed = elapsed;
      await Promise.resolve(opts.onPoll(elapsed)).catch(() => {});
    }

    const pollRes = await fetch(`${INTERACTIONS_BASE}/${opts.interactionId}`, {
      method: "GET",
      headers: opts.headers,
      signal: opts.signal,
    }).catch(() => null as Response | null);
    rawPoll = (await pollRes?.text?.()) || "";
    try {
      pollJson = JSON.parse(rawPoll || "{}") as Record<string, unknown>;
    } catch {
      pollJson = {};
    }

    if (!pollRes?.ok) {
      const msg = String(pollJson?.error && typeof pollJson.error === "object" ? JSON.stringify((pollJson as any).error) : "").slice(
        0,
        380,
      );
      throw new Error(
        `cover_dr_pro：poll HTTP ${pollRes?.status ?? "?"} · ${msg || rawPoll.slice(0, 320)}`,
      );
    }

    const status = String(pollJson?.status ?? "");

    if (status === "failed") {
      const errObj = (pollJson?.error ?? {}) as { message?: string };
      throw new Error(
        `cover_dr_pro：Agent 失敗 interactionId=${opts.interactionId} · ${errObj?.message || JSON.stringify(pollJson.error || {}).slice(0, 400)}`,
      );
    }

    if (status === "completed") {
      return (pollJson?.outputs ?? []) as PollOutputs;
    }
  }

  throw new Error(`cover_dr_pro：輪詢超时（>${Math.round(resolveTimeoutMs() / 1000)}s）interactionId=${opts.interactionId}`);
}

export type CoverDrProBriefOptions = {
  /** 日誌括號標籤，預設 `步骤0.5·DR-Pro`；2×4 合成用 `步骤0.5·DR-Pro·2×4` */
  logPrefix?: string;
};

/**
 * 同步等待一次 Interactions Deep Research agent，適合封面 / 2×4 管線調試視窗；
 * **失敗不拋到外層**（由調用處包住），此處仍可 throw 後由外层 catch。
 */
export async function runCoverDeepResearchInteractionsBrief(
  task: CoverTaskInput,
  flowLog: string[],
  options?: CoverDrProBriefOptions,
): Promise<string | null> {
  const logBracket = String(options?.logPrefix ?? "步骤0.5·DR-Pro").trim() || "步骤0.5·DR-Pro";
  const log = (s: string) => {
    flowLog.push(`${new Date().toISOString()}  [${logBracket}] ${s}`);
  };

  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    log("跳過：`GEMINI_API_KEY` 未設");
    return null;
  }

  const agent = resolveCoverDrAgent();
  const totalBudgetMs = resolveTimeoutMs();
  const pollIntervalMs = resolvePollMs();

  log(`開始 · agent=${agent} · timeoutMs=${totalBudgetMs} · pollMs=${pollIntervalMs}`);

  const apiHeaders = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
    "X-Goog-Api-Client": "genai-node/cover-dr-pro-brief",
  };

  const input = buildCoverBriefInteractionInput(task);
  const ac = new AbortController();
  const hardStop = setTimeout(() => ac.abort(), totalBudgetMs + 8000);

  try {
    const createRes = await fetch(INTERACTIONS_BASE, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        agent,
        input,
        background: true,
        agent_config: {
          type: "deep-research",
          collaborative_planning: false,
          thinking_summaries: "auto",
          visualization: "auto",
        },
      }),
      signal: ac.signal,
    });

    const rawCreate = await createRes.text();
    let createJson: { id?: string; error?: { message?: string; code?: string } } = {};
    try {
      createJson = JSON.parse(rawCreate) as typeof createJson;
    } catch {
      /* ignore */
    }

    if (!createRes.ok) {
      const errMsg =
        createJson?.error?.message ?? createJson?.error?.code ?? rawCreate.slice(0, 800);
      log(`create HTTP ${createRes.status} · ${String(errMsg).slice(0, 520)}`);
      return null;
    }

    const interactionId = createJson?.id;
    if (!interactionId) {
      log(`create 未返回 interactionId · body=${rawCreate.slice(0, 400)}`);
      return null;
    }

    log(`interaction=${interactionId} · 進入輪詢…`);

    const outputs = await pollUntilComplete({
      interactionId,
      headers: apiHeaders,
      deadlineMs: totalBudgetMs,
      pollIntervalMs,
      signal: ac.signal,
      onPoll: async (elapsed) => {
        log(`polling · elapsed=${elapsed}s · status=in_progress`);
      },
    });

    const textPart = [...outputs].reverse().find((o: any) => !o?.type || o?.type === "text") as any;
    const text = clipBrief(String(textPart?.text ?? ""), 5200);

    if (!text || text.length < 40) {
      log(`正文過短 (${text?.length ?? 0} 字)，忽略`);
      return null;
    }

    const anchor = passesCoverBriefTopicCopyAnchor(text, task);
    if (!anchor.ok) {
      log(`捨棄：與當前選題/文案錨定失敗 · ${anchor.reason}`);
      return null;
    }

    log(`完成 · 简报長=${text.length}`);
    return text;
  } catch (e: unknown) {
    const msg =
      e instanceof DOMException && e.name === "AbortError"
        ? "AbortError · 達本地上限"
        : e instanceof Error
          ? e.message
          : String(e);
    log(`異常 · ${msg.slice(0, 720)}`);
    return null;
  } finally {
    clearTimeout(hardStop);
  }
}
