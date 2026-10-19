import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import type { DigitalHumanDraft } from "@shared/digitalHumanStudio";
import { mergeManhuaVfxState, type ManhuaVfxState } from "@shared/manhuaVfx";
import { manhuaVfxEnvironmentOptions } from "@shared/manhuaVfxEnvironment";
import type {
  AdvisorEffectsControl,
  AdvisorEffectsRegistration,
} from "@shared/manhuaAdvisorEffects";
import type {
  AdvisorScoringControl,
  AdvisorScoringRegistration,
} from "@/lib/manhuaAdvisorWorkflowControl";
import type { ManhuaAdvisorStudioContext } from "@shared/manhuaAdvisorStudioContext";
import { buildDigitalHumanAdvisorProject } from "@/lib/digitalHumanAdvisor";
import {
  digitalHumanVfxAssets,
  digitalHumanVfxKey,
  readDigitalHumanVfx,
} from "@/lib/digitalHumanPostProd";
import { MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS } from "@shared/manhuaCreativeAdvisor";
import { manhuaVfxMediaIdentity } from "@/lib/manhuaVfxWorkflow";
import type { ManhuaWorldTaskView } from "../../../server/services/manhuaWorldTask";
import { advisorWorkflowRevision } from "@/lib/manhuaAdvisorWorkflowPlan";
import { trpc } from "@/lib/trpc";
import PostProdWorkshopCard from "./canvas/PostProdWorkshopCard";
import ManhuaCreativeAdvisorPanel from "./canvas/ManhuaCreativeAdvisorPanel";

