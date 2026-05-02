/**
 * 戰略智庫核心引擎 — AI 上帝視角
 * 支持三種產品類型：magazine_single / magazine_sub / personalized
 * 異步脫機運行，結果雙寫：Fly 持久卷（斷點恢復）+ Neon DB（研報中心展示）
 */
import fs from "fs/promises";
import path from "path";
import { PDF_FORMATTING_PROMPT_SUFFIX } from "./pdfFormattingPrompt";
import {
  registerActiveJob,
  unregisterActiveJob,
  heartbeatActiveJob,
  pauseActiveJob,
  resumeActiveJob,
  refundCreditsOnFailure,
  isCancelRequested,
  requestCancel as ledgerRequestCancel,
  type PaidJobRefundReason,
} from "./paidJobLedger";

// Storage root for job state. Default = Fly persistent volume. Override via env var
// for local tests / CI smoke tests.
const REPORT_DIR = process.env.DEEP_RESEARCH_REPORT_DIR || "/data/growth/deep-research";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 出版物日期一律用亞洲時間 Asia/Shanghai (GMT+8)，避免服務器預設時區造成偏差 */
const PUBLICATION_TZ = "Asia/Shanghai";

function formatPublicationDateZhAsia(d = new Date()): string {
  return d.toLocaleDateString("zh-CN", {
    timeZone: PUBLICATION_TZ,
    year: "numeric",
    month: "long",
  });
}

/** 封面角標英文月份縮寫 + 四位年，例如 "MAY 2026" */
function formatMagazineCoverMonthYearEnAsia(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PUBLICATION_TZ,
    month: "short",
    year: "numeric",
  }).formatToParts(d);
  const monthRaw = parts.find((p) => p.type === "month")?.value ?? "Jan";
  const year = parts.find((p) => p.type === "year")?.value ?? String(d.getFullYear());
  const month = monthRaw.replace(/\./g, "").toUpperCase().slice(0, 3);
  return `${month} ${year}`;
}

/**
 * 僅在既有封面 prompt 末尾追加 Asia/Shanghai 日期約束，不改寫前半段畫面/構圖描述。
 * （#373 曾把異步封面「短 prompt」換成與 on-demand 相同的長版；#377 再加 CJK 排版段。
 * 與「只調封面日期」需求不符時，保留兩條歷史口径，只共用此日期尾綴。）
 */
function appendMagazineCoverDateInstructions(promptBase: string): string {
  const coverMonthYear = formatMagazineCoverMonthYearEnAsia();
  const coverZh = formatPublicationDateZhAsia();
  return (
    `${promptBase}\n\n` +
    `Publication dating (Asia/Shanghai, current run — do not use stale years like 2024): ` +
    `English masthead / ISSN / footer / barcode small print must use exactly "${coverMonthYear}". ` +
    `If any Chinese publication date appears on the cover, use "${coverZh}".`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini Consumer API key 生图（generativelanguage…:generateContent?key=）。
// 戰略智庫主流程封面 / 場景圖已改為 **僅 Vertex**（見 fetchStrategicVertexImageViaGateway）；
// 本函式僅供少量非智庫路徑或本機實驗保留。
// ─────────────────────────────────────────────────────────────────────────────
type ImageAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
type ImageModel = "gemini-3.1-flash-image-preview" | "gemini-3-pro-image-preview";

/** 戰略智庫封面：Vertex Nano Banana Pro（與 `api/google` Pro 預設一致；勿改為文檔裡常見的錯誤 ID） */
const VERTEX_STRATEGIC_COVER_IMAGE_MODEL =
  String(process.env.VERTEX_DEEP_RESEARCH_COVER_MODEL || "gemini-3-pro-image-preview").trim() ||
  "gemini-3-pro-image-preview";

/** 戰略智庫正文配圖：Vertex Imagen Ultra（用戶指定 ID） */
const VERTEX_STRATEGIC_SCENE_IMAGEN_MODEL = "imagen-4.0-ultra-generate-001";

/**
 * 戰略智庫視覺統一走 Vercel `/api/google?op=nanoImage`（**Vertex IAM Bearer**），
 * 不使用 Consumer `generativelanguage` `?key=`。
 */
async function fetchStrategicVertexImageViaGateway(opts: {
  vercelBaseUrl: string;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  kind: "cover_pro_4k" | "scene_imagen_2k";
  timeoutMs?: number;
}): Promise<string> {
  const base = opts.vercelBaseUrl.replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 120_000;
  let q: URLSearchParams;
  let body: Record<string, unknown>;

  if (opts.kind === "cover_pro_4k") {
    const model = VERTEX_STRATEGIC_COVER_IMAGE_MODEL;
    q = new URLSearchParams({
      op: "nanoImage",
      tier: "pro",
      model,
      imageSize: "4K",
      aspectRatio: opts.aspectRatio,
      numberOfImages: "1",
      guidanceScale: "4.0",
      personGeneration: "ALLOW_ADULT",
    });
    body = {
      prompt: opts.prompt,
      tier: "pro",
      model,
      imageSize: "4K",
      aspectRatio: opts.aspectRatio,
      numberOfImages: 1,
      guidanceScale: 4.0,
      personGeneration: "ALLOW_ADULT",
    };
  } else {
    const model = VERTEX_STRATEGIC_SCENE_IMAGEN_MODEL;
    q = new URLSearchParams({
      op: "nanoImage",
      imagenBackend: "vertex",
      tier: "pro",
      model,
      imageSize: "2K",
      aspectRatio: opts.aspectRatio,
      numberOfImages: "1",
      guidanceScale: "4.0",
      personGeneration: "ALLOW_ADULT",
    });
    body = {
      prompt: opts.prompt,
      imagenBackend: "vertex",
      tier: "pro",
      model,
      imageSize: "2K",
      aspectRatio: opts.aspectRatio,
      numberOfImages: 1,
      guidanceScale: 4.0,
      personGeneration: "ALLOW_ADULT",
    };
  }

  const res = await fetch(`${base}/api/google?${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`vertex_gateway_http_${res.status}: ${errText.slice(0, 240)}`);
  }
  const j: Record<string, unknown> = await res.json();
  let url = String(j?.imageUrl ?? "").trim();
  if (!url) throw new Error(`vertex_gateway_empty_imageUrl: ${JSON.stringify(j).slice(0, 240)}`);

  // Vertex 常回傳 data:base64；入庫 / 報告 Markdown 需 https（與 generateImageViaGeminiApiKey 一致）
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (m?.[2]) {
      const mimeType = m[1] || "image/png";
      const buffer = Buffer.from(m[2], "base64");
      if (buffer.length > 0) {
        const ext = mimeType.includes("jpeg") ? "jpg" : "png";
        const fileKey = `vertex-strategic/${opts.kind}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
        const { storagePut } = await import("../storage");
        const { url: httpsUrl } = await storagePut(fileKey, buffer, mimeType);
        return httpsUrl;
      }
    }
  }
  return url;
}

export async function generateImageViaGeminiApiKey(opts: {
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  model?: ImageModel;
}): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY");
  const model: ImageModel = opts.model ?? "gemini-3.1-flash-image-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: opts.aspectRatio ?? "16:9" },
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`gemini_api_http_${res.status}: ${errText.slice(0, 200)}`);
  }
  const json: any = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts;
  const inlineData = Array.isArray(parts)
    ? parts.find((p: any) => p?.inlineData?.data)?.inlineData
    : null;
  if (!inlineData?.data) {
    throw new Error(`gemini_api_no_image: ${JSON.stringify(json).slice(0, 300)}`);
  }
  const buffer = Buffer.from(String(inlineData.data), "base64");
  const mimeType = String(inlineData.mimeType || "image/png");
  const ext = mimeType.includes("jpeg") ? "jpg" : "png";
  const fileKey = `gemini-api-images/${model}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { storagePut } = await import("../storage");
  const { url: imageUrl } = await storagePut(fileKey, buffer, mimeType);
  return imageUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep Research Pro Preview · 滑動視窗限流（63s 內最多 30 次「建立 interaction」）
// ─────────────────────────────────────────────────────────────────────────────
// 每 63 秒滑動視窗 30 次；第 31 次起阻塞直到視窗中最舊一筆超出 63s（+ 小緩衝）。
// （與 Google 側 gemma / Deep Research 配額上調後的產品節奏對齊，可再改 MAX_* 常數。）
//
// 仍用磁盤 JSON 做跨 Fly 實例協調；檔案 RMW 用短命互斥，避免長任務（poll）佔鎖。
// 使用：const release = await acquireRateGate("…"); try { … } finally { release(); }（release 可為 no-op）

const RATE_GATE_FILE = "/data/growth/deep-research-rate-gate.json";
/** 與產品約定：第 31 次起等滿約 63s 滑動視窗 */
const RATE_GATE_WINDOW_MS = 63_000;
const MAX_DEEP_RESEARCH_STARTS_PER_WINDOW = 30;
const RATE_GATE_BUFFER_MS = 250;

type RateGateState =
  | { starts: number[] }
  | { lastCallAt: number };

let gateFileLock: Promise<void> = Promise.resolve();

async function withGateFileLock<T>(fn: () => Promise<T>): Promise<T> {
  let unlock!: () => void;
  const slot = new Promise<void>((r) => {
    unlock = r;
  });
  const prev = gateFileLock;
  gateFileLock = prev.then(() => slot);
  await prev;
  try {
    return await fn();
  } finally {
    unlock();
  }
}

function normalizeRateStarts(state: RateGateState | Record<string, unknown>): number[] {
  const s = state as Record<string, unknown>;
  if (Array.isArray(s.starts)) {
    return (s.starts as unknown[])
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      .sort((a, b) => a - b);
  }
  const last = s.lastCallAt;
  if (typeof last === "number" && last > 0) return [last];
  return [];
}

async function readRateGateState(): Promise<RateGateState> {
  try {
    const raw = await fs.readFile(RATE_GATE_FILE, "utf-8");
    return JSON.parse(raw) as RateGateState;
  } catch {
    return { starts: [] };
  }
}

async function writeRateGateState(starts: number[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(RATE_GATE_FILE), { recursive: true });
    await fs.writeFile(RATE_GATE_FILE, JSON.stringify({ starts }));
  } catch (e: any) {
    console.warn("[deepResearch] rate gate write failed:", e?.message);
  }
}

/** 申請一次 Deep Research「建立 interaction」許可（63s 滑窗內最多 30 次）。 */
async function acquireRateGate(label = "deep-research"): Promise<() => void> {
  while (true) {
    const waitMs = await withGateFileLock(async () => {
      const state = await readRateGateState();
      const now = Date.now();
      let starts = normalizeRateStarts(state).filter((t) => now - t < RATE_GATE_WINDOW_MS);
      if (starts.length >= MAX_DEEP_RESEARCH_STARTS_PER_WINDOW) {
        return starts[0] + RATE_GATE_WINDOW_MS - now + RATE_GATE_BUFFER_MS;
      }
      starts = [...starts, Date.now()].sort((a, b) => a - b);
      await writeRateGateState(starts);
      return 0;
    });
    if (waitMs <= 0) break;
    console.log(
      `[deepResearch] 🚦 [${label}] 已达 ${MAX_DEEP_RESEARCH_STARTS_PER_WINDOW} 次/` +
        `${Math.round(RATE_GATE_WINDOW_MS / 1000)}s 上限，等待 ${Math.round(waitMs / 1000)}s 后再入列`,
    );
    await sleep(waitMs);
  }
  return () => {};
}

// ── 四平台 7 天趋势 SVG 折线图生成器 ────────────────────────────────────────
function buildTrendSvg(data: {
  dates: string[];
  xiaohongshu: number[];
  douyin: number[];
  bilibili: number[];
  kuaishou: number[];
}, topic: string): string {
  const W = 680, H = 300;
  const PAD = { top: 48, right: 20, bottom: 48, left: 44 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const days = data.dates.length;
  const xStep = chartW / (days - 1);

  const platforms = [
    { key: "xiaohongshu" as const, label: "小红书", color: "#b6364c" },
    { key: "douyin"      as const, label: "抖音",   color: "#7a5410" },
    { key: "bilibili"    as const, label: "哔哩哔哩", color: "#2160a0" },
    { key: "kuaishou"    as const, label: "快手",   color: "#1f7a52" },
  ];

  const toX = (i: number) => PAD.left + i * xStep;
  const toY = (v: number) => PAD.top + chartH - (v / 100) * chartH;

  // 水平网格线（卡布奇諾配色）
  const gridLines = [0, 25, 50, 75, 100].map((v) => {
    const y = toY(v);
    return `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + chartW}" y2="${y}" stroke="rgba(122,84,16,0.18)" stroke-width="1"/>
<text x="${PAD.left - 6}" y="${y + 4}" font-size="9" fill="rgba(74,54,33,0.6)" text-anchor="end">${v}</text>`;
  }).join("\n");

  const xLabels = data.dates.map((d, i) =>
    `<text x="${toX(i)}" y="${PAD.top + chartH + 16}" font-size="9" fill="rgba(74,54,33,0.65)" text-anchor="middle">${d}</text>`
  ).join("\n");

  const lines = platforms.map(({ key, color }) => {
    const vals = data[key];
    const pts = vals.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
    const areaBase = `${toX(days - 1)},${toY(0)} ${toX(0)},${toY(0)}`;
    return `
<defs>
  <linearGradient id="grad-${key}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${color}" stop-opacity="0.30"/>
    <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
  </linearGradient>
</defs>
<polygon points="${pts} ${areaBase}" fill="url(#grad-${key})"/>
<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
${vals.map((v, i) => `<circle cx="${toX(i)}" cy="${toY(v)}" r="3.5" fill="${color}" stroke="#fffaf0" stroke-width="1.5"/>`).join("")}`;
  }).join("\n");

  const legend = platforms.map(({ label, color }, i) =>
    `<rect x="${PAD.left + i * 155}" y="14" width="11" height="11" rx="3" fill="${color}"/>
<text x="${PAD.left + i * 155 + 16}" y="24" font-size="11" font-weight="700" fill="#3d2c14">${label}</text>`
  ).join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="font-family:'PingFang SC',system-ui,sans-serif">
  <defs>
    <linearGradient id="bg-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fffaf0"/>
      <stop offset="100%" stop-color="#f5ecda"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="12" fill="url(#bg-grad)"/>
  <rect width="${W}" height="${H}" rx="12" fill="none" stroke="rgba(122,84,16,0.30)" stroke-width="1"/>
  <text x="${W / 2}" y="12" font-size="10" font-weight="700" fill="#7a5410" text-anchor="middle">📊 ${topic} · 四平台 7 天热度趋势指数（0-100）</text>
  ${legend}
  ${gridLines}
  ${xLabels}
  ${lines}
</svg>`;

  const b64 = Buffer.from(svg).toString("base64");
  return `\n\n> 📈 **四平台 7 天趋势监控**（热度指数 0-100，100 为最热）\n\n<img src="data:image/svg+xml;base64,${b64}" width="680" alt="四平台7天趋势图" style="border-radius:12px;margin:8px 0"/>\n\n`;
}

/** 直接 HTTP 调用 Gemini API（普通模式） */
async function generate(
  model: string,
  prompt: string,
  retries = 2,
  opts?: { temperature?: number; maxTokens?: number; topP?: number; topK?: number },
): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts?.temperature ?? 0.5,
      ...(opts?.maxTokens != null ? { maxOutputTokens: opts.maxTokens } : {}),
      ...(opts?.topP != null ? { topP: opts.topP } : {}),
      ...(opts?.topK != null ? { topK: opts.topK } : {}),
    },
  });

  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(600_000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (res.status === 429 && i < retries) {
      console.log(`[deepResearch] 429，${10 * (i + 1)}s 后重试...`);
      await sleep(10000 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${model} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "");
  }
  return "";
}

/**
 * Deep Research Pro Preview · 顶级商业智库引擎调用器
 * - 模型：gemini-deep-research-pro-preview（2026 战略智库大脑，严禁降级）
 * - 工具：googleSearch（实时全网检索）+ deepResearch（comprehensive 深度推理）
 * - 推理：thinkingConfig.includeThoughts=true（开启思维链）
 * - 限速：Deep Research 建立 interaction 走 acquireRateGate() — 63s 滑窗内最多 30 次
 *
 * 输出包含：
 * - text：最终回答正文
 * - thoughts：思维链（被前端折叠显示在「AI 战略推演过程」区块）
 * - sources：Google 搜索接地的来源链接
 */
interface GroundedResult {
  text: string;
  thoughts?: string;
  sources: Array<{ title: string; url: string; snippet?: string }>;
}

const DEEP_RESEARCH_MODEL = "gemini-deep-research-pro-preview";

// ─── Interactions API（Deep Research Agent 专用） ─────────────────────────────
// Deep Research 是 Agent 而非普通模型，必须通过 Interactions API 调用。
// generateContent 会直接返回 400，不可使用。
const INTERACTIONS_BASE = "https://generativelanguage.googleapis.com/v1beta/interactions";
// Max 版：~160 次搜索 / ~900k token，比标准版更深度全面
const DEEP_RESEARCH_AGENT_NAME = "deep-research-max-preview-04-2026";
const POLL_INTERVAL_MS = 15_000;     // 15 秒轮询一次
const MAX_POLL_MS = 90 * 60 * 1000; // 90 分钟（已与 90 分钟上限对齐）
/**
 * Plan 阶段（collaborative_planning: true）轮询超时上限 = 90 分钟（5400 秒）。
 * 与 MAX_POLL_MS 看齐：Google deep-research-max-preview-04-2026 的 plan 阶段
 * 实测 10–30 分钟，极端复杂课题（多市场 + 多语种 + 法规交叉）可达 60-80 分钟。
 * 90 分钟硬上限覆盖最坏情况，超过即真卡死，自动退积分。
 */
const PLAN_MAX_MS = 90 * 60 * 1000;

const SYSTEM_INSTRUCTION_BASE =
  "[系统背景设定] 当前时间为 2026 年。你是国际顶尖商学院战略顾问 + 国内外主流媒体平台资深运营专家 + 顶级 IP 操盘手 + 行业数据分析师组成的高端商业智库 Agent。" +
  "请进行最深层次的全网交叉验证，覆盖近 2 年（2024-2026）真实数据，输出严格简体中文，禁止任何英文术语，产出具备卡布奇诺级商务质感的战略白皮书。";

