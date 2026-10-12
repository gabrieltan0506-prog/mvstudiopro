import { z } from "zod";

export const REMIX_WORKSPACE_URL = "/creator-growth-camp/premium-remix";
export const remixDraftSchema = z.object({
  version: z.literal(1),
  format: z.enum(["video", "note"]),
  title: z.string(),
  brief: z.string(),
  sourceSummary: z.string(),
  body: z.string(),
  units: z
    .array(
      z.object({
        id: z.string().min(1),
        source: z.string(),
        content: z.string(),
        decision: z.enum(["keep", "replace", "rework"]),
        durationSeconds: z.number().finite().positive().nullable(),
        sound: z.string(),
      })
    )
    .refine(
      rows => new Set(rows.map(r => r.id)).size === rows.length,
      "镜头或页面标识重复"
    ),
});
export type RemixDraft = z.infer<typeof remixDraftSchema>;
export type RemixEvidence = {
  summary?: string;
  titleSuggestions?: string[];
  keyFrames?: Array<{ timestamp: string; whatShows: string }>;
  remixExecution?: {
    emotionalPacing?: string;
    shootingBlueprint?: { storyboard?: string[] };
    imageTextNoteGuide?: {
      coverSetup?: string;
      titleOptions?: string[];
      structuredBody?: string;
    };
  };
};

/** 只按明确页标题拆页；没有页边界时不把整篇正文伪装成单页。 */
export function explicitNotePages(body: string): string[] {
  const markers = Array.from(
    body.matchAll(
      /^#{1,6}\s*(?:第\s*[0-9一二三四五六七八九十]+\s*页|页面\s*\d+|Page\s*\d+)[^\n]*$/gim
    )
  );
  return markers.map((marker, i) =>
    body
      .slice(marker.index, markers[i + 1]?.index ?? body.length)
      .split(/^#{1,6}\s*发布正文.*$/m)[0]
      .trim()
  );
}

export function draftFromEvidence(
  evidence: RemixEvidence,
  format: RemixDraft["format"],
  brief: string
): RemixDraft {
  const note = evidence.remixExecution?.imageTextNoteGuide;
  // 保留所有分析条目，不从序号或自然语言猜测精确秒位。
  const source =
    format === "video"
      ? evidence.remixExecution?.shootingBlueprint?.storyboard?.length
        ? evidence.remixExecution.shootingBlueprint.storyboard
        : (evidence.keyFrames || []).map(f => `${f.timestamp} · ${f.whatShows}`)
      : [
          note?.coverSetup,
          ...explicitNotePages(note?.structuredBody || ""),
        ].filter((v): v is string => Boolean(v?.trim()));
  return remixDraftSchema.parse({
    version: 1,
    format,
    title:
      (format === "note"
        ? note?.titleOptions?.[0]
        : evidence.titleSuggestions?.[0]) || "",
    brief,
    sourceSummary: evidence.summary || "",
    body: format === "note" ? note?.structuredBody || "" : "",
    units: source.map((text, i) => ({
      id: `source-${i + 1}`,
      source: text,
      content: text,
      decision: "replace",
      durationSeconds: null,
      sound: "",
    })),
  });
}

export function exportRemixMarkdown(input: RemixDraft): string {
  const draft = remixDraftSchema.parse(input);
  const decisions = {
    keep: "沿用结构",
    replace: "替换内容",
    rework: "重新设计",
  };
  return [
    `# ${draft.title || (draft.format === "video" ? "视频复刻稿" : "笔记复刻稿")}`,
    "状态：编辑草稿；尚未生成或验收媒体。",
    `## 创作要求\n${draft.brief}`,
    `## 参考分析\n${draft.sourceSummary}`,
    ...draft.units.map((unit, i) =>
      [
        `## ${draft.format === "video" ? "镜头" : "页面"} ${i + 1} · ${decisions[unit.decision]}`,
        draft.format === "video"
          ? `时长：${unit.durationSeconds === null ? "待编排（不自动均分）" : `${unit.durationSeconds}秒`}`
          : "",
        `参考依据：\n${unit.source}`,
        `本次内容：\n${unit.content}`,
        draft.format === "video" && unit.sound
          ? `对白/音乐/音效：\n${unit.sound}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    ),
    draft.format === "note" ? `## 发布正文\n${draft.body}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** 插件交接不伪造素材ID，不把方案当可执行媒体时间线。 */
export function exportRemixPackage(draft: RemixDraft) {
  const parsed = remixDraftSchema.parse(draft);
  return {
    kind: "mvsp-remix-editorial-handoff",
    version: 1,
    draft: parsed,
    markdown: exportRemixMarkdown(parsed),
    mediaGenerated: false,
    timelineCreated: false,
    nextStep:
      parsed.format === "video"
        ? "在ChatCut核对项目及真实素材，按本稿建立逐镜可编辑时间线；未定秒位先确认，不自动生成、付费或导出。"
        : "使用本稿的逐页内容与发布正文，确认实际版式和素材后逐页制作；不将整篇正文塞进单页。",
  };
}

export function buildRemixRewriteInput(draft: RemixDraft, unitId: string) {
  const row = draft.units.find(unit => unit.id === unitId);
  if (!row) throw new Error("镜头或页面已不存在");
  const sourceText = row.content.trim();
  if (sourceText.length < 10)
    throw new Error("请先写至少10个字的内容或载入拆解建议");
  if (sourceText.length > 32000)
    throw new Error(
      "这一项超过单次改写容量，请拆成多项后分别改写；完整草稿已保留"
    );
  if (!draft.brief.trim())
    throw new Error("请先说明本次替换的人物、主题或案例");
  const optimizationBrief = [
    draft.brief,
    draft.format === "video"
      ? "只改写当前一个镜头的动作、画面和对白；不新增固定镜数或把全片改成4镜8秒。不替用户编造事实。"
      : "只改写当前一页笔记，输出这页可直接使用的标题和正文；不输出视频分镜、BGM或全篇营销方案。不编造经历、数据与效果。",
    row.durationSeconds !== null && draft.format === "video"
      ? `当前镜头目标时长${row.durationSeconds}秒。`
      : "",
    "optimizedMarkdown只包含本次改写稿，其他建议放summary。参考资料只能用于结构借鉴，使用用户自己的内容。",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (optimizationBrief.length > 8000)
    throw new Error("创作要求超过单次容量，请精简本次要求；原稿未截断");
  return { sourceText, optimizationBrief, includeLiveTrends: false };
}
