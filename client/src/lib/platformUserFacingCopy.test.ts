import { describe, expect, it } from "vitest";
import { sanitizePlatformUserMessage } from "./platformUserFacingCopy";
import { platformNotificationArgs } from "./platformToast";

describe("平台页仅展示业务提示", () => {
  it.each([
    "DeepSeek V4.1 Flash: upstream timeout", "GLM 5.3 FlashX 请求失败", "GUAIKEI API 采集失败",
    "OpenRouter 余额不足", "returned HTML instead of JSON", "Unexpected token < in JSON",
    "Gemini model deployment missing", "请检查服务端抖音登录凭证", "EvoLink quota exceeded",
  ])("不回显内部原因：%s", raw => {
    const result = sanitizePlatformUserMessage(raw);
    expect(result).not.toMatch(/DeepSeek|GLM|GUAIKEI|API|OpenRouter|EvoLink|Gemini|Debug|网关|凭证|服务端/);
    expect(result.length).toBeGreaterThan(5);
  });
  it("保留积分、确认和原稿恢复信息", () => {
    expect(sanitizePlatformUserMessage("积分不足")).toContain("积分不足");
    expect(sanitizePlatformUserMessage("本次需要80积分，确认继续？")).toBe("本次需要80积分，确认继续？");
    expect(sanitizePlatformUserMessage("云端稿件已变化，未覆盖原稿")).toContain("未覆盖原稿");
  });
  it("通知标题和描述都过滤，但不改变动作和原始异常", () => {
    const options={description:"GLM: API failed",duration:12000,action:{label:"查看任务",onClick:()=>{}}};
    const result=platformNotificationArgs(["生成失败",options]);
    expect(result[0]).toBe("生成失败");expect(result[1]).toMatchObject({duration:12000,action:options.action});
    expect((result[1] as any).description).not.toMatch(/GLM|API/);
    expect(options.description).toBe("GLM: API failed");
  });
});
