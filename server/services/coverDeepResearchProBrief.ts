/**
 * 選題視覺管線 · **步驟 0.5**（可選）
 *
 * **選題單幀封面**：`PLATFORM_TOPIC_COVER_DEEP_RESEARCH_PRO` 或 `PLATFORM_COVER_DEEP_RESEARCH_PRO` 為真，或管理員入參 `enableTopicCoverDeepResearchPro`，即可能在英文化前插入步驟 0.5（見 {@link isTopicCoverDeepResearchProEnabled}）。
 *
 * **2×4 分鏡 / 小紅書八格**：上述 topic env **或** `PLATFORM_COMPOSITE_SHEET_DEEP_RESEARCH_PRO`（見 {@link isCompositeSheetDeepResearchProEnabled}）可在寬幅合成管線啟用同一套 Interactions Deep Research Pro。
 *
 * 啟用時經 Gemini **Interactions API** 發起輕量 Deep Research agent，產出一小段 **简体** 並合入中文語境，再交既有 **GPT‑5.4 → 生圖**。任務語義依 {@link DrBriefProduct}：**單幀封面**側重**高點擊+高轉化**；**2×4** 分別對應**電影級分鏡主表**或**小紅書八格圖文筆記**編導增强。
 *
 * - **認證**：`GEMINI_API_KEY`（與 {@link ./deepResearchService.ts} Deep Research Max 同源）
 * - **Agent ID**：優先 `PLATFORM_COVER_DEEP_RESEARCH_AGENT`；預設 **`deep-research-preview-04-2026`**
 *   （平台顧問 Pro；若 Google 調整請用環境變數覆寫）。
 * - **傳輸**：建立任務 **REST** `fetch`（UTF‑8 中文 `input`）；輪詢 **\@google/genai** \`interactions.get\`（見 {@link ./googleDeepResearchInteractions.ts}）。
 * - **時限**：`PLATFORM_COVER_DEEP_RESEARCH_PRO_TIMEOUT_MS`（未設時預設 **600000**，單次 interaction 輪詢預算；**硬頂 10min**，逾時則放棄本段 DR、下行走原語境 + GPT 5.4。）
 *   **雙條並行**：每條獨立預算與單條相同，見 {@link resolveDualPerSlotTimeoutMs}（預設即 **各 10min**，均受同一 env 與 600000 硬頂約束）。
 * - **雙條（可選）**：{@link runCoverDeepResearchDualBatchBrief} 對**兩則選題**各開一次 Interaction；{@link runCoverDeepResearchBriefPreferDual} **僅當兩條均**產出有效簡報時才注入主條 DR；**任一條逾時/解析失敗**則整段**不注入** DR（下階僅主選題語境 + GPT 5.4），**不**改用單條簡報湊合。不建議把「兩組無關選題」塞進**同一則** GPT 翻譯請求。
 * - **輪詢**：`PLATFORM_COVER_DR_POLL_INTERVAL_MS`（預設 6000；不建議低於 Google 側節奏避免 429）
 */
import type { CoverTaskInput } from "./agenticCoverWorkflow.js";
import {
  createDeepResearchInteraction,
  extractDeepResearchTextAndImages,
  pollInteractionUntilDone,
  requireGeminiApiKey,
} from "./googleDeepResearchInteractions.js";
import { platformFlowLogTimestamp } from "../utils/platformFlowLogTimestamp.js";

/** DR-Pro 步驟 0.5 產品形態（決定寫入 Agent 的任務與產出語義）。 */
export type DrBriefProduct = "platform_cover" | "composite_storyboard" | "composite_xhs_note";

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

  let ms = Number.isFinite(n) && n > 0 ? n : 600_000;

  ms = Math.min(600_000, Math.max(30_000, ms));
  return ms;
}

