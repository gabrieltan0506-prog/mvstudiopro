/**
 * Wan 3.0 方言层 —— 当前 **reserved**。
 *
 * 这个文件原本锁的是「wan 转 ready 之后方言层要正确」。0824 复审把 wan 退回
 * reserved（协议层与方言层都在，但 `server/services/bailianWanVideo.ts` 不存在，
 * `buildWanBailianRequest` 全仓零生产调用者，生产链实际走 WaveSpeed），
 * 于是这里改锁两件事：
 *
 * 1. **公开入口一律拒绝** —— reserved 的引擎不许从任何一个口子漏进去产伪结果；
 * 2. **拒绝时说的是真原因** —— 不是「方言尚未接线」（那是假话，会把人引去改方言层）。
 *
 * 方言层本身的行为断言（剥四标记、编号化）在 reserved 期间**故意不测**：
 * 它当前不可达，且其中 `Image N` 的口径与官方中文「图1」相反（见文件末），
 * 接适配器时要连同口径一起返工，现在锁住等于把错误固化。
 */
import { describe, expect, it } from "vitest";
import { formatPromptForEngine, normalizeWanReferenceMarkers } from "./promptFormatLayer";
import { COMPILER_ENGINE_LIMITS, isReadyCompilerEngineId } from "./manhuaShotIR";

describe("wan-3.0 当前不可选用", () => {
  it("profile 是 reserved —— 没有百炼生产适配器之前不许标 ready", () => {
    expect(COMPILER_ENGINE_LIMITS["wan-3.0"].status).toBe("reserved");
    expect(isReadyCompilerEngineId("wan-3.0")).toBe(false);
  });

  it("官方口径不因 reserved 丢失：单段最长仍是 30 秒", () => {
    // reserved 只关掉出口，参数表照记——接适配器时直接用，不必回官网重查
    expect(COMPILER_ENGINE_LIMITS["wan-3.0"].maxSegmentSec).toBe(30);
    expect(COMPILER_ENGINE_LIMITS["wan-3.0"].minSegmentSec).toBe(2);
  });
});

describe("公开入口一律拒绝 reserved 引擎", () => {
  it("格式层拒绝，且报的是真原因（不是「方言尚未接线」）", () => {
    expect(() => formatPromptForEngine("镜头推进", "wan-3.0", { durationSec: 20 })).toThrow(
      /bailianWanVideo|生产适配器/,
    );
  });

  it("空提示词也走同一道拒绝，不因为内容为空就绕过引擎门禁", () => {
    // 顺序很重要：门禁在 prompt_empty 之前。反过来的话，
    // 空串会拿到一个「看起来正常」的 issues 结果，掩盖引擎不可用这件事。
    expect(() => formatPromptForEngine("  ", "wan-3.0")).toThrow(/生产适配器/);
  });

  it("超时长同样先被门禁拦下，不会先给出 30s 夹取的假结果", () => {
    expect(() => formatPromptForEngine("镜头推进", "wan-3.0", { durationSec: 45 })).toThrow();
  });
});

describe("引用编号化（纯函数，不过引擎门禁）", () => {
  /**
   * ⚠️ 这两条锁的是**现状**，不是终局口径。
   * 百炼官方要求提示词里用中文「图1／视频1／音频1」指代，
   * 而这里输出的是 `Image 1`；`shared/wanBailianNative.ts` 另有一套中文转换，
   * 两套函数互相矛盾。接生产适配器时要一并收口（见 0824 复审第三条）。
   */
  it("图/视频/音频都转成编号引用 —— 编号即数组顺序", () => {
    expect(normalizeWanReferenceMarkers("@图1 与 @视频2 配 @音频3")).toBe(
      "Image 1 与 Video 2 配 Audio 3",
    );
  });

  it("「图片/影片/声音」等别名同样认", () => {
    expect(normalizeWanReferenceMarkers("@图片1 @影片1 @声音1")).toBe("Image 1 Video 1 Audio 1");
  });
});
