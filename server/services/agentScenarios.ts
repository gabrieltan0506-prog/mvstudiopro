/**
 * 三大 Agent 场景的入口逻辑
 *   1) 多平台 IP 矩阵（platform_ip_matrix）
 *   2) 竞品/赛道雷达（competitor_radar）
 *   3) VIP 客户动态健康/美学追踪（vip_baseline + vip_monthly，stateful）
 *
 * 都基于 `deepResearchService` 的 createDeepResearchJob + runDeepResearchAsync。
 * VIP 场景的「持续记忆」通过 Interactions API 的 previous_interaction_id 实现，
 * 由 vipProfileStore 持久化锚点 interactionId。
 */

import {
  createDeepResearchJob,
  runDeepResearchAsync,
  readJob,
  type DeepResearchJob,
} from "./deepResearchService";
import {
  createVipProfile as storeCreateVipProfile,
  readProfile as storeReadProfile,
  appendVipUpdate as storeAppendVipUpdate,
  listVipProfiles as storeListVipProfiles,
} from "./vipProfileStore";
import { readCommanderProfile } from "./commanderProfileStore";
import { buildCommanderPrompt, loadFreshPlatformBriefing } from "./commanderPromptBuilder";

// ── 共享类型 ────────────────────────────────────────────────────────────────
export type SuppFile = NonNullable<DeepResearchJob["supplementaryFiles"]>[number];

interface CommonInput {
  userId: string;
  text: string;
  supplementaryText?: string;
  supplementaryFiles?: SuppFile[];
}

// ── 1. 多平台 IP 矩阵（platform_ip_matrix） ────────────────────────────────
export interface PlatformIpInput extends CommonInput {
  /** 待覆盖的平台账号（抖音/小红书/B站/快手/视频号 等） */
  accounts: Array<{ platform: string; handle: string; notes?: string }>;
  /** 想要做的话题方向（即 b 痛点场景） */
  topicDirection: string;
  /** c 输出格式偏好（可选，覆盖系统默认模板） */
  outputFormatOverride?: string;
}

export async function launchPlatformIpMatrix(input: PlatformIpInput): Promise<{ jobId: string }> {
  const topic = `[多平台 IP 矩阵 · 跨界爆款脚本] ${input.topicDirection.slice(0, 80)}`;

  // 自动接入 trend DB（4 大平台最新爆款）+ 用户指挥官档案
  const [briefing, profile] = await Promise.all([
    loadFreshPlatformBriefing({ topN: 10 }),
    readCommanderProfile(input.userId),
  ]);

  const supplementaryText = buildCommanderPrompt({
    scenario: "platform_ip_matrix",
    scenarioTitle: "多平台内容 IP 矩阵自动驾驶 · 跨界爆款脚本",
    scenarioPayload: {
      话题方向: input.topicDirection,
      账号矩阵: input.accounts.map((a) => `${a.platform}: ${a.handle}${a.notes ? `（${a.notes}）` : ""}`),
    },
    painPoint: input.topicDirection,
    freeformSupplementary: input.supplementaryText,
    profile,
    platformBriefing: briefing.briefingText,
    briefingMeta: briefing.meta,
    outputFormatOverride: input.outputFormatOverride,
  });

  const { jobId } = await createDeepResearchJob(
    input.userId,
    topic,
    0,
    "platform_ip_matrix",
    {
      supplementaryText,
      supplementaryFiles: input.supplementaryFiles,
    },
  );

  fireAndForget(jobId);
  return { jobId };
}

// ── 2. 竞品/赛道雷达（competitor_radar） ───────────────────────────────────
export interface CompetitorRadarInput extends CommonInput {
  benchmarks: Array<{ platform: string; handle: string; notes?: string }>;
  focusDimensions: string[];
  /** b 痛点场景（可选；不填则由 focusDimensions 派生） */
  painPoint?: string;
  /** c 输出格式偏好 */
  outputFormatOverride?: string;
}

