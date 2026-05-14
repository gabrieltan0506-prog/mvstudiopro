/**
 * 選題視覺管線 · **步驟 0.5**（可選）
 *
 * **封面單幀**：`PLATFORM_TOPIC_COVER_DEEP_RESEARCH_PRO` 或 `PLATFORM_COVER_DEEP_RESEARCH_PRO`。
 * **2×4 分鏡 / 小紅書八格**：上述任一為真 **或** `PLATFORM_COMPOSITE_SHEET_DEEP_RESEARCH_PRO`，即可在對應管線啟用同一套 Interactions Deep Research Pro。
 *
 * 啟用時經 Gemini **Interactions API** 發起輕量 Deep Research agent，產出一小段 **简体** 並合入中文語境，再交既有 **GPT‑5.4 → 生圖**。任務語義依 {@link DrBriefProduct}：**單幀封面**側重**高點擊+高轉化**；**2×4** 分別對應**電影級分鏡主表**或**小紅書八格圖文筆記**編導增强。
 *
 * - **認證**：`GEMINI_API_KEY`（與 {@link ./deepResearchService.ts} Deep Research Max 同源）
 * - **Agent ID**：優先 `PLATFORM_COVER_DEEP_RESEARCH_AGENT`；預設 **`deep-research-preview-04-2026`**
 *   （平台顧問 Pro；若 Google 調整請用環境變數覆寫）。
 * - **傳輸**：建立任務 **REST** `fetch`（UTF‑8 中文 `input`）；輪詢 **\@google/genai** \`interactions.get\`（見 {@link ./googleDeepResearchInteractions.ts}）。
 * - **時限**：`PLATFORM_COVER_DEEP_RESEARCH_PRO_TIMEOUT_MS`（未設時預設 **600000**，單次 interaction 輪詢預算；**硬頂 10min**，逾時則放棄本段 DR、下行走原語境 + GPT 5.4。）
 *   **雙條並行**：每條獨立預算與單條相同，見 {@link resolveDualPerSlotTimeoutMs}（預設即 **各 10min**，均受同一 env 與 600000 硬頂約束）。
 * - **雙條（可選）**：{@link runCoverDeepResearchDualBatchBrief} 對**兩則選題**各開一次 Interaction；{@link runCoverDeepResearchBriefPreferDual} **僅當兩條均**產出有效簡報時才注入主條 DR；**任一條逾時/解析失敗**則整段**不注入** DR（下階僅主選題語境 + GPT 5.4），**不**改用單條簡報湊合。不得把「兩組無關選題」塞進**同一則** GPT 翻譯請求。
 * - **輪詢**：`PLATFORM_COVER_DR_POLL_INTERVAL_MS`（預設 6000；勿低於 Google 側節奏避免 429）
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

/** DR-Pro 步驟 0.5 產品形態（決定寫入 Agent 的任務與產出語義）。 */
export type DrBriefProduct = "platform_cover" | "composite_storyboard" | "composite_xhs_note";

const DR_AGENT_INVOCATION_COMMON = `【調用方式】你是 Google Deep Research **Agent**（非單輪 chat 模型）；允許聯網輔證，但**最終只能輸出本指令要求的成品段落**。
【時間節奏】在符合本指令要求的前提下，快速整合篇幅與聯網深度，以最快時間交付清晰與明確的優化結果。
【輸出語言】正文僅簡體中文；勿整段英文；勿 JSON；勿 markdown 代碼欄。
【聯網邊界】僅用於**同一選題語境**的輕量補強（句式/視覺趨勢）；禁止換題、禁止引入與下列【選題標題】【基礎文案摘錄】無關的爆款案例。`.trim();

const DR_GOAL_PLATFORM_COVER = `【本回合唯一目標】為「竖版 9:16 信息流封面」寫**一段**可給下游翻译成**英文生图 prompt** 的简体视觉企划（構圖/主體/光影/留白/簡中主標層級）。
【商業目標 · 必須同時顧及】**高點擊率**（thumb-stop：鉤子、反差、主視覺記憶點、可读大標）與**高轉化率意圖**（信任與利益點可感知、畫面線索與素材一致的**單一路徑行動**——收藏/評論關鍵詞/私信/橱窗等，**禁止**只吸睛却看不出下一步）；不是市場研報、不是逐字講稿、不是分鏡表。`.trim();

