/**
 * 戰略智庫核心引擎 — AI 上帝視角
 * 支持三種產品類型：magazine_single / magazine_sub / personalized
 * 異步脫機運行，結果雙寫：Fly 持久卷（斷點恢復）+ Neon DB（研報中心展示）
 */
import fs from "fs/promises";
import path from "path";

// Storage root for job state. Default = Fly persistent volume. Override via env var
// for local tests / CI smoke tests.
const REPORT_DIR = process.env.DEEP_RESEARCH_REPORT_DIR || "/data/growth/deep-research";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Deep Research Pro Preview · 全局 1 RPM 限流闸门
// ─────────────────────────────────────────────────────────────────────────────
// 设计：用磁盘上的 JSON 锁文件 + 进程内 Promise 串行链 双重保险。
// - 进程内：所有 await acquireRateGate() 串行排队，前一个未释放后一个不会执行
// - 磁盘上：跨进程协调，保证多个 Fly 实例间也是 1 RPM
// API 限制：gemini-deep-research-pro-preview 严格 1 次/分钟，超额会被封禁
//
// 使用：const release = await acquireRateGate("deep-research"); try { ... } finally { release(); }

const RATE_GATE_FILE = "/data/growth/deep-research-rate-gate.json";
const RATE_GATE_INTERVAL_MS = 60_000; // 1 RPM = 60 秒间隔
let processGateChain: Promise<void> = Promise.resolve();

interface RateGateState { lastCallAt: number; }

async function readRateGateState(): Promise<RateGateState> {
  try {
    const raw = await fs.readFile(RATE_GATE_FILE, "utf-8");
    return JSON.parse(raw) as RateGateState;
  } catch { return { lastCallAt: 0 }; }
}
async function writeRateGateState(s: RateGateState): Promise<void> {
  try {
    await fs.mkdir(path.dirname(RATE_GATE_FILE), { recursive: true });
    await fs.writeFile(RATE_GATE_FILE, JSON.stringify(s));
  } catch (e: any) { console.warn("[deepResearch] rate gate write failed:", e?.message); }
}

