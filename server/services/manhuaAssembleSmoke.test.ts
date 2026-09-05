import { describe, expect, it } from "vitest";
import { assertAnonymousAssembleRejected } from "../../scripts/smoke-manhua-assemble-enqueue.mts";

describe("合成匿名安全探针判据（不发网络）", () => {
  it("仅401拒绝且没有任务号才通过", () => {
    expect(() => assertAnonymousAssembleRejected(401, { error: "请先登录" })).not.toThrow();
  });
  it.each([200, 400, 403, 500, 502])("HTTP %s 不冒充门禁通过", status => {
    expect(() => assertAnonymousAssembleRejected(status, { error: "失败" })).toThrow();
  });
  it.each([{ jobId: "paid-job" }, { jobId: "" }, { ok: true }, null, "Unauthorized"])("401响应异常 %j 仍拒绝", body => {
    expect(() => assertAnonymousAssembleRejected(401, body)).toThrow();
  });
});