const DR_GOAL_COMPOSITE_STORYBOARD = `【本回合唯一目標】為即將生成的**橫版 2×4 電影級分鏡主表**（八格寫實電影感静帧帶）寫**一段**简体**編導增强**視覺企劃，給下游壓成英文宽幅生圖 prompt。
【創作與商業目標】**電影級**画面气质（動機光、空間深度、景别/节奏暗示可含蓄存在）、格間**叙事節拍**（起承轉合、信息投放）；並帶**高點擊/高完播**意图（前三格抓人、中段信息、尾格收束或行動感畫面），避免八格平庸拼湊。`.trim();

const DR_GOAL_COMPOSITE_XHS = `【本回合唯一目標】為即將生成的**小紅書 2×4 八格圖文筆記**拼圖寫**一段**简体**編導增强**視覺企劃，給下游壓成英文宽幅生圖 prompt。
【創作與商業目標】**圖文筆記**语义（封面格強钩子、內頁格信息節奏與層級）；**高互動/高收藏**與**種草高轉化**（信任証据、利益点、**單一主行動**的視覺暗示與文案一致）；**禁止**寫成視頻分鏡製片欄位堆砌。`.trim();

function rolePreambleForProduct(product: DrBriefProduct): string {
  const goal =
    product === "platform_cover"
      ? DR_GOAL_PLATFORM_COVER
      : product === "composite_storyboard"
        ? DR_GOAL_COMPOSITE_STORYBOARD
        : DR_GOAL_COMPOSITE_XHS;
  return `${DR_AGENT_INVOCATION_COMMON}\n\n${goal}`;
}

function buildDrAgentFidelityBlock(product: DrBriefProduct): string {
  const item6 =
    product === "platform_cover"
      ? "须覆盖：**高點擊**鉤子与**高轉化**視覺線索（信任/利益/主行動可讀暗示，與素材一致）／主視覺隱喻／光影與主色調／簡中大標层级；避免英文段落。"
      : product === "composite_storyboard"
        ? "须覆盖：**電影級**光影與空間層次、**2×4 八格帶**的叙事節拍（起承轉合）、各格畫面任務可讀（可含蓄景别/節奏暗示），便于下游写成宽幅分鏡主表英文 prompt。"
        : "须覆盖：**八格圖文筆記**的信息節奏（封面钩+內頁利益/証据/收藏理由）、**種草轉化**埋点（單一主行動與文案一致）、格间层级差異；避免製片式分鏡術語欄；便于下游写成八格英文 prompt。";

  const item7 =
    product === "platform_cover"
      ? "短句+可执行畫面描述，能想见**封面**長相，并感知**為何值得點進去行動**。"
      : product === "composite_storyboard"
        ? "短句+可执行畫面與節拍描述，能想见**整條電影感 2×4 分鏡帶**如何推進。"
        : "短句+可执行拼圖版式語義，能想见**整張 2×4 圖文筆記**如何驅動收藏與轉化。";

  return `
【忠實約束 — 缺一不可】
1. 全文必須**扣死**给定【選題標題】【基礎文案摘錄】中的具體主體、利益點或矛盾；禁止換成泛化行業雞湯或另一個話題。
2. 第一段**第一行（或第一句）**：必須用簡体字寫一行「錨定句」，明確復述本條視覺創意服務對象為「選題標題所指內容 + 上文案中的某一具體信息點」（可短句）。
3. 「聯網」僅可作**同話題语境**的趋势/視覺句法补强；不得引入與標題·文案無關的爆款梗或明星案例。
4. 禁止捏造與【基礎文案摘錄】相背的具體事實、數據或產品名；没有把握就写視覺層級的概括，不写假數字。
5. 输出只要**简体中文**連貫正文（無 JSON / 無markdown代碼欄）。
6. 字数 **280～950 字**；${item6}
7. 文风：${item7}
`.trim();
}

