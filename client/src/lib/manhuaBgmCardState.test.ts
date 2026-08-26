import { describe, expect, it } from "vitest";
import {
  canSubmitManhuaBgm,
  readManhuaBgmVariants,
} from "./manhuaBgmCardState";

describe("漫剧配乐卡恢复", () => {
  it("成功任务只接受 GCS 真源并保留电平结构", () => {
    const result = readManhuaBgmVariants({
      variants: [
        {
          index: 0,
          gcsUri: "gs://bucket/a.mp3",
          previewUrl: "https://signed/a",
          bytes: 123,
          structure: {
            strongestAtSec: 3,
            strongestPeakDb: -1,
            valleyAtSec: 1,
            valleyMeanDb: -20,
            decayStartSec: 8,
            totalSec: 10,
          },
        },
        { index: 1, gcsUri: "https://temporary/b.mp3" },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.structure?.strongestAtSec).toBe(3);
  });

  it("未起草、已有任务、时长越界均拒绝提交", () => {
    expect(canSubmitManhuaBgm({ hasDraft: false, pending: null, durationSec: 20 }).ok).toBe(false);
    expect(
      canSubmitManhuaBgm({
        hasDraft: true,
        pending: {
          jobId: "x",
          billingRequestId: "y",
          titleZh: "",
          durationSec: 20,
          createdAtMs: 1,
        },
        durationSec: 20,
      }).ok,
    ).toBe(false);
    expect(canSubmitManhuaBgm({ hasDraft: true, pending: null, durationSec: 361 }).ok).toBe(false);
    expect(canSubmitManhuaBgm({ hasDraft: true, pending: null, durationSec: 20 })).toEqual({ ok: true });
  });
});
