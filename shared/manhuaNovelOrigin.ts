import { z } from "zod";
export const MANHUA_NOVEL_ORIGIN_KEY = "novel-origin-v1";
const schema = z.object({
  imports: z
    .array(
      z
        .object({
          requestId: z.string().uuid(),
          sha: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
    )
    .max(10000),
});
export type ManhuaNovelOrigin = z.infer<typeof schema>;
export function parseManhuaNovelOrigin(
  raw: unknown
): ManhuaNovelOrigin | undefined {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    const candidate = value?.imports
      ? value
      : value?.run
        ? {
            imports: [
              {
                requestId: value.run.input?.requestId,
                sha: value.run.result?.resultSha256,
              },
            ],
          }
        : value;
    const parsed = schema.safeParse(candidate);
    if (
      !parsed.success ||
      new Set(parsed.data.imports.map(i => i.requestId)).size !==
        parsed.data.imports.length
    )
      return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}