/**
 * 防跑偏：B 端商业战略权重 80%，社媒/UGC 视角权重 20%。
 * 修补 deep-research-max 在「平台 IP」「内容矩阵」类课题里过度倒向短视频运营技巧的偏差。
 * 显式要求章节顺序与商业实证（财报、招股书、政策、白皮书、行业研报、上市公司公告优先）。
 */
const STRICT_BUSINESS_PROMPT = `

【B 端商业战略 · 严格权重契约（必须遵守）】
本次任务的输出要素权重为：
  - 80%：B 端商业战略 / 资本运营 / 行业格局 / 财务模型 / 政策与法规 / 标杆企业战略案例 / 投资并购 / 上下游产业链 / 渠道与分销 / 出海与本地化合规
  - 20%：消费者洞察 / 内容传播 / 平台运营 / KOL/KOC / 社媒数据
禁止把任何课题（包括「平台 IP」「内容矩阵」「品牌增长」）写成短视频运营手册或 KOL 推广 Tips。
所有数据必须能溯源到（按优先级）：
  1) 上市公司财报 / 招股书 / 经审计公告
  2) 政府 / 监管机构 / 行业协会公开白皮书
  3) 头部咨询机构（McKinsey, BCG, Bain, 罗兰贝格, 艾瑞, 易观, QuestMobile, IDC, Gartner）公开研报
  4) 主流财经媒体（FT, WSJ, Bloomberg, 财新, 第一财经, 36 氪 PRO）深度报道
  5) 平台官方运营报告（微信公开课、抖音商业大会、小红书 WILL、淘宝 TopTalk）
若遇见无法溯源的数据，必须显式标注【不确定 · 推断】并给出推断逻辑，禁止伪造来源链接。

【章节强约束】
报告必须包含以下章节（顺序可调，但不可缺）：
  ① 战略摘要（含核心结论 / 关键数字 / 不确定性提示）
  ② 行业格局与竞争态势（市场规模、增速、CR5、关键玩家阵营）
  ③ 标杆企业战略案例（≥ 3 家，含商业模式、财务数据、近 24 个月战略动作）
  ④ 政策 / 法规 / 合规风险
  ⑤ 财务与单位经济模型（CAC / LTV / GMV / Take Rate / 毛利率 / 经营现金流）
  ⑥ 关键风险与退出路径
  ⑦ 90 天行动建议（落地动作 + 资源配置 + KPI）
  ⑧ 附录（数据来源清单 + 不确定性清单 + 术语表）
`.trim();

/** Deep Research Max（Interactions API）强制附加 PDF 友好 Markdown 契约 + B 端防跑偏权重 */
const DEEP_RESEARCH_AGENT_SYSTEM_INSTRUCTION = `${SYSTEM_INSTRUCTION_BASE}\n\n${STRICT_BUSINESS_PROMPT}\n\n${PDF_FORMATTING_PROMPT_SUFFIX}`;

/**
 * Markdown 清洗：修补 deep-research / gemini-3.1-pro 常见排版瑕疵，
 * 保证 PDF 渲染时分行、空白、序号、单位的稳定性。
 *
 * 修补项：
 *   - "9.5/10" → "9.5 / 10"（防止被 marked 解释成路径或被 CSS 当作单字符黏死）
 *   - 全角斜杠 "／" 统一替换为带空格的 " / "
 *   - 连续 3+ 空行 → 2 空行（避免 PDF 出现整页空白）
 *   - 行尾空格清理
 *   - 表格单元格内连续 2+ 空格折叠为 1 个（防止表头列宽爆炸）
 *   - "（不确定·高/中/低）" 加颜色标记容易识别的占位（H/M/L 转大写空格）
 */
export function sanitizeMarkdown(md: string): string {
  if (!md) return md;
  let out = md;

  out = out.replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g, "$1 / $2");

  out = out.replace(/／/g, " / ");

  out = out.replace(/[ \t]+\n/g, "\n");

  out = out.replace(/\n{3,}/g, "\n\n");

  out = out.replace(/^(\|.*\|)$/gm, (line) => line.replace(/  +/g, " "));

  out = out.replace(/不确定[·:：]\s*高/g, "不确定 · **高**");
  out = out.replace(/不确定[·:：]\s*中/g, "不确定 · **中**");
  out = out.replace(/不确定[·:：]\s*低/g, "不确定 · **低**");

  return out.trim() + "\n";
}

/** 构建 multimodal input：纯文本 prompt 或 [text, image, document, ...] */
function buildInteractionInput(
  prompt: string,
  files?: Array<{ type: "image" | "pdf"; url: string; mimeType: string }>,
): string | any[] {
  if (!files?.length) return prompt;
  const parts: any[] = [{ type: "text", text: prompt }];
  for (const f of files) {
    if (f.type === "image") parts.push({ type: "image", uri: f.url });
    else parts.push({ type: "document", uri: f.url, mime_type: f.mimeType });
  }
  return parts;
}

/**
 * deep-research-max-preview-04-2026 不再支持 `system_instruction` 字段
 * （API 返回 400：「Please include any specific instructions in the 'input' prompt instead」）
 * 把系统指令以「全局指令 + 用户课题」结构拼进 input，等价于过去的 system_instruction 行为。
 */
function composePromptWithSystemInstruction(userPrompt: string): string {
  return `【全局系统指令 · 必须遵守】
${DEEP_RESEARCH_AGENT_SYSTEM_INSTRUCTION}

---

【用户课题】
${userPrompt}`;
}

/**
 * Deep Research API 调用错误 · 携带 HTTP 状态码 / 原始 body / 调用上下文 / stack
 * 用于把 Google Interactions API 的真实失败原因如实落到 jobError + Supervisor Debug。
 */
class DeepResearchApiError extends Error {
  readonly httpStatus?: number;
  readonly rawBody?: string;
  readonly stage: string;
  readonly interactionId?: string;
  readonly apiErrorCode?: string;
  readonly apiErrorMessage?: string;

  constructor(opts: {
    message: string;
    stage: string;
    httpStatus?: number;
    rawBody?: string;
    interactionId?: string;
    apiErrorCode?: string;
    apiErrorMessage?: string;
  }) {
    super(opts.message);
    this.name = "DeepResearchApiError";
    this.stage = opts.stage;
    this.httpStatus = opts.httpStatus;
    this.rawBody = opts.rawBody;
    this.interactionId = opts.interactionId;
    this.apiErrorCode = opts.apiErrorCode;
    this.apiErrorMessage = opts.apiErrorMessage;
  }

  /**
   * 序列化为人类可读的「调试卡片」(SupervisorDebug 直接显示)。
   * 形如：
   *   stage:        plan-create
   *   interactionId: -
   *   httpStatus:    400
   *   apiCode:       invalid_request
   *   apiMessage:    The 'system_instruction' parameter is not supported...
   *   rawBody:       {...}
   *   stack:         ...
   */
  toDetailString(): string {
    const lines = [
      `[Deep Research API 错误]`,
      `stage         : ${this.stage}`,
      `interactionId : ${this.interactionId ?? "-"}`,
      `httpStatus    : ${this.httpStatus ?? "-"}`,
      `apiCode       : ${this.apiErrorCode ?? "-"}`,
      `apiMessage    : ${this.apiErrorMessage ?? "-"}`,
      `message       : ${this.message}`,
    ];
    if (this.rawBody) {
      lines.push(`---raw response body (truncated 4KB) ---`);
      lines.push(this.rawBody.slice(0, 4096));
    }
    if (this.stack) {
      lines.push(`--- stack ---`);
      lines.push(this.stack);
    }
    return lines.join("\n");
  }
}

/** 通用轮询：从已创建的 interaction 拉结果。返回 outputs 数组
 *
 * @param onProgress 可选钩子：每次拉到 in_progress 时调用一次，参数是
 *                  「elapsed 秒数 + 总 maxMs 秒」，便于在调用层把真实
 *                  等待时长写回 job.progress（用户在前端能看到「已等待
 *                  N 分 / 通常需 X-Y 分」），不至于盯着写死的 boilerplate
 *                  以为系统挂了。
 */
async function pollInteraction(
  interactionId: string,
  apiHeaders: Record<string, string>,
  maxMs: number,
  abortSignal?: AbortSignal,
  onProgress?: (elapsedSec: number, maxSec: number) => Promise<void> | void,
): Promise<any[]> {
  const pollStart = Date.now();
  const maxSec = Math.round(maxMs / 1000);
  while (Date.now() - pollStart < maxMs) {
    if (abortSignal?.aborted) {
      throw new Error(`Deep Research 已中止（interactionId=${interactionId}）`);
    }
    await sleep(POLL_INTERVAL_MS);
    const elapsed = Math.round((Date.now() - pollStart) / 1000);
    let pollJson: any = {};
    try {
      const pollRes = await fetch(`${INTERACTIONS_BASE}/${interactionId}`, {
        headers: apiHeaders,
        signal: abortSignal,
      });
      const rawPoll = await pollRes.text();
      try { pollJson = JSON.parse(rawPoll); } catch { /* ignore */ }
      if (!pollRes.ok) {
        console.error(`[deepResearch] ❌ poll HTTP ${pollRes.status} elapsed=${elapsed}s：${rawPoll.slice(0, 1000)}`);
        throw new DeepResearchApiError({
          message: `Deep Research 轮询失败（HTTP ${pollRes.status}: ${pollJson?.error?.message ?? rawPoll.slice(0, 200)}），积分将退回。`,
          stage: "poll",
          httpStatus: pollRes.status,
          rawBody: rawPoll,
          interactionId,
          apiErrorCode: pollJson?.error?.code,
          apiErrorMessage: pollJson?.error?.message,
        });
      }
    } catch (fetchErr: any) {
      if (fetchErr?.name === "AbortError") throw fetchErr;
      console.warn(`[deepResearch] ⚠️ poll fetch 异常 elapsed=${elapsed}s：${fetchErr?.message}`);
      continue;
    }
    const status = pollJson?.status ?? "unknown";
    console.log(`[deepResearch] 🔍 PID=${process.pid} interactionId=${interactionId} status=${status} elapsed=${elapsed}s`);
    if (status === "failed") {
      const errMsg = pollJson?.error?.message || JSON.stringify(pollJson?.error || {}).slice(0, 300);
      throw new DeepResearchApiError({
        message: `Deep Research Agent 失败（${errMsg}），积分将退回。`,
        stage: "agent-failed",
        interactionId,
        apiErrorCode: pollJson?.error?.code,
        apiErrorMessage: pollJson?.error?.message,
        rawBody: JSON.stringify(pollJson, null, 2),
      });
    }
    if (status === "completed") {
      return (pollJson?.outputs || []) as any[];
    }
    // status === "in_progress" → 通知调用层刷新真实进度
    if (onProgress) {
      try {
        await onProgress(elapsed, maxSec);
      } catch (progressErr: any) {
        // ── 用户主动取消信号必须冒泡上去（让 worker 走 USER_CANCELLED 退积分） ──
        if (progressErr?.message === "USER_CANCELLED") throw progressErr;
        // 其他 progress 错误是非阻断的 UI 写盘失败，继续轮询
      }
    }
    // status === "in_progress" → 继续
  }
  throw new DeepResearchApiError({
    message: `Deep Research 超时未完成（已等候 ${Math.round(maxMs / 60000)} 分钟，interactionId=${interactionId}）`,
    stage: "poll-timeout",
    interactionId,
    apiErrorMessage: `Polling reached maxMs=${maxMs}ms without status=completed. Last poll: ${POLL_INTERVAL_MS / 1000}s ago. Either the Agent is still running but exceeded our local cap, or the Interaction is stuck on Google's side.`,
  });
}

/**
 * 阶段 0：请求 Deep Research Max 生成「研究计划」（Collaborative Planning）
 * - collaborative_planning: true → Agent 不立即开搜，先返回计划供用户审核
 * - 通常 2-5 分钟返回，最多 15 分钟
 * @returns { planText, planInteractionId } - planInteractionId 用于下一阶段 previous_interaction_id
 */
async function requestResearchPlan(
  prompt: string,
  files?: Array<{ type: "image" | "pdf"; url: string; mimeType: string }>,
  onInteractionId?: (id: string) => Promise<void>,
  onProgress?: (elapsedSec: number, maxSec: number) => Promise<void> | void,
): Promise<{ planText: string; planInteractionId: string }> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY");
  const apiHeaders = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
    "X-Goog-Api-Client": "genai-node/deep-research",
  };

  const release = await acquireRateGate("deep-research-plan");
  let interactionId: string;
  try {
    console.log(`[deepResearch] 📋 PID=${process.pid} 请求计划 promptLen=${prompt.length} files=${files?.length ?? 0}`);
    const createRes = await fetch(INTERACTIONS_BASE, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        agent: DEEP_RESEARCH_AGENT_NAME,
        // 系统指令必须拼进 input（agent 不接受 system_instruction 字段）
        input: buildInteractionInput(composePromptWithSystemInstruction(prompt), files),
        background: true,
        agent_config: {
          type: "deep-research",
          collaborative_planning: true, // ← 关键：先出计划
          thinking_summaries: "auto",
          visualization: "auto",
        },
      }),
    });
    const rawCreate = await createRes.text();
    let createJson: any = {};
    try { createJson = JSON.parse(rawCreate); } catch { /* ignore */ }
    if (!createRes.ok) {
      console.error(`[deepResearch] ❌ plan create HTTP ${createRes.status}：${rawCreate.slice(0, 2000)}`);
      const errMsg = createJson?.error?.message || createJson?.error?.status || rawCreate.slice(0, 300);
      throw new DeepResearchApiError({
        message: `Deep Research 计划提交失败（HTTP ${createRes.status}: ${errMsg}），积分将退回。`,
        stage: "plan-create",
        httpStatus: createRes.status,
        rawBody: rawCreate,
        apiErrorCode: createJson?.error?.code,
        apiErrorMessage: createJson?.error?.message,
      });
    }
    interactionId = createJson?.id;
    if (!interactionId) {
      throw new DeepResearchApiError({
        message: "Deep Research 计划阶段未返回 interactionId",
        stage: "plan-create",
        httpStatus: createRes.status,
        rawBody: rawCreate,
      });
    }
    console.log(`[deepResearch] ✅ PID=${process.pid} plan interaction 已创建：${interactionId}`);
  } finally {
    release();
  }

  if (onInteractionId) { try { await onInteractionId(interactionId); } catch { /* 非阻断 */ } }

  // 使用顶部常量 PLAN_MAX_MS（60 分钟），匹配 deep-research-max 实际计划耗时。
  const outputs = await pollInteraction(interactionId, apiHeaders, PLAN_MAX_MS, undefined, onProgress);
  const textOut = [...outputs].reverse().find((o: any) => !o.type || o.type === "text");
  const planText = String(textOut?.text || "").trim();
  if (!planText || planText.length < 50) {
    throw new DeepResearchApiError({
      message: `Deep Research 计划返回内容为空（${planText.length}字）`,
      stage: "plan-empty-output",
      interactionId,
      apiErrorMessage: `Plan completed but text output was empty or too short (${planText.length} chars).`,
    });
  }
  console.log(`[deepResearch] ✅ 计划已生成 ${planText.length}字`);
  return { planText, planInteractionId: interactionId };
}

/**
 * 阶段 1：审批计划并启动正式深潛执行
 * - 用 previous_interaction_id 续接计划阶段
 * - collaborative_planning: false → Agent 立即执行
 * - AbortController 60 分钟硬超时
 * @returns 最终接地数据 + 嵌入的 Agent 生成图表 markdown
 */
async function executeApprovedResearch(
  planInteractionId: string,
  feedback: string | undefined,
  onInteractionId?: (id: string) => Promise<void>,
  overrideInput?: string,
  onProgress?: (elapsedSec: number, maxSec: number) => Promise<void> | void,
): Promise<GroundedResult> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY");
  const apiHeaders = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
    "X-Goog-Api-Client": "genai-node/deep-research",
  };

  const finalCommand = overrideInput?.trim()
    ? overrideInput.trim()
    : feedback?.trim()
      ? `计划已收到，请依据以下用户反馈调整后立即开始执行最大深度（Maximum comprehensiveness）的综合研究：
${feedback.trim()}`
      : "计划完美，请立即开始执行最大深度（Maximum comprehensiveness）的综合研究，进行最深层次的全网交叉验证。";

  const release = await acquireRateGate("deep-research-execute");
  let interactionId: string;
  try {
    console.log(`[deepResearch] 🚀 PID=${process.pid} 执行批准的研究 previous=${planInteractionId} feedbackLen=${feedback?.length ?? 0}`);
    const createRes = await fetch(INTERACTIONS_BASE, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        agent: DEEP_RESEARCH_AGENT_NAME,
        input: finalCommand,
        previous_interaction_id: planInteractionId,
        background: true,
        agent_config: {
          type: "deep-research",
          collaborative_planning: false, // ← 关键：跳过计划，直接执行
          thinking_summaries: "auto",
          visualization: "auto",
        },
      }),
    });
    const rawCreate = await createRes.text();
    let createJson: any = {};
    try { createJson = JSON.parse(rawCreate); } catch { /* ignore */ }
    if (!createRes.ok) {
      console.error(`[deepResearch] ❌ execute create HTTP ${createRes.status}：${rawCreate.slice(0, 2000)}`);
      const errMsg = createJson?.error?.message || createJson?.error?.status || rawCreate.slice(0, 300);
      throw new DeepResearchApiError({
        message: `Deep Research 执行提交失败（HTTP ${createRes.status}: ${errMsg}），积分将退回。`,
        stage: "execute-create",
        httpStatus: createRes.status,
        rawBody: rawCreate,
        interactionId: planInteractionId,
        apiErrorCode: createJson?.error?.code,
        apiErrorMessage: createJson?.error?.message,
      });
    }
    interactionId = createJson?.id;
    if (!interactionId) {
      throw new DeepResearchApiError({
        message: "Deep Research 执行阶段未返回 interactionId",
        stage: "execute-create",
        httpStatus: createRes.status,
        rawBody: rawCreate,
        interactionId: planInteractionId,
      });
    }
    console.log(`[deepResearch] ✅ PID=${process.pid} execute interaction 已创建：${interactionId}`);
  } finally {
    release();
  }

  if (onInteractionId) { try { await onInteractionId(interactionId); } catch { /* 非阻断 */ } }

  // 1 小时硬超时（AbortController 自动 abort）
  const abortController = new AbortController();
  const hardTimeout = setTimeout(() => abortController.abort(), MAX_POLL_MS);
  try {
    const outputs = await pollInteraction(interactionId, apiHeaders, MAX_POLL_MS, abortController.signal, onProgress);
    const textOut = [...outputs].reverse().find((o: any) => !o.type || o.type === "text");
    const text = String(textOut?.text || "").trim();
    if (!text || text.length < 400) {
      console.error(`[deepResearch] ❌ 完成但正文不足（${text.length}字）`);
      throw new DeepResearchApiError({
        message: `Deep Research 完成但内容不足（${text.length}字），积分将退回。`,
        stage: "execute-empty-output",
        interactionId,
        apiErrorMessage: `Execute completed but text output was too short (${text.length} chars, need ≥400).`,
      });
    }
    // 捕获 Agent 原生生成的图表
    const imageOutputs = outputs.filter((o: any) => o.type === "image" && o.data);
    let chartMarkdown = "";
    if (imageOutputs.length > 0) {
      chartMarkdown = "\n\n## 📊 Agent 生成图表\n\n" + imageOutputs.map((o: any, i: number) =>
        `![图表 ${i + 1}](data:image/png;base64,${o.data})\n`
      ).join("\n");
      console.log(`[deepResearch] 📊 捕获到 ${imageOutputs.length} 张 Agent 生成图表`);
    }
    console.log(`[deepResearch] ✅ 执行完成 ${text.length}字 charts=${imageOutputs.length}`);
    return { text: text + chartMarkdown, sources: [] };
  } finally {
    clearTimeout(hardTimeout);
  }
}

