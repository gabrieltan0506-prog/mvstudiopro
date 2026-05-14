/**
 * 選題視覺管線 · **步驟 0.5**（可選）
 *
 * **封面單幀**：`PLATFORM_TOPIC_COVER_DEEP_RESEARCH_PRO` 或 `PLATFORM_COVER_DEEP_RESEARCH_PRO`。
 * **2×4 分鏡 / 小紅書八格**：上述任一為真 **或** `PLATFORM_COMPOSITE_SHEET_DEEP_RESEARCH_PRO`，即可在對應管線啟用同一套 Interactions Deep Research Pro。
 *
 * 啟用時經 Gemini **Interactions API** 發起輕量 Deep Research agent，產出一小段 **简体** 並合入中文語境，再交既有 **GPT‑5.4 → 生圖**。
 *
 * - **認證**：`GEMINI_API_KEY`（與 {@link ./deepResearchService.ts} Deep Research Max 同源）
 * - **Agent ID**：優先 `PLATFORM_COVER_DEEP_RESEARCH_AGENT`；預設 **`deep-research-preview-04-2026`**
 *   （平台顧問 Pro；若 Google 調整請用環境變數覆寫）。
 * - **傳輸**：建立任務 **REST** `fetch`（UTF‑8 中文 `input`）；輪詢 **\@google/genai** \`interactions.get\`（見 {@link ./googleDeepResearchInteractions.ts}）。
 * - **時限**：`PLATFORM_COVER_DEEP_RESEARCH_PRO_TIMEOUT_MS`（預設 180000）
 * - **輪詢**：`PLATFORM_COVER_DR_POLL_INTERVAL_MS`（預設 6000；勿低於 Google 側節奏避免 429）
 * - **實驗 · 雙條合併**：{@link runCoverDeepResearchDualBatchBrief}（**第 1 次**僅試一次双条 Interaction；**失敗則第 2 次**固定改兩次單條，不重試双条）。
 */
import type { CoverTaskInput } from "./agenticCoverWorkflow.js";
import {
  createDeepResearchInteraction,
  extractDeepResearchTextAndImages,
  pollInteractionUntilDone,
  requireGeminiApiKey,
} from "./googleDeepResearchInteractions.js";

/** 與平台頁 Pro 一致；可用 `PLATFORM_COVER_DEEP_RESEARCH_AGENT` 覆寫。 */
const DEFAULT_COVER_DR_AGENT = "deep-research-preview-04-2026";

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

/** 與 Deep Research **Agent** 對話專用：開場即寫清任務類型、唯一產出、禁止事項（避免當成閒聊模型或長文研報）。 */
const COVER_DR_AGENT_ROLE_PREAMBLE = `【調用方式】你是 Google Deep Research **Agent**（非單輪 chat 模型）；允許聯網輔證，但**最終只能輸出本指令要求的成品段落**。
【本回合唯一目標】為「竖版 9:16 信息流封面」寫**一段可直接給下游模型翻译成英文生图 prompt 的简体视觉企划**（構圖/主體/光影/留白/簡中主標層級），不是市場研報、不是逐字講稿、不是分鏡表。
【輸出語言】正文僅簡體中文；勿整段英文；勿 JSON；勿 markdown 代碼欄。
【聯網邊界】僅用於**同一選題語境**的輕量補強（句式/視覺趨勢）；禁止換題、禁止引入與下列【選題標題】【基礎文案摘錄】無關的爆款案例。
`.trim();

/** 單條與雙條共用的忠實與篇幅約束（Agent 必逐條遵守）。 */
const COVER_DR_AGENT_FIDELITY_BLOCK = `
【忠實約束 — 缺一不可】
1. 全文必須**扣死**给定【選題標題】【基礎文案摘錄】中的具體主體、利益點或矛盾；禁止換成泛化行業雞湯或另一個話題。
2. 第一段**第一行（或第一句）**：必須用簡体字寫一行「錨定句」，明確復述本條視覺創意服務對象為「選題標題所指內容 + 上文案中的某一具體信息點」（可短句）。
3. 「聯網」僅可作**同話題语境**的趋势/視覺句法补强；不得引入與標題·文案無關的爆款梗或明星案例。
4. 禁止捏造與【基礎文案摘錄】相背的具體事實、數據或產品名；没有把握就写視覺層級的概括，不写假數字。
5. 输出只要**简体中文**連貫正文（無 JSON / 無markdown代碼欄）。
6. 字数 **280～950 字**；须覆盖：钩子反差／主視覺隱喻與主次关系／光影與主色調／簡中大標建議字形與層級；避免英文段落。
7. 文风：短句+可执行的畫面描述，让读者能想见**這條視頻/圖文封面**會長什么样。
`.trim();

