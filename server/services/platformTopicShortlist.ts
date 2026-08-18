/**
 * 选题初选（20）与勾选扩写（5–6）LLM 服务。
 */
import { nanoid } from "nanoid";
import { extractFirstChoicePlainText, invokeLLM, isTransientLlmError } from "../_core/llm.js";
import { getPlatformStage2OpenAiModel } from "../config/platformSwitches.js";
import { TRPCError } from "@trpc/server";
import {
  PLATFORM_TOPIC_EXPAND_MAX,
  PLATFORM_TOPIC_EXPAND_MIN,
  PLATFORM_TOPIC_SHORTLIST_DEFAULT,
  clampTopicShortlistCount,
  buildGraphicNotePagesFromBlueprint,
  dedupeTopicShortlist,
  deriveTopicDedupeKey,
  ensureAuthorityCiteInCopy,
  normalizeCommentHook,
  platformTopicShortlistItemSchema,
  rankTopicShortlistByViralScore,
  normalizePlatformTopicExpandEngine,
  type PlatformTopicExpandEngineId,
  type PlatformTopicShortlistItem,
} from "../../shared/platformTopicShortlist.js";
import { ensureMedicalResourceCiteInCopy } from "../../shared/medicalResourceLibrary.js";
import {
  planDiverseBlueprintSkillRoutes,
  resolveSkillPoolIds,
  routePlatformSkillIdsForLane,
  type PlatformSkillLane,
} from "../../shared/platformSkillRouter.js";
import { listAllPlatformSkillsForUser, composePlatformSkillsPromptBlock } from "./platformSkillsService.js";
import { PLATFORM_HIGH_CTR_TITLE_COVER_GUIDANCE } from "../../shared/platformCreatorInsightFraming.js";
import {
  buildStoryboardCellsFromStepScript,
  normalizePlatformStoryboardCells,
} from "../../shared/platformStoryboardCells.js";
import { platformEngineEffort } from "../../shared/platformEngineTiers.js";
import {
  platformTopicGoalLabel,
  platformTopicGoalPromptLine,
} from "../../shared/platformPersonaPolish.js";

/**
 * 初选的推理档。
 *
 * 用户 2026-08-06：「选题用 medium 就好，吐出来给用户再用 high 来润色即可，这样快一点也省钱」。
 * 当前初选跑在卓越档（Kimi K3）上，它的三级是 low|high|max，中档即 high——
 * 旧代码一直发 max，是这条链最慢也最贵的一环。
 */
const SHORTLIST_REASONING_EFFORT = platformEngineEffort("shortlist", "superb");

/**
 * 免费试跑的用量键。
 *
 * 单独记一条日志而不是查扣费记录：免费那次扣 0 积分，`deductCreditsAmount`
 * 在 0 的时候直接返回、什么都不写，光靠扣费流水数不出「头 3 次 + 每天 1 次」。
 */
export const PLATFORM_TOPIC_SHORTLIST_FREE_ACTION = "platformTopicShortlistFree";

function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function countPlatformTopicShortlistFreeEver(userId: number): Promise<number> {
  const { getDb } = await import("../db.js");
  const { stripeUsageLogs } = await import("../../drizzle/schema.js");
  const { and, count, eq } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ c: count() })
    .from(stripeUsageLogs)
    .where(
      and(
        eq(stripeUsageLogs.userId, userId),
        eq(stripeUsageLogs.action, PLATFORM_TOPIC_SHORTLIST_FREE_ACTION),
      ),
    );
  return Number(row?.c || 0);
}

export async function countPlatformTopicShortlistFreeToday(userId: number): Promise<number> {
  const { getDb } = await import("../db.js");
  const { stripeUsageLogs } = await import("../../drizzle/schema.js");
  const { and, count, eq, gte } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ c: count() })
    .from(stripeUsageLogs)
    .where(
      and(
        eq(stripeUsageLogs.userId, userId),
        eq(stripeUsageLogs.action, PLATFORM_TOPIC_SHORTLIST_FREE_ACTION),
        gte(stripeUsageLogs.createdAt, startOfTodayLocal()),
      ),
    );
  return Number(row?.c || 0);
}

export async function logPlatformTopicShortlistFreeUse(params: {
  userId: number;
  topics: number;
  masked: number;
}): Promise<void> {
  const { getDb } = await import("../db.js");
  const { stripeUsageLogs } = await import("../../drizzle/schema.js");
  const db = await getDb();
  if (!db) return;
  await db.insert(stripeUsageLogs).values({
    userId: params.userId,
    action: PLATFORM_TOPIC_SHORTLIST_FREE_ACTION,
    creditsCost: 0,
    isFreeQuota: 1,
    description: `选题免费试跑 ${params.topics} 条（另有 ${params.masked} 条未生成待解锁）`,
    balanceAfter: null,
  });
}

