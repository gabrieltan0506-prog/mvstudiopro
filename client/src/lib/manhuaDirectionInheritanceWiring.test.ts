import { resolveKeyartShotIndex } from "@shared/manhuaScriptWorkbench";
import { expect, it } from "vitest";
import { spawnManhuaDramaStudio, expandManhuaShotKeyartsAfterReverse, ensureManhuaFragmentClips, queuedManhuaClipBlocks, applyFactoryPrefsToBlocks } from "./canvasDramaStudio";
import { buildManhuaDirectionCanonFromSelection, listManhuaDirectionCards } from "@shared/manhuaDirectionCanonLibrary";
const cards = listManhuaDirectionCards().filter(c=>c.rules.some(r=>r.stages.includes('clip')));
it("本镜覆盖只进该镜关键帧与段内该镜，跨集隔离且撤回清除旧方法",()=>{
 const model='seedance-2.0-mini';
 const canon=buildManhuaDirectionCanonFromSelection({mainCardId:cards[0]!.id,scopedOverrides:[{scope:'shot',episodeIndex:1,shotIndex:1,cardId:cards[1]!.id,reasonZh:'先显露门外观察者',stages:['keyframe','clip'],status:'approved'}]})!;
 const frameCard=listManhuaDirectionCards().find(c=>c.id==='embodied_fable_system')!;
 canon.cards.push(frameCard);canon.authorizedCardIds.push(frameCard.id);
 canon.scopedOverrides!.push({scope:'shot',episodeIndex:1,shotIndex:1,cardId:frameCard.id,reasonZh:'静态空间先显露角色位置',stages:['keyframe'],status:'approved'});
 const base=buildManhuaDirectionCanonFromSelection({mainCardId:cards[0]!.id})!;
 for(const ep of [1,2]) {
  const spawned=spawnManhuaDramaStudio({topic:'医馆门槛',episodeIndex:ep,videoModel:model,directionCanon:canon});
  const reverse=spawned.blocks.find(b=>b.id.startsWith('reverse-'))!;
  const expanded=expandManhuaShotKeyartsAfterReverse(spawned.blocks.map(b=>b.id===reverse.id?{...b,status:'done' as const,outputText:Array.from({length:18},(_,i)=>`${i+1}. 第${i+1}镜：医馆后院，阿菁望向门外`).join('\n')}:b),spawned.edges,reverse.id,{videoModel:model,directionCanon:canon});
  const current=applyFactoryPrefsToBlocks(expanded.blocks,{directionCanon:canon});
  const first=current.find(b=>b.id.startsWith('keyart-')&&resolveKeyartShotIndex(b.id,b.prompt)===1)!;
  expect(first.prompt).toContain(`【导演法典·v1·${ep===1?frameCard.id:cards[0]!.id}·`);
  const blocks=current.map(b=>b.id.startsWith('keyart-')?{...b,status:'done' as const,outputUrl:`https://test.example/${b.id}.jpg`}:b);
  const ensured=ensureManhuaFragmentClips(blocks,expanded.edges,ep,{videoModel:model,directionCanon:canon});
  const clips=queuedManhuaClipBlocks(ensured.blocks,ep,model);
  expect(clips.length).toBeGreaterThan(1);
  if(ep===1){
   expect(clips[0]!.prompt).toContain(`镜01导演方法：【导演法典·v1·${cards[1]!.id}·`);
   expect(clips[0]!.prompt).toContain(`镜02导演方法：【导演法典·v1·${cards[0]!.id}·`);
   expect(clips[1]!.prompt).not.toContain(cards[1]!.id);
  }else expect(clips.map(b=>b.prompt).join('\n')).not.toContain(cards[1]!.id);
  const before=ensured.blocks.find(b=>b.id===first.id)!;
  const generated=ensured.blocks.map(b=>b.id===first.id?{...b,manhuaKeyartSourceState:{...b.manhuaKeyartSourceState!,generatedFor:b.manhuaKeyartSourceState!.required,generatedUrl:b.outputUrl}}:b);
  const removed=ensureManhuaFragmentClips(generated,ensured.edges,ep,{videoModel:model,directionCanon:base});
  const after=removed.blocks.find(b=>b.id===first.id)!;
  expect(after.outputUrl).toBe(before.outputUrl);
  if(ep===1) {
    expect(after.manhuaKeyartSourceState!.required).not.toBe(after.manhuaKeyartSourceState!.generatedFor);
    expect(after.prompt).not.toContain(frameCard.id);
  }

  expect(queuedManhuaClipBlocks(removed.blocks,ep,model).map(b=>b.prompt).join('\n')).not.toContain(cards[1]!.id);
 }
});

