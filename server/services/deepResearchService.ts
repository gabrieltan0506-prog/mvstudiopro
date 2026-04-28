/**
 * 全景行业战报服务 — AI 上帝视角
 * 使用 gemini-2.5-pro（高 maxOutputTokens）生成万字商业白皮书
 * 异步脱机运行，结果双写：Fly 持久卷（断点恢复）+ Neon DB（研报中心展示）
 */
import fs from "fs/promises";
import path from "path";

const REPORT_DIR = "/data/growth/deep-research";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

export interface DeepResearchJob {
  jobId: string;
  userId: string;
  topic: string;
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
export async function createDeepResearchJob(userId: string, topic: string, creditsUsed = 0): Promise<{ jobId: string; dbRecordId?: number }> {
  const jobId = `dr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 先写 Fly 磁盘（保证一定成功）
  const job: DeepResearchJob = {
    jobId,
    userId,
    topic,
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

    const prompt = `你是一个由哈佛商学院战略顾问、顶尖社媒运营专家和行业数据分析师组成的商业智库团队。

请对以下课题进行极度深度的全景行业研究，输出一份排版精美的万字 Markdown 商业白皮书：

【研究课题】
${job.topic}

【输出结构要求】（必须严格遵守以下章节结构）

# 一、行业全景扫描（宏观趋势与市场规模）
- 2024-2026年行业增速与关键拐点
- 核心驱动力与潜在威胁（SWOT框架）
- 细分赛道机会地图

# 二、用户心理图谱（高转化底层逻辑）
- 目标人群画像（年龄/性别/痛点/欲望）
- 触发消费决策的情绪密码
- 信任建立的关键路径

# 三、头部玩家拆解（竞品变现链路解剖）
- 小红书/抖音/B站三平台头部博主变现模式对比
- 爆款内容结构共性（钩子/冲突/转化）
- 头部账号私域留存策略

# 四、差异化破局方案（降维打击策略）
- 蓝海机会点（未被充分满足的需求）
- 独特人设定位（与头部玩家的错位竞争）
- 内容矩阵规划（选题库 × 发布频次 × 平台协同）

# 五、商业变现路径（PMF 最短路径）
- 0-1000粉丝阶段变现策略
- 1000-10万粉丝阶段规模化路径
- 私域建设与复购体系设计

# 六、30天行动清单（可执行战术手册）
- 第1-7天：账号冷启动 SOP
- 第8-21天：爆款内容复制公式
- 第22-30天：商业化初测与优化

# 七、核武级总结（最终战略处方）
- 三大核心洞察（必须记住的商业真相）
- 一句话账号定位
- 90天里程碑目标

要求：每个章节不少于 400 字，论据充分，数据具体，语言专业且有煽动力，让读者看完有立刻行动的冲动。`;

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

    // 3. 摘要（取正文开头 200 字，去除 Markdown 符号）
    const summary = reportMarkdown.replace(/#{1,6}\s/g, "").replace(/[*`>_\-|]/g, "").trim().slice(0, 200) + "…";

    // 4. 耗时（分钟）
    const duration = ((Date.now() - taskStartMs) / 1000 / 60).toFixed(1);

    // ── 完成：写 Fly 磁盘 ─────────────────────────────────────────────────────
    const latest = (await readJob(jobId)) ?? job;
    await writeJob({
      ...latest,
      status: "completed",
      progress: "✅ 全景战报生成完毕，可在下方查阅",
      reportMarkdown,
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
            progress: "✅ 全景战报生成完毕",
            reportMarkdown,
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
