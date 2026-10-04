import { novelScriptSchema, NOVEL_FACETS } from "@shared/novelWorkspace";
import type { NovelRun } from "./novelWorkspace";
export type ScriptEdits = Record<string, string>;
export const scriptFieldKey = (...parts: (string | number)[]) =>
  JSON.stringify(parts);
/** Only editable prose is patched. Episode indices, scene IDs, templates and paid receipts stay intact. */
export function editedNovelScript(run: NovelRun, edits: ScriptEdits = {}) {
  const script = novelScriptSchema.parse(JSON.parse(run.result.text));
  const value = (original: string, ...path: (string | number)[]) =>
    edits[scriptFieldKey(...path)] ?? original;
  script.title = value(script.title, "title");
  for (const ep of script.episodes) {
    for (const field of ["title", "opening", "payoff", "hook"] as const)
      ep[field] = value(ep[field], ep.index, field);
    for (const scene of ep.scenes)
      for (const facet of NOVEL_FACETS)
        scene[facet] = value(scene[facet], ep.index, scene.key, facet);
  }
  return script;
}
export function editedNovelRun(run: NovelRun, edits?: ScriptEdits): NovelRun {
  const script = novelScriptSchema.parse(editedNovelScript(run, edits));
  return {
    ...run,
    result: { ...run.result, text: JSON.stringify(script), resultSha256: "" },
  };
}
