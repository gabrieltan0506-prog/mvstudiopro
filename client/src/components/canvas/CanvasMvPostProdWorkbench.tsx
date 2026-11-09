import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AdvisorEffectsControl,
  AdvisorEffectsRegistration,
} from "@shared/manhuaAdvisorEffects";
import type {
  AdvisorEditControl,
  AdvisorEditRegistration,
  AdvisorScoringControl,
  AdvisorScoringRegistration,
  AdvisorVideoEditControl,
  AdvisorVideoEditRegistration,
} from "@/lib/manhuaAdvisorWorkflowControl";
import type { ManhuaAdvisorStudioContext } from "@shared/manhuaAdvisorStudioContext";
import {
  MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS,
  manhuaCreativeAdvisorContextSchema,
} from "@shared/manhuaCreativeAdvisor";
import { advisorWorkflowRevision } from "@/lib/manhuaAdvisorWorkflowPlan";
import PostProdWorkshopCard from "./PostProdWorkshopCard";
import ManhuaCreativeAdvisorPanel from "./ManhuaCreativeAdvisorPanel";

/**
 * MV 第 5 步：照数字人后期工作台原样挂同一个后期工坊（剪辑方案→采用→concat、配乐、字幕、特效）
 * 与同一个创作顾问；顾问只调用工坊已注册的真实控件（effects / scoring / edit），不另设剪辑体系。
 */
