import { createHash, randomUUID } from "node:crypto";
import { callNovelStage, type NovelStageCall, type NovelRouteEvent } from "./manhuaNovelAdaptationRun";
import { uploadBufferToGcs } from "./gcs";
import { manhuaWriterModelLabel, type ManhuaWriterModel } from "../../shared/manhuaWriterModels";

/** 复用小说模型的实际 SSE、推理参数和完整性检查；手动选择不暗换其他模型。 */
export function createManhuaWriterModelCall(userId: number, requestId: string, model: ManhuaWriterModel): NovelStageCall {
  return async (prompt, json, stageId, trace) => {
    const stageHash = createHash("sha256").update(stageId).digest("hex").slice(0, 20);
    const prefix = `manhua-writer-evidence/user-${userId}/${requestId}/${stageHash}/${randomUUID()}`;
    const write = async (name: string, text: string) => {
      await uploadBufferToGcs({ objectName: `${prefix}/${name}.json`, buffer: Buffer.from(text), contentType: "application/json; charset=utf-8" });
      return { objectName: `${prefix}/${name}.json`, bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") };
    };
    const input = await write("input", JSON.stringify({ userId, requestId, stageId, model, prompt, json, createdAt: new Date().toISOString() }));
    let raw: Awaited<ReturnType<typeof write>> | undefined;
    const routeEvents: Array<{ phase: NovelRouteEvent["phase"]; route: NovelRouteEvent["route"]; evidence: Awaited<ReturnType<typeof write>> }> = [];
    try {
      const result = await callNovelStage(prompt, json, stageId, {
        modelPreference: model,
        onBytes: trace?.onBytes,
        onRaw: async response => { raw = await write("raw", response); },
        onRouteEvent: async event => {
          const evidence = await write(`route-${event.route.attempt}-${event.phase}`, JSON.stringify({ requestId, stageId, ...event }));
          routeEvents.push({ phase: event.phase, route: event.route, evidence });
          await trace?.onRouteEvent?.(event);
        },
      });
      const parsed = await write("parsed", JSON.stringify(result));
      await write("manifest", JSON.stringify({ input, raw, parsed, routeEvents, selectedRoute: result.route }));
      return result;
    } catch (error) {
      // 记录不含密钥或上游响应正文的状态；已保存的原始模型结果不删除。
      const message = error instanceof Error ? error.message : "模型未返回完整结果";
      await write("failure", JSON.stringify({ input, raw, model, routeEvents, message, at: new Date().toISOString() }));
      throw Object.assign(new Error(`${manhuaWriterModelLabel(model)}：${message}`), { code: (error as { code?: string }).code });
    }
  };
}
