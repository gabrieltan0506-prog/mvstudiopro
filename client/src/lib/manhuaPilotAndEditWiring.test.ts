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

describe("漫剧首10秒质检与视频编辑接线", () => {
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
    expect(omniSource).toContain("recordManhuaPilotGenerated");
    expect(workbenchSource).toContain("首段 10 秒质检门");
    expect(workbenchSource).toContain("质量达标，解锁");
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
