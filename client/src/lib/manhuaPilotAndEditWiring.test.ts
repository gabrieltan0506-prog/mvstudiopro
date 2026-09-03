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

  it("passes the separate trajectory layer from store to generation dependencies", () => {
    expect(omniSource).toContain("manhuaDirectorBoardMotionOverlayByEpisodeSegment");
    expect(workbenchSource).toContain("轨迹与底图分开保存");
    expect(workbenchSource).toContain("确认轨迹");
  });

  it("keeps five user-facing phases without changing legacy internal keys", () => {
    expect(workbenchSource).toContain('id: "storyboard",\n        label: "分镜"');
    expect(workbenchSource).toContain('id: "edit",\n        label: "成片"');
    expect(workbenchSource).toContain('id: "final",\n        label: "终审"');
    expect(workbenchSource).not.toContain('label: "剪辑"');
  });
});
