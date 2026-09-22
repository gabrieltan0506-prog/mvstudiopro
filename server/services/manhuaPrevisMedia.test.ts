import { describe, expect, it } from "vitest";
import { resolveManhuaPrevisMedia } from "./manhuaPrevisMedia";

const job = {
  id: `prv_${"a".repeat(48)}`,
  userId: "7",
  type: "post_prod",
  provider: "blender-previs",
  status: "succeeded",
  input: { action: "manhua_previs", params: {} },
  output: {
    gcsUri: "gs://bucket/post-prod/7/previs/request/preview.mp4",
    layerBundle: {
      gcsUri: "gs://bucket/post-prod/7/previs/request/layer-bundle.zip",
      format: "previs-layers-v1",
    },
  },
};

describe("白模 Fly 媒体代理授权", () => {
  it("只解析本人已成功任务的固定预览与分层对象", () => {
    expect(resolveManhuaPrevisMedia(job, 7, "preview")).toMatchObject({
      gcsUri: job.output.gcsUri,
      contentType: "video/mp4",
    });
    expect(resolveManhuaPrevisMedia(job, 7, "layers")).toMatchObject({
      gcsUri: job.output.layerBundle.gcsUri,
      contentType: "application/zip",
    });
    expect(resolveManhuaPrevisMedia(job, 8, "preview")).toBeNull();
    expect(resolveManhuaPrevisMedia({ ...job, status: "running" }, 7, "preview")).toBeNull();
  });

  it("拒绝客户端借任务回执代理其他桶路径", () => {
    expect(resolveManhuaPrevisMedia({
      ...job,
      output: { ...job.output, gcsUri: "gs://bucket/private/secret.mp4" },
    }, 7, "preview")).toBeNull();
  });
});