export async function launchCompetitorRadar(input: CompetitorRadarInput): Promise<{ jobId: string }> {
  const dimensionsLabel = input.focusDimensions.length
    ? input.focusDimensions.join(" / ")
    : "数据 / 创意 / 商业模式 / 用户画像 / 内容工业化能力";

  const topic = `[竞品/赛道雷达] 对标 ${input.benchmarks.length || "5+"} 账号 · ${dimensionsLabel}`;

  const [briefing, profile] = await Promise.all([
    loadFreshPlatformBriefing({ topN: 8 }),
    readCommanderProfile(input.userId),
  ]);

  const painPoint = input.painPoint?.trim() || `针对「${dimensionsLabel}」维度，对当前赛道头部对手进行深度差异化对比，找出可降维打击的突破口`;

  const supplementaryText = buildCommanderPrompt({
    scenario: "competitor_radar",
    scenarioTitle: "竞品 / 赛道雷达 · 高密度差异化分析",
    scenarioPayload: {
      对标账号: input.benchmarks.map((b) => `${b.platform}: ${b.handle}${b.notes ? `（${b.notes}）` : ""}`),
      关注维度: input.focusDimensions,
    },
    painPoint,
    freeformSupplementary: input.supplementaryText,
    profile,
    platformBriefing: briefing.briefingText,
    briefingMeta: briefing.meta,
    outputFormatOverride: input.outputFormatOverride,
  });

  const { jobId } = await createDeepResearchJob(
    input.userId,
    topic,
    0,
    "competitor_radar",
    {
      supplementaryText,
      supplementaryFiles: input.supplementaryFiles,
    },
  );

  fireAndForget(jobId);
  return { jobId };
}

// ── 3. VIP 健康/美学动态追踪（vip_baseline + vip_monthly，stateful） ─────
export interface VipBaselineInput extends CommonInput {
  vipName: string;
  /** VIP 客户基础画像（年龄、职业、健康基线、审美偏好等） */
  baselineSummary: string;
}

export interface VipMonthlyInput extends CommonInput {
  vipId: string;
  /** 本月新增数据（生理指标、情绪、艺术展观后感等） */
  monthlyData: string;
}

/**
 * 建档：第一次为 VIP 客户启动 Deep Research Max 深潛
 * 走完整 plan → approve → execute 流程，结束后回填 baseInteractionId 作为后续锚点
 */
export async function launchVipBaseline(input: VipBaselineInput): Promise<{ jobId: string; vipId: string }> {
  // 1. 先在 vipProfileStore 占位创建一条 profile（先生成 vipId）
  // 临时 baseJobId 占位，下一步真正拿到 jobId 后再写一遍
  const placeholder = await storeCreateVipProfile({
    ownerId: input.userId,
    vipName: input.vipName,
    baselineSummary: input.baselineSummary,
    baseJobId: "pending",
  });
  const vipId = placeholder.vipId;

  const topic = `[VIP 客户档案 · ${input.vipName}] 身心抗衰 + 美学重塑基线评估`;

  // VIP 场景同样接入指挥官档案（医师的核心资产 = 哈佛心血管 + 艺术史等）
  // 但不需要平台趋势数据（这是个人化健康场景，不是流量场景）
  const profileNow = await readCommanderProfile(input.userId);

  const supplementaryText = buildCommanderPrompt({
    scenario: "vip_baseline",
    scenarioTitle: `高净值 VIP 客户「${input.vipName}」首次身心抗衰 + 美学重塑基线评估`,
    scenarioPayload: {
      客户姓名: input.vipName,
      客户基础画像: input.baselineSummary.trim(),
      声明: "这是首次基线档案，所有结论将作为锚点用于后续 12 个月的月度动态追踪",
    },
    painPoint: `${input.vipName} · 高净值客户首次身心抗衰 + 美学重塑基线评估`,
    freeformSupplementary: input.supplementaryText,
    profile: profileNow,
    platformBriefing: "（VIP 个人化健康场景，无需平台趋势数据。请聚焦近 2 年医学/心理/美学权威文献交叉验证。）",
    briefingMeta: "vip_no_platform",
  });

  const { jobId } = await createDeepResearchJob(
    input.userId,
    topic,
    0,
    "vip_baseline",
    {
      supplementaryText,
      supplementaryFiles: input.supplementaryFiles,
    },
    {
      onCompletedHook: { kind: "vip_base", ownerId: input.userId, vipId },
    },
  );

  // 真正的 baseJobId 写回（占位 → 实际值）
  const profile = await storeReadProfile(input.userId, vipId);
  if (profile) {
    profile.baseJobId = jobId;
    profile.updatedAt = new Date().toISOString();
    await import("./vipProfileStore").then((m) =>
      // 借 attachBaseInteractionId 之外暴露一个 raw write 太重，我们直接重写 profile 文件：
      // 简化：appendVipUpdate 也会写文件，但这里直接写 baseJobId
      // 下一行避免触碰内部 API：用 createVipProfile 重新覆盖（vipId 相同会更新）
      m as any
    );
    // 写回（写 profile 文件 + 更新 index）
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = process.env.VIP_PROFILES_DIR || "/data/agent/vip-profiles";
    await fs.mkdir(`${dir}/${input.userId}`, { recursive: true });
    await fs.writeFile(
      path.join(dir, input.userId, `${vipId}.json`),
      JSON.stringify(profile, null, 2),
    );
  }

  fireAndForget(jobId);
  return { jobId, vipId };
}

