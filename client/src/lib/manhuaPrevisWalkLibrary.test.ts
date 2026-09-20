import {expect,it} from 'vitest';
import {createManhuaPrevisStudio,manhuaPrevisStudioSchema,manhuaPrevisRequestSchema} from '@shared/manhuaPrevis';
import {addPrevisLibraryAction} from './manhuaPrevisActionLibrary';
it('无位移拒绝；移动窗口之前的空档不能用作行走',()=>{
 const studio=createManhuaPrevisStudio(8);const actor=studio.spec.actors[0];
 expect(addPrevisLibraryAction(studio.spec,actor.id,'walk').error).toContain('真实位移');
 actor.end=[0,1];actor.moveStartSec=3;actor.moveEndSec=6;
 actor.actions=[{kind:'guard',startSec:3,endSec:4}];
 const before=structuredClone(studio);
 const result=addPrevisLibraryAction(studio.spec,actor.id,'walk');
 expect(result.error).toBeUndefined();expect(studio).toEqual(before);
 expect(result.spec!.actors[0].actions).toEqual([...actor.actions,{kind:'walk',startSec:4,endSec:6}]);
 const saved=manhuaPrevisStudioSchema.parse(JSON.parse(JSON.stringify({...studio,spec:result.spec})));
 const request=manhuaPrevisRequestSchema.parse({requestId:'22222222-2222-4222-8222-222222222222',scopeId:saved.scopeId,clipId:'clip-e01-g01',spec:saved.spec});
 expect(request.spec.actors[0].actions.at(-1)).toEqual({kind:'walk',startSec:4,endSec:6});
 expect(request.spec.actors[0].start).toEqual(actor.start);expect(request.spec.actors[0].end).toEqual(actor.end);
});
it('轨迹停顿边不混入，短碎片拒绝，已有动作和其他角色保留',()=>{
 const studio=createManhuaPrevisStudio(8);const a=studio.spec.actors[0];a.start=[0,0];a.end=[0,2];const lastFrame=8-1/24;
 a.motionRoute=[{timeSec:0,position:[0,0],facingDeg:0},{timeSec:2,position:[0,0],facingDeg:0},{timeSec:4,position:[0,1],facingDeg:0},{timeSec:6,position:[0,1],facingDeg:0},{timeSec:lastFrame,position:[0,2],facingDeg:0}];
 a.actions=[{kind:'guard',startSec:2,endSec:3.8}];studio.spec.actors.push({...structuredClone(a),id:'other'});
 const result=addPrevisLibraryAction(studio.spec,a.id,'walk');expect(result.error).toBeUndefined();
 expect(result.spec!.actors[0].actions.at(-1)).toEqual({kind:'walk',startSec:6,endSec:lastFrame});
 expect(result.spec!.actors[1]).toEqual(studio.spec.actors[1]);
 a.actions.push({kind:'guard',startSec:6,endSec:8});
 expect(addPrevisLibraryAction(studio.spec,a.id,'walk').error).toContain('真实位移');
});
