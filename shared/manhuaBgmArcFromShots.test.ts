import { describe, expect, it } from "vitest";
import { manhuaBgmArcFromShots } from "./manhuaBgmArcFromShots";
import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench";

const shot = (index: number, actionZh: string, dialogueZh = ""): ManhuaWorkbenchShot => ({
  index, durationSec: 4, cameraZh: "平视", actionZh, dialogueZh,
});

describe("manhuaBgmArcFromShots", () => {
  it("按真实镜序与时长起稿，并给对白让位", () => {
    const result = manhuaBgmArcFromShots([shot(2, "马被击中"), shot(1, "娘咳喘", "娘：慢点")], 8);
    expect(result).toContain("0.0–4.0秒：娘咳喘；有人声对白");
    expect(result).toContain("4.0–8.0秒：马被击中");
    expect(result).toContain("纯器乐");
  });
  it("无镜头时不制造剧情", () => {
    expect(manhuaBgmArcFromShots([], 15)).toBe("");
  });
});
