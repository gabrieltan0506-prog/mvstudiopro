/**
 * 戰略智庫核心引擎 — AI 上帝視角
 * 支持三種產品類型：magazine_single / magazine_sub / personalized
 * 異步脫機運行，結果雙寫：Fly 持久卷（斷點恢復）+ Neon DB（研報中心展示）
 */
import fs from "fs/promises";
import path from "path";

const REPORT_DIR = "/data/growth/deep-research";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    { key: "xiaohongshu" as const, label: "小红书", color: "#f43f5e" },
    { key: "douyin"      as const, label: "抖音",   color: "#a78bfa" },
    { key: "bilibili"    as const, label: "B站",    color: "#38bdf8" },
    { key: "kuaishou"    as const, label: "快手",   color: "#4ade80" },
  ];

  const toX = (i: number) => PAD.left + i * xStep;
  const toY = (v: number) => PAD.top + chartH - (v / 100) * chartH;

  // 水平网格线
  const gridLines = [0, 25, 50, 75, 100].map((v) => {
    const y = toY(v);
    return `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + chartW}" y2="${y}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
<text x="${PAD.left - 6}" y="${y + 4}" font-size="9" fill="rgba(255,255,255,0.3)" text-anchor="end">${v}</text>`;
  }).join("\n");

  // X 轴日期标签
  const xLabels = data.dates.map((d, i) =>
    `<text x="${toX(i)}" y="${PAD.top + chartH + 16}" font-size="9" fill="rgba(255,255,255,0.35)" text-anchor="middle">${d}</text>`
  ).join("\n");

  // 每条折线 + 填充区域
  const lines = platforms.map(({ key, color }) => {
    const vals = data[key];
    const pts = vals.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
    const areaBase = `${toX(days - 1)},${toY(0)} ${toX(0)},${toY(0)}`;
    return `
<defs>
  <linearGradient id="grad-${key}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
    <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
  </linearGradient>
</defs>
<polygon points="${pts} ${areaBase}" fill="url(#grad-${key})"/>
<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
${vals.map((v, i) => `<circle cx="${toX(i)}" cy="${toY(v)}" r="3" fill="${color}" stroke="#0a0700" stroke-width="1.5"/>`).join("")}`;
  }).join("\n");

  // 图例
  const legend = platforms.map(({ label, color }, i) =>
    `<rect x="${PAD.left + i * 155}" y="14" width="10" height="10" rx="3" fill="${color}"/>
<text x="${PAD.left + i * 155 + 14}" y="23" font-size="11" fill="rgba(255,255,255,0.75)">${label}</text>`
  ).join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="font-family:system-ui,sans-serif">
  <rect width="${W}" height="${H}" rx="12" fill="#0e0900"/>
  <rect width="${W}" height="${H}" rx="12" fill="none" stroke="rgba(180,130,0,0.25)" stroke-width="1"/>
  <text x="${W / 2}" y="12" font-size="10" fill="rgba(245,200,80,0.5)" text-anchor="middle">📊 ${topic} · 四平台7天热度趋势指数（0-100）</text>
  ${legend}
  ${gridLines}
  ${xLabels}
  ${lines}
