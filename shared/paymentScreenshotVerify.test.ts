import { describe, expect, it } from "vitest";
import {
  buildPaymentOrderNo,
  decidePaymentScreenshot,
  isPaymentOrderNo,
  PAYMENT_SCREENSHOT_AUTO_CAP_CNY,
  type PaymentScreenshotExtract,
} from "./paymentScreenshotVerify.js";

const ORDER_AT = Date.parse("2026-08-06T08:00:00Z");
const NOW = Date.parse("2026-08-06T08:03:00Z");

function extract(over: Partial<PaymentScreenshotExtract> = {}): PaymentScreenshotExtract {
  return {
    amountCny: 219,
    payee: "上海德智熙人工智能科技有限公司",
    paidAtIso: "2026-08-06T08:02:00Z",
    txnId: "4200002xxxx",
    appGuess: "wechat",
    confidence: 0.92,
    note: "微信支付成功页",
    ...over,
  };
}

function decide(over: Partial<PaymentScreenshotExtract> = {}, opts: { duplicate?: boolean; expected?: number } = {}) {
  return decidePaymentScreenshot({
    extract: extract(over),
    expectedAmountCny: opts.expected ?? 219,
    orderCreatedAtMs: ORDER_AT,
    nowMs: NOW,
    duplicate: opts.duplicate ?? false,
  });
}

describe("decidePaymentScreenshot", () => {
  it("三项都对得上才自动到账", () => {
    const d = decide();
    expect(d.verdict).toBe("approved");
    expect(d.checks).toMatchObject({ amountMatch: true, payeeMatch: true, timeWindow: true });
  });

  it("同一张截图用第二次直接拒，不进人工队列", () => {
    const d = decide({}, { duplicate: true });
    expect(d.verdict).toBe("rejected");
    expect(d.reason).toContain("已用于其他订单");
  });

  it("金额差一分就不自动放行", () => {
    expect(decide({ amountCny: 218.98 }).verdict).toBe("review");
    expect(decide({ amountCny: 39 }).verdict).toBe("review");
  });

  it("收款方不是我们公司就转人工（付给别人不算付给我们）", () => {
    const d = decide({ payee: "某某科技有限公司" });
    expect(d.verdict).toBe("review");
    expect(d.checks.payeeMatch).toBe(false);
  });

  it("收款方带空格或简称仍算命中", () => {
    expect(decide({ payee: "上海 德智熙 人工智能" }).verdict).toBe("approved");
    expect(decide({ payee: "德智熙" }).verdict).toBe("approved");
  });

  it("拿一张昨天的旧截图来蒙不放行", () => {
    const d = decide({ paidAtIso: "2026-08-05T08:02:00Z" });
    expect(d.verdict).toBe("review");
    expect(d.checks.timeWindow).toBe(false);
  });

  it("下单前半小时内付的款算有效（先付款后回页面提交是常见顺序）", () => {
    expect(decide({ paidAtIso: "2026-08-06T07:35:00Z" }).verdict).toBe("approved");
  });

  it("识别信心不足转人工", () => {
    expect(decide({ confidence: 0.4 }).verdict).toBe("review");
  });

  it("读不到金额或时间时不猜，转人工", () => {
    expect(decide({ amountCny: null }).verdict).toBe("review");
    expect(decide({ paidAtIso: null }).verdict).toBe("review");
  });

  it("大额单一律转人工，哪怕每一项都对", () => {
    const big = 4022;
    const d = decidePaymentScreenshot({
      extract: extract({ amountCny: big }),
      expectedAmountCny: big,
      orderCreatedAtMs: ORDER_AT,
      nowMs: NOW,
      duplicate: false,
    });
    expect(big).toBeGreaterThan(PAYMENT_SCREENSHOT_AUTO_CAP_CNY);
    expect(d.verdict).toBe("review");
    expect(d.checks.underAutoCap).toBe(false);
  });
});

describe("buildPaymentOrderNo", () => {
  it("收款编号带日期，便于对账时按天翻", () => {
    const no = buildPaymentOrderNo(Date.parse("2026-08-06T08:00:00Z"), "a1b2c3");
    expect(no).toBe("MV-20260806-A1B2C3");
    expect(isPaymentOrderNo(no)).toBe(true);
  });

  it("认不出格式的编号不当收款编号用", () => {
    expect(isPaymentOrderNo("PAY-123")).toBe(false);
    expect(isPaymentOrderNo(null)).toBe(false);
  });
});