/** 申请一次 Deep Research API 调用许可（1 RPM）。返回的函数必须在 finally 中调用以释放许可。 */
async function acquireRateGate(label = "deep-research"): Promise<() => void> {
  let releaseChain: () => void = () => {};
  const ticket = new Promise<void>((resolve) => { releaseChain = resolve; });
  const prev = processGateChain;
  processGateChain = processGateChain.then(() => ticket);

  // 等待前一个调用从进程内队列释放
  await prev;

  // 跨进程：检查磁盘 lastCallAt
  const state = await readRateGateState();
  const elapsed = Date.now() - state.lastCallAt;
  if (state.lastCallAt > 0 && elapsed < RATE_GATE_INTERVAL_MS) {
    const waitMs = RATE_GATE_INTERVAL_MS - elapsed + 500; // +500ms 缓冲
    console.log(`[deepResearch] 🚦 [${label}] 距上次调用 ${Math.round(elapsed / 1000)}s，等待 ${Math.round(waitMs / 1000)}s 满足 1 RPM 限制`);
    await sleep(waitMs);
  }

  // 立刻把当前时间戳写入磁盘，让其他进程看到
  await writeRateGateState({ lastCallAt: Date.now() });

  return () => releaseChain(); // 释放进程内队列
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
async function generate(model: string, prompt: string, retries = 2, opts?: { temperature?: number; maxTokens?: number }): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts?.temperature ?? 0.5,
      ...(opts?.maxTokens != null ? { maxOutputTokens: opts.maxTokens } : {}),
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
 * - 限速：API 严格 1 RPM，全部调用走 acquireRateGate() 串行排队
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
const MAX_POLL_MS = 60 * 60 * 1000; // 60 分钟（API 硬限制）

/**
 * 调用 Deep Research Max Agent（Interactions API + background polling）。
 * - agent_config.visualization="auto" → Agent 可自动生成图表
 * - agent_config.thinking_summaries="auto" → 开启思维链日志
 * - 支持多模态 input：可直接传图片(uri)和文档(uri+mime_type)
 * @param files 用户上传的补充文件（已存 GCS），直接作为 multimodal input 传给 Agent
 * @param onInteractionId 拿到 interactionId 后的回调，用于持久化以便断线恢复
 */
async function generateDeepResearch(
  prompt: string,
  files?: Array<{ type: "image" | "pdf"; url: string; mimeType: string; name: string }>,
  onInteractionId?: (id: string) => Promise<void>,
): Promise<GroundedResult> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY");

  const apiHeaders = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
    "X-Goog-Api-Client": "genai-node/deep-research",
  };

  // 构建 multimodal input：文本 + 文件（图片 / 文档）
  const inputParts: any[] = [{ type: "text", text: prompt }];
  if (files?.length) {
    for (const f of files) {
      if (f.type === "image") {
        inputParts.push({ type: "image", uri: f.url });
      } else {
        inputParts.push({ type: "document", uri: f.url, mime_type: f.mimeType });
      }
    }
  }
  const input = inputParts.length === 1 ? prompt : inputParts;

  // ── Step 1：提交任务（立即返回 interaction.id） ──────────────────────────────
  const release = await acquireRateGate("deep-research-create");
  let interactionId: string;
  try {
    console.log(`[deepResearch] 🚀 PID=${process.pid} 提交 Max Agent，promptLen=${prompt.length} files=${files?.length ?? 0}`);
    const createRes = await fetch(INTERACTIONS_BASE, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        input,
        agent: DEEP_RESEARCH_AGENT_NAME,
        background: true,
        agent_config: {
          type: "deep-research",
          thinking_summaries: "auto",  // 开启思维链，可在进度日志中看到推演步骤
          visualization: "auto",       // Agent 自动生成图表/图形
        },
      }),
    });
    const rawCreate = await createRes.text();
    let createJson: any = {};
    try { createJson = JSON.parse(rawCreate); } catch { /* ignore */ }

    if (!createRes.ok) {
      console.error(`[deepResearch] ❌ create HTTP ${createRes.status}：${rawCreate.slice(0, 2000)}`);
      const errMsg = createJson?.error?.message || createJson?.error?.status || rawCreate.slice(0, 300);
      throw new Error(`Deep Research Agent 提交失败（HTTP ${createRes.status}: ${errMsg}），积分将退回。`);
    }

    interactionId = createJson?.id;
    if (!interactionId) {
      console.error(`[deepResearch] ❌ 未返回 interaction.id，响应：${rawCreate.slice(0, 1000)}`);
      throw new Error("Deep Research Agent 未返回任务 ID，积分将退回。");
    }
    console.log(`[deepResearch] ✅ PID=${process.pid} interaction 已创建：${interactionId}`);
  } finally {
    release();
  }

  // 持久化 interactionId，服务重启后可恢复轮询
  if (onInteractionId) {
    try { await onInteractionId(interactionId); } catch { /* 非阻断 */ }
  }

  // ── Step 2：轮询直到完成 / 失败 / 超时 ──────────────────────────────────────
  const pollStart = Date.now();
  let lastStatus = "in_progress";

  while (Date.now() - pollStart < MAX_POLL_MS) {
    await sleep(POLL_INTERVAL_MS);

    const elapsed = Math.round((Date.now() - pollStart) / 1000);
    let pollJson: any = {};
    try {
      const pollRes = await fetch(`${INTERACTIONS_BASE}/${interactionId}`, { headers: apiHeaders });
      const rawPoll = await pollRes.text();
      try { pollJson = JSON.parse(rawPoll); } catch { /* ignore */ }

      if (!pollRes.ok) {
        console.error(`[deepResearch] ❌ poll HTTP ${pollRes.status} elapsed=${elapsed}s：${rawPoll.slice(0, 1000)}`);
        throw new Error(`Deep Research 轮询失败（HTTP ${pollRes.status}），积分将退回。`);
      }
    } catch (fetchErr: any) {
      console.warn(`[deepResearch] ⚠️ poll fetch 异常 elapsed=${elapsed}s：${fetchErr?.message}`);
      continue;
    }

    lastStatus = pollJson?.status ?? "unknown";
    console.log(`[deepResearch] 🔍 PID=${process.pid} poll interactionId=${interactionId} status=${lastStatus} elapsed=${elapsed}s`);

    if (lastStatus === "failed") {
      const errMsg = pollJson?.error?.message || JSON.stringify(pollJson?.error || {}).slice(0, 300);
      console.error(`[deepResearch] ❌ Agent 失败：${errMsg}`);
      throw new Error(`Deep Research Agent 执行失败（${errMsg}），积分将退回。`);
    }

    if (lastStatus === "completed") {
      const outputs: any[] = pollJson?.outputs || [];

      // 提取文本正文（最后一个 text output）
      const textOutput = [...outputs].reverse().find((o: any) => !o.type || o.type === "text");
      const text = String(textOutput?.text || "").trim();

      if (!text || text.length < 400) {
        console.error(`[deepResearch] ❌ 完成但正文不足（${text.length}字），响应：${JSON.stringify(pollJson).slice(0, 3000)}`);
        throw new Error(`Deep Research Agent 完成但内容不足（${text.length}字），积分将退回。`);
      }

      // 捕获 Agent 自动生成的图表（base64 图片）→ 嵌入报告
      const imageOutputs = outputs.filter((o: any) => o.type === "image" && o.data);
      let chartMarkdown = "";
      if (imageOutputs.length > 0) {
        chartMarkdown = "\n\n## 📊 Agent 生成图表\n\n" + imageOutputs.map((o: any, i: number) =>
          `![图表 ${i + 1}](data:image/png;base64,${o.data})\n`
        ).join("\n");
        console.log(`[deepResearch] 📊 捕获到 ${imageOutputs.length} 张 Agent 生成图表`);
      }

      console.log(`[deepResearch] ✅ PID=${process.pid} 完成 interactionId=${interactionId} ${text.length}字 charts=${imageOutputs.length} elapsed=${elapsed}s`);
      return { text: text + chartMarkdown, sources: [] };
    }
    // status === "in_progress" → 继续等待
  }

  throw new Error(`Deep Research Agent 超过 60 分钟未完成（interactionId=${interactionId}），积分将退回。`);
}

