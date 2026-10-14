import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.stubGlobal("React", React);
import { XhsGrowthEvidenceView } from "../components/platform/XhsContentGrowthPanel";
import { buildXhsGrowthEvidence } from "@shared/xhsContentStrategy";
it.each(["xiaohongshu", "douyin"] as const)("%s空样本不渲染参考区，有样本保留出处", platform => {
 const now = Date.now();
 expect(renderToStaticMarkup(createElement(XhsGrowthEvidenceView, {evidence:buildXhsGrowthEvidence([],30,now,"",platform)}))).toBe("");
 const evidence = buildXhsGrowthEvidence([{id:"sample-1",title:"真实采集样本",publishedAt:new Date(now - 86400000).toISOString()}],30,now,"",platform);
 const html = renderToStaticMarkup(createElement(XhsGrowthEvidenceView,{evidence}));
 expect(html).toContain("真实采集样本");expect(html).not.toContain("日期不明 0");expect(html).not.toContain("窗口外 0");
 expect(renderToStaticMarkup(createElement(XhsGrowthEvidenceView,{evidence:{...evidence,selectedCount:0,samples:[]}}))).toBe("");
});
