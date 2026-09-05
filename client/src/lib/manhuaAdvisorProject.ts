import { MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS as LIMITS, MANHUA_CREATIVE_ADVISOR_STRATEGY_IDS, type ManhuaCreativeAdvisorContext } from "@shared/manhuaCreativeAdvisor";
import type { ManhuaWriterPack } from "@shared/manhuaWriterRoom";
import type { ManhuaProjectBible } from "@shared/manhuaProjectBible";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import type { ManhuaWorkbenchShot } from "@shared/manhuaScriptWorkbench";
import { customAssetRefClaimsAnchor } from "@shared/manhuaAssetScriptSync";
import { normalizeCompilerEngineId } from "@shared/manhuaShotIR";
import type { CanvasBlock } from "./canvasTypes";
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
};

export type AdvisorVideoModelResolution = {
  videoModel: string;
  conflictModels: string[];
};

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
}): { context: ManhuaCreativeAdvisorContext; issues: AdvisorIssue[]; selectionLabel: string; contextNotes: string[] } {
  const episode = input.pack?.episodes.find((ep) => ep.index === input.episodeIndex);
  const canon = input.bible?.assetCanon;
  const issues: AdvisorIssue[] = [];
  const contextNotes: string[] = [];
  const engine = resolveManhuaAdvisorVideoModel({
    explicitVideoModel: input.videoModel,
    episodeIndex: input.episodeIndex,
    blocks: input.blocks,
  });
  if (!episode?.body.trim()) issues.push({ id: "script", text: "本集尚无剧本正文，请先导入或填写。", phase: "outline" });
  if (!input.writerConfirmed || !canon?.characters.length) {
    issues.push({ id: "canon", text: "剧本人物表尚未确认；图片暂时无法认领到人物。", phase: "outline" });
  }
  if (engine.conflictModels.length > 1) {
    issues.push({
      id: "engine-conflict",
      text: `本集成片节点存在 ${engine.conflictModels.length} 个不同引擎，顾问不会猜用哪一个；请先统一成片引擎。`,
      phase: "outline",
    });
  } else if (!normalizeCompilerEngineId(engine.videoModel)) {
    issues.push({ id: "engine", text: "尚未选择可用的成片引擎，不能确定成片提示词配方。", phase: "outline" });
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
  if (unclaimed) issues.push({ id: "claims", text: `${unclaimed} 张人物图尚未认领到本剧人物。`, phase: "assets" });
  if (pendingReview) issues.push({ id: "review", text: `${pendingReview} 张参考图需要人工确认。`, phase: "assets" });
  if (!canon?.locations.length && !input.refs.some((ref) => ref.role === "scene" && ref.reviewStatus !== "needs_review")) {
    issues.push({ id: "scene", text: "尚无已确认场景表或可用场景参考。", phase: "assets" });
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
      blockers: issues.map((issue) => issue.text),
      ...(strategyId ? { directorStrategyId: strategyId } : {}),
      ...(strategyId && strategyRevision ? { directorStrategyRevision: strategyRevision } : {}),
    },
    issues,
    selectionLabel,
    contextNotes,
  };
}
