import { describe, expect, it } from "vitest";
import {
  defaultWorkbenchShots,
  scrubManhuaWorkbenchShotSlop,
  isManhuaWorkbenchActionSlop,
  isManhuaWorkbenchDialogueSlop,
  formatWorkbenchClipInjectBlock,
  formatWorkbenchSegmentClipInjectBlock,
  formatWorkbenchShotInjectBlock,
  groupShotsIntoSegments,
  inferWorkbenchShotCastCount,
  MANHUA_FACTORY_DEFAULT_VIDEO_MODEL,
  MANHUA_KEYARTS_PER_SEGMENT_MIN,
  MANHUA_SEGMENT_DEFAULT,
  manhuaSegmentCountBounds,
  manhuaSegmentDurationSec,
  recutWorkbenchShotsTo,
  type ManhuaWorkbenchShot,
  shotIndexesForSegment,
  parseManhuaClipTargetDurationSec,
  parseWorkbenchShotsFromText,
  pinnedManhuaSegmentCount,
  resolveClipSegmentIndex,
  resolveKeyartShotIndex,
  resolveSegmentClipDurationSec,
  resolveSegmentIndexFromShotIndex,
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

  it("falls back to default skeleton of ~12 segments × 3 keyarts", () => {
    const shots = parseWorkbenchShotsFromText("只有一段散文没有编号");
    expect(shots.length).toBe(MANHUA_SEGMENT_DEFAULT * MANHUA_KEYARTS_PER_SEGMENT_MIN);
    expect(defaultWorkbenchShots().length).toBe(
      MANHUA_SEGMENT_DEFAULT * MANHUA_KEYARTS_PER_SEGMENT_MIN,
    );
  });

  it("groups shots into segments; duration = sum of shot lengths clamped", () => {
    const shots = parseWorkbenchShotsFromText(
      ["1. 开门建立空间", "2. 走近形成压力", "3. 递出证物", "4. 反应特写", "5. 转身离开"].join(
        "\n",
      ),
    );
    // 有分镜表：按每段 3 镜切，不注水到默认 6 段；显式传 2.0-fast 不受默认常量影响。
    // 5 镜补齐到 6 镜两段满编：尾段留 2 镜会让镜号→段号映射（按 3 镜/段）错位，
    // 而且那条尾段成片本来就按整段跑、按整段收 172 积分，标 10s 是假的。
    const segsFast = groupShotsIntoSegments(shots, {
      videoModel: "seedance-2.0-fast",
    });
    expect(segsFast.length).toBe(2);
    expect(segsFast[0]?.durationSec).toBe(15);
    expect(segsFast[1]?.durationSec).toBe(15);
    expect(MANHUA_FACTORY_DEFAULT_VIDEO_MODEL).toBe("seedance-2.0-mini");
    expect(manhuaSegmentDurationSec("seedance-2.0-fast")).toBe(15);
    expect(manhuaSegmentDurationSec("gemini-omni-flash")).toBe(10);
    // 尾段补满后一集就是 2 段 ×15s；这也是实际会烧出来的秒数
    expect(workbenchShotTotalSec(shots, "seedance-2.0-fast")).toBe(30);
    expect(workbenchShotTotalSec(shots, "gemini-omni-flash")).toBe(20);
    // 默认骨架：6 段 ×（3 镜×5s 钳 15）= 90s
    expect(workbenchShotTotalSec([], "seedance-2.0-fast")).toBe(90);
    expect(
      groupShotsIntoSegments([], { videoModel: "seedance-2.0-fast" }).length,
    ).toBe(MANHUA_SEGMENT_DEFAULT);
  });

  /**
   * 段数决定实际铺几条成片、也决定实收几段积分，不能由反推这次吐了几镜来定。
   * 旧行为固定按 3 镜切段，18 镜就切 6 段，2.5（段表 4 段）会多收两段。
   */
  it("pins segment count and duration to the engine table, not the shot count", () => {
    const shots = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        index: i + 1,
        durationSec: 0,
        cameraZh: "中景",
        actionZh: `动作 ${i + 1}`,
      }));

    for (const n of [12, 13, 16, 18, 24]) {
      const s25 = groupShotsIntoSegments(shots(n), {
        videoModel: "seedance-2.5",
        segmentCount: manhuaSegmentCountBounds("seedance-2.5").default,
      });
      expect(s25.length).toBe(4);
      expect(s25.every((x) => x.durationSec === 30)).toBe(true);
      // 每段恰好 3 镜：全仓的镜↔段映射都按这个不变量算，超出的镜截掉而不是塞进段内
      expect(s25.every((x) => x.shots.length === MANHUA_KEYARTS_PER_SEGMENT_MIN)).toBe(true);
      expect(s25.reduce((sum, x) => sum + x.shots.length, 0)).toBe(12);

      const sMini = groupShotsIntoSegments(shots(n), {
        videoModel: "seedance-2.0-mini",
        segmentCount: manhuaSegmentCountBounds("seedance-2.0-mini").default,
      });
      expect(sMini.length).toBe(6);
      expect(sMini.every((x) => x.durationSec === 15)).toBe(true);
      expect(sMini.every((x) => x.shots.length === MANHUA_KEYARTS_PER_SEGMENT_MIN)).toBe(true);
    }
  });

  /**
   * 非钉段（2.0 / 2.0-fast）不该被 24 镜的固定上限卡住：长档一集 12 段要 36 镜，
   * 卡在 24 镜只能出 8 段。镜数不是 3 的倍数时也要补齐，否则尾段不足 3 镜，
   * 镜号→段号映射（按 3 镜/段）会把镜绑到隔壁段。
   */
  it("非钉段按长档上限收镜，并补齐到 3 的倍数", () => {
    const shots = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        index: i + 1,
        durationSec: 0,
        cameraZh: "中景",
        actionZh: `动作 ${i + 1}`,
      }));
    const group = (n: number) =>
      groupShotsIntoSegments(shots(n), {
        videoModel: "seedance-2.0-fast",
        segmentCount: pinnedManhuaSegmentCount("seedance-2.0-fast"),
      });

    // 13 镜 → 补到 15 镜 5 段，尾段不再是孤零零 1 镜
    const s13 = group(13);
    expect(s13.length).toBe(5);
    expect(s13.every((x) => x.shots.length === MANHUA_KEYARTS_PER_SEGMENT_MIN)).toBe(true);

    // 24 镜 → 8 段，正好整除不补不截
    const s24 = group(24);
    expect(s24.length).toBe(8);
    expect(s24.reduce((sum, x) => sum + x.shots.length, 0)).toBe(24);

    // 36 镜 → 长档满编 12 段，不再被 24 镜上限截成 8 段
    const s36 = group(36);
    expect(s36.length).toBe(12);
    expect(s36.every((x) => x.shots.length === MANHUA_KEYARTS_PER_SEGMENT_MIN)).toBe(true);

    // 超过长档上限才截：40 镜仍是 12 段
    expect(group(40).length).toBe(12);
  });

  it("钉段后镜→段映射与 groupShotsIntoSegments 一致", () => {
    // 段内多塞一张镜就会让这两边各算各的，镜绑到错误的段成片上
    const shots = Array.from({ length: 18 }, (_, i) => ({
      index: i + 1,
      durationSec: 0,
      cameraZh: "中景",
      actionZh: `动作 ${i + 1}`,
    }));
    for (const videoModel of ["seedance-2.5", "seedance-2.0-mini", "seedance-2.0-fast"]) {
      const segs = groupShotsIntoSegments(shots, {
        videoModel,
        segmentCount: manhuaSegmentCountBounds(videoModel).default,
      });
      for (const seg of segs) {
        for (const shot of seg.shots) {
          expect(resolveSegmentIndexFromShotIndex(shot.index)).toBe(seg.index);
        }
        expect(shotIndexesForSegment(seg.index)).toEqual(seg.shots.map((s) => s.index));
      }
    }
  });

  it("still respects real shot durations when the script marks them", () => {
    const marked = [
      { index: 1, durationSec: 12, cameraZh: "中景", actionZh: "a" },
      { index: 2, durationSec: 12, cameraZh: "中景", actionZh: "b" },
      { index: 3, durationSec: 12, cameraZh: "中景", actionZh: "c" },
      { index: 4, durationSec: 12, cameraZh: "中景", actionZh: "d" },
    ];
    const segs = groupShotsIntoSegments(marked, {
      videoModel: "seedance-2.5",
      segmentCount: 4,
    });
    expect(segs.length).toBe(4);
    // 每段 3 镜 ×12s = 36 → 钳到 2.5 上限 30，而不是回落到标称值
    expect(segs[0]?.durationSec).toBe(30);
  });

  it("parses clip target duration from inject prompt", () => {
    expect(parseManhuaClipTargetDurationSec("目标时长：约 12 秒（允许 ±1 秒）")).toBe(12);
    expect(
      resolveSegmentClipDurationSec(
        [
          { durationSec: 4 },
          { durationSec: 4 },
          { durationSec: 4 },
        ],
        "seedance-2.0-fast",
      ),
    ).toBe(12);
    expect(resolveSegmentClipDurationSec([{ durationSec: 99 }], "seedance-2.0-fast")).toBe(15);
    expect(resolveSegmentClipDurationSec([{ durationSec: 30 }], "seedance-2.5")).toBe(30);
    expect(resolveSegmentClipDurationSec([{ durationSec: 99 }], "seedance-2.5")).toBe(30);
    expect(resolveSegmentClipDurationSec([{ durationSec: 99 }], "happyhorse-1.1")).toBe(15);
    expect(resolveSegmentClipDurationSec([{ durationSec: 7 }], "happyhorse-1.1")).toBe(10);
    expect(manhuaSegmentDurationSec("happyhorse-1.1")).toBe(15);
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
    expect(block).toContain("对白硬锁");
    expect(block).toContain("零可读文字");
    expect(resolveKeyartShotIndex("keyart-e01-s03-abc", "")).toBe(3);
    expect(resolveKeyartShotIndex("keyart-e01-xyz", block)).toBe(2);
    expect(resolveClipSegmentIndex("clip-e01-g02-xyz", "")).toBe(2);
    expect(resolveClipSegmentIndex("clip-e02-g13-xyz", "")).toBe(13);
  });

  it("formats segment clip inject as short second-axis card", () => {
    const block = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 15,
      intentZh: "压迫感逼近",
      shots: [
        {
          index: 1,
          durationSec: 0,
          cameraZh: "全景缓慢推近",
          actionZh: "高主管推上红色裁员文件夹",
          intentZh: "压迫感逼近",
        },
      ],
    });
    expect(block).toContain("【第1段·15s】");
    // 锁秒轴该有的内容，不锁字段拼接顺序（原先锁的是更早的「全景缓慢推近」紧凑写法）
    expect(block).toMatch(/0–15s：.*红色裁员文件夹/);
    expect(block).toMatch(/缓慢推近/);
    expect(block).toMatch(/全景/);
    expect(block).not.toContain("节拍防火墙");
    expect(block).not.toContain("成片预演硬锁");
    const legacy = formatWorkbenchClipInjectBlock({
      index: 1,
      durationSec: 15,
      cameraZh: "全景",
      actionZh: "推门",
    });
    expect(legacy).toContain("【第1段·15s】");
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
        { id: "c1", nameZh: "女主" },
        { id: "c2", nameZh: "男主" },
      ],
      props: [{ id: "p1", nameZh: "玉佩" }],
    });
    expect(dual.mode).toBe("matched");
    expect(dual.characterIds.length).toBeGreaterThanOrEqual(1);
  });

  it("scrub 清掉默认骨架假对白与模板动作，改用可拍表表演", () => {
    expect(isManhuaWorkbenchDialogueSlop("别逼我。")).toBe(true);
    expect(isManhuaWorkbenchActionSlop("第1段戏核：承接上镜落点，推进动作轨迹与关系变化")).toBe(
      true,
    );
    const scrubbed = scrubManhuaWorkbenchShotSlop(
      [
        {
          index: 1,
          durationSec: 5,
          cameraZh: "全景",
          actionZh: "第1段起幅：开场建立场景纵深与人物站位；写清空间纵深与起幅机位",
        },
        {
          index: 2,
          durationSec: 5,
          cameraZh: "中景",
          actionZh: "第1段戏核：承接上镜落点，推进动作轨迹与关系变化；关键道具可读交互",
          dialogueZh: "别逼我。",
        },
      ],
      {
        performanceZh: "踩灭桥板箭火；伸手取账册",
        intentZh: "桥上争账",
        sceneHintZh: "断月桥",
      },
    );
    expect(scrubbed[0]?.actionZh).toContain("踩灭桥板箭火");
    expect(scrubbed[0]?.actionZh).not.toMatch(/写清空间纵深|承接上镜落点/);
    expect(scrubbed[1]?.dialogueZh).toBeUndefined();
    expect(scrubbed[1]?.actionZh).toContain("取账册");
  });

  it("defaultWorkbenchShots 不再塞假对白与空间纵深空话", () => {
    const shots = defaultWorkbenchShots();
    expect(shots.some((s) => s.dialogueZh)).toBe(false);
    expect(shots.some((s) => /写清空间纵深|别逼我/.test(s.actionZh))).toBe(false);
  });
});