function buildCoverBriefInteractionInput(task: CoverTaskInput): string {
  const tp = task.tenantProfile;
  const titleLine = task.topicTitle.trim().slice(0, 160);
  return `
${COVER_DR_AGENT_ROLE_PREAMBLE}

【封面專任 · 請嚴格遵守 · 離題視同失敗】
【你的擅長】在**給定素材範圍內**優化「選題怎麼說更像封面鉤子」與「文案怎麼壓成可畫進圖的信息」，提煉懸念、反差、利益點與主視覺焦點；**不改命題換題**，只做表達與結構強化。
【你的任務】先基於優化結果，**只用簡體中文**輸出一整段可直接交下游翻譯的**高點擊率封面生圖提示詞**（＝視覺企劃段落）：要能指揮構圖、主體、光影、留白、簡中大標层级，不只是口頭點評。
【工作閉環】聯網僅可作同話題、同語境的高互動參考；最終段落必須體現**經你優化後的選題與文案**，落在一條连贯的简体「封面绘制指令」上（非白皮書）。

${COVER_DR_AGENT_FIDELITY_BLOCK}

上下文（你的全部依據來源）
——
【創作者 IP】行業：${tp.industry}；優勢：${tp.advantage}；視覺主軸：${tp.flagship}
【載體】${task.format}
【選題標題】${titleLine}
【基礎文案摘錄】
${task.baseCopywriting.slice(0, 5800)}
`.trim();
}

const COVER_DR_AGENT_ROLE_PREAMBLE_DUAL = `【調用方式】你是 Google Deep Research **Agent**（非單輪 chat 模型）；本回合要**一次**處理**兩條**獨立選題（条A / 条B），每條均須遵守下方【忠實約束】；聯網僅作輕量輔證，**不得串題、不得把 A 寫進 B**。
【本回合唯一目標】輸出**兩段**简体「竖版 9:16 信息流封面」视觉企划（段 A / 段 B），格式必須用指定定界符包裹，供下游**分别**英文化生图；**不是**一份研報、**不是**合併論述。
【輸出語言】两段正文均僅簡體中文；勿整段英文；勿 JSON；勿 markdown 代碼欄；**定界符之外不得出現任何文字**（禁止前言、摘要、結語、解釋你怎麼做的說明）。
`.trim();

/** 双条一次调用：定界符须原样出现在模型输出中，供解析。 */
const DR_BATCH_1_OPEN = "<<<DR_BATCH_1>>>";
const DR_BATCH_1_CLOSE = "<<<END_DR_BATCH_1>>>";
const DR_BATCH_2_OPEN = "<<<DR_BATCH_2>>>";
const DR_BATCH_2_CLOSE = "<<<END_DR_BATCH_2>>>";

