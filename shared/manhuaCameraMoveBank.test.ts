import { describe, expect, it } from "vitest";
import {
  MANHUA_CAMERA_MOVE_BANK,
  MANHUA_CAMERA_MOVE_ORDER,
  buildManhuaCameraMoveInjectBlock,
  matchManhuaCameraMoveByNameZh,
  recommendManhuaCameraMoveFromText,
} from "./manhuaCameraMoveBank";

describe("manhuaCameraMoveBank", () => {
  it("has 28 camera moves in fixed order", () => {
    expect(MANHUA_CAMERA_MOVE_ORDER).toHaveLength(28);
    expect(MANHUA_CAMERA_MOVE_BANK).toHaveLength(28);
    expect(MANHUA_CAMERA_MOVE_BANK.map((e) => e.id)).toEqual([...MANHUA_CAMERA_MOVE_ORDER]);
  });

  it("recommends OTS for dialogue and detail for props", () => {
    expect(recommendManhuaCameraMoveFromText("过肩对白审讯谈判").id).toBe("cam_09_ots");
    expect(recommendManhuaCameraMoveFromText("合同红章特写证据").nameZh).toMatch(/细节|特写/);
  });

  it("builds inject without leaking external site names", () => {
    const block = buildManhuaCameraMoveInjectBlock(["cam_09_ots", "cam_13_closeup"]);
    expect(block).toContain("【运镜词库】");
    expect(block).toContain("过肩");
    expect(block).not.toMatch(/东山|公众号|RunningHub|rhTV/i);
  });

  it("天然两段的运镜带两拍时序句，单动势条目不带", () => {
    const withSeq = MANHUA_CAMERA_MOVE_BANK.filter((e) => e.sequenceZh).map((e) => e.id);
    expect(withSeq.sort()).toEqual([
      "cam_03_crane",
      "cam_05_whip_pan",
      "cam_16_cut_in",
      "cam_17_slowmo",
      "cam_18_push_pull",
      "cam_20_pan_reveal",
      "cam_24_establishing",
      "cam_28_ending_hold",
    ]);
    for (const e of MANHUA_CAMERA_MOVE_BANK) {
      if (e.sequenceZh) {
        expect(e.sequenceZh).toHaveLength(2);
        expect(e.sequenceZh[0]).not.toMatch(/模型|Seedance/i);
      }
    }
  });

  it("按条目名认回库内条目；自由运镜文本不误认", () => {
    expect(matchManhuaCameraMoveByNameZh("中景推拉结合")?.id).toBe("cam_18_push_pull");
    expect(matchManhuaCameraMoveByNameZh("贴桥板低机位，全景缓推至中近景")).toBeNull();
    expect(matchManhuaCameraMoveByNameZh("")).toBeNull();
  });
});
