/** 选题封面／2×4 管线 Deep Research Pro：由成长营「竞品分析调研」面板（监管）写入；平台顾问页静默读取，不在平台页展示 DR 调试 UI。 */
export const PLATFORM_TOPIC_COVER_DR_PRO_LS_KEY = "mvstudiopro.platform.topicCoverDeepResearchPro.v1";

export function readTopicCoverDeepResearchProFromLs(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PLATFORM_TOPIC_COVER_DR_PRO_LS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeTopicCoverDeepResearchProToLs(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PLATFORM_TOPIC_COVER_DR_PRO_LS_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
