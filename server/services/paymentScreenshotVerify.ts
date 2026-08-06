/**
 * 付款截图识别：把图交给视觉模型，只要它把图上的字读出来，判定交给
 * `shared/paymentScreenshotVerify` 的死规则。
 *
 * 截图一律先落 GCS 存档再识别——事后要追款、要复盘误判、要应付争议，
 * 手里没有原图就只能靠嘴说。
 */
import { createHash } from "node:crypto";
import { extractJsonString, invokeLLM } from "../_core/llm.js";
import type { PaymentScreenshotExtract } from "../../shared/paymentScreenshotVerify.js";

/** 识别用的视觉模型：与漫剧关键帧识别同一条通道，已在生产验证过 */
const VISION_MODEL = "gpt-5.6-terra" as const;
/** 只是读几行字，不需要多想 */
const VISION_REASONING = "low" as const;
const VISION_MAX_TOKENS = 900;

/** 截图体积上限：手机截图正常都在 1MB 内，超了大概不是截图 */
export const PAYMENT_SCREENSHOT_MAX_BYTES = 8 * 1024 * 1024;

const SYSTEM = `你是收款凭证识别器。看图，把图上**确实写着**的信息读出来，只输出 JSON。

铁律：
1. 读不到的字段一律给 null，**禁止推断、禁止补全、禁止拿常识填空**。
2. 不要判断这笔钱该不该到账，那不是你的活；你只负责如实转录。
3. amountCny 只取付款金额数字（人民币元，小数保留两位，不要带货币符号）。
4. payee 取**收款方**名称原文（可能写作「收款方」「收款人」「商户名称」）；付款人不是收款方。
5. paidAtIso 把图上的付款时间转成 ISO 8601，**按东八区**（如 2026-08-06T16:02:00+08:00）；图上只有时分没有日期时，用 dateHint 补日期。
6. txnId 取支付平台的交易单号/订单号原文。
7. confidence 表示「这是一张真实支付成功页」的信心（0–1）。图片模糊、明显是二次编辑、像网页截图或对话截图、看不到成功标识时给低分。
8. note 用一句中文说明你看到的是什么页面。

输出：{"amountCny":number|null,"payee":string|null,"paidAtIso":string|null,"txnId":string|null,"appGuess":"wechat"|"alipay"|"unknown","confidence":number,"note":string}`;

export function hashScreenshot(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function coerceNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^\d.]/g, "");
    const n = Number(cleaned);
    if (Number.isFinite(n) && cleaned.length > 0) return n;
  }
  return null;
}

function coerceString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 && t.toLowerCase() !== "null" ? t : null;
}

export function parsePaymentScreenshotExtract(text: string): PaymentScreenshotExtract {
  const json = extractJsonString(text);
  const raw = JSON.parse(json) as Record<string, unknown>;
  const app = coerceString(raw.appGuess);
  const confidence = coerceNumber(raw.confidence);
  return {
    amountCny: coerceNumber(raw.amountCny),
    payee: coerceString(raw.payee),
    paidAtIso: coerceString(raw.paidAtIso),
    txnId: coerceString(raw.txnId),
    appGuess: app === "wechat" || app === "alipay" ? app : "unknown",
    // 读不出信心时按 0 处理：宁可转人工，不要因为解析失败白送积分
    confidence: confidence == null ? 0 : Math.max(0, Math.min(1, confidence)),
    note: coerceString(raw.note) ?? "",
  };
}

/**
 * 把截图交给视觉模型读字。
 *
 * @param dateHint 下单当天的日期（YYYY-MM-DD，东八区），给模型补「只有时分没有日期」的截图用
 */
export async function readPaymentScreenshot(params: {
  imageBase64: string;
  mimeType: string;
  dateHint: string;
}): Promise<PaymentScreenshotExtract> {
  const response = await invokeLLM({
    model: "pro",
    provider: "openai",
    modelName: VISION_MODEL,
    reasoningEffort: VISION_REASONING,
    max_tokens: VISION_MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: JSON.stringify({ dateHint: params.dateHint, timezone: "+08:00" }) },
          {
            type: "image_url",
            image_url: { url: `data:${params.mimeType};base64,${params.imageBase64}` },
          },
        ],
      },
    ],
  });
  const text =
    typeof response.choices?.[0]?.message?.content === "string"
      ? response.choices[0].message.content
      : JSON.stringify(response.choices?.[0]?.message?.content ?? "");
  return parsePaymentScreenshotExtract(text);
}

/** 存档到 GCS；失败不阻断核销流程，但要在日志里留痕 */
export async function archivePaymentScreenshot(params: {
  buf: Buffer;
  mimeType: string;
  orderNo: string;
}): Promise<string | null> {
  try {
    const { uploadBufferToGcs } = await import("./gcs.js");
    const ext = params.mimeType.includes("png") ? "png" : "jpg";
    const { gcsUri } = await uploadBufferToGcs({
      objectName: `payment-proof/${params.orderNo}.${ext}`,
      buffer: params.buf,
      contentType: params.mimeType,
    });
    return gcsUri;
  } catch (err) {
    console.error("[paymentScreenshot] 存档失败", { orderNo: params.orderNo, err });
    return null;
  }
}
