import { describe, expect, it } from "vitest";
import {
  judgeNativeDeepReadQuality,
  measureNativeDeepReadQuality,
} from "./manhuaNativeDeepReadQuality";

/**
 * 造一条描述丰富、各不相同的真实镜。
 * ⚠️ 调用方请让镜长**不规律**：等长串本身是模板化信号（见文件末尾那组测试），
 * 用等长 fixture 测别的判据会互相干扰。
 */
const realShot = (startSec: number, endSec: number, seed: number) => ({
  startSec, endSec,
  actionZh: `第${seed}个动作：人物做了具体而不同的事`,
  lightingZh: `第${seed}种光：主光方向与背景层次各异`,
  microExpressionZh: `第${seed}种微表情`,
  visualZh: `第${seed}个画面内容`,
  // 枚举字段刻意只用三种取值——这是真实剧集的常态，不得因此被判塌缩。
  shotSizeZh: ["特写", "中景", "全景"][seed % 3],
  angleZh: ["平视", "俯视", "仰视"][seed % 3],
  cameraMoveZh: ["固定机位", "推近", "摇摄"][seed % 3],
  unitTypeZh: "剪辑镜头",
  transitionInZh: "直接切入",
});

/** 造一条模板镜：描述完全相同 */
const templateShot = (startSec: number, endSec: number, variant: number) => ({
  startSec, endSec,
  actionZh: `少主在魔界${["发号施令", "巡视", "处理事务"][variant]}`,
  lightingZh: "主光从前方打来，背景昏暗",
  microExpressionZh: "表情严肃",
  visualZh: "少主全身",
  shotSizeZh: "中景", angleZh: "平视", cameraMoveZh: "固定机位",
  unitTypeZh: "剪辑镜头", transitionInZh: "直接切入",
});

describe("内容质量验收器", () => {
  it("枚举字段低基数不算塌缩（0831 首跑误报的那条）", () => {
    // 30 镜，景别/角度/运镜各只有 3 种取值、单元类型与转场各只有 1 种。
    // 这是真实剧集的常态；初版把枚举字段放进多样性检查，把一份优质产出误判成 5 字段塌缩。
    // 镜长按 3/4/5/6 秒轮转，避免撞上等长串判据——真实剪辑本来就不规律。
    let cursor = 0;
    const shots = Array.from({ length: 30 }, (_, i) => {
      const len = [3, 4, 5, 6][i % 4]!;
      const shot = realShot(cursor, cursor + len, i);
      cursor += len;
      return shot;
    });
    const verdict = judgeNativeDeepReadQuality({ shots, startSec: 0, endSec: cursor });
    expect(verdict.metrics.lowVarietyFields).toEqual([]);
    expect(verdict.status).toBe("pass");
  });

  it("尾段模板化：前密后疏且重复挤在后段，必须判出来", () => {
    /**
     * 复刻 0831 首跑第 1 片的真实形态：
     * 前 160 秒 48 镜（真实剪辑点），后 159 秒 18 镜，其中 12 镜是
     * 三条描述严格 10 秒等分循环四遍。整体雷同率只有 16.7%，
     * 光看整体雷同率会觉得「还行」，必须靠尾段判据才抓得住。
     */
    const head = Array.from({ length: 48 }, (_, i) => realShot(i * 3.3, i * 3.3 + 3.3, i));
    const tailReal = Array.from({ length: 6 }, (_, i) =>
      realShot(160 + i * 6, 166 + i * 6, 100 + i));
    const tailTemplate = Array.from({ length: 12 }, (_, i) =>
      templateShot(200 + i * 10, 210 + i * 10, i % 3));
    const verdict = judgeNativeDeepReadQuality({
      shots: [...head, ...tailReal, ...tailTemplate], startSec: 0, endSec: 319,
    });
    expect(verdict.metrics.shotCount).toBe(66);
    expect(verdict.metrics.tailDensityRatio).toBeLessThan(0.5);
    // 重复几乎全部落在后半段——这正是「尾段整片糊弄」与「偶发重复」的分野。
    expect(verdict.metrics.duplicateTailShare).toBeGreaterThanOrEqual(0.6);
    expect(verdict.failures.map((f) => f.code)).toContain("quality_tail_density_collapsed");
    expect(verdict.status).toBe("fail");
  });

  it("均匀分布的真实产出不因尾段判据被误伤", () => {
    let cursor = 0;
    const shots = Array.from({ length: 60 }, (_, i) => {
      const len = [4, 5, 6, 5][i % 4]!;
      const shot = realShot(cursor, cursor + len, i);
      cursor += len;
      return shot;
    });
    const verdict = judgeNativeDeepReadQuality({ shots, startSec: 0, endSec: cursor });
    expect(verdict.metrics.tailDensityRatio).toBeGreaterThan(0.9);
    expect(verdict.failures.map((f) => f.code)).not.toContain("quality_tail_density_collapsed");
  });

  it("全段模板填充：0830 那次 12/15 逐字相同，四条判据一起亮", () => {
    const shots = Array.from({ length: 15 }, (_, i) =>
      i < 3 ? realShot(i * 10, i * 10 + 10, i) : templateShot(30 + i * 19, 49 + i * 19, 0));
    const verdict = judgeNativeDeepReadQuality({ shots, startSec: 0, endSec: 319 });
    expect(verdict.status).toBe("fail");
    expect(verdict.metrics.duplicateRatio).toBeGreaterThan(0.5);
    expect(verdict.metrics.uniqueDescriptionSets).toBeLessThan(5);
    expect(verdict.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining(["quality_duplicate_rows", "quality_shot_density_thin"]),
    );
  });

  it("空镜头表直接失败，不继续算别的指标", () => {
    const verdict = judgeNativeDeepReadQuality({ shots: [], startSec: 0, endSec: 319 });
    expect(verdict.status).toBe("fail");
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.failures[0]!.code).toBe("quality_no_shots");
  });

  it("镜数不足门槛时不判字段多样性与尾段，避免短段误杀", () => {
    const shots = Array.from({ length: 4 }, (_, i) => realShot(i * 5, i * 5 + 5, 0));
    const m = measureNativeDeepReadQuality({ shots, startSec: 0, endSec: 20 });
    expect(m.lowVarietyFields).toEqual([]);
    const verdict = judgeNativeDeepReadQuality({ shots, startSec: 0, endSec: 20 });
    expect(verdict.failures.map((f) => f.code))
      .not.toContain("quality_tail_density_collapsed");
  });
});

