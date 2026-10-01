import { canvasAudioStudioSchema, createCanvasAudioCue, emptyCanvasAudioStudio, type CanvasAudioStudio } from "./canvasAudioStudio";

type Character = { id: string; nameZh: string; aliasZh?: string; referenceAssetIds?: readonly string[] };

/** 保存全文是对白来源；只识别明确秒窗与说话标记，不把音效或导演说明读成台词。 */
export function createManhuaAudioFromSavedPrompt(prompt: string, durationSec: number, characters: readonly Character[] = []): CanvasAudioStudio {
  const studio = emptyCanvasAudioStudio();
  const windows = Array.from(prompt.matchAll(/^(?:###\s*)?(\d+(?:\.\d+)?)\s*[—–-]\s*(\d+(?:\.\d+)?)\s*(?:s\b|秒)\s*[:：]?/gm));
  const assetIds = new Map(Array.from(prompt.matchAll(/(@角色\d+)\|id=([^|\s]+)\|/g), match => [match[1]!, match[2]!]));
  for (let index = 0; index < windows.length; index++) {
    const window = windows[index]!;
    const body = prompt.slice(window.index! + window[0].length, windows[index + 1]?.index ?? prompt.length).split(/\n【(?:原稿声音|创作策略|垫图|资产)/)[0]!;
    const endSec = Number(window[2]);
    const lines = Array.from(body.matchAll(/\{对白\/([^：:}]+)[：:]\s*(\d+(?:\.\d+)?)秒开口，\s*[“「]([^”」]+)[”」]|(@角色\d+)说[“「]([^”」]+)[”」]/g));
    if (lines.length > 1) throw new Error("保存全文的同一秒窗有多句对白，请明确每句独立起止秒；旧音轨保留。");
    for (const line of lines) {
      const tag = (line[1] || line[4])!.trim();
      const assetId = assetIds.get(tag);
      const matches = characters.filter(character => assetId ? character.id === assetId || character.referenceAssetIds?.includes(assetId) : character.nameZh === tag || character.aliasZh === tag);
      if (matches.length > 1 || (tag.startsWith("@角色") && matches.length !== 1)) throw new Error(`保存全文的 ${tag} 未唯一绑定人物；旧音轨保留。`);
      const character = matches[0];
      const startSec = line[2] ? Number(line[2]) : Number(window[1]);
      if (startSec < Number(window[1]) || startSec >= endSec || endSec > durationSec + 0.02) throw new Error("保存全文的对白秒窗超出本段；旧音轨保留，未截断。");
      studio.cues.push({ ...createCanvasAudioCue("dialogue", `saved-full-line-${studio.cues.length + 1}`),
        labelZh: `保存全文·第${studio.cues.length + 1}句`, speakerZh: character?.nameZh || tag,
        speakerId: character?.id, textZh: (line[3] || line[5])!, startSec, endSec,
      });
    }
  }
  const expectedCount = Array.from(prompt.matchAll(/\{对白\/|@角色\d+说[“「]/g)).length;
  if (studio.cues.length !== expectedCount || (!studio.cues.length && !/无对白|无台词|禁止对白/.test(prompt))) throw new Error("保存全文的对白标记或秒窗无法完整读取，请核对正文；不会回填旧分镜对白。");
  return canvasAudioStudioSchema.parse(studio);
}

export function savedPromptAudioDiffers(studio: CanvasAudioStudio, saved: CanvasAudioStudio): boolean {
  const active = studio.cues.filter(cue => cue.kind === "dialogue" && cue.enabled !== false);
  return active.length !== saved.cues.length || active.some((cue, index) => cue.textZh !== saved.cues[index]?.textZh || cue.speakerZh !== saved.cues[index]?.speakerZh);
}

/** 仅由用户显式操作更新未生成草稿；有原声/候选/在途任务时拒绝覆盖。音乐与音效原样保留。 */
export function syncUnproducedAudioToSavedPrompt(studio: CanvasAudioStudio, saved: CanvasAudioStudio): CanvasAudioStudio {
  if (studio.pendingOperations.length || studio.cues.some(cue => cue.kind === "dialogue" && (cue.takes.length || cue.approved || cue.selectedTakeId || cue.source))) {
    throw new Error("本段有已有原声、候选或在途任务，不能覆盖。请先核对并恢复原声绑定；不需要重新生成。");
  }
  const next = { ...studio, cues: [...saved.cues, ...studio.cues.filter(cue => cue.kind !== "dialogue")] };
  canvasAudioStudioSchema.parse(next);
  return next;
}
