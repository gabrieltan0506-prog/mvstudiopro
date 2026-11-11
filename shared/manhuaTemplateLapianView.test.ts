import { describe, expect, it } from "vitest";
import { buildLapianFixtureCard, LAPIAN_FIXTURE_AD, LAPIAN_FIXTURE_DURATION_SEC, LAPIAN_FIXTURE_SPANS } from "./__fixtures__/manhuaTemplateLapianCard.fixture";
import {
  buildManhuaTemplateLapianGenesEvidence,
  buildManhuaTemplateLapianSegmentEvidence,
  buildManhuaTemplateShotTable,
  findManhuaTemplateShotTimecodeIssues,
  formatManhuaTemplateLapianGenes,
  formatManhuaTemplateLapianRecreatePrompt,
  formatManhuaTemplateShotTableTsv,
  manhuaTemplateLapianDurationSec,
  MANHUA_TEMPLATE_LAPIAN_MAX_SHOTS,
  planManhuaTemplateLapianSegments,
  summarizeManhuaTemplateVisualStats,
  validateManhuaTemplateLapianGenesOutput,
  validateManhuaTemplateLapianSegmentOutput,
} from "./manhuaTemplateLapianView";
import { videoBreakdownRecreatePromptSchema } from "./videoBreakdown";

const card = buildLapianFixtureCard();

function promptFor(lengthSec: number, windows = 3) {
  const step = lengthSec / windows;
  return {
    title: "殿前对峙",
    recreatePrompt: {
      subject: "同一位黑袍青年将军，面部轮廓与服饰全程一致",
      scene: "古装宫殿夜景内殿，朱漆立柱与烛台",
      timeline: Array.from({ length: windows }, (_, i) => ({ fromSec: Math.round(i * step * 10) / 10, toSec: Math.round((i + 1) * step * 10) / 10, text: `竖屏 9:16 第${i + 1}窗：近景，冷峻凝视，烛火摇曳` })),
      camera: "竖屏 9:16，近景为主，缓慢推近",
      lightColor: "暖烛侧光与冷月对比，暗部浓重",
      rhythm: "前慢后急，低频弦乐长音，器物落地声作重音",
      constraints: "保留冷暖对冲；避免现代道具与原剧人物原貌",
    },
  };
}

