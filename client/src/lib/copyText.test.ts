/**
 * copyText 单测。
 *
 * 核心断言：
 *  1. **失败必须返回 false**——P0-2 的根因就是复制失败被伪装成成功。
 *  2. **复制的是原文**——公共函数无权替调用方 trim 掉 SRT/Markdown/日志的首尾空白。
 *  3. **异常路径也必须清理**——临时 textarea 不许留在 DOM，用户原选区不许丢。
 *     （首版测试只断言了「抛异常返回 false」却没断言清理，是假绿，审查已点破。）
 *
 * 本仓 vitest 环境是 node（未装 jsdom，见 vitest.config.ts），
 * 所以这里用最小 DOM 桩覆盖 copyText 实际用到的那几个 API，不新增依赖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyText } from "./copyText";

type FakeNode = { parentNode: FakeBody | null };
type FakeTextarea = FakeNode & {
  tagName: string;
  value: string;
  style: { cssText: string };
  setAttribute: (k: string, v: string) => void;
  setSelectionRange: (a: number, b: number) => void;
  focus: (opts?: { preventScroll?: boolean }) => void;
  select: () => void;
};
type FakeBody = {
  appendChild: (el: FakeTextarea) => void;
  removeChild: (el: FakeTextarea) => void;
};

let appended: FakeTextarea[] = [];
let removed: FakeTextarea[] = [];
/** 选区还原轨迹：copyText 结束后应恰好等于进入前的 range 集合 */
let addedRanges: unknown[] = [];
let existingRanges: unknown[] = [];
let execCommandImpl: () => boolean;
let setSelectionRangeImpl: () => void;
let selectImpl: () => void;
/** 按调用顺序记录，用于断言 focus → range → select 的先后 */
let opLog: string[] = [];
/** 当前 activeElement（桩）；copyText 结束后应还原成进入前的那个 */
let activeElement: unknown = null;
/** 模拟页面上用户原本聚焦的元素 */
let originalActive: { tagName: string; focus: () => void } = {
  tagName: "INPUT",
  focus: () => {
    activeElement = originalActive;
    opLog.push("restore-focus");
  },
};

function installFakeDom() {
  appended = [];
  removed = [];
  addedRanges = [];
  existingRanges = [];
  opLog = [];
  originalActive = {
    tagName: "INPUT",
    focus: () => {
      activeElement = originalActive;
      opLog.push("restore-focus");
    },
  };
  activeElement = originalActive;

  const body: FakeBody = {
    appendChild: (el) => {
      appended.push(el);
      el.parentNode = body;
    },
    removeChild: (el) => {
      removed.push(el);
      el.parentNode = null;
    },
  };

  const doc = {
    createElement: (): FakeTextarea => {
      const el: FakeTextarea = {
        parentNode: null,
        tagName: "TEXTAREA",
        value: "",
        style: { cssText: "" },
        setAttribute: () => {},
        setSelectionRange: () => setSelectionRangeImpl(),
        focus: () => {
          activeElement = el;
          opLog.push("focus-textarea");
        },
        select: () => {
          opLog.push("select");
          selectImpl();
        },
      };
      return el;
    },
    createRange: () => ({
      selectNodeContents: () => {
        opLog.push("range");
      },
    }),
    body,
    execCommand: (cmd: string) => {
      opLog.push("execCommand");
      return cmd === "copy" ? execCommandImpl() : false;
    },
    get activeElement() {
      return activeElement;
    },
  };

  // copyText 用 `activeElement instanceof HTMLElement` 判定，node 环境需提供该构造器；
  // 让桩元素都通过该判定。
  class FakeHTMLElement {
    static [Symbol.hasInstance](v: unknown) {
      return typeof v === "object" && v !== null && "tagName" in (v as object);
    }
  }
  (globalThis as Record<string, unknown>).HTMLElement = FakeHTMLElement;
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).window = {
    getSelection: () => ({
      get rangeCount() {
        return existingRanges.length;
      },
      getRangeAt: (i: number) => existingRanges[i],
      removeAllRanges: () => {
        addedRanges = [];
      },
      addRange: (r: unknown) => {
        addedRanges.push(r);
      },
    }),
  };
}

