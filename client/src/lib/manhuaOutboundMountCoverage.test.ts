/**
 * 0914 审查 P1：OmniCanvas 有三处 FreeformCanvas 挂载，其中第三处漏传
 * resolveManhuaOutboundGate；而 FreeformCanvas 又用「回调是否存在」决定要不要强制，
 * 于是漏传的那一处反而把门禁关掉了。
 *
 * 这组测试读**真实源码**，两头各钉一道：
 *  1. 每一处挂载都必须传闸（结构性保证，新增挂载忘了传会立刻红）；
 *  2. FreeformCanvas 的强制条件不得再看回调存不存在。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const omni = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
const freeform = readFileSync(
  new URL("../components/canvas/FreeformCanvas.tsx", import.meta.url),
  "utf8",
);

describe("三个画布挂载都接确认闸", () => {
  it("OmniCanvas 里每一处 <FreeformCanvas 都传 resolveManhuaOutboundGate", () => {
    const mounts = omni.split("<FreeformCanvas").slice(1);
    expect(mounts.length).toBeGreaterThanOrEqual(3);
    const missing: number[] = [];
    mounts.forEach((tail, i) => {
      // 只看这个标签自身的属性区（到第一个 /> 或 > 为止）
      const end = tail.search(/\/>|>\s*\n/);
      const attrs = tail.slice(0, end < 0 ? 2000 : end);
      if (!attrs.includes("resolveManhuaOutboundGate")) missing.push(i + 1);
    });
    expect(missing, `第 ${missing.join("、")} 处挂载没接确认闸`).toEqual([]);
  });

  it("FreeformCanvas 的强制条件不看回调存不存在", () => {
    // 旧写法：enforceOutboundConfirmation: isManhuaClip && Boolean(resolveManhuaOutboundGate)
    expect(freeform).not.toMatch(
      /enforceOutboundConfirmation:\s*isManhuaClip\s*&&\s*Boolean\(/,
    );
    expect(freeform).toMatch(/enforceOutboundConfirmation:\s*isManhuaClip\s*,/);
  });

  it("FreeformCanvas 在 clip 且没接闸／没接准备入口时明确拒绝，而不是放行", () => {
    expect(freeform).toMatch(
      /isManhuaClip\s*&&\s*\(!resolveManhuaOutboundGate\s*\|\|\s*!prepareManhuaClipRun\)/,
    );
    expect(freeform).toContain("这个画布没有接入生成前确认");
  });

  it("每一处挂载也都传了生产唯一准备入口 prepareManhuaClipRun", () => {
    const mounts = omni.split("<FreeformCanvas").slice(1);
    const missing: number[] = [];
    mounts.forEach((tail, i) => {
      const end = tail.search(/\/>|>\s*\n/);
      const attrs = tail.slice(0, end < 0 ? 2000 : end);
      if (!attrs.includes("prepareManhuaClipRun")) missing.push(i + 1);
    });
    expect(missing, `第 ${missing.join("、")} 处挂载没接准备入口`).toEqual([]);
  });

  it("画布 clip 重跑消费准备入口的结果，而不是自己 collect 一套", () => {
    // 0914 复审：上一轮画布不走工厂准备也不传 pilotRun，
    // 我却在测试里替它补上——现在由生产结构保证。
    expect(freeform).toMatch(/await prepareManhuaClipRun!\(blockId\)/);
    expect(freeform).toMatch(/clipRun \? clipRun\.preparedBlock : runBlockPayload/);
    expect(freeform).toMatch(/\.\.\.\(clipRun\?\.runOptions \?\? \{\}\)/);
  });

  it("画布走的是提交边界现读的 getter，不是快照", () => {
    expect(freeform).toMatch(/resolveOutboundGate:\s*isManhuaClip\s*\?\s*resolveManhuaOutboundGate/);
  });

  it("编排器也传 getter 而不是快照", () => {
    const studio = readFileSync(new URL("./canvasDramaStudio.ts", import.meta.url), "utf8");
    expect(studio).toMatch(/resolveOutboundGate:\s*opts\.resolveOutboundGate/);
    expect(studio).not.toMatch(/outboundGate:\s*opts\.resolveOutboundGate\?\.\(/);
  });
});
