import { toast as notifications } from "sonner";
import { sanitizePlatformUserMessage } from "./platformUserFacingCopy";

/** 只处理平台页通知的展示副本，原错误和请求仍交给原有日志链。 */
export function platformNotificationArgs(args: unknown[]): unknown[] {
  const [message, options, ...rest] = args;
  const clean = typeof message === "string" ? sanitizePlatformUserMessage(message) : message;
  const data = options && typeof options === "object" ? { ...options } as Record<string, unknown> : options;
  if (data && typeof data === "object" && "description" in data && typeof data.description === "string") {
    data.description = sanitizePlatformUserMessage(data.description, "请查看原任务结果后再操作。");
  }
  return [clean, data, ...rest];
}
const messages = new Set(["success", "error", "info", "warning", "message", "loading"]);
export const toast: typeof notifications = new Proxy(notifications, {
  apply(target, receiver, args) { return Reflect.apply(target, receiver, platformNotificationArgs(args)); },
  get(target, key, receiver) {
    const value = Reflect.get(target, key, receiver);
    return messages.has(String(key)) && typeof value === "function"
      ? (...args: unknown[]) => Reflect.apply(value, target, platformNotificationArgs(args)) : value;
  },
});
