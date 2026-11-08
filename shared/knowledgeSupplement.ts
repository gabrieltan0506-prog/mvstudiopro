import {z} from "zod";
import type {EditableLayout} from "./editableLayout";
import {planKnowledgeCardPages} from "./knowledgeCardPagination";
export const knowledgeSupplementSelectionSchema=z.object({documentId:z.string().uuid(),conversationId:z.string().uuid(),indexes:z.array(z.number().int().min(0).max(7)).min(1).max(8)}).strict();
export type KnowledgeSupplementSelection=z.infer<typeof knowledgeSupplementSelectionSchema>;
/** 只采用已保存回复中用户选定的内容，实际出图页数仍走现有分页与报价。 */
export function knowledgeSupplementPlan(doc:EditableLayout,selection:KnowledgeSupplementSelection,model?:string){
 if(doc.id!==selection.documentId||!doc.publication?.review||doc.publication.supplementOf)throw Error("请先完成原手册整理，补充稿不能继续扩充");
 if(new Set(selection.indexes).size!==selection.indexes.length)throw Error("补图选择重复");
 const turn=doc.publication.conversation?.find(t=>t.request.id===selection.conversationId);
 if(!turn?.response||turn.request.manuscript!==doc.publication.manuscript)throw Error("请依据当前手册重新取得补图建议");
 const proposals=selection.indexes.map(i=>{const p=turn.response!.supplementalImages[i];if(!p)throw Error("补图建议不存在");return p;});
 const markdown=`# ${doc.title} · 补充图解\n\n`+proposals.map(p=>`## ${p.title}\n\n${p.content}`).join("\n\n");
 const plan=planKnowledgeCardPages(markdown,model);
 if(turn.request.action==="supplement" && plan.pages.length<5)throw Error("补充提炼不足5页，原图保留，未提交出图");
 if(plan.pages.length<1||plan.pages.length>8)throw Error("选定内容实际分页超过8页，请减少补图内容后再确认");
 return {markdown,pages:plan.pages,proposals};
}
