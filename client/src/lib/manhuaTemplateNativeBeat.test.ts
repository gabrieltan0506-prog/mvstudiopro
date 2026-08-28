import { describe, expect, it } from "vitest";
import { formatManhuaTemplateNativeBeatZh } from "./manhuaTemplateNativeBeat";

const base = { atSec: 0, conflictZh: "c", visualZh: "v" };

describe("formatManhuaTemplateNativeBeatZh", () => {
  it("独立站位与表演证据齐全时按固定顺序拼", () => {
    expect(
      formatManhuaTemplateNativeBeatZh({
        ...base,
        endSec: 3,
        unitTypeZh: "剪辑镜头",
        shotSizeZh: "特写",
        angleZh: "平视",
        compositionZh: "双人前后分层",
        cameraMoveZh: "固定机位",
        blockingZh: "主角靠左，对手靠右",
        bodyActionZh: "主角重心后移",
        limbPropActionZh: "右手握剑",
        microExpressionZh: "下颌绷紧",
        gazeBreathZh: "视线锁定，呼吸短促",
        relationshipReactionZh: "对手逼近后主角退半步",
        lightingZh: "冷光",
        transitionInZh: "硬切",
      }),
    ).toBe(
      "结束 3s · 单元 剪辑镜头 · 景别 特写 · 机位 平视 · 构图 双人前后分层 · 运镜 固定机位 · "
      + "站位调度 主角靠左，对手靠右 · 整体动作 主角重心后移 · 四肢/道具 右手握剑 · "
      + "微表情 下颌绷紧 · 视线/呼吸 视线锁定，呼吸短促 · 关系反应 对手逼近后主角退半步 · 光影 冷光 · 转场 硬切",
    );
  });

  it("部分为空时不留多余分隔符，也不出现 undefined", () => {
    const out = formatManhuaTemplateNativeBeatZh({
      ...base,
      shotSizeZh: "全景",
      transitionInZh: "闪白",
    });
    expect(out).toBe("景别 全景 · 转场 闪白");
    expect(out).not.toContain("undefined");
    expect(out).not.toContain(" ·  · ");
  });

  it("endSec=0 要显示（0 是合法秒位，不能被 falsy 吞掉）", () => {
    expect(formatManhuaTemplateNativeBeatZh({ ...base, endSec: 0 })).toBe("结束 0s");
  });

  it("抽帧旧卡（无任何原生证据栏）返回空串", () => {
    expect(formatManhuaTemplateNativeBeatZh(base)).toBe("");
  });
});
