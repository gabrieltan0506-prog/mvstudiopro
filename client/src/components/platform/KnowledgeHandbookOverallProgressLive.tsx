import { KnowledgeCardProgress, type KnowledgeCardProgressState } from "./KnowledgeCardProgress";
import { useKnowledgeStageElapsed } from "./KnowledgePublicationStageDetail";
import { knowledgeHandbookOverallProgress, type KnowledgeLayoutDecision } from "@/lib/knowledgeHandbookOverallProgress";
import type { KnowledgePublicationStage } from "@/lib/knowledgePublicationStage";

/**
 * 总体进度条的自走时版本：排版进行中每秒自己重算一次，使没有计数的步（统稿、PDF）也持续前进；
 * 计时只在这个小组件里发生，不让整个创作页每秒重渲染。
 */
export function KnowledgeHandbookOverallProgressLive({ base, decision, stage, layoutError, onCancel, cancelBusy }: {
  base: KnowledgeCardProgressState; decision: KnowledgeLayoutDecision; stage: KnowledgePublicationStage | null; layoutError?: string | null;
  onCancel?: () => void; cancelBusy?: boolean;
}) {
  const active = decision === "layout" && base.status === "succeeded";
  const stageElapsedMs = useKnowledgeStageElapsed(active ? stage : null, layoutError);
  return <KnowledgeCardProgress state={knowledgeHandbookOverallProgress({ base, decision, stage, layoutError, stageElapsedMs })} onCancel={onCancel} cancelBusy={cancelBusy} />;
}