/** 雙條並行時每條獨立輪詢預算：與 {@link resolveTimeoutMs} 相同（預設各 10min，硬頂 600000）。 */
export function resolveDualPerSlotTimeoutMs(): number {
  return resolveTimeoutMs();
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

const DR_AGENT_INVOCATION_COMMON = `【調用方式】你是 Google Deep Research **Agent**（非單輪 chat 模型）；允許聯網輔證，但**最終只能輸出本指令要求的成品段落**。
【時間節奏】本輪以平台輪詢預算為硬上限（通常約十分鐘內）；請在時限內**高效率**整合並交付，無須冗長；下游另有 **GPT 5.4** 負責英文化与收斂，你這裡只做**輕量編導優化**，不是最終像素產出。
【輸出語言】正文僅簡體中文；不建議整段英文；不建議 JSON；不建議 markdown 代碼欄。
【聯網邊界】僅用於**同一選題語境**的輕量補強；不建議換成無關話題與無關爆款案例。`.trim();

function drProductOneLiner(product: DrBriefProduct): string {
  if (product === "platform_cover") {
    return "【本輪對象】豎版 9:16 信息流封面——補強可作畫的構圖/主體/光影/留白與簡中主標層級；**封面與文案場景宜多元化**（**室內、戶外**皆可參考），不建議無據時過度集中在書房書桌或反覆客廳沙發區。";
  }
  if (product === "composite_storyboard") {
    return "【本輪對象】橫版 2×4 電影感分鏡主表——補強八格的叙事情緒與畫面任務（不建議輸出製片表或 JSON）。";
  }
  return "【本輪對象】小紅書 2×4 八格圖文拼圖——補強拼圖節奏與信息層級（不建議寫成視頻分鏡製片註解堆砌）。";
}

function rolePreambleForProduct(product: DrBriefProduct): string {
  return `${DR_AGENT_INVOCATION_COMMON}\n\n${drProductOneLiner(product)}`;
}

function buildDrAgentFidelityBlock(): string {
  return `
【輸出約定】
1. 仅用简体中文连贯正文；无 JSON、无 markdown 代码栏；篇幅与条目數由你視效率自定，不必凑字。
2. 紧扣【選題標題】【基礎文案摘錄】與【載體】；联网仅作同话题补充，不建議换题。
3. 无需自证与正文逐字对齐；下游 GPT 5.4 会承接翻译与塑形。

`.trim();
}

function buildProductAssignmentBlock(): string {
  return `
【編導優化】
依據下方上下文，產出一段可併入下游英文化與生圖鏈路的简体要點即可；豎版封面、2×4 分鏡、八格圖文**共用**本要求，具體交付形態以【載體】與【本輪對象】一句為準。
`.trim();
}

function buildCoverBriefInteractionInput(task: CoverTaskInput, product: DrBriefProduct): string {
  const tp = task.tenantProfile;
  const titleLine = task.topicTitle.trim().slice(0, 160);
  return `
${rolePreambleForProduct(product)}

${buildProductAssignmentBlock()}

${buildDrAgentFidelityBlock()}

上下文（你的全部依據來源）
——
【創作者 IP】行業：${tp.industry}；優勢：${tp.advantage}；視覺主軸：${tp.flagship}
【載體】${task.format}
【選題標題】${titleLine}
【基礎文案摘錄】
${task.baseCopywriting.slice(0, 5800)}
`.trim();
}

export type CoverDrProBriefOptions = {
  /** 日誌括號標籤，預設 `步骤0.5·DR-Pro`；2×4 合成用 `步骤0.5·DR-Pro·2×4` */
  logPrefix?: string;
  /**
   * 預設 `platform_cover`（歷史：單幀信息流）；2×4 管線請傳 `composite_storyboard` 或 `composite_xhs_note`，
   * 否則 Agent 会误以為只做選題**單幀**編導。
   */
  drBriefProduct?: DrBriefProduct;
  /** 覆寫本輪輪詢預算（毫秒）；未傳則與 `PLATFORM_COVER_DEEP_RESEARCH_PRO_TIMEOUT_MS` 解析一致（單次、預設 10min 內、硬頂 600000） */
  timeoutBudgetMs?: number;
};

export type CoverDeepResearchDualBatchResult = {
  results: [string | null, string | null];
  mode: "paired_singles" | "paired_singles_retry";
};

/**
 * 兩則選題：首輪 A/B **並行**各一次 {@link runCoverDeepResearchInteractionsBrief}；失敗條可再試 1 次（至多 4 次 create）。
 */
export async function runCoverDeepResearchDualBatchBrief(
  tasks: [CoverTaskInput, CoverTaskInput],
  flowLog: string[],
  options?: CoverDrProBriefOptions,
): Promise<CoverDeepResearchDualBatchResult> {
  const logBracket = String(options?.logPrefix ?? "步骤0.5·DR-Pro·双条").trim() || "步骤0.5·DR-Pro·双条";
  const log = (s: string) => {
    flowLog.push(`${platformFlowLogTimestamp()}  [${logBracket}] ${s}`);
  };

  const product: DrBriefProduct = options?.drBriefProduct ?? "platform_cover";

  try {
    requireGeminiApiKey();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`跳過：${msg.slice(0, 520)} · 不發起 interaction`);
    return { results: [null, null], mode: "paired_singles" };
  }

  const agent = resolveCoverDrAgent();
  const perSlotMs = options?.timeoutBudgetMs ?? resolveDualPerSlotTimeoutMs();
  log(
    `双条管線：首轮 A/B 并行 DR-Pro（product=${product} · agent=${agent} · perSlotTimeoutMs=${perSlotMs}）；失败条再试 1 次 · 至多 4 次 interaction.create`,
  );

  const slotOpts = (slot: "A" | "B", retry: boolean): CoverDrProBriefOptions => ({
    logPrefix: retry ? `${logBracket}·${slot}·retry` : `${logBracket}·${slot}`,
    drBriefProduct: product,
    timeoutBudgetMs: perSlotMs,
  });

  const [firstA, firstB] = await Promise.all([
    runCoverDeepResearchInteractionsBrief(tasks[0], flowLog, slotOpts("A", false)),
    runCoverDeepResearchInteractionsBrief(tasks[1], flowLog, slotOpts("B", false)),
  ]);

  let textA = firstA;
  let textB = firstB;
  let attemptsA = 1;
  let attemptsB = 1;

  const needRetryA = !textA;
  const needRetryB = !textB;

  if (needRetryA) log("条A 首轮无有效简报 · 再试 1 次…");
  if (needRetryB) log("条B 首轮无有效简报 · 再试 1 次…");

  if (needRetryA || needRetryB) {
    const [secondA, secondB] = await Promise.all([
      needRetryA
        ? runCoverDeepResearchInteractionsBrief(tasks[0], flowLog, slotOpts("A", true))
        : Promise.resolve(textA),
      needRetryB
        ? runCoverDeepResearchInteractionsBrief(tasks[1], flowLog, slotOpts("B", true))
        : Promise.resolve(textB),
    ]);
    if (needRetryA) {
      textA = secondA;
      attemptsA = 2;
    }
    if (needRetryB) {
      textB = secondB;
      attemptsB = 2;
    }
  }

  const totalCreates = attemptsA + attemptsB;
  const mode: CoverDeepResearchDualBatchResult["mode"] =
    totalCreates === 2 ? "paired_singles" : "paired_singles_retry";
  log(`双条完成 · mode=${mode} · interaction.create 次數=${totalCreates}（不含輪詢 get）`);
  return { results: [textA, textB], mode };
}

