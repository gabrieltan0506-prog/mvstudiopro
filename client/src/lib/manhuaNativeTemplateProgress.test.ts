import { describe, expect, it } from "vitest";
import {
  buildApprovedNativeTemplateBadge,
  buildPendingNativeTemplateProgressCopy,
  parseNativeTemplateEpisodeIndex,
  readApprovedNativeTemplateProgress,
} from "./manhuaNativeTemplateProgress";

describe("原生精读分段审批文案", () => {
  it("集号只取稳定模板 id，不拿失败次数或累计次数冒充", () => {
    expect(parseNativeTemplateEpisodeIndex("tpl_native_series_ep001")).toBe(1);
    expect(parseNativeTemplateEpisodeIndex("tpl_native_series_ep010")).toBe(10);
    expect(parseNativeTemplateEpisodeIndex("tpl_native_series_attempt5")).toBeUndefined();
  });

  it("首段成功后显示第一集、剩余断点与当前批准动作", () => {
    expect(buildPendingNativeTemplateProgressCopy({
      id: "tpl_native_series_ep001",
      progress: {
        successSegments: 1,
        attemptedSegments: 4,
        assemblyComplete: false,
        nextSegmentIndex: 2,
      },
    })).toEqual({
      optionSuffixZh: "第1集 · 1/4段已完成 · 剩3段断点续学",
      detailZh: "第1集已完成1/4段；批准后保留当前成果。之后从第2段继续学习。",
      approveButtonZh: "批准当前1/4入库",
    });
  });

  it("正式库已有 1/4、待审卡为 2/4 时明确显示补全而非首次入库", () => {
    expect(buildPendingNativeTemplateProgressCopy({
      id: "tpl_native_series_ep001",
      approvedSuccessSegments: 1,
      progress: {
        successSegments: 2,
        attemptedSegments: 4,
        assemblyComplete: false,
        nextSegmentIndex: 3,
      },
    })).toEqual({
      optionSuffixZh: "第1集 · 2/4段已完成 · 待批准补全至2/4 · 剩2段断点续学",
      detailZh: "第1集已入库1/4段；本次已补全至2/4段，批准后更新正式模板。之后从第3段继续学习。",
      approveButtonZh: "批准补全至2/4",
    });
  });

  it("正式卡只读分段进度，不受其它私有 provenance 字段影响", () => {
    const progress = readApprovedNativeTemplateProgress({
      id: "tpl_native_series_ep001",
      provenance: {
        nativeVideoDeepRead: {
          attemptedSegments: 4,
          successSegments: 99,
          completedSegmentIndexes: [0, 0],
          assemblyComplete: false,
        },
      },
    });
    expect(progress).toEqual({
      successSegments: 1,
      attemptedSegments: 4,
      assemblyComplete: false,
      nextSegmentIndex: 2,
    });
    expect(buildApprovedNativeTemplateBadge(progress)).toBe("1/4段已入库");
  });

  it("断点序号取首个真实缺段，不用成功数量推算", () => {
    expect(readApprovedNativeTemplateProgress({
      id: "tpl_native_series_ep001",
      provenance: {
        nativeVideoDeepRead: {
          attemptedSegments: 4,
          successSegments: 1,
          completedSegmentIndexes: [1],
          assemblyComplete: false,
        },
      },
    })?.nextSegmentIndex).toBe(1);
  });
});
