/**
 * 卡点表接线回归：对齐计划、片内秒位不随入点漂移、以及 structure 往返不丢。
 *
 * 这三条都是「不报错的错」——算错了 ffmpeg 照样出片，只是压错地方，
 * 所以必须有测试钉住，不能靠肉眼听。
 */
import { describe, expect, it } from "vitest";
import {
  buildBeatTable,
  buildBgmAlignment,
  beatTableToVolumeExpr,
  BGM_VOLUME,
  type BgmStructure,
  type FilmEvent,
} from "./manhuaBeatTable";

const structure: BgmStructure = {
  strongestAtSec: 8,
  strongestPeakDb: -0.4,
  valleyAtSec: 14,
  valleyMeanDb: -28,
  decayStartSec: 26,
  totalSec: 30,
};

describe("buildBgmAlignment · 最强击点搬到断裂点", () => {
  it("击点早于画面 → 整轨后挪（entrySec），不从曲内切", () => {
    const events: FilmEvent[] = [{ atSec: 12, kind: "断裂点", descZh: "刀落" }];
    const a = buildBgmAlignment(structure, events);
    expect(a.entrySec).toBe(4); // 12 - 8
    expect(a.seekSec).toBe(0);
    expect(a.anchorFilmSec).toBe(12);
    expect(a.anchorBgmSec).toBe(8);
  });

  it("击点晚于画面 → 从曲内往后切（seekSec），不能用负入点", () => {
    const events: FilmEvent[] = [{ atSec: 3, kind: "断裂点", descZh: "刀落" }];
    const a = buildBgmAlignment(structure, events);
    expect(a.entrySec).toBe(0);
    expect(a.seekSec).toBe(5); // 8 - 3
  });

  it("没有断裂点 → 不搬，从头播", () => {
    const events: FilmEvent[] = [{ atSec: 6, kind: "对白窗", durationSec: 2, descZh: "他说" }];
    const a = buildBgmAlignment(structure, events);
    expect(a.entrySec).toBe(0);
    expect(a.seekSec).toBe(0);
  });
});

describe("volumeExpr · 静音窗落在片内秒位，不随入点后移", () => {
  it("entrySec=5 时，10s 的静音停顿仍在 10s 生效", () => {
    const events: FilmEvent[] = [
      { atSec: 10, kind: "静音停顿", durationSec: 1, descZh: "全场静" },
    ];
    const rows = buildBeatTable({ structure, events, entrySec: 5, filmDurationSec: 30 });
    const silent = rows.find((r) => r.volume === BGM_VOLUME.silent);
    expect(silent?.filmSec).toBe(10); // 不是 15
    const expr = beatTableToVolumeExpr(rows);
    expect(expr).toContain("between(t,10,11)");
  });

  it("对白窗压到 0.18，窗尾回到基准", () => {
    const events: FilmEvent[] = [
      { atSec: 4, kind: "对白窗", durationSec: 3, descZh: "他说：走" },
    ];
    const rows = buildBeatTable({ structure, events, entrySec: 0, filmDurationSec: 30 });
    expect(rows.some((r) => r.filmSec === 4 && r.volume === BGM_VOLUME.dialogue)).toBe(true);
    expect(rows.some((r) => r.filmSec === 7 && r.volume === BGM_VOLUME.base)).toBe(true);
  });
});