function setClipboard(value: unknown) {
  // Node 的全局 navigator 是只读 getter，直接赋值会抛，必须 defineProperty 覆盖
  Object.defineProperty(globalThis, "navigator", {
    value: value === undefined ? {} : { clipboard: value },
    configurable: true,
    writable: true,
  });
}

/** 现代通道被拒 → 强制走降级通道 */
function forceFallback() {
  setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) });
}

describe("copyText", () => {
  beforeEach(() => {
    installFakeDom();
    execCommandImpl = () => false;
    setSelectionRangeImpl = () => {};
    selectImpl = () => {};
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).HTMLElement;
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).window;
    Reflect.deleteProperty(globalThis, "navigator");
    vi.restoreAllMocks();
  });

  describe("入参与返回值", () => {
    it("空文本 / 纯空白直接返回 false，不去碰剪贴板", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      setClipboard({ writeText });
      expect(await copyText("")).toBe(false);
      expect(await copyText("   ")).toBe(false);
      expect(await copyText("\n\t ")).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
    });

    it("现代通道成功时返回 true，且不走降级", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      setClipboard({ writeText });
      expect(await copyText("hello")).toBe(true);
      expect(writeText).toHaveBeenCalledWith("hello");
      expect(appended).toHaveLength(0);
    });

    it("两条通道都失败必须返回 false（绝不伪装成功）", async () => {
      forceFallback();
      execCommandImpl = () => false;
      expect(await copyText("nope")).toBe(false);
    });
  });

  describe("复制原文（不得擅自 trim）", () => {
    it("现代通道写入的是原文，首尾空白与换行一字不改", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      setClipboard({ writeText });
      const srt = "\n1\n00:00:01,000 --> 00:00:02,000\n台词\n\n";
      await copyText(srt);
      expect(writeText).toHaveBeenCalledWith(srt);
    });

    it("降级通道装进 textarea 的同样是原文", async () => {
      forceFallback();
      execCommandImpl = () => true;
      const md = "| 镜 | 台词 |\n|---|---|\n| 1 | 你好 |\n";
      expect(await copyText(md)).toBe(true);
      expect(appended[0]!.value).toBe(md);
    });

    it("首尾有空白但内容非空时照常复制，不返回 false", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      setClipboard({ writeText });
      expect(await copyText("  有内容  ")).toBe(true);
      expect(writeText).toHaveBeenCalledWith("  有内容  ");
    });
  });

  describe("降级通道", () => {
    it("现代通道被拒时降级到 execCommand，成功则返回 true", async () => {
      forceFallback();
      execCommandImpl = () => true;
      expect(await copyText("fallback")).toBe(true);
      expect(appended).toHaveLength(1);
    });

    it("浏览器没有 clipboard API 时也走降级", async () => {
      setClipboard(undefined);
      execCommandImpl = () => true;
      expect(await copyText("legacy")).toBe(true);
      expect(appended).toHaveLength(1);
    });
  });

  describe("清理：三条路径都不许留下临时节点", () => {
    it("降级成功后移除 textarea", async () => {
      forceFallback();
      execCommandImpl = () => true;
      await copyText("cleanup-ok");
      expect(removed).toEqual(appended);
      expect(appended[0]!.parentNode).toBeNull();
    });

    it("降级失败（execCommand 返回 false）后同样移除 textarea", async () => {
      forceFallback();
      execCommandImpl = () => false;
      await copyText("cleanup-false");
      expect(removed).toEqual(appended);
    });

    it("execCommand 抛异常时也必须移除 textarea（首版假绿点）", async () => {
      forceFallback();
      execCommandImpl = () => {
        throw new Error("execCommand blown up");
      };
      await expect(copyText("cleanup-throw")).resolves.toBe(false);
      expect(appended).toHaveLength(1);
      expect(removed).toEqual(appended);
      expect(appended[0]!.parentNode).toBeNull();
    });

    it("setSelectionRange 抛异常时也必须移除 textarea", async () => {
      forceFallback();
      setSelectionRangeImpl = () => {
        throw new Error("setSelectionRange blown up");
      };
      await expect(copyText("cleanup-throw-2")).resolves.toBe(false);
      expect(removed).toEqual(appended);
    });

    it("连续多次失败不会在 DOM 里堆积节点", async () => {
      forceFallback();
      execCommandImpl = () => {
        throw new Error("always broken");
      };
      await copyText("a");
      await copyText("b");
      await copyText("c");
      expect(appended).toHaveLength(3);
      expect(removed).toHaveLength(3);
      expect(appended.every((el) => el.parentNode === null)).toBe(true);
    });
  });

  describe("焦点与选中：execCommand 执行时必须有真实活动选区", () => {
    it("降级通道必须让 textarea 获得焦点并 select()", async () => {
      forceFallback();
      execCommandImpl = () => true;
      await copyText("focus-me");
      expect(opLog).toContain("focus-textarea");
      expect(opLog).toContain("select");
    });

    it("顺序必须是 focus → Range 兜底 → select（反了会把选区清成 0..0，真机实测）", async () => {
      forceFallback();
      execCommandImpl = () => true;
      await copyText("order-matters");
      const focusAt = opLog.indexOf("focus-textarea");
      const rangeAt = opLog.indexOf("range");
      const selectAt = opLog.indexOf("select");
      const execAt = opLog.indexOf("execCommand");
      expect(focusAt).toBeGreaterThanOrEqual(0);
      expect(focusAt).toBeLessThan(rangeAt);
      expect(rangeAt).toBeLessThan(selectAt);
      expect(selectAt).toBeLessThan(execAt);
    });

    it("复制结束后还原用户原本的焦点", async () => {
      forceFallback();
      execCommandImpl = () => true;
      await copyText("restore-focus-ok");
      expect(activeElement).toBe(originalActive);
    });

    it("execCommand 抛异常时同样还原焦点", async () => {
      forceFallback();
      execCommandImpl = () => {
        throw new Error("blown up");
      };
      await copyText("restore-focus-throw");
      expect(activeElement).toBe(originalActive);
    });

    it("select() 抛异常时返回 false，且焦点与节点都清理干净", async () => {
      forceFallback();
      selectImpl = () => {
        throw new Error("select blown up");
      };
      await expect(copyText("select-throw")).resolves.toBe(false);
      expect(removed).toEqual(appended);
      expect(activeElement).toBe(originalActive);
    });
  });

  describe("选区还原：不许弄丢用户选中的文字", () => {
    it("复制成功后还原用户原有选区", async () => {
      forceFallback();
      execCommandImpl = () => true;
      const userRange = { id: "user-selection" };
      existingRanges = [userRange];
      await copyText("restore-ok");
      expect(addedRanges).toEqual([userRange]);
    });

    it("多段选区全部还原，不是只还原第一段", async () => {
      forceFallback();
      execCommandImpl = () => true;
      const r1 = { id: "r1" };
      const r2 = { id: "r2" };
      const r3 = { id: "r3" };
      existingRanges = [r1, r2, r3];
      await copyText("restore-multi");
      expect(addedRanges).toEqual([r1, r2, r3]);
    });

    it("execCommand 抛异常时同样还原选区（首版假绿点）", async () => {
      forceFallback();
      const userRange = { id: "user-selection" };
      existingRanges = [userRange];
      execCommandImpl = () => {
        throw new Error("blown up");
      };
      await copyText("restore-throw");
      expect(addedRanges).toEqual([userRange]);
    });

    it("用户原本没有选区时，结束后也不该凭空多出选区", async () => {
      forceFallback();
      execCommandImpl = () => true;
      existingRanges = [];
      await copyText("no-selection");
      expect(addedRanges).toEqual([]);
    });
  });
});
