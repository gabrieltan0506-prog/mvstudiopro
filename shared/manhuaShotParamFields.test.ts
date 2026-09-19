import { describe, expect, it } from "vitest";
import { buildManhuaShotParamFields } from "./manhuaShotParamFields";

describe("当前镜参数四字段", () => {
  it("从线上真实机位句里切出景别与机位运动", () => {
    const a = buildManhuaShotParamFields({ durationSec: 5, cameraZh: "全景，平视，缓慢推近", actionZh: "墨屠护住阿菁" });
    expect(a.durationZh).toBe("5 秒");
    expect(a.shotSizeZh).toBe("全景");
    expect(a.cameraMoveZh).toBe("缓慢推近");
    expect(a.cameraUnparsed).toBe(false);
    const b = buildManhuaShotParamFields({ durationSec: 4, cameraZh: "中景，固定机位，三分构图" });
    expect(b.shotSizeZh).toBe("中景");
    expect(b.cameraMoveZh).toBe("固定机位");
  });

  it("长词优先：中近景不许被切成近景，大特写不许被切成特写", () => {
    expect(buildManhuaShotParamFields({ cameraZh: "中近景，轻微横移" }).shotSizeZh).toBe("中近景");
    expect(buildManhuaShotParamFields({ cameraZh: "大特写，微推" }).shotSizeZh).toBe("大特写");
  });

  it("切不出来就写「未标注」并保留原文，不猜一个好看的值", () => {
    const out = buildManhuaShotParamFields({ durationSec: 3, cameraZh: "跟着感觉走" });
    expect(out.shotSizeZh).toBe("未标注");
    expect(out.cameraMoveZh).toBe("未标注");
    expect(out.cameraUnparsed).toBe(true);
    expect(out.rawCameraZh).toBe("跟着感觉走");
  });

  it("画面描述按字数计并标超限；没有描述时长度为 0 不报超限", () => {
    const long = buildManhuaShotParamFields({ actionZh: "字".repeat(201) });
    expect(long.descriptionLen).toBe(201);
    expect(long.overLimit).toBe(true);
    const none = buildManhuaShotParamFields({});
    expect(none.descriptionLen).toBe(0);
    expect(none.overLimit).toBe(false);
    expect(none.durationZh).toBe("未标注");
  });

  it("时长为 0 或缺失都是「未标注」，不显示成 0 秒", () => {
    expect(buildManhuaShotParamFields({ durationSec: 0 }).durationZh).toBe("未标注");
    expect(buildManhuaShotParamFields(null).durationZh).toBe("未标注");
    expect(buildManhuaShotParamFields({ durationSec: 4.5 }).durationZh).toBe("4.5 秒");
  });
});

it("较长景别优先，不把大远景切成远景", () => {
 expect(buildManhuaShotParamFields({ cameraZh: "大远景，固定机位" }).shotSizeZh).toBe("大远景");
});
