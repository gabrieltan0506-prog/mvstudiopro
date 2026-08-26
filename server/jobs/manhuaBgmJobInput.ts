/**
 * 漫剧配乐异步任务契约。
 *
 * 这是付费异步任务，路由与 worker 必须共用同一份强 Schema：
 * - `billingRequestId` 防同一次确认因网络重发重复建单；
 * - `briefDigest` 绑定这次确认的真实内容，防编号被复用后静默返回旧曲；
 * - worker 对数据库里的旧任务也重新 parse，不能信任队列数据。
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { BgmStructure } from "../../shared/manhuaBeatTable.js";

export const MANHUA_BGM_ACTION = "manhua_bgm_v55" as const;
export const MANHUA_BGM_BRIEF_DIGEST_RE = /^[a-f0-9]{64}$/;

export const manhuaBgmBriefSchema = z
  .object({
    model: z.literal("suno-v5.5-beta"),
    custom_mode: z.literal(true),
    instrumental: z.literal(true),
    style: z.string().trim().min(1).max(1000),
    prompt: z.string().trim().min(1).max(5000),
    title: z.string().trim().min(1).max(80),
    duration: z.number().int().min(10).max(360),
    negative_tags: z.string().max(200),
    style_weight: z
      .number()
      .min(0)
      .max(1)
      .refine(
        value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
        {
          message: "style_weight 必须按 0.01 递增",
        }
      ),
    weirdness_constraint: z
      .number()
      .min(0)
      .max(1)
      .refine(
        value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
        {
          message: "weirdness_constraint 必须按 0.01 递增",
        }
      ),
  })
  .strict();

export type ManhuaBgmBriefPayload = z.infer<typeof manhuaBgmBriefSchema>;

/** 递归排序对象键，保证同内容不因属性插入顺序不同而得到不同摘要。 */
export function stableManhuaBgmJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableManhuaBgmJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) => `${JSON.stringify(key)}:${stableManhuaBgmJson(item)}`
      )
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/** 摘要只对 Schema 归一后的 brief 计算，额外字段不能偷偷进入幂等语义。 */
export function digestManhuaBgmBrief(brief: unknown): string {
  const normalized = manhuaBgmBriefSchema.parse(brief);
  return createHash("sha256")
    .update(stableManhuaBgmJson(normalized), "utf8")
    .digest("hex");
}

const manhuaBgmJobParamsBaseSchema = z
  .object({
    billingRequestId: z.string().uuid(),
    brief: manhuaBgmBriefSchema,
    /**
     * 新任务持久化该值；旧任务没有时 parse 会按 brief 补出。
     * 若调用方显式传了错误摘要则拒收，不能把摘要降级成装饰字段。
     */
    briefDigest: z.string().regex(MANHUA_BGM_BRIEF_DIGEST_RE).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.briefDigest &&
      value.briefDigest !== digestManhuaBgmBrief(value.brief)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["briefDigest"],
        message: "配乐内容摘要与 brief 不一致",
      });
    }
  });

export const manhuaBgmJobParamsSchema = manhuaBgmJobParamsBaseSchema.transform(
  value => ({
    ...value,
    briefDigest: value.briefDigest ?? digestManhuaBgmBrief(value.brief),
  })
);

export type ManhuaBgmJobParams = z.output<typeof manhuaBgmJobParamsSchema>;

export const manhuaBgmJobInputSchema = z
  .object({
    action: z.literal(MANHUA_BGM_ACTION),
    params: manhuaBgmJobParamsSchema,
  })
  .strict();

export type ManhuaBgmJobInput = z.output<typeof manhuaBgmJobInputSchema>;

export function buildManhuaBgmJobInput(input: {
  billingRequestId: string;
  brief: unknown;
}): ManhuaBgmJobInput {
  return manhuaBgmJobInputSchema.parse({
    action: MANHUA_BGM_ACTION,
    params: input,
  });
}

/**
 * 主键冲突时只允许复用「同一次确认 + 同一份内容」。
 * 所有权与任务类型仍由 repository/router 另行核对。
 */
export function isSameManhuaBgmSubmission(
  existingInput: unknown,
  requestedInput: unknown
): boolean {
  const existing = manhuaBgmJobInputSchema.safeParse(existingInput);
  const requested = manhuaBgmJobInputSchema.safeParse(requestedInput);
  return Boolean(
    existing.success &&
      requested.success &&
      existing.data.params.billingRequestId ===
        requested.data.params.billingRequestId &&
      existing.data.params.briefDigest === requested.data.params.briefDigest
  );
}

/** 对外保持 job 语义名，结构真源仍是共享卡点表。 */
export type ManhuaBgmStructure = BgmStructure;

/** worker 终态：只持久化 GCS 真源；试听签名地址查询时可以重新签发。 */
export type ManhuaBgmJobOutput = {
  upstreamTaskId: string;
  briefDigest: string;
  variants: Array<{
    index: number;
    gcsUri: string;
    previewUrl: string;
    bytes: number;
    structure: ManhuaBgmStructure | null;
  }>;
  elapsedMs: number;
  providerCost: { unit: "per_call"; calls: 1 };
};
