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
