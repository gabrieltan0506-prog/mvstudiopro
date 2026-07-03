import React, { createContext, useContext } from "react";

const ResearchHubEmbedContext = createContext(false);

export function ResearchHubEmbedProvider(props: { children: React.ReactNode }) {
  return (
    <ResearchHubEmbedContext.Provider value={true}>{props.children}</ResearchHubEmbedContext.Provider>
  );
}

/** 子页在 ResearchHubPage Tab 内渲染时为 true，用于隐藏重复顶栏/返回键 */
export function useResearchHubEmbed(): boolean {
  return useContext(ResearchHubEmbedContext);
}
