import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const omniSource = readFileSync(
  new URL("../pages/OmniCanvas.tsx", import.meta.url),
  "utf8",
);
const workbenchSource = readFileSync(
  new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url),
  "utf8",
);
const editPanelSource = readFileSync(
  new URL("../components/ManhuaEditMultitrackPanel.tsx", import.meta.url),
  "utf8",
);
const pipelineSource = readFileSync(
  new URL("./canvasDramaStudio.ts", import.meta.url),
  "utf8",
);
const freeformSource = readFileSync(
  new URL("../components/canvas/FreeformCanvas.tsx", import.meta.url),
  "utf8",
);
const reviewPanelSource = readFileSync(new URL("../components/ManhuaPilotReviewPanel.tsx", import.meta.url), "utf8");
const reviewHookSource = readFileSync(new URL("./useManhuaPilotReview.ts", import.meta.url), "utf8");

describe("漫剧首10秒质检与视频编辑接线", () => {
  it("审核与批量预检使用本集真实引擎，界面自动预选不覆盖历史节点", () => {
    const activeModel = omniSource.split("const activePilotVideoModel = useMemo(")[1]!
      .split("const pilotReview = useManhuaPilotReview(")[0]!;
    expect(activeModel).toContain("resolveManhuaEpisodeClipVideoModel(");
    expect(activeModel).toContain("writerFocusEpisode");
    expect(activeModel).not.toContain("explicitWriterVideoModel || writerVideoModel");
    const factory = omniSource.split("const runFactory = useCallback(")[1]!
      .split("const handleRetakeClip = useCallback(")[0]!;
    expect(factory).toMatch(/videoModel: resolveManhuaEpisodeClipVideoModel\(\s*workingBlocks,\s*episodeIndex,\s*explicitWriterVideoModel \|\| undefined,/);
    expect(factory).not.toContain("videoModel: activePilotVideoModel");
    expect(factory).not.toContain("explicitWriterVideoModel || writerVideoModel");
    expect(omniSource).not.toContain("explicitWriterVideoModel || writerVideoModel");
  });
  it("两个粗剪入口当场批量写回画布，合成扣费前检查同一顺序合同", () => {
    expect(workbenchSource.match(/onReorder=\{handleRoughShotReorder\}/g)).toHaveLength(2);
    expect(workbenchSource).not.toContain("onReorder={setRoughShotOrder}");
    expect(workbenchSource).toContain("persistClipEdits(fineCutByShot, order)");
    expect(workbenchSource).toContain("onApplyClipEditTrims(updates)");
    expect(workbenchSource).toContain("latestEditSourceIdentity.current !== sourceIdentity");
    expect(workbenchSource).toContain("[clip.shotIndex, clip.durationSec, clip.order]");
    expect(workbenchSource).toContain("onlyShotIndex == null || legacyOrderNeedsPersist");
    expect(omniSource).toContain("onApplyClipEditTrims={(updates)");
    const assemble = omniSource.slice(omniSource.indexOf("const assembleManhuaFinal"));
    expect(assemble.indexOf("buildManhuaAssemblePlan(ready)")).toBeGreaterThan(-1);
    expect(assemble.indexOf("buildManhuaAssemblePlan(ready)")).toBeLessThan(assemble.indexOf("await createJobSameOrigin"));
    expect(assemble.slice(0, assemble.indexOf("const out ="))).not.toContain("chargeWorkflowStepMutation.mutateAsync");
  });
  it("forces the pilot through the real clip pipeline with one submission", () => {
    expect(omniSource).toContain("compileManhuaPilotPrompt(pilotClip.prompt)");
    expect(omniSource).toContain("maxRetries: opts?.pilotRun ? 0");
    expect(omniSource).toContain("stopOnError: opts?.pilotRun ? true");
    expect(omniSource).toContain("pilotRun: opts?.pilotRun === true");
    expect(pipelineSource).toContain('pilotRun: opts.pilotRun === true && stage === "clip"');
    expect(omniSource).toContain("pilotReview.refresh()");
    expect(omniSource).toContain("authorizeManhuaClip: pilotReview.authorize");
    expect(omniSource).not.toContain("saveManhuaPilotGateStore");
    expect(workbenchSource).toContain("<ManhuaPilotReviewPanel");
    expect(reviewPanelSource).toContain("首段 10 秒质检门");
    expect(reviewPanelSource).toContain("质量达标，解锁");
    expect(reviewPanelSource).toContain("src={outputUrl}");
    expect(reviewPanelSource).toContain("onReview(decision, state.taskId)");
    expect(reviewHookSource).toContain("review.taskId !== taskId");
    expect(reviewHookSource).not.toContain("localStorage");
  });

  it("places video edit after clip QC and preserves prepared payload/history", () => {
    expect(editPanelSource).toContain('data-manhua-action="video-edit-clip"');
    expect(editPanelSource).toContain("位于单镜质检之后、最终拼接之前");
    expect(editPanelSource).toContain("成片版本");
    expect(omniSource).toContain('seedance25WorkMode: "video_edit"');
    expect(omniSource).toContain("handleSelectClipVersion");
    expect(omniSource).toContain("preparedTargetBlocks: [preparedBlock]");
    expect(pipelineSource).toContain("preservePreparedTargetBlocks");
    expect(pipelineSource).toContain("mergeManhuaMediaVersions");
    expect(omniSource).toContain("const preparedVideoEdit = isPreparedManhuaVideoEditRun({");
    expect(omniSource).toMatch(/fragmentShotIndex > 1 &&\s*!preparedVideoEdit/);
    expect(omniSource).toContain("const retakeBase = clearManhuaVideoEditOperation(hit)");
    expect(omniSource).toContain("if (!isCanvasProductVideoModel(retakeVideoModel))");
    expect(omniSource).toContain("seedance25WorkMode: fresh.seedance25WorkMode");
    expect(freeformSource).toContain("...compiled.videoRunPatch");
  });

  it("已有原片编辑绕开生成铺板与资产门禁，失败前不清旧版成品", () => {
    expect(omniSource).toContain("preparedEditOnly ? { blocks, edges } : ensureStudioSpawned(factoryTopic)");
    expect(omniSource).toContain('!preparedEditOnly && (untilStage === "keyart" || untilStage === "clip")');
    expect(omniSource).toContain("block.id === opts.targetBlockIds?.[0]");
    const handler = omniSource.split("const handleVideoEditClip = useCallback(")[1]!
      .split("const handleReviewPilot")[0]!;
    expect(handler).not.toContain("ensureStudioSpawned(factoryTopic)");
    expect(handler).not.toContain("outputUrl: undefined");
    expect(handler).not.toContain("lastFrameUrl: undefined");
    expect(handler).not.toContain("manhuaClipQuality: undefined");
    expect(handler).toContain("...hit,");
  });

  it("两个通用续跑入口都先拦住失败编辑，不能误转整集生成", () => {
    const handlers = [
      omniSource.split("const resumeFromFailure = useCallback(() => {")[1]!.split("}, [blocks, runFactory")[0]!,
      omniSource.split("onResumeFromFailure={() => {")[1]!.split("onRerunKeyartsFromReverse")[0]!,
    ];
    for (const handler of handlers) {
      expect(handler).toMatch(/if \(hasFailedManhuaVideoEdit\(blocks, \w+\)\) \{\s*toast.message\(MANHUA_EDIT_RESUME_HINT_ZH\);\s*return;/);
      expect(handler.indexOf("hasFailedManhuaVideoEdit")).toBeLessThan(handler.indexOf("resolveFactoryResumeStage"));
    }
  });

  it("loads workbench edit state only on episode key changes and guards writes until hydrated", () => {
    expect(workbenchSource).toContain("if (hydratedBPersistKey !== bPersistKey) return;");
    expect(workbenchSource).toContain("setHydratedBPersistKey(bPersistKey);");
    expect(workbenchSource).toMatch(
      /const hit = loadManhuaWorkbenchBPersist\(bPersistKey\);[\s\S]*?\}, \[bPersistKey\]\);/,
    );
    expect(workbenchSource).not.toMatch(
      /loadManhuaWorkbenchBPersist\(bPersistKey\)[\s\S]{0,1800}?\[bPersistKey,[\s\S]*?roughClips/,
    );
  });

  it("persists the probed source duration and never infers it from an already-cut out point", () => {
    expect(workbenchSource).toContain("sourceDurationSec: out.durationSec");
    expect(workbenchSource).toContain(
      "Number(clipBlock.manhuaEditTrim?.sourceDurationSec) || 0",
    );
    expect(workbenchSource).not.toContain(
      "Number(clipBlock.manhuaEditTrim?.outSec) || 0",
    );
  });

  it("passes the separate trajectory layer from store to generation dependencies", () => {
    expect(omniSource).toContain("manhuaDirectorBoardMotionOverlayByEpisodeSegment");
    expect(workbenchSource).toContain("directorBoardMotionOverlays?:");
    expect(workbenchSource).toContain("onDirectorBoardMotionOverlayChange");
    expect(workbenchSource).toContain("确认轨迹");
  });

  it("keeps five user-facing phases without changing legacy internal keys", () => {
    expect(workbenchSource).toContain('id: "storyboard",\n        label: "分镜"');
    expect(workbenchSource).toContain('id: "edit",\n        label: "成片"');
    expect(workbenchSource).toContain('id: "final",\n        label: "终审"');
    expect(workbenchSource).not.toContain('label: "剪辑"');
  });
});
