import { describe, expect, it } from "vitest";
import {
  areManhuaKeyartsPixelLocked,
  buildManhuaAssetLockRegistry,
  isManhuaKeyartPixelLocked,
} from "./manhuaAssetLockRegistry";

describe("manhuaAssetLockRegistry", () => {
  it("numbers upload character/scene/prop as @角色/@场景/@道具", () => {
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "c1",
          url: "https://cdn.example/char.jpg",
          role: "character",
          source: "upload",
          labelZh: "女主",
        },
        {
          id: "s1",
          url: "https://cdn.example/scene.jpg",
          role: "scene",
          source: "upload",
          labelZh: "大殿",
        },
        {
          id: "p1",
          url: "https://cdn.example/prop.jpg",
          role: "prop",
          source: "upload",
          labelZh: "玉佩",
        },
      ],
    });
    expect(reg.byRole.character[0]?.tag).toBe("@角色1");
    expect(reg.byRole.scene[0]?.tag).toBe("@场景1");
    expect(reg.byRole.prop[0]?.tag).toBe("@道具1");
    expect(reg.promptBlockZh).toContain("【资产锁·编号对照·必守】");
    expect(reg.promptBlockZh).toContain("@角色1=女主");
  });

  it("skips generated character refs for lock table", () => {
    const reg = buildManhuaAssetLockRegistry({
      customRefs: [
        {
          id: "g1",
          url: "https://cdn.example/gen.jpg",
          role: "character",
          source: "generated",
          labelZh: "生成脸",
        },
      ],
    });
    expect(reg.byRole.character).toHaveLength(0);
  });

  it("requires edit+ref for pixel lock", () => {
    expect(
      isManhuaKeyartPixelLocked({
        id: "keyart-1",
        imageMode: "generate",
        outputUrl: "https://cdn.example/out.png",
      }),
    ).toBe(false);
    expect(
      isManhuaKeyartPixelLocked({
        id: "keyart-1",
        imageMode: "edit",
        refImageUrl: "https://cdn.example/pad.png",
        outputUrl: "https://cdn.example/out.png",
      }),
    ).toBe(true);
    expect(
      areManhuaKeyartsPixelLocked(
        [
          {
            id: "keyart-a",
            imageMode: "edit",
            refImageUrl: "https://cdn.example/pad.png",
            outputUrl: "https://cdn.example/a.png",
          },
        ],
        { minCount: 1 },
      ),
    ).toBe(true);
  });
});
