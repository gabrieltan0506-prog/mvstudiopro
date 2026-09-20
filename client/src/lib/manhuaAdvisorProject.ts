import { MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS as LIMITS, MANHUA_CREATIVE_ADVISOR_STRATEGY_IDS, type ManhuaCreativeAdvisorContext } from "@shared/manhuaCreativeAdvisor";
import type { ManhuaWriterPack } from "@shared/manhuaWriterRoom";
import type { ManhuaProjectBible } from "@shared/manhuaProjectBible";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import type { ManhuaWorkbenchShot } from "@shared/manhuaScriptWorkbench";
import { customAssetRefClaimsAnchor } from "@shared/manhuaAssetScriptSync";
import { normalizeCompilerEngineId } from "@shared/manhuaShotIR";
import type { CanvasBlock } from "./canvasTypes";
import { buildAdvisorPrevisSummary } from "./manhuaAdvisorPrevis";
import { getBlockEpisodeIndex } from "./canvasDramaStudio";

export type AdvisorSelection = {
  episodeIndex: number;
  segmentIndex: number;
  shot: ManhuaWorkbenchShot | null;
};
export type AdvisorIssue = {
  id: string;
  text: string;
  phase: ManhuaCreativeAdvisorContext["stage"];
  /**
   * 0919：这条是不是**挡住往下走**的。
   *
   * 为什么要这个字段：阶段条「资产设定 ✅」走的是覆盖方向（剧本里每个人物是否都有图，
   * 见 findManhuaAssetCoverageGaps），顾问的「N 张人物图未认领」走的是反方向
   * （每张图是否认领到了人物）。两者可以同时为真且都没错——剧本里的人都有图，
   * 同时另有几张多余的图没认领。用户看到 ✅ 旁边挂着警告，分不清哪个说了算，
   * 这就是线上暴露的「阶段状态冲突」。
   *
   * 定性只按一条：**不补它能不能继续出片**。能继续的是提醒（false），不能的是阻断（true）。
   */
  blocking: boolean;
};

export type AdvisorVideoModelResolution = {
  videoModel: string;
  conflictModels: string[];
};

/** 3D 决策规则只读可拍表三个字段；不调模型。 */
export type Manhua3dUsageSegment = {
  intentZh?: string | null;
  dialogueZh?: string | null;
  castZh?: string | null;
};
export type Manhua3dUsageRecommendation = {
  /** 是否值得生成/复用角色3D资产；不是白模预演门禁。 */
  recommend: boolean;
  /** 通用白模空间预演无需先锁脸或先生成角色3D资产。 */
  recommendPrevis?: boolean;
  previsSuggestedSegmentIndex?: number;
  reasonZh: string;
  /** 1 起算的段号；首推一集只做一段 */
  suggestedSegmentIndex?: number;
};

/** 调用方已算好的状态短句；这里只裁长度、判 issue，不回头重算。 */
export type AdvisorProjectSignals = {
  /** 编剧密度／可拍表门禁报错原文 */
  gate?: string[];
  /** formatManhuaAdvisorAssetGapZh 的产物 */
  assetGap?: string;
  /** 关键静帧被拦原因原文；空串或未传表示未被拦 */
  keyframeBlock?: string;
  /** formatManhuaAdvisorPipeline3dZh 的产物 */
  pipeline3d?: string;
  /** 「生成中：…」或「空闲」 */
  queue?: string;
  /** 「余额 N · 本步预估 M」；取不到就「未知」 */
  credits?: string;
  /** 本集可拍表（3D 规则输入） */
  segments?: Manhua3dUsageSegment[];
  /** 已锁脸角色名（3D 规则输入） */
  lockedCharacterNames?: string[];
};

export function formatManhuaAdvisorAssetGapZh(input: { characters: number; scenes: number; props: number }): string {
  const total = input.characters + input.scenes + input.props;
  return `待生成 ${total}：人物 ${input.characters} · 场景 ${input.scenes} · 道具 ${input.props}`;
}
const ASSET_GAP_PATTERN = /^待生成 (\d+)/;

export function formatManhuaAdvisorPipeline3dZh(input: { modelReady: number; rigged: number; total: number; previsSegments: number }): string {
  return `模型就绪 ${input.modelReady}/${input.total} · 已绑骨 ${input.rigged}/${input.total} · 白模参考 ${input.previsSegments} 段`;
}
const PIPELINE_3D_PATTERN = /^模型就绪 (\d+)\/\d+ · 已绑骨 (\d+)\//;

