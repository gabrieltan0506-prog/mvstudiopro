import { useSyncExternalStore } from "react";
import { getManhuaAdvisorScope, isManhuaAdvisorPage, subscribeManhuaAdvisorScope } from "@/lib/manhuaAdvisorEntry";

/** 顶栏和旧工具坞订阅同一真实模式，避免两个入口互相遮挡或同时消失。 */
export function useManhuaAdvisorScope(path: string): boolean {
  const active = useSyncExternalStore(subscribeManhuaAdvisorScope, getManhuaAdvisorScope, () => false);
  return isManhuaAdvisorPage(path, active);
}
