/**
 * 模板免费试写 · 纯函数单测（node 环境，不碰 DB / 模型通道）：
 * 限流判定、输入裁剪、提示词组装、三段式解析的口径都在这里钉死。
 */
import { describe, expect, it } from "vitest";
import {
  MANHUA_WRITER_TRIAL_DAILY_LIMIT,
  buildManhuaWriterTrialPrompt,
  parseManhuaWriterTrialDraft,
  resolveManhuaWriterTrialGate,
  sanitizeManhuaWriterTrialInput,
} from "./manhuaWriterTrial.js";

describe("resolveManhuaWriterTrialGate", () => {
  it("默认每日 3 次：0/1/2 次放行，3 次拦截", () => {
    expect(MANHUA_WRITER_TRIAL_DAILY_LIMIT).toBe(3);
    for (const used of [0, 1, 2]) {
      const gate = resolveManhuaWriterTrialGate({ usedToday: used });
      expect(gate.allowed).toBe(true);
      expect(gate.trialsLeft).toBe(3 - used);
    }
    const blocked = resolveManhuaWriterTrialGate({ usedToday: 3 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.trialsLeft).toBe(0);
  });

  it("脏输入（负数/NaN/超量）不放大额度", () => {
    expect(resolveManhuaWriterTrialGate({ usedToday: -5 }).trialsLeft).toBe(3);
    expect(resolveManhuaWriterTrialGate({ usedToday: Number.NaN }).trialsLeft).toBe(3);
    expect(resolveManhuaWriterTrialGate({ usedToday: 99 }).allowed).toBe(false);
  });

  it("管理员不占额度且始终放行", () => {
    const gate = resolveManhuaWriterTrialGate({ usedToday: 99, isAdmin: true });
    expect(gate.allowed).toBe(true);
    expect(gate.trialsLeft).toBe(3);
  });
});

describe("sanitizeManhuaWriterTrialInput", () => {
  it("题材与补充条件全空 → 拒绝", () => {
    const r = sanitizeManhuaWriterTrialInput({ topic: "  ", brief: "" });
    expect(r.ok).toBe(false);
  });

  it("裁剪与 expand 同构：topic 500 / brief 2000 上限", () => {
    const r = sanitizeManhuaWriterTrialInput({
      topic: "甲".repeat(600),
      brief: "乙".repeat(2600),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.topic.length).toBe(500);
      expect(r.brief.length).toBe(2000);
    }
  });

  it("只填补充条件也放行（对齐 expand 的『二选一』口径）", () => {
    const r = sanitizeManhuaWriterTrialInput({ topic: "", brief: "主角归来复仇" });
    expect(r.ok).toBe(true);
  });
});

describe("buildManhuaWriterTrialPrompt", () => {
  it("套模板版包含 Skill 块；对照版不含", () => {
    const base = { topic: "权谋复仇", brief: "对手是旧盟友" };
    const withTpl = buildManhuaWriterTrialPrompt({ ...base, templateAddon: "能力简介：三拍反转" });
    const control = buildManhuaWriterTrialPrompt({ ...base, templateAddon: "" });
    expect(withTpl).toContain("【可调用的创作 Skill】");
    expect(withTpl).toContain("能力简介：三拍反转");
    expect(control).not.toContain("【可调用的创作 Skill】");
    // 除 Skill 块外前提一致，两版差异才归因于模板
    expect(control).toContain("【用户题材】权谋复仇");
    expect(withTpl).toContain("【用户题材】权谋复仇");
  });

  it("三段式输出标记与长度约束写进了提示词", () => {
    const p = buildManhuaWriterTrialPrompt({ topic: "t", brief: "", templateAddon: "" });
    expect(p).toContain("【单集梗概】");
    expect(p).toContain("【节拍点】");
    expect(p).toContain("【开场钩子】");
    expect(p).toContain("300–600 字");
  });
});

describe("parseManhuaWriterTrialDraft", () => {
  const good = [
    "【单集梗概】她假死归来，第一步先夺回被弟弟卖掉的祖宅。",
    "【节拍点】",
    "1. 拍卖会上她匿名举牌，压过弟弟出价。",
    "2. 弟弟发现神秘买家竟是「死去」的姐姐。",
    "3. 祖宅地契里藏着母亲留下的第二份遗嘱。",
    "【开场钩子】灵堂正中摆着她的遗像，她推门而入：「我的葬礼，怎么没人通知我？」",
  ].join("\n");

  it("标准三段式解析成功", () => {
    const d = parseManhuaWriterTrialDraft(good);
    expect(d).not.toBeNull();
    expect(d?.beats).toHaveLength(3);
    expect(d?.logline).toContain("假死归来");
    expect(d?.openingHook).toContain("葬礼");
  });

  it("缺任一段（如节拍点不足 3 条）→ 判失败，不下发半截结果", () => {
    expect(parseManhuaWriterTrialDraft("")).toBeNull();
    expect(
      parseManhuaWriterTrialDraft("【单集梗概】x\n【节拍点】\n1. a\n2. b\n【开场钩子】y"),
    ).toBeNull();
    expect(parseManhuaWriterTrialDraft("【单集梗概】x\n【开场钩子】y")).toBeNull();
  });

  it("节拍点超过 5 条时裁到 5 条", () => {
    const many = [
      "【单集梗概】x",
      "【节拍点】",
      ...Array.from({ length: 8 }, (_, i) => `${i + 1}. 第${i + 1}拍内容够长够具体`),
      "【开场钩子】y",
    ].join("\n");
    expect(parseManhuaWriterTrialDraft(many)?.beats).toHaveLength(5);
  });

  it("段落顺序颠倒也能解析（模型偶发换序不致整单报废）", () => {
    const shuffled = [
      "【开场钩子】开场文案",
      "【单集梗概】一句话梗概",
      "【节拍点】",
      "1. 甲",
      "2. 乙",
      "3. 丙",
    ].join("\n");
    const d = parseManhuaWriterTrialDraft(shuffled);
    expect(d?.logline).toBe("一句话梗概");
    expect(d?.openingHook).toBe("开场文案");
  });
});