function buildDualCoverBriefInteractionInput(a: CoverTaskInput, b: CoverTaskInput): string {
  const block = (label: string, task: CoverTaskInput) => {
    const tp = task.tenantProfile;
    const titleLine = task.topicTitle.trim().slice(0, 160);
    return `
${label}
【創作者 IP】行業：${tp.industry}；優勢：${tp.advantage}；視覺主軸：${tp.flagship}
【載體】${task.format}
【選題標題】${titleLine}
【基礎文案摘錄】
${task.baseCopywriting.slice(0, 5200)}
`.trim();
  };

  return `
${COVER_DR_AGENT_ROLE_PREAMBLE_DUAL}

【双条并列 · 单次回复 · 严禁混淆两条选题】
【你的擅長】同上：在**各自给定素材範圍內**強化鉤子與可畫進圖的信息密度；**条A 只服务条A 素材、条B 只服务条B 素材**。
【你的任務】在同一轮回复中产出**两段**简体视觉企划；每一段都须满足【忠實約束】（含首句錨定句、280～950 字、可指挥构图/光影/主标層級）。

${COVER_DR_AGENT_FIDELITY_BLOCK}
（说明：以上 7 条对**每一段**定界符内正文分别适用；段 A 只对照下方条A 的标题与文案，段 B 只对照条B。）

【输出格式 · 必须原样使用下列定界符行 · 缺一不可 · 定界符单独成行】
仅输出下列结构；**第一個字符必须是「<」**（即第一行即 ${DR_BATCH_1_OPEN}），**最後一個字符必须是「>」**（即最后一行即 ${DR_BATCH_2_CLOSE} 的末行）。
${DR_BATCH_1_OPEN}
（条A 正文 only：一段连续简体，280～950 字，禁止出現「条B」字樣或 B 的标题）
${DR_BATCH_1_CLOSE}
${DR_BATCH_2_OPEN}
（条B 正文 only：一段连续简体，280～950 字，禁止出現「条A」字樣或 A 的标题）
${DR_BATCH_2_CLOSE}

【条A 素材】
${block("—— 条A ——", a)}

【条B 素材】
${block("—— 条B ——", b)}
`.trim();
}

function parseDualCoverBriefBatches(raw: string): { b1: string; b2: string } | null {
  const t = String(raw || "").replace(/\r\n/g, "\n");
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re1 = new RegExp(`${esc(DR_BATCH_1_OPEN)}\\s*([\\s\\S]*?)\\s*${esc(DR_BATCH_1_CLOSE)}`, "m");
  const re2 = new RegExp(`${esc(DR_BATCH_2_OPEN)}\\s*([\\s\\S]*?)\\s*${esc(DR_BATCH_2_CLOSE)}`, "m");
  const m1 = re1.exec(t);
  const m2 = re2.exec(t);
  if (!m1?.[1] || !m2?.[1]) return null;
  const b1 = m1[1].trim();
  const b2 = m2[1].trim();
  if (b1.length < 40 || b2.length < 40) return null;
  return { b1, b2 };
}

/** 双条 DR-Pro 轮询上限：不低于单条预算，且至多为单条 2 倍（封顶 10 分钟）。 */
function resolveDualAttemptTimeoutMs(): number {
  const s = resolveTimeoutMs();
  return Math.min(600_000, Math.max(s, s * 2));
}

export type CoverDeepResearchDualBatchResult = {
  results: [string | null, string | null];
  mode: "dual_one_call" | "single_fallback";
};

export type CoverDrProBriefOptions = {
  /** 日誌括號標籤，預設 `步骤0.5·DR-Pro`；2×4 合成用 `步骤0.5·DR-Pro·2×4` */
  logPrefix?: string;
};

/**
 * **实验/压测**：两条选题 **只尝试一次** Deep Research Pro 合并调用；**第 1 次**失败（创建/轮询/解析/锚定）
 * 则 **第 2 次**固定改走两次 {@link runCoverDeepResearchInteractionsBrief}（单条），**不再重试双条**。
 */
