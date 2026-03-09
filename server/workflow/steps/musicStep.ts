import { generateMusicWithSuno } from "../../models/suno.js";
import { buildMusicPrompt } from "../prompts/musicPrompt.js";

export async function musicStep(input: {
  script?: string;
  genre?: string;
  mood?: string;
  pace?: string;
  duration?: number;
  hasVocal?: boolean;
  bpm?: number;
}) {
  const script = String(input.script || "").trim() || buildMusicPrompt({
    genre: input.genre,
    mood: input.mood,
    pace: input.pace,
    duration: input.duration,
    hasVocal: input.hasVocal,
    bpm: input.bpm,
  });
  const result = await generateMusicWithSuno({ script });
  return result.musicUrl;
}
