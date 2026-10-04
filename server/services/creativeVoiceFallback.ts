/** Live 建立阶段备援。connect 必须等 setupComplete 才 resolve，失败时先关闭该连接。
 * 此层不提交用户音讯/文字；会话建立后的断线不得从这里重放，以免重复计费。
 */
export type CreativeVoiceRoute = "vertex" | "gemini-api";
export type CreativeVoiceModel = "gemini-3.8-live" | "gemini-3.8-live-extended-thinking";
export type CreativeVoiceConnectionPlan = {
  route: CreativeVoiceRoute;
  model: CreativeVoiceModel;
  location?: "us-central1";
  generationConfig: {
    responseModalities: ["AUDIO"];
    maxOutputTokens: number;
    thinkingConfig?: { thinkingLevel: "HIGH" };
  };
};
export function creativeVoiceConnectionPlans(extended: boolean): CreativeVoiceConnectionPlan[] {
  if (extended) return [{ route: "gemini-api", model: "gemini-3.8-live-extended-thinking",
    generationConfig: { responseModalities: ["AUDIO"], maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "HIGH" } } }];
  return ["vertex", "gemini-api"].map(route => ({
    route: route as CreativeVoiceRoute, model: "gemini-3.8-live",
    ...(route === "vertex" ? { location: "us-central1" as const } : {}),
    // 普通 Live 不支持 thinkingConfig；不能把 HIGH/MAX 强塞进请求。
    generationConfig: { responseModalities: ["AUDIO"], maxOutputTokens: 1024 },
  }));
}
export class CreativeVoiceConnectError extends Error {
  constructor(readonly routes: CreativeVoiceRoute[]) {
    super("语音连接未建立，请检查服务或额度后再试；尚未提交本轮内容。");
    this.name = "CreativeVoiceConnectError";
  }
}
export async function connectCreativeVoiceWithFallback<T extends { close(): void }>(options: {
  extended?: boolean;
  signal: AbortSignal;
  /** 必须实现 signal 取消、握手超时、失败连接清理；仅完成握手，不发送内容。 */
  connect: (plan: CreativeVoiceConnectionPlan, signal: AbortSignal) => Promise<T>;
  onRoute?: (plan: CreativeVoiceConnectionPlan, fallback: boolean) => void;
}): Promise<{ session: T; plan: CreativeVoiceConnectionPlan }> {
  const attempts: CreativeVoiceRoute[] = [];
  for (const plan of creativeVoiceConnectionPlans(Boolean(options.extended))) {
    options.signal.throwIfAborted();
    options.onRoute?.(plan, attempts.length > 0);
    options.signal.throwIfAborted();
    attempts.push(plan.route);
    let session: T;
    try {
      session = await options.connect(plan, options.signal);
    } catch {
      options.signal.throwIfAborted();
      continue; // 每通道最多一次；不把凭证或原始供应商错误送给前台。
    }
    if (options.signal.aborted) {
      session.close();
      options.signal.throwIfAborted();
    }
    return { session, plan }; // 后续对话属于调用方；这里不监听断线、不重送。
  }
  throw new CreativeVoiceConnectError(attempts);
}