describe("模板学习 · 拉片式派生视图", () => {
  it("夹具规模与真实整集一致（527 镜、8 分片）", () => {
    expect(card.beatGrid).toHaveLength(527);
    expect(manhuaTemplateLapianDurationSec(card)).toBe(LAPIAN_FIXTURE_DURATION_SEC);
  });

  it("镜头构造表：证据条数进 = 呈现条数出，原序，时间码不越界", () => {
    const rows = buildManhuaTemplateShotTable(card);
    expect(rows).toHaveLength(card.beatGrid.length);
    rows.forEach((row, i) => {
      expect(row.index).toBe(i);
      expect(row.startSec).toBe(Math.round(card.beatGrid[i]!.atSec * 10) / 10);
    });
    expect(findManhuaTemplateShotTimecodeIssues(rows, LAPIAN_FIXTURE_DURATION_SEC)).toEqual([]);
    // 详写镜四栏都有内容；brief 镜显示占位但不丢行
    expect(rows[0]).toMatchObject({ framing: "特写", camera: "平视；固定机位" });
    expect(rows[2]).toMatchObject({ framing: "—", camera: "—", blockingAndFocus: "—" });
    // 没有镜头落在已剔除的广告区间内
    expect(rows.some(r => r.startSec >= LAPIAN_FIXTURE_AD.startSec && r.startSec < LAPIAN_FIXTURE_AD.endSec)).toBe(false);
    expect(formatManhuaTemplateShotTableTsv(rows).split("\n")).toHaveLength(rows.length + 1);
  });

  it("时间码越界会被点名", () => {
    const rows = buildManhuaTemplateShotTable({ beatGrid: [{ atSec: 5, endSec: 99, conflictZh: "a", visualZh: "b" }] });
    expect(findManhuaTemplateShotTimecodeIssues(rows, 10)).toEqual([0]);
  });

  it("分段：每镜进且只进一段，段不跨学习分片，段内≤40镜，段在分片内首尾相接", () => {
    const segments = planManhuaTemplateLapianSegments(card);
    const all = segments.flatMap(s => s.shotIndexes);
    expect(all).toHaveLength(card.beatGrid.length);
    expect(new Set(all).size).toBe(card.beatGrid.length);
    expect([...all].sort((a, b) => a - b)).toEqual(card.beatGrid.map((_, i) => i));
    segments.forEach((s, i) => {
      expect(s.index).toBe(i);
      expect(s.shotIndexes.length).toBeLessThanOrEqual(MANHUA_TEMPLATE_LAPIAN_MAX_SHOTS);
      expect(s.endSec).toBeGreaterThan(s.startSec);
      expect(s.startSec).toBeGreaterThanOrEqual(s.learnSpanStartSec);
      expect(s.endSec).toBeLessThanOrEqual(s.learnSpanEndSec);
      for (const idx of s.shotIndexes) {
        const b = card.beatGrid[idx]!;
        expect(b.atSec).toBeGreaterThanOrEqual(s.startSec);
        expect(b.atSec).toBeLessThan(s.endSec + 0.35);
      }
      const prev = segments[i - 1];
      if (prev && prev.learnSpanIndex === s.learnSpanIndex) expect(s.startSec).toBeCloseTo(prev.endSec, 5);
    });
    // 每个学习分片的首段从分片起点开始、末段到分片终点
    LAPIAN_FIXTURE_SPANS.forEach((span, i) => {
      const own = segments.filter(s => s.learnSpanIndex === i);
      expect(own[0]!.startSec).toBe(span.startSec);
      expect(own[own.length - 1]!.endSec).toBe(span.endSec);
    });
    // 41 分钟一集按 60 秒目标切，段数在合理范围
    expect(segments.length).toBeGreaterThanOrEqual(30);
    expect(segments.length).toBeLessThanOrEqual(60);
  });

  it("没有学习分片的旧卡退化为单片，仍全量分段", () => {
    const legacy = { ...card, provenance: undefined };
    const segments = planManhuaTemplateLapianSegments(legacy);
    expect(segments.flatMap(s => s.shotIndexes)).toHaveLength(card.beatGrid.length);
    expect(new Set(segments.map(s => s.learnSpanIndex))).toEqual(new Set([0]));
  });

  it("段证据包：镜头全量、相对秒、音轨裁到段内、不带字幕原文与截图地址", () => {
    const segments = planManhuaTemplateLapianSegments(card);
    let total = 0;
    for (const s of segments) {
      const ev = buildManhuaTemplateLapianSegmentEvidence(card, s);
      total += ev.shots.length;
      expect(ev.shots).toHaveLength(s.shotIndexes.length);
      for (const shot of ev.shots) {
        expect(shot.fromSec as number).toBeGreaterThanOrEqual(0);
        expect(shot.fromSec as number).toBeLessThanOrEqual(ev.lengthSec + 0.35);
      }
      for (const a of ev.audio) {
        expect(a.fromSec as number).toBeGreaterThanOrEqual(0);
        expect(a.toSec as number).toBeLessThanOrEqual(ev.lengthSec);
      }
      for (const k of ev.keyMoments) expect(k.atSec).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(ev)).not.toMatch(/objectName|native-frames|subtitle/);
    }
    expect(total).toBe(card.beatGrid.length);
  });

  it("视觉频次：全部取值都列出，计数 + 缺失 = 镜头数", () => {
    const stats = summarizeManhuaTemplateVisualStats(card);
    for (const key of ["framing", "angle", "cameraMove", "transitionIn", "unitType"] as const) {
      expect(stats[key].reduce((n, r) => n + r.count, 0) + stats.missing[key]).toBe(card.beatGrid.length);
    }
    const genes = buildManhuaTemplateLapianGenesEvidence(card);
    expect(genes.shots).toHaveLength(card.beatGrid.length);
  });

  it("段输出：通过拉片 recreatePrompt schema，格式函数产出秒锁文本", () => {
    const ok = validateManhuaTemplateLapianSegmentOutput(promptFor(58.4), 58.4);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(videoBreakdownRecreatePromptSchema.safeParse(ok.value.recreatePrompt).success).toBe(true);
    const text = formatManhuaTemplateLapianRecreatePrompt(ok.value.recreatePrompt);
    expect(text).toContain("【主体一致性】");
    expect(text).toContain("0.0–19.5秒：");
    expect(text).toContain("【生成约束】");
  });

  it("段输出：时间窗越界 / 倒序 / 缺字段都拒收", () => {
    const over = promptFor(30);
    over.recreatePrompt.timeline[2]!.toSec = 45;
    expect(validateManhuaTemplateLapianSegmentOutput(over, 30)).toMatchObject({ ok: false });
    const reversed = promptFor(30);
    reversed.recreatePrompt.timeline.reverse();
    expect(validateManhuaTemplateLapianSegmentOutput(reversed, 30)).toMatchObject({ ok: false });
    const missing = promptFor(30) as { recreatePrompt: Record<string, unknown> };
    delete missing.recreatePrompt.constraints;
    expect(validateManhuaTemplateLapianSegmentOutput(missing, 30)).toMatchObject({ ok: false });
  });

  it("视觉基因：复用拉片 overview 子 schema", () => {
    const genes = {
      visualGenes: { mediumAndArtStyle: "古装实拍", color: "朱红与墨黑", lighting: "暖烛侧光", materialTexture: "锦缎与漆木", composition: "对称纵深", camera: "近景为主" },
      recurringElements: ["烛台"], mustKeep: ["冷暖对冲"],
    };
    const ok = validateManhuaTemplateLapianGenesOutput(genes);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(formatManhuaTemplateLapianGenes(ok.value)).toContain("【材质与质感】锦缎与漆木");
    expect(validateManhuaTemplateLapianGenesOutput({ ...genes, mustKeep: [] }).ok).toBe(false);
  });
});
