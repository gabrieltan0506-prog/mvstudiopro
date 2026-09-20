import { expect, it } from 'vitest';
import { saveManhuaShotTimingDraft } from './manhuaShotTimingDraft';
import { defaultCanvasBlock } from './canvasTypes';
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
