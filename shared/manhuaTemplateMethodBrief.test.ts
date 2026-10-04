import {expect,it} from "vitest";
import {parseTemplateMethodBrief,mergeTemplateMethodBriefs} from "./manhuaTemplateMethodBrief";
it("多批次学习合并不同呈现方法，不只取首批，也不把来源链接公开",()=>{
 const a={title:"光影空间",highlights:["局部火光随人物靠近变亮。","门外脚步停下后切人物反应。"],useWhen:"受限空间对峙。"};
 const b={title:"群像节奏",highlights:["群体动作先整齐再被一人的停顿打破。","远景和手部动作交替交代权力关系。"],useWhen:"公开仪式。"};
 expect(mergeTemplateMethodBriefs([a,b])?.highlights).toHaveLength(4);
 expect(parseTemplateMethodBrief({...a,highlights:["https://private.invalid/secret",a.highlights[1]]})).toBeUndefined();
 expect(mergeTemplateMethodBriefs([{}])).toBeUndefined();
});