function extractJsonObject(raw: string): unknown {
  const t = String(raw || "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    /* fallthrough */
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/** 本机趋势读盘上限（不再打冷仓；仍加竞速以免偶发卡死） */
const SHORTLIST_TREND_READ_TIMEOUT_MS = 5_000;

type ShortlistTrendBrief = {
  platform: "xiaohongshu" | "bilibili" | "douyin";
  role: "主参考" | "辅参考";
  hotTitles: string[];
  hotTags: string[];
  /** 评论区最热的一批：不看总热度，只看「大家有多想留言」 */
  commentHotTitles: Array<{ title: string; comments: number; commentPerThousandLikes: number | null }>;
};

/**
 * 按用户选的时间窗口裁热门样本。
 *
 * 没有 publishedAt 的一律保留（平台改个时间格式就清空整池太脆）；裁完剩太少
 * （不足三成且不足 20 条）就退回不裁——宁可题贴得旧一点，也别让初选完全没有热点支撑。
 */
function filterTrendRowsToWindow(
  rows: Array<Record<string, unknown>>,
  windowDays?: number | null,
): Array<Record<string, unknown>> {
  const days = Number(windowDays);
  if (!Number.isFinite(days) || days <= 0 || !rows.length) return rows;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const kept = rows.filter((r) => {
    const raw = r.publishedAt ?? r.createdAt ?? r.collectedAt;
    const at = raw ? new Date(String(raw)).getTime() : Number.NaN;
    if (!Number.isFinite(at)) return true;
    return at >= cutoff;
  });
  if (kept.length >= 20 || kept.length >= Math.ceil(rows.length * 0.3)) return kept;
  return rows;
}

/**
 * 初选前先查本机热门样本：小红书主、B站+抖音辅。
 * 只读 volume 本地文件，**不打冷仓**；读失败返回空数组继续出题。
 */
async function readShortlistTrendBriefs(windowDays?: number | null): Promise<{
  briefs: ShortlistTrendBrief[];
  status: "ok" | "timeout" | "error" | "empty";
}> {
  const platforms = [
    { platform: "xiaohongshu" as const, role: "主参考" as const, titleCap: 30 },
    { platform: "bilibili" as const, role: "辅参考" as const, titleCap: 20 },
    { platform: "douyin" as const, role: "辅参考" as const, titleCap: 20 },
  ];
  try {
    const { readLocalTrendCollectionsForPlatforms } = await import("../growth/trendStore.js");
    /**
     * 逐平台读、各自计时：库里有哪个就用哪个（用户 2026-08-06）。
     * 旧写法是三平台一起 race 一个 5 秒闸门，小红书慢一点就把 B站 / 抖音的现成数据一起丢掉，
     * 结果整批题都没有热点支撑。
     */
    const perPlatform = await Promise.all(
      platforms.map(async ({ platform }) => {
        try {
          const got = await Promise.race([
            readLocalTrendCollectionsForPlatforms([platform]),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), SHORTLIST_TREND_READ_TIMEOUT_MS),
            ),
          ]);
          if (!got) {
            console.warn(`[generatePlatformTopicShortlist] ${platform} 趋势读取超时，跳过该平台`);
            return [platform, undefined] as const;
          }
          return [platform, got[platform]] as const;
        } catch (e) {
          console.warn(
            `[generatePlatformTopicShortlist] ${platform} 趋势读取失败: ${
              e instanceof Error ? e.message.slice(0, 120) : e
            }`,
          );
          return [platform, undefined] as const;
        }
      }),
    );
    const collections = Object.fromEntries(perPlatform) as Record<
      string,
      { items?: unknown } | undefined
    >;
    const timedOutAll = perPlatform.every(([, c]) => !c);
    const briefs: ShortlistTrendBrief[] = [];
    for (const { platform, role, titleCap } of platforms) {
      const items = collections[platform]?.items;
      if (!Array.isArray(items) || !items.length) continue;
      const rows = filterTrendRowsToWindow(items as Array<Record<string, unknown>>, windowDays);
      if (!rows.length) continue;
      const ranked = [...rows].sort(
        (a, b) => Number(b.hotValue || b.likes || 0) - Number(a.hotValue || a.likes || 0),
      );
      const hotTitles = ranked
        .map((r) => String(r.title || "").trim())
        .filter(Boolean)
        .slice(0, titleCap);
      const tagFreq = new Map<string, number>();
      for (const r of ranked.slice(0, 600)) {
        for (const t of Array.isArray(r.tags) ? (r.tags as unknown[]) : []) {
          const tag = String(t || "").trim();
          if (!tag) continue;
          tagFreq.set(tag, (tagFreq.get(tag) || 0) + 1);
        }
      }
      const hotTags = Array.from(tagFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([tag]) => tag);
      // 评论区热度：按评论数排，并给出「每千赞带来多少评论」——纯高赞但没人说话的不算热
      const commentHotTitles = [...rows]
        .filter((r) => Number(r.comments || 0) > 0 && String(r.title || "").trim())
        .sort((a, b) => Number(b.comments || 0) - Number(a.comments || 0))
        .slice(0, 12)
        .map((r) => {
          const comments = Number(r.comments || 0);
          const likes = Number(r.likes || 0);
          return {
            title: String(r.title || "").trim(),
            comments,
            commentPerThousandLikes: likes > 0 ? Math.round((comments / likes) * 1000) : null,
          };
        });
      if (hotTitles.length) briefs.push({ platform, role, hotTitles, hotTags, commentHotTitles });
    }
    if (briefs.length) return { briefs, status: "ok" };
    return { briefs, status: timedOutAll ? "timeout" : "empty" };
  } catch (err) {
    console.warn(
      `[generatePlatformTopicShortlist] 本机趋势读取失败: ${err instanceof Error ? err.message : String(err)}`.slice(
        0,
        200,
      ),
    );
    return { briefs: [], status: "error" };
  }
}

async function resolvePoolAndPrompt(params: {
  userId: number | string;
  enabledSkillIds?: string[] | null;
  skillIds: string[];
  allowBloggerTitle?: boolean;
}): Promise<string> {
  const all = await listAllPlatformSkillsForUser(params.userId);
  const byId = new Map(all.map((s) => [s.id, s]));
  const selected = params.skillIds.map((id) => byId.get(id)).filter(Boolean) as typeof all;
  const { composeBloggerTitlePolicyPrompt } = await import("../../shared/platformNativeVariants.js");
  const blogger = composeBloggerTitlePolicyPrompt(Boolean(params.allowBloggerTitle));
  return [composePlatformSkillsPromptBlock(selected), blogger].filter(Boolean).join("\n\n");
}