/** @deprecated 旧接口 · plan + execute 一站式（保持向下兼容） */
async function generateGrounded(_model: string, prompt: string): Promise<GroundedResult> {
  const { planInteractionId } = await requestResearchPlan(prompt);
  return executeApprovedResearch(planInteractionId, undefined);
}

// ── Neon DB 辅助 ────────────────────────────────────────────────────────────

async function getDbAndSchema() {
  const { getDb } = await import("../db");
  const { userCreations } = await import("../../drizzle/schema-creations");
  const db = await getDb();
  return { db, userCreations };
}

// ── on-demand 封面补生（HTML / PDF 下载触发） ──────────────────────────────
//
// 用户决策（2026-05-02）：
//   与主流程一致：**仅 Vertex**，Nano Banana Pro（`VERTEX_STRATEGIC_COVER_IMAGE_MODEL`）+
//   **4K**、9:16；走 Vercel `/api/google?op=nanoImage`，**不**走 Consumer API Key。
//
// 设计要点：
//   - 已有封面直接返回（幂等）
//   - 最多 2 次重试，单次超时 120s（4K 可能较慢）
//   - prompt 要求标题烤进图（模板不叠字）
//   - 失败返回 undefined
export async function ensureCoverForCreation(
  creationId: number,
  lighthouseTitle: string,
): Promise<string | undefined> {
  if (!creationId || !Number.isFinite(creationId)) return undefined;
  try {
    const { db, userCreations } = await getDbAndSchema();
    if (!db) return undefined;
    const { eq } = await import("drizzle-orm");

    // 已有封面：直接返回（HTTP url，调用方自己 inlineCoverIfHttp）
    const rows = await db
      .select({ thumbnailUrl: userCreations.thumbnailUrl })
      .from(userCreations)
      .where(eq(userCreations.id, creationId))
      .limit(1);
    const existing = rows[0]?.thumbnailUrl;
    if (existing && existing.trim().length > 0) {
      return existing;
    }

    // 关键：要求模型把标题作为金色印刷字直接画进图，因为下载模板里不再叠任何文字
    // （PR #356 / #357 之后，有封面图时模板纯图，不再有 cover-pill / cover-mega 文字层）
    const safeTitle = String(lighthouseTitle || "战略情报报告").trim().slice(0, 60);
    const promptBase =
      `Luxury dark-gold business magazine cover, cinematic editorial photography, ` +
      `dramatic lighting, sophisticated typography overlay, 9:16 vertical portrait format. ` +
      `Render the report title prominently as elegant gold typography baked directly into the image — ` +
      `it must be readable in the final picture (no separate text overlay will be added by the template). ` +
      `Include a small "STRATEGIC INTELLIGENCE" tagline near the top. ` +
      `Topic / title to render: ${safeTitle}`;
    const prompt = appendMagazineCoverDateInstructions(promptBase);

    let imageUrl: string | undefined;
    const vercelBaseUrl = String(process.env.VERCEL_APP_URL || "https://mvstudiopro.vercel.app").replace(/\/$/, "");
    for (let attempt = 1; attempt <= 2 && !imageUrl; attempt++) {
      try {
        imageUrl = await fetchStrategicVertexImageViaGateway({
          vercelBaseUrl,
          prompt,
          aspectRatio: "9:16",
          kind: "cover_pro_4k",
          timeoutMs: 120_000,
        });
        console.log(
          `[ensureCoverForCreation] ✅ on-demand 封面 via Vertex Pro 4K（${VERTEX_STRATEGIC_COVER_IMAGE_MODEL}），第 ${attempt}/2 次 creationId=${creationId}`,
        );
      } catch (e: any) {
        console.warn(
          `[ensureCoverForCreation] ⚠️ 第 ${attempt}/2 次失败: ${e?.message ?? e} creationId=${creationId}`,
        );
        if (attempt < 2) await sleep(1000);
      }
    }

    if (!imageUrl) {
      console.warn(`[ensureCoverForCreation] 2 次全失败 creationId=${creationId}，模板将走文字框回退`);
      return undefined;
    }

    // 回写 DB（失败也不阻塞返回 — 下载流程能继续，下次再触发也会拿到这次刚生成的 url）
    try {
      await db
        .update(userCreations)
        .set({ thumbnailUrl: imageUrl, updatedAt: new Date() })
        .where(eq(userCreations.id, creationId));
    } catch (e: any) {
      console.warn(
        `[ensureCoverForCreation] DB 回写失败（不阻塞下载）: ${e?.message} creationId=${creationId}`,
      );
    }
    return imageUrl;
  } catch (e: any) {
    console.warn(`[ensureCoverForCreation] 异常: ${e?.message} creationId=${creationId}`);
    return undefined;
  }
}

/** 在 Neon DB 中创建 processing 状态的研报记录 */
async function dbCreateRecord(userId: number, topic: string, jobId: string, creditsUsed: number): Promise<number | undefined> {
  try {
    const { db, userCreations } = await getDbAndSchema();
    if (!db) return undefined;
    const rows = await db.insert(userCreations).values({
      userId,
      type: "deep_research_report",
      title: topic.slice(0, 120),
      status: "processing",
      creditsUsed,
      metadata: JSON.stringify({ topic, jobId, progress: "🚀 任务已派发，等待算力节点…" }),
    }).returning({ id: userCreations.id });
    return rows[0]?.id;
  } catch (e: any) {
    console.warn("[deepResearch] dbCreateRecord failed:", e?.message);
    return undefined;
  }
}

/** 更新 Neon DB 研报状态 */
async function dbUpdateRecord(
  dbRecordId: number,
  status: string,
  progress: string,
  reportMarkdown?: string,
  error?: string,
  extras?: { thumbnailUrl?: string; lighthouseTitle?: string; summary?: string; duration?: string },
) {
  try {
    const { db, userCreations } = await getDbAndSchema();
    if (!db) return;
    const { eq } = await import("drizzle-orm");
    const setPayload: Record<string, unknown> = {
      status,
      metadata: JSON.stringify({
        progress,
        reportMarkdown: reportMarkdown ?? null,
        error: error ?? null,
        ...(extras?.lighthouseTitle ? { lighthouseTitle: extras.lighthouseTitle } : {}),
        ...(extras?.summary ? { summary: extras.summary } : {}),
        ...(extras?.duration ? { duration: extras.duration } : {}),
      }),
      updatedAt: new Date(),
    };
    if (extras?.thumbnailUrl) setPayload.thumbnailUrl = extras.thumbnailUrl;
    await db.update(userCreations).set(setPayload).where(eq(userCreations.id, dbRecordId));
  } catch (e: any) {
    console.warn("[deepResearch] dbUpdateRecord failed:", e?.message);
  }
}

/** 抓取用户历史研报快照（供个性化分析「大洗牌」对比使用） */
export async function getUserReportSnapshots(userId: string): Promise<Array<{ date: string; title: string; summary: string; topic: string }>> {
  try {
    const { db, userCreations } = await getDbAndSchema();
    if (!db) return [];
    const { eq, and, desc } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(userCreations)
      .where(and(eq(userCreations.userId, Number(userId)), eq(userCreations.type, "deep_research_report"), eq(userCreations.status, "completed")))
      .orderBy(desc(userCreations.createdAt))
      .limit(8);
    return rows.map((r) => {
      let meta: any = {};
      try { meta = JSON.parse(r.metadata || "{}"); } catch {}
      return {
        date: r.createdAt.toLocaleDateString("zh-CN"),
        title: r.title || meta.lighthouseTitle || meta.topic || "无标题",
        topic: meta.topic || r.title || "",
        summary: meta.summary || meta.reportMarkdown?.slice(0, 200) || "",
      };
    });
  } catch {
    return [];
  }
}

/** 抓取用户其他平台调研快照与历史作品聚合，用于个性化分析的"全息基线" */
export async function getUserHolisticContext(userId: string): Promise<{
  totalCreations: number;
  byType: Record<string, number>;
  recentTopics: string[];
  competitorSnapshots: Array<{ date: string; platform: string; positioning: string }>;
  totalCreditsSpent: number;
}> {
  const empty = { totalCreations: 0, byType: {}, recentTopics: [], competitorSnapshots: [], totalCreditsSpent: 0 };
  try {
    const { db, userCreations } = await getDbAndSchema();
    if (!db) return empty;
    const { eq, and, desc } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(userCreations)
      .where(and(eq(userCreations.userId, Number(userId))))
      .orderBy(desc(userCreations.createdAt))
      .limit(80);

    const byType: Record<string, number> = {};
    const recentTopics: string[] = [];
    const competitorSnapshots: Array<{ date: string; platform: string; positioning: string }> = [];
    let totalCreditsSpent = 0;

    for (const r of rows) {
      const t = String(r.type || "");
      byType[t] = (byType[t] || 0) + 1;
      totalCreditsSpent += Number(r.creditsUsed || 0);
      let meta: any = {};
      try { meta = JSON.parse(r.metadata || "{}"); } catch {}
      if (t === "deep_research_report") {
        const topic = String(meta.topic || r.title || "").trim();
        if (topic && recentTopics.length < 8) recentTopics.push(topic);
      }
      if (t === "research_snapshot" && competitorSnapshots.length < 6) {
        competitorSnapshots.push({
          date: r.createdAt.toLocaleDateString("zh-CN"),
          platform: String(meta.platform || "未知"),
          positioning: String(meta.positioning?.coreIdentity || meta.positioning?.summary || "").slice(0, 120),
        });
      }
    }

    return { totalCreations: rows.length, byType, recentTopics, competitorSnapshots, totalCreditsSpent };
  } catch {
    return empty;
  }
}

// ── Fly 磁盘 Job 结构 ────────────────────────────────────────────────────────

export type DeepResearchProductType = "magazine_single" | "magazine_sub" | "personalized" | "enterprise_flagship" | "platform_ip_matrix" | "competitor_radar" | "vip_baseline" | "vip_monthly";

export interface DeepResearchJob {
  jobId: string;
  userId: string;
  topic: string;
  productType?: DeepResearchProductType;
  dbRecordId?: number;
  // 状态机：pending（排队）→ running（生成中）→ awaiting_review（草稿待主编审核）→ completed（已出刊） / failed
  status: "pending" | "planning" | "awaiting_plan_approval" | "running" | "awaiting_review" | "completed" | "failed";
  progress?: string;
  reportMarkdown?: string;   // 出刊后的最终版（出刊前为空）
  draftMarkdown?: string;    // 草稿版（生成完成后写入）
  error?: string;
  createdAt: string;
  completedAt?: string;
  // ── 防中断追踪字段（resilience tracking） ─────────────────────────────────
  /** 最后一次任意写入时间。worker 心跳：每 30s 自动更新一次。重启时若 heartbeat
   *  落后超过 RESUME_THRESHOLD 即视为「进程已死」，自动重新拉起或标失败。 */
  lastHeartbeatAt?: string;
  /** 当前持有该任务的进程 PID。仅供调试，下面的判定逻辑只看 heartbeat 时间。 */
  pid?: number;
  /** 重启次数（attemptCount）。超过 MAX_RESUME_ATTEMPTS 则不再重启，直接 failed + 退积分。 */
  attemptCount?: number;
  /** 启动任务时实际扣除的积分（用于失败时退积分）。0 = 管理员/免费，无需退分。 */
  creditsUsed?: number;
  /** Google Interactions API 返回的当前阶段 interaction ID（plan 或 execute） */
  interactionId?: string;
  /** Plan 阶段返回的 interactionId（执行阶段用 previous_interaction_id 续接） */
  planInteractionId?: string;
  /** Plan 阶段 Agent 提出的研究计划文本（待用户审核） */
  planText?: string;
  /** 用户审核计划时填入的反馈（如「不要看快手数据」） */
  planFeedback?: string;
  /** Execute 阶段产生的接地数据（harvested.text），便于断线恢复 */
  harvestedText?: string;
  /** 可选：覆盖 executeApprovedResearch 的 input（VIP 月度更新场景：传月度新数据） */
  executeOverrideInput?: string;
  /** 可选：任务完成后的回填钩子（如 VIP 档案需回填 baseInteractionId） */
  onCompletedHook?: { kind: "vip_base" | "vip_monthly"; ownerId: string; vipId: string };
  /** 用户上传的补充资料：文字说明 + 文件（已存 GCS，注入阶段 A Deep Research） */
  supplementaryText?: string;
  supplementaryFiles?: Array<{ name: string; type: "image" | "pdf"; mimeType: string; url: string; gcsUri: string }>;
  /**
   * 企业专属 IP 基因（B 端拦截弹窗收集）
   * 注入到 Plan / Execute 的 prompt [全局战略预设] 段，让推演 80% 篇幅锁定
   * 高客单转化路径、合规与定价战略，避免变成大众视角的"小生意建议"。
   */
  ipProfile?: {
    industry: string;
    advantage: string;
    audience: string;
    taboos?: string;
    flagship: string;
  };
  /** 失败时的结构化错误详情（DeepResearchApiError.toDetailString()）。Supervisor Debug 直接展示。 */
  errorDetail?: string;
  /** 用户/管理员发起的取消请求时间戳（ISO）。worker 在 polling 循环检测到该字段
   *  即抛 USER_CANCELLED 进入失败路径，由 paidJobLedger 幂等退积分。 */
  cancelRequestedAt?: string;
  cancelRequestedBy?: "user" | "admin" | "deploy" | "reaper";
  /** 取消时希望传给 refundCreditsOnFailure 的 reason（默认根据 cancelRequestedBy 推断）：
   *   - by="user" → "user_cancelled_no_refund"（主动取消不退积分，防恶意刷算力）
   *   - by="admin" / "reaper" → "user_cancelled"（仍然幂等退积分）
   *   - by="deploy" → "deploy_killed"（仍然幂等退积分）
   *  调用方可显式覆盖。 */
  cancelRefundReason?: PaidJobRefundReason;
}

// ── 恢复阈值（resilience thresholds） ───────────────────────────────────────
/** Heartbeat 落后多少毫秒视为「进程可能已死，可考虑重新拉起」。Deep Research API
 *  单次最长 ~10 分钟，期间 updateProgress 会刷 heartbeat；超过 3 分钟没动静意味
 *  着不是网络慢就是进程死了。 */
const HEARTBEAT_RESUME_AFTER_MS = 3 * 60 * 1000;
/** Heartbeat 落后多少毫秒视为「彻底死亡，退积分并放弃」。包含「重启后再次跑也无果」
 *  的极端场景；当任务 heartbeat 超过该阈值即直接 failed + 退积分。 */
const HEARTBEAT_FAIL_AFTER_MS = 30 * 60 * 1000;
/** 同一任务被重新拉起的最大次数。超过此值直接 failed + 退积分，避免毒任务循环消耗
 *  63s 滑窗 30 次配额。 */
const MAX_RESUME_ATTEMPTS = 2;
/** Worker 内 heartbeat ticker 间隔。每隔此时长写一次 lastHeartbeatAt，让监控能区
 *  分「在跑但慢」和「进程已死」。 */
const HEARTBEAT_TICK_MS = 30 * 1000;

async function writeJob(job: DeepResearchJob) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  // 自动盖心跳：每次 writeJob 都视为一次活动信号。
  const stamped: DeepResearchJob = {
    ...job,
    lastHeartbeatAt: new Date().toISOString(),
    pid: job.pid ?? process.pid,
  };
  await fs.writeFile(
    path.join(REPORT_DIR, `${job.jobId}.json`),
    JSON.stringify(stamped, null, 2),
  );
}

/** 仅写一行心跳时间戳（不读旧 job，最小 IO）。供 ticker 使用。
 *
 *  ⚠️ 关键修复（2026-04-29）：必须在 `running` ＋ `planning` 两种状态下都刷心跳。
 *  之前只刷 running，导致 worker 进入 Plan 阶段后心跳停滞 → Watchdog 在 15 分钟
 *  误判「卡死」并把还在 Google 后台正常推演的 Plan 任务杀掉、退积分。这是
 *  jobId=dr_1777424558978_7fxbgq 等多次失败的真正根因。
 */
