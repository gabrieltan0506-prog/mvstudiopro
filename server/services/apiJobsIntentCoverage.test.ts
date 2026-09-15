/**
 * 架构守门：**所有建单入口都必须先过意图裁决层**，不许有旧入口绕过。
 *
 * 放在 server/services/ 而不是 api/：本仓 vitest include 只覆盖
 * server / client/src/lib / shared 三处（vitest.config.ts），api/ 下的测试根本不会被跑。
 *
 * 为什么要静态守门而不是只靠行为测试（0915 D 施工单补齐项三）：
 * `createCanvasVideoTask` 在 api/jobs.ts 里有七个调用点（videoUpscale / hailuo3Video /
 * wan30Video / happyHorseVideo / seedanceI2V ×2 / 试片）。行为测试只能覆盖走到的那几条；
 * 漏接一条就是一个「不经裁决直接建单扣费」的后门，而且不会有任何报错。
 * 这里按源码静态断言：**每个建单点上方都必须能找到 acquireCanvasIntent**。
 *
 * 本文件不验证运行行为，只验证接线覆盖面——行为由各 op 的用例负责。
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const JOBS = path.resolve(import.meta.dirname, "..", "..", "api", "jobs.ts");
const SOURCE = fs.readFileSync(JOBS, "utf8");
const LINES = SOURCE.split("\n");

/** 找出所有真正建单的行号（排除 import 行） */
function createSites(): number[] {
  const out: number[] = [];
  LINES.forEach((line, i) => {
    if (/await\s+createCanvasVideoTask\s*\(/.test(line)) out.push(i + 1);
  });
  return out;
}

/**
 * 判断某个建单点是否在同一个处理分支内先调过裁决层。
 *
 * 口径：从建单行向上回溯 `window` 行，必须出现 `acquireCanvasIntent`。
 * 窗口取得足够大（覆盖「鉴权 → 摘要 → 占位 → 扣费 → 建单」这一段），
 * 但不跨整个文件——否则别处的一次调用会把所有点都算成已接。
 */
/**
 * 各建单点通过 `gateCanvasIntentBeforeCharge(...)` 进裁决层（它内部调 `acquireCanvasIntent`，
 * 下面有专门一条断言这个链没断）。直接调 `acquireCanvasIntent` 也算。
 */
const GUARD_CALL = /\b(acquireCanvasIntent|gateCanvasIntentBeforeCharge)\s*\(/;

function hasIntentGuardAbove(line: number, window = 220): boolean {
  const from = Math.max(0, line - window);
  return LINES.slice(from, line).some((l) => GUARD_CALL.test(l));
}

describe("建单入口必须全部经过意图裁决", () => {
  it("能找到建单点，且数量与已知一致（新增入口会让这条先红）", () => {
    const sites = createSites();
    expect(sites.length).toBeGreaterThan(0);
    // 已知七处；新增建单入口时这条会红，提醒把新入口也接上裁决层
    expect(sites.length).toBe(7);
  });

  it("gateCanvasIntentBeforeCharge 助手本身必须调用 acquireCanvasIntent（链不能在助手里断掉）", () => {
    const at = LINES.findIndex((l) => /async function gateCanvasIntentBeforeCharge\s*\(/.test(l));
    expect(at).toBeGreaterThan(-1);
    const body = LINES.slice(at, at + 40).join("\n");
    expect(body).toMatch(/acquireCanvasIntent\s*\(/);
    expect(body).toMatch(/computeCanvasTaskInputDigest\s*\(/); // 摘要必须由服务端按建单输入算
  });

  it("**每一个建单点上方都必须有意图裁决**——不许旧入口绕过", () => {
    const unguarded = createSites().filter((l) => !hasIntentGuardAbove(l));
    // 失败时直接报出行号，便于定位是哪条 op 漏接
    expect(unguarded).toEqual([]);
  });

  it("扣费必须发生在裁决之后：同一分支里 acquireCanvasIntent 先于 chargeCanvasVideoCredits", () => {
    const offenders: number[] = [];
    createSites().forEach((line) => {
      const from = Math.max(0, line - 220);
      const seg = LINES.slice(from, line);
      const acquireAt = seg.findIndex((l) => GUARD_CALL.test(l));
      const chargeAt = seg.findIndex((l) => /chargeCanvasVideoCredits\s*\(/.test(l));
      if (acquireAt < 0) return; // 由上一条用例负责报出
      if (chargeAt >= 0 && chargeAt < acquireAt) offenders.push(line);
    });
    expect(offenders).toEqual([]);
  });

  it("建单必须复用裁决层预留的 taskId，不许现场新造", () => {
    const offenders: number[] = [];
    createSites().forEach((line) => {
      // 建单调用体内应出现 taskId: <来自意图记录的变量>
      const body = LINES.slice(line - 1, line + 40).join("\n");
      if (!/taskId:\s*[A-Za-z_$][\w$.]*/.test(body)) offenders.push(line);
    });
    expect(offenders).toEqual([]);
  });
});