export async function generatePlatformTopicShortlist(params: {
  userId: number | string;
  context?: string;
  enabledSkillIds?: string[] | null;
  allowBloggerTitle?: boolean;
  existingTitles?: string[];
  stage1Seeds?: Array<{ title?: string; hook?: string }>;
  /** 生成条数，默认 6，最大见 PLATFORM_TOPIC_SHORTLIST_MAX */
  count?: number | null;
  /** 用户在页面上选的时间窗口：热门样本按它裁，出题才贴当下（用户 2026-08-06） */
  windowDays?: number | null;
  /** 蓝海词（扁平）：初选优先往这些词上靠，别只跟着红海热榜写 */
  blueOceanWords?: string[] | null;
  /** 蓝海词分级：一级是大方向，二级是具体切口——标题落点优先用二级词 */
  blueOceanGroups?: Array<{ primary?: string; secondary?: string[] }> | null;
  /** 这轮想获客/转化/涨粉：决定钩子与结尾动作往哪落（用户 2026-08-06） */
  topicGoal?: string | null;
}): Promise<{ topics: PlatformTopicShortlistItem[]; diagnostics: Record<string, unknown> }> {
  const targetCount = clampTopicShortlistCount(params.count ?? PLATFORM_TOPIC_SHORTLIST_DEFAULT);
  const all = await listAllPlatformSkillsForUser(params.userId);
  const fallbackPoolIds =
    params.enabledSkillIds == null ? all.filter((s) => s.defaultEnabled).map((s) => s.id) : [];
  const poolIds = resolveSkillPoolIds({
    enabledSkillIds: params.enabledSkillIds,
    fallbackPoolIds,
  });

  const dims = Array.from({ length: 6 }, (_, i) => ({
    dimIndex: i,
    dimName: `seed-${i + 1}`,
    seedText: [params.stage1Seeds?.[i]?.title, params.stage1Seeds?.[i]?.hook].filter(Boolean).join(" "),
  }));
  const lanePlan = planDiverseBlueprintSkillRoutes({
    poolIds,
    baseContext: params.context || "",
    dimensions: dims,
  });
  const laneSkillHints = lanePlan.map((p) => ({
    lane: p.lane,
    skills: p.selectedIds,
  }));

  const skillsBlock = await resolvePoolAndPrompt({
    userId: params.userId,
    enabledSkillIds: params.enabledSkillIds,
    skillIds: poolIds.slice(0, 14),
    allowBloggerTitle: params.allowBloggerTitle,
  });

  const { listOfficialCampaigns, pickLinkedCampaignsForTopic, ensureOfficialCampaignSeedsLoaded } = await import(
    "./platformOfficialCampaigns"
  );
  await ensureOfficialCampaignSeedsLoaded();
  const featuredCampaigns = await listOfficialCampaigns({
    platform: "xiaohongshu",
    featuredOnly: true,
  });
  const { briefs: trendBriefs, status: trendStatus } = await readShortlistTrendBriefs(
    params.windowDays,
  );
  const blueOceanGroups = (params.blueOceanGroups || [])
    .map((g) => ({
      primary: String(g?.primary || "").trim(),
      secondary: Array.from(
        new Set(
          (Array.isArray(g?.secondary) ? g!.secondary! : [])
            .map((s) => String(s || "").trim())
            .filter((s) => s.length > 0 && s.length <= 24),
        ),
      ).slice(0, 8),
    }))
    .filter((g) => g.primary.length > 0)
    .slice(0, 12);
  const blueOceanWords = Array.from(
    new Set(
      [
        ...(params.blueOceanWords || []),
        ...blueOceanGroups.flatMap((g) => [g.primary, ...g.secondary]),
      ]
        .map((w) => String(w || "").trim())
        .filter((w) => w.length > 0 && w.length <= 24),
    ),
  ).slice(0, 28);
  const goalPromptLine = platformTopicGoalPromptLine(params.topicGoal);
  const campaignBrief = featuredCampaigns.slice(0, 10).map((c) => ({
    name: c.name,
    category: c.category,
    personaFit: c.personaFit,
    topicHooks: c.topicHooks.slice(0, 2),
  }));

  const system = `你是平台选题初选编辑。只输出 JSON，不要 Markdown。
任务：基于人设与 Skill 池，生成恰好 ${targetCount} 条**互不重复**的选题初选（不是完整长文）。
${PLATFORM_HIGH_CTR_TITLE_COVER_GUIDANCE}
硬约束：
1. 每条必须含：title, hookSketch, conveyGoal, skillsUsed(数组,从池内真实 id 选), primaryLane(fmcg|forensic|crossover|contrast|default), formatHint(图文|短视频), dedupeKey, commentHook(≤3个汉字生活词), linkedCampaigns(1–2个官方活动名，必须从下方 officialCampaigns.name 选)。
2. 同人物/同母题只能出现一次（如王安石、苏轼、深夜高压各最多一条）。
3. skillsUsed 必须能解释这条要传达什么；conveyGoal 写清「要传达的核心」1–2 句。
4. 至少一半 formatHint=图文；赛道尽量拉开（参考 laneHints）。
5. hookSketch 把反差钉再拧紧一句（可比 title 更拧）。**选题结构对齐雪糕公式**：一眼懂生活局 → 痛点1（猫腻/反常识）→ 痛点2（后果）→ 以后会选。conveyGoal 写成能力感（如「以后懂怎么选雪糕」），不要写成「理解添加糖代谢机制」。禁止空壳「博主」自称（除非政策允许）。
6. 对外解法话术用「在这里我先分享一些」，禁止写「半成本/半成品解法」刺耳词。
7. 图文向选题对标高赞合集笔记（m1）：封面「城市+时段+大数字场次+价值钉」；总览墙+细卡；**笔记要丰富（规划 8–12 页）**。短视频向对标 m2：只推3个；字幕一句一钉；**成片约 1.5–2 分钟，硬上限 ≤2 分半**，不要规划成长片。
8. 要有生活画面与烟火气，不是方法论课；优先把官方活动话题与人设方向结合（暑假生活/城市漫步/好物测评/运动日常/读书笔记等）；标题可用 [关键词]｜双拍、自嘲幽默、季节钉子。
9. 同批至少 **60%** 选题 primaryLane=contrast 或标题明显含数字拧巴/结果颠倒/身份错位；禁止整批评「××的正确打开方式」「××注意事项」这类正确无聊题。
10. 钩子气质优先对齐小红书信息流网感，并兼顾 B站/抖音节奏（trend 以小红书为主、B站抖音为辅）。
11. **先读 trendHot 再动笔（硬）**：user JSON 的 \`trendHot\` 是各平台当前热门标题与高频标签（小红书主、B站/抖音辅）。必须先从中找出**正在被讨论的生活话题与情绪**，再改写成本人设能讲的选题。
   - 方向一律取**生活化、趣味化、幽默风趣、容易引起共鸣**：日常场景里的小尴尬、小执念、明知不对还是会做的事、朋友之间会互相转发的那种。
   - **禁止照抄** trendHot 的标题字面；只借话题与情绪。
   - **改不动就别硬套**：某条热门与本人设八竿子打不着时直接放弃，不要强行嫁接成四不像。
12. **反论文腔（硬）**：title 与 hookSketch 要像人说话——口语、有画面、有情绪。禁止「浅析／探究／指南／全解析／方法论／正确打开方式／注意事项／深度解读」这类腔调；禁止把名词堆成学术标题。写完自检一句：这条出现在信息流里，用户是会停下来还是直接划走？会划走就重写。
13. **本轮只出选题，不写文案（硬）**：不要输出正文、脚本、分镜或封面提示词。用户先挑，挑中哪条再单独去写文案与封面。
14. **每条必须给爆款概率**：\`viralScore\`（0–100 整数）与 \`viralReason\`（≤24 字，一句人话说清为什么可能爆）。打分只看三件事——① 是否踩中 \`trendHot\` 里正在被讨论的话题或情绪（命中越准分越高）；② 反差/好奇缺口是否够拧；③ 是否容易引起共鸣、让人想转发给朋友。**分数要拉开**，不要全给 70–80；明显平庸的就给低分。
15. **每条还要给评论区热度**：\`commentHeat\`（0–100 整数）——这条发出去，**评论区会不会有人抢着说话**。参考 \`trendHot[].commentHotTitles\`（按评论数排的样本，\`commentPerThousandLikes\` 是每千赞带来的评论数，这个值高说明是「大家真的想留言」而不只是点赞收藏）。
   高分特征：能站队但不撕裂、有争议但安全；有具体问题可回答；能让人晒自己的经历/家里/同款；求链接求教程求配方；有明确可对号入座的身份（久坐党/带娃的/租房的）。
   低分特征：只能「学到了」然后划走的科普；说完就没下文的结论帖；没有让人接话的口子。
   \`commentHeat\` 与 \`viralScore\` **要分开判断**——有的题很容易转发但没人留言，有的题不见得爆但评论区会炸；两个分数不必一致。
${
  blueOceanWords.length
    ? `16. **蓝海词优先（硬）**：user JSON 的 \`blueOceanWords\` 是本人设算出来的低竞争高潜力词${
        blueOceanGroups.length
          ? `；\`blueOceanGroups\` 给了分级——\`primary\` 是一级大方向，\`secondary\` 是二级具体切口。**标题落点优先用二级词**，一级词只用来定方向，别把一级大词直接当标题写`
          : ""
      }。**至少三分之一**选题要落在这些词覆盖的话题上，命中的在 \`blueOceanHit\` 里写上用到的词（没命中就给空数组）。这些词是用来抢没人写的位置的——不要为了蹭热榜把它们全丢掉，也不要生硬堆词，要把词还原成生活场景再出题。`
    : ""
}
${goalPromptLine ? `17. **本轮目标（硬）**：${goalPromptLine}` : ""}
输出：{ "topics": [ ...恰好${targetCount}条，每条含 viralScore / viralReason / commentHeat${
    blueOceanWords.length ? " / blueOceanHit" : ""
  } ] }`;

  const user = JSON.stringify({
    personaContext: String(params.context || "").slice(0, 6000),
    skillPoolIds: poolIds,
    laneHints: laneSkillHints,
    stage1Seeds: (params.stage1Seeds || []).slice(0, 6),
    avoidTitles: (params.existingTitles || []).slice(0, 40),
    skillsBrief: skillsBlock.slice(0, 8000),
    officialCampaigns: campaignBrief,
    trendHot: trendBriefs,
    ...(blueOceanWords.length ? { blueOceanWords } : {}),
    ...(blueOceanGroups.length ? { blueOceanGroups } : {}),
    ...(goalPromptLine ? { topicGoal: platformTopicGoalLabel(params.topicGoal) } : {}),
    ...(Number(params.windowDays) > 0
      ? { trendWindowDays: Number(params.windowDays), trendWindowNote: "trendHot 已按该窗口裁过" }
      : {}),
  });

  const maxTokens = Math.min(24000, 12000 + Math.max(0, targetCount - 12) * 600);
  const invokeShortlist = () =>
    invokeLLM({
      provider: "openai",
      modelName: getPlatformStage2OpenAiModel(),
      // 20–30 条时输出会明显变长，按条数抬上限，避免 JSON 被截断解析失败
      max_tokens: Math.max(maxTokens, 24_000),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // 用户 2026-08-06：选题用中档就好，快且省；出完再用高档去润色背景
      reasoningEffort: SHORTLIST_REASONING_EFFORT,
    });

  let emptyRetried = false;
  console.info(
    `[generatePlatformTopicShortlist] 开始 LLM count=${targetCount} reasoning=${SHORTLIST_REASONING_EFFORT} model=kimi-k3 trendStatus=${trendStatus} trendPlatforms=${trendBriefs.length}`,
  );
  /**
   * 三次机会：空回与上游抖动（空 200 / 心跳残包）都重试。
   * 2026-08-06 实测 OpenRouter 以 200 返回空 body，旧代码直接抛死，用户面上是「初选失败」。
   */
  let res: Awaited<ReturnType<typeof invokeShortlist>> | null = null;
  let llmText = "";
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await invokeShortlist();
      llmText = extractFirstChoicePlainText(res).trim();
      if (llmText) break;
      emptyRetried = true;
      console.warn(`[generatePlatformTopicShortlist] 空回（max）第 ${attempt} 次`);
    } catch (e) {
      lastErr = e;
      if (!isTransientLlmError(e) || attempt === 3) throw e;
      emptyRetried = true;
      console.warn(
        `[generatePlatformTopicShortlist] 上游抖动重试 ${attempt}/3 · ${
          e instanceof Error ? e.message.slice(0, 160) : e
        }`,
      );
      await new Promise((r) => setTimeout(r, attempt * 4000));
    }
  }
  if (!llmText && lastErr) throw lastErr;
  if (!llmText) {
    console.error(
      "[generatePlatformTopicShortlist] 两次空回 · finish_reason=",
      (res as { choices?: Array<{ finish_reason?: string }> })?.choices?.[0]?.finish_reason,
      "· trendStatus=",
      trendStatus,
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "选题初选模型返回空内容（已自动重试），请稍后重试",
    });
  }
  const parsed = extractJsonObject(llmText) as { topics?: unknown } | null;
  const rawList = Array.isArray(parsed?.topics) ? parsed!.topics : [];
  if (!rawList.length) {
    console.error(
      "[generatePlatformTopicShortlist] JSON 无 topics · preview:",
      llmText.slice(0, 400),
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "选题初选解析失败（模型未返回 topics 数组），请重试",
    });
  }
  const normalized: PlatformTopicShortlistItem[] = [];
  for (const row of rawList) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const title = String(r.title || "").trim();
    if (title.length < 4) continue;
    const lane = (["fmcg", "forensic", "crossover", "contrast", "virtual", "default"].includes(String(r.primaryLane))
      ? String(r.primaryLane)
      : "default") as PlatformSkillLane;
    const routed = routePlatformSkillIdsForLane({
      poolIds,
      lane,
      sheetKind: String(r.formatHint || "").includes("图文") ? "graphic" : "video",
    });
    const skillsUsedRaw = Array.isArray(r.skillsUsed)
      ? r.skillsUsed.map(String).filter(Boolean)
      : routed.selectedIds;
    const skillsUsed = Array.from(
      new Set([...skillsUsedRaw.filter((id) => poolIds.includes(id)), ...routed.selectedIds]),
    ).slice(0, 12);
    const item = {
      id: String(r.id || nanoid(10)).slice(0, 64),
      title: title.slice(0, 120),
      hookSketch: String(r.hookSketch || r.hook || title).slice(0, 200),
      conveyGoal: String(r.conveyGoal || r.goal || "传达可收藏的生活方法").slice(0, 240),
      skillsUsed: skillsUsed.length ? skillsUsed : routed.selectedIds.slice(0, 8),
      primaryLane: lane,
      formatHint: String(r.formatHint || "").includes("短视频") ? ("短视频" as const) : ("图文" as const),
      dedupeKey: String(r.dedupeKey || deriveTopicDedupeKey(title, String(r.hookSketch || ""))).slice(0, 80),
      commentHook: normalizeCommentHook(r.commentHook),
      linkedCampaigns: Array.isArray(r.linkedCampaigns)
        ? r.linkedCampaigns
            .map((x) => {
              if (typeof x === "string") return x.trim();
              if (x && typeof x === "object") {
                const o = x as Record<string, unknown>;
                for (const k of ["name", "title", "label", "text", "campaign"]) {
                  if (typeof o[k] === "string" && String(o[k]).trim()) return String(o[k]).trim();
                }
              }
              return "";
            })
            .filter((s) => s && s !== "[object Object]")
            .slice(0, 4)
        : undefined,
      viralScore: (() => {
        const n = Math.round(Number(r.viralScore));
        return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : undefined;
      })(),
      viralReason: String(r.viralReason || "").trim().slice(0, 24) || undefined,
      commentHeat: (() => {
        const n = Math.round(Number(r.commentHeat));
        return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : undefined;
      })(),
    };
    const checked = platformTopicShortlistItemSchema.safeParse(item);
    if (checked.success) {
      const linked =
        checked.data.linkedCampaigns && checked.data.linkedCampaigns.length
          ? checked.data.linkedCampaigns
          : await pickLinkedCampaignsForTopic({
              lane: checked.data.primaryLane,
              title: checked.data.title,
              formatHint: checked.data.formatHint,
              limit: 2,
            });
      normalized.push({ ...checked.data, linkedCampaigns: linked });
    }
  }

  const topics = rankTopicShortlistByViralScore(
    dedupeTopicShortlist(normalized, {
      existingTitles: params.existingTitles,
      max: targetCount,
    }),
  );

  if (!topics.length) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `选题初选过滤后为空（原始 ${rawList.length} 条 / 校验通过 ${normalized.length} 条），请调整人设或减少已有标题后重试`,
    });
  }

  return {
    topics,
    diagnostics: {
      poolCount: poolIds.length,
      rawCount: rawList.length,
      afterDedupe: topics.length,
      targetCount,
      lanes: topics.map((t) => t.primaryLane),
      trendStatus,
      trendPlatforms: trendBriefs.map((b) => `${b.platform}:${b.hotTitles.length}`),
      trendWindowDays: Number(params.windowDays) > 0 ? Number(params.windowDays) : null,
      blueOceanWordCount: blueOceanWords.length,
      reasoningUsed: "medium",
      emptyRetried,
      viralScores: topics.map((t) => t.viralScore ?? null),
      commentHeats: topics.map((t) => t.commentHeat ?? null),
    },
  };
}

/**
 * 扩写可选引擎：kimi-k3 主走 OpenRouter（Evolink 兜底）；qwen3.8-max 直走 Evolink；
 * deepseek-v4 经济档（2026-08-15 用户拍板）走 OpenRouter，两抖后兜底轻快档。
 * 真源在 shared/platformTopicShortlist（前端/路由/worker 共用归一化，防各自回落 kimi）。
 */
export type PlatformTopicExpandEngine = PlatformTopicExpandEngineId;

const EXPAND_EVOLINK_DIRECT_CHAT_URL = String(
  process.env.EVOLINK_DIRECT_CHAT_COMPLETIONS_URL || "https://direct.evolink.ai/v1/chat/completions",
).trim();

/**
 * 输出封顶：Evolink 的 K3 reasoning_effort 只有 max（强制深思考），
 * 思考 token 全按输出计费。2026-08-12 用户拍板质量优先，上限提到 32k
 *（worst case 单条 ~$0.48，接受偶发毛利下探换文案质量）。
 */
const EXPAND_MAX_COMPLETION_TOKENS = 32_000;
/** Qwen 3.8 Max 输出上限（2026-08-12 用户拍板 65k）：单价低（$5.295/M），给足思考与长稿余量 */
const EXPAND_QWEN_MAX_COMPLETION_TOKENS = 65_536;

/** 经济档模型：$0.435/$0.87 per M，输出价约为 Kimi K3 的 1/17（2026-08-15 同题 PK 质量过关） */
/** DeepSeek 经济档唯一模型常量（审查 2026-08-18 建议2：请求与遥测必须同源，禁止双份定义） */
export const DEEPSEEK_ECONOMY_MODEL = "deepseek/deepseek-v4-pro-0813";
const EXPAND_DEEPSEEK_OR_MODEL = DEEPSEEK_ECONOMY_MODEL;

/**
 * 经济档直连 OpenRouter。口径修正（2026-08-15 用户复核）：推理要开（high，与稳定/轻快档
 * 对等公平，实测质量更强、推理 token 也便宜），教训在「预算」——max_tokens 给 65K
 * （用户实战口径：平时 65K、大批量 200K 也照样便宜），小预算才会被推理吃光正文零字。
 */
/** 请求体独立成函数供测试断言（审查返工 7：65K/推理档/require_parameters 全链可验证） */
export function buildDeepSeekExpandRequestBody(params: {
  system: string;
  user: string;
  /** 可选输出预算；缺省 65_536 维持扩写既有口径（审查 P1-2：报表须传自己的运维配置值） */
  maxTokens?: number;
}): Record<string, unknown> {
  return {
    model: EXPAND_DEEPSEEK_OR_MODEL,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    temperature: 0.55,
    max_tokens: Math.max(8_192, Math.min(65_536, Math.floor(Number(params.maxTokens) || 65_536))),
    response_format: { type: "json_object" },
    reasoning: { effort: "high" },
    // 审查返工 6：不带此标志时 OpenRouter 可能把请求路由给不支持 reasoning/response_format
    // 的供应商并静默忽略参数——强制只选支持全部参数的供应商
    provider: { require_parameters: true },
  };
}

/** DeepSeek 经济档 OpenRouter 响应（choices/usage/model 供上层遥测与解析复用） */
export type DeepSeekJsonChatResponse = {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  provider?: string;
};

/**
 * 通用 DeepSeek 经济档 JSON 对话（扩写与趋势报表共用；2026-08-18 用户拍板报表切经济档）。
 * 返回完整响应对象，content 已通过业务 JSON 验真（截断/过短/非对象一律抛错，不流空壳给下游）。
 */
export async function invokeDeepSeekJsonChatRaw(params: {
  system: string;
  user: string;
  maxTokens?: number;
  /** 上游硬截止（审查 P1-1：报表 job 的 14 分钟 AbortController 必须能掐断本请求） */
  abortSignal?: AbortSignal;
}): Promise<DeepSeekJsonChatResponse> {
  const key = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!key) throw new Error("经济档通道未配置");
  const timeoutSignal = AbortSignal.timeout(240_000);
  const signal = params.abortSignal ? AbortSignal.any([params.abortSignal, timeoutSignal]) : timeoutSignal;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://www.mvstudiopro.com",
      "X-OpenRouter-Title": "MVStudioPro",
    },
    signal,
    body: JSON.stringify(buildDeepSeekExpandRequestBody(params)),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`DeepSeek 经济档 HTTP ${res.status}: ${raw.slice(0, 160)}`);
  let json: DeepSeekJsonChatResponse;
  try {
    json = JSON.parse(raw) as DeepSeekJsonChatResponse;
  } catch {
    throw new Error(`DeepSeek 经济档非 JSON 响应：${raw.slice(0, 120)}`);
  }
  if (String(json.choices?.[0]?.finish_reason || "") === "length") {
    throw new Error("DeepSeek 经济档输出被截断（65K 预算耗尽，异常长输出）");
  }
  const content = json.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  if (text.length < 20) throw new Error(`DeepSeek 经济档内容过短（${text.length} 字符）`);
  // 审查返工 4：外层 200 不代表业务 JSON 合法——content 解析不出对象就抛错换通道，
  // 不许让非 JSON 文本流到下游被拼成骨架空壳还照常收费
  if (!extractJsonObject(text)) {
    throw new Error(`DeepSeek 经济档业务 JSON 解析失败：${text.slice(0, 120)}`);
  }
  return json;
}

async function invokeExpandViaDeepSeek(params: { system: string; user: string }): Promise<string> {
  const json = await invokeDeepSeekJsonChatRaw(params);
  const content = json.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

async function invokeExpandViaEvolink(params: {
  model: PlatformTopicExpandEngine;
  system: string;
  user: string;
}): Promise<string> {
  const { getEvolinkApiKey } = await import("./gpt56CopywritingGateway.js");
  const key = getEvolinkApiKey();
  if (!key) throw new Error("扩写备用通道未配置");
  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    max_completion_tokens: EXPAND_MAX_COMPLETION_TOKENS,
  };
  if (params.model === "qwen3.8-max") {
    // Evolink Qwen：档位 low|medium|xhigh（无 max）；2026-08-12 用户拍板开到顶档，
    // 与 Kimi high 对等公平；勿与 thinking_budget 同传（同知识卡提炼口径）
    body.enable_thinking = true;
    body.reasoning_effort = "xhigh";
    body.max_completion_tokens = EXPAND_QWEN_MAX_COMPLETION_TOKENS;
  } else {
    // 非 Qwen 走 max_tokens（对齐 knowledgeCardDistill 先例，防封顶字段不被识别而静默失效）
    body.reasoning_effort = "max";
    body.max_tokens = EXPAND_MAX_COMPLETION_TOKENS;
    delete body.max_completion_tokens;
  }
  const res = await fetch(EXPAND_EVOLINK_DIRECT_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(240_000),
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Evolink ${params.model} HTTP ${res.status}: ${raw.slice(0, 160)}`);
  }
  // 反空壳：Cloudflare 假 200 / HTML 页 / 空 content 一律抛错换通道，不许静默返回空串
  let json: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    throw new Error(`Evolink ${params.model} 非 JSON 响应：${raw.slice(0, 120)}`);
  }
  const content = json.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  if (text.length < 20) {
    throw new Error(`Evolink ${params.model} 内容过短（${text.length} 字符）`);
  }
  return text;
}

