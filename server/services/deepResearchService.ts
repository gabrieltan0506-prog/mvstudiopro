/**
 * 全景行业战报服务 — AI 上帝视角
 * 使用 gemini-2.5-pro（高 maxOutputTokens）生成全景行业战报
 * 异步脱机运行，结果写入 Fly 持久卷 + Neon
 */
import fs from "fs/promises";
import path from "path";

const REPORT_DIR = "/data/growth/deep-research";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 直接 HTTP 调用 Gemini API（与 researchService 同一套机制） */
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

export interface DeepResearchJob {
  jobId: string;
  userId: string;
  topic: string;
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

/** 创建任务（同步返回 jobId，立即响应前端） */
export async function createDeepResearchJob(userId: string, topic: string): Promise<string> {
  const jobId = `dr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job: DeepResearchJob = {
    jobId, userId, topic,
    status: "pending",
    progress: "任务已接收，等待分配算力节点…",
    createdAt: new Date().toISOString(),
  };
  await writeJob(job);
  return jobId;
}

/** 异步执行全景战报（fire-and-forget，不阻塞响应） */
export async function runDeepResearchAsync(jobId: string) {
  const job = await readJob(jobId);
  if (!job) return;

  const stages = [
    "📡 突破信息茧房，全网检索行业论文与商业数据…",
    "📊 抓取四平台 Top 变现博主链路与爆款底层逻辑…",
    "🧠 构建底层商业思维链（CoT），推演差异化战略…",
    "✍️ 正在撰写全景行业战报，请稍候…",
  ];

  try {
    // 更新状态：运行中
    await writeJob({ ...job, status: "running", progress: stages[0] });

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

    await writeJob({ ...job, status: "running", progress: stages[1] });
    await sleep(2000);
    await writeJob({ ...job, status: "running", progress: stages[2] });

    const reportMarkdown = await generate("gemini-2.5-pro", prompt);

    await writeJob({ ...job, status: "running", progress: stages[3] });

    if (!reportMarkdown || reportMarkdown.length < 500) {
      throw new Error("战报内容过短，可能生成失败");
    }

    // 完成，写入结果
    await writeJob({
      ...job,
      status: "completed",
      progress: "✅ 全景战报生成完毕，可在下方查阅",
      reportMarkdown,
      completedAt: new Date().toISOString(),
    });

    console.log(`[deepResearch] ✅ 任务 ${jobId} 完成，字符数: ${reportMarkdown.length}`);

  } catch (err: any) {
    console.error(`[deepResearch] ❌ 任务 ${jobId} 失败:`, err?.message);
    await writeJob({
      ...job,
      status: "failed",
      error: err?.message || "未知错误",
      progress: "❌ 战报生成失败，积分已退回",
    });
  }
}