/** 段落与整片共用同一后期入口，所有回执进入对应云稿，顾问只调用已挂载的真实控件。 */
export function DigitalHumanPostProdWorkbench(props: {
  draft: DigitalHumanDraft;
  drafts?: DigitalHumanDraft[];
  scope: string;
  storage: Storage;
  media: {
    clips: { id: string; url: string; label: string }[];
    audio: { id: string; url: string; label: string }[];
    story: string;
  };
  orderedClipIds?: string[];
  userRole?: string | null;
  disabled: boolean;
  beforeSubmit: () => Promise<void>;
  acquireWork: (label: string) => () => void;
}) {
  const [advisorOpen, setAdvisorOpen] = useState(false),
    [dock, setDock] = useState<HTMLDivElement | null>(null);
  const [focus, setFocus] = useState<ManhuaAdvisorStudioContext>({
    tool: "postprod",
    task: "concat",
    episodeIndex: 1,
  });
  const effects = useRef(new Map<string, AdvisorEffectsControl>()),
    scoring = useRef<AdvisorScoringControl | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const registerEffects = useCallback<AdvisorEffectsRegistration>(
    (scope, tool, control) => {
      if (scope !== props.scope) return;
      if (control) effects.current.set(tool, control);
      else effects.current.delete(tool);
    },
    [props.scope]
  );
  const registerScoring = useCallback<AdvisorScoringRegistration>(
    (scope, control) => {
      if (scope === props.scope) scoring.current = control;
    },
    [props.scope]
  );
  const latest = useRef(props);
  latest.current = props;
  const api = trpc.useUtils();
  const [worlds, setWorlds] = useState<ManhuaWorldTaskView[]>([]);
  const [worldError, setWorldError] = useState("");
  const drafts = props.drafts ?? [props.draft];
  const worldIds = JSON.stringify(
    Array.from(
      new Set(drafts.flatMap(d => (d.worldTaskId ? [d.worldTaskId] : [])))
    ).sort()
  );
  useEffect(() => {
    let cancelled = false;
    setWorlds([]);
    setWorldError("");
    const ids = JSON.parse(worldIds) as string[];
    if (!ids.length) return;
    if (!["admin", "supervisor"].includes(props.userRole || "")) {
      setWorldError("当前账号不能读取三维场景，已保存的场景选择仍保留。");
      return;
    }
    // 按已保存任务编号取回，不依赖最近列表的分页窗口。
    void Promise.allSettled(
      ids.map(taskId => api.manhuaWorld.getStatus.fetch({ taskId }))
    ).then(results => {
      if (cancelled) return;
      setWorlds(
        results.flatMap(r => (r.status === "fulfilled" ? [r.value] : []))
      );
      if (results.some(r => r.status === "rejected"))
        setWorldError(
          "部分已选三维场景暂时无法读取，请恢复连接后重开工作区；原选择未删除。"
        );
    });
    return () => {
      cancelled = true;
    };
  }, [api, worldIds, props.userRole]);
  const assets = digitalHumanVfxAssets(drafts);
  const environments = manhuaVfxEnvironmentOptions(
    drafts.flatMap(d => {
      const w = worlds.find(
        w =>
          w.taskId === d.worldTaskId &&
          manhuaVfxMediaIdentity(w.sourceVersion) ===
            manhuaVfxMediaIdentity(d.scene?.source || "")
      );
      return w && d.scene
        ? [
            {
              id: w.sceneRef,
              labelZh: d.scene.name,
              role: "scene" as const,
              url: d.scene.source,
              world3d: { ...w, updatedAt: Date.parse(w.updatedAt) },
            },
          ]
        : [];
    })
  );
  let state: ManhuaVfxState | undefined,
    stateError = "";
  try {
    state = readDigitalHumanVfx(
      {
        [digitalHumanVfxKey(props.scope)]:
          props.storage.getItem(digitalHumanVfxKey(props.scope)) || "",
      },
      props.scope
    );
  } catch (e) {
    stateError = e instanceof Error ? e.message : String(e);
  }
  async function persistVfx(next: ManhuaVfxState) {
    if (!live.current) throw new Error("原后期工作区已关闭，未保存旧方案");
    if (next.scopeKey !== props.scope)
      throw new Error("特效方案不属于当前制作稿");
    const key = digitalHumanVfxKey(props.scope);
    const previous = readDigitalHumanVfx(
      { [key]: latest.current.storage.getItem(key) || "" },
      props.scope
    );
    const merged = mergeManhuaVfxState(previous, next);
    latest.current.storage.setItem(key, JSON.stringify(merged));
    await latest.current.beforeSubmit();
    return merged;
  }
  const advisorProject = useMemo(() => {
    const result = buildDigitalHumanAdvisorProject(props.draft);
    return {
      ...result,
      context: {
        ...result.context,
        stage: "final" as const,
        activeStudio: focus,
        projectId: props.draft.project?.id || props.draft.id,
        episodeBody: props.media.story,
        shotSummary:
          (result.context.shotSummary || "").length + 150 <=
          MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.shotSummaryChars
            ? `${result.context.shotSummary || ""}\n后期素材及参数请使用inspect读取；可操作特效、字幕、转场和配乐，未挂载的操作须回到对应制作入口。`
            : "完整导演要求见digitalHumanProduction；后期真实素材清单请使用inspect读取。",
      },
    };
  }, [props.draft, props.media, focus]);
  return (
    <>
      <button type="button" onClick={() => setAdvisorOpen(true)}>
        创作顾问 · 后期与特效
      </button>
      {worldError && <p role="alert">{worldError}</p>}
      {stateError && (
        <p role="alert">
          特效记录无法读取：{stateError}。原记录保留，请从云端恢复。
        </p>
      )}
      <PostProdWorkshopCard
        blocks={[]}
        userId={props.draft.owner}
        userRole={props.userRole}
        mediaInput={props.media}
        storage={props.storage}
        projectScopeKey={props.scope}
        vfxScopeKey={props.scope}
        orderedClipIds={props.orderedClipIds}
        initialAspect={props.draft.aspectRatio}
        subtitleDefaultMarginV={50}
        focusEpisode={1}
        vfxState={state}
        onVfxStateChange={stateError ? undefined : persistVfx}
        vfxImages={assets.images}
        vfxScenesInput={assets.scenes}
        vfxEnvironments={environments}
        onAdvisorEffectsControl={registerEffects}
        onAdvisorControl={registerScoring}
        onStudioFocus={setFocus}
        onOpenAdvisor={() => setAdvisorOpen(true)}
        advisorOpen={advisorOpen}
        onVfxAdvisorDockChange={setDock}
        advisorContext={advisorProject.context}
        beforeSubmit={props.beforeSubmit}
        acquireWork={props.acquireWork}
        disabled={props.disabled || Boolean(stateError)}
      />
      <ManhuaCreativeAdvisorPanel
        open={advisorOpen}
        onClose={() => setAdvisorOpen(false)}
        dockHost={dock}
        userId={props.draft.owner}
        projectId={props.draft.project?.id || props.draft.id}
        confirmedProjectVersion={props.scope}
        workflowRevision={advisorWorkflowRevision([props.media, state])}
        project={advisorProject}
        stageZh="数字人后期"
        storage={props.storage}
        beforeSubmit={props.beforeSubmit}
        automaticMonitoring={false}
        templates={[]}
        onRequestTrial={() => {
          throw new Error("请在文案入口选择模板");
        }}
        cloudBackupControls={
          <p>
            问答和操作方案随当前制作稿保存。历史版本请从“云端备份与回填”恢复。
          </p>
        }
        onVoiceProduction={async (action, signal) => {
          signal.throwIfAborted();
          if (!live.current) throw new Error("后期工作区已切换");
          if (action.action === "inspect")
            return JSON.stringify({
              scope: props.scope,
              operations: ["effects", "scoring"],
              effects: { tools: ["vfx", "title", "transition"] },
              clips: latest.current.media.clips.map(({ id, label }) => ({
                id,
                label,
              })),
              music: latest.current.media.audio.map(({ id, label }) => ({
                id,
                label,
              })),
            });
          if (action.action !== "effects" && action.action !== "scoring")
            throw new Error("此操作请使用对应制作入口");
          const control =
            action.action === "effects"
              ? effects.current.get(action.tool)
              : action.action === "scoring"
                ? scoring.current
                : undefined;
          if (!control)
            throw new Error("此操作不在当前后期工作区，请使用对应制作入口");
          if (latest.current.disabled && action.operation !== "inspect")
            throw new Error("当前制作稿正在处理，请稍后操作");
          const source = advisorWorkflowRevision([
            latest.current.scope,
            latest.current.media,
          ]);
          await latest.current.beforeSubmit();
          signal.throwIfAborted();
          if (
            source !==
            advisorWorkflowRevision([
              latest.current.scope,
              latest.current.media,
            ])
          )
            throw new Error("后期素材已变化，请重新读取后操作");
          if (!live.current) throw new Error("后期工作区已切换，未提交");
          const result =
            action.action === "effects"
              ? await (control as AdvisorEffectsControl)(action, signal)
              : await (control as AdvisorScoringControl)(
                  action as Parameters<AdvisorScoringControl>[0],
                  signal
                );
          await latest.current.beforeSubmit();
          return result;
        }}
      />
    </>
  );
}
