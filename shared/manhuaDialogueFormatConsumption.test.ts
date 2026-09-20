import { describe, expect, it } from 'vitest';
import { formatWorkbenchSegmentClipInjectBlock } from './manhuaScriptWorkbench';
import { renderManhuaClipPromptForSeedance, stripManhuaClipForbiddenBoards } from './manhuaClipPromptSanitize';
function outbound(dialogueZh: string) {
 const prompt=formatWorkbenchSegmentClipInjectBlock({shots:[{index:1,durationSec:4,cameraZh:'中景固定',actionZh:'甲背娘缓缓走路',dialogueZh}],durationSec:4,segmentIndex:1,totalSegments:1});
 return renderManhuaClipPromptForSeedance(stripManhuaClipForbiddenBoards(prompt));
}
describe('对白原文到最终供应商提示词',()=>{
 it('姓名和原文引号不进入朗读内容',()=>{
  const result=outbound('娘：「慢点。」');
  expect(result).toContain('娘说{慢点。}');
  expect(result).not.toContain('说{娘');
 });
 it('同镜两名说话人保留两句和顺序',()=>{
  const result=outbound('娘：「慢点。」；甲：「好，我扶着您。」');
  expect(result).toContain('娘说{慢点。}');
  expect(result).toContain('甲说{好，我扶着您。}');
  expect(result.indexOf('娘说')).toBeLessThan(result.indexOf('甲说'));
  expect(result).toContain('0–2s'); expect(result).toContain('2–4s');
 });
 it.each(['娘：“慢点。”','娘："慢点。"','娘：慢点。'])('兼容明确姓名格式 %s',input=>expect(outbound(input)).toContain('娘说{慢点。}'));
 it('资产标签仍保留人物身份',()=>expect(outbound('@角色2：「慢点。」')).toContain('@角色2说{慢点。}'));
});
