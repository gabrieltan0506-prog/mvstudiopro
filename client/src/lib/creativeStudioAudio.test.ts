import { expect, it } from "vitest";
import {
  createCanvasAudioCue,
  canvasAudioCueInputKey,
  emptyCanvasAudioStudio,
} from "@shared/canvasAudioStudio";
import { defaultCanvasBlock } from "./canvasTypes";
import { creativeStudioAudioAssets } from "./creativeStudioAudio";
it("only current adopted SFX becomes an animation audio input", () => {
  const cue = {
    ...createCanvasAudioCue("sfx", "ambience", 10),
    source: {
      gcsUri: "gs://offline/raw.wav",
      previewUrl: "https://offline.invalid/raw.wav",
      durationSec: 10,
      labelZh: "雨声",
    },
    approved: true,
    selectedTakeId: "chosen",
  };
  const take = {
    id: "chosen",
    gcsUri: "gs://offline/trimmed.wav",
    previewUrl: "https://offline.invalid/trimmed.wav",
    durationSec: 5,
    inputKey: canvasAudioCueInputKey(cue),
    createdAt: new Date().toISOString(),
  };
  const block = {
    ...defaultCanvasBlock("video", 0, 0),
    audioStudio: {
      ...emptyCanvasAudioStudio(),
      cues: [{ ...cue, takes: [take] }],
    },
  };
  expect(creativeStudioAudioAssets([block]).map(a => a.gcsUri)).toEqual([
    take.gcsUri,
  ]);
  expect(
    creativeStudioAudioAssets([
      {
        ...block,
        audioStudio: {
          ...block.audioStudio,
          cues: [{ ...block.audioStudio.cues[0], approved: false }],
        },
      },
    ])
  ).toEqual([]);
  expect(
    creativeStudioAudioAssets([
      {
        ...block,
        audioStudio: {
          ...block.audioStudio,
          cues: [{ ...block.audioStudio.cues[0], sourceEndSec: 4 }],
        },
      },
    ])
  ).toEqual([]);
});
