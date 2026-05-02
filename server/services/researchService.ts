/**
 * 竞品调研双引擎服务 — Google AI Studio 版本
 * Stage 1: gemma-4-31b-it  (竞品底层特征扫描)
 * Stage 2: gemini-3.1-pro-preview  (差异化战略处方生成)
 *
 * 使用 GEMINI_API_KEY (AI Studio)，不依赖 Vertex AI / GCP 私钥
 * 结合 /data/growth/platform-current/{platform}.current.json 真实平台数据
 */
import fs from "fs/promises";
import path from "path";
import { readTrendStoreForPlatforms } from "../growth/trendStore";

const BACKUP_DIR = "/data/growth/research";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 直接 HTTP 调用 Google AI Studio (Gemini API)
 * 避免 @google/genai SDK 对中文的 ByteString 编码问题
 */
async function generate(model: string, prompt: string, retries = 2): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
  });

  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    const json: any = await res.json().catch(() => ({}));

    if (res.status === 429 && i < retries) {
      console.log(`[researchService] 429 rate limit，${5 * (i + 1)}s 后重试...`);
      await sleep(5000 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${model} API ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    return String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "");
  }
  return "";
}

export interface ResearchScene {
  sceneNumber: number;
  copywriting: string;
  visualPrompt: string;
  /** 角色口播台词 + 动作拟音（直接传给 Veo，不含 BGM） */
  audioPrompt: string;
  /** 背景音乐战略提示词（预留给 Suno，不传给 Veo） */
  bgmPrompt: string;
}

export interface ResearchStrategy {
  overallStrategy?: string;
  scenes?: ResearchScene[];
  positioning?: string;
  scripts?: Array<{ title: string; hook: string; copywriting: string }>;
  visuals?: { colorPalette?: string[]; typography?: string; layoutGuide?: string };
  publishStrategy?: string;
  growthPlan30Days?: string;
  platform?: string;
  platformLabel?: string;
  generatedAt?: string;
  raw?: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  xiaohongshu: "小红书",
  bilibili: "B站",
};

/**
 * 从本地平台数据库读取当前热门趋势，作为市场背景注入提示词
 */
async function buildPlatformContext(platform: string): Promise<string> {
  try {
    const store = await readTrendStoreForPlatforms([platform as any], { preferDerivedFiles: true });
    const validPlatforms = ["douyin","kuaishou","xiaohongshu","bilibili","weixin_channels","toutiao"] as const;
    type VP = typeof validPlatforms[number];
    const key = platform as VP;
    const collection = validPlatforms.includes(key) ? store.collections?.[key] : undefined;
    if (!collection?.items?.length) return "";

    // 取最热的 30 条（按 hotValue desc，降级到 likes）
    const top30 = [...collection.items]
      .sort((a, b) => (Number((b as any).hotValue || (b as any).likes || 0)) - (Number((a as any).hotValue || (a as any).likes || 0)))
      .slice(0, 30);

    const titleList = top30.map((item: any, i: number) =>
      `${i + 1}. 【${item.title}】 热度:${item.hotValue || item.likes || 0} 标签:${((item.tags || []) as string[]).slice(0, 4).join("/")}`,
    ).join("\n");

    // 高频标签统计
    const tagFreq: Record<string, number> = {};
    for (const item of (collection.items as any[]).slice(0, 2000)) {
      for (const tag of ((item.tags || []) as string[])) {
        tagFreq[String(tag)] = (tagFreq[String(tag)] || 0) + 1;
      }
    }
    const topTags = Object.entries(tagFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, cnt]) => `${tag}(${cnt})`)
      .join("、");

    return `\n\n【平台数据库背景 — ${PLATFORM_LABEL[platform] || platform}，共 ${collection.items.length} 条实时数据】
当前平台TOP 30热门内容：
${titleList}

平台高频标签TOP 20：${topTags}`;
  } catch (err: any) {
    console.warn("[researchService] 读取平台数据失败（non-fatal）:", err?.message);
    return "";
  }
}

/**
 * 执行双引擎竞品调研（不含扣费，由 tRPC router 管理）
 */
const MAX_CONTENT_CHARS = 5000;