/**
 * 月度更新：用 lastInteractionId 作 previous_interaction_id 续接
 * 跳过 plan 阶段，直接 execute（用户提交的 monthlyData 作为 finalCommand）
 */
export async function launchVipMonthlyUpdate(
  input: VipMonthlyInput,
): Promise<{ jobId: string }> {
  const profile = await storeReadProfile(input.userId, input.vipId);
  if (!profile) throw new Error("VIP 档案不存在");
  const previous = profile.lastInteractionId || profile.baseInteractionId;
  if (!previous) {
    throw new Error("VIP 基线档案尚未生成完毕（缺少 baseInteractionId），请等待建档报告完成后再追加月度更新");
  }

  const topic = `[VIP 月度更新 · ${profile.vipName}] ${new Date().toISOString().slice(0, 7)} 月份动态调整`;

  const overrideInput = `
【场景】VIP 客户「${profile.vipName}」第 ${profile.updates.length + 1} 次月度动态追踪
【既有档案锚点】上一次评估的 interaction_id 已通过 previous_interaction_id 自动注入，请基于全部历史档案 + 以下本月新数据，输出动态调整处方。

【本月新数据（顾问录入）】
${input.monthlyData.trim()}

${input.supplementaryFiles?.length ? `【本月补充文件】顾问已上传 ${input.supplementaryFiles.length} 个图片/文档（生理报告、艺术展照片、消费小票等），请直接读取分析。` : ""}

【交付物要求】
1. 与上次档案对比的「变化 - 进步 - 退步 - 新风险」四象限表
2. 本月最关键的 3 个调整建议（含医学/心理/美学/社交四个维度）
3. 下一阶段 30 天行动卡片（量化指标）
4. 风险预警与合规提醒
${input.supplementaryText ? `\n【顾问额外补充】\n${input.supplementaryText.trim()}` : ""}
`.trim();

  const supplementaryText = input.monthlyData; // 月度数据也作为 supp 文本备份（防 fallback）

  const { jobId } = await createDeepResearchJob(
    input.userId,
    topic,
    0,
    "vip_monthly",
    {
      supplementaryText,
      supplementaryFiles: input.supplementaryFiles,
    },
    {
      planInteractionId: previous,
      executeOverrideInput: overrideInput,
      skipPlanApproval: true, // 跳过计划审批，直接 running → execute
      onCompletedHook: { kind: "vip_monthly", ownerId: input.userId, vipId: input.vipId },
    },
  );

  // 在 store 里追加一条 update 记录
  await storeAppendVipUpdate({
    ownerId: input.userId,
    vipId: input.vipId,
    jobId,
    summary: input.monthlyData,
    fileNames: (input.supplementaryFiles || []).map((f) => f.name),
  });

  fireAndForget(jobId);
  return { jobId };
}

// ── 工具：fire-and-forget worker 启动 ─────────────────────────────────────
function fireAndForget(jobId: string) {
  setImmediate(() => {
    runDeepResearchAsync(jobId).catch((e) =>
      console.error(`[agentScenarios] runDeepResearchAsync 异常 jobId=${jobId}：`, e?.message),
    );
  });
}

// ── 列表 / 详情 ────────────────────────────────────────────────────────────
export async function listAgentJobs(
  userId: string,
  productType: DeepResearchJob["productType"],
): Promise<Array<Pick<DeepResearchJob, "jobId" | "topic" | "status" | "progress" | "createdAt" | "completedAt" | "reportMarkdown">>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = process.env.DEEP_RESEARCH_DIR || "/data/growth/deep-research";
  const items: any[] = [];
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, f), "utf-8");
        const job: DeepResearchJob = JSON.parse(raw);
        if (job.userId !== userId) continue;
        if (productType && job.productType !== productType) continue;
        items.push({
          jobId: job.jobId,
          topic: job.topic,
          status: job.status,
          progress: job.progress || "",
          createdAt: job.createdAt,
          completedAt: job.completedAt || null,
          reportMarkdown: job.reportMarkdown || null,
        });
      } catch {}
    }
  } catch (e: any) {
    console.warn("[agentScenarios] listAgentJobs 失败:", e?.message);
  }
  return items.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
}

export async function listVipProfiles(userId: string) {
  return storeListVipProfiles(userId);
}

export async function getVipProfile(userId: string, vipId: string) {
  return storeReadProfile(userId, vipId);
}

export async function getJob(jobId: string) {
  return readJob(jobId);
}
