/** 選題封面／2×4 管线 Deep Research Pro：由成長營「競品分析調研」面板（監管）寫入，平台趨勢頁讀取。 */
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
