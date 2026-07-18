import { describe, expect, it } from "vitest";

/**
 * 与 server/routers normalizePlatformContentKeys / client renderSafeText 对齐的安全抽字串回归。
 * 防止 LLM 嵌套对象被 String(obj) 写成 [object Object] 进入文案。
 */
function safeScalar(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") {
    const t = v.trim();
    return t === "[object Object]" ? "" : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of [
      "title",
      "text",
      "content",
      "name",
      "desc",
      "description",
      "detail",
      "action",
      "label",
      "value",
      "step",
    ]) {
      if (typeof o[k] === "string" && String(o[k]).trim() && String(o[k]).trim() !== "[object Object]") {
        return String(o[k]);
      }
    }
    const nested = Object.values(o).find(
      (x) => typeof x === "string" && String(x).trim() && String(x).trim() !== "[object Object]",
    );
    if (typeof nested === "string") return nested;
  }
  return "";
}

function safeStringList(arr: unknown[]): string[] {
  return arr.map((x) => safeScalar(x).trim()).filter((s) => s && s !== "[object Object]");
}

describe("platform content safe text", () => {
  it("does not stringify nested objects to [object Object]", () => {
    expect(safeScalar({ title: "真实标题", nested: { a: 1 } })).toBe("真实标题");
    expect(safeScalar({ detail: "执行细节" })).toBe("执行细节");
    expect(safeScalar({ foo: { bar: 1 } })).toBe("");
    expect(safeScalar("[object Object]")).toBe("");
  });

  it("normalizes actionableSteps / step lists", () => {
    const steps = safeStringList([
      "第一步",
      { step: "第二步" },
      { title: { bad: true } },
      "[object Object]",
    ]);
    expect(steps).toEqual(["第一步", "第二步"]);
  });
});