/**
 * 有第二則選題（雙條 DR-Pro）時：先 {@link runCoverDeepResearchDualBatchBrief}；**僅當兩條均**取得有效簡報時才注入 **主條 A** 的 DR 正文供下階英文化。
 * **任一條失敗或逾時** → 視為雙條 DR-Pro **未達成**，回傳 **null**（整段不注入 DR，不採用「只剩一條有效也勉強用」）。下階僅主選題快照語境 + GPT 5.4。
 * 僅單題時：等同單次 {@link runCoverDeepResearchInteractionsBrief}。
 */
export async function runCoverDeepResearchBriefPreferDual(
  primary: CoverTaskInput,
  secondary: CoverTaskInput | null | undefined,
  flowLog: string[],
  options?: CoverDrProBriefOptions,
): Promise<string | null> {
  const sec = secondary ?? null;
  if (!sec) {
    return runCoverDeepResearchInteractionsBrief(primary, flowLog, options);
  }

  const logBracket = String(options?.logPrefix ?? "步骤0.5·DR-Pro").trim() || "步骤0.5·DR-Pro";
  const note = (s: string) => flowLog.push(`${platformFlowLogTimestamp()}  [${logBracket}·双条策略] ${s}`);

  const { results } = await runCoverDeepResearchDualBatchBrief([primary, sec], flowLog, options);
  const a = results[0]?.trim() ? results[0]! : null;
  const b = results[1]?.trim() ? results[1]! : null;
  if (a && b) {
    note("兩條 DR 均有效 · **僅 A 進中文暫存/翻譯**（副條不併入 GPT 5.4，避免兩組選題同塞一則英文化）");
    return a;
  }
  note(
    "雙條 DR-Pro：兩條未**同時**取得有效簡報（含逾時或解析失敗）· **不啟用 DR** · 下階僅主選題語境 + GPT 5.4（不採用單條殘報）",
  );
  return null;
}

/**
 * 自快照解析可選「第二條選題」語境，供 DR-Pro 雙條並行；解析失敗回傳 undefined（不阻斷主路）。
 */
export async function resolveOptionalDrProSecondaryCoverFromScene(params: {
  userId: number;
  secondarySceneId: string | null | undefined;
}): Promise<{ topicHook: string; context: string } | undefined> {
  const sid = String(params.secondarySceneId ?? "").trim();
  if (!sid || !Number.isFinite(params.userId)) return undefined;
  try {
    const { assertOptimizedCoverInputsFromDb } = await import("./platformStrategicBlueprintSnapshots.js");
    const { buildPlatformCoverHistoryHintFromDb, mergeCoverContextWithDbHint } = await import(
      "./platformCoverHistoryHint.js",
    );
    const resolved = await assertOptimizedCoverInputsFromDb({ userId: params.userId, sceneId: sid });
    const hint = await buildPlatformCoverHistoryHintFromDb({ userId: params.userId });
    const context =
      mergeCoverContextWithDbHint(resolved.context, hint) ?? resolved.context;
    return { topicHook: resolved.topicHook, context };
  } catch {
    return undefined;
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
    flowLog.push(`${platformFlowLogTimestamp()}  [${logBracket}] ${s}`);
  };

  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    log("跳過：`GEMINI_API_KEY` 未設");
    return null;
  }

  const agent = resolveCoverDrAgent();
  const totalBudgetMs = options?.timeoutBudgetMs ?? resolveTimeoutMs();
  const pollIntervalMs = resolvePollMs();

  const product: DrBriefProduct = options?.drBriefProduct ?? "platform_cover";
  log(
    `開始 · product=${product} · agent=${agent} · timeoutMs=${totalBudgetMs} · pollMs=${pollIntervalMs} · sdk=@google/genai`,
  );

  const input = buildCoverBriefInteractionInput(task, product);
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
    const text = clipBrief(String(extracted ?? ""), 5200).trim();

    if (!text) {
      log("正文為空，忽略");
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
