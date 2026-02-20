import { describe, it, expect } from "vitest";

/**
 * Unit tests for the upgraded storyboard copy-to-clipboard formatting logic.
 * Replicated from Storyboard.tsx — now includes all 14 professional dimensions.
 */

function formatStoryboardText(result: any): string {
  const lines: string[] = [];
  lines.push(`【${result.title || "分镜脚本"}】`);
  if (result.overallMood) lines.push(`整体情绪: ${result.overallMood}`);
  if (result.suggestedBPM) lines.push(`建议 BPM: ${result.suggestedBPM}`);
  if (result.colorPalette) lines.push(`色彩方案: ${result.colorPalette}`);
  lines.push("");

  (result.scenes || []).forEach((s: any, i: number) => {
    lines.push(`══ 场景 ${i + 1} ══  ${s.timeRange || ""}`);
    if (s.description) lines.push(`画面描述: ${s.description}`);
    if (s.lighting) lines.push(`灯光设计: ${s.lighting}`);
    if (s.characterExpression) lines.push(`人物表情: ${s.characterExpression}`);
    if (s.characterAction) lines.push(`人物动作: ${s.characterAction}`);
    if (s.characterDemeanor) lines.push(`人物神态: ${s.characterDemeanor}`);
    if (s.characterInteraction) lines.push(`人物互动: ${s.characterInteraction}`);
    if (s.shotType) lines.push(`摄影机位: ${s.shotType}`);
    if (s.cameraMovement) lines.push(`镜头运动: ${s.cameraMovement}`);
    if (s.colorTone) lines.push(`色调调色: ${s.colorTone}`);
    if (s.bpm) lines.push(`配乐节奏: ${s.bpm}`);
    if (s.mood) lines.push(`情绪氛围: ${s.mood}`);
    if (s.lyrics) lines.push(`对应歌词: ${s.lyrics}`);
    lines.push("");
  });
  return lines.join("\n");
}

function formatSceneText(scene: any, index: number): string {
  const lines: string[] = [];
  lines.push(`══ 场景 ${index + 1} ══  ${scene.timeRange || ""}`);
  if (scene.description) lines.push(`画面描述: ${scene.description}`);
  if (scene.lighting) lines.push(`灯光设计: ${scene.lighting}`);
  if (scene.characterExpression) lines.push(`人物表情: ${scene.characterExpression}`);
  if (scene.characterAction) lines.push(`人物动作: ${scene.characterAction}`);
  if (scene.characterDemeanor) lines.push(`人物神态: ${scene.characterDemeanor}`);
  if (scene.characterInteraction) lines.push(`人物互动: ${scene.characterInteraction}`);
  if (scene.shotType) lines.push(`摄影机位: ${scene.shotType}`);
  if (scene.cameraMovement) lines.push(`镜头运动: ${scene.cameraMovement}`);
  if (scene.colorTone) lines.push(`色调调色: ${scene.colorTone}`);
  if (scene.bpm) lines.push(`配乐节奏: ${scene.bpm}`);
  if (scene.mood) lines.push(`情绪氛围: ${scene.mood}`);
  if (scene.lyrics) lines.push(`对应歌词: ${scene.lyrics}`);
  return lines.join("\n");
}