function buildProductAssignmentBlock(product: DrBriefProduct): string {
  if (product === "platform_cover") {
    return `
【封面專任 · 請嚴格遵守 · 離題視同失敗】
【你的擅長】在**給定素材範圍內**優化「選題怎麼說更像封面鉤子」與「文案怎麼壓成可畫進圖的信息」，提煉懸念、反差、利益點與**可轉化信息**；**不改命題換題**，只做表達與結構強化。
【你的任務】輸出**高點擊率 + 高轉化意圖**兼顧的一段視覺企劃：须能指揮構圖、主體、光影、留白、簡中大標层级，**且**行動/信任線索與【基礎文案摘錄】一致（非空喊）。
【工作閉環】聯網僅可作同話題參考；最終落在连贯的简体**封面绘制指令**上（非白皮書）。
`.trim();
  }
  if (product === "composite_storyboard") {
    return `
【2×4 電影級分鏡主表 · 編導增强 · 離題視同失敗】
【你的擅長】把劇本/卖点整理成**八格分鏡帶**的可執行視覺：**電影級**布光與鏡頭語感、格間節拍與懸念；**不改命題換題**。
【你的任務】產出一段简体編導摘要，供下游展開為**橫版 2×4**英文 prompt；強調**高點進/高完播叙事**，每格在語義上可對應敘事功能（不必輸出製片表格或 JSON）。
【工作閉環】格線/閱讀順序的硬約束由下游模板鎖定；你負責**画面內容與節拍**說清楚。
`.trim();
  }
  return `
【小紅書 2×4 八格圖文筆記 · 編導增强 · 離題視同失敗】
【你的擅長】規划**整張拼圖筆記**的視覺節奏：封面格鉤子、內頁格信息層級；**高收藏/高互动**與**種草轉化**並重；**禁止**把八格写成視頻分鏡製片註解。
【你的任務】產出一段简体編導摘要，供下游展開為**2×4 八格圖文筆記**英文 prompt；語義上區分「封面格」與「內容格」。
【工作閉環】行動線索與【基礎文案摘錄】一致，單一主行動。
`.trim();
}

function buildCoverBriefInteractionInput(task: CoverTaskInput, product: DrBriefProduct): string {
  const tp = task.tenantProfile;
  const titleLine = task.topicTitle.trim().slice(0, 160);
  return `
${rolePreambleForProduct(product)}

${buildProductAssignmentBlock(product)}

${buildDrAgentFidelityBlock(product)}

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
   * 預設 `platform_cover`（單幀封面）；2×4 管線請傳 `composite_storyboard` 或 `composite_xhs_note`，
   * 否則 Agent 會误以為只做豎版封面。
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
    flowLog.push(`${new Date().toISOString()}  [${logBracket}] ${s}`);
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
 * **任一條失敗、逾時或錨定校驗不通過** → 視為雙條 DR-Pro **未達成**，回傳 **null**（整段不注入 DR，不採用「只剩一條有效也勉強用」）。下階僅主選題快照語境 + GPT 5.4。
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
  const note = (s: string) => flowLog.push(`${new Date().toISOString()}  [${logBracket}·双条策略] ${s}`);

  const { results } = await runCoverDeepResearchDualBatchBrief([primary, sec], flowLog, options);
  const a = results[0]?.trim() ? results[0]! : null;
  const b = results[1]?.trim() ? results[1]! : null;
  if (a && b) {
    note("兩條 DR 均有效 · **僅 A 進中文暫存/翻譯**（副條不併入 GPT 5.4，避免兩組選題同塞一則英文化）");
    return a;
  }
  note(
    "雙條 DR-Pro：兩條未**同時**取得有效簡報（含逾時/解析或錨定失敗）· **不啟用 DR** · 下階僅主選題語境 + GPT 5.4（不採用單條殘報）",
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
    flowLog.push(`${new Date().toISOString()}  [${logBracket}] ${s}`);
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