it("storyboard段与镜覆盖实际进入beats/reverse对应镜号，阶段隔离并可撤回", () => {
 const model = "seedance-2.0-mini";
 const storyboardCards = listManhuaDirectionCards().filter(card => card.rules.some(rule => rule.stages.includes("storyboard") && rule.status !== "research_only"));
 const [main, local, shotCard] = storyboardCards;
 expect(storyboardCards.length).toBeGreaterThanOrEqual(3);
 const base = buildManhuaDirectionCanonFromSelection({ mainCardId: main!.id })!;
 const canon = buildManhuaDirectionCanonFromSelection({ mainCardId: main!.id, scopedOverrides: [
  { scope: "segment", episodeIndex: 1, segmentIndex: 1, cardId: local!.id, reasonZh: "首段先建立空间距离", stages: ["storyboard"], status: "approved" },
  { scope: "shot", episodeIndex: 1, shotIndex: 1, cardId: shotCard!.id, reasonZh: "首镜先揭示门外观察者", stages: ["storyboard"], status: "approved" },
 ] })!;
 for (const episodeIndex of [1, 2]) {
  const spawned = spawnManhuaDramaStudio({ topic: "医馆门槛", episodeIndex, videoModel: model, directionCanon: base });
  expect(applyFactoryPrefsToBlocks(spawned.blocks, { directionCanon: canon }).filter(block => block.id.startsWith("beats-") || block.id.startsWith("reverse-")).every(block => !block.prompt.includes("【逐镜分镜手法】"))).toBe(true);
  const reverse = spawned.blocks.find(block => block.id.startsWith("reverse-"))!;
  const source = spawned.blocks.map(block => block.id === reverse.id ? { ...block, status: "done" as const, outputText: Array.from({ length: 18 }, (_, i) => `${i + 1}. 第${i + 1}镜：医馆后院，阿菁望向门外`).join("\n") } : block);
  const archivedOnly = source.map(block => block.id === reverse.id ? { ...block, archivedFromPreviousScript: true } : block);
  expect(applyFactoryPrefsToBlocks(archivedOnly, { directionCanon: canon }).filter(block => block.id.startsWith("beats-") || block.id.startsWith("reverse-")).every(block => !block.prompt.includes("【逐镜分镜手法】"))).toBe(true);
  const current = applyFactoryPrefsToBlocks(source, { directionCanon: canon });
  for (const block of current.filter(block => block.id.startsWith("beats-") || block.id.startsWith("reverse-"))) {
   if (episodeIndex === 1) {
    expect(block.prompt).toContain(`第1镜（第1段）分镜手法：【导演法典·v1·${shotCard!.id}·`);
    expect(block.prompt).toContain(`第2镜（第1段）分镜手法：【导演法典·v1·${local!.id}·`);
    expect(block.prompt).toMatch(new RegExp(`第\\d+镜（第2段）分镜手法：【导演法典·v1·${main!.id}·`));
   } else expect(block.prompt).not.toContain("【逐镜分镜手法】");
  }
  const twice = applyFactoryPrefsToBlocks(current, { directionCanon: canon });
  for (const block of twice.filter(block => block.id.startsWith("beats-") || block.id.startsWith("reverse-"))) {
   expect((block.prompt.match(/【逐镜分镜手法】/g) || []).length).toBe(episodeIndex === 1 ? 1 : 0);
  }
  const annotated = twice.map(block => block.id === reverse.id ? { ...block, prompt: `${block.prompt}\n用户附言：门外反应镜保留` } : block);
  const removed = applyFactoryPrefsToBlocks(annotated, { directionCanon: base });
  for (const block of removed.filter(block => block.id.startsWith("beats-") || block.id.startsWith("reverse-"))) {
   expect(block.prompt).not.toContain("【逐镜分镜手法】");
   expect(block.prompt).not.toContain(local!.id);
   expect(block.prompt).not.toContain(shotCard!.id);
   expect(block.prompt).toContain(`【导演法典·v1·${main!.id}·`);
  }
  expect(removed.find(block => block.id === reverse.id)!.prompt).toContain("门外反应镜保留");
  const clipOnly = { ...canon, scopedOverrides: canon.scopedOverrides!.map(override => ({ ...override, stages: ["clip" as const] })) };
  expect(applyFactoryPrefsToBlocks(current, { directionCanon: clipOnly }).filter(block => block.id.startsWith("beats-") || block.id.startsWith("reverse-")).every(block => !block.prompt.includes("【逐镜分镜手法】"))).toBe(true);
 }
});