async function bumpHeartbeat(jobId: string) {
  try {
    const file = path.join(REPORT_DIR, `${jobId}.json`);
    const raw = await fs.readFile(file, "utf-8");
    const job: DeepResearchJob = JSON.parse(raw);
    // 在所有「worker 仍持有任务」的状态下都要刷心跳，避免覆盖终态。
    if (job.status !== "running" && job.status !== "planning") return;
    job.lastHeartbeatAt = new Date().toISOString();
    job.pid = process.pid;
    await fs.writeFile(file, JSON.stringify(job, null, 2));
    // 同步刷新 paidJobLedger 心跳，让 admin 端点 / reaper 看到任务还活着
    await heartbeatActiveJob(jobId, "deepResearch").catch(() => {});
  } catch {
    // 心跳失败不影响主流程
  }
}

export async function readJob(jobId: string): Promise<DeepResearchJob | null> {
  try {
    const raw = await fs.readFile(path.join(REPORT_DIR, `${jobId}.json`), "utf-8");
    return JSON.parse(raw) as DeepResearchJob;
  } catch {
    return null;
  }
}

/** 付费深潜失败时对用户的统一口径（真实原因写入 errorDetail / 日志；仅退积分，无法币退款） */
const USER_FACING_DEEP_RESEARCH_PAID_REFUND =
  "当前算力资源紧张或服务暂时不可用，请稍后再试。相关积分已退还至您的账户。";
const USER_FACING_DEEP_RESEARCH_FREE_FAIL =
  "当前算力资源紧张或服务暂时不可用，请稍后再试。";

function resolveUserFacingFailureError(
  job: DeepResearchJob,
  reason: string,
  refundReason: PaidJobRefundReason,
): string {
  if (refundReason === "user_cancelled_no_refund") return reason;
  const paid = typeof job.creditsUsed === "number" && job.creditsUsed > 0;
  if (refundReason === "user_cancelled" && paid) {
    return "您已取消任务，相关积分已退还至您的账户。";
  }
  if (refundReason === "deploy_killed" && paid) {
    return "服务正在部署维护，任务已中断，相关积分已退还至您的账户。请稍后再试。";
  }
  if (paid) return USER_FACING_DEEP_RESEARCH_PAID_REFUND;
  return USER_FACING_DEEP_RESEARCH_FREE_FAIL;
}

/** 把任务标记为彻底失败，并退还积分 + 同步 DB。
 *  detail：可选的结构化错误详情（DeepResearchApiError.toDetailString()），
 *  会写入 job.errorDetail 供 Supervisor Debug 与「查看详细原因」UI 展示。
 *
 *  ⚠️ 退积分**只**走 paidJobLedger.refundCreditsOnFailure（幂等 + 仅写积分账本）。
 *  禁止任何形式的现金退款 / 支付网关调用。文案统一「积分已退还至您的账户」（仅退积分，非原路退款）。
 *
 *  user-facing：`job.error` 使用温和表述（算力紧张等）；`reason` 参数的技术说明会并入 errorDetail。
 */
async function failJobAndRefund(
  job: DeepResearchJob,
  reason: string,
  progressMsg: string,
  detail?: string,
  refundReason: PaidJobRefundReason = "task_failed",
) {
  const userFacingError = resolveUserFacingFailureError(job, reason, refundReason);
  let mergedDetail = detail;
  if (refundReason !== "user_cancelled_no_refund" && reason?.trim()) {
    const tech = `技术摘要：${reason}`;
    mergedDetail = mergedDetail?.trim() ? `${mergedDetail.trim()}\n\n---\n\n${tech}` : tech;
  }

  const file = path.join(REPORT_DIR, `${job.jobId}.json`);
  const failedJob: DeepResearchJob = {
    ...job,
    status: "failed",
    error: userFacingError,
    progress: progressMsg,
    completedAt: new Date().toISOString(),
    errorDetail: mergedDetail ?? job.errorDetail,
  };
  try { await fs.writeFile(file, JSON.stringify(failedJob, null, 2)); } catch {}
  if (job.dbRecordId) {
    try { await dbUpdateRecord(job.dbRecordId, "failed", progressMsg, undefined, reason); } catch {}
  }
  // 退积分 — 经由 paidJobLedger 的幂等门面，重复调用 / 已 settled 自动 no-op
  try {
    const result = await refundCreditsOnFailure(
      job.jobId,
      "deepResearch",
      refundReason,
      `${userFacingError}${mergedDetail ? ` · ${mergedDetail.slice(0, 200)}` : ""}`,
    );
    // ── 兼容老任务（PR 部署前已在跑、没有 ledger hold 文件）：回退到直接积分接口 ──
    //   只有当 ledger 说 hold 缺失，且 job 自身记录了正数 creditsUsed 时才走这条路。
    if (result.status === "missing" && typeof job.creditsUsed === "number" && job.creditsUsed > 0) {
      const { refundCredits } = await import("../credits");
      await refundCredits(
        Number(job.userId),
        job.creditsUsed,
        `上帝视角研报·${reason}·积分已退还至您的账户（legacy fallback）`,
      );
      console.log(
        `[deepResearch] 💰 (legacy fallback) 已返还 ${job.creditsUsed} 积分给用户 ${job.userId}（任务 ${job.jobId}）`,
      );
    }
  } catch (e: any) {
    console.warn(`[deepResearch] paidJobLedger.refundCreditsOnFailure 失败 (job=${job.jobId}):`, e?.message);
  }
}

/** 在当前进程内重新拉起一个 running 任务。返回是否拉起成功。 */
async function relaunchJob(job: DeepResearchJob): Promise<boolean> {
  const file = path.join(REPORT_DIR, `${job.jobId}.json`);
  const nextAttempt = (job.attemptCount ?? 1) + 1;
  if (nextAttempt > MAX_RESUME_ATTEMPTS + 1) {
    await failJobAndRefund(
      job,
      `重启 ${MAX_RESUME_ATTEMPTS} 次仍未完成，停止重试`,
      `❌ 任务多次重启仍失败，已退回积分 ${job.creditsUsed ?? 0} 点`,
    );
    return false;
  }
  // 标记进入 running 并打上当前进程 + attempt
  const resumed: DeepResearchJob = {
    ...job,
    status: "running",
    progress: `🔁 检测到服务重启，第 ${nextAttempt} 次自动重新拉起任务…`,
    pid: process.pid,
    attemptCount: nextAttempt,
    error: undefined,
  };
  try { await fs.writeFile(file, JSON.stringify(resumed, null, 2)); } catch {}
  if (job.dbRecordId) {
    try { await dbUpdateRecord(job.dbRecordId, "processing", resumed.progress ?? "🔁 任务重新拉起"); } catch {}
  }
  // fire-and-forget；任何未捕获异常都会被 runDeepResearchAsync 内部的 try/catch 接住
  setImmediate(() => {
    runDeepResearchAsync(job.jobId).catch((e) =>
      console.warn(`[deepResearch] relaunched job ${job.jobId} crashed:`, e?.message),
    );
  });
  console.log(`[deepResearch] 🔁 重启拉起任务 ${job.jobId}（attempt ${nextAttempt}/${MAX_RESUME_ATTEMPTS + 1}）`);
  return true;
}

/**
 * 服务启动时调用：扫描所有未终态任务，按 heartbeat 滞后程度分级处理：
 *   * heartbeat 在 3 分钟内：跳过（worker 仍在跑，无需介入）
 *   * heartbeat 落后 3-30 分钟：进程视为已死，自动重新拉起（最多 MAX_RESUME_ATTEMPTS 次）
 *   * heartbeat 落后 > 30 分钟：彻底放弃，标 failed + 退积分
 *   * 没有 heartbeat 字段（旧数据）：fallback 到 createdAt 判断
 *
 * ⚠️ 关键修复（2026-04-29 · 7pmm9u 事故）：
 *   原本只恢复 running / pending 状态。但 deep-research 的 plan 阶段会把 status
 *   置为 "planning" 等待 Google 那边返回；如果机器恰在此时重启，这个 job 就被跳过，
 *   永远成为孤儿（前端进度条永远停在「Plan 推演中」），用户拉不出报告，算力费白烧。
 *   现在 planning 也纳入恢复白名单。
 *   awaiting_review / awaiting_plan_approval 是等用户决策的状态，不应该恢复。
 */
const RECOVERABLE_STATUSES = new Set([
  "running",
  "pending",
  "planning",
]);

export async function recoverOrphanedJobs(): Promise<void> {
  // 启动时也确保 shutdown 钩子注册，这样下次重启前能给 inflight 任务打上「快速重拉」标记
  ensureShutdownHook();
  try {
    await fs.mkdir(REPORT_DIR, { recursive: true });
    const files = await fs.readdir(REPORT_DIR);
    const now = Date.now();

    let resumed = 0;
    let failed = 0;
    let skipped = 0;

    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(REPORT_DIR, f), "utf-8");
        const job: DeepResearchJob = JSON.parse(raw);
        if (!RECOVERABLE_STATUSES.has(job.status as string)) continue;

        const lastBeat = job.lastHeartbeatAt
          ? new Date(job.lastHeartbeatAt).getTime()
          : new Date(job.createdAt).getTime();
        const lag = now - lastBeat;

        if (lag < HEARTBEAT_RESUME_AFTER_MS) {
          // 还有可能其它进程在跑（多实例 / 同实例刚 fork），不要打扰
          skipped += 1;
          continue;
        }
        if (lag > HEARTBEAT_FAIL_AFTER_MS) {
          await failJobAndRefund(
            job,
            `任务超过 ${Math.round(HEARTBEAT_FAIL_AFTER_MS / 60000)} 分钟无心跳`,
            `❌ 任务长时间无响应，已退回积分 ${job.creditsUsed ?? 0} 点`,
          );
          failed += 1;
          continue;
        }
        // 3-30 分钟无心跳：自动重新拉起
        const ok = await relaunchJob(job);
        if (ok) resumed += 1;
        else failed += 1;
      } catch {}
    }

    if (resumed + failed + skipped > 0) {
      console.log(`[deepResearch] 🔍 启动恢复扫描完成：重启 ${resumed} · 失败 ${failed} · 跳过 ${skipped}`);
    }
  } catch (e) {
    console.warn("[deepResearch] recoverOrphanedJobs 扫描失败:", e);
  }
}

// ── Graceful shutdown ───────────────────────────────────────────────────────
// Fly.io 部署 / 重启时会发 SIGTERM。我们捕获信号并立即把所有「当前进程持有」的
// running 任务的 heartbeat 时间提前到「3 分钟前」，这样下一个进程启动时
// recoverOrphanedJobs 会立刻拉起这些任务，而不是等到 3 分钟后才发现进程死了。
// 这样能把重启造成的「无声卡顿期」从最长 3 分钟压缩到几秒。
let shutdownHooked = false;
function ensureShutdownHook() {
  if (shutdownHooked) return;
  shutdownHooked = true;
  const handler = async (sig: string) => {
    console.log(`[deepResearch] ⚠️  ${sig} received, marking inflight jobs for fast resume…`);
    try {
      const files = await fs.readdir(REPORT_DIR).catch(() => [] as string[]);
      const past = new Date(Date.now() - HEARTBEAT_RESUME_AFTER_MS - 1000).toISOString();
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
          const file = path.join(REPORT_DIR, f);
          const job: DeepResearchJob = JSON.parse(await fs.readFile(file, "utf-8"));
          // 关键：必须覆盖所有 RECOVERABLE_STATUSES（含 planning），否则 plan 阶段
          // 重启就不会被快速恢复，要等到自然心跳过期才恢复（白白延迟几分钟）。
          if (RECOVERABLE_STATUSES.has(job.status as string) && job.pid === process.pid) {
            job.lastHeartbeatAt = past;
            await fs.writeFile(file, JSON.stringify(job, null, 2));
          }
        } catch {}
      }
    } catch {}
    // 不主动 process.exit；让 Node 自然退出（其他 service 的 shutdown 钩子也能跑）
  };
  process.on("SIGTERM", () => { void handler("SIGTERM"); });
  process.on("SIGINT", () => { void handler("SIGINT"); });
}

