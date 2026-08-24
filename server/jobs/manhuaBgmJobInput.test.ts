/**
 * 配乐任务的 Schema 与幂等口径。不发任何网络请求。
 *
 * 这一层此前不存在：Suno 是付费异步任务，却跑在一次 tRPC 请求里同步轮询 6 分钟，
 * 请求中断或实例重启就丢 task id，用户重按会再建一单付两次钱。
 */
import { describe, expect, it } from "vitest";
import {
  MANHUA_BGM_ACTION,
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

describe("配乐任务 Schema", () => {
  it("合法入参通过", () => {
    expect(
      manhuaBgmJobInputSchema.parse({
        action: MANHUA_BGM_ACTION,
        params: { billingRequestId: uuid, brief },
      }).params.brief.duration,
    ).toBe(21);
  });

  it("提交幂等号必须是 UUID —— 它是防重复付费的那把钥匙", () => {
    expect(() =>
      manhuaBgmJobParamsSchema.parse({ billingRequestId: "not-a-uuid", brief }),
    ).toThrow();
    expect(() => manhuaBgmJobParamsSchema.parse({ brief })).toThrow();
  });

  it("只收 v5.5 + custom_mode —— 别的组合 duration 不生效", () => {
    expect(() =>
      manhuaBgmJobParamsSchema.parse({
        billingRequestId: uuid,
        brief: { ...brief, model: "suno-v5-beta" },
      }),
    ).toThrow();
    expect(() =>
      manhuaBgmJobParamsSchema.parse({
        billingRequestId: uuid,
        brief: { ...brief, custom_mode: false },
      }),
    ).toThrow();
  });

  it("duration 越界拒绝（10–360 整数）", () => {
    for (const d of [9, 361, 20.5]) {
      expect(() =>
        manhuaBgmJobParamsSchema.parse({ billingRequestId: uuid, brief: { ...brief, duration: d } }),
      ).toThrow();
    }
  });

  it("prompt 必填 —— 结构标签是治「长档偏短」的正解，不许空", () => {
    expect(() =>
      manhuaBgmJobParamsSchema.parse({ billingRequestId: uuid, brief: { ...brief, prompt: "" } }),
    ).toThrow();
  });

  it("strict：多塞字段直接拒，队列里的数据不可信", () => {
    expect(() =>
      manhuaBgmJobInputSchema.parse({
        action: MANHUA_BGM_ACTION,
        params: { billingRequestId: uuid, brief },
        extraField: 1,
      }),
    ).toThrow();
  });

  it("action 写错拒收", () => {
    expect(() =>
      manhuaBgmJobInputSchema.parse({
        action: "suno_music",
        params: { billingRequestId: uuid, brief },
      }),
    ).toThrow();
  });
});
