import {
  canvasAudioCueInputKey,
  getSelectedAudioTake,
} from "@shared/canvasAudioStudio";
import type { CanvasBlock, CanvasUploadedAsset } from "./canvasTypes";
/** Only explicitly adopted, current takes become reusable input options. */
export function creativeStudioAudioAssets(
  blocks: readonly CanvasBlock[]
): CanvasUploadedAsset[] {
  return blocks.flatMap(block =>
    (block.audioStudio?.cues ?? []).flatMap(cue => {
      const take = getSelectedAudioTake(cue);
      if (
        !cue.approved ||
        cue.enabled === false ||
        !take ||
        take.inputKey !== canvasAudioCueInputKey(cue) ||
        !take.gcsUri.startsWith("gs://")
      )
        return [];
      return [
        {
          id: `adopted-audio:${block.id}:${cue.id}:${take.id}`,
          kind: "audio" as const,
          fileName: cue.labelZh || cue.shotZh || "已采用音轨",
          url: take.previewUrl,
          previewUrl: take.previewUrl,
          gcsUri: take.gcsUri,
          mimeType: "audio/mpeg",
        },
      ];
    })
  );
}
