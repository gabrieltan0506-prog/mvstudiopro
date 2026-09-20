import { expect, it } from 'vitest';
import { createManhuaAudioFromShots } from './manhuaAudioFromShots';
import type { ManhuaWorkbenchShot } from './manhuaScriptWorkbench';
const shot = (index: number, extra: Partial<ManhuaWorkbenchShot> = {}): ManhuaWorkbenchShot => ({index, durationSec:4, cameraZh:'中景',actionZh:'人物对话',...extra});
it('从真实三镜取两句对白，保留镜内秒位、角色和原句，不自动采用或付费', () => {
 const result=createManhuaAudioFromShots([shot(1),shot(2,{dialogueZh:'阿菁：「娘，抓紧我，快到了。」'}),shot(3,{dialogueZh:'曹三：「你有钱付诊金吗？」',emotionZh:'轻蔑'})],12);
 expect(result.cues.map(c=>[c.speakerZh,c.textZh,c.startSec,c.endSec])).toEqual([['阿菁','娘，抓紧我，快到了。',4,8],['曹三','你有钱付诊金吗？',8,12]]);
 expect(result.cues.every(c=>!c.approved && !c.voice && !c.takes.length)).toBe(true);
 expect(result.pendingOperations).toEqual([]);
});
it('保留一字说话人及同镜续句，已压制对白不恢复，音效不当对白', () => {
 const result=createManhuaAudioFromShots([shot(1,{dialogueZh:'别怕。',dialogueSpeakerNameZh:'娘',additionalDialogueCues:[{dialogueZh:'我在这儿。',speakerNameZh:'阿菁'}]}),shot(2,{dialogueZh:'删除的台词',dialogueSuppressed:true,soundZh:'风声'})],8);
 expect(result.cues.map(c=>[c.speakerZh,c.textZh])).toEqual([['娘','别怕。'],['阿菁','我在这儿。']]);
});
it('超长对白明确拒绝，不静默截句',()=>{
 expect(()=>createManhuaAudioFromShots([shot(1,{dialogueZh:'娘：'+ '话'.repeat(4001)})],4)).toThrow();
});
