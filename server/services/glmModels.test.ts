/**
 * 0920 回归：常量整体换 Flash 后，**旧 id 必须继续被认成 GLM 5.3**。
 *
 * 不认的后果不是报错，是静默掉锁：`isGlm53Model` 返 false → 请求不套 Z.AI 自营 provider 锁
 * → 0829 账单实证的那个形态（抽到 Fireworks 之类中转商，多烧数倍思考 token）。
 * 判据全部写死字面量，不读被测常量自证。
 */
import { describe, expect, it } from "vitest";
import { glm53ReasoningEffort, isGlm53Model } from "./glmModels";

describe("isGlm53Model（0920 换 Flash 后的识别面）", () => {
  it("现行 Flash 两种写法都认", () => {
    expect(isGlm53Model("z-ai/glm-5.3-flash")).toBe(true);
    expect(isGlm53Model("glm-5.3-flash")).toBe(true);
  });
  it("停用的旧 id 仍然认得（掉了就静默丢 provider 锁）", () => {
    expect(isGlm53Model("z-ai/glm-5.3")).toBe(true);
    expect(isGlm53Model("glm-5.3")).toBe(true);
  });
  it("大小写与前后空白归一", () => {
    expect(isGlm53Model("  Z-AI/GLM-5.3-Flash  ")).toBe(true);
  });
  it("坏例必须为假：别家模型、空值、以及只是前缀相同的", () => {
    for (const bad of ["", null, undefined, "z-ai/glm-5.3-flashx", "glm-5.2", "deepseek/deepseek-v4", "z-ai/glm"]) {
      expect(isGlm53Model(bad as string | null | undefined)).toBe(false);
    }
  });
});

describe("glm53ReasoningEffort（官方只认 low/high/max）", () => {
  it("low 与 max 原样保留", () => {
    expect(glm53ReasoningEffort("low")).toBe("low");
    expect(glm53ReasoningEffort("max")).toBe("max");
  });
  it("medium / xhigh / minimal / 空值一律发 high，不发会被静默降级的值", () => {
    for (const v of ["medium", "xhigh", "minimal", "none", "", null, undefined]) {
      expect(glm53ReasoningEffort(v as string | null | undefined)).toBe("high");
    }
  });
});
