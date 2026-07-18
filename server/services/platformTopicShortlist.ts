/**
 * 选题初选（20）与勾选扩写（5–6）LLM 服务。
 */
import { nanoid } from "nanoid";
import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm.js";
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
  /** 生成条数，默认 6，最大 20 */
  count?: number | null;
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
8. 要有生活画面，不是方法论课；优先把官方活动话题与人设方向结合（暑假生活/城市漫步/好物测评/运动日常/读书笔记等）。
9. 同批至少 **60%** 选题 primaryLane=contrast 或标题明显含数字拧巴/结果颠倒/身份错位；禁止整批评「××的正确打开方式」「××注意事项」这类正确无聊题。
输出：{ "topics": [ ...恰好${targetCount}条 ] }`;

  const user = JSON.stringify({
    personaContext: String(params.context || "").slice(0, 6000),
    skillPoolIds: poolIds,
    laneHints: laneSkillHints,
    stage1Seeds: (params.stage1Seeds || []).slice(0, 6),
    avoidTitles: (params.existingTitles || []).slice(0, 40),
    skillsBrief: skillsBlock.slice(0, 8000),
    officialCampaigns: campaignBrief,
  });

  const res = await invokeLLM({
    provider: "openai",
    modelName: getPlatformStage2OpenAiModel(),
    max_tokens: 12000,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    reasoningEffort: "high",
  });

  const llmText = extractFirstChoicePlainText(res).trim();
  if (!llmText) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "选题初选模型返回空内容，请稍后重试（Evolink GPT-5.6）",
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

  const topics = dedupeTopicShortlist(normalized, {
    existingTitles: params.existingTitles,
    max: targetCount,
  });

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
    },
  };
}

export async function expandPlatformTopicPicks(params: {
  userId: number | string;
  context?: string;
  picks: PlatformTopicShortlistItem[];
  enabledSkillIds?: string[] | null;
  allowBloggerTitle?: boolean;
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

  const results = await Promise.all(
    uniquePicks.map(async (pick) => {
      const skillsPrompt = await resolvePoolAndPrompt({
        userId: params.userId,
        enabledSkillIds: params.enabledSkillIds,
        skillIds: pick.skillsUsed,
        allowBloggerTitle: params.allowBloggerTitle,
      });
      const isVideo = pick.formatHint === "短视频";
      const system = `你是平台执行文案编辑。只输出一个 JSON 对象：{ "blueprint": { ... } }。
必须遵守挂载 Skill。本条赛道 primaryLane=${pick.primaryLane}。
${PLATFORM_HIGH_CTR_TITLE_COVER_GUIDANCE}
硬约束：
- title/hook/copywriting/detailedScript/format/suitablePlatforms/actionableSteps/publishingAdvice/highlightKeywords/commentHooks/graphicNotePages/platformVariants
- platformVariants 必须覆盖 xiaohongshu/bilibili/weixin_channels，各含约 10–18 字 coverHeadline（高点击短钩，互不雷同）
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
      });

      const res = await invokeLLM({
        provider: "openai",
        modelName: getPlatformStage2OpenAiModel(),
        max_tokens: 16000,
        temperature: 0.55,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        reasoningEffort: "high",
      });

      const parsed = extractJsonObject(extractFirstChoicePlainText(res)) as Record<string, unknown> | null;
      let bp =
        parsed && typeof parsed.blueprint === "object" && parsed.blueprint
          ? (parsed.blueprint as Record<string, unknown>)
          : parsed && (parsed.title || parsed.copywriting)
            ? parsed
            : null;
      if (!bp) {
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

      const hooks = bp.commentHooks as string[];
      if (!Array.isArray(bp.graphicNotePages) || (bp.graphicNotePages as unknown[]).length < 6) {
        bp.graphicNotePages = buildGraphicNotePagesFromBlueprint({
          title: String(bp.title),
          hook: String(bp.hook),
          copywriting: String(bp.copywriting),
          commentHook: hooks[0],
        });
      }

      return bp;
    }),
  );

  return {
    contentBlueprints: results,
    diagnostics: {
      expanded: results.length,
      lanes: uniquePicks.map((p) => p.primaryLane),
      authorityPatched: results.filter((r) => r.authorityCitePatched).length,
    },
  };
}