</svg>`;

  const b64 = Buffer.from(svg).toString("base64");
  return `\n\n> 📈 **四平台 7 天趋势监控**（热度指数 0-100，100 为最热）\n\n<img src="data:image/svg+xml;base64,${b64}" width="680" alt="四平台7天趋势图" style="border-radius:12px;margin:8px 0"/>\n\n`;
}

/** 直接 HTTP 调用 Gemini API */
async function generate(model: string, prompt: string, retries = 2): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 65536 },
  });

  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(600_000), // 10 分钟超时
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
export async function getUserReportSnapshots(userId: string): Promise<Array<{ date: string; title: string; summary: string }>> {
  try {
    const { db, userCreations } = await getDbAndSchema();
    if (!db) return [];
    const { eq, and, desc } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(userCreations)
      .where(and(eq(userCreations.userId, Number(userId)), eq(userCreations.type, "deep_research_report"), eq(userCreations.status, "completed")))
      .orderBy(desc(userCreations.createdAt))
      .limit(5);
    return rows.map((r) => {
      let meta: any = {};
      try { meta = JSON.parse(r.metadata || "{}"); } catch {}
      return {
        date: r.createdAt.toLocaleDateString("zh-CN"),
        title: r.title || meta.topic || "无标题",
        summary: meta.summary || meta.reportMarkdown?.slice(0, 100) || "",
      };
    });
  } catch {
    return [];
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
  status: "pending" | "running" | "completed" | "failed";
  progress?: string;
  reportMarkdown?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

async function writeJob(job: DeepResearchJob) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    path.join(REPORT_DIR, `${job.jobId}.json`),
    JSON.stringify(job, null, 2),
  );
}

export async function readJob(jobId: string): Promise<DeepResearchJob | null> {
  try {
    const raw = await fs.readFile(path.join(REPORT_DIR, `${jobId}.json`), "utf-8");
    return JSON.parse(raw) as DeepResearchJob;
  } catch {
    return null;
  }
}

/**
 * 服务启动时调用：扫描孤儿任务（running 超过 15 分钟）并标记为 failed。
 * 防止机器重启/部署导致任务永远卡在 running 状态。
 */
export async function recoverOrphanedJobs(): Promise<void> {
  try {
    await fs.mkdir(REPORT_DIR, { recursive: true });
    const files = await fs.readdir(REPORT_DIR);
    const now = Date.now();
    const ORPHAN_THRESHOLD_MS = 15 * 60 * 1000;

    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(REPORT_DIR, f), "utf-8");
        const job: DeepResearchJob = JSON.parse(raw);
        if (job.status === "running" || job.status === "pending") {
          const age = now - new Date(job.createdAt).getTime();
          if (age > ORPHAN_THRESHOLD_MS) {
            const failedJob: DeepResearchJob = {
              ...job,
              status: "failed",
              error: "服务重启导致任务中断，积分已退回，请重新发起",
              progress: "❌ 任务因服务重启中断，积分已退回",
            };
            await fs.writeFile(path.join(REPORT_DIR, f), JSON.stringify(failedJob, null, 2));
            if (job.dbRecordId) {
              await dbUpdateRecord(job.dbRecordId, "failed", "❌ 任务因服务重启中断，积分已退回", undefined, "服务重启导致任务中断");
            }
            console.log(`[deepResearch] 🔄 孤儿任务已标记失败: ${job.jobId}`);
          }
        }
      } catch {}
    }
  } catch (e) {
    console.warn("[deepResearch] recoverOrphanedJobs 扫描失败:", e);
  }
}

/** 创建任务（同步写入 Fly 磁盘 + Neon DB，立即响应前端） */
export async function createDeepResearchJob(
  userId: string,
  topic: string,
  creditsUsed = 0,
  productType: DeepResearchProductType = "magazine_single",
): Promise<{ jobId: string; dbRecordId?: number }> {
  const jobId = `dr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 先写 Fly 磁盘（保证一定成功）
  const job: DeepResearchJob = {
    jobId,
    userId,
    topic,
    productType,
    status: "pending",
    progress: "🚀 任务已派发，等待算力节点…",
    createdAt: new Date().toISOString(),
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

  const taskStartMs = Date.now();

  const stages = [
    "📡 突破信息茧房，全网检索行业论文与商业数据…",
    "📊 抓取四平台 Top 变现博主链路与爆款底层逻辑…",
    "🧠 构建底层商业思维链（CoT），推演差异化战略…",
    "✍️ 正在撰写万字商业白皮书，请稍候…",
  ];

  const updateProgress = async (progress: string, status: "running" | "completed" | "failed" = "running") => {
    const latest = (await readJob(jobId)) ?? job;
    await writeJob({ ...latest, status, progress });
    if (latest.dbRecordId) {
      await dbUpdateRecord(latest.dbRecordId, status, progress);
    }
  };

  try {
    await updateProgress(stages[0]);

    const productType = job.productType ?? "magazine_single";
    const dateStr = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long" });

    // ── 個性化分析：先抓取歷史快照做對比 ──────────────────────────────────────
    let historyContext = "此用戶尚無歷史分析記錄。";
    if (productType === "personalized") {
      const snapshots = await getUserReportSnapshots(job.userId);
      if (snapshots.length > 0) {
        historyContext = snapshots
          .map((s) => `[${s.date}] 課題：${s.title}　摘要：${s.summary}`)
          .join("\n");
      }
    }

    const DATA_TABLE_RULES = `
【数据与图表强制规范】（全文必须严格执行，否则视为输出不合格）
1. 每个章节必须包含至少 1 个完整 Markdown 表格，表格须有真实数值（增长率/用户量/转化率/单价等）
2. 平台对比必须以表格形式呈现，覆盖小红书/抖音/B站/快手四平台
3. 所有数据须标注参考时间区间（如：2025Q1、2024年全年等）
4. 核心指标必须给出具体数字，禁止使用"较高""较低""显著"等模糊表述
5. 每章结尾用"📊 数据速查"小节，用表格汇总本章关键数字
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

    const prompt = productType === "personalized"
      ? `你是由哈佛医师、顶尖商业战略顾问与四大平台资深运营专家组成的个性化智库。
${DATA_TABLE_RULES}
【任务：哈佛医师级私人订制 · 深潜分析】

【本次分析课题】
${job.topic}

【用户历史分析快照】（需与以下历史记录进行深度对比，明确指出战略转向）
${historyContext}

【输出结构要求】（严格遵守，每章不少于 500 字）

# 一、历史战略复盘（数据对比看板）

> 与过去记录进行量化对比，找出失效打法与新机会。

| 维度 | 历史策略 | 当前市场现状 | 变化幅度 | 建议动作 |
|------|---------|------------|---------|---------|
| 内容形式 | … | … | … | … |
| 变现路径 | … | … | … | … |
| 目标平台 | … | … | … | … |
| 粉丝增长速度 | … | … | … | … |
| 竞争强度 | … | … | … | … |

需要立即放弃的三个旧有思维（附原因与替代方案）：
1. …
2. …
3. …

📊 数据速查
| 指标 | 历史基准 | 当前均值 | 差距 |
|------|---------|---------|-----|
| … | … | … | … |

# 二、现状 X 光诊断（竞争力雷达）

| 能力维度 | 用户评分(1-10) | 行业头部均值 | 差距 | 优先补强顺序 |
|---------|-------------|-----------|-----|------------|
| 内容生产力 | … | … | … | … |
| 选题命中率 | … | … | … | … |
| 私域转化率 | … | … | … | … |
| 商业变现效率 | … | … | … | … |
| 粉丝粘性 | … | … | … | … |
| 跨平台协同 | … | … | … | … |

📊 数据速查
| 核心短板 | 当前数值 | 目标数值 | 修复周期 |
|---------|---------|---------|---------|
| … | … | … | … |

# 三、10 大战术里程碑（可执行路线图）

| 编号 | 战术目标 | 完成时限 | 所需资源 | 预期量化效果 | 成功判断标准 |
|-----|---------|---------|---------|------------|------------|
| T1 | … | 第1-2周 | … | … | … |
| T2 | … | 第3-4周 | … | … | … |
| T3 | … | 第5-6周 | … | … | … |
| T4 | … | 第7-8周 | … | … | … |
| T5 | … | 第9-10周 | … | … | … |
| T6 | … | 第11-12周 | … | … | … |
| T7 | … | 第13周 | … | … | … |
| T8 | … | 第14周 | … | … | … |
| T9 | … | 第15周 | … | … | … |
| T10 | … | 第16周 | … | … | … |

# 四、四平台协同矩阵（2025年算法解码）

| 平台 | 当前月活(亿) | 推荐算法核心逻辑 | 最佳内容形式 | 最佳发布时段 | 变现路径 | 客单价区间 |
|-----|------------|--------------|-----------|-----------|---------|---------|
| 小红书 | … | … | … | … | … | … |
| 抖音 | … | … | … | … | … | … |
| B站 | … | … | … | … | … | … |
| 快手 | … | … | … | … | … | … |

跨平台协同引流路径图（用文字拓扑描述）：
> 小红书种草 → 抖音放大 → B站沉淀 → 快手下沉

📊 数据速查
| 平台 | 本赛道平均涨粉速度 | 头部账号月收入区间 | 流量成本 |
|-----|----------------|----------------|--------|
| … | … | … | … |

# 五、商业转化漏斗（ROI 最大化公式）

## 转化漏斗数据

| 阶段 | 转化率行业均值 | 头部账号转化率 | 优化杠杆 |
|-----|-------------|-------------|---------|
| 曝光→点击 | …% | …% | … |
| 点击→关注 | …% | …% | … |
| 关注→私域 | …% | …% | … |
| 私域→成交 | …% | …% | … |
| 成交→复购 | …% | …% | … |

## 定价策略对标

| 产品类型 | 建议定价区间 | 竞品均价 | 溢价空间 | 推荐定价理由 |
|---------|-----------|---------|---------|-----------|
| 引流品 | … | … | … | … |
| 主力品 | … | … | … | … |
| 高端品 | … | … | … | … |

📊 数据速查
| 指标 | 目标值 | 实现路径 |
|-----|-------|---------|
| 月销售额 | ¥… | … |
| 粉丝变现率 | …% | … |
| 复购率 | …% | … |

# 六、内容灵魂注入（差异化人设公式）

内容差异化矩阵：
| 维度 | 头部玩家做法 | 本账号差异化方向 | 预期效果 |
|-----|-----------|--------------|---------|
| 人设标签 | … | … | … |
| 内容调性 | … | … | … |
| 视觉风格 | … | … | … |
| 互动方式 | … | … | … |
| 专业背书 | … | … | … |

# 七、90天行动白皮书

| 阶段 | 时间 | 核心任务 | KPI目标 | 关键动作清单 |
|-----|-----|---------|--------|-----------|
| 重启期 | 第1-30天 | … | 涨粉…人，变现¥… | … |
| 爆发期 | 第31-60天 | … | 涨粉…人，变现¥… | … |
| 收割期 | 第61-90天 | … | 涨粉…人，变现¥… | … |

要求：用哈佛医师般的严谨、外科手术般的精确，每一个数字都要有依据，让读者读完立刻有颠覆认知的冲动。`
      : `你是一个由哈佛商学院战略顾问、顶尖社媒运营专家和行业数据分析师组成的商业智库团队。
${DATA_TABLE_RULES}
【任务：${dateStr} 战略半月刊 · 最新赛道趋势深度解析】

【研究课题】
${job.topic}

【输出结构要求】（严格遵守以下章节结构，每章不少于 500 字）

# 一、行业全景扫描（宏观趋势与市场规模）

## 市场规模与增速

| 年份 | 市场规模 | YoY增速 | 关键驱动事件 |
|-----|---------|--------|-----------|
| 2023 | … | …% | … |
| 2024 | … | …% | … |
| 2025E | … | …% | … |
| 2026F | … | …% | … |

## SWOT 战略矩阵

| | 优势(S) | 劣势(W) |
|--|--------|--------|
| **机会(O)** | SO战略：… | WO战略：… |
| **威胁(T)** | ST战略：… | WT战略：… |

## 细分赛道机会热力图

| 细分赛道 | 市场空间 | 竞争强度 | 变现难度 | 综合评分 | 建议 |
|---------|---------|---------|---------|---------|-----|
| … | … | 高/中/低 | 高/中/低 | …/10 | 进入/观望/回避 |
| … | … | … | … | … | … |
| … | … | … | … | … | … |

📊 数据速查
| 关键指标 | 数值 | 数据来源 |
|---------|-----|---------|
| 赛道总规模 | ¥… | … |
| 年增速 | …% | … |
| 头部集中度CR5 | …% | … |

# 二、用户心理图谱（高转化底层逻辑）

## 目标人群画像

| 维度 | 核心用户群A | 核心用户群B | 潜力用户群C |
|-----|-----------|-----------|-----------|
| 年龄段 | … | … | … |
| 性别比 | … | … | … |
| 月均可支配收入 | ¥… | ¥… | ¥… |
| 核心痛点 | … | … | … |
| 核心欲望 | … | … | … |
| 内容消费时段 | … | … | … |
| 决策周期 | … | … | … |

## 消费决策触发器

| 触发因子 | 权重占比 | 激活方式 | 典型文案钩子 |
|---------|---------|---------|-----------|
| … | …% | … | "…" |
| … | …% | … | "…" |
| … | …% | … | "…" |

📊 数据速查
| 用户行为指标 | 行业均值 | 头部账号 |
|-----------|---------|---------|
| 单视频平均观看时长 | …s | …s |
| 内容→关注转化率 | …% | …% |
| 评论互动率 | …% | …% |

# 三、四平台头部玩家拆解（变现链路全解剖）

## 平台基础数据对比（2025年）

| 平台 | 月活用户 | 本赛道创作者数 | 赛道头部粉丝量级 | 平均CPM | 主要变现形式 |
|-----|---------|-------------|--------------|--------|-----------|
| 小红书 | …亿 | …万 | …万 | ¥… | … |
| 抖音 | …亿 | …万 | …万 | ¥… | … |
| B站 | …亿 | …万 | …万 | ¥… | … |
| 快手 | …亿 | …万 | …万 | ¥… | … |

## 头部账号变现模式解剖

| 账号类型 | 粉丝规模 | 月均收入 | 主要收入来源占比 | 内容更新频率 | 爆款公式 |
|---------|---------|---------|--------------|-----------|---------|
| 超头部(500万+) | 500万+ | ¥…万 | 广告…%/自营…%/知识…% | …次/周 | … |
| 腰部(50-500万) | 50-500万 | ¥…万 | … | …次/周 | … |
| 新锐(10-50万) | 10-50万 | ¥…万 | … | …次/周 | … |

📊 数据速查
| 对标指标 | 目标值 | 实现时限 |
|---------|-------|---------|
| 粉丝量 | …万 | …个月 |
| 月收入 | ¥… | …个月 |
| 爆款命中率 | …% | … |

# 四、差异化破局方案（降维打击战术）

## 蓝海机会矩阵

| 未被满足的需求 | 当前供给缺口 | 目标用户规模 | 变现潜力 | 进入难度 |
|-------------|-----------|-----------|---------|---------|
| … | … | …万人 | 高/中/低 | 高/中/低 |
| … | … | …万人 | … | … |
| … | … | …万人 | … | … |

## 内容矩阵规划

| 内容类型 | 发布占比 | 发布频率 | 目标效果 | 参考标杆 |
|---------|---------|---------|---------|---------|
| 引流爆款 | …% | …次/周 | 涨粉 | … |
| 专业深度 | …% | …次/周 | 建立信任 | … |
| 变现转化 | …% | …次/周 | 直接成交 | … |
| 互动维护 | …% | …次/周 | 提升粘性 | … |

📊 数据速查
| 差异化维度 | 竞争对手 | 本账号定位 |
|----------|---------|---------|
| … | … | … |

# 五、商业变现路径（PMF 最短路径）

## 分阶段变现路线图

| 成长阶段 | 粉丝规模 | 预计周期 | 主要变现方式 | 月收入预估 | 核心动作 |
|---------|---------|---------|-----------|---------|---------|
| 冷启动期 | 0-1000 | …个月 | … | ¥…-… | … |
| 成长期 | 0.1-5万 | …个月 | … | ¥…-… | … |
| 加速期 | 5-20万 | …个月 | … | ¥…-… | … |
| 成熟期 | 20-100万 | …个月 | … | ¥…万+ | … |

## 私域变现漏斗

| 漏斗层级 | 典型转化率 | 优化关键点 |
|---------|---------|---------|
| 曝光→关注 | …% | … |
| 关注→私域 | …% | … |
| 私域→首购 | …% | … |
| 首购→复购 | …% | … |

📊 数据速查
| 变现指标 | 行业中位数 | 头部账号 | 90天目标 |
|---------|---------|---------|---------|
| 粉丝变现率 | …% | …% | …% |
| 客单价 | ¥… | ¥… | ¥… |
| 月复购率 | …% | …% | …% |

# 六、30天冲刺行动手册

| 时间段 | 核心主题 | 每日必做动作 | 阶段KPI | 成功标准 |
|-------|---------|-----------|-------|---------|
| 第1-7天 | 账号冷启动 | … | 发布…条，涨粉…人 | … |
| 第8-14天 | 爆款复制 | … | 发布…条，涨粉…人 | … |
| 第15-21天 | 私域搭建 | … | 导流…人入私域 | … |
| 第22-30天 | 商业化初测 | … | 成交¥…，复购率…% | … |

# 七、核武级战略总结

## 三大核心洞察

> 每条洞察必须附一个具体数据点支撑

1. **洞察一**：…（数据：…）
2. **洞察二**：…（数据：…）
3. **洞察三**：…（数据：…）

## 90天里程碑目标

| 里程碑 | 时间节点 | 量化目标 | 验证方式 |
|-------|---------|---------|---------|
| M1 | 第30天 | 粉丝…人，发布…条 | … |
| M2 | 第60天 | 粉丝…人，月收入¥… | … |
| M3 | 第90天 | 粉丝…人，月收入¥… | … |

> 💡 下一步：订制专属"尊享季度私人订制"分析，解锁与您历史数据的深度对比和个性化战略大升级。

要求：每个数字必须真实可查，每个表格必须完整填写，不得留空或用"待定"代替。语言专业有力，让读者读完立刻有付诸行动的冲动。`;

    await updateProgress(stages[1]);
    await sleep(2000);
    await updateProgress(stages[2]);

    const reportMarkdown = await generate("gemini-2.5-pro", prompt);

    if (!reportMarkdown || reportMarkdown.length < 500) {
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

    // 3. 注入趋势图（半月刊专属，插在报告正文前）
    const finalReportMarkdown = trendChartBlock
      ? trendChartBlock + reportMarkdown
      : reportMarkdown;

    // 4. 摘要（取正文开头 200 字，去除 Markdown 符号）
    const summary = reportMarkdown.replace(/#{1,6}\s/g, "").replace(/[*`>_\-|]/g, "").trim().slice(0, 200) + "…";

    // 5. 耗时（分钟）
    const duration = ((Date.now() - taskStartMs) / 1000 / 60).toFixed(1);

    // ── 完成：写 Fly 磁盘 ─────────────────────────────────────────────────────
    const latest = (await readJob(jobId)) ?? job;
    const doneMsg = productType === "personalized"
      ? "✅ 尊享季度私人订制分析完成，您的专属战略已就绪"
      : "✅ 战略半月刊生成完毕，可在下方查阅";
    await writeJob({
      ...latest,
      status: "completed",
      progress: doneMsg,
      reportMarkdown: finalReportMarkdown,
      completedAt: new Date().toISOString(),
    });

    // ── 完成：写 Neon DB（含封面、摘要、灯塔标题）────────────────────────────
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

    console.log(`[deepResearch] ✅ 任务 ${jobId} 完成，字符数: ${reportMarkdown.length}，耗时 ${duration} min`);

  } catch (err: any) {
    console.error(`[deepResearch] ❌ 任务 ${jobId} 失败:`, err?.message);
    const latest = (await readJob(jobId)) ?? job;
    await writeJob({
      ...latest,
      status: "failed",
      error: err?.message || "未知错误",
      progress: "❌ 战报生成失败，积分已退回",
    });
    if (latest.dbRecordId) {
      await dbUpdateRecord(latest.dbRecordId, "failed", "❌ 战报生成失败，积分已退回", undefined, err?.message || "未知错误");
    }
  }
}