export async function runCoverDeepResearchDualBatchBrief(
  tasks: [CoverTaskInput, CoverTaskInput],
  flowLog: string[],
  options?: CoverDrProBriefOptions,
): Promise<CoverDeepResearchDualBatchResult> {
  const logBracket = String(options?.logPrefix ?? "步骤0.5·DR-Pro·双条").trim() || "步骤0.5·DR-Pro·双条";
  const log = (s: string) => {
    flowLog.push(`${new Date().toISOString()}  [${logBracket}] ${s}`);
  };

  async function runSingleFallback(reason: string): Promise<CoverDeepResearchDualBatchResult> {
    log(`第2次調用：單條 fallback（因 ${reason}；不重試双条）→ 逐條 DR-Pro（A 然后 B）…`);
    const paired: [string | null, string | null] = [
      await runCoverDeepResearchInteractionsBrief(tasks[0], flowLog, { logPrefix: `${logBracket}·fb·A` }),
      await runCoverDeepResearchInteractionsBrief(tasks[1], flowLog, { logPrefix: `${logBracket}·fb·B` }),
    ];
    return { results: paired, mode: "single_fallback" };
  }

  try {
    requireGeminiApiKey();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`第1次跳過双条：${msg.slice(0, 520)}`);
    return runSingleFallback("GEMINI_API_KEY 不可用");
  }

  const agent = resolveCoverDrAgent();
  const dualBudgetMs = resolveDualAttemptTimeoutMs();
  const pollIntervalMs = resolvePollMs();
  log(
    `第1次調用：双条合併（僅此一次；失敗則第2次改單條）· agent=${agent} · dualTimeoutMs=${dualBudgetMs} · pollMs=${pollIntervalMs}`,
  );

  const ac = new AbortController();
  const hardStop = setTimeout(() => ac.abort(), dualBudgetMs + 12_000);

  try {
    let interactionId: string;
    try {
      const created = await createDeepResearchInteraction({
        agentId: agent,
        input: buildDualCoverBriefInteractionInput(tasks[0], tasks[1]),
        collaborativePlanning: false,
      });
      interactionId = created.id;
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log(`第1次双条 create 失敗 · ${errMsg.slice(0, 520)}`);
      return runSingleFallback("双条 create 失敗");
    }

    log(`双条 interaction=${interactionId} · 進入輪詢…`);

    const row = await pollInteractionUntilDone(interactionId, {
      maxMs: dualBudgetMs,
      pollIntervalMs,
      abortSignal: ac.signal,
      logLabel: "cover_dr_pro_dual",
      onTick: async (elapsed) => {
        log(`双条 polling · elapsed=${elapsed}s`);
      },
    });

    const { text: extracted } = extractDeepResearchTextAndImages(row);
    const parsed = parseDualCoverBriefBatches(String(extracted ?? ""));
    if (!parsed) {
      log("第1次双条：定界符解析失敗或正文過短");
      return runSingleFallback("定界符解析失敗或正文過短");
    }
    const c1 = clipBrief(parsed.b1, 5200);
    const c2 = clipBrief(parsed.b2, 5200);
    const a1 = passesCoverBriefTopicCopyAnchor(c1, tasks[0]);
    const a2 = passesCoverBriefTopicCopyAnchor(c2, tasks[1]);
    if (!a1.ok || !a2.ok) {
      log(`第1次双条：錨定未過 · A:${a1.reason ?? "ok"} · B:${a2.reason ?? "ok"}`);
      return runSingleFallback("錨定校验未過");
    }

    log(`第1次双条成功 · lenA=${c1.length} · lenB=${c2.length}`);
    return { results: [c1, c2], mode: "dual_one_call" };
  } catch (e: unknown) {
    const msg =
      e instanceof DOMException && e.name === "AbortError"
        ? "AbortError · 達本地上限"
        : e instanceof Error
          ? e.message
          : String(e);
    log(`第1次双条異常 · ${msg.slice(0, 720)}`);
    return runSingleFallback("轮询或运行異常");
  } finally {
    clearTimeout(hardStop);
  }
}

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

  log(`開始 · agent=${agent} · timeoutMs=${totalBudgetMs} · pollMs=${pollIntervalMs} · sdk=@google/genai`);

  const input = buildCoverBriefInteractionInput(task);
  const ac = new AbortController();
  const hardStop = setTimeout(() => ac.abort(), totalBudgetMs + 8000);

  try {
    let interactionId: string;
    try {
      const created = await createDeepResearchInteraction({
        agentId: agent,
        input,
        collaborativePlanning: false,
      });
      interactionId = created.id;
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log(`create 失敗 · ${errMsg.slice(0, 520)}`);
      return null;
    }

    log(`interaction=${interactionId} · 進入輪詢…`);

    const row = await pollInteractionUntilDone(interactionId, {
      maxMs: totalBudgetMs,
      pollIntervalMs,
      abortSignal: ac.signal,
      logLabel: "cover_dr_pro",
      onTick: async (elapsed) => {
        log(`polling · elapsed=${elapsed}s · status=in_progress`);
      },
    });

    const { text: extracted } = extractDeepResearchTextAndImages(row);
    const text = clipBrief(String(extracted ?? ""), 5200);

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
