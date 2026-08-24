/**
 * Wan 3.0 方言。
 *
 * 上线不等于能用：profile 早就写着 dialect:"wan"，但 promptFormatLayer 里
 * **一个 wan 分支都没有**，只把 status 翻成 ready 会让提示词掉进
 * 「方言尚未接线」的 throw，或更糟——按别的方言处理。
 * 知识库已有前车之鉴：`{}` `<>` 是 Seedance 方言，写进 Minimax H3 会被当正文念出来。
 */
import { describe, expect, it } from "vitest";
import { formatPromptForEngine, normalizeWanReferenceMarkers } from "./promptFormatLayer";
import { COMPILER_ENGINE_LIMITS } from "./manhuaShotIR";

describe("wan-3.0 已可选用", () => {
  it("profile 转 ready —— 之前是 reserved，编译器直接拒", () => {
    expect(COMPILER_ENGINE_LIMITS["wan-3.0"].status).toBe("ready");
  });

  it("单段最长 30 秒，与官方一致", () => {
    expect(COMPILER_ENGINE_LIMITS["wan-3.0"].maxSegmentSec).toBe(30);
  });
});

describe("引用编号化", () => {
  it("图/视频/音频都转成编号引用 —— 编号即数组顺序", () => {
    expect(normalizeWanReferenceMarkers("@图1 与 @视频2 配 @音频3")).toBe(
      "Image 1 与 Video 2 配 Audio 3",
    );
  });

  it("「图片/影片/声音」等别名同样认", () => {
    expect(normalizeWanReferenceMarkers("@图片1 @影片1 @声音1")).toBe("Image 1 Video 1 Audio 1");
  });
});

describe("剥 Seedance 四标记", () => {
  const fmt = (t: string) => formatPromptForEngine(t, "wan-3.0", { durationSec: 20 }).text;

  it("对白 {} 转引号，不留原标记", () => {
    const out = fmt("他说 {我来了}");
    expect(out).toContain("“我来了”");
    expect(out).not.toContain("{");
  });

  it("音效 <> 转正文 —— 留着会被当字面念出来", () => {
    const out = fmt("画面 <雨声渐起> 收束");
    expect(out).toContain("雨声渐起");
    expect(out).not.toContain("<");
  });

  it("字幕【】也剥掉", () => {
    expect(fmt("【第一幕】开场")).not.toContain("【");
  });

  it("超过 30 秒会给出时长问题并夹取", () => {
    const r = formatPromptForEngine("镜头推进", "wan-3.0", { durationSec: 45 });
    expect(r.clampedDurationSec).toBe(30);
    expect(r.issues.some((i) => i.kind === "duration_max")).toBe(true);
  });

  it("空提示词照样报 prompt_empty，不因新方言绕过既有校验", () => {
    expect(formatPromptForEngine("  ", "wan-3.0").issues[0]!.kind).toBe("prompt_empty");
  });
});
