import { describe, expect, it } from "vitest";
import { extractGraphicNoteBeatsFor3x4 } from "./proxyImageService";

describe("extractGraphicNoteBeatsFor3x4", () => {
  it("优先抽取 [封面]/[图N] 攻略页，跳过灯光运镜口播时间轴", () => {
    const script = `
【选题】京都避坑指南
【分镜步骤】
1. [0-4秒] 画面：主讲人出镜 | 灯光：侧光 | 口播：今天讲运镜
2. [4-8秒] 运镜推进机位特写 | 灯光：伦勃朗
【图文大纲·优先拆格】
[封面] 京都三日别踩这5个坑
[图2] 交通卡怎么买最划算
[图3] 寺庙拍照别挡道
[图4] 午餐避开观光团高峰
[图5] 行李寄送比拖着走更香
[图6] 夜景点位人少但安全
[图7] 雨天备用室内清单
[图8] 收藏这份再出发
`;
    const beats = extractGraphicNoteBeatsFor3x4(script, 8);
    expect(beats[0]).toContain("京都三日");
    expect(beats[1]).toContain("交通卡");
    expect(beats.some((b) => /灯光|运镜|口播/.test(b))).toBe(false);
  });

  it("跳过创作者技术指导页，填充用读者向节拍", () => {
    const script = `
【选题】饭后散步劝父母
[封面] 别再对爸妈说你该运动了
[图2] 你可能是这三类人
[图3] 这些误区让你越走越累
[图10] 今晚拍小红书封面素材
[图11] 拆成八页图文笔记
[图12] 同步录60秒视频版
`;
    const beats = extractGraphicNoteBeatsFor3x4(script, 12);
    expect(beats.some((b) => /今晚拍|拆成八页|同步录|可拍画面/.test(b))).toBe(false);
    expect(beats[0]).toContain("别再对爸妈");
    expect(beats.some((b) => /这三类人|误区|评论|收藏/.test(b))).toBe(true);
  });
});
