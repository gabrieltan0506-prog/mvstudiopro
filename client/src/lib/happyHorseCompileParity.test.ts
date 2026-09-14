/**
 * 0914 复审要求：HappyHorse 暂不做付费质量实测，
 * 先**离线对照新旧编译输出**，确认这轮是「同源修复」而不是悄悄升级格式。
 *
 * 背景：HappyHorse 此前没登记编译规则，runner 自己
 * renderManhuaClipPromptForSeedance 构造 body，与 prepare 产出的不是同一份。
 * 这轮把它登记进 COMPILER_ENGINE_LIMITS（方言 seedance）。
 * 登记之后正文会多经一层 formatPromptForEngine——这组测试就是证明
 * **该层对 HappyHorse 的正常输入不改变内容**，只是额外给出容量/时长校验。
 */
import { describe, expect, it } from "vitest";
import { renderManhuaClipPromptForSeedance } from "@shared/manhuaClipPromptSanitize";
import { tryCompileManhuaVideoPromptForOutbound } from "./canvasRunBlock";

const compile = (prompt: string, over: Partial<{
  durationSec: number;
  imageRefCount: number;
}> = {}) =>
  tryCompileManhuaVideoPromptForOutbound({
    prompt,
    engine: "happyhorse-1.1",
    durationSec: over.durationSec ?? 10,
    imageRefCount: over.imageRefCount ?? 1,
    videoRefCount: 0,
    audioRefCount: 0,
  });

/** 正常范围内的真实样例：新编译输出必须与生产旧行为**逐字节相同** */
const SAMPLES = [
  "0–5s：阿菁推开坊市木门，灯笼光扫过面颊。\n5–10s：黑奇自梁上落地，剑光压低。",
  "@图片1为本段构图与光色基准。\n【第1段·10s】\n【剪辑手法】硬切\n0–10s：雨夜追逐。",
  "【镜头连续性】承接上一段末帧起幅。\n0–15s：长镜推进，人物不换装。",
  "0–3s：近景手部特写。\n3–10s：拉开成中景，雨势变大，灯笼摇晃。",
];

describe("HappyHorse：登记编译规则前后的出站正文对照", () => {
  it.each(SAMPLES.map((s, i) => [i + 1, s] as const))(
    "样例 %i：新编译输出 === 旧渲染器输出（逐字节）",
    (_i, sample) => {
      const legacy = renderManhuaClipPromptForSeedance(sample);
      const compiled = compile(sample, { durationSec: 15 });
      expect(compiled.blocked).toBe(false);
      expect(compiled.text).toBe(legacy);
    },
  );

  it("超出参考图上限：明确阻断，而不是截断后照发", () => {
    const compiled = compile("0–10s：多图参考测试。", { imageRefCount: 5 });
    expect(compiled.blocked).toBe(true);
    expect(compiled.issues.map((x) => x.detailZh).join("；")).toMatch(/参考图上限/);
  });

  it("时长越界：明确报出来（HappyHorse 口径 5–15s）", () => {
    const tooLong = compile("0–40s：超长段。", { durationSec: 40 });
    expect(tooLong.issues.length).toBeGreaterThan(0);
  });

  it("这就是本轮的取舍：同源修复，正常输入零行为变化，越界才多一层拦", () => {
    // 写成断言而不是注释，免得日后有人把「零行为变化」当成想当然。
    for (const sample of SAMPLES) {
      expect(compile(sample, { durationSec: 15 }).text).toBe(
        renderManhuaClipPromptForSeedance(sample),
      );
    }
  });
});
