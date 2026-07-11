import { describe, expect, it } from "vitest";
import {
  filterGraphicNoteReaderFacingSteps,
  focusGraphicNoteReaderScript,
  isGraphicNoteMetaCreatorGuidance,
} from "../../shared/graphicNoteReaderFacing";

describe("graphicNoteReaderFacing", () => {
  it("识别创作者技术指导句", () => {
    expect(isGraphicNoteMetaCreatorGuidance("今晚拍小红书封面素材")).toBe(true);
    expect(isGraphicNoteMetaCreatorGuidance("拆成八页图文笔记")).toBe(true);
    expect(isGraphicNoteMetaCreatorGuidance("同步录60秒视频版")).toBe(true);
    expect(isGraphicNoteMetaCreatorGuidance("别再对爸妈说你该运动了")).toBe(false);
  });

  it("过滤 actionableSteps 里的创作 SOP", () => {
    const steps = filterGraphicNoteReaderFacingSteps([
      "改口成：陪我走十分钟",
      "今晚拍封面素材并拆八页",
      "晚饭后选平路微风路线",
    ]);
    expect(steps).toEqual(["改口成：陪我走十分钟", "晚饭后选平路微风路线"]);
  });

  it("detailedScript 只留读者页，去掉拍封面/拆页/录视频页", () => {
    const script = focusGraphicNoteReaderScript(`
[封面] 别再对爸妈说你该运动了
[图2] 你可能是这三类人
[图3] 这些误区让你越走越累
[图10] 今晚拍小红书封面素材
[图11] 拆成八页图文笔记
[图12] 同步录60秒视频版
`);
    expect(script).toContain("别再对爸妈说");
    expect(script).toContain("这三类人");
    expect(script).not.toMatch(/今晚拍|拆成八页|同步录/);
  });
});
