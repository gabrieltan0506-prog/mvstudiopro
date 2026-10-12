import { and, desc, eq, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { canvasVoiceDesignInputSchema, type CanvasVoiceDesignInput, type CanvasDesignedVoice } from "../../shared/canvasVoiceDesign";
import { getDb } from "../db";
import { canvasDialogueJobId, generateCanvasDialogue, canvasDialogueResponseFor, type CanvasDialogueResponse, type CanvasDialogueRecord } from "./canvasDialogueOperation";
import { designedVoiceId } from "./wavespeedVoice";

function result(input: CanvasVoiceDesignInput, row: CanvasDialogueResponse): CanvasDesignedVoice {
  return { requestId: input.requestId, labelZh: input.labelZh, request: input, creditsCost: row.creditsCost, canResume: row.canResumeSettlement,
    status: row.status === "succeeded" ? "ready" : row.status,
    ...(row.result ? { voiceId: row.voice, audioUrl: row.result.audioUrl } : { message: row.message }) };
}
export async function createCanvasVoiceDesign(userId: number, raw: CanvasVoiceDesignInput): Promise<CanvasDesignedVoice> {
  const input = canvasVoiceDesignInputSchema.parse(raw);
  const response = await generateCanvasDialogue(userId, { billingRequestId: input.requestId, input: input.text,
    voice: designedVoiceId(canvasDialogueJobId(userId, input.requestId)), speakerZh: input.labelZh, voiceStateZh: "",
    voiceDesign: { labelZh: input.labelZh, description: input.description } });
  return result(input, response);
}
export async function listCanvasVoiceDesigns(userId: number): Promise<CanvasDesignedVoice[]> {
  const db = await getDb();
  if (!db) throw new Error("设计声线记录不可用");
  const rows = await db.select().from(jobs).where(and(eq(jobs.userId, String(userId)), eq(jobs.type, "audio"),
    sql`${jobs.input}::jsonb->>'action' = 'canvas_dialogue_line'`, sql`${jobs.input}::jsonb->'params'->'voiceDesign' IS NOT NULL`)).orderBy(desc(jobs.createdAt)).limit(50);
  const results: CanvasDesignedVoice[] = [];
  for (const row of rows) {
    const params = (row as unknown as CanvasDialogueRecord).input.params;
    const response = canvasDialogueResponseFor(row as unknown as CanvasDialogueRecord);
    if (response && params.voiceDesign) results.push(result({ ...params.voiceDesign, requestId: params.billingRequestId, text: params.input, consent: true }, response));
  }
  return results;
}
