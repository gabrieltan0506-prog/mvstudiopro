import {describe,it,expect,vi} from 'vitest';
import {knowledgeInteriorPrice} from '../../shared/knowledgePublicationPricing';
import {layoutFromSource} from '../../shared/editableLayout';
import {settleKnowledgeInterior,validateKnowledgeBillingTransition} from './knowledgePublicationBilling';
const make=()=>layoutFromSource({owner:'7',sourceId:'billing',kind:'knowledge-publication',title:'统一内文计费',body:'真实正文'});
describe('内文统一按实际页数计费',()=>{
 it.each([[10,0,10,8,80],[11,0,11,6,66],[20,9,11,6,66],[9,9,0,8,0]])('%i总页/%i图页只收内文', (total,images,reading,unit,credits)=>{expect(knowledgeInteriorPrice(total,images)).toEqual({readingPages:reading,unitCredits:unit,credits});});
 it.each([[0,0],[10,11],[11.5,0],[NaN,0],[20,-1]])('无效实页拒绝结算 %s/%s',(total,images)=>expect(()=>knowledgeInteriorPrice(total,images)).toThrow('未扣费'));
 it('未确认不扣款，旧稿不追溯，新稿不能删除已确认费率',async()=>{
 const doc=make(),deduct=vi.fn();await expect(settleKnowledgeInterior(7,doc,11,0,deduct)).rejects.toThrow('确认');expect(deduct).not.toHaveBeenCalled();
 const old=structuredClone(doc);old.publication!.billing!.confirmed=true;delete doc.publication!.billing;
 expect(()=>validateKnowledgeBillingTransition({version:1,owner:'7',documents:[old]},{version:1,owner:'7',documents:[doc]})).toThrow('不能删除');
 expect(await settleKnowledgeInterior(7,doc,11,0,deduct)).toBeUndefined();expect(deduct).not.toHaveBeenCalled();
 });
 it('相同稿件恢复/不同导出版本始终复用同一原子扣费键，失败结果不签发',async()=>{
 const doc=make();doc.publication!.billing!.confirmed=true;
 const deduct=vi.fn().mockResolvedValueOnce({success:true,cost:66}).mockResolvedValueOnce({success:true,cost:66,alreadyCharged:true});
 expect(await settleKnowledgeInterior(7,doc,20,9,deduct)).toMatchObject({readingPages:11,chargedCredits:66,alreadyCharged:false});
 expect(await settleKnowledgeInterior(7,doc,21,9,deduct)).toMatchObject({chargedCredits:66,alreadyCharged:true});
 expect(deduct.mock.calls[0][4]).toEqual(deduct.mock.calls[1][4]);
 deduct.mockResolvedValueOnce({success:false,cost:0});await expect(settleKnowledgeInterior(7,doc,20,9,deduct)).rejects.toThrow('结算未完成');
 });
});
