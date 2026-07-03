/** Research Hub 内 Tab 路径（方案 B 统一入口） */
export function researchHubTabPath(tab: string): string {
  return tab === "research" ? "/research" : `/research?tab=${encodeURIComponent(tab)}`;
}

export const RESEARCH_HUB_GOD_VIEW_PATH = researchHubTabPath("god-view");
