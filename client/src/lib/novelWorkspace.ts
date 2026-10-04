import { z } from "zod";
import {
  parseNovelDraft,
  type ManhuaNovelDraft,
} from "@shared/manhuaNovelSource";
import {
  novelTestInputSchema,
  novelModelSchema,
  novelGenerationSettingsSchema,
  type NovelTestInput,
  type NovelTestResult,
} from "@shared/novelWorkspace";
const runSchema = z.object({
  input: novelTestInputSchema,
  result: z.object({
    model: z.string().optional(),
    settings: novelGenerationSettingsSchema.optional(),
    requestId: z.string(),
    stage: z.enum(["advice", "outline", "chapter", "script"]),
    text: z.string(),
    templateIds: z.array(z.string()),
    inputSha256: z.string(),
    resultSha256: z.string(),
  }),
});
const stateSchema = z.object({
  roundId: z.string().uuid(),
  topic: z.string(),
  direction: z.string(),
  advisorDraft: z.string().max(2000).optional(),
  modelPreference: novelModelSchema.optional(),
  advisorAnchor: z.string().optional(),
  mode: z.enum(["source", "original"]),
  source: z.unknown(),
  templates: z.array(
    z.object({
      publicId: z.string(),
      role: z.string(),
      weight: z.number().int().min(0).max(100).optional(),
    })
  ),
  episodeCount: z.union([z.literal(2), z.literal(3)]),
  outline: z.string(),
  outlineApproved: z.string(),
  chapters: z.array(z.string()),
  novelApproved: z.string(),
  runs: z.array(runSchema),
  pending: novelTestInputSchema.optional(),
});
export type NovelWorkspace = Omit<z.infer<typeof stateSchema>, "source"> & {
  source: ManhuaNovelDraft | null;
};
export type NovelRun = { input: NovelTestInput; result: NovelTestResult };
export const novelWorkspaceKey = (userId: string) =>
  `mv-novel-lab-v2:${encodeURIComponent(userId)}`;
export const emptyNovelWorkspace = (): NovelWorkspace => ({
  roundId: crypto.randomUUID(),
  topic: "",
  direction: "",
  mode: "source",
  source: null,
  templates: [],
  episodeCount: 3,
  outline: "",
  outlineApproved: "",
  chapters: [],
  novelApproved: "",
  runs: [],
});
export function readNovelWorkspace(
  storage: Pick<Storage, "getItem">,
  userId: string
) {
  const raw = storage.getItem(novelWorkspaceKey(userId));
  if (!raw) return { raw, value: emptyNovelWorkspace() };
  const value = stateSchema.parse(JSON.parse(raw));
  const source = value.source === null ? null : parseNovelDraft(value.source);
  if (value.source !== null && !source) throw new Error("底本无法读取");
  return { raw, value: { ...value, source } };
}
export function saveNovelWorkspace(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  previous: string | null,
  value: NovelWorkspace
) {
  const key = novelWorkspaceKey(userId);
  if (storage.getItem(key) !== previous)
    throw new Error("另一页面已更新，请下载当前备份再刷新。");
  const raw = JSON.stringify(value);
  storage.setItem(key, raw);
  return raw;
}
export function archiveNovelRound(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  previous: string | null,
  value: NovelWorkspace
) {
  const key = novelWorkspaceKey(userId);
  if (storage.getItem(key) !== previous)
    throw new Error("另一页面已更新，请下载当前备份再刷新。");
  storage.setItem(`${key}:archive:${value.roundId}`, JSON.stringify(value));
  const next = emptyNovelWorkspace();
  const raw = saveNovelWorkspace(storage, userId, previous, next);
  return { raw, value: next };
}
export function downloadNovelText(
  name: string,
  text: string,
  type = "text/plain;charset=utf-8"
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function novelSourceIdentity(draft: NovelWorkspace) {
  return JSON.stringify([
    draft.topic,
    draft.direction,
    draft.mode,
    draft.mode === "source" ? draft.source : null,
    draft.episodeCount,
  ]);
}
export function scriptBaseline(input: NovelTestInput) {
  return JSON.stringify([
    input.roundId,
    input.topic,
    input.direction,
    input.source,
    input.outline,
    input.novel,
    input.episodeCount,
  ]);
}
