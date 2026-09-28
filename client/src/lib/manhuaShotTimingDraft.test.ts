import { expect, it } from 'vitest';
import { saveManhuaShotTimingDraft } from './manhuaShotTimingDraft';
import { defaultCanvasBlock } from './canvasTypes';
import { retimeManhuaCanvasNodes } from './manhuaShotTimingDraft';
import { parseWorkbenchShotsFromText, groupShotsIntoSegments } from '@shared/manhuaScriptWorkbench';
it('剧本或画布写入失败保留两份原稿，成功不截断长分镜', () => {
  const wk='mv-manhua-writer-session-v1', ck='mv-freeform-canvas-v1';
  for(const failKey of [wk,ck,'']) {
    const data = new Map([[wk,JSON.stringify({topic:'原主题',writerConfirmed:true})],[ck,'原画布']]);
    const original=new Map(data); let failed=false;
    const storage={getItem:(k:string)=>data.get(k)??null,removeItem:(k:string)=>{data.delete(k);},setItem:(k:string,v:string)=>{if(k===failKey&&!failed){failed=true;throw Error('QuotaExceededError');}data.set(k,v);}};
    const text='原分镜'.repeat(3000);
    const action=()=>saveManhuaShotTimingDraft([{...defaultCanvasBlock('text',0,0),id:'reverse-e01',outputText:text}],[],{writerConfirmed:false,directorUnlocked:false},storage);
    if(failKey){expect(action).toThrow('时长未应用');expect(data).toEqual(original);}
    else {action();expect(JSON.parse(data.get(wk)!).writerConfirmed).toBe(false);expect(JSON.parse(data.get(ck)!).blocks[0].outputText).toBe(text);}
  }
});

it('旧画布 prompt 秒位表能保存镜头切点，前面两段不变且动作提示词不含标记', () => {
  const rows = Array.from({ length: 18 }, (_, i) => `| ${i + 1} | ${i * 5}–${(i + 1) * 5}秒 | 近景 | 镜${i + 1}动作 | 无 |`);
  const original = `## 分镜表\n| 镜号 | 秒位 | 景别/运镜 | 画面 | 对白 |\n|---|---|---|---|---|\n${rows.join('\n')}`;
  const node = { ...defaultCanvasBlock('text', 0, 0), id: 'story-e01', prompt: original, outputText: '' };
  const oldSegments = groupShotsIntoSegments(parseWorkbenchShotsFromText(original), { videoModel: 'seedance-2.5' });
  const edit = retimeManhuaCanvasNodes([node], 16, 5, true);
  const saved = edit.apply(node);
  const shots = parseWorkbenchShotsFromText(saved.prompt);
  const segments = groupShotsIntoSegments(shots, { videoModel: 'seedance-2.5' });
  expect(saved.prompt).toContain('【新段】镜16动作');
  expect(shots[15].actionZh).toBe('镜16动作');
  expect(segments.map(s => s.shots.map(shot => shot.index))).toEqual([
    [1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], [13, 14, 15], [16, 17, 18],
  ]);
  expect(segments.slice(0, 2)).toEqual(oldSegments.slice(0, 2));
});
