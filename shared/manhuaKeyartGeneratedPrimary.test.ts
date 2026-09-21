import { describe, expect, it } from 'vitest';
import { planManhuaKeyartEditFusion } from './manhuaKeyartEditFusion';
import type { ManhuaCustomAssetRef } from './manhuaCustomAssetRefs';
import type { ManhuaWriterAssetCanon } from './manhuaWriterAssetCanon';
const canon: ManhuaWriterAssetCanon = { characters: [{id:'mother',role:'character',nameZh:'娘',lookZh:'病妇',promptZh:'病妇'}],props:[],locations:[],episodeMainSceneId:{} };
const current: ManhuaCustomAssetRef = {id:'current',url:'https://example.com/current.png',role:'character',source:'generated',labelZh:'娘',refDuty:'identity',claimedAnchorIds:['mother'],claimSource:'manual',primaryBindings:[{anchorId:'mother',duty:'identity'}]};
describe('生成角色身份主图进入静帧',()=>{
 it('实际采用图进入底图，旧候选保留但不进入请求',()=>{
  const p=planManhuaKeyartEditFusion({assetCanon:canon,customRefs:[{...current,id:'old',url:'https://example.com/old.png',primaryBindings:[]},current]});
  expect(p.refs.map(r=>r.path)).toEqual(['https://example.com/current.png']);
  expect(p.refImageUrl).toBe(current.url);
 });
 it.each([
  {...current,primaryBindings:[]},
  {...current,claimedAnchorIds:[]},
  {...current,reviewStatus:'needs_review' as const},
  {...current,primaryBindings:[{anchorId:'other-project',duty:'identity' as const}]},
  {...current,primaryBindings:[{anchorId:'mother',duty:'look' as const}]},
 ])('拒绝未采用、未认领、待处理及旧剧绑定的生成图 %#',ref=>{
  expect(planManhuaKeyartEditFusion({assetCanon:canon,customRefs:[ref]}).refs).toEqual([]);
 });
 it('缺少当前剧本时不凭生成图旧绑定推断身份',()=>{
  expect(planManhuaKeyartEditFusion({customRefs:[current]}).refs).toEqual([]);
 });
});