export async function runResearch(
  userId: string,
  platform: string,
  competitorData: string,
): Promise<ResearchStrategy> {
  if (competitorData.length > MAX_CONTENT_CHARS) {
    throw new Error(`字数超过 ${MAX_CONTENT_CHARS} 字限制（当前 ${competitorData.length} 字），请精简后再试`);
  }
  const label = PLATFORM_LABEL[platform] || platform;

  // 并行：读取平台实时数据库上下文
  console.log(`[researchService] 读取 ${label} 平台数据库...`);
  const platformContext = await buildPlatformContext(platform);
  if (platformContext) {
    console.log(`[researchService] 平台背景注入成功，数据长度: ${platformContext.length}`);
  }

  // ── Stage 1: Gemma 4 31B IT ─ 底层流量特征扫描（含平台真实数据） ──
  console.log(`[researchService] Stage 1 Gemma 4 启动 (${label})`);
  let stage1Raw = "";
  try {
    stage1Raw = await generate(
      "gemma-4-31b-it",
      `你是一位顶级内容策略师。请对以下${label}竞品内容进行深度扫描，提炼：
1. 爆款逻辑拆解（流量钩子、情绪触发点、内容结构）
2. 视觉风格特征（色调、排版、封面设计模式）
3. 受众画像与算法适配特征
4. 高频词汇与标签矩阵
${platformContext}

竞品数据：${competitorData}

输出格式：JSON，字段：hookLogic, visualStyle, audienceProfile, keywordMatrix, topPatterns`,
    );
    console.log(`[researchService] Stage 1 完成，字符数: ${stage1Raw.length}`);
  } catch (err: any) {
    // Gemma 4 不可用时，Stage 1 改用 gemini-3.1-pro-preview（与 Stage 2 同档，不再走 flash）
    console.warn(`[researchService] Gemma 4 失败 (${err?.message})，Stage 1 降级至 gemini-3.1-pro-preview`);
    stage1Raw = await generate(
      "gemini-3.1-pro-preview",
      `作为顶级内容策略师，深度分析${label}竞品内容特征，结合以下平台实时热门数据提取流量密码：
${platformContext}

竞品输入：${competitorData}

输出JSON：{hookLogic,visualStyle,audienceProfile,keywordMatrix,topPatterns}`,
    );
  }

  // ── Stage 2: Gemini 3.1 Pro ─ 差异化战略处方 + 分镜场景（含平台数据） ────
  console.log(`[researchService] Stage 2 Gemini 3.1 Pro 启动`);
  const stage2Raw = await generate(
    "gemini-3.1-pro-preview",
    `你是集成了哈佛商学院竞争战略与${label}平台算法的顶级IP策略师，同时担任多模态视听导演。

【竞品扫描报告（Stage 1）】
${stage1Raw}
${platformContext}

为创作者生成「降维打击」竞争处方。请严格以 JSON 格式输出，结构如下：

{
  "overallStrategy": "整体账号定位与差异化战术分析（200字以内）",
  "scenes": [
    {
      "sceneNumber": 1,
      "copywriting": "【开场钩子】完整文案内容，融合平台高频热词，强情绪触发...",
      "visualPrompt": "高保真参考图生图指令：场景描述、光线、构图、风格、色调（英文优先，50字以内）",
      "audioPrompt": "【仅限角色口播台词与动作拟音，严禁包含背景音乐】角色说出的具体台词 + 场景动作音效描述（例如：角色说'三秒见效，不信你试'，随后听到清脆的点击声和轻微的心跳加速音效）",
      "bgmPrompt": "【背景音乐战略，预留给 Suno 使用，不传给 Veo】BPM、曲风、情绪、乐器组合（例如：BPM 118，治愈系钢琴+低频电子合成器，情绪：从紧张到释然的弧线）"
    }
  ],
  "visuals": {
    "colorPalette": ["#HEX1", "#HEX2", "#HEX3"],
    "typography": "字体风格描述",
    "layoutGuide": "封面构图建议"
  },
  "publishStrategy": "最优发布时间、频次、推荐话题标签",
  "growthPlan30Days": "分阶段30天行动清单"
}

核心要求（必须严格遵守）：
- audioPrompt 与 bgmPrompt 必须完全分离，audioPrompt 只包含角色人声+动作音效，bgmPrompt 只包含背景音乐战略
- 每个场景 audioPrompt 需含具体可朗读的台词文本，以确保 Veo 能实现精准对口型
- 每个场景 bgmPrompt 需含 BPM 数字、曲风关键词、情绪弧线，确保 Suno 可直接使用
- scenes 数组生成 3 到 5 个场景
- visualPrompt 必须为英文生图提示词
- 优先使用平台实时高频标签和热词
- 严格 JSON 格式，不要输出 JSON 之外的任何内容`,
  );
  console.log(`[researchService] Stage 2 完成，字符数: ${stage2Raw.length}`);

  // 解析 JSON 处方
  const cleaned = stage2Raw.replace(/```json\n?|\n?```/g, "").trim();
  let strategy: ResearchStrategy;
  try {
    strategy = JSON.parse(cleaned);
  } catch {
    strategy = { raw: stage2Raw };
  }
  strategy.platform = platform;
  strategy.platformLabel = label;
  strategy.generatedAt = new Date().toISOString();

  // ── 写入 Fly 本地持久化（/data/growth/research）─────────────────────
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const filename = path.join(BACKUP_DIR, `res_${platform}_${Date.now()}_u${userId}.json`);
    await fs.writeFile(filename, JSON.stringify({ userId, platform, stage1Raw, strategy, timestamp: strategy.generatedAt }, null, 2));
    console.log(`[researchService] Fly 原始数据写入: ${filename}`);
  } catch (e: any) {
    console.error("[researchService] Fly 存储失败（non-fatal）:", e?.message);
  }

  return strategy;
}