/** @deprecated 旧接口 · 转发到新的 Deep Research 调用器（保持向下兼容） */
async function generateGrounded(_model: string, prompt: string): Promise<GroundedResult> {
  return generateDeepResearch(prompt, undefined);
}

// ── Neon DB 辅助 ────────────────────────────────────────────────────────────

async function getDbAndSchema() {
  const { getDb } = await import("../db");
  const { userCreations } = await import("../../drizzle/schema-creations");
  const db = await getDb();
  return { db, userCreations };
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

export type DeepResearchProductType = "magazine_single" | "magazine_sub" | "personalized";

export interface DeepResearchJob {
  jobId: string;
  userId: string;
  topic: string;
  productType?: DeepResearchProductType;
  dbRecordId?: number;
  // 状态机：pending（排队）→ running（生成中）→ awaiting_review（草稿待主编审核）→ completed（已出刊） / failed
  status: "pending" | "running" | "awaiting_review" | "completed" | "failed";
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
  /** 重启次数（attemptCount）。超过 MAX_RESUME_ATTEMPTS 则不再重启，直接 failed + 退款。 */
  attemptCount?: number;
  /** 启动任务时实际扣除的积分（用于失败时退款）。0 = 管理员/免费，无需退款。 */
  creditsUsed?: number;
  /** Google Interactions API 返回的 interaction ID，用于断线恢复轮询（无需重跑） */
  interactionId?: string;
  /** 用户上传的补充资料：文字说明 + 文件（已存 GCS，注入阶段 A Deep Research） */
  supplementaryText?: string;
  supplementaryFiles?: Array<{ name: string; type: "image" | "pdf"; mimeType: string; url: string; gcsUri: string }>;
}

// ── 恢复阈值（resilience thresholds） ───────────────────────────────────────
/** Heartbeat 落后多少毫秒视为「进程可能已死，可考虑重新拉起」。Deep Research API
 *  单次最长 ~10 分钟，期间 updateProgress 会刷 heartbeat；超过 3 分钟没动静意味
 *  着不是网络慢就是进程死了。 */
const HEARTBEAT_RESUME_AFTER_MS = 3 * 60 * 1000;
/** Heartbeat 落后多少毫秒视为「彻底死亡，退款放弃」。包含「重启后再次跑也无果」
 *  的极端场景；当任务 heartbeat 超过该阈值即直接 failed + refund。 */
const HEARTBEAT_FAIL_AFTER_MS = 30 * 60 * 1000;
/** 同一任务被重新拉起的最大次数。超过此值直接 failed + refund，避免毒任务循环消耗
 *  1 RPM 配额。 */
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

/** 仅写一行心跳时间戳（不读旧 job，最小 IO）。供 ticker 使用。 */
async function bumpHeartbeat(jobId: string) {
  try {
    const file = path.join(REPORT_DIR, `${jobId}.json`);
    const raw = await fs.readFile(file, "utf-8");
    const job: DeepResearchJob = JSON.parse(raw);
    // 只在仍处于 running 状态时刷心跳，避免覆盖 completed / failed 终态。
    if (job.status !== "running") return;
    job.lastHeartbeatAt = new Date().toISOString();
    job.pid = process.pid;
    await fs.writeFile(file, JSON.stringify(job, null, 2));
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

/** 把任务标记为彻底失败，并退还积分 + 同步 DB。 */
async function failJobAndRefund(job: DeepResearchJob, reason: string, progressMsg: string) {
  const file = path.join(REPORT_DIR, `${job.jobId}.json`);
  const failedJob: DeepResearchJob = {
    ...job,
    status: "failed",
    error: reason,
    progress: progressMsg,
    completedAt: new Date().toISOString(),
  };
  try { await fs.writeFile(file, JSON.stringify(failedJob, null, 2)); } catch {}
  if (job.dbRecordId) {
    try { await dbUpdateRecord(job.dbRecordId, "failed", progressMsg, undefined, reason); } catch {}
  }
  // 实际退款：只有在任务确实扣过积分时退（管理员/免费的 creditsUsed=0 跳过）
  if (typeof job.creditsUsed === "number" && job.creditsUsed > 0) {
    try {
      const { refundCredits } = await import("../credits");
      await refundCredits(Number(job.userId), job.creditsUsed, `上帝视角研报·${reason}·退回 ${job.creditsUsed} 点`);
      console.log(`[deepResearch] 💰 已退还 ${job.creditsUsed} 点给用户 ${job.userId}（任务 ${job.jobId}）`);
    } catch (e: any) {
      console.warn(`[deepResearch] 退款失败 (job=${job.jobId}):`, e?.message);
    }
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
 *   * heartbeat 落后 > 30 分钟：彻底放弃，标 failed + 退款
 *   * 没有 heartbeat 字段（旧数据）：fallback 到 createdAt 判断
 */
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
        if (job.status !== "running" && job.status !== "pending") continue;

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
          if (job.status === "running" && job.pid === process.pid) {
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
  supplementary?: { supplementaryText?: string; supplementaryFiles?: DeepResearchJob["supplementaryFiles"] },
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
    status: "pending",
    progress: "🚀 任务已派发，等待算力节点…",
    createdAt: new Date().toISOString(),
    creditsUsed,
    attemptCount: 1,
    ...(supplementary?.supplementaryText ? { supplementaryText: supplementary.supplementaryText } : {}),
    ...(supplementary?.supplementaryFiles?.length ? { supplementaryFiles: supplementary.supplementaryFiles } : {}),
  };
  await writeJob(job);

  // 再写 Neon DB（允许失败，不影响任务启动）
  const dbRecordId = await dbCreateRecord(Number(userId), topic, jobId, creditsUsed);
  if (dbRecordId) {
    await writeJob({ ...job, dbRecordId });
  }

  return { jobId, dbRecordId };
}

/** 异步执行全景战报（fire-and-forget，不阻塞响应） */
export async function runDeepResearchAsync(jobId: string) {
  const job = await readJob(jobId);
  if (!job) return;

  // 注册 SIGTERM 钩子（幂等，仅首次有效）
  ensureShutdownHook();

  const taskStartMs = Date.now();

  // ── Heartbeat ticker：worker 在跑期间，每 30s 自动刷一次 lastHeartbeatAt。
  //    这样即使没有阶段更新，重启时也能区分「在跑但慢」和「进程已死」。
  const heartbeatTimer = setInterval(() => { void bumpHeartbeat(jobId); }, HEARTBEAT_TICK_MS);
  if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();

  // ── 15 分钟存活检查哨（Watchdog）
  // 如果 15 分钟后 heartbeat 静止超过 3 分钟（说明 worker 已死/卡死），
  // 立刻标 failed + 退积分，无需等到 30 分钟硬超时才发现。
  const WATCHDOG_TRIGGER_MS = 15 * 60 * 1000;
  const WATCHDOG_STALE_THRESHOLD_MS = 3 * 60 * 1000;
  const watchdogTimer = setTimeout(async () => {
    try {
      const current = await readJob(jobId);
      if (!current) return;
      if (current.status === "completed" || current.status === "awaiting_review" || current.status === "failed") return;
      const lastBeat = current.lastHeartbeatAt ? new Date(current.lastHeartbeatAt).getTime() : 0;
      const staleSec = Math.floor((Date.now() - lastBeat) / 1000);
      console.log(`[deepResearch] 🐕 Watchdog 15min 检查：jobId=${jobId} status=${current.status} heartbeat_stale=${staleSec}s`);
      if (lastBeat === 0 || (Date.now() - lastBeat) > WATCHDOG_STALE_THRESHOLD_MS) {
        console.warn(`[deepResearch] 🐕 Watchdog 判断任务疑似卡死（${staleSec}s 无心跳），标记 failed 并退积分`);
        await failJobAndRefund(current, "15分钟内无心跳，任务疑似卡死，已自动退积分", "⚠️ 深潜超时：15 分钟内未收到进度信号，积分已原路退回");
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

  const updateProgress = async (progress: string, status: "running" | "completed" | "failed" = "running") => {
    const latest = (await readJob(jobId)) ?? job;
    await writeJob({ ...latest, status, progress, pid: process.pid });
    if (latest.dbRecordId) {
      await dbUpdateRecord(latest.dbRecordId, status, progress);
    }
  };

  try {
    await updateProgress(stages[0]);

    const productType = job.productType ?? "magazine_single";
    const dateStr = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long" });

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
    // 模型：gemini-deep-research-pro-preview（2026 战略智库大脑，1 RPM 严格限速）
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

    // 传入回调：拿到 interactionId 后立即持久化到 Job 文件，服务重启后可恢复轮询
    const harvested: GroundedResult = await generateDeepResearch(
      harvestPrompt,
      suppFiles.length ? suppFiles : undefined,
      async (interactionId) => {
        const latest = (await readJob(jobId)) ?? job;
        await writeJob({ ...latest, interactionId } as any);
      },
    );
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

    const sharedSetup = `
${LANG_RULES}
${DATA_TABLE_RULES}
${FRAMEWORKS}
${CHART_RULES}
${PERSONA_HIGHLIGHT_RULES}

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

    const reportMarkdown = await generate("gemini-3.1-pro-preview", prompt, 2, { temperature: 0.55 });

    if (!reportMarkdown || reportMarkdown.length < 1500) {
      throw new Error("战报内容过短，可能生成失败");
    }

    await updateProgress(stages[3]);

    // ── 后处理：灯塔标题 + 封面图 + 摘要 + 耗时 ──────────────────────────────

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

    // 2. 封面图（调用 Vercel nanoImage 端点，失败不阻断）
    let coverUrl: string | undefined;
    try {
      const vercelBaseUrl = String(process.env.VERCEL_APP_URL || "https://mvstudiopro.vercel.app").replace(/\/$/, "");
      const coverRes = await fetch(`${vercelBaseUrl}/api/google?op=nanoImage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Luxury dark-gold business magazine cover, cinematic editorial photography, dramatic lighting, sophisticated typography overlay, vertical format. Topic: ${lighthouseTitle}`,
          tier: "flash",
          aspectRatio: "3:4",
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (coverRes.ok) {
        const coverJson = await coverRes.json();
        if (coverJson?.imageUrl) coverUrl = String(coverJson.imageUrl);
      }
    } catch {
      console.warn("[deepResearch] 封面图生成失败，跳过");
    }

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
          if (coverUrl) setPayload.thumbnailUrl = coverUrl;
          await db.update(userCreations).set(setPayload).where(eq(userCreations.id, latest.dbRecordId));
        }
      } catch (e: any) {
        console.warn("[deepResearch] DB 写入完成状态失败:", e?.message);
      }
    }

    console.log(`[deepResearch] ✅ 研报 ${jobId} 已完成，字符数: ${reportMarkdown.length}，耗时 ${duration} min`);

    // ── 半月刊：记录最后生成时间，触发 10 天提醒计时 ─────────────────────────
    if (productType === "magazine_single" || productType === "magazine_sub") {
      try {
        const { recordMagazineGenerated } = await import("./magazineScheduler");
        await recordMagazineGenerated(job.userId, job.topic ?? "");
      } catch (e: any) {
        console.warn("[deepResearch] magazine schedule 记录失败:", e?.message);
      }
    }

  } catch (err: any) {
    console.error(`[deepResearch] ❌ 任务 ${jobId} 失败:`, err?.message);
    const latest = (await readJob(jobId)) ?? job;
    // 统一走 failJobAndRefund：写状态、写 DB、退积分
    await failJobAndRefund(
      latest,
      err?.message || "未知错误",
      `❌ 战报生成失败，已退回积分 ${latest.creditsUsed ?? 0} 点`,
    );
  } finally {
    clearInterval(heartbeatTimer);
    clearTimeout(watchdogTimer);
  }
}