const ACTION_SEGMENT_PATTERN = /武打|打斗|交战|搏斗|追逐|追赶|追击|斗法|拔剑|挥剑|劈向|劈砍|出拳|出掌|一掌|击退|格挡|爆炸|冲击波/;
const SPATIAL_SEGMENT_PATTERN = /走位|走向|走到|走入|走出|边走|行走|跑向|奔跑|移动|转身|绕行|穿过|上楼|下楼|楼梯|台阶|登船|上船|出水|跳跃|腾空|道具互动|持物|拿起|放下|递给|递过|接过|端起|举起|握住|推门|开门|演唱会|舞台|表演|演奏|弹奏|跳舞|伴舞|唱歌/;
const MIN_3D_CHARACTER_SEGMENTS = 3;

/** 只读段意图判断实际运动需求；对白中提到打斗不等于发生打斗。两类建议均不触发生成。 */
export function recommendManhua3dUsage(input: {
  segments: Manhua3dUsageSegment[];
  lockedCharacterNames: string[];
}): Manhua3dUsageRecommendation {
  const segments = input.segments || [];
  if (!segments.length) return { recommend: false, recommendPrevis: false, reasonZh: "本集尚无可拍表，暂不判断空间预演或角色3D资产需求。" };
  const actionIndexes = segments.map((seg, i) => (ACTION_SEGMENT_PATTERN.test(seg.intentZh || "") ? i : -1)).filter(i => i >= 0);
  const spatialIndexes = segments.map((seg, i) => (ACTION_SEGMENT_PATTERN.test(seg.intentZh || "") || SPATIAL_SEGMENT_PATTERN.test(seg.intentZh || "") ? i : -1)).filter(i => i >= 0);
  if (!spatialIndexes.length) return { recommend: false, recommendPrevis: false, reasonZh: "当前段意图未明确走位、空间或道具互动需求；对话本身不要求生成角色3D资产。如需安排站位或机位，仍可手动使用白模预演。" };
  const previsSuggestedSegmentIndex = spatialIndexes[0]! + 1;
  const previsReason = `第 ${previsSuggestedSegmentIndex} 段有运动或空间互动，建议先用通用白模检查站位、道具与机位；对白不影响使用，无需先锁脸或生成角色3D资产。`;
  const names = Array.from(new Set((input.lockedCharacterNames || []).map(n => String(n || "").trim()).filter(Boolean)));
  const appears = (seg: Manhua3dUsageSegment, name: string) => `${seg.castZh || ""}\n${seg.intentZh || ""}`.includes(name);
  for (const name of names) {
    const hits = segments.filter(seg => appears(seg, name)).length;
    if (hits < MIN_3D_CHARACTER_SEGMENTS) continue;
    const first = actionIndexes.find(i => appears(segments[i]!, name));
    if (first === undefined) continue;
    const segNo = first + 1;
    return {
      recommend: true, recommendPrevis: true, previsSuggestedSegmentIndex,
      suggestedSegmentIndex: segNo,
      reasonZh: `${previsReason}「${name}」已锁脸且跨 ${hits} 段出现，可另行评估复用角色3D资产，在第 ${segNo} 段先验证收益；不会自动建模或扣费。`,
    };
  }
  return { recommend: false, recommendPrevis: true, previsSuggestedSegmentIndex,
    reasonZh: `${previsReason}当前没有足够的跨段锁脸动作复用证据，暂不额外建议生成角色3D资产。` };
}

/** 阶段条「顾问：…」取当前阶段第一条；当前阶段没有就取全局第一条。 */
/**
 * 顶部只显示一条：**先挑阻断的**。
 * 原来取本阶段第一条，于是「4 张图未认领」这种不挡路的提醒会盖过真正卡住的那条，
 * 用户照着补完还是走不下去。阻断优先，本阶段优先于其它阶段。
 */
export function pickManhuaAdvisorTopIssue(issues: AdvisorIssue[], phase: ManhuaCreativeAdvisorContext["stage"]): AdvisorIssue | null {
  return (
    issues.find((issue) => issue.phase === phase && issue.blocking)
    || issues.find((issue) => issue.blocking)
    || issues.find((issue) => issue.phase === phase)
    || issues[0]
    || null
  );
}

const PHASE_LABELS: Record<ManhuaCreativeAdvisorContext["stage"], string> = {
  outline: "剧本大纲",
  assets: "资产设定",
  storyboard: "分镜",
  edit: "成片",
  final: "终审",
};

