import { z } from "zod";
import { digitalHumanDraftSchema } from "./digitalHumanStudio";

export const DIGITAL_HUMAN_BACKUP_INTERVAL_MS = 10 * 60 * 1000;
export const digitalHumanBackupIdSchema = z
  .string()
  .regex(/^\d{13}-[a-f0-9]{32}$/);
const generation = z.string().regex(/^\d+$/);
export const digitalHumanBackupSchema = z
  .object({
    format: z.literal("digital-human-backup-v1"),
    id: digitalHumanBackupIdSchema,
    owner: z.number().int().positive(),
    createdAt: z.string(),
    draft: digitalHumanDraftSchema,
    sourceGeneration: generation,
    reason: z.enum(["automatic", "manual", "before-restore", "local-copy"]),
    assets: z.array(
      z
        .object({
          source: z.string(),
          resolvedSource: z.string().startsWith("gs://").optional(),
          generation: generation.optional(),
          bytes: z.number().nonnegative().optional(),
          crc32c: z.string().optional(),
          backup: z.string().startsWith("gs://").optional(),
          backupGeneration: generation.optional(),
          rewriteToken: z.string().optional(),
          error: z.string().optional(),
        })
        .strict()
    ),
    // 只保存服务端按本人任务编号读到的视图，客户端不能据此授权访问其他资产。
    resources: z
      .array(
        z.object({
          kind: z.enum(["world", "model"]),
          taskId: z.string(),
          view: z.record(z.string(), z.unknown()),
        })
      )
      .default([]),
    status: z.enum(["pending", "complete"]),
    discoveryComplete: z.boolean().default(false),
    nextAsset: z.number().int().nonnegative().default(0),
    error: z.string().optional(),
  })
  .strict();
export type DigitalHumanBackup = z.infer<typeof digitalHumanBackupSchema>;
export type DigitalHumanBackupSummary = Pick<
  DigitalHumanBackup,
  "id" | "createdAt" | "status" | "reason"
> & {
  title: string;
  assetCount: number;
  savedAssets: number;
  error?: string;
};

/** 仅收集媒体字段和结构化缓存，不把提示词中的链接当作素材。所有权另由服务端核实。 */
export function collectDigitalHumanBackupSources(value: unknown): string[] {
  const sources = new Set<string>();
  const isSource = (v: string) =>
    /^(gs:\/\/|https:\/\/|\/api\/canvas-media\/)/.test(v);
  const mediaKey = (key: string) =>
    /^(source|selectedSource|inputSource|sourceVersion|portraitSource|audioSource)$/.test(
      key
    ) ||
    /(?:Url|Uri|URL)$/.test(key) ||
    /^(url|gcsUri)$/.test(key);
  const arrayKey = (key: string) =>
    /^(clips|sources|images|references|.*(?:Urls|Uris))$/.test(key);
  const visit = (node: unknown, depth: number, parentKey = "") => {
    if (depth > 60) throw new Error("制作稿嵌套过深，未截断备份");
    if (Array.isArray(node)) {
      node.forEach(v =>
        typeof v === "string" && arrayKey(parentKey) && isSource(v)
          ? sources.add(v)
          : visit(v, depth + 1)
      );
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, item] of Object.entries(node)) {
      if (typeof item === "string") {
        if (mediaKey(key) && isSource(item)) sources.add(item);
        if (
          (parentKey === "postProdStorage" || parentKey === "advisorStorage") &&
          /^[\[{]/.test(item)
        ) {
          try {
            visit(JSON.parse(item), depth + 1);
          } catch (e) {
            throw new Error("素材恢复记录无法解析，未标记完整备份");
          }
        }
      } else visit(item, depth + 1, key);
    }
  };
  visit(value, 0);
  return Array.from(sources);
}
