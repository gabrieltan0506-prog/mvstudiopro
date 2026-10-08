import { expect,it } from "vitest";
import { previsHandContactsSchema,handContactsIssue,handContactAmount } from "./manhuaPrevisHandContacts";
const contacts=previsHandContactsSchema.parse([{id:"touch",actorId:"girl",hand:"hand1",targetActorId:"horse",bone:"neck",startSec:0,contactSec:.5,releaseSec:1.5,endSec:2}]);
const spec={durationSec:2,actors:[{id:"girl",shape:"human"},{id:"horse",shape:"horse"}],handContacts:contacts};
it("扶颈真实双方、保持与回收及跨段保持",()=>{expect(handContactsIssue(spec)).toBeNull();expect([0,.5,1,1.5,2].map(t=>handContactAmount(contacts[0],t))).toEqual([0,1,1,1,0]);expect(handContactAmount({...contacts[0],contactSec:0,releaseSec:2},0)).toBe(1);expect(handContactAmount({...contacts[0],contactSec:0,releaseSec:2},2)).toBe(1);});
it("拒绝不存在目标、窗口隐藏和同手端碗/背负",()=>{expect(handContactsIssue({...spec,actors:[spec.actors[0]]})).toMatch(/另一匹马/);expect(handContactsIssue({...spec,storyProps:[{grip:{actorId:"girl",hand:"hand1"}}]})).toMatch(/端碗/);expect(handContactsIssue({...spec,piggyback:{carrierId:"girl",passengerId:"mom"}})).toMatch(/背负/);expect(handContactsIssue({...spec,actors:[{...spec.actors[0],visibleRanges:[{startSec:0,endSec:1}]},spec.actors[1]]})).toMatch(/在场/);});
it("拒绝同手重叠和非帧秒位",()=>{expect(handContactsIssue({...spec,handContacts:[...contacts,{...contacts[0],id:"other"}]})).toMatch(/重叠/);expect(handContactsIssue({...spec,handContacts:[{...contacts[0],contactSec:.51}]})).toMatch(/24帧/);});
const support=previsHandContactsSchema.parse(["-1","1"].map(side=>({id:`support${side}`,actorId:"girl",hand:`hand${side}`,targetActorId:"mom",bone:`upper_arm${side}`,startSec:0,contactSec:.5,releaseSec:1.5,endSec:2})));
const supported={durationSec:2,handContacts:support,actors:[{id:"girl",shape:"human",riggedModel:{}},{id:"mom",shape:"human",riggedModel:{},humanPosture:{mode:"rise_to_sit" as const,startSec:.5,endSec:1.5,supportHeight:.45,reclineDeg:45}}]};
it("扶坐强制同窗双手、两侧上臂和完整坐起保持",()=>{
 expect(handContactsIssue(supported)).toBeNull();
 expect(handContactsIssue({...supported,handContacts:[support[0]]})).toMatch(/双手/);
 expect(handContactsIssue({...supported,handContacts:[support[0],{...support[1],bone:"upper_arm-1"}]})).toMatch(/两侧/);
 expect(handContactsIssue({...supported,handContacts:support.map(c=>({...c,releaseSec:1}))})).toMatch(/完整坐起/);
 expect(handContactsIssue({...supported,handContacts:[support[0],{...support[1],contactSec:.75}]})).toMatch(/完整接触窗口/);
});
it("扶坐拒绝假模型、半躺不坐起、远离体表及冲突接触",()=>{
 expect(handContactsIssue({...supported,actors:[{id:"girl",shape:"human"},supported.actors[1]]})).toMatch(/真实模型/);
 expect(handContactsIssue({...supported,actors:[supported.actors[0],{...supported.actors[1],humanPosture:{mode:"hold",posture:"recline",supportHeight:.45,reclineDeg:45}}]})).toMatch(/坐起或坐稳/);
 expect(handContactsIssue({...supported,handContacts:support.map(c=>({...c,offset:[.3,0,0]}))})).toMatch(/0.2米/);
 expect(handContactsIssue({...supported,piggyback:{carrierId:"other",passengerId:"mom"}})).toMatch(/背负/);
 expect(handContactsIssue({...supported,interactions:[{actorId:"other",targetActorId:"mom"}]})).toMatch(/双人接触/);
 expect(handContactsIssue({...supported,storyProps:[{grip:{actorId:"mom",hand:"hand1"}}]})).toMatch(/持握道具/);
});
