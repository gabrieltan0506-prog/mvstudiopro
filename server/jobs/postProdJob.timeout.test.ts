import { describe, expect, it } from "vitest";
import { MANHUA_AUTO_RIG_BIND_DEFAULT_TIMEOUT_MS, POST_PROD_DEFAULT_TIMEOUT_MS, resolvePostProdJobTimeoutMs } from "./postProdJob";

describe("0917 后期任务墙钟按任务类型分辨", () => {
  const bind = { action: "manhua_auto_rig", params: { stage: "bind" } };
  const inspect = { action: "manhua_auto_rig", params: { stage: "inspect" } };
  it("绑骨绑定阶段默认 30 分钟；检查阶段与其他后期仍 10 分钟", () => {
    expect(resolvePostProdJobTimeoutMs(bind, {})).toBe(MANHUA_AUTO_RIG_BIND_DEFAULT_TIMEOUT_MS);
    expect(resolvePostProdJobTimeoutMs(inspect, {})).toBe(POST_PROD_DEFAULT_TIMEOUT_MS);
    expect(resolvePostProdJobTimeoutMs({ action: "audio_trim", params: {} }, {})).toBe(POST_PROD_DEFAULT_TIMEOUT_MS);
    expect(resolvePostProdJobTimeoutMs(null, {})).toBe(POST_PROD_DEFAULT_TIMEOUT_MS);
  });
  it("env 只能上调：低于 10 分钟或非法值不生效", () => {
    expect(resolvePostProdJobTimeoutMs(bind, { MANHUA_AUTO_RIG_BIND_TIMEOUT_MS: "3600000" })).toBe(3_600_000);
    expect(resolvePostProdJobTimeoutMs(bind, { MANHUA_AUTO_RIG_BIND_TIMEOUT_MS: "1000" })).toBe(POST_PROD_DEFAULT_TIMEOUT_MS);
    expect(resolvePostProdJobTimeoutMs(bind, { MANHUA_AUTO_RIG_BIND_TIMEOUT_MS: "abc" })).toBe(MANHUA_AUTO_RIG_BIND_DEFAULT_TIMEOUT_MS);
  });
});