describe("Storyboard copy formatting (upgraded)", () => {
  const mockResult = {
    title: "月光下的城市",
    overallMood: "忧郁浪漫",
    suggestedBPM: "85-100",
    colorPalette: "冷色调蓝紫为主，暖色点缀",
    scenes: [
      {
        sceneNumber: 1,
        timeRange: "0:00-0:15",
        description: "月光洒落在城市天际线上，高楼玻璃幕墙反射出冷蓝色光芒",
        lighting: "主光源：月光从左上方45度照射，色温偏冷蓝（5500K），逆光轮廓光勾勒人物剪影",
        characterExpression: "微微仰头，眼神迷离望向远方，嘴角微微下垂，流露出淡淡的忧伤",
        characterAction: "缓缓走在天台边缘，右手轻触栏杆，左手自然下垂，步伐缓慢而沉重",
        characterDemeanor: "内心孤独但坚强，气质忧郁中带着一丝倔强，情绪张力克制而深沉",
        characterInteraction: "独自一人，与城市灯光形成对比，渺小的身影与庞大的城市形成空间张力",
        shotType: "远景",
        cameraMovement: "缓慢推进，从全景逐渐推到中景",
        colorTone: "冷蓝色调为主，低饱和度，高对比度，暗角处理",
        bpm: "85-90 BPM，节奏舒缓，钢琴前奏",
        mood: "宁静忧郁",
        lyrics: "月光洒落在窗台",
        imagePrompt: "Cinematic wide shot, person standing on rooftop at night, moonlight from upper left, cold blue tones, city skyline background, silhouette backlit, melancholic atmosphere",
      },
      {
        sceneNumber: 2,
        timeRange: "0:15-0:30",
        description: "繁忙的十字路口，人潮涌动，霓虹灯闪烁",
        lighting: "多色霓虹灯光混合，暖色与冷色交替，路灯从上方打下柔和的顶光",
        characterExpression: "眼睛突然聚焦，瞳孔微微放大，嘴唇微张，表情从茫然转为惊喜",
        characterAction: "在人群中突然停下脚步，身体微微前倾，手不自觉地伸向前方",
        characterDemeanor: "从麻木中被唤醒，内心涌起一股暖流，气质从冷漠转为柔软",
        characterInteraction: "两人在人海中四目相对，周围人群虚化成光斑，只有彼此清晰",
        shotType: "中景",
        cameraMovement: "360度环绕拍摄，从男主视角旋转到女主视角",
        colorTone: "暖色调渐入，霓虹色彩丰富，中等饱和度",
        bpm: "95-100 BPM，节奏渐强，弦乐加入",
        mood: "期待与悸动",
        lyrics: "我们在人海中相遇",
        imagePrompt: "Medium shot, two people meeting eyes in crowded intersection, neon lights, bokeh crowd background, warm and cool mixed lighting, romantic atmosphere",
      },
    ],
  };

  it("should include title and overall metadata", () => {
    const text = formatStoryboardText(mockResult);
    expect(text).toContain("【月光下的城市】");
    expect(text).toContain("整体情绪: 忧郁浪漫");
    expect(text).toContain("建议 BPM: 85-100");
    expect(text).toContain("色彩方案: 冷色调蓝紫为主，暖色点缀");
  });

  it("should include all scenes", () => {
    const text = formatStoryboardText(mockResult);
    expect(text).toContain("场景 1");
    expect(text).toContain("场景 2");
    expect(text).toContain("0:00-0:15");
    expect(text).toContain("0:15-0:30");
  });

  it("should include all 14 professional dimensions", () => {
    const text = formatStoryboardText(mockResult);
    // Scene 1
    expect(text).toContain("画面描述: 月光洒落在城市天际线上");
    expect(text).toContain("灯光设计: 主光源：月光从左上方45度照射");
    expect(text).toContain("人物表情: 微微仰头");
    expect(text).toContain("人物动作: 缓缓走在天台边缘");
    expect(text).toContain("人物神态: 内心孤独但坚强");
    expect(text).toContain("人物互动: 独自一人");
    expect(text).toContain("摄影机位: 远景");
    expect(text).toContain("镜头运动: 缓慢推进");
    expect(text).toContain("色调调色: 冷蓝色调为主");
    expect(text).toContain("配乐节奏: 85-90 BPM");
    expect(text).toContain("情绪氛围: 宁静忧郁");
    expect(text).toContain("对应歌词: 月光洒落在窗台");
  });

  it("should use default title when missing", () => {
    const text = formatStoryboardText({ scenes: [] });
    expect(text).toContain("【分镜脚本】");
  });

  it("should omit metadata lines when not present", () => {
    const text = formatStoryboardText({ title: "测试", scenes: [] });
    expect(text).not.toContain("整体情绪:");
    expect(text).not.toContain("建议 BPM:");
    expect(text).not.toContain("色彩方案:");
  });

  it("formatSceneText should format a single scene with all dimensions", () => {
    const text = formatSceneText(mockResult.scenes[0], 0);
    expect(text).toContain("场景 1");
    expect(text).toContain("灯光设计:");
    expect(text).toContain("人物表情:");
    expect(text).toContain("人物动作:");
    expect(text).toContain("人物神态:");
    expect(text).toContain("人物互动:");
    expect(text).toContain("摄影机位: 远景");
    expect(text).toContain("镜头运动:");
    expect(text).toContain("色调调色:");
    expect(text).toContain("配乐节奏:");
    expect(text).not.toContain("场景 2");
  });

  it("formatSceneText should handle missing optional fields", () => {
    const minimalScene = { timeRange: "0:00-0:05" };
    const text = formatSceneText(minimalScene, 2);
    expect(text).toContain("场景 3");
    expect(text).toContain("0:00-0:05");
    expect(text).not.toContain("灯光设计:");
    expect(text).not.toContain("人物表情:");
    expect(text).not.toContain("对应歌词:");
  });

  it("scene 2 should have different details from scene 1", () => {
    const text = formatStoryboardText(mockResult);
    expect(text).toContain("360度环绕拍摄");
    expect(text).toContain("期待与悸动");
    expect(text).toContain("95-100 BPM");
  });
});
