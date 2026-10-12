import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  codeMotionAudioSourceSchema,
  type CodeMotionAudioSource,
} from "../../shared/codeMotionAudio";
import { codeMotionStorage } from "./codeMotionStore";
function name(userId: string, projectId: string, sourceId: string) {
  if (!/^[1-9]\d*$/.test(userId)) throw new Error("音源账号无法确认");
  z.string().uuid().parse(projectId);
  z.string().uuid().parse(sourceId);
  return `code-motion/u${userId}/sound-sources/${projectId}/${sourceId}.json`;
}
export async function recordCodeMotionGeneratedAudio(
  userId: string,
  projectId: string,
  source: CodeMotionAudioSource,
  deps = codeMotionStorage
) {
  const value = codeMotionAudioSourceSchema.parse(source);
  const key = name(userId, projectId, value.id);
  try {
    await deps.write(key, Buffer.from(JSON.stringify(value)), "0");
  } catch (error) {
    const old = await deps.read(key);
    if (!old || !isDeepStrictEqual(JSON.parse(old.body.toString()), value))
      throw error;
  }
  return value;
}
export async function assertCodeMotionGeneratedAudio(
  userId: string,
  projectId: string,
  source: CodeMotionAudioSource,
  deps = codeMotionStorage
) {
  const old = await deps.read(name(userId, projectId, source.id));
  if (
    !old ||
    !isDeepStrictEqual(
      codeMotionAudioSourceSchema.parse(JSON.parse(old.body.toString())),
      source
    )
  )
    throw new Error("生成音源回执与作品中的台词、音色或素材身份不一致");
}