/** 创建任务（同步写入 Fly 磁盘 + Neon DB，立即响应前端） */
export async function createDeepResearchJob(
  userId: string,
  topic: string,
  creditsUsed = 0,
  productType: DeepResearchProductType = "magazine_single",
  supplementary?: { supplementaryText?: string; supplementaryFiles?: DeepResearchJob["supplementaryFiles"]; ipProfile?: DeepResearchJob["ipProfile"] },
  /** 进阶选项：用于 VIP 月度更新等场景（预设 planInteractionId 跳过 plan 阶段，覆盖 execute input） */
  advanced?: {
    /** 预填 planInteractionId（VIP 月度更新：上一次执行返回的 interactionId） */
    planInteractionId?: string;
    /** 覆盖 execute 阶段的 input（VIP 场景：传月度新数据） */
    executeOverrideInput?: string;
    /** 任务完成回填钩子 */
    onCompletedHook?: DeepResearchJob["onCompletedHook"];
    /** 直接以 running 状态启动（跳过 plan 审批 UI，VIP 场景用） */
    skipPlanApproval?: boolean;
  },
): Promise<{ jobId: string; dbRecordId?: number }> {
  const jobId = `dr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 确保 SIGTERM 钩子已注册（首次创建任务时启用，无副作用）
  ensureShutdownHook();

  // 先写 Fly 磁盘（保证一定成功）
  const job: DeepResearchJob = {
    jobId,
    userId,
    topic,
    productType,
    // skipPlanApproval=true 直接 running（跳过 collaborative_planning，用 previous_interaction_id 续接）
    status: advanced?.skipPlanApproval ? "running" : "pending",
    progress: "🚀 任务已派发，等待算力节点…",
    createdAt: new Date().toISOString(),
    creditsUsed,
    attemptCount: 1,
    ...(supplementary?.supplementaryText ? { supplementaryText: supplementary.supplementaryText } : {}),
    ...(supplementary?.supplementaryFiles?.length ? { supplementaryFiles: supplementary.supplementaryFiles } : {}),
    ...(supplementary?.ipProfile ? { ipProfile: supplementary.ipProfile } : {}),
    ...(advanced?.planInteractionId ? { planInteractionId: advanced.planInteractionId } : {}),
    ...(advanced?.executeOverrideInput ? { executeOverrideInput: advanced.executeOverrideInput } : {}),
    ...(advanced?.onCompletedHook ? { onCompletedHook: advanced.onCompletedHook } : {}),
  };
  await writeJob(job);

  // 再写 Neon DB（允许失败，不影响任务启动）
  const dbRecordId = await dbCreateRecord(Number(userId), topic, jobId, creditsUsed);
  if (dbRecordId) {
    await writeJob({ ...job, dbRecordId });
  }

  // ── paidJobLedger：在持久卷登记一份 active hold 记录 ────────────────────────
  //   * admin 端点 / pre-deploy-guard / reaper 都会扫这个文件
  //   * 兜底退积分走 ledger.refundCreditsOnFailure（幂等）
  await registerActiveJob({
    jobId,
    taskType: "deepResearch",
    userId: Number(userId),
    creditsBilled: creditsUsed,
    action: `上帝视角研报·${productType}（${creditsUsed}点）`,
    externalApiCostHint: "deep-research-max ~$5-15 USD/次",
    metadata: {
      topic,
      productType,
      dbRecordId,
      hasSupplementaryFiles: Boolean(supplementary?.supplementaryFiles?.length),
      hasIpProfile: Boolean(supplementary?.ipProfile),
    },
  }).catch((e: any) => {
    console.warn(`[deepResearch] registerActiveJob 失败（non-fatal）：${e?.message}`);
  });

  return { jobId, dbRecordId };
}

/**
 * 用户/管理员主动请求取消任务。立即在 job 文件 + paidJobLedger 都写下
 * cancelRequestedAt，worker 在下一次 polling / progress tick 时检测到即抛
 * USER_CANCELLED → 走 failJobAndRefund，按 refundReason 决定是否真的退积分。
 *
 * 商业护栏（防恶意刷算力）：
 *   * by="user"（用户主动点取消）→ 默认 refundReason="user_cancelled_no_refund"，
 *     hold 标 settled、creditsRefunded=0、**不**调 refundCredits（积分按规则不退还）。
 *   * by="admin" / "deploy" / "reaper"（系统故障、部署中断、reaper 兜底）→
 *     默认 refundReason="user_cancelled"（admin/reaper）/ "deploy_killed"（deploy），
 *     仍走幂等退积分流程。
 *   * 调用方可显式覆盖 refundReason 改变这一默认行为。
 *
 * 幂等：重复调用只写一次，再次调用直接返回 alreadyCancelled=true。
 */
export async function requestCancelDeepResearchJob(
  jobId: string,
  by: "user" | "admin" | "deploy" | "reaper" = "user",
  refundReason?: PaidJobRefundReason,
): Promise<{ ok: boolean; alreadyCancelled: boolean; status: string | null; refundReason: PaidJobRefundReason }> {
  const job = await readJob(jobId);
  // 默认 refundReason 推断：用户主动 → 不退；其他系统/管理员路径 → 退（保留幂等）
  const resolvedRefundReason: PaidJobRefundReason =
    refundReason ??
    (by === "deploy"
      ? "deploy_killed"
      : by === "user"
        ? "user_cancelled_no_refund"
        : "user_cancelled");
  if (!job) return { ok: false, alreadyCancelled: false, status: null, refundReason: resolvedRefundReason };
  // 已经终态，无需取消
  if (job.status === "completed" || job.status === "failed") {
    return { ok: true, alreadyCancelled: true, status: job.status, refundReason: resolvedRefundReason };
  }
  if (job.cancelRequestedAt) {
    // 已在 ledger 标过；尝试把 ledger 也补上（幂等）
    await ledgerRequestCancel(jobId, "deepResearch", by).catch(() => {});
    return { ok: true, alreadyCancelled: true, status: job.status, refundReason: job.cancelRefundReason ?? resolvedRefundReason };
  }
  const now = new Date().toISOString();
  // 主动取消时显示「不退还积分」的进度文案；其他路径仍说「退还积分」
  const progressMsg =
    resolvedRefundReason === "user_cancelled_no_refund"
      ? `🛑 收到取消请求（${by}），按规则不退还积分，正在停止深潛引擎…`
      : `🛑 收到取消请求（${by}），正在停止深潛引擎并退还积分…`;
  await writeJob({
    ...job,
    cancelRequestedAt: now,
    cancelRequestedBy: by,
    cancelRefundReason: resolvedRefundReason,
    progress: progressMsg,
  });
  if (job.dbRecordId) {
    try { await dbUpdateRecord(job.dbRecordId, job.status as any, progressMsg); } catch {}
  }
  await ledgerRequestCancel(jobId, "deepResearch", by).catch(() => {});
  console.log(
    `[deepResearch] 🛑 cancel requested jobId=${jobId} by=${by} status=${job.status} refundReason=${resolvedRefundReason}`,
  );
  return { ok: true, alreadyCancelled: false, status: job.status, refundReason: resolvedRefundReason };
}

/** 内部使用：在 worker 的关键路径上调，发现取消 → 抛 USER_CANCELLED。 */
async function checkCancelledOrThrow(jobId: string): Promise<void> {
  const job = await readJob(jobId);
  if (job?.cancelRequestedAt) {
    throw new Error("USER_CANCELLED");
  }
  // 兜底：ledger 上有取消标志但 job 文件还没写到（极端时序）
  if (await isCancelRequested(jobId, "deepResearch")) {
    throw new Error("USER_CANCELLED");
  }
}

/**
 * 用户批准计划后，接力跑「执行 + 报告合成」剩余阶段
 * - 把状态改回 running（让 watchdog 正确判断）+ 写入 planFeedback
 * - 重新调用 runDeepResearchAsync：内部判断已有 planInteractionId → 走 execute 路径
 */
export async function approvePlan(jobId: string, feedback?: string): Promise<void> {
  const job = await readJob(jobId);
  if (!job) throw new Error("任务不存在");
  if (job.status !== "awaiting_plan_approval") {
    throw new Error(`任务当前状态 ${job.status}，无法批准计划`);
  }
  if (!job.planInteractionId) {
    throw new Error("缺少计划数据，无法继续执行");
  }
  await writeJob({
    ...job,
    status: "running",
    planFeedback: feedback?.trim() || undefined,
    progress: "✅ 计划已批准，正在重新启动 Deep Research Max 进入深潛阶段…",
  } as any);
  // 解除 ledger 暂停：worker 即将重新接管，reaper 又可以正常监控
  await resumeActiveJob(jobId, "deepResearch").catch(() => {});
  // fire-and-forget；runDeepResearchAsync 内部会判断 planInteractionId 已存在 → 跳过 plan 阶段
  setImmediate(() => {
    runDeepResearchAsync(jobId).catch((e) =>
      console.error(`[approvePlan] runDeepResearchAsync 失败 jobId=${jobId}：`, e?.message),
    );
  });
}

/** 异步执行全景战报（fire-and-forget，不阻塞响应） */
export async function runDeepResearchAsync(jobId: string) {
  const job = await readJob(jobId);
  if (!job) return;

  // ── 安全闸：awaiting_plan_approval 状态下用户还没批准，worker 不应运行
  // （recoverOrphanedJobs 不会捞这个状态，但防御性兜底）
  if (job.status === "awaiting_plan_approval") {
    console.log(`[deepResearch] ⏸ jobId=${jobId} 处于 awaiting_plan_approval，跳过 worker 启动`);
    return;
  }
  // 已完成/已失败：不允许重复执行
  if (job.status === "completed" || job.status === "failed") return;

  // 注册 SIGTERM 钩子（幂等，仅首次有效）
  ensureShutdownHook();

  const taskStartMs = Date.now();

  // ── Heartbeat ticker：worker 在跑期间，每 30s 自动刷一次 lastHeartbeatAt。
  //    这样即使没有阶段更新，重启时也能区分「在跑但慢」和「进程已死」。
  const heartbeatTimer = setInterval(() => { void bumpHeartbeat(jobId); }, HEARTBEAT_TICK_MS);
  if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();

  // ── 存活检查哨（Watchdog）
  // 如果 heartbeat 静止超过 STALE 阈值（说明 worker 已死/卡死），
  // 立刻标 failed + 退积分，无需等到硬超时才发现。
  //
  // ⚠️ 关键修复（2026-04-29）：原本 15 分钟触发 + 3 分钟 stale 阈值，会误杀
  // 还在 Google 后台正常跑的 Plan/Execute 阶段（Plan 实测 10-30 分钟、复杂题
  // 可达 60 分钟）。现在改为 30 分钟才触发首次检查，且 stale 阈值放宽到
  // 8 分钟（对应 30s heartbeat ticker 的 16 倍间隔，足够覆盖 GC / I/O 阻塞），
  // 同时 planning 状态下 bumpHeartbeat 也会刷心跳，从根本上不会再误杀。
  const WATCHDOG_TRIGGER_MS = 30 * 60 * 1000;
  const WATCHDOG_STALE_THRESHOLD_MS = 8 * 60 * 1000;
  const watchdogTimer = setTimeout(async () => {
    try {
      const current = await readJob(jobId);
      if (!current) return;
      if (current.status === "completed" || current.status === "awaiting_review" || current.status === "awaiting_plan_approval" || current.status === "failed") return;
      const lastBeat = current.lastHeartbeatAt ? new Date(current.lastHeartbeatAt).getTime() : 0;
      const staleSec = Math.floor((Date.now() - lastBeat) / 1000);
      console.log(`[deepResearch] 🐕 Watchdog 30min 检查：jobId=${jobId} status=${current.status} heartbeat_stale=${staleSec}s`);
      if (lastBeat === 0 || (Date.now() - lastBeat) > WATCHDOG_STALE_THRESHOLD_MS) {
        console.warn(`[deepResearch] 🐕 Watchdog 判断任务疑似卡死（${staleSec}s 无心跳），标记 failed 并退积分`);
        await failJobAndRefund(current, "15分钟内无心跳，任务疑似卡死，已自动退积分", "⚠️ 深潜超时：15 分钟内未收到进度信号，积分已退还至您的账户");
      }
    } catch (e: any) {
      console.warn(`[deepResearch] 🐕 Watchdog 检查异常：${e?.message}`);
    }
  }, WATCHDOG_TRIGGER_MS);
  if (typeof watchdogTimer.unref === "function") watchdogTimer.unref();

  const stages = [
    "📡 突破信息茧房，全网检索行业论文与商业数据…",
    "📊 抓取四平台 Top 变现博主链路与爆款底层逻辑…",
    "🧠 构建底层商业思维链（CoT），推演差异化战略…",
    "✍️ 正在撰写万字商业白皮书，请稍候…",
  ];

  const updateProgress = async (progress: string, status: "running" | "planning" | "completed" | "failed" = "running") => {
    const latest = (await readJob(jobId)) ?? job;
    // ── 跨进程取消信号检查：如果用户/管理员发起了取消，立即抛错走 fail+refund ──
    if (latest.cancelRequestedAt && status !== "failed") {
      throw new Error("USER_CANCELLED");
    }
    await writeJob({ ...latest, status, progress, pid: process.pid });
    if (latest.dbRecordId) {
      await dbUpdateRecord(latest.dbRecordId, status, progress);
    }
  };

  /**
   * Plan / Execute 阶段的实时进度回调：每 15 秒被 pollInteraction 调一次。
   * 每 60 秒刷一次 job.progress，让前端能看到「已等候 N 分 / 通常 X-Y 分 / 上限 Z 分」，
   * 不会再让人误以为系统挂了。
   *
   * 该回调还承担**跨进程取消检测**：如果检测到 cancelRequestedAt，立即抛
   * USER_CANCELLED → pollInteraction 的 try/catch 会被冒泡到外层 worker 失败路径，
   * 走 paidJobLedger 幂等退积分。
   */
  const makeProgressTicker = (phase: "plan" | "execute") => {
    let lastWriteAt = 0;
    return async (elapsedSec: number, maxSec: number) => {
      // 每次 tick 都检查一次取消（仅文件 IO，廉价；最坏 ~15s 后用户能 kill 任务）
      // 注：Google Interactions API 一旦提交（background:true）就在 Google 侧异步跑，
      // 我们的 abort 只能停止本地轮询，无法真正退掉那次 Google 算力费。但用户的
      // 平台积分会立即被 paidJobLedger 幂等返还。
      const latest = await readJob(jobId);
      if (latest?.cancelRequestedAt) {
        throw new Error("USER_CANCELLED");
      }
      const now = Date.now();
      if (now - lastWriteAt < 60_000) return; // 每 60s 刷一次足够
      lastWriteAt = now;
      const elapsedMin = Math.max(1, Math.round(elapsedSec / 60));
      const maxMin = Math.round(maxSec / 60);
      const msg = phase === "plan"
        ? `📋 Plan 推演中：已等候 ${elapsedMin} 分钟（通常 10-30 分钟，上限 ${maxMin} 分钟）…`
        : `🔬 Deep Research 深潛中：已运行 ${elapsedMin} 分钟（通常 30-50 分钟，上限 ${maxMin} 分钟）…`;
      await updateProgress(msg, phase === "plan" ? "planning" : "running");
    };
  };

  try {
    await updateProgress(stages[0]);

    const productType = job.productType ?? "magazine_single";
    const dateStr = formatPublicationDateZhAsia();

    // ── 用户全息基线（个人亮点提取的真实数据基础） ──────────────────────────
    const holistic = await getUserHolisticContext(job.userId);
    const userBaseline = `
【用户当下数据库基线 · 真实账户行为，禁止脱离这些数据空想】
- 累计创作记录数：${holistic.totalCreations} 条
- 创作类型分布：${Object.entries(holistic.byType).map(([k, v]) => `${k}=${v}条`).join("，") || "暂无"}
- 累计积分投入：${holistic.totalCreditsSpent} 点（反映用户对哪些方向最重视）
- 近期研究课题（最多 8 条，按时间倒序）：${holistic.recentTopics.length ? holistic.recentTopics.map((t, i) => `\n  ${i + 1}. ${t}`).join("") : "（用户首次发起，无历史）"}
- 历史竞品调研快照：${holistic.competitorSnapshots.length ? holistic.competitorSnapshots.map((s) => `\n  · [${s.date}|${s.platform}] ${s.positioning}`).join("") : "（用户首次调研竞品）"}
`.trim();

    // ── 個性化分析：抓取歷史戰報做縱向對比 ──────────────────────────────────
    let historyContext = "此用户尚无历史分析记录，本次将作为基线快照建立。";
    if (productType === "personalized") {
      const snapshots = await getUserReportSnapshots(job.userId);
      if (snapshots.length > 0) {
        historyContext = snapshots
          .map((s, i) => `[第${i + 1}次 · ${s.date}]\n  课题：${s.title}\n  摘要：${s.summary.slice(0, 240)}`)
          .join("\n\n");
      }
    }

    const LANG_RULES = `
【语言强制规范 · 违规即不合格】
1. 全文 100% 简体中文，禁止出现任何英文术语；如必须引用，括号内附简体中文解释，如「关键绩效指标（KPI）」必须改写为「核心达成指标」
2. 不得使用以下英文/拼音词：AIDA、SWOT、KPI、CRM、SOP、ROI、CAC、LTV、CPC、CPM、ARPU、UGC、PGC、PMF、Phygital、FOMO、Aha Moment、Lead Magnet、Hook、Punchline、Pain Point、Niche、Persona、Slogan
   · AIDA → 注意力—兴趣—欲望—行动 四步漏斗
   · SWOT → 优劣势—机会威胁 矩阵
   · KPI → 核心达成指标
   · CAC → 单粉获取成本
   · LTV → 用户终身价值
   · CPM → 千次曝光成本
   · ROI → 投入产出比
   · FOMO → 错失焦虑
   · Hook → 钩子
   · Slogan → 品牌口号
   · Persona → 人物画像
3. 平台名一律使用：小红书 / 抖音 / 哔哩哔哩 / 快手 / 视频号 / 公众号 / 微信私域，不得简写为 B站、Xhs、Dy 等
4. 数字一律使用阿拉伯数字 + 中文单位（如 1500 万、12.5%、3.2 亿）
`;

    const DATA_TABLE_RULES = `
【数据与图表强制规范 · 高级商务白皮书标准】
1. 每个章节必须包含至少 1 个完整的 Markdown 表格，表头与首列粗体，数值列不得留空
2. 平台对比必须覆盖：小红书 / 抖音 / 哔哩哔哩 / 快手 四平台，每平台至少 5 项指标
3. 所有数据必须标注参考时间区间（例：2025 年第 1 季度、2024 全年、2026 年第 1 季度截至当月）
4. 核心指标必须给出具体数字，禁止使用「较高」「较低」「显著」「相当」「不少」等模糊表述
5. 每章结尾以「📊 数据速查」小节用一个三列表格汇总本章关键数字（指标 / 数值 / 数据来源）
6. 关键论断必须以「根据 XX 平台 2025Q1 数据：……」「以 XX 头部账号近 30 天为例：……」的句式呈现，杜绝凭空判断
7. 重点结论用「**……**」加粗（前端会自动高亮为咖啡金色），全文重点加粗段落不少于 12 处
`;

    const PERSONA_HIGHLIGHT_RULES = `
【个人亮点提取 · 必须基于用户真实数据】
- 必须从「用户当下数据库基线」中找出 5 条独属于此用户的差异化亮点，每条配 1 个具体数据证据（例：「累计在小红书赛道发起 4 次研究，远高于抖音 1 次，说明用户对图文社区的下沉度强于短视频」）
- 不得给出「您很努力」「您很有潜力」这种空话
- 必须提炼 1 个用户专属「定位锚点」——能用一句话总结此用户区别于市场的最强不可替代性
`;

    // ── 半月刊专属：四平台 7 天趋势图（Gemini 生成数据 → SVG 折线图）─────────
    let trendChartBlock = "";
    if (productType !== "personalized") {
      try {
        const trendJson = await generate(
          "gemini-2.0-flash-exp",
          `你是一个社交媒体数据分析师。请根据课题「${job.topic}」，模拟该细分赛道在小红书、抖音、B站、快手四平台过去 7 天的相对热度趋势指数（0-100，100为最热）。
今天日期：${new Date().toLocaleDateString("zh-CN")}
请直接输出 JSON，格式如下（不要任何其他文字）：
{
  "dates": ["Day1日期(M/D)", "Day2", "Day3", "Day4", "Day5", "Day6", "Day7(今天)"],
  "xiaohongshu": [整数,整数,整数,整数,整数,整数,整数],
  "douyin":      [整数,整数,整数,整数,整数,整数,整数],
  "bilibili":    [整数,整数,整数,整数,整数,整数,整数],
  "kuaishou":    [整数,整数,整数,整数,整数,整数,整数]
}`,
        );
        const cleaned = trendJson.replace(/```json|```/g, "").trim();
        const td = JSON.parse(cleaned) as {
          dates: string[];
          xiaohongshu: number[];
          douyin: number[];
          bilibili: number[];
          kuaishou: number[];
        };
        trendChartBlock = buildTrendSvg(td, job.topic);
      } catch {
        console.warn("[deepResearch] 趋势图生成失败，跳过");
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 阶段 A：Deep Research Pro Preview · 全网检索 + 深度推理 + 思维链
    // 模型：gemini-deep-research-pro-preview（2026 战略智库大脑，63s 滑窗 30 次建链限速）
    // 工具：googleSearch（实时检索）+ deepResearch{complexity: "comprehensive"}（最深推理）
    // 配置：thinkingConfig.includeThoughts=true（开启思维链）
    // ═════════════════════════════════════════════════════════════════════════
    await updateProgress(stages[1]);

    let harvestPrompt = `你是一位顶级行业数据研究员，正在为一份高级商务白皮书做基础数据搜集。

【研究课题】
${job.topic}

【任务】
基于 Google 搜索接地，针对以下 12 个具体问题，给出尽可能精确的数字与来源（覆盖近 2 年，特别是 2024、2025 与 2026 年第 1 季度）。每个回答必须包含：
- 具体数字（不要写"较高""较多"）
- 来源平台/媒体/报告名
- 时间区间标注

请逐条作答，每条 80-160 字：

1. 课题所在赛道在中国大陆的总市场规模（2023、2024、2025E、2026F）以及年复合增长率
2. 课题所在赛道在小红书、抖音、哔哩哔哩、快手、视频号 5 个平台的活跃创作者数与月度内容量级
3. 头部账号（粉丝 100 万以上）的典型月度收入区间，及其收入构成（广告、自营、知识付费、直播、商单的占比）
4. 该赛道用户画像：核心年龄段、性别比、城市层级、月均可支配收入、消费决策周期
5. 近 2 年该赛道前 3 个最具影响力的爆款案例：账号名、爆款内容形式、单条最高数据、关键时间点
6. 平台算法层面的最新变化（2025 年下半年至 2026 年第 1 季度）：限流规则、流量倾斜、商单审核
7. 该赛道在小红书的笔记互动率、抖音的完播率、哔哩哔哩的三连率行业均值与头部均值
8. 该赛道私域留存指标：单粉获取成本、私域转化率、首购客单价、年度复购率
9. 商业化链路全景：品牌方与创作者的合作模式（坑位费 / 佣金 / 联名 / 品牌自播）当前市场价格带、谈判惯例、2025-2026 年新兴合作形式及典型案例
10. 已经在该赛道折戟的失败案例至少 3 个：失败原因、损失规模、可借鉴的教训
11. 国际同类赛道对标（北美 / 日韩 / 东南亚）：营收量级、IP 授权 / 衍生品 / 跨境变现的典型路径与收益数据
12. 监管与政策风险：近 2 年相关法规变化、合规红线、灰色地带
13. AI 内容工具对该赛道的实际冲击（2025-2026）：即梦 / 可灵 / 剪映 AI 等工具对创作门槛、内容量级、平台流量分发的影响数据；AI 创作者与纯人工创作者的算法待遇差异与平台政策
14. IP 化路径与版权资产：头部账号从内容账号升级为 IP 资产的关键节点、版权化 / 衍生品化 / 跨媒介授权的典型案例与收益量级，以及当前该赛道 IP 授权市场的估值逻辑

【格式】
请输出严格的简体中文，每条以「【数据点 N】」开头。不要任何 Markdown 装饰。`;

    // ── 注入用户补充文字说明（文件直接以 multimodal 形式传给 Agent，无需预处理）
    if (job.supplementaryText) {
      harvestPrompt += `\n\n【⭐ 用户补充文字说明 · 请在研究时重点参考，优先结合这些内容展开分析】\n${job.supplementaryText}`;
    }
    const suppFiles = (job.supplementaryFiles ?? []).map(f => ({
      type: f.type,
      url: f.url,
      mimeType: f.mimeType,
      name: f.name,
    }));
    if (suppFiles.length) {
      harvestPrompt += `\n\n【⭐ 用户上传了 ${suppFiles.length} 个补充文件（图片/文档），Agent 将直接读取其内容，请优先结合这些文件展开分析】`;
      await updateProgress(`📎 已附加 ${suppFiles.length} 个补充文件，正在启动 Deep Research Max…`);
    }

    // ── Interactions API 三阶段：根据 job.status 决定走哪条路径 ────────────────
    let harvested: GroundedResult;
    const jobNow = (await readJob(jobId)) ?? job;
    const needPlan = !jobNow.planInteractionId;          // 没 planId → 走 plan 阶段
    const needExecute = !jobNow.harvestedText;           // 没接地数据 → 需要 execute

    if (needPlan) {
      // ── Phase A1：请求计划（Collaborative Planning） ────────────────────────
      await updateProgress("📋 正在生成研究计划，等待您审核…", "planning");
      await writeJob({ ...jobNow, status: "planning" } as any);
      const { planText, planInteractionId } = await requestResearchPlan(
        harvestPrompt,
        suppFiles.length ? suppFiles : undefined,
        async (planId) => {
          const latest = (await readJob(jobId)) ?? job;
          await writeJob({ ...latest, interactionId: planId, planInteractionId: planId, status: "planning" } as any);
        },
        makeProgressTicker("plan"),
      );
      const latest = (await readJob(jobId)) ?? job;
      await writeJob({
        ...latest,
        status: "awaiting_plan_approval",
        planText,
        planInteractionId,
        progress: "📋 研究计划已生成，请前往「上帝视角」审核计划并批准开始深潛",
      } as any);
      // 暂停 ledger hold：让 reaper 不要因为心跳停滞而误退分（worker 已退出，等用户决策）
      await pauseActiveJob(jobId, "deepResearch").catch(() => {});
      console.log(`[deepResearch] ⏸ 等待用户审核计划（jobId=${jobId}, planLen=${planText.length}）`);
      return; // worker 退出，等 approvePlan mutation 触发重新调用
    }

    if (needExecute) {
      // ── Phase A2：用户已批准，执行深潛（previous_interaction_id + collaborative_planning=false） ──
      await updateProgress("🚀 正在启动 Deep Research Max 深潛（最长 60 分钟）…");
      await writeJob({ ...jobNow, status: "running" } as any);
      harvested = await executeApprovedResearch(
        jobNow.planInteractionId!,
        jobNow.planFeedback,
        async (executeId) => {
          const latest = (await readJob(jobId)) ?? job;
          await writeJob({ ...latest, interactionId: executeId } as any);
        },
        jobNow.executeOverrideInput,
        makeProgressTicker("execute"),
      );
      // 持久化接地数据，便于断线恢复时跳过执行
      const afterExec = (await readJob(jobId)) ?? job;
      await writeJob({ ...afterExec, harvestedText: harvested.text } as any);
    } else {
      // 已有缓存的接地数据（断线恢复场景），直接进入 Phase B
      harvested = { text: jobNow.harvestedText!, sources: [] };
      console.log(`[deepResearch] ♻️ 复用已缓存的接地数据 ${harvested.text.length}字`);
    }
    console.log(`[deepResearch] 🎯 PID=${process.pid} Deep Research 完成：${harvested.text.length}字正文 / ${harvested.sources.length}个接地来源`);

    // ═════════════════════════════════════════════════════════════════════════
    // 阶段 B：合成 · Gemini 3.1 Pro Preview 深度报告
    // ═════════════════════════════════════════════════════════════════════════
    await updateProgress(stages[2]);

    // 个性化签名：把课题哈希 + 用户基线 + 当下时间组成"千人千面"种子，强迫每份报告差异化
    const personalSeed = `${job.userId}|${job.topic}|${holistic.totalCreations}|${dateStr}`;

    const FRAMEWORKS = `
【强制使用 6 套以上分析框架 · 杜绝单一 SWOT】
1. 优劣势机会威胁矩阵（SWOT 的中文化版本：内部优势 / 内部劣势 / 外部机会 / 外部威胁，并交叉给出 SO/WO/ST/WT 四套战略）
2. 五力模型（迈克尔·波特：现有竞争 / 潜在进入者 / 替代品 / 供方议价 / 买方议价）
3. 政治经济社会技术分析（PEST 的中文化：政策法规 / 经济环境 / 社会文化 / 技术演进）
4. SMART 目标拆解法（具体 / 可衡量 / 可达成 / 相关性 / 时限性）—— 用于 90 天目标
5. 用户增长漏斗（获取—激活—留存—收入—推荐 五段）
6. 波士顿矩阵（明星 / 现金牛 / 问题 / 瘦狗）—— 用于产品矩阵分类
7. 麦肯锡七要素（战略 / 结构 / 系统 / 共同价值观 / 风格 / 员工 / 技能）—— 可选用于组织能力诊断
8. 蓝海战略画布（消除 / 减少 / 增加 / 创造 四象限）—— 用于差异化破局
9. 第一性原理拆解 —— 用于商业变现路径推演
10. 决策树（条件 → 分支 → 终点）—— 用于关键战术分叉点
全文至少使用其中 6 套以上，禁止全部用 SWOT 一种。`;

    const CHART_RULES = `
【可视化与表格强制规范 · 不得低于 5 张】
全文必须包含至少：
- 6 张完整 Markdown 表格（前端会自动把数值列衍生成柱状图 / 折线图 / 雷达图）
- 1 张时间序列表（年/季度推演）→ 自动出折线图
- 1 张多维能力评分表（6 维以上）→ 自动出雷达图
- 1 张分项对比表（4 个平台或 4 个产品）→ 自动出柱状图
- 每张表必须有真实数据（来自下方接地数据）和「数据来源」列
- 表格之间用文字小结串联，不要堆叠表格
注意：所有数值必须直接源自「外部接地数据」或「用户基线」，禁止凭空捏造。`;

    // 企业 IP 基因（B 端拦截弹窗收集）注入到 [全局战略预设] 段
    // 让推演 80% 篇幅锁定高客单转化路径、合规与定价战略，避免变成大众视角的"小生意建议"
    const ipProfile = job.ipProfile;
    const STRATEGIC_IP_PRESET = ipProfile
      ? `
【全局战略预设 · 企业 IP 基因】
企业身份：${ipProfile.industry} | 核心优势：${ipProfile.advantage}
目标受众：${ipProfile.audience}${ipProfile.taboos ? ` | 品牌禁忌：${ipProfile.taboos}` : ""}
核心转化锚点：${ipProfile.flagship}

【战略纪律】
请基于上述基因重构大众热点。80% 篇幅必须聚焦于高客单转化路径、合规与定价战略；
所有举例、产品矩阵、漏斗设计都要围绕「${ipProfile.flagship}」这一旗舰交付反向倒推；
${ipProfile.taboos ? `严禁触碰品牌禁忌：${ipProfile.taboos}；` : ""}避免将分析降维到大众化、价格战、流量采买等低端打法。
`.trim()
      : "";

    const sharedSetup = `
${LANG_RULES}
${DATA_TABLE_RULES}
${FRAMEWORKS}
${CHART_RULES}
${PERSONA_HIGHLIGHT_RULES}

${STRATEGIC_IP_PRESET}

【千人千面定制化保证】
个性化种子：${personalSeed}
此种子保证不同用户/课题/时间得到的内容完全不一样。请把以下信息揉合进分析的视角与举例：
${userBaseline}

【外部接地数据（来自 Google 搜索 · 近 2 年真实信息）】
${harvested.text}

${harvested.sources.length > 0 ? "【参考来源】\n" + harvested.sources.slice(0, 25).map((s, i) => `${i + 1}. ${s.title} — ${s.url}`).join("\n") : ""}
`.trim();

    // 半月刊（magazine_single / magazine_sub）的「精简版长度规范」——跟个性化版同标准，但字数与表格减半
    const HALF_LENGTH_RULES = `
【半月刊精简版字数规范 · 强制执行】
- 全文字数严格控制在 5500-7000 字（个性化版的一半）
- 表格数量 5-6 张（个性化版的一半）
- 每章正文字数 400-700 字（个性化版要求 800-1200 字）
- 每章末尾「执行风险提醒」段落字数压缩到 40-60 字（个性化版 80 字）
- 框架使用：仍要至少使用 4 套不同分析框架（个性化版 6 套），不得仅用一种
- 表格强制覆盖：能力雷达 / 平台对比 / 产品矩阵 / 五段漏斗 / 30 天行动计划 五张核心表
`;

    const prompt = productType === "personalized"
      ? `你是国际顶尖商学院战略顾问 + 顶尖商业战略顾问 + 国内外主流媒体平台资深运营专家 + 顶级 IP 操盘手组成的「全息个性化智库」。请输出一份字数不少于 12000 字、表格不少于 8 张的高端商务白皮书。

${sharedSetup}

【本次分析课题】
${job.topic}

【用户历次战报对比基线】
${historyContext}

【输出结构要求 · 必须严格遵守章节顺序与名称】

# 一、个人亮点提取（基于您真实账户行为的 X 光）
- 用 5 段加粗洞察 + 1 个「定位锚点一句话」总结此用户区别于市场的差异化身份
- 配 1 张「能力雷达表」（6 维：内容生产 / 选题判断 / 用户洞察 / 商业敏感 / 私域转化 / 跨界协同），分别给出用户分（来自基线）与行业头部均值
- 末尾以「📊 数据速查」表格汇总：累计创作数、累计积分投入、最强项、最弱项、专属定位锚点

# 二、平台赛道全景（千人千面的赛道地图）
- 必须覆盖小红书 / 抖音 / 哔哩哔哩 / 快手 / 视频号 5 个平台
- 配 1 张「平台对比表」（月活、算法侧重、最佳内容形式、最佳发布时段、客单价区间、本人适配度评分）
- 配 1 张「赛道趋势表」（2024 / 2025 / 2026 三年的市场规模、复合增长率、关键驱动事件）
- 配 1 张「波士顿矩阵分类」（把候选赛道分成明星 / 现金牛 / 问题 / 瘦狗）
- 用「五力模型」拆解最推荐赛道的竞争格局
- 末尾「📊 数据速查」三列表

# 三、产品矩阵设计（高客单价金字塔）
- 必须给出引流品 → 主力品 → 高端旗舰三层产品的具体形态、定价区间、毛利率、目标用户
- 配 1 张「产品矩阵表」（产品名 / 形态 / 价格 / 周期 / 毛利率 / 目标用户 / 转化期望）
- 配 1 张「定价对标表」（与赛道竞品均价对比，给出溢价空间和理由）
- 用「蓝海战略画布」给出消除 / 减少 / 增加 / 创造 四象限改动建议

# 四、商业成长与变现路径（投入产出比最大化）
- 必须用「获取—激活—留存—收入—推荐」五段漏斗，给出每段当下转化率、行业头部值、优化杠杆
- 配 1 张「五段漏斗表」（阶段 / 现状 / 行业头部 / 90 天目标 / 杠杆动作）
- 配 1 张「分阶段变现路线图」（冷启动 / 成长 / 加速 / 成熟，每段配预计周期、主要收入、月收入预估）
- 末尾「📊 数据速查」（月销售额目标 / 单粉获取成本 / 用户终身价值 / 投入产出比）

# 五、生涯规划（5 年战略弓与箭）
- 必须用「SMART 目标拆解」给出 1 年、3 年、5 年三个里程碑
- 配 1 张「生涯规划表」（时间 / 角色定位 / 关键能力跃迁 / 资产规模 / 风险防御）
- 给出 3 条「弯道超车机会窗口」与对应的具体动作
- 给出 3 条「必须立刻放弃的旧思维」并解释替代方案

# 六、历史战略复盘（与你过去战报的纵向对比）
- 配 1 张「历史 vs 当下对比表」（维度 / 历史策略 / 当前市场 / 变化幅度 / 建议动作）
- 用「第一性原理」分析为什么旧打法已经失效
- 至少给出 3 条「需立即下线的旧动作」

# 七、十大战术里程碑（16 周可执行路线图）
- 配 1 张「10 大战术里程碑表」（编号 / 战术目标 / 完成时限 / 所需资源 / 预期量化效果 / 成功判断标准）
- 用「决策树」描绘第 8 周和第 12 周的关键分叉点

# 八、核武级总结（必须铭刻于心的三大真相）
- 给出 3 条由数据驱动的核心洞察，每条附 1 个具体数据点
- 给出一句话品牌口号（中文 16 字内）
- 给出 90 天里程碑表（粉丝数 / 私域用户 / 变现金额 / 内容资产 / 商业验证）

要求：每个数字必须直接源自上方「外部接地数据」或「用户基线」。语言克制专业，避免任何空话与煽动。每个章节末尾必须有一段不少于 80 字的「执行风险提醒」。`
      : `你是国际顶尖商学院战略顾问 + 国内外主流媒体平台资深运营专家 + 顶级 IP 操盘手 + 行业数据分析师组成的「商业智库团队」。请输出一份字数严格控制在 5500-7000 字、表格 5-6 张的精简版商务白皮书《${dateStr} 战略半月刊》。

${sharedSetup}

${HALF_LENGTH_RULES}

【研究课题】
${job.topic}

【输出结构要求 · 七章精简版，章节内必须包含五大必选模块（个人亮点 / 平台赛道 / 产品矩阵 / 商业变现 / 生涯规划）】

# 一、行业全景扫描（宏观趋势 + 监管变化）
- 配 1 张「市场规模与增速表」（2024/2025E/2026F 三列：规模、增速、关键驱动事件）
- 用「政治经济社会技术分析」200 字内拆解外部环境
- 用「五力模型」150 字内诊断竞争格局
- 末尾「📊 数据速查」三列表

# 二、个人亮点提取 + 平台赛道全景（合并章节 · 千人千面的差异化身份与赛道地图）
- 必须利用上方「用户当下数据库基线」给出 3 条加粗洞察 + 一句话「定位锚点」
- 配 1 张「能力雷达表」（6 维评分 vs 行业头部）
- 配 1 张「五平台对比表」（小红书 / 抖音 / 哔哩哔哩 / 快手 / 视频号 五行：月活、算法侧重、最佳内容形式、最佳发布时段、本人适配度评分、推荐顺位）
- 用「波士顿矩阵」一段话把候选赛道分类（明星 / 现金牛 / 问题 / 瘦狗）

# 三、用户心理图谱（高转化底层逻辑）
- 简短描述目标人群：年龄段、月均可支配收入、决策周期、核心欲望
- 配 1 张「消费决策触发器表」（触发因子 / 权重 / 激活方式 / 典型钩子文案，4 行）

# 四、头部玩家拆解（爆款公式与变现链路）
- 配 1 张「头部账号变现模式解剖表」（超头部 / 腰部 / 新锐 三档：粉丝规模、月均收入、收入构成、爆款公式）
- 给出 2 个真实头部账号的具体爆款案例（来自上方接地数据）

# 五、产品矩阵设计 + 商业变现路径（合并章节）
- 配 1 张「产品矩阵 + 五段漏斗融合表」（引流品 / 主力品 / 高端旗舰 三行 × 价格 / 客群 / 五段漏斗目标转化率 六列）
- 用「蓝海战略画布」150 字内给出消除 / 减少 / 增加 / 创造 四象限改动
- 末尾「📊 数据速查」（月销售额目标 / 单粉获取成本 / 用户终身价值 / 投入产出比）

# 六、生涯规划 + 30 天冲刺行动手册（合并章节）
- 用「SMART 目标拆解」给出 1 年、3 年里程碑（每条 50 字内）
- 配 1 张「30 天周计划表」（第 1-7 / 8-14 / 15-21 / 22-30 天，每段：核心主题、每日必做动作、阶段达成指标、成功判断标准）

# 七、核武级总结
- 3 条由数据驱动的核心洞察 + 一句话品牌口号 + 90 天三大里程碑（粉丝 / 私域 / 变现金额）

要求：
1. 总字数严格控制在 5500-7000 字之间，**超过 7500 字视为不合格**
2. 每个数字直接源自上方「外部接地数据」或「用户基线」
3. 每章末尾 40-60 字的「执行风险提醒」（半月刊的精简版要求，比尊享版短一半）
4. 五大必选模块（个人亮点 / 平台赛道 / 产品矩阵 / 商业变现 / 生涯规划）必须全部覆盖，不得遗漏其中任何一个`;

    const promptForSynthesis = `${prompt}\n\n${PDF_FORMATTING_PROMPT_SUFFIX}`;
    // 合成参数（B 端 V3 锁定）：
    //   - temperature 0.7：策略生成的逻辑严谨与创意平衡
    //   - topP 0.95 + topK 40：保留长尾候选词，避免输出过于刻板
    //   - maxTokens 8192：保证万字长报告输出完整不被截断
    const rawReportMarkdown = await generate(
      "gemini-3.1-pro-preview",
      promptForSynthesis,
      2,
      { temperature: 0.7, topP: 0.95, topK: 40, maxTokens: 8192 },
    );

    if (!rawReportMarkdown || rawReportMarkdown.length < 1500) {
      throw new Error("战报内容过短，可能生成失败");
    }

    let reportMarkdown = sanitizeMarkdown(rawReportMarkdown);

    await updateProgress(stages[3]);

    // ── 后处理：灯塔标题 + 封面图 + 场景配图 + 摘要 + 耗时 ────────────────

    // 0. 自动场景配图（≥ 5 张，覆盖 4 类）— **Vertex** `imagen-4.0-ultra-generate-001` **2K**（`imagenBackend=vertex`）
    //    用户决策（2026-05-01）：报告太空泛、纯文字没温度，配图升到 5-7 张，必须覆盖：
    //      ① 应用场景  ② 目标人物 / 个人形象  ③ 产品特色  ④ 数据 / 行业生态
    //    实现：用 LLM 抽 5-7 个画面（强制 4 类全覆盖），串行生图（500ms 间隔），按章节锚点注入正文
    try {
      const sceneImages = await generateSceneIllustrations({
        topic: job.topic,
        reportMarkdown,
        vercelBaseUrl: String(process.env.VERCEL_APP_URL || "https://mvstudiopro.vercel.app").replace(/\/$/, ""),
      });
      if (sceneImages.length > 0) {
        reportMarkdown = injectSceneImagesIntoMarkdown(reportMarkdown, sceneImages);
        const catBreakdown = sceneImages.reduce<Record<string, number>>((acc, s) => {
          const k = s.category || "uncategorized";
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {});
        console.log(
          `[deepResearch] 已注入 ${sceneImages.length} 张场景配图（Vertex Imagen Ultra 2K）·  类别: ${JSON.stringify(catBreakdown)}`,
        );
      }
    } catch (e: any) {
      // 配图失败不阻断主流程
      console.warn("[deepResearch] 场景配图生成失败（不阻断）：", e?.message);
    }

    // 1. 灯塔标题（Gemini Flash 快速生成）
    let lighthouseTitle = job.topic;
    try {
      const titleText = await generate(
        "gemini-3.1-pro-preview",
        `针对课题《${job.topic}》，生成一个哈佛商业评论风格的灯塔标题（不超过 20 字，不含引号和标点符号以外的特殊字符）。仅输出标题本身。`,
      );
      if (titleText.trim().length > 0) lighthouseTitle = titleText.trim().slice(0, 40);
    } catch {
      console.warn("[deepResearch] 灯塔标题生成失败，使用原课题");
    }

    // 2. 封面图：**仅 Vertex** — Nano Banana Pro（`gemini-3-pro-image-preview` / env 覆写）9:16 **4K**，3 次串行重试；单次 120s。
    //    （不再走 Consumer `GEMINI_API_KEY` 雙軌。）
    const coverPromptBase =
      `Luxury dark-gold business magazine cover, cinematic editorial photography, dramatic lighting, sophisticated typography overlay, 9:16 vertical portrait format. Topic: ${lighthouseTitle}`;
    const coverPrompt = appendMagazineCoverDateInstructions(coverPromptBase);
    const coverPromise: Promise<string | undefined> = (async () => {
      let cover: string | undefined;
      const vercelBaseUrl = String(process.env.VERCEL_APP_URL || "https://mvstudiopro.vercel.app").replace(/\/$/, "");

      for (let i = 1; i <= 3 && !cover; i++) {
        try {
          cover = await fetchStrategicVertexImageViaGateway({
            vercelBaseUrl,
            prompt: coverPrompt,
            aspectRatio: "9:16",
            kind: "cover_pro_4k",
            timeoutMs: 120_000,
          });
          console.log(
            `[deepResearch][async-cover] ✅ Vertex Nano Banana Pro 4K（${VERTEX_STRATEGIC_COVER_IMAGE_MODEL}），第 ${i}/3 次 jobId=${jobId}`,
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[deepResearch][async-cover] ⚠️ Vertex 第 ${i}/3 次失败：${msg} jobId=${jobId}`);
          if (i < 3) await sleep(2000);
        }
      }

      if (!cover) {
        console.warn(`[deepResearch][async-cover] 3 次全失败 jobId=${jobId}，thumbnailUrl=NULL（可后续手工 backfill）`);
      }
      return cover;
    })();
    // 不 await！主流程立即继续 — 报告先 ready，封面后台慢慢出。

    // 3. 报告头部 banner（封面卡 + 个性化签名） + 趋势图 + 报告正文 + 思维链 + 来源
    const reportHeader = `# ${lighthouseTitle}\n\n> 📅 出品日期：${dateStr} · 个性化种子：\`${personalSeed.slice(0, 32)}…\`\n> 🔍 数据来源：Google 搜索接地（近 2 年） + 您的账户基线 ${holistic.totalCreations} 条创作记录\n> 🧠 推演引擎：Gemini Deep Research Pro Preview · 全网检索 + 思维链推理 + 综合最深层级\n\n---\n\n`;

    // 思维链折叠区块（放在报告末尾，PDF 中也会被渲染成可读区块）
    const thoughtsBlock = harvested.thoughts && harvested.thoughts.length > 200
      ? `\n\n---\n\n# 附录：AI 战略推演过程（思维链）\n\n> 以下是 Deep Research Pro Preview 在生成本份白皮书时的推演路径，提升智库透明度。\n\n${harvested.thoughts.split("\n").map((l) => l.trim() ? "> " + l : ">").join("\n")}\n`
      : "";

    const sourcesFooter = harvested.sources.length > 0
      ? `\n\n---\n\n# 附录：参考来源（来自 Google 搜索接地）\n\n${harvested.sources.slice(0, 30).map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join("\n")}\n`
      : "";

    const finalReportMarkdown = reportHeader + (trendChartBlock || "") + reportMarkdown + thoughtsBlock + sourcesFooter;

    // 4. 摘要（取正文开头 200 字，去除 Markdown 符号）
    const summary = reportMarkdown.replace(/#{1,6}\s/g, "").replace(/[*`>_\-|]/g, "").trim().slice(0, 200) + "…";

    // 5. 耗时（分钟）
    const duration = ((Date.now() - taskStartMs) / 1000 / 60).toFixed(1);

    // ── 生成完成：直接 completed，无需人工审核 ──────────────────────────────────
    const latest = (await readJob(jobId)) ?? job;
    const doneMsg = "✅ 战略研报已生成，请进入「战略作品快照库」查阅";
    await writeJob({
      ...latest,
      status: "completed",
      progress: doneMsg,
      reportMarkdown: finalReportMarkdown,
      draftMarkdown: finalReportMarkdown,
      completedAt: new Date().toISOString(),
    } as any);

    // ── 写 Neon DB（status: completed，reportMarkdown 直接写入可查阅）
    if (latest.dbRecordId) {
      try {
        const { db, userCreations } = await getDbAndSchema();
        if (db) {
          const { eq } = await import("drizzle-orm");
          const metaPayload: Record<string, unknown> = {
            topic: job.topic,
            jobId,
            productType,
            progress: doneMsg,
            reportMarkdown: finalReportMarkdown,
            draftMarkdown: finalReportMarkdown,
            lighthouseTitle,
            summary,
            duration,
          };
          const setPayload: Record<string, unknown> = {
            status: "completed",
            title: lighthouseTitle.slice(0, 120),
            metadata: JSON.stringify(metaPayload),
            updatedAt: new Date(),
          };
          // ⚠️ thumbnailUrl 不在主写入里设 — 让 coverPromise 异步完成后再 fire-and-forget UPDATE
          await db.update(userCreations).set(setPayload).where(eq(userCreations.id, latest.dbRecordId));
        }
      } catch (e: any) {
        console.warn("[deepResearch] DB 写入完成状态失败:", e?.message);
      }
    }

    // ── 异步封面回写：等 coverPromise resolve 后单独 UPDATE thumbnailUrl ────────
    //    不阻塞主流程返回。最坏约 3×120s 后 thumbnailUrl 才落地，前端展示时 NULL → 占位图。
    if (latest.dbRecordId) {
      const recordId = latest.dbRecordId;
      void coverPromise.then(async (resolvedCoverUrl) => {
        if (!resolvedCoverUrl) return; // 3 次全败，保持 NULL
        try {
          const { db, userCreations } = await getDbAndSchema();
          if (!db) return;
          const { eq } = await import("drizzle-orm");
          await db
            .update(userCreations)
            .set({ thumbnailUrl: resolvedCoverUrl, updatedAt: new Date() })
            .where(eq(userCreations.id, recordId));
          console.log(`[deepResearch][async-cover] ✅ thumbnailUrl 已回填 dbRecordId=${recordId} jobId=${jobId}`);
        } catch (e: any) {
          console.warn(`[deepResearch][async-cover] thumbnailUrl 回填失败 dbRecordId=${recordId}: ${e?.message}`);
        }
      }).catch((e: any) => {
        console.warn(`[deepResearch][async-cover] coverPromise 抛错 jobId=${jobId}: ${e?.message}`);
      });
    }

    console.log(`[deepResearch] ✅ 研报 ${jobId} 已完成，字符数: ${reportMarkdown.length}，耗时 ${duration} min（封面后台异步生成中）`);

    // ── 任务正常完成，结清 paidJobLedger 上的 hold（标 status=settled） ────────
    //   不退积分（settled ≠ refunded），仅让 reaper / pre-deploy-guard 不再扫到
    await unregisterActiveJob(jobId, "deepResearch", "settled").catch((e: any) => {
      console.warn(`[deepResearch] unregisterActiveJob 失败（non-fatal）：${e?.message}`);
    });

    // ── 半月刊：记录最后生成时间，触发 10 天提醒计时 ─────────────────────────
    if (productType === "magazine_single" || productType === "magazine_sub") {
      try {
        const { recordMagazineGenerated } = await import("./magazineScheduler");
        await recordMagazineGenerated(job.userId, job.topic ?? "");
      } catch (e: any) {
        console.warn("[deepResearch] magazine schedule 记录失败:", e?.message);
      }
    }

    // ── VIP 档案：回填 interactionId（建档 / 月度更新场景） ──────────────────
    if (job.onCompletedHook?.kind === "vip_base" || job.onCompletedHook?.kind === "vip_monthly") {
      const finalJob = (await readJob(jobId)) ?? job;
      const finalInteractionId = finalJob.interactionId; // execute 阶段返回的 id，将作为下一次月度更新的 previous_interaction_id
      if (finalInteractionId) {
        try {
          const hook = job.onCompletedHook;
          const store = await import("./vipProfileStore");
          if (hook.kind === "vip_base") {
            await store.attachBaseInteractionId(hook.ownerId, hook.vipId, finalInteractionId);
            console.log(`[deepResearch] 🌱 VIP 建档完成 vipId=${hook.vipId} baseInteractionId=${finalInteractionId}`);
          } else {
            await store.attachUpdateInteractionId(hook.ownerId, hook.vipId, jobId, finalInteractionId);
            console.log(`[deepResearch] 🔁 VIP 月度更新完成 vipId=${hook.vipId} jobId=${jobId} newInteractionId=${finalInteractionId}`);
          }
        } catch (e: any) {
          console.warn("[deepResearch] VIP 档案回填失败:", e?.message);
        }
      }
    }

  } catch (err: any) {
    const latest = (await readJob(jobId)) ?? job;
    const isUserCancel = err?.message === "USER_CANCELLED" || latest.cancelRequestedAt;

    if (isUserCancel) {
      // 商业护栏（防恶意刷算力）：
      //   * 用户主动 → cancelRefundReason="user_cancelled_no_refund" → 不退积分
      //   * 系统/部署/admin/reaper → 仍走幂等退积分（user_cancelled / deploy_killed）
      const cancelReason: PaidJobRefundReason =
        latest.cancelRefundReason ??
        (latest.cancelRequestedBy === "deploy"
          ? "deploy_killed"
          : latest.cancelRequestedBy === "user"
            ? "user_cancelled_no_refund"
            : "user_cancelled");
      const userInitiatedNoRefund = cancelReason === "user_cancelled_no_refund";
      const progressLine = userInitiatedNoRefund
        ? `🛑 任务已取消（按规则不退还积分，防止恶意消耗算力）`
        : `🛑 任务已取消，${latest.creditsUsed ?? 0} 积分已退还至您的账户`;
      console.log(
        `[deepResearch] 🛑 任务 ${jobId} 已被取消 by=${latest.cancelRequestedBy ?? "?"} refundReason=${cancelReason}`,
      );
      await failJobAndRefund(
        latest,
        userInitiatedNoRefund ? "用户主动取消任务（不退还积分）" : "用户主动取消任务",
        progressLine,
        undefined,
        cancelReason,
      );
    } else {
      console.error(`[deepResearch] ❌ 任务 ${jobId} 失败:`, err?.message);
      // 如果是结构化的 Deep Research API 错误，把完整 raw body / api code / stack 落盘
      const detail = err instanceof DeepResearchApiError
        ? err.toDetailString()
        : err?.stack
          ? `${err?.message}\n--- stack ---\n${err.stack}`
          : undefined;
      if (detail) console.error(`[deepResearch] 🔬 详细错误:\n${detail}`);
      // 判定 refund reason：API 错 → external_api_error；其他 → task_failed
      const refundReason: PaidJobRefundReason = err instanceof DeepResearchApiError
        ? "external_api_error"
        : "task_failed";
      await failJobAndRefund(
        latest,
        err?.message || "未知错误",
        `❌ 战报生成失败，${latest.creditsUsed ?? 0} 积分已退还至您的账户`,
        detail,
        refundReason,
      );
    }
  } finally {
    clearInterval(heartbeatTimer);
    clearTimeout(watchdogTimer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 自动场景配图 — Vertex Imagen Ultra `imagen-4.0-ultra-generate-001` · 2K
// ─────────────────────────────────────────────────────────────────────────────
// 设计：
//   1. 用 LLM 解析报告 → 输出 3-5 个"应用场景 / 人物特色 / 行业生态"画面
//   2. 每张图带 sectionAnchor（章节标题）+ caption（中文图说）+ imagePrompt（英文）
//   3. 串行调用 Vercel `imagenBackend=vertex`（**仅 Vertex IAM**，不走 Consumer API Key）
//   4. 按 sectionAnchor 注入到对应章节段落后；3 级 fallback（精确 → 模糊 → 均分），
//      保证场景图必嵌正文章节，**绝不**进入文末附录（用户反馈：附录陷阱破坏阅读体验）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 场景配图类别。2026-05-01 用户决策：报告配图必须覆盖 4 类「重点突出」画面。
 *
 * - "scene"   应用场景：用户使用产品/服务的真实现场（商场快闪、工厂流水线、直播间、家庭客厅等）
 * - "persona" 目标人物 / 个人形象：目标客群肖像或品牌代言人特写，传达情绪与调性
 * - "product" 产品特色：产品功能或卖点的视觉化（智能音箱被多人使用、APP 界面被操作、产品包装陈列）
 * - "data"    数据 / 行业生态：把报告关键数据或洞察「场景化」（不画图表，画现实画面）
 *
 * 旧报告无 category 字段，injectSceneImagesIntoMarkdown 不依赖此字段，向后兼容。
 */
type SceneCategory = "scene" | "persona" | "product" | "data";

interface SceneIllustration {
  sectionAnchor: string;
  caption: string;
  imagePrompt: string;
  imageUrl?: string;
  /** 可选 aspect ratio，默认 16:9（横版更适合插入正文） */
  aspectRatio?: "16:9" | "4:3" | "1:1";
  /** 重点画面类别（≥ 5 张图必须 4 类全覆盖；旧数据/向后兼容时为 undefined） */
  category?: SceneCategory;
}

/**
 * 容错解析 generateSceneIllustrations 的 LLM 输出 JSON。
 *
 * 失败模式（已在 fly logs 见到）：
 *   - LLM 输出被 maxOutputTokens 截断 → 末尾字符串没闭合 → JSON.parse 抛
 *     `Unterminated string in JSON at position N`
 *
 * 修复策略：
 *   1. 去掉 ```json 包装，直接 JSON.parse
 *   2. 失败 → 找到最后一个完整 `}` 边界，切掉残缺尾部 + 自动补 `]}` 闭合
 *   3. 失败 → 返回 null（让外层走 retry）
 *
 * 注意：此函数保证不抛错，纯返回值。
 */
function parseScenesJson(raw: string): { scenes: SceneIllustration[] } | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```\s*$/g, "").trim();

  // try 1: 严格 parse
  try {
    const obj = JSON.parse(cleaned);
    if (obj && Array.isArray(obj.scenes)) return obj as { scenes: SceneIllustration[] };
  } catch { /* fall through */ }

  // try 2: 修复被截断的 JSON（兼容 LLM 在 JSON 前后夹的废话 / markdown）
  //   定位 outer `{`（在 "scenes" key 之前最近的 `{`）→ 扫描到最后一个完整对象 `}`
  //   → 切片补 `]}` 闭合再 parse
  try {
    const sceneKeyIdx = cleaned.indexOf('"scenes"');
    if (sceneKeyIdx < 0) return null;
    let outerObjStart = -1;
    for (let i = sceneKeyIdx; i >= 0; i--) {
      if (cleaned[i] === "{") { outerObjStart = i; break; }
    }
    if (outerObjStart < 0) return null;
    const arrayStartIdx = cleaned.indexOf("[", sceneKeyIdx);
    if (arrayStartIdx < 0) return null;

    // 从 arrayStartIdx 之后扫描，记录最后一个对象边界（数组内 depth 由 1→0 时遇到 `}`）
    let depth = 0;
    let inString = false;
    let escape = false;
    let lastObjectEnd = -1;
    for (let i = arrayStartIdx; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) lastObjectEnd = i;
      }
    }
    if (lastObjectEnd <= arrayStartIdx) return null;

    const repaired = cleaned.slice(outerObjStart, lastObjectEnd + 1) + "]}";
    const obj = JSON.parse(repaired);
    if (obj && Array.isArray(obj.scenes)) {
      console.warn(
        `[deepResearch][scenes] JSON 截断已修复（取最后一个完整对象边界，` +
          `保留 ${obj.scenes.length} 个场景）`,
      );
      return obj as { scenes: SceneIllustration[] };
    }
  } catch (e: any) {
    console.warn(`[deepResearch][scenes] 截断修复也失败: ${e?.message}`);
  }

  return null;
}

async function generateSceneIllustrations(params: {
  topic: string;
  reportMarkdown: string;
  vercelBaseUrl: string;
  /**
   * 默认 5-7 张（2026-05-01 用户决策从 3-5 升到 5-7，强制 4 类「重点突出」画面全覆盖）。
   * 若调用方显式传 minCount < 4 或 maxCount < 4，4 类全覆盖检查会被跳过（保留向后兼容入口）。
   */
  minCount?: number;
  maxCount?: number;
}): Promise<SceneIllustration[]> {
  const minCount = params.minCount ?? 5;
  const maxCount = params.maxCount ?? 7;

  // ── 0. 提取报告里所有 H1/H2/H3 章节标题，强制 LLM 从这个列表选 sectionAnchor ──
  // 历史问题（用户痛点："场景图应该在报告里面，不应该单独生成才对"）：
  //   原本 LLM 自由命名 sectionAnchor，结果跟实际章节（如 `## 一、个人亮点提取`）经常对不上，
  //   `injectSceneImagesIntoMarkdown` 的 regex 匹配失败 → 全部堆进文末「附录：可视化场景图集」。
  //   现在改成：让 LLM 必须从下面列出的章节里挑，最大化匹配率。
  const sectionTitles = extractSectionTitles(params.reportMarkdown);
  const titleListBlock = sectionTitles.length > 0
    ? sectionTitles.map((t, i) => `  ${i + 1}. ${t}`).join("\n")
    : "  （报告未提取出章节，请输出空字符串作 sectionAnchor）";

  // ── 1. 用 LLM 抽场景（仅取报告前 12000 字喂给 LLM，避免 prompt 过长） ──
  const reportSnippet = params.reportMarkdown.slice(0, 12000);
  const sceneJsonText = await generate(
    "gemini-3.1-pro-preview",
    `你是商业杂志的视觉总监。下面是一份课题为《${params.topic}》的战略研报正文（Markdown）。

【任务】
请从中抽取 ${minCount}-${maxCount} 个最具代表性的「重点突出画面」作为本报告的可视化配图。**必须覆盖以下 4 类**（每类至少 1 张，越接近 ${maxCount} 张越好）：

1. **scene  · 应用场景**：用户使用产品/服务的真实现场
   例：商场快闪店现场、家庭客厅亲子互动、地铁通勤族刷手机、健身房私教课、跨境电商打包发货中心、五一家庭出游
2. **persona · 目标人物 / 个人形象**：目标客群肖像或品牌代言人特写，传达情绪与调性
   例：30 岁都市白领女性、三代同堂家庭主理人、健身教练、年轻创业者在工作室、Z 世代女生在咖啡馆刷手机
3. **product · 产品特色**：产品功能或卖点的视觉化（不是 PPT 介绍图，是真实使用画面）
   例：智能音箱被多人围坐使用、APP 界面被指尖操作的特写、产品包装在精致陈列、新品试穿镜前展示
4. **data · 数据 / 行业生态**：把报告关键数据或市场洞察「场景化」（**不要画图表/折线**，画现实画面承载数据情绪）
   例：报告说"30% 用户晚上 10 点后下单" → 画夜里在沙发上举手机下单的人；
   "618 大促爆单" → 画仓库流水线打包热闹场面；
   "下沉市场崛起" → 画县城商业街灯火通明现场

【场景挑选规则】
1. 必须是报告里实际涉及到的具体内容（不要凭空臆造，从正文里找抓手）
2. 优先挑能传达情绪 + 故事感 + 品牌调性的画面，**杜绝抽象图表 / PPT 模版风 / 数据折线 / 信息图风格**
3. 4 类覆盖优先于数量：宁可只 5 张但 4 类全有，也不要 7 张全是 scene 类
4. 同一章节最多 1 张图，请在不同章节之间均匀分布

【sectionAnchor 强制规范 · 必须遵守】
- sectionAnchor 字段**必须严格等于以下章节标题之一**（一字不差，包含编号 / 中文 / emoji），不允许自创：
${titleListBlock}
- 不允许只写关键词（如「行业全景」「财务模型」），必须复制整行标题

【category 字段 · 必须遵守】
- category 字段值必须严格取以下 4 个英文小写字符串之一："scene" / "persona" / "product" / "data"
- 不允许写中文或自创类别。

【输出格式】
仅输出严格 JSON，不带任何 markdown / 注释 / 多余文字。结构：
{
  "scenes": [
    {
      "category": "scene" | "persona" | "product" | "data",
      "sectionAnchor": "必须严格等于上面列表中的某一条标题文字",
      "caption": "中文图说，≤ 30 字，作为图片下方的注解",
      "imagePrompt": "英文 prompt，**必须 ≤ 60 个英文单词**（防 token 超限），2K editorial photography for magazine body illustration, sophisticated composition, natural lighting, cinematic detail. 具体描述场景人物、表情、环境、光线、镜头。data 类不要画图表，要画承载数据情绪的现实画面",
      "aspectRatio": "16:9"
    }
  ]
}

【报告正文】
${reportSnippet}`,
    2,
    { temperature: 0.4, topP: 0.9, maxTokens: 30000 },
  );

  // ── 解析 LLM 输出：先严格 parse，失败则尝试修复 unterminated JSON，
  //    再失败则发起一次精简 retry，最后兜底返回空数组（仅 warn 不 throw）。
  let parsed = parseScenesJson(sceneJsonText);
  if (!parsed || (parsed.scenes ?? []).length < minCount) {
    const firstSceneCount = parsed?.scenes?.length ?? 0;
    console.warn(
      `[deepResearch][scenes] 第 1 次解析仅得 ${firstSceneCount} 个场景，发起精简 retry…`,
    );
    // ── retry：明确告诉 LLM 上次输出被截断，要 minCount 张 + 缩短 imagePrompt ──
    //   仍然要求 4 类覆盖（scene/persona/product/data），但允许各类只 1 张
    const retryText = await generate(
      "gemini-3.1-pro-preview",
      `上一次返回的 JSON 不完整（被 token 上限截断或字符串未闭合）。请严格只输出 ${minCount} 个最关键场景的 JSON，每个 imagePrompt **必须 ≤ 50 个英文单词**。

【4 类覆盖 · 必须遵守】
${minCount} 张图必须涵盖以下 4 类（每类至少 1 张）：
- "scene"   应用场景：用户使用产品/服务的真实现场
- "persona" 目标人物 / 个人形象：客群肖像或代言人
- "product" 产品特色：产品在被使用 / 陈列的真实画面（不是 PPT）
- "data"    数据情境：把关键数据画成现实画面（不要画图表）

【category 字段】值必须为 "scene" / "persona" / "product" / "data" 之一（英文小写）。

【sectionAnchor 强制规范】
- sectionAnchor **必须严格等于以下章节标题之一**（一字不差），不允许自创：
${titleListBlock}

【输出格式】严格 JSON，不带任何 markdown / 注释：
{
  "scenes": [
    {
      "category": "scene" | "persona" | "product" | "data",
      "sectionAnchor": "必须严格等于上面列表中的某一条标题文字",
      "caption": "中文图说，≤ 30 字",
      "imagePrompt": "≤ 50 英文单词，2K editorial photography, natural light, cinematic composition. 具体描述场景人物、环境、光线（data 类不要画图表）",
      "aspectRatio": "16:9"
    }
  ]
}

【报告正文（前 8000 字）】
${reportSnippet.slice(0, 8000)}`,
      2,
      { temperature: 0.3, topP: 0.85, maxTokens: 30000 },
    ).catch((e: any) => {
      console.warn(`[deepResearch][scenes] retry generate 抛错: ${e?.message}`);
      return "";
    });
    const retryParsed = parseScenesJson(retryText);
    if (retryParsed && (retryParsed.scenes ?? []).length >= minCount) {
      parsed = retryParsed;
    } else {
      console.warn(
        `[deepResearch][scenes] retry 后仍仅 ${retryParsed?.scenes?.length ?? 0} 个场景，跳过配图（任务不挂）`,
      );
      return [];
    }
  }
  const scenes = (parsed.scenes || []).slice(0, maxCount);
  if (scenes.length < minCount) {
    console.warn(`[deepResearch][scenes] 最终仅 ${scenes.length} 个场景（要求 ≥ ${minCount}），跳过配图`);
    return [];
  }

  // ── 1.5 类别覆盖诊断（不 reject，仅 warn，方便观察 LLM 是否听话） ────
  // 用户决策（2026-05-01）：4 类必须全覆盖，但首版以 prompt 强约束 + 日志观察为主。
  // 如果发现实际命中率低，再升级为「缺类即 retry」。
  const ALL_CATS: SceneCategory[] = ["scene", "persona", "product", "data"];
  const catCount: Record<SceneCategory, number> = { scene: 0, persona: 0, product: 0, data: 0 };
  for (const s of scenes) {
    const c = s.category;
    if (c && ALL_CATS.includes(c)) catCount[c] += 1;
  }
  const missing = ALL_CATS.filter((c) => catCount[c] === 0);
  console.log(
    `[deepResearch][scenes] 类别分布: scene=${catCount.scene} persona=${catCount.persona} product=${catCount.product} data=${catCount.data}` +
      (missing.length ? `，⚠ 缺类: ${missing.join("/")}` : "，✅ 4 类全覆盖"),
  );

  // ── 2. 串行 + **仅 Vertex** — Imagen Ultra `imagen-4.0-ultra-generate-001` · 2K（`imagenBackend=vertex`） ──
  const generated: (SceneIllustration | null)[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const aspectRatio = (scene.aspectRatio || "16:9") as ImageAspectRatio;
    let imageUrl: string | undefined;
    try {
      imageUrl = await fetchStrategicVertexImageViaGateway({
        vercelBaseUrl: params.vercelBaseUrl,
        prompt: scene.imagePrompt,
        aspectRatio,
        kind: "scene_imagen_2k",
        timeoutMs: 120_000,
      });
      console.log(
        `[deepResearch][scenes] 第 ${i + 1}/${scenes.length} 张 ✅ Vertex Imagen Ultra 2K（${VERTEX_STRATEGIC_SCENE_IMAGEN_MODEL}）`,
      );
    } catch (e: any) {
      console.warn(`[deepResearch][scenes] 第 ${i + 1}/${scenes.length} Vertex Imagen 失败：${e?.message ?? e}`);
    }
    if (imageUrl) generated.push({ ...scene, imageUrl });
    else generated.push(null);
    if (i < scenes.length - 1) await sleep(500);
  }

  return generated.filter((x): x is SceneIllustration => x !== null && Boolean(x.imageUrl));
}

