import { parseTemplateMethodBrief } from "../../shared/manhuaTemplateMethodBrief";
import { createHash } from "node:crypto";
import type {
  ManhuaViralTemplateCard,
  ManhuaTemplateMethodBrief,
} from "../../shared/manhuaViralTemplateBank";
import briefs from "./manhuaTemplateMethodBriefs.json";

export function methodEvidenceHash(card: ManhuaViralTemplateCard) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        methods: card.reusableZh || "",
        sound: card.audioStory?.reusableAudioZh || "",
        structure: card.storyStructure || null,
        classification: card.classification || null,
      })
    )
    .digest("hex");
}
/** Human-written anonymous guidance is only valid for the reviewed learning evidence. */
export function buildManhuaTemplateMethodBrief(
  card: ManhuaViralTemplateCard
): ManhuaTemplateMethodBrief | undefined {
  if (card.status !== "approved") return undefined;
  const dynamic = parseTemplateMethodBrief(card.publicMethodBrief);
  if (dynamic && card.methodBriefEvidenceSha256 === methodEvidenceHash(card))
    return dynamic;
  const row = (
    briefs as Record<
      string,
      { sha256: string; brief: ManhuaTemplateMethodBrief }
    >
  )[String(card.publicCode || "").toUpperCase()];
  if (
    card.status !== "approved" ||
    !row ||
    row.sha256 !== methodEvidenceHash(card)
  )
    return undefined;
  return {
    title: row.brief.title,
    highlights: [...row.brief.highlights],
    useWhen: row.brief.useWhen,
  };
}

/** Bind a newly learned brief to the exact card before persistence; never rebind stale stored copy. */
export function attachLearnedMethodBrief(
  card: ManhuaViralTemplateCard,
  value: unknown
) {
  const brief = parseTemplateMethodBrief(value);
  return {
    ...card,
    publicMethodBrief: brief,
    methodBriefEvidenceSha256: brief ? methodEvidenceHash(card) : undefined,
  };
}