/** 进阶段气泡文案：第一条 issue，否则 3D 推荐理由；都没有就不弹。 */
export function pickManhuaAdvisorPhaseNudge(input: {
  phase: ManhuaCreativeAdvisorContext["stage"];
  issues: AdvisorIssue[];
  recommend3d: Manhua3dUsageRecommendation | null;
}): string | null {
  const top = pickManhuaAdvisorTopIssue(input.issues, input.phase);
  const body = top?.text || (input.recommend3d?.recommend || input.recommend3d?.recommendPrevis ? input.recommend3d.reasonZh : "");
  return body ? `进入${PHASE_LABELS[input.phase]}：${body}` : null;
}

export const MANHUA_ADVISOR_NUDGE_STORAGE_PREFIX = "manhua-advisor-nudge:";

/** 每阶段只弹一次；存储不可用时按「可弹」处理，不因本机存储把提示吞掉。 */
export function claimManhuaAdvisorNudgeOnce(
  storage:
    | { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }
    | (() => { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void })
    | null
    | undefined,
  phase: ManhuaCreativeAdvisorContext["stage"],
): boolean {
  const key = `${MANHUA_ADVISOR_NUDGE_STORAGE_PREFIX}${phase}`;
  try {
    // 1471 R1：`window.sessionStorage` 属性本身在 Safari 私密窗/被禁站点会抛 SecurityError，允许传取值函数在 try 内取
    const store = typeof storage === "function" ? storage() : storage;
    if (!store) return true;
    if (store.getItem(key)) return false;
    store.setItem(key, "1");
  } catch {
    /* 私密窗口或存储被禁：仍弹，只是记不住 */
  }
  return true;
}