export async function expandPlatformTopicPicks(params: {
  userId: number | string;
  context?: string;
  picks: PlatformTopicShortlistItem[];
  enabledSkillIds?: string[] | null;
  allowBloggerTitle?: boolean;
  /** 缺省 kimi-k3（OpenRouter 主、Evolink 兜底）；qwen3.8-max 直走 Evolink */
  engine?: PlatformTopicExpandEngine | null;
  /**
   * 每条写完立刻回调（后台任务据此写进度，前端一条一条冒出来）。
   *
   * 七条串行 × 单条约 3 分钟 = 二十多分钟；等全部跑完才给结果的话，用户前二十分钟
   * 面对的是一个不动的转圈（用户 2026-08-06：这样的体验开发者自己都不爽）。
   */
  onItem?: (item: {
    blueprint: Record<string, unknown>;
    index: number;
    total: number;
    elapsedMs: number;
  }) => Promise<void> | void;
}): Promise<{
  contentBlueprints: Array<Record<string, unknown>>;
  diagnostics: Record<string, unknown>;
}> {
  const picks = params.picks.slice(0, PLATFORM_TOPIC_EXPAND_MAX);
  if (picks.length < PLATFORM_TOPIC_EXPAND_MIN) {
    throw new Error(`请至少勾选 ${PLATFORM_TOPIC_EXPAND_MIN} 条初选再扩写（最多 ${PLATFORM_TOPIC_EXPAND_MAX}）`);
  }

  const usedKeys = new Set<string>();
  const uniquePicks: PlatformTopicShortlistItem[] = [];
  for (const p of picks) {
    const key = p.dedupeKey || deriveTopicDedupeKey(p.title, p.hookSketch);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    uniquePicks.push({ ...p, dedupeKey: key });
  }

  // 串行扩写：并行 + reasoning high 会把 Fly 单机堵死（health 红 + empty content）
  const results: Array<Record<string, unknown>> = [];
  /** 逐条失败清单：整批不再一起完蛋，失败的交给前端提示可重跑 */
  const failed: Array<{ id: string; title: string; reason: string }> = [];
  const startedAt = Date.now();
  for (let i = 0; i < uniquePicks.length; i++) {
    const pick = uniquePicks[i]!;
    const skillsPrompt = await resolvePoolAndPrompt({
      userId: params.userId,
      enabledSkillIds: params.enabledSkillIds,
      skillIds: pick.skillsUsed,
      allowBloggerTitle: params.allowBloggerTitle,
    });
    const isVideo = pick.formatHint === "短视频";
    // 系统/用户消息必须含小写 json（Responses API json_object 硬门槛）
    const system = `你是平台执行文案编辑。只输出一个 json 对象：{ "blueprint": { ... } }。
必须遵守挂载 Skill。本条赛道 primaryLane=${pick.primaryLane}。
${PLATFORM_HIGH_CTR_TITLE_COVER_GUIDANCE}
硬约束：
- title/hook/copywriting/detailedScript/format/suitablePlatforms/actionableSteps/publishingAdvice/highlightKeywords/commentHooks/graphicNotePages/platformVariants/storyboardCells
- storyboardCells：逐镜拆片表（短视频必给；图文笔记可省略），6–8 镜数组，每镜 { cellIndex, dialogueZh(这一镜台词，一字不差，无则空串), sceneZh(场景，如"浴室镜前"), shotSize(景别，全景/远景/中景/近景/特写/大特写 六选一), actionZh(画面里谁在做什么，一句说清), cameraMoveZh(运镜：推/拉/摇/移/跟/固定), editNoteZh(转场/特效/BGM/字幕节点) }；台词合计须与 detailedScript 口径一致，不得另编
- platformVariants 必须覆盖 xiaohongshu/bilibili/weixin_channels，各含最多 13 字 coverHeadline（高点击短钩，超则精简，互不雷同）
- 保留初选 title 的反差杀伤力，可微调拧得更紧；禁止改回正确无聊题
- format 优先用「${pick.formatHint}」
- commentHooks：1–3 个，每个≤3个汉字生活词（想要/求带/慢生活…），禁止「预约诊断通话」整句
- 对外写法用「在这里我先分享一些」，禁止「半成本/半成品解法」刺耳词
- **体裁分工（重要）**：短视频口播要短；图文笔记要丰富。不要用短视频篇幅去砍笔记，也不要用笔记密度去拉长视频。
${
  isVideo
    ? `- 【短视频时长】成片目标 **1分半～2分钟**，**硬上限 ≤2分半（≤02:30）**（时间轴建议落在 00:00–01:30～00:00–02:00，最长勿超 00:00–02:30）。detailedScript 用时间轴；口播合计约 220–380 字口语；字幕钉子 8–12 句封顶。按 m2：开场杀伤句→稀缺/量感→低成本收束。禁止说明书墙、禁止为凑时长注水或写成超过 2 分半。
- graphicNotePages：可给 6–8 页精简提纲（细节留给图文选题）；仍须含 cover + cta`
    : `- 【图文笔记】copywriting ≥200 字可发正文；detailedScript 用 [封面]/[图N] 大纲且信息密（对标 m1），**不要**写成口播时间轴。
- graphicNotePages：**必须 8–12 页**，每页含 pageIndex,role,headline,body；role 可用 cover/audience_pain/scene/inventory_index/detail_card/share_tips/evidence/checklist/save_reason/cta
- 合集/清单/看展/市集向：必须含 inventory_index + 至少 2 张 detail_card（总览墙+细卡）`
}
- 若赛道为 fmcg 或正文做畅销品/标签科普：正文必须出现一句可追溯权威（如按《中国居民膳食指南（2022）》…）
- 去临床恐吓；强监管赛道用优化表达
conveyGoal（须兑现）：${pick.conveyGoal}`;

    const user = JSON.stringify({
      personaContext: String(params.context || "").slice(0, 5000),
      pick,
      skillsPrompt: skillsPrompt.slice(0, 14000),
      outputFormat: "json",
    });

    const invokeExpandOpenRouter = (openRouterModel: string) => async () => {
      const res = await invokeLLM({
        provider: "openai",
        modelName: openRouterModel,
        // 2026-08-12 用户拍板：medium 写得不够好 → high + 32k 上限（质量优先，接受毛利下探）
        max_tokens: 32_000,
        temperature: 0.55,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        reasoningEffort: "high",
      });
      return extractFirstChoicePlainText(res).trim();
    };
    const invokeExpandEvolink = (model: PlatformTopicExpandEngine) => () =>
      invokeExpandViaEvolink({ model, system, user });

    // 双通道编排（2026-08-12 用户拍板：哪家便宜哪家先，另一家兜底）——
    // Kimi K3 两家同价（$3/$15），主走 OpenRouter、两次抖动后切 Evolink 保稳；
    // Qwen 3.8 Max Evolink（$1.765/$5.295）比 OpenRouter（$2/$6）便宜 ~12%，
    // 主走 Evolink、兜底 OpenRouter（qwen/qwen3.8-max）。
    const engine: PlatformTopicExpandEngine = normalizePlatformTopicExpandEngine(params.engine);
    const attempts =
      engine === "deepseek-v4"
        ? [
            // 经济档：OpenRouter 两次抖动后兜底轻快档（Evolink Qwen），保交付不保档位
            () => invokeExpandViaDeepSeek({ system, user }),
            () => invokeExpandViaDeepSeek({ system, user }),
            invokeExpandEvolink("qwen3.8-max"),
          ]
        : engine === "qwen3.8-max"
          ? [
              invokeExpandEvolink("qwen3.8-max"),
              invokeExpandEvolink("qwen3.8-max"),
              invokeExpandOpenRouter("qwen/qwen3.8-max"),
            ]
          : [
              invokeExpandOpenRouter(getPlatformStage2OpenAiModel()),
              invokeExpandOpenRouter(getPlatformStage2OpenAiModel()),
              invokeExpandEvolink("kimi-k3"),
            ];

    console.info(
      `[expandPlatformTopicPicks] ${i + 1}/${uniquePicks.length} engine=${engine} title=${pick.title.slice(0, 40)}`,
    );
    /**
     * 上游抖动（空 200 / 心跳残包）不该毁掉这一条，更不该毁掉整批：
     * 2026-08-06 实测 OpenRouter 空体 200 让七条扩写全灭。最多三次，
     * Kimi 第三次自动换 Evolink 通道（2026-08-12 凌晨 OpenRouter Kimi 连挂两单）。
     */
    let llmText = "";
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= attempts.length; attempt++) {
      try {
        llmText = await attempts[attempt - 1]!();
        if (llmText) break;
        console.warn(
          `[expandPlatformTopicPicks] 空回（第 ${attempt} 次）· ${i + 1}/${uniquePicks.length}`,
        );
      } catch (e) {
        lastErr = e;
        // 换通道前不因「非瞬时错」提前放弃：Evolink 兜底是最后一搏
        if (attempt === attempts.length) break;
        if (!isTransientLlmError(e) && attempt < attempts.length - 1) {
          // 非瞬时错直接跳到最后的兜底通道
          console.warn(
            `[expandPlatformTopicPicks] 非瞬时错，直切兜底通道 · ${i + 1}/${uniquePicks.length} · ${
              e instanceof Error ? e.message.slice(0, 160) : e
            }`,
          );
          try {
            llmText = await attempts[attempts.length - 1]!();
          } catch (e2) {
            lastErr = e2;
          }
          break;
        }
        console.warn(
          `[expandPlatformTopicPicks] 上游抖动重试 ${attempt}/${attempts.length} · ${i + 1}/${uniquePicks.length} · ${
            e instanceof Error ? e.message.slice(0, 160) : e
          }`,
        );
        await new Promise((r) => setTimeout(r, attempt * 4000));
      }
    }
    if (!llmText && !lastErr) {
      // 三通道全空回但没抛错：也算失败进清单（可退款/免重跑），不许落骨架空壳照收费
      failed.push({
        id: pick.id,
        title: pick.title,
        reason: "上游多次空回（未抛错）",
      });
      continue;
    }
    if (!llmText && lastErr) {
      // 这一条放弃，继续跑后面的；失败清单随 diagnostics 回给前端
      console.warn(
        `[expandPlatformTopicPicks] 放弃本条 · ${pick.title.slice(0, 40)} · ${
          lastErr instanceof Error ? lastErr.message.slice(0, 200) : lastErr
        }`,
      );
      failed.push({
        id: pick.id,
        title: pick.title,
        reason: lastErr instanceof Error ? lastErr.message.slice(0, 200) : String(lastErr),
      });
      continue;
    }

    const parsed = extractJsonObject(llmText) as Record<string, unknown> | null;
    let bp =
      parsed && typeof parsed.blueprint === "object" && parsed.blueprint
        ? (parsed.blueprint as Record<string, unknown>)
        : parsed && (parsed.title || parsed.copywriting)
          ? parsed
          : null;
    if (!bp) {
      console.warn(`[expandPlatformTopicPicks] 解析失败，用骨架兜底 · ${pick.title.slice(0, 40)}`);
      bp = {
        title: pick.title,
        format: pick.formatHint,
        hook: pick.hookSketch,
        copywriting: `${pick.conveyGoal}\n\n在这里我先分享一些可对照的生活动作。`,
        detailedScript: "【封面】\n【图2】痛点\n【图3】分享要点\n【图4】清单\n【末页】评论钩子",
        suitablePlatforms: ["小红书"],
        actionableSteps: ["按图文页发布", "评论区置顶生活钩子"],
        publishingAdvice: "优先小红书图文测收藏",
      };
    }

    bp.title = String(bp.title || pick.title);
    bp.format = String(bp.format || pick.formatHint);
    bp.hook = String(bp.hook || pick.hookSketch);
    bp.skillsUsed = pick.skillsUsed;
    bp.primaryLane = pick.primaryLane;
    bp.conveyGoal = pick.conveyGoal;
    bp.dedupeKey = pick.dedupeKey;
    bp.shortlistId = pick.id;
    // 与旧 Stage2 六条文案同字段：执行卡 / 封面 / 分镜认 id·sceneId
    bp.id = String(bp.id || bp.sceneId || pick.id);
    bp.sceneId = String(bp.sceneId || bp.id || pick.id);
    const linkedCampaigns = Array.isArray(pick.linkedCampaigns)
      ? pick.linkedCampaigns
          .map((x) => {
            if (typeof x === "string") return x.trim();
            if (x && typeof x === "object") {
              const o = x as Record<string, unknown>;
              for (const k of ["name", "title", "label", "text", "campaign"]) {
                if (typeof o[k] === "string" && String(o[k]).trim()) return String(o[k]).trim();
              }
            }
            return "";
          })
          .filter((s) => s && s !== "[object Object]")
          .slice(0, 4)
      : [];
    bp.linkedCampaigns = linkedCampaigns;
    if (linkedCampaigns.length) {
      const tag = linkedCampaigns.join(" · ");
      const prevAdvice = typeof bp.publishingAdvice === "string" ? bp.publishingAdvice.trim() : "";
      bp.publishingAdvice = `${prevAdvice}\n官方活动：${tag}（发布时挂同名话题/参与创作者中心活动）`.trim();
    }
    bp.commentHooks = Array.isArray(bp.commentHooks)
      ? (bp.commentHooks as unknown[]).map((x) => normalizeCommentHook(x)).slice(0, 4)
      : [normalizeCommentHook(pick.commentHook)];

    const cite = ensureAuthorityCiteInCopy({
      copywriting: String(bp.copywriting || ""),
      lane: pick.primaryLane,
      force: pick.skillsUsed.includes("authority-cite-endorsement") || pick.primaryLane === "fmcg",
    });
    bp.copywriting = cite.copywriting;
    bp.authorityCitePatched = cite.patched;

    const med = ensureMedicalResourceCiteInCopy({
      copywriting: String(bp.copywriting || ""),
      topic: `${bp.title || ""} ${bp.hook || ""}`,
      force:
        pick.skillsUsed.includes("medical-resource-library") ||
        pick.primaryLane === "crossover",
    });
    bp.copywriting = med.copywriting;
    if (med.patched) bp.authorityCitePatched = true;

    // 逐镜拆片表：LLM 输出优先，坏行归一丢弃；短视频缺表时从口播时间轴降级拆装，
    // 保证结果卡表格与出图 scriptContext 两处消费者有内容。图文笔记无镜头概念，不硬造。
    const normalizedCells = normalizePlatformStoryboardCells(bp.storyboardCells);
    if (normalizedCells.length) {
      bp.storyboardCells = normalizedCells;
    } else if (isVideo) {
      const exec =
        bp.executionDetails && typeof bp.executionDetails === "object"
          ? (bp.executionDetails as Record<string, unknown>)
          : null;
      const steps = Array.isArray(exec?.stepByStepScript)
        ? (exec!.stepByStepScript as string[])
        : typeof bp.detailedScript === "string"
          ? String(bp.detailedScript)
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      bp.storyboardCells = buildStoryboardCellsFromStepScript(steps);
    } else {
      bp.storyboardCells = [];
    }

    const hooks = bp.commentHooks as string[];
    if (!Array.isArray(bp.graphicNotePages) || (bp.graphicNotePages as unknown[]).length < 6) {
      bp.graphicNotePages = buildGraphicNotePagesFromBlueprint({
        title: String(bp.title),
        hook: String(bp.hook),
        copywriting: String(bp.copywriting),
        commentHook: hooks[0],
      });
    }

    results.push(bp);
    if (params.onItem) {
      try {
        await params.onItem({
          blueprint: bp,
          index: i + 1,
          total: uniquePicks.length,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (e) {
        // 写进度失败不该毁掉已经跑出来的文案
        console.warn("[expandPlatformTopicPicks] onItem 失败（忽略）:", e);
      }
    }
  }

  if (!results.length && failed.length) {
    throw new Error(
      `扩写失败（${failed.length} 条全部未出）：${failed[0]?.reason || "上游算力紧张"}`,
    );
  }

  return {
    contentBlueprints: results,
    diagnostics: {
      expanded: results.length,
      lanes: uniquePicks.map((p) => p.primaryLane),
      authorityPatched: results.filter((r) => r.authorityCitePatched).length,
      failedCount: failed.length,
      failedPicks: failed,
    },
  };
}
