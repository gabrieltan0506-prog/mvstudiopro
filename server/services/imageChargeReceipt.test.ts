import { describe, expect, it } from "vitest";
import {
  claimCanvasRetryChargeWaiver,
  consumeImageChargeReceipt,
  issueImageChargeReceipt,
  type ReceiptDbOps,
} from "./imageChargeReceipt";

/** 模拟 stripe_usage_logs chargeKey 全局唯一索引的内存 ops */
function memOps(): ReceiptDbOps & { rows: Array<{ userId: number; chargeKey: string; createdAt: Date }> } {
  const rows: Array<{ userId: number; chargeKey: string; createdAt: Date }> = [];
  return {
    rows,
    async insertMarker(r) {
      if (rows.some((x) => x.chargeKey === r.chargeKey)) {
        throw new Error('duplicate key value violates unique constraint "stripe_usage_logs_charge_key_uniq"');
      }
      rows.push({ userId: r.userId, chargeKey: r.chargeKey, createdAt: new Date() });
    },
    async findIssued(userId, chargeKey) {
      const r = rows.find((x) => x.userId === userId && x.chargeKey === chargeKey);
      return r ? { createdAt: r.createdAt } : null;
    },
  };
}

describe("imageChargeReceipt · 一次性预扣收据(五审 P0-2)", () => {
  it("签发→首次消费成功;重放消费失败(唯一索引挡);并发双消费只有一腿成功", async () => {
    const ops = memOps();
    const receiptId = await issueImageChargeReceipt({ userId: 7, reason: "test", ops });
    expect(await consumeImageChargeReceipt({ userId: 7, receiptId, ops })).toBe(true);
    expect(await consumeImageChargeReceipt({ userId: 7, receiptId, ops })).toBe(false);

    const r2 = await issueImageChargeReceipt({ userId: 7, reason: "test2", ops });
    const both = await Promise.all([
      consumeImageChargeReceipt({ userId: 7, receiptId: r2, ops }),
      consumeImageChargeReceipt({ userId: 7, receiptId: r2, ops }),
    ]);
    expect(both.filter(Boolean).length).toBe(1);
  });

  it("收据不可转让:他人 userId 消费失败;伪造/畸形收据失败", async () => {
    const ops = memOps();
    const receiptId = await issueImageChargeReceipt({ userId: 7, reason: "t", ops });
    expect(await consumeImageChargeReceipt({ userId: 8, receiptId, ops })).toBe(false);
    expect(await consumeImageChargeReceipt({ userId: 7, receiptId: "not-a-receipt!", ops })).toBe(false);
    expect(
      await consumeImageChargeReceipt({ userId: 7, receiptId: "11111111-2222-3333-4444-555555555555", ops }),
    ).toBe(false);
    // 真收据仍可正常消费(上面失败没把它烧掉)
    expect(await consumeImageChargeReceipt({ userId: 7, receiptId, ops })).toBe(true);
  });

  it("重试免扣核销:每个首单只豁免一次,第二次重放失败", async () => {
    const ops = memOps();
    expect(await claimCanvasRetryChargeWaiver({ userId: 7, retryOfJobId: "job-1", ops })).toBe(true);
    expect(await claimCanvasRetryChargeWaiver({ userId: 7, retryOfJobId: "job-1", ops })).toBe(false);
    expect(await claimCanvasRetryChargeWaiver({ userId: 7, retryOfJobId: "job-2", ops })).toBe(true);
  });
});