describe("recutWorkbenchShotsTo：换引擎重切", () => {
  const shot = (i: number, action: string, dialogue?: string): ManhuaWorkbenchShot => ({
    index: i,
    durationSec: 5,
    cameraZh: "平视",
    actionZh: action,
    dialogueZh: dialogue,
  });

  it("镜多时合并，台词一句都不丢", () => {
    const src = [
      shot(1, "甲推门", "「谁在外面」"),
      shot(2, "乙抬头", "「是我」"),
      shot(3, "刀出鞘", "「别动」"),
      shot(4, "雨落下"),
    ];
    const r = recutWorkbenchShotsTo(src, 2);
    expect(r.shots.length).toBe(2);
    expect(r.mode).toBe("merged");
    const allDialogue = r.shots.map((s) => s.dialogueZh || "").join(" ");
    for (const line of ["「谁在外面」", "「是我」", "「别动」"]) {
      expect(allDialogue).toContain(line);
    }
    // 动作也全在
    const allAction = r.shots.map((s) => s.actionZh).join("；");
    for (const a of ["甲推门", "乙抬头", "刀出鞘", "雨落下"]) {
      expect(allAction).toContain(a);
    }
  });

  it("镜少时拆分，台词只归其中一镜不重复", () => {
    const src = [shot(1, "他缓缓抬起头，目光越过人群，落在门口那道影子上。", "「你终于来了」")];
    const r = recutWorkbenchShotsTo(src, 2);
    expect(r.shots.length).toBe(2);
    expect(r.mode).toBe("split");
    const withDialogue = r.shots.filter((s) => (s.dialogueZh || "").trim());
    expect(withDialogue.length).toBe(1);
  });

  it("内容太薄拆不动时报 thin，不假装拆成功", () => {
    const r = recutWorkbenchShotsTo([shot(1, "开门")], 4);
    expect(r.mode).toBe("thin");
    expect(r.shots.length).toBeLessThan(4);
  });

  it("合并按比例分桶，恰好得到目标镜数", () => {
    const src = Array.from({ length: 40 }, (_, i) => shot(i + 1, `动作${i + 1}`));
    expect(recutWorkbenchShotsTo(src, 36).shots.length).toBe(36);
    expect(recutWorkbenchShotsTo(src, 12).shots.length).toBe(12);
  });

  it("thin 会通过 captureRecut 传出去，前端才能引导付费扩写", () => {
    const capture: Parameters<typeof groupShotsIntoSegments>[1] extends
      | { captureRecut?: infer C }
      | undefined
      ? NonNullable<C>
      : never = {};
    groupShotsIntoSegments([shot(1, "开门"), shot(2, "关门")], {
      videoModel: "seedance-2.5",
      segmentCount: 4,
      captureRecut: capture,
    });
    expect(capture.mode).toBe("thin");
    expect(capture.paddedCount).toBeGreaterThan(0);
  });
});
