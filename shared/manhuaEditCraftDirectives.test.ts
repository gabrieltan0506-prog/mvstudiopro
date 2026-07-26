import { describe, expect, it } from "vitest";
import {
  findManhuaFlatShotSizeRun,
  formatManhuaEditCraftDirectives,
  readManhuaShotSizeSequence,
} from "./manhuaEditCraftDirectives";

describe("段内景别序列", () => {
  it("按出现顺序读，长词不被短词重复吃", () => {
    const seq = readManhuaShotSizeSequence(
      "0–5s：中景，两人对峙。5–10s：大特写，眼尾一抖。10–15s：全景，摔门而出。",
    );
    expect(seq.map((s) => s.nameZh)).toEqual(["中景", "大特写", "全景"]);
  });

  it("没点名景别时返回空", () => {
    expect(readManhuaShotSizeSequence("雨点砸在桥板上。")).toEqual([]);
  });
});

describe("景别反差判定", () => {
  it("中景→特写→全景 算拉开了", () => {
    const seq = readManhuaShotSizeSequence("中景。特写。全景。");
    expect(findManhuaFlatShotSizeRun(seq)).toBeNull();
  });

  it("字面不同但跨度不足也要抓出来", () => {
    // 「近景→中近景」看着换了词，实际跨度 0，剪出来像原地踏步
    const seq = readManhuaShotSizeSequence("近景。中近景。");
    expect(findManhuaFlatShotSizeRun(seq)).toEqual({ fromZh: "近景", toZh: "中近景" });
  });

  it("连续同景别当然算平", () => {
    const seq = readManhuaShotSizeSequence("中景。中景。");
    expect(findManhuaFlatShotSizeRun(seq)?.toZh).toBe("中景");
  });
});

describe("剪辑手法指令", () => {
  const multi =
    "0–5s：中景，两人对峙，她说「我不会认输」。5–10s：特写，指节收紧。10–15s：全景，他摔门而出。";

  it("多镜有台词时讲台词落点与发力点", () => {
    const out = formatManhuaEditCraftDirectives({ prompt: multi });
    expect(out).toContain("0.2 秒");
    expect(out).toContain("发力那一帧");
    expect(out).toMatch(/台词未说完/);
  });

  it("景别已拉开时不再点名批评", () => {
    const out = formatManhuaEditCraftDirectives({ prompt: multi });
    expect(out).toContain("保持景别反差");
    expect(out).not.toMatch(/跨度太小/);
  });

  it("景别偏平时把那一对点出来", () => {
    const out = formatManhuaEditCraftDirectives({
      prompt: "0–7s：中景，对峙。7–15s：中景，转身。",
    });
    expect(out).toContain("跨度太小");
    expect(out).toContain("中景→中景");
  });

  it("单镜段不讲切点与景别，只留转场与音效", () => {
    // 段里只有一镜时讲切镜是空话，反而诱导模型自己加一刀
    const out = formatManhuaEditCraftDirectives({
      prompt: "0–15s：中景，雨点砸在空桥板上。",
      shotCount: 1,
    });
    expect(out).not.toContain("0.2 秒");
    expect(out).not.toContain("景别反差");
    expect(out).toContain("禁止转场特效");
    expect(out).toContain("脚步声");
  });

  it("段内不跨场景时禁止一切转场特效", () => {
    const out = formatManhuaEditCraftDirectives({ prompt: multi });
    expect(out).toContain("一律直切");
    expect(out).toMatch(/叠化都不要/);
  });

  it("跨场景段才给短转场额度", () => {
    const out = formatManhuaEditCraftDirectives({ prompt: multi, crossScene: true });
    expect(out).toContain("0.3–0.5 秒");
    expect(out).not.toContain("一律直切");
  });

  it("无台词段改讲情绪转折，不提台词", () => {
    const out = formatManhuaEditCraftDirectives({
      prompt: "0–5s：全景，风雪压城。5–10s：特写，血珠落雪。",
    });
    expect(out).toContain("情绪转折处");
    expect(out).not.toMatch(/台词/);
  });

  it("空提示词不产出", () => {
    expect(formatManhuaEditCraftDirectives({ prompt: "" })).toBe("");
  });
});
