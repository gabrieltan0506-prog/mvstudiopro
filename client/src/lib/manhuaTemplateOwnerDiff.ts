import type {
  ManhuaViralTemplateCard,
  ManhuaViralTemplateOptimizeField,
} from "@shared/manhuaViralTemplateBank";

export function isManhuaTemplateFieldChanged(
  original: ManhuaViralTemplateCard,
  candidate: ManhuaViralTemplateCard,
  field: ManhuaViralTemplateOptimizeField,
): boolean {
  return JSON.stringify(original[field]) !== JSON.stringify(candidate[field]);
}

export function changedManhuaTemplateBeatIndexes(
  original: ManhuaViralTemplateCard,
  candidate: ManhuaViralTemplateCard,
): number[] {
  const count = Math.max(original.beatGrid.length, candidate.beatGrid.length);
  return Array.from({ length: count }, (_, index) => index).filter(
    (index) => JSON.stringify(original.beatGrid[index]) !== JSON.stringify(candidate.beatGrid[index]),
  );
}
