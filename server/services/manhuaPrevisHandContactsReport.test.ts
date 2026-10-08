import { expect,it } from "vitest";
import { previsHandContactsSchema,handContactAmount } from "../../shared/manhuaPrevisHandContacts";
import { handContactsReportSchema,validateHandContactsReport } from "./manhuaPrevisHandContactsReport";
const contacts=previsHandContactsSchema.parse([{id:"touch",actorId:"girl",hand:"hand1",targetActorId:"horse",bone:"neck",startSec:0,contactSec:.5,releaseSec:1.5,endSec:2}]);
const spec={durationSec:2,actors:[{id:"girl"},{id:"horse"}],handContacts:contacts};
const report=()=>handContactsReportSchema.parse([{id:"touch",actorId:"girl",hand:"hand1",targetActorId:"horse",bone:"neck",source:{kind:"sourceRig"},targetSource:{kind:"sourceRig"},samples:Array.from({length:48},(_,i)=>{const a=handContactAmount(contacts[0],i/24);return {frame:i+1,amount:a,original:[0,0,0],target:[1,0,0],desired:[a,0,0],wrist:[a,0,0],residual:0};})}]);
it("严格检查缺报告、错手与真实腕点残差",()=>{expect(()=>validateHandContactsReport(report(),spec)).not.toThrow();expect(()=>validateHandContactsReport(undefined,spec)).toThrow(/数量/);const bad=report();bad[0].samples[24].wrist[0]=2;expect(()=>validateHandContactsReport(bad,spec)).toThrow(/手腕/);bad[0].hand="hand-1";expect(()=>validateHandContactsReport(bad,spec)).toThrow(/错配/);});
it("真实模型不能沿用源白模回执",()=>{expect(()=>validateHandContactsReport(report(),{...spec,actors:[{id:"girl",riggedModel:{sourceJobId:"real-girl"}},{id:"horse"}]})).toThrow(/真实模型/);});
