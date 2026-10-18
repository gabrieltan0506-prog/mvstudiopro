import {
  digitalHumanDraftSchema,
  digitalHumanSegmentDraftSchema,
  newDigitalHumanDraft,
  type DigitalHumanDraft,
} from "./digitalHumanStudio";

export function ensureDigitalHumanProject(
  draft: DigitalHumanDraft
): DigitalHumanDraft {
  if (draft.project) return draft;
  return {
    ...draft,
    project: {
      id: draft.id,
      title: "我的数字人影片",
      segments: [{ id: draft.id, title: "段落 1", chapter: "" }],
      postProdStorage: {},
    },
  };
}
export function digitalHumanProjectSegments(raw: DigitalHumanDraft) {
  const draft = ensureDigitalHumanProject(raw);
  return draft.project!.segments.map(segment => ({
    ...segment,
    draft:
      segment.id === draft.id
        ? digitalHumanSegmentDraftSchema.parse(draft)
        : segment.draft!,
  }));
}
export function switchDigitalHumanSegment(
  raw: DigitalHumanDraft,
  id: string
): DigitalHumanDraft {
  const draft = ensureDigitalHumanProject(raw);
  if (draft.id === id) return draft;
  const target = draft.project!.segments.find(segment => segment.id === id);
  if (!target?.draft) throw new Error("未找到目标段落，已保留当前稿件");
  return digitalHumanDraftSchema.parse({
    ...target.draft,
    project: {
      ...draft.project!,
      segments: draft.project!.segments.map(segment =>
        segment.id === id
          ? { ...segment, draft: undefined }
          : segment.id === draft.id
            ? { ...segment, draft: digitalHumanSegmentDraftSchema.parse(draft) }
            : segment
      ),
    },
  });
}
export function addDigitalHumanSegment(
  raw: DigitalHumanDraft,
  id: string,
  chapter = ""
): DigitalHumanDraft {
  const draft = ensureDigitalHumanProject(raw);
  if (draft.project!.segments.some(s => s.id === id))
    throw new Error("段落编号已存在");
  const next = newDigitalHumanDraft(draft.owner, id);
  // 仅沿用用户身份和画幅；台词、场景、导演、关键帧与生产回执从空稿开始。
  next.portrait = draft.portrait;
  next.originalPortraits = draft.originalPortraits;
  next.voiceId = draft.voiceId;
  next.aspectRatio = draft.aspectRatio;
  return switchDigitalHumanSegment(
    {
      ...draft,
      project: {
        ...draft.project!,
        segments: [
          ...draft.project!.segments,
          {
            id,
            title: `段落 ${draft.project!.segments.length + 1}`,
            chapter,
            draft: next,
          },
        ],
      },
    },
    id
  );
}
/** 异步回执回写发起段，不随当前选中段漂移。 */
export function updateDigitalHumanSegment(
  raw: DigitalHumanDraft,
  id: string,
  update: (draft: DigitalHumanDraft) => DigitalHumanDraft
): DigitalHumanDraft {
  if (raw.id === id) return digitalHumanDraftSchema.parse(update(raw));
  const segment = raw.project?.segments.find(s => s.id === id);
  if (!segment?.draft) throw new Error("原任务段落不存在，未覆盖当前段");
  const next = update(segment.draft);
  if (next.id !== id || next.owner !== raw.owner)
    throw new Error("任务段落身份发生变化");
  return digitalHumanDraftSchema.parse({
    ...raw,
    project: {
      ...raw.project!,
      segments: raw.project!.segments.map(s =>
        s.id === id
          ? { ...s, draft: digitalHumanSegmentDraftSchema.parse(next) }
          : s
      ),
    },
  });
}
export function digitalHumanSegmentOutputs(draft: DigitalHumanDraft) {
  return [
    ...draft.videos.flatMap((v, i) =>
      v.status === "succeeded" && v.source && !v.segment
        ? [{ id: v.requestId, source: v.source, label: `原片 · 版本 ${i + 1}` }]
        : []
    ),
    ...draft.productions.flatMap((p, i) =>
      p.status === "succeeded" &&
      p.source &&
      p.request.input.action === "digital_human_final"
        ? [
            {
              id: p.request.requestId,
              source: p.source,
              label: `混音成片 · 版本 ${i + 1}`,
            },
          ]
        : []
    ),
  ];
}