export function CanvasMvPostProdWorkbench(props: {
  userId: string;
  projectId?: string;
  /** MV 方案编号：作为后期工坊的项目作用域，换方案即换工作区。 */
  scope: string;
  title: string;
  aspect: "9:16" | "16:9";
  videoModel: string;
  media: {
    clips: { id: string; url: string; label: string }[];
    audio: { id: string; url: string; label: string }[];
    story: string;
  };
  storage: Storage;
  disabled: boolean;
  beforeSubmit: () => Promise<void>;
}) {
  const [advisorOpen, setAdvisorOpen] = useState(false),
    [dock, setDock] = useState<HTMLDivElement | null>(null);
  const [focus, setFocus] = useState<ManhuaAdvisorStudioContext>({
    tool: "postprod",
    task: "concat",
    episodeIndex: 1,
  });
  const effects = useRef(new Map<string, AdvisorEffectsControl>()),
    scoring = useRef<AdvisorScoringControl | null>(null),
    edit = useRef<AdvisorEditControl | null>(null),
    /** 视频局部修改面板挂载后经此注册（只预填，不提交）。 */
    videoEdit = useRef<AdvisorVideoEditControl | null>(null);
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
  const registerEdit = useCallback<AdvisorEditRegistration>(control => {
    edit.current = control;
  }, []);
  const registerVideoEdit = useCallback<AdvisorVideoEditRegistration>(control => {
    videoEdit.current = control;
  }, []);
  const latest = useRef(props);
  latest.current = props;
  const advisorProject = useMemo(() => {
    const clipText = props.media.clips
      .map((c, i) => `${i + 1}. ${c.label}（${c.id}）`)
      .join("\n");
    const context = manhuaCreativeAdvisorContextSchema.parse({
      ...(props.projectId ? { projectId: props.projectId } : {}),
      seriesTitle: (props.title || "音乐MV").slice(
        0,
        MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.seriesTitleChars
      ),
      episodeIndex: 1,
      episodeTitle: "MV剪辑",
      stage: "final",
      activeStudio: focus,
      videoModel: props.videoModel || "seedance-2.0",
      writerConfirmed: true,
      episodeBody: props.media.story || "无歌词（纯音乐）",
      assetSummary: `原歌曲：${props.media.audio.map(a => a.label).join("、") || "未选"}`,
      shotSummary:
        clipText.length + 150 <=
        MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.shotSummaryChars
          ? `${clipText}\n后期素材及参数请使用inspect读取；可操作剪辑方案切点、特效、字幕、转场和配乐，未挂载的操作须回到对应制作入口。`
          : "MV镜头较多，后期真实素材清单请使用inspect读取。",
    });
    return {
      context,
      issues: [],
      selectionLabel: "当前MV剪辑",
      contextNotes: [],
      recommend3d: null,
      videoPromptDrafts: [],
    };
  }, [
    props.media,
    props.projectId,
    props.title,
    props.videoModel,
    focus,
  ]);
  return (
    <>
      <button
        type="button"
        className="rounded border border-white/20 px-2 py-1.5 text-xs disabled:opacity-40"
        onClick={() => setAdvisorOpen(true)}
      >
        创作顾问 · 用一句话改剪辑
      </button>
      <PostProdWorkshopCard
        blocks={[]}
        userId={props.userId}
        mediaInput={props.media}
        storage={props.storage}
        projectScopeKey={props.scope}
        vfxScopeKey={props.scope}
        orderedClipIds={props.media.clips.map(c => c.id)}
        initialAspect={props.aspect}
        focusEpisode={1}
        onAdvisorEffectsControl={registerEffects}
        onAdvisorControl={registerScoring}
        onAdvisorEditControl={registerEdit}
        onAdvisorVideoEditControl={registerVideoEdit}
        onStudioFocus={setFocus}
        onOpenAdvisor={() => setAdvisorOpen(true)}
        advisorOpen={advisorOpen}
        onVfxAdvisorDockChange={setDock}
        advisorContext={advisorProject.context}
        beforeSubmit={props.beforeSubmit}
        disabled={props.disabled}
      />
      <ManhuaCreativeAdvisorPanel
        open={advisorOpen}
        onClose={() => setAdvisorOpen(false)}
        dockHost={dock}
        userId={props.userId}
        projectId={props.projectId}
        confirmedProjectVersion={props.scope}
        workflowRevision={advisorWorkflowRevision([props.media])}
        project={advisorProject}
        stageZh="MV剪辑"
        storage={props.storage}
        beforeSubmit={props.beforeSubmit}
        automaticMonitoring={false}
        templates={[]}
        onRequestTrial={() => {
          throw new Error("MV剪辑不使用文案模板");
        }}
        cloudBackupControls={
          <p>问答和剪辑方案随当前 MV 保存在本机工作区。</p>
        }
        onVoiceProduction={async (action, signal) => {
          signal.throwIfAborted();
          if (!live.current) throw new Error("剪辑工作区已切换");
          if (action.action === "inspect")
            return JSON.stringify({
              scope: props.scope,
              operations: ["edit", "effects", "scoring"],
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
          // 视频局部修改：只打开面板预填，不经 beforeSubmit、不提交
          if (action.action === "videoEdit") {
            if (!videoEdit.current)
              throw new Error("视频局部修改尚未就绪，请先打开后期工坊的视频局部修改");
            return await videoEdit.current(action, signal);
          }
          if (
            action.action !== "effects" &&
            action.action !== "scoring" &&
            action.action !== "edit"
          )
            throw new Error("此操作请使用对应制作入口");
          const control =
            action.action === "effects"
              ? effects.current.get(action.tool)
              : action.action === "scoring"
                ? scoring.current
                : edit.current;
          if (!control)
            throw new Error("此操作不在当前剪辑工作区，请使用对应制作入口");
          if (latest.current.disabled && action.operation !== "inspect")
            throw new Error("MV 正在处理，请稍后操作");
          const source = advisorWorkflowRevision([
            latest.current.scope,
            latest.current.media,
          ]);
          await latest.current.beforeSubmit();
          signal.throwIfAborted();
          if (
            source !==
            advisorWorkflowRevision([latest.current.scope, latest.current.media])
          )
            throw new Error("剪辑素材已变化，请重新读取后操作");
          if (!live.current) throw new Error("剪辑工作区已切换，未提交");
          const result =
            action.action === "effects"
              ? await (control as AdvisorEffectsControl)(action, signal)
              : action.action === "scoring"
                ? await (control as AdvisorScoringControl)(
                    action as Parameters<AdvisorScoringControl>[0],
                    signal
                  )
                : await (control as AdvisorEditControl)(
                    action as Parameters<AdvisorEditControl>[0],
                    signal
                  );
          await latest.current.beforeSubmit();
          return result;
        }}
      />
    </>
  );
}
