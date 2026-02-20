import { describe, it, expect } from "vitest";

/**
 * Unit tests for the storyboard copy-to-clipboard formatting logic.
 * We replicate the pure formatting functions here since they live in a React component.
 */

function formatStoryboardText(result: any): string {
  const lines: string[] = [];
  lines.push(`【${result.title || "分镜脚本"}】`);
  lines.push("");

  const scenes: any[] = result.scenes || [];
  scenes.forEach((scene: any, i: number) => {
    lines.push(`── 场景 ${i + 1}: ${scene.title || ""} ──`);
    if (scene.duration || scene.cameraAngle) {
      lines.push(`时长: ${scene.duration || "4s"}  |  机位: ${scene.cameraAngle || "中景"}`);
    }
    if (scene.description || scene.visual) {
      lines.push(`画面描述: ${scene.description || scene.visual}`);
    }
    if (scene.lyrics) {
      lines.push(`对应歌词: ${scene.lyrics}`);
    }
    if (scene.mood) {
      lines.push(`情绪氛围: ${scene.mood}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

function formatSceneText(scene: any, index: number): string {
  const lines: string[] = [];
  lines.push(`── 场景 ${index + 1}: ${scene.title || ""} ──`);
  if (scene.duration || scene.cameraAngle) {
    lines.push(`时长: ${scene.duration || "4s"}  |  机位: ${scene.cameraAngle || "中景"}`);
  }
  if (scene.description || scene.visual) {
    lines.push(`画面描述: ${scene.description || scene.visual}`);
  }
  if (scene.lyrics) {
    lines.push(`对应歌词: ${scene.lyrics}`);
  }
  if (scene.mood) {
    lines.push(`情绪氛围: ${scene.mood}`);
  }
  return lines.join("\n");
}

describe("Storyboard copy formatting", () => {
  const mockResult = {
    title: "月光下的城市",
    scenes: [
      {
        title: "开场",
        duration: "5s",
        cameraAngle: "远景",
        description: "月光洒落在城市天际线上",
        lyrics: "月光洒落在窗台",
        mood: "宁静",
      },
      {
        title: "相遇",
        duration: "4s",
        cameraAngle: "中景",
        description: "两人在人海中相遇",
        lyrics: "我们在人海中相遇",
        mood: "期待",
      },
    ],
  };

  it("formatStoryboardText should include title", () => {
    const text = formatStoryboardText(mockResult);
    expect(text).toContain("【月光下的城市】");
  });

  it("formatStoryboardText should include all scenes", () => {
    const text = formatStoryboardText(mockResult);
    expect(text).toContain("场景 1: 开场");
    expect(text).toContain("场景 2: 相遇");
  });

  it("formatStoryboardText should include scene details", () => {
    const text = formatStoryboardText(mockResult);
    expect(text).toContain("时长: 5s");
    expect(text).toContain("机位: 远景");
    expect(text).toContain("画面描述: 月光洒落在城市天际线上");
    expect(text).toContain("对应歌词: 月光洒落在窗台");
    expect(text).toContain("情绪氛围: 宁静");
  });

  it("formatStoryboardText should use default title when missing", () => {
    const text = formatStoryboardText({ scenes: [] });
    expect(text).toContain("【分镜脚本】");
  });

  it("formatSceneText should format a single scene", () => {
    const text = formatSceneText(mockResult.scenes[0], 0);
    expect(text).toContain("场景 1: 开场");
    expect(text).toContain("画面描述: 月光洒落在城市天际线上");
    expect(text).toContain("对应歌词: 月光洒落在窗台");
    expect(text).not.toContain("场景 2");
  });

  it("formatSceneText should handle missing optional fields", () => {
    const minimalScene = { title: "简单场景" };
    const text = formatSceneText(minimalScene, 2);
    expect(text).toContain("场景 3: 简单场景");
    expect(text).not.toContain("画面描述");
    expect(text).not.toContain("对应歌词");
    expect(text).not.toContain("情绪氛围");
  });

  it("formatSceneText should use defaults for duration and cameraAngle", () => {
    const sceneWithDuration = { title: "测试", duration: "3s" };
    const text = formatSceneText(sceneWithDuration, 0);
    expect(text).toContain("时长: 3s");
    expect(text).toContain("机位: 中景");
  });
});
