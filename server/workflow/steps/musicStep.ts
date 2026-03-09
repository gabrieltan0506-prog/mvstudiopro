import { generateMusicWithSuno } from "../../models/suno";

export async function musicStep(input: { script: string }) {
  const result = await generateMusicWithSuno({ script: input.script });
  return result.musicUrl;
}
