import { z } from "zod";

export const DIGITAL_HUMAN_OMNI_MODEL = "bytedance/omni-human-2.0";
export const digitalHumanOmniInputSchema = z
  .object({
    image: z.string().trim().min(1).max(4096),
    audio: z.string().trim().min(1).max(4096),
    prompt: z.string().trim().max(20000),
  })
  .strict();
export type DigitalHumanOmniInput = z.infer<typeof digitalHumanOmniInputSchema>;

/** 供应商费用与平台积分独立，报价不得当成已扣费回执。 */
export const digitalHumanOmniQuoteSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    durationSec: z.number().finite().min(4).max(300),
    priceUsd: z.number().finite().nonnegative(),
    discountedPriceUsd: z.number().finite().nonnegative(),
    quotedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type DigitalHumanOmniQuote = z.infer<typeof digitalHumanOmniQuoteSchema>;

export const digitalHumanOmniSubmitSchema = digitalHumanOmniInputSchema
  .extend({
    requestId: z.string().uuid(),
    quote: digitalHumanOmniQuoteSchema,
    confirmed: z.literal(true),
  })
  .strict();
