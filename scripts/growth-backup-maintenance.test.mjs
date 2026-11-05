import test from 'node:test';
import assert from 'node:assert/strict';
import {holdMaintenance} from './growth-backup-maintenance.mjs';

function fixture(){let clock=0,released=0;const records=[];return {records,get released(){return released},options:{label:'maintenance:growth-pr-1743',holdMs:2000,begin:async()=>async()=>{released++},stopped:async()=>false,record:async r=>records.push(r),sleep:async ms=>{clock+=ms},now:()=>clock}};}
test('维护窗口到期自动释放，不留永久暂停',async()=>{const f=fixture();await holdMaintenance(f.options);assert.equal(f.released,1);assert.deepEqual(f.records.map(r=>r.state),['ready','released']);assert.equal(f.records[0].expiresAt,2000);});
test('停止请求立即释放自己的租约',async()=>{const f=fixture();await holdMaintenance({...f.options,stopped:async()=>true,sleep:async()=>assert.fail('must not wait')});assert.equal(f.released,1);});
test('记录或读取停止状态失败仍释放租约',async()=>{for(const failure of ['record','stopped']){const f=fixture();await assert.rejects(holdMaintenance({...f.options,[failure]:async()=>{throw Error('injected failure')}}),/injected failure/);assert.equal(f.released,1);}});
test('拒绝越界时长和冒充用户的标签，零租约副作用',async()=>{for(const change of [{holdMs:600001},{holdMs:0},{label:'platform-user-1'}]){const f=fixture();await assert.rejects(holdMaintenance({...f.options,...change,begin:async()=>assert.fail('must not acquire')}),/scope_invalid/);}});
