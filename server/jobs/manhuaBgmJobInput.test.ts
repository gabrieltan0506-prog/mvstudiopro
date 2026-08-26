import { describe, expect, it } from "vitest";
import {
  MANHUA_BGM_ACTION,
  buildManhuaBgmJobInput,
  digestManhuaBgmBrief,
  isSameManhuaBgmSubmission,
  manhuaBgmJobInputSchema,
  manhuaBgmJobParamsSchema,
} from "./manhuaBgmJobInput";

const brief = {
  model: "suno-v5.5-beta" as const,
  custom_mode: true as const,
  instrumental: true as const,
  style: "压抑积压，转为余韵沉落，低音弦乐持续音铺底，21秒，44.1KHz",
  prompt: "[Intro]\n[Build]\n[Peak]\n[Outro]\n[End]",
  title: "悬疑权谋·配乐",
  duration: 21,
  negative_tags: "vocals, singing",
  style_weight: 0.78,
  weirdness_constraint: 0.25,
};
const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("漫剧配乐任务 Schema", () => {
  it("合法输入补出 64 位内容摘要并固定 V5.5", () => {
    const parsed = buildManhuaBgmJobInput({ billingRequestId: uuid, brief });
    expect(parsed.action).toBe(MANHUA_BGM_ACTION);
    expect(parsed.params.brief.model).toBe("suno-v5.5-beta");
    expect(parsed.params.briefDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("相同内容不受对象键顺序影响", () => {
    const reordered = Object.fromEntries(Object.entries(brief).reverse());
    expect(digestManhuaBgmBrief(reordered)).toBe(digestManhuaBgmBrief(brief));
  });

  it("同请求号只有内容摘要一致才允许幂等复用", () => {
    const first = buildManhuaBgmJobInput({ billingRequestId: uuid, brief });
    const same = buildManhuaBgmJobInput({
      billingRequestId: uuid,
      brief: Object.fromEntries(Object.entries(brief).reverse()),
    });
    const changed = buildManhuaBgmJobInput({
      billingRequestId: uuid,
      brief: { ...brief, duration: 22 },
    });
    expect(isSameManhuaBgmSubmission(first, same)).toBe(true);
    expect(isSameManhuaBgmSubmission(first, changed)).toBe(false);
  });

  it("旧任务没有摘要时可恢复解析，但显式伪造摘要会拒绝", () => {
    const legacy = manhuaBgmJobInputSchema.parse({
      action: MANHUA_BGM_ACTION,
      params: { billingRequestId: uuid, brief },
    });
    expect(legacy.params.briefDigest).toBe(digestManhuaBgmBrief(brief));
    expect(() =>
      manhuaBgmJobParamsSchema.parse({
        billingRequestId: uuid,
        brief,
        briefDigest: "0".repeat(64),
      })
    ).toThrow("摘要");
  });

  it("请求号、V5.5/custom mode、duration 与结构 prompt 都是硬门禁", () => {
    expect(() =>
      manhuaBgmJobParamsSchema.parse({ billingRequestId: "bad", brief })
    ).toThrow();
    expect(() =>
      manhuaBgmJobParamsSchema.parse({
        billingRequestId: uuid,
        brief: { ...brief, model: "suno-v5-beta" },
      })
    ).toThrow();
    expect(() =>
      manhuaBgmJobParamsSchema.parse({
        billingRequestId: uuid,
        brief: { ...brief, custom_mode: false },
      })
    ).toThrow();
    for (const duration of [9, 361, 20.5]) {
      expect(() =>
        manhuaBgmJobParamsSchema.parse({
          billingRequestId: uuid,
          brief: { ...brief, duration },
        })
      ).toThrow();
    }
    expect(() =>
      manhuaBgmJobParamsSchema.parse({
        billingRequestId: uuid,
        brief: { ...brief, prompt: "" },
      })
    ).toThrow();
    for (const patch of [
      { style_weight: 0.781 },
      { weirdness_constraint: 0.251 },
    ]) {
      expect(() =>
        manhuaBgmJobParamsSchema.parse({
          billingRequestId: uuid,
          brief: { ...brief, ...patch },
        })
      ).toThrow("0.01");
    }
  });

  it("strict：队列多塞字段与错误 action 都拒收", () => {
    expect(() =>
      manhuaBgmJobInputSchema.parse({
        action: MANHUA_BGM_ACTION,
        params: { billingRequestId: uuid, brief },
        extra: true,
      })
    ).toThrow();
    expect(() =>
      manhuaBgmJobInputSchema.parse({
        action: "suno_music",
        params: { billingRequestId: uuid, brief },
      })
    ).toThrow();
  });
});
