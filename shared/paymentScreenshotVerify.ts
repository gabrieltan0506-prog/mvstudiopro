/**
 * 付款截图自动核销的判定规则。
 *
 * 分工是刻意的：**模型只做识别，判定全在这里**。让模型直接回「这张截图真不真」
 * 等于把发钱的权限交给一个可以被话术绕过的东西；它只负责把图上的金额、时间、
 * 收款方、交易单号读出来，够不够格自动到账由下面这些死规则说话。
 *
 * 静态收款码没有支付平台回调，所以截图**不能证明钱到账**，它只是「用户声称已付」
 * 的强证据。因此自动通过的口子必须卡死：金额分毫不差、收款方对得上、时间落在
 * 下单后的窗口内、同一张图不能用两次、大额一律转人工。
 */

/** 模型从截图里读出来的字段（读不到就给 null，不要瞎猜） */
export type PaymentScreenshotExtract = {
  /** 付款金额（人民币元） */
  amountCny: number | null;
  /** 收款方名称，可能是公司全称或简称 */
  payee: string | null;
  /** 付款时间（ISO 8601，带时区） */
  paidAtIso: string | null;
  /** 支付平台的交易单号 / 订单号，用于事后对账 */
  txnId: string | null;
  /** 截图看起来来自哪个 App */
  appGuess: "wechat" | "alipay" | "unknown";
  /** 模型对「这是一张真实的支付成功页」的信心（0–1） */
  confidence: number;
  /** 模型的一句话说明（进日志与人工队列，不给用户看原文） */
  note: string;
};

export type PaymentScreenshotVerdict = "approved" | "review" | "rejected";

export type PaymentScreenshotDecision = {
  verdict: PaymentScreenshotVerdict;
  /** 给管理员看的判定依据（中文短句） */
  reason: string;
  /** 逐项检查结果，进数据库便于事后复盘 */
  checks: {
    duplicate: boolean;
    amountMatch: boolean;
    payeeMatch: boolean;
    timeWindow: boolean;
    confidenceOk: boolean;
    underAutoCap: boolean;
  };
};

/**
 * 自动到账的单笔上限。
 *
 * 三档月付最贵是专业包 ¥419，所以按 ¥500 划线：常规单能自动到账，
 * 季付年付那种四位数大单一律转人工——那种金额值得花两分钟亲自看一眼。
 */
export const PAYMENT_SCREENSHOT_AUTO_CAP_CNY = 500;

/** 模型信心低于此值不自动放行 */
export const PAYMENT_SCREENSHOT_MIN_CONFIDENCE = 0.75;

/** 付款时间允许比下单时间早多少（用户先付款后回页面提交是常见顺序） */
const PAID_BEFORE_ORDER_TOLERANCE_MS = 30 * 60 * 1000;
/** 付款时间允许比当前时间晚多少（容忍手机时钟偏差） */
const PAID_AFTER_NOW_TOLERANCE_MS = 5 * 60 * 1000;

/** 收款主体关键词：截图里的收款方必须命中其中一个 */
export const PAYMENT_PAYEE_KEYWORDS = ["德智熙", "上海德智熙", "德智熙人工智能"] as const;

function payeeHit(payee: string | null, keywords: readonly string[]): boolean {
  if (!payee) return false;
  const flat = payee.replace(/\s+/g, "");
  return keywords.some((k) => flat.includes(k));
}

export function decidePaymentScreenshot(params: {
  extract: PaymentScreenshotExtract;
  expectedAmountCny: number;
  orderCreatedAtMs: number;
  nowMs: number;
  /** 同一张图（哈希相同）此前是否已用过 */
  duplicate: boolean;
  autoCapCny?: number;
  payeeKeywords?: readonly string[];
}): PaymentScreenshotDecision {
  const autoCap = params.autoCapCny ?? PAYMENT_SCREENSHOT_AUTO_CAP_CNY;
  const amount = Number(params.extract.amountCny);
  const amountMatch = Number.isFinite(amount) && Math.abs(amount - params.expectedAmountCny) <= 0.01;
  const payeeMatch = payeeHit(params.extract.payee, params.payeeKeywords ?? PAYMENT_PAYEE_KEYWORDS);

  const paidAtMs = params.extract.paidAtIso ? Date.parse(params.extract.paidAtIso) : NaN;
  const timeWindow =
    Number.isFinite(paidAtMs) &&
    paidAtMs >= params.orderCreatedAtMs - PAID_BEFORE_ORDER_TOLERANCE_MS &&
    paidAtMs <= params.nowMs + PAID_AFTER_NOW_TOLERANCE_MS;

  const confidenceOk = Number(params.extract.confidence) >= PAYMENT_SCREENSHOT_MIN_CONFIDENCE;
  const underAutoCap = params.expectedAmountCny <= autoCap;

  const checks = {
    duplicate: params.duplicate,
    amountMatch,
    payeeMatch,
    timeWindow,
    confidenceOk,
    underAutoCap,
  };

  // 同图复用是唯一直接拒的情形：这不是识别不清，是明确的重复提交
  if (params.duplicate) {
    return { verdict: "rejected", reason: "这张截图此前已用于其他订单", checks };
  }

  const failures: string[] = [];
  if (!amountMatch) failures.push(`金额对不上（读到 ${params.extract.amountCny ?? "?"}，应为 ${params.expectedAmountCny}）`);
  if (!payeeMatch) failures.push(`收款方对不上（读到「${params.extract.payee ?? "空"}」）`);
  if (!timeWindow) failures.push(`付款时间不在下单窗口内（读到 ${params.extract.paidAtIso ?? "空"}）`);
  if (!confidenceOk) failures.push(`识别信心不足（${params.extract.confidence}）`);
  if (!underAutoCap) failures.push(`金额超过自动到账上限 ¥${autoCap}`);

  if (failures.length === 0) {
    return { verdict: "approved", reason: "金额、收款方、时间三项均对得上，已自动到账", checks };
  }
  return { verdict: "review", reason: `转人工：${failures.join("；")}`, checks };
}

/** 收款编号：给用户看的那串，也是我们对账的主键 */
export function buildPaymentOrderNo(nowMs: number, rand: string): string {
  const d = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  return `MV-${stamp}-${rand.toUpperCase()}`;
}

export function isPaymentOrderNo(raw: unknown): raw is string {
  return typeof raw === "string" && /^MV-\d{8}-[A-Z0-9]{6,10}$/.test(raw);
}