function clipSignal(value: string | undefined, max: number): string {
  const t = String(value || "").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** 顾问引擎真源：用户显式选择 > 当前集未归档 clip；冲突时关闭式返回空。 */
export function resolveManhuaAdvisorVideoModel(input: {
  explicitVideoModel?: string | null;
  episodeIndex: number;
  blocks: CanvasBlock[];
}): AdvisorVideoModelResolution {
  const explicit = String(input.explicitVideoModel || "").trim();
  if (explicit) return { videoModel: explicit, conflictModels: [] };
  const models = Array.from(
    new Set(
      input.blocks
        .filter(
          (block) =>
            block.kind === "video" &&
            block.id.startsWith("clip-") &&
            !block.archivedFromPreviousScript &&
            (getBlockEpisodeIndex(block) ?? 1) === input.episodeIndex,
        )
        .map((block) => {
          const raw = String(block.videoModel || "").trim();
          return normalizeCompilerEngineId(raw) || raw;
        })
        .filter(Boolean),
    ),
  );
  return models.length === 1
    ? { videoModel: models[0]!, conflictModels: [] }
    : { videoModel: "", conflictModels: models };
}

/** 超长证据只做可见节选，原稿不动；模型和用户都能知道未提供中段。 */
function excerptEvidence(value: string, max: number, label: string, notes: string[]): string {
  if (value.length <= max) return value;
  const notice = `【已节选：${label}共 ${value.length} 字，本次仅提供开头与结尾；未提供部分不可判定。】`;
  const divider = "\n【中段未提供】\n";
  const available = max - notice.length - divider.length - 1;
  const head = Math.ceil(available / 2);
  notes.push(`${label}已节选。查看具体内容时，请选中对应镜头后提问；不能据此判定未提供部分。`);
  return `${notice}\n${value.slice(0, head)}${divider}${value.slice(-(available - head))}`;
}

/** 只读取现有状态。没有人物真源、没有镜头产物时明确为空，不推测或造默认镜头。 */
export function buildManhuaAdvisorProject(input: {
  pack: ManhuaWriterPack | null;
  bible: ManhuaProjectBible | null;
  episodeIndex: number;
  phase: ManhuaCreativeAdvisorContext["stage"];
  videoModel: string;
  writerConfirmed: boolean;
  refs: ManhuaCustomAssetRef[];
  blocks: CanvasBlock[];
  selection?: AdvisorSelection | null;
} & AdvisorProjectSignals): {
  context: ManhuaCreativeAdvisorContext;
  issues: AdvisorIssue[];
  selectionLabel: string;
  contextNotes: string[];
  recommend3d: Manhua3dUsageRecommendation | null;
} {
  const episode = input.pack?.episodes.find((ep) => ep.index === input.episodeIndex);
  const canon = input.bible?.assetCanon;
  const issues: AdvisorIssue[] = [];
  const contextNotes: string[] = [];
  const engine = resolveManhuaAdvisorVideoModel({
    explicitVideoModel: input.videoModel,
    episodeIndex: input.episodeIndex,
    blocks: input.blocks,
  });
  if (!episode?.body.trim()) issues.push({ id: "script", text: "本集尚无剧本正文，请先导入或填写。", phase: "outline", blocking: true });
  if (!input.writerConfirmed || !canon?.characters.length) {
    issues.push({ id: "canon", text: "剧本人物表尚未确认；图片暂时无法认领到人物。", phase: "outline", blocking: true });
  }
  if (engine.conflictModels.length > 1) {
    issues.push({
      id: "engine-conflict",
      text: `本集成片节点存在 ${engine.conflictModels.length} 个不同引擎，顾问不会猜用哪一个；请先统一成片引擎。`,
      phase: "outline",
      blocking: true,
    });
  } else if (!normalizeCompilerEngineId(engine.videoModel)) {
    issues.push({ id: "engine", text: "尚未选择可用的成片引擎，不能确定成片提示词配方。", phase: "outline", blocking: true });
  }
  const gateZh = (input.gate || []).map((line) => clipSignal(line, LIMITS.gateChars)).filter(Boolean).slice(0, LIMITS.gateItems);
  if (gateZh.length) {
    issues.push({ id: "gate", text: `剧本门禁未过（${gateZh.length} 条）：${gateZh[0]}`, phase: "outline", blocking: true });
  }
  const roleNames = { character: "人物", scene: "场景", prop: "道具", wardrobe: "服装", unset: "未分类" };
  let unclaimed = 0;
  let pendingReview = 0;
  const assetSummary = input.refs.map((ref) => {
    const anchors = ref.role === "character" ? canon?.characters : ref.role === "scene" ? canon?.locations : canon?.props;
    const claims = (anchors || []).filter((a) => customAssetRefClaimsAnchor(ref, a));
    if (ref.role === "character" && !claims.length) unclaimed++;
    if (ref.reviewStatus === "needs_review") pendingReview++;
    const current = (ref.primaryBindings || []).filter((binding) => claims.some((a) => a.id === binding.anchorId));
    const model = ref.model3d;
    const modelState = !model ? "无" : model.status === "succeeded"
      ? "已保存（不代表已验证造型质量）" : model.status === "failed" ? "失败" : model.status === "reconcile_manual" ? "待对账" : "处理中";
    return `${roleNames[ref.role]}「${ref.labelZh || "未命名"}」：${claims.length ? `认领${claims.map((a) => a.nameZh).join("、")}` : "未认领"}；${current.length ? "当前参考" : "候选"}；${ref.reviewStatus === "needs_review" ? "待审核" : "无待审核标记"}；3D ${modelState}`;
  }).join("\n") || "尚未导入参考图。";
  if (unclaimed) issues.push({
    id: "claims",
    text: `${unclaimed} 张人物图尚未认领到本剧人物：不挡出片，但这些图不会被用作锁脸参考；认领后才会进入候选。`,
    phase: "assets",
    blocking: false,
  });
  if (pendingReview) issues.push({
    id: "review",
    text: `${pendingReview} 张参考图需要人工确认：确认前不参与出片，已认领的其它图照常可用。`,
    phase: "assets",
    blocking: false,
  });
  if (!canon?.locations.length && !input.refs.some((ref) => ref.role === "scene" && ref.reviewStatus !== "needs_review")) {
    issues.push({ id: "scene", text: "尚无已确认场景表或可用场景参考。", phase: "assets", blocking: true });
  }
  const assetGapZh = clipSignal(input.assetGap, LIMITS.signalChars);
  const assetGapPending = Number(ASSET_GAP_PATTERN.exec(assetGapZh)?.[1] || 0);
  if (assetGapPending > 0) {
    issues.push({ id: "asset-gap", text: `${assetGapZh}；补齐后再进分镜。`, phase: "assets", blocking: true });
  }
  const keyframeBlockZh = clipSignal(input.keyframeBlock, LIMITS.signalChars);
  if (keyframeBlockZh) {
    issues.push({ id: "keyframe", text: `关键静帧被拦：${keyframeBlockZh}`, phase: "storyboard", blocking: true });
  }
  const pipeline3dZh = clipSignal(input.pipeline3d, LIMITS.signalChars);
  const pipelineMatch = PIPELINE_3D_PATTERN.exec(pipeline3dZh);
  const modelReady = Number(pipelineMatch?.[1] || 0);
  const rigged = Number(pipelineMatch?.[2] || 0);
  if (modelReady > 0 && rigged === 0) {
    issues.push({
      id: "rig",
      text: `已有 ${modelReady} 个 3D 模型未绑骨：不挡静帧与成片，但白模里这些角色只能站着。`,
      phase: "storyboard",
      blocking: false,
    });
  }
  const queueZh = clipSignal(input.queue, LIMITS.signalChars);
  const creditsZh = clipSignal(input.credits, LIMITS.signalChars);
  const recommend3d = input.segments
    ? recommendManhua3dUsage({ segments: input.segments, lockedCharacterNames: input.lockedCharacterNames || [] })
    : null;
  if (recommend3d) {
    contextNotes.push(
      `空间预演与3D资产分别判断：走位、上楼、道具互动、舞台演出及打斗可先用通用白模，含对白也适用；角色3D资产另按已锁脸角色跨段复用收益评估，不自动生成。本集判定：${recommend3d.reasonZh}`,
    );
  }
  const scoped = input.blocks.filter((b) => !b.archivedFromPreviousScript && (getBlockEpisodeIndex(b) ?? 1) === input.episodeIndex);
  const selected = input.selection?.episodeIndex === input.episodeIndex ? input.selection : null;
  const shot = selected?.shot;
  const selectionLabel = shot ? `第 ${selected!.segmentIndex} 段 · 镜 ${shot.index}` : "本集（未指定镜头）";
  const shotSummary = shot
    ? `${selectionLabel}\n${JSON.stringify(shot)}`
    : scoped.filter((b) => /^(beats|reverse)-/.test(b.id) && b.outputText?.trim())
        .map((b) => `已生成${b.id.startsWith("beats-") ? "分镜" : "成片提示词"}：\n${b.outputText}`).join("\n") || "本集没有可读取的已生成分镜；未选中具体镜头。";
  // 只转发原始冻结身份；不能按当前注册表给旧项目凭空补上 revision。
  const rawStrategy = input.bible?.directorStrategyContract as { strategyId?: unknown; revision?: unknown } | null | undefined;
  const strategyId = MANHUA_CREATIVE_ADVISOR_STRATEGY_IDS.find((id) => id === rawStrategy?.strategyId);
  const strategyRevision = typeof rawStrategy?.revision === "string" ? rawStrategy.revision.trim() : "";
  return {
    context: {
      seriesTitle: excerptEvidence(input.pack?.seriesTitle || input.bible?.seriesTitle || "未命名项目", LIMITS.seriesTitleChars, "剧名", contextNotes),
      episodeIndex: input.episodeIndex,
      episodeTitle: excerptEvidence(episode?.title || "", LIMITS.episodeTitleChars, "本集标题", contextNotes),
      stage: input.phase,
      videoModel: engine.videoModel || "未选择",
      writerConfirmed: input.writerConfirmed,
      episodeBody: excerptEvidence(episode?.body || "", LIMITS.episodeBodyChars, "本集正文", contextNotes),
      assetSummary: excerptEvidence(assetSummary, LIMITS.assetSummaryChars, "资产摘要", contextNotes),
      shotSummary: excerptEvidence(shotSummary, LIMITS.shotSummaryChars, shot ? "选中镜头" : "本集分镜与成片提示词", contextNotes),
      previsSummary: excerptEvidence(buildAdvisorPrevisSummary(scoped), LIMITS.previsSummaryChars, "本集白模规格", contextNotes),
      blockers: issues.map((issue) => issue.text),
      ...(strategyId ? { directorStrategyId: strategyId } : {}),
      ...(strategyId && strategyRevision ? { directorStrategyRevision: strategyRevision } : {}),
      ...(gateZh.length ? { gateZh } : {}),
      ...(assetGapZh ? { assetGapZh } : {}),
      ...(keyframeBlockZh ? { keyframeBlockZh } : {}),
      ...(pipeline3dZh ? { pipeline3dZh } : {}),
      ...(queueZh ? { queueZh } : {}),
      ...(creditsZh ? { creditsZh } : {}),
    },
    issues,
    selectionLabel,
    contextNotes,
    recommend3d,
  };
}
