/**
 * 配乐任务入参（强 Schema，路由与 worker 共用一份）。
 *
 * 立此文件的原因：Suno 是**付费异步任务**，上一版在一次 tRPC 请求里同步轮询
 * 最多 6 分钟——请求中断或实例重启就丢了 task id，用户重按会**再建一单**，
 * 而且没有任务记录、没有提交幂等、没有成本与耗时留痕。
 *
 * 队列里的数据永远不可信：worker 拿到旧任务也要再 parse 一次
 * （后期工坊三轮审阅烧出来的通用铁律）。
 */
import { z } from "zod";

export const MANHUA_BGM_ACTION = "manhua_bgm_v55" as const;

export const manhuaBgmBriefSchema = z
  .object({
    model: z.literal("suno-v5.5-beta"),
    custom_mode: z.literal(true),
    instrumental: z.literal(true),
    style: z.string().min(1).max(1000),
    prompt: z.string().min(1).max(5000),
    title: z.string().min(1).max(80),
    duration: z.number().int().min(10).max(360),
    negative_tags: z.string().max(200),
    style_weight: z.number().min(0).max(1),
    weirdness_constraint: z.number().min(0).max(1),
  })
  .strict();

export const manhuaBgmJobParamsSchema = z
  .object({
    /**
     * 提交幂等号：客户端每次**确认生成**产生一个 UUID，同一次提交的重试复用它。
     * 网络抖动重发不该变成第二次付费。
     */
    billingRequestId: z.string().uuid(),
    brief: manhuaBgmBriefSchema,
  })
  .strict();

export type ManhuaBgmJobParams = z.infer<typeof manhuaBgmJobParamsSchema>;

export const manhuaBgmJobInputSchema = z
  .object({
    action: z.literal(MANHUA_BGM_ACTION),
    params: manhuaBgmJobParamsSchema,
  })
  .strict();

/** worker 产出：变体全留，成本与耗时留痕 */
export type ManhuaBgmJobOutput = {
  upstreamTaskId: string;
  variants: Array<{
    index: number;
    gcsUri: string;
    previewUrl: string;
    bytes: number;
  }>;
  elapsedMs: number;
  providerCost: { unit: "per_call"; calls: number };
};
