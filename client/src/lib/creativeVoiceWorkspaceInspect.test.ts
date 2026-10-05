import {expect,it,vi} from "vitest";
import {inspectCreativeVoiceWorkspace} from "./creativeVoiceWorkspaceInspect";
it("工作流首次读取包含真实制作ID，不用人物显示名充当ID",async()=>{
 const read=vi.fn(async()=>JSON.stringify({production:{assets:[{id:"asset-42",name:"沈昀",has2d:true}],clips:[{id:"clip-e01-g01"}]}}));
 const state=JSON.parse(await inspectCreativeVoiceWorkspace(JSON.stringify({context:"当前集正文",targets:[{episode:2}]}),read));
 expect(state.productionState.production.assets[0]).toEqual({id:"asset-42",name:"沈昀",has2d:true});expect(state.targets).toEqual([{episode:2}]);expect(read).toHaveBeenCalledTimes(1);
 const failed=JSON.parse(await inspectCreativeVoiceWorkspace('{"context":"保留正文"}',async()=>{throw Error("云稿冲突")}));
 expect(failed.context).toBe("保留正文");expect(failed.productionReadError).toBe("云稿冲突");expect(failed.productionState).toBeUndefined();
 expect(JSON.parse(await inspectCreativeVoiceWorkspace("素材读取失败",read))).toEqual({pageReadError:"素材读取失败"});expect(read).toHaveBeenCalledTimes(1);
});
