import { describe, expect, it } from "vitest";
import {
  defaultWorkbenchShots,
  formatWorkbenchClipInjectBlock,
  formatWorkbenchShotInjectBlock,
  inferWorkbenchShotCastCount,
  parseWorkbenchShotsFromText,
  resolveKeyartShotIndex,
  resolveWorkbenchShotAssetMount,
  workbenchShotTotalSec,
} from "./manhuaScriptWorkbench";

describe("manhuaScriptWorkbench", () => {
  it("parses numbered beat lines into shots", () => {
    const shots = parseWorkbenchShotsFromText(
      ["1. 女主推门进厅", "2. 对视沉默三秒", "3. 男主递玉佩", "4. 特写玉佩裂纹"].join("\n"),
    );
    expect(shots).toHaveLength(4);
    expect(shots[0]?.actionZh).toContain("推门");
    expect(shots[1]?.actionZh).toContain("对视");
    expect(inferWorkbenchShotCastCount(shots[1]!.actionZh)).toBe(2);
    expect(workbenchShotTotalSec(shots)).toBeCloseTo(10, 0);
  });

  it("parses markdown storyboard table with camera column", () => {
    const shots = parseWorkbenchShotsFromText(
      [
        "## 分镜表",
        "| 镜号 | 景别 | 内容 |",
        "| --- | --- | --- |",
        "| 1 | 近景 | 女主推门进厅 |",
        "| 2 | 中景 | 男女对视沉默 |",
        "| 3 | 特写 | 男主递玉佩给女主 |",
        "",
        "## Seedance / I2V 微动提示词（每镜一句）",
        "1. slow push on face",
        "2. locked-off stare",
      ].join("\n"),
    );
    expect(shots).toHaveLength(3);
    expect(shots[0]?.cameraZh).toContain("近景");
    expect(shots[0]?.actionZh).toContain("推门");
    expect(shots[1]?.cameraZh).toContain("中景");
    expect(shots[1]?.actionZh).toContain("对视");
    expect(shots.every((s) => !/slow push|locked-off/i.test(s.actionZh))).toBe(true);
  });

  it("splits camera prefix from numbered lines", () => {
    const shots = parseWorkbenchShotsFromText(
      ["1. 近景：女主推门进厅", "2. 中景：男女对视沉默三秒", "3. 特写：递玉佩"].join("\n"),
    );
    expect(shots[0]?.cameraZh).toBe("近景");
    expect(shots[0]?.actionZh).toContain("推门");
    expect(shots[0]?.actionZh).not.toMatch(/^近景/);
  });

  it("falls back to default skeleton when text is unstructured", () => {
    const shots = parseWorkbenchShotsFromText("只有一段散文没有编号");
    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(defaultWorkbenchShots().length).toBe(4);
  });

  it("caps one ten-second clip at four shots", () => {
    const shots = parseWorkbenchShotsFromText(
      ["1. 开门建立空间", "2. 走近形成压力", "3. 递出证物", "4. 反应特写", "5. 转身离开"].join("\n"),
    );
    expect(shots).toHaveLength(4);
    expect(workbenchShotTotalSec(shots)).toBe(10);
  });

  it("formats shot inject with cast lock and resolves keyart shot index", () => {
    const block = formatWorkbenchShotInjectBlock({
      index: 2,
      durationSec: 3.5,
      cameraZh: "中近景",
      actionZh: "男女对视，递玉佩",
    });
    expect(block).toContain("【分镜 2·静帧】");
    expect(block).toContain("递玉佩");
    expect(block).toContain("中近景；主体以胸部以上为主");
    expect(block).toContain("人数硬锁");
    expect(block).toContain("至少两名");
    expect(block).toContain("禁止套用统一的暖背景加轮廓光模板");
    expect(block).toContain("禁字硬锁");
    expect(resolveKeyartShotIndex("keyart-e01-s03-abc", "")).toBe(3);
    expect(resolveKeyartShotIndex("keyart-e01-xyz", block)).toBe(2);
  });

  it("formats clip inject with shot event and duration", () => {
    const block = formatWorkbenchClipInjectBlock({
      index: 1,
      durationSec: 2.5,
      cameraZh: "全景缓慢推近",
      actionZh: "高主管推上红色裁员文件夹",
    });
    expect(block).toContain("【分镜 1·片段成片】");
    expect(block).toContain("约 2.5 秒");
    expect(block).toContain("红色裁员文件夹");
    expect(block).toContain("禁止只做空镜走路");
  });

  it("resolves per-shot asset mount from named cast or soft dual roles", () => {
    const named = resolveWorkbenchShotAssetMount({
      actionZh: "沈清辞推门，顾夜笙回望",
      characters: [
        { id: "c1", nameZh: "沈清辞" },
        { id: "c2", nameZh: "顾夜笙" },
        { id: "c3", nameZh: "路人甲" },
      ],
      props: [{ id: "p1", nameZh: "玉佩" }],
    });
    expect(named.mode).toBe("matched");
    expect(named.characterIds).toEqual(["c1", "c2"]);
    expect(named.expectedCastCount).toBe(1);

    const dual = resolveWorkbenchShotAssetMount({
      actionZh: "男女对视，递玉佩",
      characters: [
        { id: "c1", nameZh: "沈清辞" },
        { id: "c2", nameZh: "顾夜笙" },
      ],
      props: [{ id: "p1", nameZh: "玉佩" }],
    });
    expect(dual.mode).toBe("matched");
    expect(dual.characterIds).toEqual(["c1", "c2"]);
    expect(dual.propIds).toEqual(["p1"]);
    expect(dual.expectedCastCount).toBe(2);

    const fallback = resolveWorkbenchShotAssetMount({
      actionZh: "空镜推进廊道",
      characters: [
        { id: "c1", nameZh: "沈清辞" },
        { id: "c2", nameZh: "顾夜笙" },
      ],
    });
    expect(fallback.mode).toBe("default");
    expect(fallback.characterIds).toEqual(["c1", "c2"]);
  });
});