describe("等长镜串：0831 漏网的模板化形态", () => {
  /** 描述各不相同、但时长完全等长——雷同率抓不到，必须靠步长抓。 */
  const evenShot = (i: number, len: number) => ({
    startSec: i * len, endSec: (i + 1) * len,
    actionZh: `第${i}个各不相同的动作描述`,
    lightingZh: `第${i}种光`, microExpressionZh: `第${i}种表情`,
    visualZh: `第${i}个画面`, shotSizeZh: "中景", angleZh: "平视",
    cameraMoveZh: "固定机位", unitTypeZh: "剪辑镜头", transitionInZh: "直接切入",
  });

  it("25 条连续 10 秒等长镜必须判出来（此前雷同率为 0 而漏放）", () => {
    const shots = Array.from({ length: 25 }, (_, i) => evenShot(i, 10));
    const verdict = judgeNativeDeepReadQuality({ shots, startSec: 0, endSec: 250 });
    expect(verdict.metrics.duplicateRatio).toBe(0);
    expect(verdict.metrics.longestEqualLengthRun).toBe(25);
    expect(verdict.metrics.equalLengthRunSec).toBe(10);
    expect(verdict.failures.map((f) => f.code)).toContain("quality_equal_length_run");
    expect(verdict.status).toBe("fail");
  });

  it("真实剪辑偶有几条同长不算模板（8 条以内放行）", () => {
    const shots = [
      ...Array.from({ length: 5 }, (_, i) => evenShot(i, 4)),
      { ...evenShot(5, 4), startSec: 20, endSec: 27 },
      { ...evenShot(6, 4), startSec: 27, endSec: 30 },
    ];
    const verdict = judgeNativeDeepReadQuality({ shots, startSec: 0, endSec: 30 });
    expect(verdict.metrics.longestEqualLengthRun).toBeLessThanOrEqual(8);
    expect(verdict.failures.map((f) => f.code)).not.toContain("quality_equal_length_run");
  });
});