/** 提取 markdown 里所有 H1/H2/H3 标题（去掉 leading `#`、保留章节文字含编号 / emoji） */
function extractSectionTitles(markdown: string): string[] {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const titles: string[] = [];
  for (const line of lines) {
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2].trim();
    if (!text) continue;
    // 去重 + 跳过本身就是「附录：可视化场景图集」之类的我们生成的章节
    if (/附录：可视化场景图集/.test(text)) continue;
    if (!titles.includes(text)) titles.push(text);
  }
  return titles;
}

/** 标题归一化（去 emoji / 编号前缀 / 标点 / 空白），用于模糊匹配 */
function normalizeTitle(s: string): string {
  return String(s || "")
    // emoji（高低代理对）+ ZWJ + VS16；不用 u 标志（tsconfig 没设 target → 默认 ES3 不支持）
    .replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, "")
    .replace(/[\u200d\ufe0f]/g, "")
    .replace(/^[\s\d一二三四五六七八九十百千万、．\.·\)\(]+/g, "")
    .replace(/[\s、，,。；;：:！!？?「」『』（）()【】\[\]"'`*_~`#]+/g, "")
    .toLowerCase();
}

/** 找两个字符串的最长公共子串长度（轻量 DP） */
function lcsLen(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1).fill(0);
  let cur = new Array(n + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      } else {
        cur[j] = 0;
      }
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return best;
}

