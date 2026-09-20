import { describe, expect, it } from "vitest";
import {
  formatAdvisorShotsAsBeatsMarkdown,
  mapAdvisorPlanToWorkbenchSync,
  mapAdvisorShotsToWorkbench,
} from "./manhuaAgentLoopSync";

describe("manhuaAgentLoopSync", () => {
  it("maps exported shots to workbench shots", () => {
    const shots = mapAdvisorShotsToWorkbench([
      {
        index: 1,
        cameraZh: "特写",
        actionZh: "女主压住哭腔",
        dialogueZh: "你说过会回来",
        emotionZh: "委屈",
      },
      {
        index: 2,
        visualDesc: "中景，男主背对门口停住",
      },
    ]);
    expect(shots).toHaveLength(2);
    expect(shots[0]?.index).toBe(1);
    expect(shots[0]?.cameraZh).toBe("特写");
    expect(shots[0]?.dialogueZh).toContain("回来");
    expect(shots[1]?.index).toBe(2);
    expect(shots[1]?.actionZh).toContain("男主");
  });

  it("builds beats markdown and sync payload", () => {
    const sync = mapAdvisorPlanToWorkbenchSync({
      story: "故事正文",
      script: "剧本",
      characters: [{ name: "女主" }],
      shots: [{ index: 1, cameraZh: "近景", actionZh: "推门" }],
    });
    expect(sync?.storyText).toBe("故事正文");
    expect(sync?.shots).toHaveLength(1);
    expect(sync?.beatsMarkdown).toContain("## 分镜表");
    expect(formatAdvisorShotsAsBeatsMarkdown(sync!.shots)).toContain("推门");
  });

  it("returns null when plan is empty", () => {
    expect(mapAdvisorPlanToWorkbenchSync({ shots: [] })).toBeNull();
  });
});

it("单镜同步经文本存储回读保留微表情、语气、情绪和时长，特殊字符不串列",async()=>{
 const {parseWorkbenchShotsFromTextResult}=await import("./manhuaScriptWorkbench");
 const sync=mapAdvisorPlanToWorkbenchSync({shots:[{index:1,durationSec:7,cameraZh:"近景",actionZh:"听到门响，握拳|松手",dialogueZh:"娘：「慢点。」",emotionZh:"惊惧转为克制",microExpressionZh:"听见脚步后眉心收紧\n确认来人后嘴角放松",voiceToneZh:"先压低声音，再恢复平稳"}]})!;
 const restored=parseWorkbenchShotsFromTextResult(JSON.parse(JSON.stringify({text:sync.beatsMarkdown})).text);
 expect(restored.isFallback).toBe(false);expect(restored.shots).toHaveLength(1);
 expect(restored.shots[0]).toMatchObject({durationSec:7,emotionZh:"惊惧转为克制",voiceToneZh:"先压低声音，再恢复平稳"});
 expect(restored.shots[0].actionZh).toContain("握拳|松手");
 expect(restored.shots[0].microExpressionZh).toContain("听见脚步后眉心收紧");
 expect(restored.shots[0].microExpressionZh).toContain("确认来人后嘴角放松");
});
