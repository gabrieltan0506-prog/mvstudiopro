import { lazy, Suspense, useMemo, useState } from "react";
import {
  createVideoEditOnlyAdvisorAction,
  videoEditOnlyAdvisorProject,
  type AdvisorVideoEditHub,
  type VideoEditOnlyAdvisorWork,
} from "@/lib/advisorVideoEditControl";
import { advisorWorkflowRevision } from "@/lib/manhuaAdvisorWorkflowPlan";

/** 首次点开才加载顾问面板（与页面其余部分无关的请求一律不发）。 */
const ManhuaCreativeAdvisorPanel = lazy(() => import("./ManhuaCreativeAdvisorPanel"));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 代码动画 / 营销页挂现有创作顾问：照 MV 后期工作台做法，顾问只经页面汇总调用各「局部修改」入口
 * （只预填打开面板，报价/确认/提交仍由用户在面板点），其他动作按现有方式拒绝；
 * 上下文带作品类型与作品编号，额度按该作品计（每部 5 次免费，超额确认才扣，管理员免扣）。
 */
export default function VideoEditOnlyAdvisor(props: {
  hub: AdvisorVideoEditHub;
  userId?: string;
  work: VideoEditOnlyAdvisorWork;
  buttonLabel: string;
  buttonClassName?: string;
  hint?: string;
  hintClassName?: string;
}) {
  const [open, setOpen] = useState(false),
    [loaded, setLoaded] = useState(false);
  const { kind, projectId, title, stageZh, body } = props.work;
  const ready = Boolean(props.userId && projectId && UUID.test(projectId));
  const scope = `${kind === "code_motion" ? "code-motion" : "marketing"}:${projectId || "none"}`;
  const project = useMemo(
    () => (ready ? videoEditOnlyAdvisorProject({ kind, projectId, title, stageZh, body }) : undefined),
    [ready, kind, projectId, title, stageZh, body]
  );
  const onVoiceProduction = useMemo(() => createVideoEditOnlyAdvisorAction(props.hub, scope), [props.hub, scope]);
  return (
    <>
      <button
        type="button"
        className={props.buttonClassName}
        disabled={!ready}
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
      >
        {props.buttonLabel}
      </button>
      {props.hint && <p className={props.hintClassName}>{props.hint}</p>}
      {loaded && project && (
        <Suspense fallback={null}>
          <ManhuaCreativeAdvisorPanel
            open={open}
            onClose={() => setOpen(false)}
            userId={props.userId}
            projectId={projectId}
            confirmedProjectVersion={scope}
            workflowRevision={advisorWorkflowRevision([scope])}
            project={project}
            stageZh={stageZh}
            storage={window.localStorage}
            beforeSubmit={async () => {}}
            automaticMonitoring={false}
            templates={[]}
            onRequestTrial={() => {
              throw new Error("本页不使用文案模板");
            }}
            cloudBackupControls={<p>问答随当前作品保存在本机。</p>}
            onVoiceProduction={onVoiceProduction}
          />
        </Suspense>
      )}
    </>
  );
}