/**
 * 把场景图按 sectionAnchor 插入到 markdown 对应章节内。
 *
 * 用户痛点（已确认 root cause）：
 *   原本"找不到锚点的图集中放到文末『# 附录：可视化场景图集』"导致用户抱怨：
 *   "场景图应该在报告里面，不应该单独生成才对"。
 *
 * 现在的策略（3 级 fallback，绝不进文末附录）：
 *   L1 精确：原 regex（H1/H2/H3 + 紧跟段落 + 注入图）
 *   L2 模糊：用归一化 + LCS（最长公共子串）+ 包含子串匹配，挑相似度最高的章节
 *   L3 平均分配：剩下的图按章节均匀分配到没图的章节中段（章节内第一段后面）
 *   L4 兜底：如果上面 3 步都没 hit，把图插到文档第 1 个章节标题之后（**绝对**不再生成附录）
 *
 * 排版审美约束：
 * - 图片用 figure 块（CSS 控制 page-break-inside: avoid，不切页）
 * - caption 用 em + 居中（CSS 在 htmlReportTemplate 与 ReportRenderer 里分别控制）
 * - 每张图独立一段，前后空行（避免与正文文字粘连）
 */
function injectSceneImagesIntoMarkdown(markdown: string, scenes: SceneIllustration[]): string {
  if (!scenes.length) return markdown;

  let out = markdown;
  const sceneList = scenes.filter((s) => s.imageUrl);
  if (!sceneList.length) return markdown;

  const buildBlock = (s: SceneIllustration) =>
    `\n\n<figure class="scene-figure">\n  <img src="${s.imageUrl}" alt="${escapeHtml(s.caption)}" />\n  <figcaption>${escapeHtml(s.caption)}</figcaption>\n</figure>\n\n`;

  // 章节命中状态：title → 是否已经塞过一张（防止同一章节挤多张图）
  const chapterUsed = new Set<string>();
  const orphans: SceneIllustration[] = [];

  // ── L1：精确锚点匹配 ────────────────────────────────────────────────
  for (const scene of sceneList) {
    const anchor = (scene.sectionAnchor || "").trim();
    if (!anchor) {
      orphans.push(scene);
      continue;
    }
    if (chapterUsed.has(anchor)) {
      // 同一章节已有图，转到 L3 均分
      orphans.push(scene);
      continue;
    }
    const safeAnchor = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\n)(#{1,3}[^\\n]*${safeAnchor}[^\\n]*)\\n([\\s\\S]*?)(\\n\\n|$)`, "i");
    const m = out.match(re);
    if (m) {
      const idx = (m.index ?? 0) + m[0].length;
      out = out.slice(0, idx) + buildBlock(scene) + out.slice(idx);
      chapterUsed.add(anchor);
    } else {
      orphans.push(scene);
    }
  }

  // 重新提取（注入后偏移会变，但章节列表不变；用最初 markdown 的章节列表足够稳）
  const titles = extractSectionTitles(markdown);

  // ── L2：模糊匹配（LCS / 包含 / 归一化相似度）────────────────────────
  const stillOrphan: SceneIllustration[] = [];
  for (const scene of orphans) {
    const anchor = (scene.sectionAnchor || "").trim();
    if (!anchor || titles.length === 0) {
      stillOrphan.push(scene);
      continue;
    }
    const normAnchor = normalizeTitle(anchor);
    let best: { title: string; score: number } | null = null;
    for (const t of titles) {
      if (chapterUsed.has(t)) continue;
      const normT = normalizeTitle(t);
      if (!normT || !normAnchor) continue;
      // 完全包含 / 被包含 → 得满分
      const contains = normAnchor.includes(normT) || normT.includes(normAnchor);
      const lcs = lcsLen(normAnchor, normT);
      const denom = Math.max(normAnchor.length, normT.length, 1);
      const ratio = lcs / denom;
      const score = contains ? Math.max(ratio, 0.7) : ratio;
      if (!best || score > best.score) best = { title: t, score };
    }
    if (best && best.score >= 0.45) {
      const safe = best.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|\\n)(#{1,3}[^\\n]*${safe}[^\\n]*)\\n([\\s\\S]*?)(\\n\\n|$)`, "i");
      const m = out.match(re);
      if (m) {
        const idx = (m.index ?? 0) + m[0].length;
        out = out.slice(0, idx) + buildBlock(scene) + out.slice(idx);
        chapterUsed.add(best.title);
        console.log(
          `[deepResearch][scenes] L2 模糊匹配命中：anchor="${anchor.slice(0, 24)}" → "${best.title.slice(0, 24)}" (score=${best.score.toFixed(2)})`,
        );
        continue;
      }
    }
    stillOrphan.push(scene);
  }

  // ── L3：平均分配 — 把剩余图均匀分到尚未配图的章节里 ────────────────────
  const remainingTitles = titles.filter((t) => !chapterUsed.has(t));
  for (let i = 0; i < stillOrphan.length; i++) {
    const scene = stillOrphan[i];
    const targetTitle = remainingTitles.length > 0
      ? remainingTitles[i % remainingTitles.length]
      : titles[i % Math.max(titles.length, 1)] ?? "";
    if (!targetTitle) {
      // ── L4 兜底：找文档第 1 个章节，硬塞进去（仍然在正文，不进附录） ──
      const firstHeadingMatch = out.match(/(^|\n)(#{1,3}[^\n]+)\n/);
      if (firstHeadingMatch) {
        const idx = (firstHeadingMatch.index ?? 0) + firstHeadingMatch[0].length;
        out = out.slice(0, idx) + buildBlock(scene) + out.slice(idx);
      } else {
        // 完全没标题：直接塞文档开头
        out = buildBlock(scene) + out;
      }
      console.log(`[deepResearch][scenes] L4 兜底：场景图无可用章节，已塞首章节`);
      continue;
    }
    const safe = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\n)(#{1,3}[^\\n]*${safe}[^\\n]*)\\n([\\s\\S]*?)(\\n\\n|$)`, "i");
    const m = out.match(re);
    if (m) {
      const idx = (m.index ?? 0) + m[0].length;
      out = out.slice(0, idx) + buildBlock(scene) + out.slice(idx);
      console.log(
        `[deepResearch][scenes] L3 均分注入：场景 "${scene.caption.slice(0, 20)}" → "${targetTitle.slice(0, 20)}"`,
      );
      // 保证多个图均匀分布：标记 used，让循环推进到下一章节
      if (remainingTitles.includes(targetTitle)) {
        const removeIdx = remainingTitles.indexOf(targetTitle);
        if (removeIdx >= 0) remainingTitles.splice(removeIdx, 1);
      }
    } else {
      // 第 1 个标题也找不到：兜底到首章节（理论不会走到这里）
      const firstHeadingMatch = out.match(/(^|\n)(#{1,3}[^\n]+)\n/);
      if (firstHeadingMatch) {
        const idx = (firstHeadingMatch.index ?? 0) + firstHeadingMatch[0].length;
        out = out.slice(0, idx) + buildBlock(scene) + out.slice(idx);
      } else {
        out = buildBlock(scene) + out;
      }
    }
  }

  // ── 重要：彻底删除 “# 附录：可视化场景图集” 路径 ───────────────────────
  // 用户痛点："场景图应该在报告里面，不应该单独生成才对"。
  // 上面 4 级 fallback 保证：所有场景图都在正文章节里，绝不会出现独立附录章节。

  return out;
}

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
